/**
 * Everything the server holds for one checkout (issue 1279, `docs/design/USER_LEVEL_DR.md`
 * section 7, "Per-checkout state"): its model, staging area, annotations, staged changesets,
 * file watcher, websocket subscribers and running DrBot turns, keyed by a `CheckoutRef`. (The DrBot
 * launcher, dr-bot-launcher.ts, keeps each conversation's agent session, by `DrBotSessionKey`.)
 *
 * Contexts are never shared between checkouts: that is the whole isolation guarantee. The
 * checkout context pool (checkout-context-pool.ts) creates and evicts them; in slice 1 the
 * visualization server builds its one context from the Model it is given.
 * (`application.applicationcomponent.checkout-context`)
 */

import type { ChildProcess } from "child_process";
import chokidar from "chokidar";
import { mkdirSync } from "fs";
import path from "path";
import { activeMarkerPath } from "../core/active-changeset-marker.js";
import { AnnotationStore, type Annotation as StoredAnnotation } from "../core/annotation-store.js";
import { Changeset as StagedChangeset } from "../core/changeset.js";
import type { CheckoutRef } from "../core/checkout-types.js";
import { Model } from "../core/model.js";
import { StagedChangesetStorage } from "../core/staged-changeset-storage.js";
import { StagingAreaManager } from "../core/staging-area.js";
import { getErrorMessage } from "../utils/errors.js";

/** One map key per checkout. Project names are kebab-case and git worktree names hold no NUL. */
export function checkoutKey(ref: CheckoutRef): string {
  return `${ref.project}\u0000${ref.checkout}`;
}

/** A websocket subscribed to a checkout's feed: what the context needs of it. */
export interface CheckoutSubscriber {
  send(source: string | ArrayBuffer | Uint8Array | ArrayBufferView, options?: { compress?: boolean }): void;
  close(code?: number, reason?: string): void;
}

/** What the server compares to tell an annotation changed, and which replies are new. */
export interface AnnotationFingerprint {
  elementId: string;
  /** content, tags, resolved and updatedAt, serialized. */
  state: string;
  replyIds: string[];
}

export function annotationFingerprint(annotation: StoredAnnotation): AnnotationFingerprint {
  return {
    elementId: annotation.elementId,
    state: JSON.stringify([annotation.content, annotation.tags, annotation.resolved, annotation.updatedAt ?? null]),
    replyIds: annotation.replies.map((reply) => reply.id),
  };
}

/** What the file watcher reports, already sorted by the part of the checkout that changed. */
export interface CheckoutWatchHandlers {
  /** A file under documentation-robotics/model/ changed. */
  onModelChanged(): void | Promise<void>;
  /** A changeset file, or the active-changeset marker in .dr/, changed. */
  onChangesetsChanged(): void;
  /** An annotation file changed. */
  onAnnotationsChanged(): void;
}

/** Why a context closes: the server stops, the pool evicts it, or its checkout is gone. */
export type CheckoutCloseReason = "stopped" | "evicted" | "removed";

export interface CheckoutCloseOptions {
  reason?: CheckoutCloseReason;
  /**
   * The process is about to exit: leave the file watcher open. Closing a chokidar watcher while
   * the tree it watches is being deleted deadlocks Bun's main thread (#1235).
   */
  processExiting?: boolean;
}

/** The message a removed checkout's subscribers get before their sockets close. */
export const CHECKOUT_REMOVED_MESSAGE = "checkout.removed";

