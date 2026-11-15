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
 * `markIndexJobPhase`, `finishIndexJob`, `recordIndexJobFill` and `INDEX_JOB_TIMEOUT_MS` (the child).
 *
 * The Tier-1 cache fill (docs/analyzers/TIER1_DESIGN.md section 4.4): when the checkout opted in,
 * the child goes on after the index with the `classifying` phase. The record is `done` as soon as
 * the index is (so the codebase tools use it at once); `progress.phase` is `classifying` and
 * `tier1` carries the fill's progress until it ends. Without the opt-in there is no `tier1` and
 * the record is as it always was.
 */

import { closeSync, openSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import type { IndexResult } from "./types.js";
import type { Tier1Fill, Tier1Warming } from "./classifier/types.js";
import { readIndexMeta } from "./session-state.js";
import { FileLock } from "../utils/file-lock.js";
import { resolveDrCommand, type DrCommand } from "../coding-agents/drbot-mcp.js";

/** File name of the job record, under `.dr/analyzers/`. */
export const INDEX_JOB_FILE = "index-job.json";
/** File name of the child's combined stdout and stderr, under `.dr/analyzers/`. */
export const INDEX_JOB_LOG_FILE = "index-job.log";

export type IndexJobState = "running" | "done" | "failed";

/**
 * How far a run has got. The analyzer (codebase-memory-mcp) reports nothing while it indexes, so
 * this is the phase only: `starting` (the child is booting), `indexing` (the analyzer is
 * indexing), then `done` or `failed`; after a done index, `classifying` while the Tier-1 cache
 * fill runs (the record's `tier1` has its progress), then `done` again.
 */
export interface IndexJobProgress {
  phase: "starting" | "indexing" | "classifying" | "done" | "failed";
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
  /**
   * The Tier-1 cache fill after the index, when the checkout opted in (absent otherwise). Its
   * state never changes the record's: a fill that stops, is cancelled or fails leaves the index done.
   */
  tier1?: Tier1Fill;
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

/** How long a fill's liveness check is believed, so a status view polled often runs `ps` rarely. */
export const FILL_LIVENESS_TTL_MS = 3000;
const fillLiveness = new Map<string, { alive: boolean; at: number }>();

/**
 * Whether a running fill's process is still the job's: {@link jobStillRunning}, remembered for
 * {@link FILL_LIVENESS_TTL_MS} per pid and job when no `isAlive` is given (the real `ps` check).
 */
function fillStillRunning(job: IndexJob, options: ReadIndexJobOptions): boolean {
  if (options.isAlive || job.pid === null) return jobStillRunning(job, options);
  const key = `${job.pid}:${job.jobId}`;
  const memo = fillLiveness.get(key);
  if (memo && Date.now() - memo.at < FILL_LIVENESS_TTL_MS) return memo.alive;
  const alive = jobStillRunning(job, options);
  fillLiveness.set(key, { alive, at: Date.now() });
  if (fillLiveness.size > 32) fillLiveness.delete(fillLiveness.keys().next().value!);
  return alive;
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
  if (job && job.state !== "running" && job.tier1?.state === "running") {
    // A fill still marked running after the index: believed while its process is the job's.
    if (fillStillRunning(job, options)) return job;
    const latest = await readRawIndexJob(projectRoot);
    if (!latest || latest.jobId !== job.jobId || latest.tier1?.state !== "running") return latest;
    return deadFill(latest);
  }
  if (!job || job.state !== "running") return job;
  if (jobStillRunning(job, options)) return job;
  // The child writes its outcome and then exits, so it may have finished between the read above
  // and the liveness check, or a new run may have replaced it. Read again before calling it dead.
  const latest = await readRawIndexJob(projectRoot);
  if (!latest) return deadIndexJob(job);
  if (latest.state !== "running") return latest;
  // A newer run gets its own liveness check.
  if (latest.jobId !== job.jobId && jobStillRunning(latest, options)) return latest;
  return deadIndexJob(latest);
}

/** A run recorded as `running` whose process is gone, reported as `failed`. */
function deadIndexJob(job: IndexJob): IndexJob {
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

/** A fill recorded as running whose process is gone, reported as failed (the index stays done). */
function deadFill(job: IndexJob): IndexJob {
  const now = new Date().toISOString();
  return {
    ...job,
    tier1: {
      ...job.tier1!,
      state: "failed",
      reason: `The index process (pid ${job.pid}) exited during the Tier-1 cache fill; what it asked is cached. See ${job.logPath}.`,
      finishedAt: job.tier1!.finishedAt ?? job.tier1!.updatedAt ?? now,
    },
    progress: { phase: "done", updatedAt: job.progress?.updatedAt ?? now },
  };
}

/** Whether a job's Tier-1 cache fill is running (after `readIndexJob`'s liveness check). */
export function fillRunning(job: IndexJob | null | undefined): job is IndexJob & { tier1: Tier1Fill } {
  return !!job && job.state === "done" && job.tier1?.state === "running";
}

/** A running fill's progress, for `warming` (TIER1_DESIGN.md section 4.4); null when none runs. */
export function warmingOf(job: IndexJob | null | undefined): Tier1Warming | null {
  if (!fillRunning(job)) return null;
  return {
    jobId: job.jobId,
    startedAt: job.tier1.startedAt,
    cards: job.tier1.cards,
    costUsd: job.tier1.costUsd,
    ...(job.tier1.etaSeconds !== undefined ? { etaSeconds: job.tier1.etaSeconds } : {}),
  };
}

/**
 * The Tier-1 cache fill running for a project and analyzer, or null: what `warming` reads
 * (`codebase_extract`, `project_status`, `tier1_status`, `GET /api/tier1`). Read-only.
 */
export async function runningFill(
  projectRoot: string,
  analyzer: string,
  options: ReadIndexJobOptions = {}
): Promise<Tier1Warming | null> {
  try {
    const job = await readIndexJob(projectRoot, options);
    return job && job.analyzer === analyzer ? warmingOf(job) : null;
  } catch {
    return null;
  }
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
      ...(isFill(parsed.tier1) ? { tier1: parsed.tier1 } : {}),
    };
  } catch {
    // A half-written or hand-edited record is treated as no record.
    return null;
  }
}

const FILL_STATES = new Set(["running", "done", "stopped", "cancelled", "skipped", "failed"]);

function isFill(v: unknown): v is Tier1Fill {
  return !!v && typeof v === "object" && FILL_STATES.has((v as Tier1Fill).state) && typeof (v as Tier1Fill).startedAt === "string";
}

/** Writes the record atomically (temp file, then rename), so a reader never sees half of it. */
function writeIndexJobSync(projectRoot: string, job: IndexJob): void {
  mkdirSync(analyzersDir(projectRoot), { recursive: true });
  const target = indexJobPath(projectRoot);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(job, null, 2), "utf-8");
  renameSync(temp, target);
}

