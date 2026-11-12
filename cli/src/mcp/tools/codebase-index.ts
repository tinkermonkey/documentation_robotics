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

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { strictItem } from "../strict-schema.js";
import {
  canonicalPath,
  readCrossRepoConfig,
  resolveTargetModel,
  writeCrossRepoConfig,
  type CrossRepoTarget,
} from "../../analyzers/cross-model.js";
import type { Model } from "../../core/model.js";
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
  crossRepo: z
    .union([
      z.literal(false),
      z.array(
        strictItem("A crossRepo[] item", {
          codebase: z.string().min(1).describe("Path of the other repository's root (absolute, or relative to this codebase's root)."),
          model: z
            .string()
            .min(1)
            .optional()
            .describe("The name the manifest declares for it under models:. Default: the declared model whose url is the repository's origin remote."),
          modelPath: z
            .string()
            .min(1)
            .optional()
            .describe("Where its DR model is (project root or model directory), when not in the repository itself."),
        })
      ),
    ])
    .optional()
    .describe(
      "Federation, for code that calls other repositories' services (opt-in, kept for the project until changed): the other " +
        "repositories, each a model declared under models: in the manifest. Each index run then links this code to them " +
        "(codebase-memory-mcp cross-repo-intelligence, indexing a repository it has not indexed), and codebase_extract stages " +
        "@model/... references to what their models have for the routes this code calls. false turns it off. A changed list re-indexes."
    ),
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
    return "The index is fresh. codebase_extract models the code; codebase_verify checks the model's api, data-store, technology and testing layers against the code.";
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
        // Only a project that has opted into federation hears about it.
        const crossRepo = analyzer ? await readCrossRepoConfig(projectRoot, analyzer).catch(() => null) : null;
        return jsonResult({
          projectRoot,
          analyzer,
          started,
          job: settled,
          ...(waited ? { waitedSeconds: Math.round((Date.now() - startedWaiting) / 1000) } : {}),
          index: describeIndex(freshness, judgement),
          next: nextStep(settled, freshness, judgement),
          ...(crossRepo ? { crossRepo: { targets: crossRepo.targets, ...(crossRepo.lastRun ? { lastRun: crossRepo.lastRun } : {}) } } : {}),
          ...extra,
        });
      };

      if (args.status) {
        if (args.crossRepo !== undefined) {
          throw new CLIError("crossRepo can't be combined with status: true", ErrorCategory.USER, ["Call codebase_index with crossRepo and without status"]);
        }
        return report(session?.active_analyzer || job?.analyzer || null, false, job);
      }

      // One run at a time: a call while one is in flight reports that run. force replaces it.
      if (job?.state === "running" && !args.force) {
        if (args.crossRepo !== undefined) {
          throw new CLIError("An index run is in flight, so crossRepo was not recorded", ErrorCategory.USER, [
            "Wait for it (status: true, wait: 30), then call codebase_index with crossRepo again",
          ]);
        }
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

      // Federation: record the targets; a changed list needs a run, so the pass links them.
      let crossRepoChanged = false;
      if (args.crossRepo !== undefined) {
        if (analyzer !== "cbm") {
          throw new CLIError(`crossRepo needs codebase-memory-mcp (cbm); the analyzer is ${analyzer}`, ErrorCategory.USER);
        }
        const targets = args.crossRepo === false ? [] : crossRepoTargets(model, codebaseRoot, args.crossRepo);
        const before = await readCrossRepoConfig(projectRoot, analyzer).catch(() => null);
        if (JSON.stringify(before?.targets ?? []) !== JSON.stringify(targets)) {
          await writeCrossRepoConfig(projectRoot, analyzer, targets.length ? { version: 1, targets } : null);
          crossRepoChanged = targets.length > 0;
        }
      }

      let editedSinceIndex = false;
      if (!args.force && !crossRepoChanged) {
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
        // The child skips an index taken at the current HEAD unless forced; uncommitted edits need the run,
        // and so do new cross-repo targets (the pass runs after the index).
        force: args.force || editedSinceIndex || crossRepoChanged,
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
 * The crossRepo items as configured targets: each an existing directory other than this codebase,
 * tied to a model the manifest declares (by name, or by its url matching the repository's origin).
 *
 * @throws CLIError for a missing directory, this codebase itself, an undeclared or unmatched model,
 *   or two items for one model
 */
function crossRepoTargets(
  model: Model,
  codebaseRoot: string,
  items: Array<{ codebase: string; model?: string; modelPath?: string }>
): CrossRepoTarget[] {
  const own = canonicalPath(codebaseRoot);
  const targets: CrossRepoTarget[] = [];
  for (const item of items) {
    const codebase = canonicalPath(path.resolve(codebaseRoot, item.codebase));
    if (!existsSync(codebase) || !statSync(codebase).isDirectory()) {
      throw new CLIError(`crossRepo: no directory at ${item.codebase}`, ErrorCategory.USER, ["Pass the other repository's root"]);
    }
    if (codebase === own) {
      throw new CLIError("crossRepo: that is this codebase; list the other repositories it calls", ErrorCategory.USER);
    }
    const name = resolveTargetModel(model.manifest.models, codebase, item.model);
    if (targets.some((t) => t.model.toLowerCase() === name.toLowerCase())) {
      throw new CLIError(`crossRepo: two repositories for model '${name}'`, ErrorCategory.USER, ["List each declared model once"]);
    }
    targets.push({ model: name, codebase, ...(item.modelPath ? { modelPath: canonicalPath(path.resolve(codebaseRoot, item.modelPath)) } : {}) });
  }
  return targets;
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
    "it); never the model. For code that calls other repositories, crossRepo (opt-in) links it to them so codebase_extract " +
    "can stage @model/... references.",
  inputSchema,
  handler: codebaseIndexHandler,
};
