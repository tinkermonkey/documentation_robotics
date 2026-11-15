/**
 * The index job's `classifying` phase (docs/analyzers/TIER1_DESIGN.md section 4.4): the Tier-1
 * cache fill (`classifier/index-fill.ts`) recorded in the job record (`index-job.ts`) as it goes,
 * and in the job log. Run by the `dr analyzer index --job` child after the index is recorded done.
 */
import type { ClassifyReport } from "./cards/classify.js";
import { runIndexFill, type RunIndexFillOptions } from "./classifier/index-fill.js";
import type { Tier1Fill } from "./classifier/types.js";
import { recordIndexJobFill } from "./index-job.js";

export interface IndexJobFillOptions {
  projectRoot: string;
  jobId: string;
  analyzer: string;
  codebaseRoot?: string;
  classify: () => Promise<ClassifyReport>;
  signal?: AbortSignal;
  log?: (line: string) => void;
  /** Tests: a fake model, an empty environment, the spec criteria, the update interval. */
  fill?: Pick<RunIndexFillOptions, "open" | "spec" | "updateEveryMs" | "runId">;
}

/**
 * Fill the cache and record it in the job: nothing when the checkout hasn't opted in (the record
 * is left as it was), else the fill as it goes and how it ended. Never throws.
 */
export async function runIndexJobFill(options: IndexJobFillOptions): Promise<Tier1Fill | null> {
  try {
    return await runIndexFill({
      projectRoot: options.projectRoot,
      analyzer: options.analyzer,
      ...(options.codebaseRoot ? { codebaseRoot: options.codebaseRoot } : {}),
      classify: options.classify,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.log ? { log: options.log } : {}),
      ...(options.fill ?? {}),
      onUpdate: async (fill) => {
        await recordIndexJobFill(options.projectRoot, options.jobId, fill);
      },
    });
  } catch {
    return null; // runIndexFill doesn't throw; this keeps the index's outcome whatever happens
  }
}