export class CheckoutContext<S extends CheckoutSubscriber = CheckoutSubscriber> {
  readonly ref: CheckoutRef;
  /** The checkout's project root (the folder holding documentation-robotics/). */
  readonly rootPath: string;
  /** The model as last loaded; the watcher's reload replaces it. */
  model: Model;
  /**
   * Annotations live on disk (documentation-robotics/annotations/), shared with the MCP
   * annotation_* tools, which run in other processes.
   */
  readonly annotationStore: AnnotationStore;
  /** What this context last saw of each annotation, to tell which changes to broadcast. */
  readonly annotationSnapshot: Map<string, AnnotationFingerprint> = new Map();
  /** Serializes annotation writes and snapshot syncs, so a sync never sees half of a write. */
  private annotationQueue: Promise<unknown> = Promise.resolve();
  readonly changesetStorage: StagedChangesetStorage;
  /** changesetId -> changeset, as last read from disk. */
  readonly changesets: Map<string, StagedChangeset> = new Map();
  /** The websockets subscribed to this checkout's feed. */
  readonly subscribers: Set<S> = new Set();
  watcher?: any;
  /** Counts model reloads, so one that finishes after a newer one started doesn't put its model back. */
  reloadGeneration = 0;
  /** Pending debounced broadcasts from the file watcher. */
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** DrBot: conversationId -> the running chat process. */
  readonly chatProcesses: Map<string, ChildProcess> = new Map();
  /**
   * Conversation id -> the running turn's token. A conversation runs one turn at a time: it is
   * reserved when chat.send arrives and released only after that turn's process has exited.
   */
  readonly busyChatConversations: Map<string, symbol> = new Map();
  /** Chat processes stopped by chat.cancel: nothing more from them reaches the client. */
  readonly cancelledChatProcesses = new WeakSet<ChildProcess>();
  /** Told when the context closes, before it closes (the DrBot launcher ends its queued turns). */
  private closeListeners: Set<(reason: CheckoutCloseReason) => void> = new Set();

  /** When the context was last used, for the pool's idle and least-recently-used eviction. */
  lastUsedAt: number;
  private _closed = false;

  constructor(ref: CheckoutRef, model: Model, options: { now?: number } = {}) {
    this.ref = { project: ref.project, checkout: ref.checkout };
    this.model = model;
    this.rootPath = model.rootPath;
    this.annotationStore = new AnnotationStore(this.rootPath);
    this.changesetStorage = new StagedChangesetStorage(this.rootPath);
    this.lastUsedAt = options.now ?? Date.now();
  }

  /** Loads a checkout's model from disk and makes its context. */
  static async load(ref: CheckoutRef, modelPath: string): Promise<CheckoutContext> {
    const model = await Model.load(modelPath, { lazyLoad: false });
    return new CheckoutContext(ref, model);
  }

  get key(): string {
    return checkoutKey(this.ref);
  }

  get closed(): boolean {
    return this._closed;
  }

  /** Calls listener when the context closes, with why. Returns the call that stops listening. */
  onClose(listener: (reason: CheckoutCloseReason) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  /** Records a use, for eviction. */
  touch(now: number = Date.now()): void {
    this.lastUsedAt = now;
  }

  hasSubscribers(): boolean {
    return this.subscribers.size > 0;
  }

  /** A DrBot turn is running: a conversation is reserved or a chat process is alive. */
  hasRunningTurn(): boolean {
    return this.busyChatConversations.size > 0 || this.chatProcesses.size > 0;
  }

  /** The pool never evicts a busy context. */
  isBusy(): boolean {
    return this.hasSubscribers() || this.hasRunningTurn();
  }

  /** A staging area over this checkout's model. */
  stagingArea(): StagingAreaManager {
    return new StagingAreaManager(this.rootPath, this.model);
  }

  /** The model as it is on disk now. */
  loadModelFromDisk(): Promise<Model> {
    return Model.load(this.rootPath, { lazyLoad: false });
  }

  /** Reads every staged changeset from disk into `changesets`. */
  async loadChangesets(): Promise<void> {
    try {
      const changesets = await this.changesetStorage.list();
      this.changesets.clear();
      for (const cs of changesets) {
        this.changesets.set(cs.id, cs);
      }
      if (process.env.VERBOSE) {
        console.log(`[Changesets] Loaded ${changesets.length} changeset(s) from disk`);
      }
    } catch (err) {
      console.warn(`[Changesets] Warning: Failed to load changesets from disk: ${err}`);
    }
  }

  /** Runs an annotation write or sync after the ones queued before it. */
  withAnnotations<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.annotationQueue.then(fn, fn);
    this.annotationQueue = run.catch(() => {});
    return run;
  }

