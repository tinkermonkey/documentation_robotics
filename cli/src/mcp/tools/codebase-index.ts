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
  crossRepoRunWarnings,
  declaredTargets,
  loadCrossRepoConfig,
  resolveTargetModel,
  undeclaredTargetsWarning,
  writeCrossRepoConfig,
  type CrossRepoTarget,
} from "../../analyzers/cross-model.js";
import type { Model } from "../../core/model.js";
import { cancelIndexJobFill, fillRunning, readIndexJob, startIndexJob, type IndexJob } from "../../analyzers/index-job.js";
import { fillProgress } from "../../analyzers/classifier/status.js";
import { readSession, writeSession } from "../../analyzers/session-state.js";
import type { IndexFreshness } from "../../analyzers/active-analyzer.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolContext, type McpToolDefinition } from "./shared.js";
import {
  analyzerNotFoundError,
  assessIndex,
  assessSelectedIndex,
  canonicalRoots,
  defaultCodebaseToolDeps,
  describeIndex,
  installSuggestions,
  notInstalledError,
  takeWorktreeSnapshot,
  WAIT_FOR_INDEX,
  writeWorktreeSnapshot,
  type CodebaseToolDeps,
  type IndexAssessment,
  type IndexedFirst,
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
  tier1: z
    .literal(false)
    .optional()
    .describe(
      "false: no Tier-1 cache fill after this run's index, whatever the checkout's tier1.json says. Default: when the checkout opted in to " +
        "Tier 1, the job fills the cache after the index (job.tier1), so codebase_extract answers from it."
    ),
  cancelFill: z
    .literal(true)
    .optional()
    .describe(
      "Stop the Tier-1 cache fill running after the last index (job.tier1.state running), without re-indexing: what it asked " +
        "stays cached and its spend recorded, and job.tier1 says cancelled within seconds. Starts nothing."
    ),
  rootPath: rootPathSchema,
};

export type CodebaseIndexArgs = z.infer<z.ZodObject<typeof inputSchema>>;

const POLL = `Indexing is still running. ${WAIT_FOR_INDEX} or failed; do other work between calls if you have any.`;

/** The Tier-1 cache fill running after a done index, in a sentence for `next`. */
export function fillNote(job: IndexJob & { tier1: NonNullable<IndexJob["tier1"]> }): string {
  return (
    `Tier 1 is filling its answer cache after the index (job.tier1: ${fillProgress(job.tier1)}). ` +
    "codebase_extract can run now and answers from the cache what is there; if it returns warming, wait for the fill " +
    "(codebase_index with status: true and wait: 30, until job.tier1.state isn't running) or pass it tier1: false. codebase_index with cancelFill: true stops the fill."
  );
}

/** What the agent should do next, given the job and the index. */
function nextStep(job: IndexJob | null, freshness: IndexFreshness, judgement: IndexJudgement | null): string {
  if (job?.state === "running") return POLL;
  const step = indexStep(job, freshness, judgement);
  return fillRunning(job) && (judgement?.state ?? "stale") !== "stale" ? `${step} ${fillNote(job)}` : step;
}