/**
 * Runs `fn` holding the record's lock, so a read-check-write of the record (the child's updates,
 * a new run replacing the last) can't interleave with another process's. Held for file work and a
 * spawn only, never across a network call.
 */
async function withRecordLock<T>(projectRoot: string, fn: () => Promise<T>): Promise<T> {
  mkdirSync(analyzersDir(projectRoot), { recursive: true });
  return new FileLock(indexJobPath(projectRoot)).withLock(fn, { timeout: 10_000 });
}

/** Applies `patch` to the record if it is still the run `jobId`. Returns whether it did. */
async function updateIndexJob(
  projectRoot: string,
  jobId: string,
  patch: (job: IndexJob) => Partial<IndexJob>
): Promise<boolean> {
  return withRecordLock(projectRoot, async () => {
    const job = await readRawIndexJob(projectRoot);
    if (!job || job.jobId !== jobId) return false;
    writeIndexJobSync(projectRoot, { ...job, ...patch(job) });
    return true;
  });
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
  outcome: { result: IndexResult | null; tier1?: Tier1Fill } | { error: string }
): Promise<boolean> {
  return withRecordLock(projectRoot, async () => {
    const now = new Date().toISOString();
    const job = await readRawIndexJob(projectRoot);
    if (!job || job.jobId !== jobId || job.state !== "running") return false;
    const done = "result" in outcome;
    // With a fill to follow (the checkout opted in), the record says so in this same write: no
    // reader ever sees the index done without the fill that this process goes on to run.
    const fill = done && outcome.tier1 ? outcome.tier1 : null;
    writeIndexJobSync(projectRoot, {
      ...job,
      state: done ? "done" : "failed",
      finishedAt: now,
      error: done ? null : outcome.error,
      result: done ? outcome.result : null,
      progress: { phase: fill?.state === "running" ? "classifying" : done ? "done" : "failed", updatedAt: now },
      ...(fill ? { tier1: fill } : {}),
    });
    return true;
  });
}