  /**
   * Records an annotation as seen and returns a message for each difference from what this
   * context last saw of it: the change a route just made, and any change another process made
   * that the watcher has not synced yet (so recording it as seen doesn't swallow that change).
   * Call it inside withAnnotations.
   */
  diffAnnotation(annotation: StoredAnnotation): Array<Record<string, unknown>> {
    const before = this.annotationSnapshot.get(annotation.id);
    const after = annotationFingerprint(annotation);
    this.annotationSnapshot.set(annotation.id, after);
    if (!before) {
      return [
        {
          type: "annotation.added",
          annotationId: annotation.id,
          elementId: annotation.elementId,
          timestamp: annotation.createdAt,
        },
      ];
    }
    const out: Array<Record<string, unknown>> = [];
    if (before.state !== after.state) {
      out.push({
        type: "annotation.updated",
        annotationId: annotation.id,
        timestamp: annotation.updatedAt ?? new Date().toISOString(),
      });
    }
    for (const reply of annotation.replies) {
      if (!before.replyIds.includes(reply.id)) {
        out.push({
          type: "annotation.reply.added",
          annotationId: annotation.id,
          replyId: reply.id,
          timestamp: reply.createdAt,
        });
      }
    }
    return out;
  }

  /**
   * Compares the annotation files with what this context last saw, and returns a message for
   * each change another process made (the MCP annotation tools, a hand edit): annotation.added,
   * annotation.updated, annotation.reply.added and annotation.deleted.
   */
  syncAnnotations(): Promise<Array<Record<string, unknown>>> {
    return this.withAnnotations(async () => {
      const current = await this.annotationStore.list();
      const now = new Date().toISOString();
      const out: Array<Record<string, unknown>> = [];
      const seen = new Set<string>();
      for (const annotation of current) {
        seen.add(annotation.id);
        out.push(...this.diffAnnotation(annotation));
      }
      for (const id of [...this.annotationSnapshot.keys()]) {
        if (seen.has(id)) continue;
        this.annotationSnapshot.delete(id);
        out.push({ type: "annotation.deleted", annotationId: id, timestamp: now });
      }
      return out;
    });
  }

