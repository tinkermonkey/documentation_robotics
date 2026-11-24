/**
 * Progress of a changeset commit in flight (issue 1361), for the viewer's Apply progress bar.
 *
 * `StagingAreaManager.commit` reports each step to `CommitOptions.onProgress`. Whoever runs the
 * commit wraps that in a reporter (`createCommitProgressReporter`) that throttles the reports and
 * publishes them on a process-wide channel, keyed by the checkout's root path. The central server
 * listens on the channel and broadcasts `changeset.commit.progress` to that checkout's websocket
 * subscribers only. A commit run in another process (a separate `dr changeset commit`) publishes
 * to a channel nobody listens on, which costs nothing.
 *
 * Progress is advisory: the commit's own result (the HTTP response, the tool result) is what
 * counts. A success always ends with `phase: "done"` and `applied === total`; a failure ends with
 * `failed: true` in the phase it stopped in.
 */

import path from "node:path";

/** Where a commit is: checking, writing the changes, saving files, reloading the model, finished. */
export type CommitPhase = "validating" | "applying" | "saving" | "reloading" | "done";

/** One progress report of a commit in flight. */
export interface CommitProgress {
  changesetId: string;
  /** The changes handled so far (applied or skipped as already in the base). */
  applied: number;
  /** The changes the commit handles: the changeset's staged changes, known before the first write. */
  total: number;
  phase: CommitPhase;
  /** The layer of the change just applied, while applying. */
  layer?: string;
  /** Set on the last report of a commit that failed; `phase` is where it stopped. */
  failed?: true;
}

/** A report on the process-wide channel: which checkout (its root path) it is about. */
export interface PublishedCommitProgress extends CommitProgress {
  rootPath: string;
}

type Listener = (progress: PublishedCommitProgress) => void;

const listeners = new Set<Listener>();

/** Listens for every commit progress report published in this process. Returns the unsubscribe. */
export function subscribeCommitProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publishes a report to every listener. A listener that throws never fails the commit. */
export function publishCommitProgress(progress: PublishedCommitProgress): void {
  for (const listener of listeners) {
    try {
      listener(progress);
    } catch (error) {
      console.warn(`[CommitProgress] A listener failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Whether two root paths name the same checkout folder (resolved; not followed through links). */
export function sameRootPath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

/** The default gap between two throttled reports of one commit. */
export const COMMIT_PROGRESS_INTERVAL_MS = 200;

export interface CommitProgressReporterOptions {
  /** The least time between two reports in the same phase (default COMMIT_PROGRESS_INTERVAL_MS). */
  intervalMs?: number;
  /** Where the reports go (default: publishCommitProgress). */
  publish?: (progress: PublishedCommitProgress) => void;
  /** The clock, for tests (default Date.now). */
  now?: () => number;
}

export interface CommitProgressReporter {
  /** Pass as `CommitOptions.onProgress`: reports from the commit, throttled. */
  onProgress: (progress: CommitProgress) => void;
  /** Reports a phase after the commit returned (the server's `reloading`), always sent. */
  phase: (phase: CommitPhase) => void;
  /** The final report of a success: `applied === total`, phase `done`. Sent once. */
  finish: () => void;
  /** The final report of a failure: `failed: true` in the phase it stopped in. Sent once. */
  fail: () => void;
}

/**
 * Throttles one commit's reports and publishes them. Sent at once: the first report, each change
 * of phase and the final one; otherwise at most one per `intervalMs`, so a 1,200-change commit
 * sends a handful of messages rather than 1,200. Nothing is sent after `finish` or `fail`.
 */
export function createCommitProgressReporter(
  rootPath: string,
  changesetId: string,
  options: CommitProgressReporterOptions = {}
): CommitProgressReporter {
  const intervalMs = options.intervalMs ?? COMMIT_PROGRESS_INTERVAL_MS;
  const publish = options.publish ?? publishCommitProgress;
  const now = options.now ?? Date.now;

  let last: CommitProgress = { changesetId, applied: 0, total: 0, phase: "validating" };
  let lastSentAt: number | undefined;
  let lastSentPhase: CommitPhase | undefined;
  let ended = false;

  const send = (progress: CommitProgress) => {
    lastSentAt = now();
    lastSentPhase = progress.phase;
    const { layer, failed, ...rest } = progress;
    publish({
      rootPath,
      ...rest,
      changesetId,
      ...(layer !== undefined ? { layer } : {}),
      ...(failed ? { failed } : {}),
    });
  };

  return {
    onProgress(progress) {
      if (ended) return;
      last = { ...progress, changesetId };
      const due =
        lastSentAt === undefined || progress.phase !== lastSentPhase || now() - lastSentAt >= intervalMs;
      if (due) send(last);
    },
    phase(phase) {
      if (ended) return;
      last = { changesetId, applied: last.applied, total: last.total, phase };
      send(last);
    },
    finish() {
      if (ended) return;
      ended = true;
      send({ changesetId, applied: last.total, total: last.total, phase: "done" });
    },
    fail() {
      if (ended) return;
      ended = true;
      send({ ...last, failed: true });
    },
  };
}