/**
 * Child side: records the Tier-1 cache fill (after the index is done) and its phase:
 * `classifying` while it runs, `done` once it ends. Only the run `jobId`'s record is changed:
 * false means the record now belongs to another run (or is gone), and the fill must stop.
 */
export async function recordIndexJobFill(projectRoot: string, jobId: string, fill: Tier1Fill): Promise<boolean> {
  return updateIndexJob(projectRoot, jobId, () => ({
    tier1: fill,
    progress: { phase: fill.state === "running" ? "classifying" : "done", updatedAt: new Date().toISOString() },
  }));
}

/**
 * Stops the Tier-1 cache fill of the last run, if one is running (`codebase_index` with
 * `cancelFill: true`): its process gets SIGTERM, ends the fill (nothing more is asked, what was
 * asked stays cached and recorded) and records it `cancelled` itself. Returns the job as it was,
 * or null when no fill was running. The index is untouched.
 */
export async function cancelIndexJobFill(
  projectRoot: string,
  options: { isAlive?: (pid: number) => boolean; kill?: (pid: number, signal: NodeJS.Signals) => void } = {}
): Promise<IndexJob | null> {
  const job = await readIndexJob(projectRoot, options.isAlive ? { isAlive: options.isAlive } : {});
  if (!fillRunning(job) || job.pid === null) return null;
  stopIndexJobProcess(job.pid, options.kill);
  return job;
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
  /** False: no Tier-1 cache fill after this run's index (`codebase_index` with `tier1: false`). */
  tier1Fill?: boolean;
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
  // Across processes too (two MCP servers on one project): the check of the last run, the stop
  // of a running one and the new record happen under the record's lock.
  return withRecordLock(options.projectRoot, () => startIndexJobLocked(options));
}

async function startIndexJobLocked(options: StartIndexJobOptions): Promise<StartIndexJobResult> {
  const { projectRoot, analyzer } = options;
  const current = await readIndexJob(projectRoot, { isAlive: options.isAlive });
  let replaced: IndexJob | undefined;
  if (fillRunning(current) && current.pid !== null) {
    // The last run's index is done and its Tier-1 cache fill still runs: this run's fill takes
    // over (what that one asked is cached), so two fills never run at once.
    stopIndexJobProcess(current.pid, options.kill);
    const now = new Date().toISOString();
    replaced = {
      ...current,
      tier1: {
        ...current.tier1,
        state: "cancelled",
        stoppedBy: "cancelled",
        reason:
          options.tier1Fill === false
            ? "stopped: a new index run started, without a fill (tier1: false); what was asked is cached"
            : "stopped: a new index run started, whose fill carries on from the cache",
        finishedAt: now,
      },
      progress: { phase: "done", updatedAt: now },
    };
  } else if (current?.state === "running") {
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
  if (options.tier1Fill === false) args.push("--no-tier1-fill");

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
  // A Tier-1 cache fill the child left running (killed during it) failed; the index stays done.
  await updateIndexJob(projectRoot, jobId, (recorded) => {
    if (recorded.state !== "done" || recorded.tier1?.state !== "running") return {};
    const dead = deadFill(recorded);
    return { tier1: dead.tier1, progress: dead.progress };
  });
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