  /** Runs fn once `name` has been quiet for ms; a later call restarts the wait. */
  debounce(name: string, ms: number, fn: () => void): void {
    const pending = this.timers.get(name);
    if (pending) clearTimeout(pending);
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name);
        fn();
      }, ms)
    );
  }

  /**
   * Watches the checkout's documentation-robotics/model/, changesets/ and annotations/ and its
   * active-changeset marker in .dr/, and reports each change to the handler for its part.
   */
  watch(handlers: CheckoutWatchHandlers): void {
    const drRoot = path.join(this.rootPath, "documentation-robotics");
    const modelPath = path.join(drRoot, "model");
    const changesetsPath = path.join(drRoot, "changesets");
    const annotationsPath = path.join(drRoot, "annotations");
    // Which changeset is active is per-checkout state in .dr/ (active-changeset-marker.ts)
    const markerPath = activeMarkerPath(this.rootPath);
    const markerDir = path.dirname(markerPath);
    const isWithin = (filePath: string, dir: string) => filePath === dir || filePath.startsWith(dir + path.sep);

    // Use chokidar for consistent, well-tested cross-platform recursive watching
    // rather than Node's built-in recursive fs.watch (Linux support for the
    // `recursive` option only landed in Node 19.1.0, and its maturity/event
    // semantics still vary more by platform than chokidar's).
    // chokidar doesn't pick up a watched directory created later, and a model has no
    // changesets/ until its first changeset: watch documentation-robotics/ and keep to
    // model/, changesets/ and annotations/ under it.
    try {
      // .dr/ is watched for the marker alone: its other contents (the spec reference, analyzer
      // state, logs) are ignored, so nothing under them is read or watched. chokidar can't watch
      // a directory that isn't there yet, and a fresh checkout has no .dr/ until something
      // writes per-checkout state, so make it.
      try {
        mkdirSync(markerDir, { recursive: true });
      } catch (error) {
        console.warn(`[Watcher] Could not create ${markerDir}: ${getErrorMessage(error)}`);
      }
      this.watcher = chokidar.watch([drRoot, markerDir], {
        persistent: true,
        ignoreInitial: true,
        ignored: (filePath: string) =>
          !(
            filePath === drRoot ||
            filePath === markerDir ||
            filePath === markerPath ||
            isWithin(filePath, modelPath) ||
            isWithin(filePath, changesetsPath) ||
            isWithin(filePath, annotationsPath)
          ),
      });

      this.watcher.on("all", async (_event: string, filePath: string) => {
        if (process.env.VERBOSE) {
          console.log(`[Watcher] File changed: ${filePath}`);
        }

        if (isWithin(filePath, annotationsPath)) {
          handlers.onAnnotationsChanged();
          return;
        }

        if (filePath === markerPath || isWithin(filePath, changesetsPath)) {
          handlers.onChangesetsChanged();
          return;
        }
        if (!isWithin(filePath, modelPath)) return;

        try {
          await handlers.onModelChanged();
        } catch (error) {
          console.error(`[Watcher] Failed to reload model: ${getErrorMessage(error)}`);
        }
      });

      this.watcher.on("error", (err: unknown) => {
        console.warn(`[Watcher] Could not watch ${drRoot}: ${getErrorMessage(err)}`);
      });
    } catch (err) {
      console.warn(`[Watcher] Could not watch ${drRoot}: ${err}`);
    }
  }

  /**
   * Closes the context: its subscribers' sockets, its watcher and its pending broadcasts. A
   * removed checkout's subscribers are first told it is gone, and its DrBot turns are ended.
   * Nothing on disk changes: everything durable is already in the checkout's files.
   */
  close(options: CheckoutCloseOptions = {}): void {
    const reason = options.reason ?? "stopped";
    for (const listener of [...this.closeListeners]) {
      try {
        listener(reason);
      } catch (error) {
        console.warn(`[Checkout] A close listener failed: ${getErrorMessage(error)}`);
      }
    }
    this.closeListeners.clear();
    if (reason === "removed") {
      const message = JSON.stringify({
        type: CHECKOUT_REMOVED_MESSAGE,
        project: this.ref.project,
        checkout: this.ref.checkout,
        timestamp: new Date().toISOString(),
      });
      for (const subscriber of this.subscribers) {
        try {
          subscriber.send(message);
        } catch {
          // A socket that is already gone needs no notice.
        }
      }
      for (const [conversationId, proc] of this.chatProcesses) {
        this.cancelledChatProcesses.add(proc);
        try {
          proc.kill("SIGTERM");
        } catch (error) {
          console.warn(`[Checkout] Could not stop DrBot turn ${conversationId}: ${getErrorMessage(error)}`);
        }
      }
      this.chatProcesses.clear();
      this.busyChatConversations.clear();
    }

    for (const subscriber of this.subscribers) {
      try {
        subscriber.close();
      } catch (error) {
        // Log unexpected errors regardless of VERBOSE flag for operational visibility
        const errorMessage = getErrorMessage(error);
        if (!errorMessage.includes("already closed")) {
          console.warn(`[SERVER] Unexpected error closing WebSocket client: ${errorMessage}`);
        }
      }
    }
    this.subscribers.clear();

    if (this.watcher && !options.processExiting) {
      this.watcher.close?.();
    }
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();

    if (reason !== "stopped") {
      // Dropped from the pool: free what the context holds in memory.
      this.changesets.clear();
      this.annotationSnapshot.clear();
      this.watcher = undefined;
    }
    this._closed = true;
  }
}
