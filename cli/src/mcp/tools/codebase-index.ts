/**
 * codebase_index — index the project's code with the analyzer (codebase-memory-mcp), in the
 * background.
 *
 * It starts `dr analyzer index` in a detached process. Without `wait` it returns at once; with
 * `wait` (seconds, capped at MAX_WAIT_SECONDS) it blocks until the run ends or the wait does, then
 * returns the job. The agent repeats `status: true, wait: 30` until the job is done or failed.
 * Indexing a large codebase outlasts an MCP call, and a client that moves a long call to the
 * background (Claude Code after 2 minutes) loses its result under `claude -p`, so a single call
 * never waits longer than about 50 seconds. The job record is `.dr/analyzers/index-job.json`
 * (analyzers/index-job.ts). Writes no model files.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readIndexJob, startIndexJob, type IndexJob } from "../../analyzers/index-job.js";
import { readSession, writeSession } from "../../analyzers/session-state.js";
import type { IndexFreshness } from "../../analyzers/active-analyzer.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolContext, type McpToolDefinition } from "./shared.js";
import {
  analyzerNotFoundError,
  assessIndex,
  canonicalRoots,
  defaultCodebaseToolDeps,
  describeIndex,
  installSuggestions,
  notInstalledError,
  takeWorktreeSnapshot,
  WAIT_FOR_INDEX,
  writeWorktreeSnapshot,
  type CodebaseToolDeps,
  type IndexJudgement,
} from "./codebase-shared.js";

/** The longest one call blocks: under the point where a client moves a call to the background. */
export const MAX_WAIT_SECONDS = 50;

const inputSchema = {
  status: z
    .boolean()
    .optional()
    .describe("Only report the current or last run and the index's freshness; start nothing."),
  wait: z
    .number()
    .min(0)
    .optional()
    .describe(
      `Seconds to block until the run finishes (at most ${MAX_WAIT_SECONDS}; larger values are capped). Returns early when the run ends. Pass 30 when starting and when polling.`
    ),
  force: z
    .boolean()
    .optional()
    .describe("Re-index even when the index is fresh. Also stops a run in flight and starts over (for a stuck run)."),
  rootPath: rootPathSchema,
};

export type CodebaseIndexArgs = z.infer<z.ZodObject<typeof inputSchema>>;

const POLL = `Indexing is still running. ${WAIT_FOR_INDEX} or failed; do other work between calls if you have any.`;

/** What the agent should do next, given the job and the index. */
function nextStep(job: IndexJob | null, freshness: IndexFreshness, judgement: IndexJudgement | null): string {
  if (job?.state === "running") return POLL;
  const state = judgement?.state ?? "stale";
  if (job?.state === "failed" && state !== "fresh") {
    return "The last run failed: see job.error and the log at job.logPath. Fix the cause, then call codebase_index again.";
  }
  if (!freshness.indexed) return "The code is not indexed. Call codebase_index with wait: 30 to index it.";
  if (state === "fresh") {
    return "The index is fresh. codebase_extract models the code; codebase_verify checks the model's api, data-store, technology, security and testing layers against the code.";
  }
  if (state === "fresh-with-uncommitted-edits") {
    return "Source files were edited after the index was taken (index.uncommittedEdits). Call codebase_index with wait: 30 to re-index them.";
  }
  return "The code has changed since the last index. Call codebase_index with wait: 30 to re-index.";
}

/** Sleeps `ms`, or less when `signal` aborts. */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/** Blocks until the run is no longer running or `seconds` pass, and returns the job as it is then. */
/** Time kept back from the wait for the last read of the index, so the whole call fits the cap. */
const REPORT_RESERVE_MS = 2000;

/**
 * Blocks until the run is no longer running, `deadline` passes, or the request is cancelled, and
 * returns the job as it is then.
 */
async function waitForJob(
  projectRoot: string,
  job: IndexJob | null,
  deadline: number,
  deps: CodebaseToolDeps,
  signal?: AbortSignal
): Promise<IndexJob | null> {
  const interval = deps.pollIntervalMs ?? 1000;
  let current = job;
  while (current?.state === "running" && Date.now() < deadline && !signal?.aborted) {
    await sleep(Math.max(1, Math.min(interval, deadline - Date.now())), signal);
    current = await readIndexJob(projectRoot, { isAlive: deps.isAlive });
  }
  return current;
}