function indexStep(job: IndexJob | null, freshness: IndexFreshness, judgement: IndexJudgement | null): string {
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
  // The reason says which: commits that changed source files, another analyzer version, or no code in it.
  return `The index is stale${judgement?.reason ? ` (${judgement.reason})` : ""}. Call codebase_index with wait: 30 to re-index.`;
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
 * returns the job as it is then. With `fill`, it waits on the Tier-1 cache fill after the index
 * instead (a status poll that found the index done and the fill running).
 */
async function waitForJob(
  projectRoot: string,
  job: IndexJob | null,
  deadline: number,
  deps: CodebaseToolDeps,
  signal?: AbortSignal,
  fill = false
): Promise<IndexJob | null> {
  const interval = deps.pollIntervalMs ?? 1000;
  let current = job;
  const busy = (j: IndexJob | null) => j?.state === "running" || (fill && fillRunning(j));
  while (busy(current) && Date.now() < deadline && !signal?.aborted) {
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
        // A status poll while the index is done and Tier 1's cache fill runs waits on the fill.
        const onFill = !!args.status && fillRunning(current);
        const waited = args.wait && args.wait > 0 && (current?.state === "running" || onFill);
        const startedWaiting = Date.now();
        const settled = waited ? await waitForJob(projectRoot, current, deadline, deps, context?.signal, onFill) : current;
        const { freshness, judgement } = analyzer
          ? await assessIndex(projectRoot, analyzer, codebaseRoot, deps)
          : { freshness: { indexed: false, fresh: false } as const, judgement: null };
        // Only a project that has opted into federation hears about it, or one whose file is unreadable.
        const { config: crossRepo, warning: crossRepoWarning } = analyzer
          ? await loadCrossRepoConfig(projectRoot, analyzer)
          : { config: null, warning: undefined };
        const undeclared = crossRepo ? declaredTargets(crossRepo.targets, model.manifest.models).undeclared : [];
        // The last pass: skipped or failed (and how to run it again), and targets indexed at another commit than their HEAD.
        const lastRun = crossRepoRunWarnings(crossRepo?.lastRun, deps.targetGit);
        const crossRepoWarnings = [
          ...(crossRepoWarning ? [crossRepoWarning] : []),
          ...(undeclared.length ? [undeclaredTargetsWarning(undeclared)] : []),
          ...lastRun.warnings,
        ];
        return jsonResult({
          projectRoot,
          analyzer,
          started,
          job: settled,
          ...(waited ? { waitedSeconds: Math.round((Date.now() - startedWaiting) / 1000) } : {}),
          index: describeIndex(freshness, judgement),
          next: nextStep(settled, freshness, judgement),
          ...(crossRepo || crossRepoWarnings.length
            ? {
                crossRepo: {
                  targets: crossRepo?.targets ?? [],
                  ...(crossRepo?.lastRun ? { lastRun: crossRepo.lastRun } : {}),
                  ...(undeclared.length ? { undeclared } : {}),
                  ...(lastRun.stale.length ? { stale: lastRun.stale.map(({ message: _m, ...s }) => s) } : {}),
                  ...(crossRepoWarnings.length ? { warnings: crossRepoWarnings } : {}),
                },
              }
            : {}),
          ...extra,
        });
      };

      if (args.cancelFill) {
        if (args.force || args.crossRepo !== undefined || args.status || args.tier1 === false) {
          throw new CLIError("cancelFill only stops the running fill; it can't be combined with force, crossRepo, status or tier1", ErrorCategory.USER, [
            "Call codebase_index with cancelFill: true alone",
          ]);
        }
        const stopped = await cancelIndexJobFill(projectRoot, { isAlive: deps.isAlive, kill: deps.kill });
        return report(session?.active_analyzer || job?.analyzer || null, false, job, {
          cancelFill: stopped
            ? {
                stopped: true,
                message:
                  "Sent the fill's process a stop signal: it asks nothing more, keeps what it asked cached and recorded, and records job.tier1.state cancelled within seconds. The index is untouched.",
              }
            : { stopped: false, message: "No Tier-1 cache fill is running: nothing to stop." },
        });
      }

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

      const { analyzer, discovered } = await selectAnalyzer(projectRoot, session?.active_analyzer, deps);

      // Federation: record the targets; a changed list needs a run, so the pass links them.
      let crossRepoChanged = false;
      if (args.crossRepo !== undefined) {
        if (analyzer !== "cbm") {
          throw new CLIError(`crossRepo needs codebase-memory-mcp (cbm); the analyzer is ${analyzer}`, ErrorCategory.USER);
        }
        const targets = args.crossRepo === false ? [] : crossRepoTargets(model, codebaseRoot, args.crossRepo);
        // An unreadable file is rewritten (removed for crossRepo: false), whatever it held.
        const before = await loadCrossRepoConfig(projectRoot, analyzer);
        if (before.warning || JSON.stringify(before.config?.targets ?? []) !== JSON.stringify(targets)) {
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

      const { started, job: current, replaced, ignoreFile } = await launchIndexRun(projectRoot, codebaseRoot, analyzer, deps, {
        // The child skips an index taken at the current HEAD unless forced; uncommitted edits need the run,
        // and so do new cross-repo targets (the pass runs after the index).
        force: args.force || editedSinceIndex || crossRepoChanged,
        replaceRunning: args.force,
        ...(args.tier1 === false ? { tier1Fill: false } : {}),
      });
      return report(analyzer, started, current, {
        ...(discovered ? { discovered: true } : {}),
        ...(replaced ? { replaced } : {}),
        ...(ignoreFile ? { ignoreFile } : {}),
      });
    });
  };
}

/**
 * The analyzer for a run: the selected one, checked to be installed, or the first installed one
 * discovery finds (then recorded as selected).
 *
 * @throws CLIError when no analyzer is installed, or the selected one is missing or won't start
 */
async function selectAnalyzer(
  projectRoot: string,
  selected: string | undefined,
  deps: CodebaseToolDeps
): Promise<{ analyzer: string; discovered: boolean }> {
  let analyzer = selected;
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
  return { analyzer, discovered };
}

