/**
 * Background codebase index jobs.
 *
 * `codebase_index` (MCP) starts `dr analyzer index` in a detached child process and returns at
 * once; indexing a large codebase can outlast an MCP call. The run is recorded in
 * `.dr/analyzers/index-job.json`, and its output goes to `.dr/analyzers/index-job.log`. The child
 * marks the record done or failed when it finishes (see the `--job` option of `dr analyzer
 * index`), so the record outlives the MCP call and the MCP server.
 *
 * Public API (stable; `project_status` reads it):
 * - `readIndexJob(projectRoot)`: the last run, or null. A record still marked `running` whose
 *   process has died is returned as `failed`.
 * - `IndexJob`, `IndexJobState`, `IndexJobProgress`: the record's shape.
 * - `indexJobPath(projectRoot)`, `indexJobLogPath(projectRoot)`: where the files live.
 *
 * Internal to the CLI: `startIndexJob` and `stopIndexJobProcess` (the MCP tool),
 * `markIndexJobPhase`, `finishIndexJob` and `INDEX_JOB_TIMEOUT_MS` (the child).
 */

import { closeSync, openSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import type { IndexResult } from "./types.js";
import { readIndexMeta } from "./session-state.js";
import { resolveDrCommand, type DrCommand } from "../coding-agents/drbot-mcp.js";

/** File name of the job record, under `.dr/analyzers/`. */
export const INDEX_JOB_FILE = "index-job.json";
/** File name of the child's combined stdout and stderr, under `.dr/analyzers/`. */
export const INDEX_JOB_LOG_FILE = "index-job.log";

export type IndexJobState = "running" | "done" | "failed";

/**
 * How far a run has got. The analyzer (codebase-memory-mcp) reports nothing while it indexes, so
 * this is the phase only: `starting` (the child is booting), `indexing` (the analyzer is
 * indexing), then `done` or `failed`.
 */
export interface IndexJobProgress {
  phase: "starting" | "indexing" | "done" | "failed";
  updatedAt: string;
}

/** One index run, as recorded in `.dr/analyzers/index-job.json`. */
export interface IndexJob {
  /** Record format version. */
  version: 1;
  /** Identifies the run; the child only updates a record with its own id. */
  jobId: string;
  /** The child's process id; null if it could not be started. */
  pid: number | null;
  state: IndexJobState;
  /** Analyzer the run uses (its name in the analyzer registry, e.g. "cbm"). */
  analyzer: string;
  /** Whether the run re-indexes a fresh index. */
  force: boolean;
  /** ISO 8601. */
  startedAt: string;
  /** ISO 8601; null while running, and when the process died without saying. */
  finishedAt: string | null;
  /** Why the run failed; null otherwise. */
  error: string | null;
  progress: IndexJobProgress | null;
  /** The child's combined stdout and stderr. */
  logPath: string;
  /** Node and edge counts and the indexed git HEAD, when done. */
  result: IndexResult | null;
}

function analyzersDir(projectRoot: string): string {
  return path.join(projectRoot, ".dr", "analyzers");
}

/** Path of the job record for a project. */
export function indexJobPath(projectRoot: string): string {
  return path.join(analyzersDir(projectRoot), INDEX_JOB_FILE);
}

/** Path of the job log for a project. */
export function indexJobLogPath(projectRoot: string): string {
  return path.join(analyzersDir(projectRoot), INDEX_JOB_LOG_FILE);
}

/** Whether a process is running. EPERM means it exists but belongs to someone else. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * How long a background run waits for the analyzer's index call. The analyzer client's default
 * (30 seconds) suits queries, not indexing a large codebase, which is why the run is in the
 * background at all.
 */
export const INDEX_JOB_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/**
 * How long a `running` record is believed when `ps` can't say whether its pid is still the job's
 * process (Windows, or no `ps`): a pid can be reused once the job has died.
 */
export const INDEX_JOB_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Whether `pid` is still this job's `dr analyzer index --job <jobId>` process, from its command
 * line. Null when that can't be checked (no `ps`).
 */
export function isIndexJobProcess(pid: number, jobId: string): boolean | null {
  if (process.platform === "win32") return null;
  try {
    const ps = spawnSync("ps", ["-ww", "-o", "args=", "-p", String(pid)], { encoding: "utf-8", stdio: "pipe" });
    if (ps.error) return null;
    // ps exits non-zero when there is no such process.
    if (ps.status !== 0) return false;
    return ps.stdout.includes(`--job ${jobId}`);
  } catch {
    return null;
  }
}

export interface ReadIndexJobOptions {
  /**
   * Whether a running job's pid is still its process (tests). By default the pid must be alive
   * and its command line must be the job's `dr analyzer index --job <id>`; where the command line
   * can't be read, a record older than INDEX_JOB_MAX_AGE_MS counts as dead.
   */
  isAlive?: (pid: number) => boolean;
}

/** Whether a record marked running still has its process. */
function jobStillRunning(job: IndexJob, options: ReadIndexJobOptions): boolean {
  if (job.pid === null) return false;
  if (options.isAlive) return options.isAlive(job.pid);
  if (!isProcessAlive(job.pid)) return false;
  const ownsPid = isIndexJobProcess(job.pid, job.jobId);
  if (ownsPid !== null) return ownsPid;
  return Date.now() - Date.parse(job.startedAt) < INDEX_JOB_MAX_AGE_MS;
}

/**
 * The last index run for a project, or null if there has been none (or the record is unreadable).
 *
 * A record marked `running` whose process is gone (or whose pid now runs something else) is
 * returned as `failed`, with an error that points at the log. This read never writes the record.
 */
export async function readIndexJob(projectRoot: string, options: ReadIndexJobOptions = {}): Promise<IndexJob | null> {
  const job = await readRawIndexJob(projectRoot);
  if (!job || job.state !== "running") return job;
  if (jobStillRunning(job, options)) return job;
  // The child writes its outcome and then exits, so it may have finished between the read above
  // and the liveness check. Read again before calling the run dead.
  const latest = await readRawIndexJob(projectRoot);
  if (latest && latest.jobId === job.jobId && latest.state !== "running") return latest;
  return {
    ...job,
    state: "failed",
    error:
      job.pid === null
        ? "The index process did not start."
        : `The index process (pid ${job.pid}) exited without finishing. See ${job.logPath}.`,
    progress: job.progress ? { ...job.progress, phase: "failed" } : null,
  };
}

/** The record as written, without the liveness check. */
async function readRawIndexJob(projectRoot: string): Promise<IndexJob | null> {
  let content: string;
  try {
    content = await fs.readFile(indexJobPath(projectRoot), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const parsed = JSON.parse(content) as Partial<IndexJob>;
    if (
      !parsed ||
      typeof parsed.jobId !== "string" ||
      !["running", "done", "failed"].includes(parsed.state as string) ||
      typeof parsed.startedAt !== "string"
    ) {
      return null;
    }
    return {
      version: 1,
      jobId: parsed.jobId,
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
      state: parsed.state as IndexJobState,
      analyzer: typeof parsed.analyzer === "string" ? parsed.analyzer : "",
      force: parsed.force === true,
      startedAt: parsed.startedAt,
      finishedAt: typeof parsed.finishedAt === "string" ? parsed.finishedAt : null,
      error: typeof parsed.error === "string" ? parsed.error : null,
      progress: parsed.progress ?? null,
      logPath: typeof parsed.logPath === "string" ? parsed.logPath : indexJobLogPath(projectRoot),
      result: parsed.result ?? null,
    };
  } catch {
    // A half-written or hand-edited record is treated as no record.
    return null;
  }
}

/** Writes the record atomically (temp file, then rename), so a reader never sees half of it. */
function writeIndexJobSync(projectRoot: string, job: IndexJob): void {
  mkdirSync(analyzersDir(projectRoot), { recursive: true });
  const target = indexJobPath(projectRoot);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(job, null, 2), "utf-8");
  renameSync(temp, target);
}

/** Applies `patch` to the record if it is still the run `jobId`. Returns whether it did. */
async function updateIndexJob(
  projectRoot: string,
  jobId: string,
  patch: (job: IndexJob) => Partial<IndexJob>
): Promise<boolean> {
  const job = await readRawIndexJob(projectRoot);
  if (!job || job.jobId !== jobId) return false;
  writeIndexJobSync(projectRoot, { ...job, ...patch(job) });
  return true;
}

/** Child side: records the phase the run has reached. */
export async function markIndexJobPhase(
  projectRoot: string,
  jobId: string,
  phase: IndexJobProgress["phase"]
): Promise<boolean> {
  return updateIndexJob(projectRoot, jobId, () => ({
    progress: { phase, updatedAt: new Date().toISOString() },
  }));
}

/** Child side: records how the run ended. Only a running record is changed. */
export async function finishIndexJob(
  projectRoot: string,
  jobId: string,
  outcome: { result: IndexResult | null } | { error: string }
): Promise<boolean> {
  const now = new Date().toISOString();
  const job = await readRawIndexJob(projectRoot);
  if (!job || job.jobId !== jobId || job.state !== "running") return false;
  const done = "result" in outcome;
  writeIndexJobSync(projectRoot, {
    ...job,
    state: done ? "done" : "failed",
    finishedAt: now,
    error: done ? null : outcome.error,
    result: done ? outcome.result : null,
    progress: { phase: done ? "done" : "failed", updatedAt: now },
  });
  return true;
}

/** Stops a job's process and its children (the analyzer): its process group, else the pid. */
export function stopIndexJobProcess(pid: number, kill: (pid: number, signal: NodeJS.Signals) => void = process.kill): void {
  try {
    // The child was started detached, so it leads its own process group.
    kill(-pid, "SIGTERM");
  } catch {
    try {
      kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

/** What `startIndexJob` needs from a spawned child. */
export interface SpawnedChild {
  pid?: number;
  unref(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; detached: boolean; stdio: ["ignore", number, number]; env: NodeJS.ProcessEnv }
) => SpawnedChild;

export interface StartIndexJobOptions {
  /** Project root; pass the canonical (real) path, the one the child will find from its cwd. */
  projectRoot: string;
  analyzer: string;
  /**
   * The code to index, passed to the child as `--codebase-path`, so the child indexes the same
   * directory, spelled the same way, as the caller checks freshness and verifies against.
   */
  codebaseRoot?: string;
  force?: boolean;
  /** Stop a run in flight and start a new one, instead of returning the run in flight. */
  replaceRunning?: boolean;
  /** Spawns the child (tests). Defaults to node's spawn. */
  spawn?: SpawnFn;
  /** Sends signals (tests). Defaults to `process.kill`. */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  /** How to run this dr installation. Defaults to `resolveDrCommand()`. */
  drCommand?: DrCommand;
  isAlive?: (pid: number) => boolean;
}

export interface StartIndexJobResult {
  /** False when a run was already in flight; `job` is then that run. */
  started: boolean;
  job: IndexJob;
  /** The run in flight that this start stopped (`replaceRunning`). */
  replaced?: IndexJob;
}

/** One start at a time per project in this process, so two calls can't both start a run. */
const startLocks = new Map<string, Promise<unknown>>();

/**
 * Starts `dr analyzer index` for the project in a detached child process and returns at once.
 * If a run is already in flight, returns it instead of starting another, unless
 * `replaceRunning` is set: then it stops that run's process group and starts a new one.
 *
 * The child runs in its own process group with its output in the job log, so it survives the
 * caller returning and the caller's process exiting.
 */
export async function startIndexJob(options: StartIndexJobOptions): Promise<StartIndexJobResult> {
  const key = path.resolve(options.projectRoot);
  const previous = startLocks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => startIndexJobUnlocked(options));
  startLocks.set(key, run);
  try {
    return await run;
  } finally {
    if (startLocks.get(key) === run) startLocks.delete(key);
  }
}

async function startIndexJobUnlocked(options: StartIndexJobOptions): Promise<StartIndexJobResult> {
  const { projectRoot, analyzer } = options;
  const current = await readIndexJob(projectRoot, { isAlive: options.isAlive });
  let replaced: IndexJob | undefined;
  if (current?.state === "running") {
    if (!options.replaceRunning) return { started: false, job: current };
    // readIndexJob has just confirmed the pid is still this job's process.
    if (current.pid !== null) stopIndexJobProcess(current.pid, options.kill);
    const now = new Date().toISOString();
    replaced = {
      ...current,
      state: "failed",
      finishedAt: now,
      error: "Stopped: replaced by a forced run.",
      progress: { phase: "failed", updatedAt: now },
    };
  }

  const spawn = options.spawn ?? (nodeSpawn as unknown as SpawnFn);
  const drCommand = options.drCommand ?? resolveDrCommand();
  const jobId = randomUUID();
  const logPath = indexJobLogPath(projectRoot);
  const startedAt = new Date().toISOString();
  // --codebase-path is a global option, so it goes before the subcommand.
  const args = [
    ...drCommand.args,
    ...(options.codebaseRoot ? ["--codebase-path", options.codebaseRoot] : []),
    "analyzer",
    "index",
    "--name",
    analyzer,
    "--job",
    jobId,
  ];
  if (options.force) args.push("--force");

  mkdirSync(analyzersDir(projectRoot), { recursive: true });
  const logFd = openSync(logPath, "w");
  let child: SpawnedChild;
  try {
    child = spawn(drCommand.command, args, {
      cwd: projectRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, NO_COLOR: "1" },
    });
  } finally {
    closeSync(logFd);
  }

  const job: IndexJob = {
    version: 1,
    jobId,
    pid: child.pid ?? null,
    state: child.pid ? "running" : "failed",
    analyzer,
    force: options.force === true,
    startedAt,
    finishedAt: child.pid ? null : startedAt,
    error: child.pid ? null : `Could not start ${drCommand.command}.`,
    progress: { phase: child.pid ? "starting" : "failed", updatedAt: startedAt },
    logPath,
    result: null,
  };
  // Written synchronously, right after the spawn: the child takes far longer to boot than this.
  writeIndexJobSync(projectRoot, job);

  child.on("error", (error) => {
    const message = `Could not start the index process: ${error.message}`;
    void updateIndexJob(projectRoot, jobId, (recorded) =>
      recorded.state === "done"
        ? {}
        : {
            state: "failed",
            error: message,
            finishedAt: recorded.finishedAt ?? new Date().toISOString(),
            progress: { phase: "failed", updatedAt: new Date().toISOString() },
          }
    ).catch(() => undefined);
  });
  // The child records done or failed itself; this covers a child that exits without doing so.
  child.on("exit", (code, signal) => {
    void settleExitedJob(projectRoot, jobId, analyzer, code, signal, logPath).catch(() => undefined);
  });
  child.unref();

  return { started: job.state === "running", job, ...(replaced ? { replaced } : {}) };
}

/**
 * After the child exits: a record it left running is done if it exited cleanly (with the index
 * metadata as the result, when there is any), and failed otherwise.
 */
async function settleExitedJob(
  projectRoot: string,
  jobId: string,
  analyzer: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  logPath: string
): Promise<void> {
  if (code === 0) {
    let meta: IndexResult | null = null;
    try {
      meta = await readIndexMeta(projectRoot, analyzer);
    } catch {
      meta = null;
    }
    await finishIndexJob(projectRoot, jobId, { result: meta });
    return;
  }
  const how = signal ? `was killed (${signal})` : `exited with code ${code}`;
  await finishIndexJob(projectRoot, jobId, { error: `The index process ${how}. See ${logPath}.` });
}