export function createCodebaseIndexHandler(deps: CodebaseToolDeps = defaultCodebaseToolDeps) {
  return async function codebaseIndexHandler(args: CodebaseIndexArgs, context?: McpToolContext): Promise<CallToolResult> {
    // The wait counts from the call's start: loading the model and running git use it up too.
    const deadline = Date.now() + Math.min((args.wait ?? 0) * 1000, MAX_WAIT_SECONDS * 1000 - REPORT_RESERVE_MS);
    return runTool(async () => {
      // The project comes from rootPath or the client's roots (loadModel waits for them).
      const model = await loadModel(args.rootPath);
      // One spelling of each root for this call and the child it starts (see canonicalRoots).
      const { projectRoot, codebaseRoot } = await canonicalRoots(model);
      const job = await readIndexJob(projectRoot, { isAlive: deps.isAlive });
      const session = await readSession(projectRoot);

      const report = async (analyzer: string | null, started: boolean, current: IndexJob | null, extra = {}) => {
        const waited = args.wait && args.wait > 0 && current?.state === "running";
        const startedWaiting = Date.now();
        const settled = waited ? await waitForJob(projectRoot, current, deadline, deps, context?.signal) : current;
        const { freshness, judgement } = analyzer
          ? await assessIndex(projectRoot, analyzer, codebaseRoot, deps)
          : { freshness: { indexed: false, fresh: false } as const, judgement: null };
        return jsonResult({
          projectRoot,
          analyzer,
          started,
          job: settled,
          ...(waited ? { waitedSeconds: Math.round((Date.now() - startedWaiting) / 1000) } : {}),
          index: describeIndex(freshness, judgement),
          next: nextStep(settled, freshness, judgement),
          ...extra,
        });
      };

      if (args.status) {
        return report(session?.active_analyzer || job?.analyzer || null, false, job);
      }

      // One run at a time: a call while one is in flight reports that run. force replaces it.
      if (job?.state === "running" && !args.force) {
        return report(job.analyzer, false, job);
      }

      // Pick the analyzer, discovering one when none is selected yet.
      let analyzer = session?.active_analyzer;
      let discovered = false;
      if (!analyzer) {
        const discovery = await deps.discover();
        if (!discovery.selected) {
          const failed = discovery.found.find((f) => f.error);
          if (failed) throw await notInstalledError(failed.name, failed.error);
          const name = discovery.found[0]?.name ?? "cbm";
          throw new CLIError("No code analyzer is installed", ErrorCategory.USER, await installSuggestions(name));
        }
        analyzer = discovery.selected;
        discovered = true;
        await writeSession({ active_analyzer: analyzer, selected_at: new Date().toISOString() }, projectRoot);
      }

      const backend = await deps.getAnalyzer(analyzer);
      if (!backend) throw analyzerNotFoundError(analyzer);
      // Discovery has just checked it; otherwise check before starting a run that would fail.
      if (!discovered) {
        const detection = await backend.detect(projectRoot);
        if (!detection.installed) throw await notInstalledError(analyzer, detection.error);
      }

      let editedSinceIndex = false;
      if (!args.force) {
        const { judgement } = await assessIndex(projectRoot, analyzer, codebaseRoot, deps);
        if (judgement?.state === "fresh") {
          return report(analyzer, false, job, {
            ...(discovered ? { discovered: true } : {}),
            message: "The index is fresh; nothing to do. Pass force: true to re-index anyway.",
          });
        }
        editedSinceIndex = judgement?.state === "fresh-with-uncommitted-edits";
      }

      // codebase-memory-mcp indexes every file it isn't told to skip, DR's changesets and analyzer
      // state included; the run writes .cbmignore too, but doing it here lets the result say so.
      const ignoreFile = analyzer === "cbm" ? await cbmIgnoreFile(codebaseRoot, projectRoot) : undefined;

      // The uncommitted source files as the run starts, so a later check sees any change to them.
      const snapshot = await takeWorktreeSnapshot(codebaseRoot);
      const { started, job: current, replaced } = await startIndexJob({
        projectRoot,
        codebaseRoot,
        analyzer,
        // The child skips an index taken at the current HEAD unless forced; uncommitted edits need the run.
        force: args.force || editedSinceIndex,
        replaceRunning: args.force,
        spawn: deps.spawn,
        kill: deps.kill,
        drCommand: deps.drCommand,
        isAlive: deps.isAlive,
      });
      if (started && snapshot) {
        await writeWorktreeSnapshot(projectRoot, analyzer, { ...snapshot, jobId: current.jobId }).catch(() => undefined);
      }
      return report(analyzer, started, current, {
        ...(discovered ? { discovered: true } : {}),
        ...(replaced ? { replaced } : {}),
        // Said only with a run that started (and will read it), not beside a run that did not.
        ...(ignoreFile && started ? { ignoreFile } : {}),
      });
    });
  };
}

/**
 * Adds DR's own folders to the codebase's .cbmignore (cbm-analyzer.ts ensureCbmIgnore), and says
 * what it did when it changed the file, so the agent can tell the developer about a new file to
 * commit. Undefined when nothing changed; a failure is reported, not thrown: the run still works.
 */
async function cbmIgnoreFile(codebaseRoot: string, projectRoot: string): Promise<Record<string, unknown> | undefined> {
  try {
    const { ensureCbmIgnore } = await import("../../analyzers/cbm-analyzer.js");
    const result = await ensureCbmIgnore(codebaseRoot, projectRoot);
    if (result.added.length === 0) return undefined;
    return {
      path: result.path,
      created: result.created,
      added: result.added,
      note:
        "codebase-memory-mcp indexes every file it isn't told to skip; this keeps DR's model, changesets and analyzer state out of the index. Commit the file with the code.",
    };
  } catch (error) {
    return { error: `Could not update .cbmignore, so DR's own files may be indexed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const codebaseIndexHandler = createCodebaseIndexHandler();

export const codebaseIndexTool: McpToolDefinition<typeof inputSchema> = {
  name: "codebase_index",
  description:
    "Index the project's code with the code analyzer (codebase-memory-mcp) in the background. Returns the job " +
    "({state: running|done|failed, startedAt, finishedAt, error, progress, logPath}) and the index's freshness " +
    "(index.state: fresh, fresh-with-uncommitted-edits or stale). With wait (seconds, at most " +
    `${MAX_WAIT_SECONDS}) it blocks until the run ends or the wait does; without it, it returns at once. Start with ` +
    "wait: 30, then call it with status: true, wait: 30 until job.state is done or failed. A call while a run " +
    "is in flight returns that run; force: true stops it and starts over. Skips a fresh index unless force: true. " +
    "Selects an installed analyzer if none is. Writes .dr/analyzers/, and for codebase-memory-mcp a .cbmignore at " +
    "the codebase root that keeps documentation-robotics/ and .dr/ out of the index (ignoreFile says when it changed " +
    "it); never the model.",
  inputSchema,
  handler: codebaseIndexHandler,
};