/**
 * Starts the background index run (startIndexJob), with what goes with it: the .cbmignore check
 * for codebase-memory-mcp and the snapshot of the uncommitted source files as the run starts, so a
 * later check sees any change to them. codebase_index and indexFirst start their runs here.
 */
async function launchIndexRun(
  projectRoot: string,
  codebaseRoot: string,
  analyzer: string,
  deps: CodebaseToolDeps,
  options: { force?: boolean; replaceRunning?: boolean; tier1Fill?: false }
): Promise<{ started: boolean; job: IndexJob; replaced?: IndexJob; ignoreFile?: Record<string, unknown> }> {
  // codebase-memory-mcp indexes every file it isn't told to skip, DR's changesets and analyzer
  // state included; the run checks .cbmignore too, but doing it here lets the result say so.
  const ignoreFile = analyzer === "cbm" ? await cbmIgnoreFile(codebaseRoot, projectRoot) : undefined;
  const snapshot = await takeWorktreeSnapshot(codebaseRoot);
  const { started, job, replaced } = await startIndexJob({
    projectRoot,
    codebaseRoot,
    analyzer,
    force: options.force,
    replaceRunning: options.replaceRunning,
    ...(options.tier1Fill === false ? { tier1Fill: false } : {}),
    spawn: deps.spawn,
    kill: deps.kill,
    drCommand: deps.drCommand,
    isAlive: deps.isAlive,
  });
  if (started && snapshot) {
    await writeWorktreeSnapshot(projectRoot, analyzer, { ...snapshot, jobId: job.jobId }).catch(() => undefined);
  }
  // Said only with a run that started (and will read it), not beside a run that did not.
  return { started, job, ...(replaced ? { replaced } : {}), ...(ignoreFile && started ? { ignoreFile } : {}) };
}

/** The share of a tool's time budget that indexFirst may spend waiting for the index. */
export const INDEX_FIRST_SHARE = 0.5;

/**
 * How long indexFirst may wait for the index, for a call that started at `startedAt` and must end
 * by `callDeadline`: INDEX_FIRST_SHARE of that time, and never past codebase_index's own longest
 * wait (MAX_WAIT_SECONDS, less the time kept for the last read).
 */
export function indexFirstDeadline(startedAt: number, callDeadline: number): number {
  return startedAt + Math.min((callDeadline - startedAt) * INDEX_FIRST_SHARE, MAX_WAIT_SECONDS * 1000 - REPORT_RESERVE_MS);
}

/**
 * Before a codebase tool judges the index (codebase_extract, #1347): when the code is not indexed,
 * the index is stale by the rule (judgeIndex, which also calls an index with no code stale), or an
 * index run is in flight, it starts a run (selecting an analyzer when none is) or joins the one in
 * flight, and blocks until it ends or `deadline` passes (indexFirstDeadline). Uncommitted edits
 * never start a run: they don't make the index stale.
 *
 * Returns the index as judged at the end (`assessment`, with `uncommittedEdits` as the caller asks,
 * for requireFreshIndex to use rather than judge again), and what it did (`indexedFirst`, null when
 * the index was usable as it was). requireFreshIndex then refuses an index still stale after a run.
 *
 * @throws CLIError when the run fails (its error and log), when it is still running at the end of
 *   the wait (how to wait for it, then call `tool` again), or when no analyzer can be selected
 */
