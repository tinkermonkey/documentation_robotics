/**
 * The index job's `classifying` phase (docs/analyzers/TIER1_DESIGN.md section 4.4): the Tier-1
 * cache fill (`classifier/index-fill.ts`) recorded in the job record (`index-job.ts`) as it goes,
 * and in the job log. Run by the `dr analyzer index --job` child after the index is recorded done.
 *
 * The record is the fill's only handle: `codebase_index` finds a running fill there, to stop it
 * before starting another or on `cancelFill`. So the child marks the fill running in the same write
 * that marks the index done (`tier1FillMarker`, `finishIndexJob`), and a fill whose record now
 * belongs to another run (a write refused) stops at once: no fill runs, and spends, untracked.
 */
import { existsSync } from "node:fs";
import type { ClassifyReport } from "./cards/classify.js";
import { tier1Paths } from "./classifier/config.js";
import { runIndexFill, type RunIndexFillOptions } from "./classifier/index-fill.js";
import type { Tier1Fill } from "./classifier/types.js";
import { recordIndexJobFill } from "./index-job.js";

/**
 * The fill's first record, written with the index's `done` when the checkout opted in to Tier 1
 * (`tier1.json` exists, whatever its state: the fill then says why it is skipped); null otherwise,
 * so the record of a checkout that hasn't opted in is exactly as it always was.
 */
export function tier1FillMarker(projectRoot: string, analyzer: string, now: Date = new Date()): Tier1Fill | null {
  if (!existsSync(tier1Paths(projectRoot, analyzer).config)) return null;
  const at = now.toISOString();
  return { state: "running", startedAt: at, updatedAt: at, finishedAt: null, cards: null, asked: 0, cached: 0, sent: 0, failed: 0, skipped: 0, costUsd: 0 };
}

export interface IndexJobFillOptions {
  projectRoot: string;
  jobId: string;
  analyzer: string;
  codebaseRoot?: string;
  classify: () => Promise<ClassifyReport>;
  signal?: AbortSignal;
  log?: (line: string) => void;
  /** The record already carries the fill's marker (`tier1FillMarker`): it is always closed, even when Tier 1 turns out off. */
  marked?: boolean;
  /** Tests: a fake model, an empty environment, the spec criteria, the update interval. */
  fill?: Pick<RunIndexFillOptions, "open" | "spec" | "updateEveryMs" | "runId">;
}

/**
 * Fill the cache and record it in the job: nothing when the checkout hasn't opted in (the record
 * is left as it was), else the fill as it goes and how it ended. A refused write (the record
 * belongs to another run) cancels the fill. Never throws.
 */
export async function runIndexJobFill(options: IndexJobFillOptions): Promise<Tier1Fill | null> {
  const lost = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, lost.signal]) : lost.signal;
  const record = async (fill: Tier1Fill): Promise<boolean> => {
    let ok = false;
    try {
      ok = await recordIndexJobFill(options.projectRoot, options.jobId, fill);
    } catch {
      return true; // the record couldn't be written this time (its lock busy): the next update tries again
    }
    if (!ok && !lost.signal.aborted) {
      options.log?.("Tier 1 cache fill stopped: the job record now belongs to another index run.");
      lost.abort();
    }
    return ok;
  };
  try {
    const fill = await runIndexFill({
      projectRoot: options.projectRoot,
      analyzer: options.analyzer,
      ...(options.codebaseRoot ? { codebaseRoot: options.codebaseRoot } : {}),
      classify: options.classify,
      signal,
      ...(options.log ? { log: options.log } : {}),
      ...(options.fill ?? {}),
      lostReason: () => (lost.signal.aborted ? "the job record now belongs to another index run, so this fill stopped; what was asked is cached" : null),
      onUpdate: async (fill) => {
        await record(fill);
      },
    });
    if (!fill && options.marked) {
      // tier1.json went away between the marker and the fill: close the marker.
      const at = new Date().toISOString();
      const closed: Tier1Fill = {
        state: "skipped",
        reason: "Tier 1 is off: tier1.json is gone",
        startedAt: at,
        updatedAt: at,
        finishedAt: at,
        cards: null,
        asked: 0,
        cached: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        costUsd: 0,
      };
      await record(closed);
      return closed;
    }
    return fill;
  } catch {
    return null; // runIndexFill doesn't throw; this keeps the index's outcome whatever happens
  }
}

/**
 * The fill in the `dr analyzer index --job` child, with the process's signals: a SIGTERM or
 * SIGINT (a forced or newer `codebase_index`, or `cancelFill`) cancels it: nothing more is asked,
 * the cache isn't compacted nor the ledger pruned, what was asked is cached and its spend recorded,
 * the record says `cancelled`, and the process ends. A second signal, or 15 s without the fill
 * ending, exits at once.
 */
export async function fillAfterIndex(options: Omit<IndexJobFillOptions, "signal">): Promise<Tier1Fill | null> {
  const controller = new AbortController();
  const onSignal = () => {
    if (controller.signal.aborted) process.exit(143);
    controller.abort();
    setTimeout(() => process.exit(143), 15_000).unref();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  try {
    return await runIndexJobFill({ ...options, signal: controller.signal });
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  }
}
