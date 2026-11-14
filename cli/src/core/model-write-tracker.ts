/**
 * In-process tracking of writes to a project's model files (the model directory, the
 * active-changeset marker and changeset files).
 *
 * A long-lived reader of the model (the MCP server's model cache) must not reread the model while
 * a write in this process is half done: `Model.saveLayer` removes a layer's files and writes them
 * again one by one, so a read in between sees part of the layer. Every write path runs inside
 * {@link trackModelWrite}; readers ask {@link modelWritesInFlight} and wait with
 * {@link whenModelWritesSettled}, and listeners hear each write begin and end, with the Model
 * instance that wrote (when there is one) so a cache can tell its own writes from others'.
 */

import path from "node:path";

export interface ModelWriteEvent {
  /** The project root written to (resolved). */
  root: string;
  /** The Model instance whose state is being written, or undefined for writes not made from one. */
  writer: object | undefined;
  phase: "begin" | "end";
  /** Writes in flight for `root` after this event (on "begin", this write included). */
  inFlight: number;
  /** On "end": the write threw, so what is on disk may be neither the writer's state nor the old one. */
  failed?: boolean;
}

export type ModelWriteListener = (event: ModelWriteEvent) => void;

const inFlight = new Map<string, number>();
/** Writes begun per root, ever: a reader that sees it move knows a write began during its read. */
const generations = new Map<string, number>();
const settledWaiters = new Map<string, Array<() => void>>();
const listeners = new Set<ModelWriteListener>();

function rootKey(root: string): string {
  return path.resolve(root);
}

/** Runs `write` as a write to the model at `root`, counted until it settles (resolved or not). */
export async function trackModelWrite<T>(
  root: string,
  writer: object | undefined,
  write: () => Promise<T>
): Promise<T> {
  const key = rootKey(root);
  const count = (inFlight.get(key) ?? 0) + 1;
  inFlight.set(key, count);
  generations.set(key, (generations.get(key) ?? 0) + 1);
  emit({ root: key, writer, phase: "begin", inFlight: count });
  let failed = false;
  try {
    return await write();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const remaining = (inFlight.get(key) ?? 1) - 1;
    if (remaining > 0) {
      inFlight.set(key, remaining);
    } else {
      inFlight.delete(key);
    }
    emit({ root: key, writer, phase: "end", inFlight: remaining, failed });
    if (remaining === 0) {
      const waiters = settledWaiters.get(key) ?? [];
      settledWaiters.delete(key);
      for (const resolve of waiters) resolve();
    }
  }
}

/** How many writes to the model at `root` are in flight in this process. */
export function modelWritesInFlight(root: string): number {
  return inFlight.get(rootKey(root)) ?? 0;
}

/** How many writes to the model at `root` have begun in this process (it only grows). */
export function modelWriteGeneration(root: string): number {
  return generations.get(rootKey(root)) ?? 0;
}

/** Resolves once no write to the model at `root` is in flight (at once when none is). */
export function whenModelWritesSettled(root: string): Promise<void> {
  const key = rootKey(root);
  if (!inFlight.get(key)) return Promise.resolve();
  return new Promise((resolve) => {
    const waiters = settledWaiters.get(key) ?? [];
    waiters.push(resolve);
    settledWaiters.set(key, waiters);
  });
}

/** Subscribes to write events; returns the unsubscribe function. */
export function onModelWrite(listener: ModelWriteListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: ModelWriteEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error(`[model-write-tracker] listener failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