export async function indexFirst(
  roots: { projectRoot: string; codebaseRoot: string },
  deps: CodebaseToolDeps,
  options: { tool: string; deadline: number; uncommittedEdits?: boolean; signal?: AbortSignal }
): Promise<{ assessment: IndexAssessment; indexedFirst: IndexedFirst | null }> {
  const { projectRoot, codebaseRoot } = roots;
  const began = Date.now();
  const judge = () => assessSelectedIndex(projectRoot, codebaseRoot, deps, { uncommittedEdits: options.uncommittedEdits === true });
  let job = await readIndexJob(projectRoot, { isAlive: deps.isAlive });
  let why: string;
  let started = false;
  let ignoreFile: Record<string, unknown> | undefined;
  if (job?.state === "running") {
    why = `an index run was in flight (started ${job.startedAt})`;
  } else {
    const before = await judge();
    const { freshness, judgement } = before;
    if (before.analyzer && freshness.indexed && judgement && judgement.state !== "stale") return { assessment: before, indexedFirst: null };
    why = !before.analyzer || !freshness.indexed || !judgement ? "the code was not indexed" : `the index was stale: ${judgement.reason ?? "by the freshness rule"}`;
    const { analyzer } = await selectAnalyzer(projectRoot, before.analyzer ?? undefined, deps);
    // Not forced: the run's own check re-indexes a stale index (another commit, another analyzer
    // version, no code) and skips one another call has just made fresh.
    const run = await launchIndexRun(projectRoot, codebaseRoot, analyzer, deps, {});
    job = run.job;
    started = run.started;
    ignoreFile = run.ignoreFile;
  }
  const settled = await waitForJob(projectRoot, job, options.deadline, deps, options.signal);
  const seconds = Math.round((Date.now() - began) / 1000);
  const what = started ? `${options.tool} started an index run` : `${options.tool} waited for the run`;
  if (settled?.state === "running") {
    throw new CLIError(
      `${capitalized(why)}, so ${what} (job ${settled.jobId}); it was still running after ${seconds} s, as long as this call can wait`,
      ErrorCategory.USER,
      [`${WAIT_FOR_INDEX}, then call ${options.tool} again`, `Or call ${options.tool} with autoIndex: false to refuse instead of indexing first`]
    );
  }
  if (!settled || settled.state === "failed") {
    throw new CLIError(
      `${capitalized(why)}, so ${what}, and the run failed: ${settled?.error ?? "its record is gone"}`,
      ErrorCategory.USER,
      [
        ...(settled ? [`See the log at ${settled.logPath}`] : []),
        `Fix the cause, then call codebase_index with wait: 30, or call ${options.tool} again`,
      ]
    );
  }
  return {
    assessment: await judge(),
    indexedFirst: { why, jobId: settled.jobId, started, seconds, ...(ignoreFile ? { ignoreFile } : {}) },
  };
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

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
 * Keeps DR's own folders out of a codebase-memory-mcp index (cbm-analyzer.ts ensureCbmIgnore), and
 * says so when there is something to tell (#1300): DR wrote its .cbmignore and hid it from git
 * (nothing to commit), or the developer's own .cbmignore lacks DR's lines (missing: the developer
 * adds them). Undefined when nothing changed; a failure is reported, not thrown: the run still works.
 */
async function cbmIgnoreFile(codebaseRoot: string, projectRoot: string): Promise<Record<string, unknown> | undefined> {
  try {
    const { ensureCbmIgnore } = await import("../../analyzers/cbm-analyzer.js");
    const result = await ensureCbmIgnore(codebaseRoot, projectRoot);
    if (result.missing?.length) {
      return {
        path: result.path,
        missing: result.missing,
        note:
          "This .cbmignore is the developer's (tracked by git, or not written by DR), so DR left it alone, and codebase-memory-mcp " +
          `indexes DR's model, changesets and analyzer state. Ask the developer to add these lines to it and commit it: ${result.missing.join(", ")} ` +
          "(git add -f .cbmignore while it is untracked: DR's local exclude hides an untracked .cbmignore in every worktree).",
      };
    }
    if (result.added.length === 0 && !result.excludedBy) return undefined;
    return {
      path: result.path,
      created: result.created,
      added: result.added,
      ...(result.excludedBy ? { excludedBy: result.excludedBy } : {}),
      note:
        "DR's .cbmignore keeps its model, changesets and analyzer state out of codebase-memory-mcp's index. " +
        (result.excludedBy
          ? `It is hidden from git through ${result.excludedBy} (the repository's local exclude, in no commit), so the tree is unchanged as git sees it: nothing to commit.`
          : result.notInGit
            ? "The codebase is not in a git work tree, so nothing hides the file, and there is no commit to make."
            : "git already ignores it, so the tree is unchanged as git sees it: nothing to commit."),
    };
  } catch (error) {
    return { error: `Could not check .cbmignore, so DR's own files may be indexed: ${error instanceof Error ? error.message : String(error)}` };
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
    "Selects an installed analyzer if none is. Writes .dr/analyzers/; for codebase-memory-mcp it keeps documentation-robotics/ and " +
    ".dr/ out of the index with a .cbmignore at the codebase root that it hides from git through the repository's local exclude, so " +
    "the working tree is unchanged and nothing needs committing; a .cbmignore the developer tracks is never edited, and ignoreFile.missing " +
    "lists the lines it lacks for the developer to add. Never writes the model. An index with no code reads stale, and a run that " +
    "can't read what it indexed fails. For code that calls other repositories, crossRepo (opt-in) links it to them so codebase_extract " +
    "can stage @model/... references. When the checkout opted in to Tier 1, the job then fills Tier 1's answer cache " +
    "(job.progress.phase classifying, job.tier1: cards done of total, cost, estimate; within the monthly cap): job.state is done " +
    "as soon as the index is, so codebase tools can run meanwhile; tier1: false skips the fill, and cancelFill: true stops a running one.",
  inputSchema,
  handler: codebaseIndexHandler,
};
