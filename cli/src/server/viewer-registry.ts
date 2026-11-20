/**
 * Viewer registry: which `dr visualize` is serving which project.
 *
 * `dr visualize` writes its own record once its server is listening, and removes it on exit.
 * Tools that hand the human a link to the viewer (`review_open`, `project_status`) read the
 * records with `probeViewer` and reuse a running viewer instead of starting another.
 *
 * There is one record per running viewer, not one per project: two viewers can serve one project
 * (a `review_open` viewer and a `dr visualize` in a terminal), and a record that the second one
 * replaced would leave the first running with nothing pointing at it (#1237). A viewer writes
 * and removes only its own record.
 *
 * A record holds the viewer's auth token, so it lives in the user's state directory, outside
 * any repository, where it can't be committed:
 *
 *   $DR_STATE_DIR/viewers/<hash>.<pid>.json           (DR_STATE_DIR overrides, for tests)
 *   $XDG_STATE_HOME/dr/viewers/<hash>.<pid>.json      (when XDG_STATE_HOME is set)
 *   ~/.local/state/dr/viewers/<hash>.<pid>.json       (otherwise)
 *
 * `<hash>` is a hash of the project root's real path and `<pid>` the launcher's pid. A CLI before
 * 0.7.0 wrote `<hash>.json`, one per project; those are still read, for viewers it left running.
 * Each file is mode 0600 and the viewers directory 0700.
 *
 * Reading the registry sweeps it (sweepViewerRegistry): records of dead pids, markers of viewers
 * that never came up and old logs are removed. A sweep returns what it removed, with counts, and
 * each reader passes that on (`dr visualize --list`, review_open's `staleRemoved`).
 *
 * Stable API (imported by MCP tools): ViewerRecord, writeViewerRecord, readViewerRecords,
 * removeViewerRecord, removeViewerRecordSync, findRunningViewer, probeViewer, viewerUrl,
 * describePortHolder.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { getCliVersion } from "../utils/spec-version.js";
import { looksLikeViewer as processLooksLikeViewer } from "./viewer-processes.js";
import { viewerSetting } from "./viewer-settings.js";

/** Env var that points the user state directory somewhere else (tests). */
export const DR_STATE_DIR_ENV = "DR_STATE_DIR";
/** Set to "review_open" by review_open on the viewers it starts, so their records say who started them. */
export const VIEWER_STARTED_BY_ENV = "DR_VIEWER_STARTED_BY";
/** "1" has `dr visualize` exit when the process that started it is gone, like --exit-with-parent. */
export const EXIT_WITH_PARENT_ENV = "DR_VISUALIZE_EXIT_WITH_PARENT";

/** Who started a viewer: `review_open` (detached, nobody's terminal) or a person running the CLI. */
export type ViewerStarter = "review_open" | "cli";

/** One running `dr visualize`. A project can have several. */
export interface ViewerRecord {
  /** Pid of the `dr visualize` process. */
  pid: number;
  port: number;
  /** The auth token, or null when the viewer runs with --no-auth. */
  token: string | null;
  /** Real path of the project root the viewer serves. */
  projectRoot: string;
  /** ISO timestamp of when the viewer started listening. */
  startedAt: string;
  /** Whether the viewer runs with --with-changesets (DrBot may stage changes). */
  withChangesets: boolean;
  /** Version of the CLI running the viewer. Absent in a record a CLI before 0.7.0 wrote. */
  cliVersion?: string;
  /** Pid of the server process the launcher runs. */
  serverPid?: number;
  /** Who started it. Absent in a record a CLI before 0.7.0 wrote. */
  startedBy?: ViewerStarter;
  /** Hours without a browser tab or a request after which the viewer exits; absent when it never does. */
  idleExitHours?: number;
}

/** The user's dr state directory (not the project's .dr/). */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[DR_STATE_DIR_ENV];
  if (override) return resolve(override);
  const xdg = env.XDG_STATE_HOME;
  if (xdg) return join(resolve(xdg), "dr");
  return join(homedir(), ".local", "state", "dr");
}

/** Directory holding the viewer records. */
export function viewerRecordDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDir(env), "viewers");
}

/** The project root's real path, or its resolved path when it doesn't exist. */
export function canonicalProjectRoot(projectRoot: string): string {
  try {
    return realpathSync(projectRoot);
  } catch {
    return resolve(projectRoot);
  }
}

function recordKey(projectRoot: string): string {
  return createHash("sha256").update(canonicalProjectRoot(projectRoot)).digest("hex").slice(0, 24);
}

/** Path of the record of the viewer whose launcher is `pid`, for a project. */
export function viewerRecordPath(projectRoot: string, pid: number, env: NodeJS.ProcessEnv = process.env): string {
  return join(viewerRecordDir(env), `${recordKey(projectRoot)}.${pid}.json`);
}

/** Path of the one-per-project record a CLI before 0.7.0 wrote. Read, never written. */
export function legacyViewerRecordPath(projectRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(viewerRecordDir(env), `${recordKey(projectRoot)}.json`);
}

/** A record file's name: `<hash>.<pid>.json`, or `<hash>.json` from a CLI before 0.7.0. */
const RECORD_FILE = /^([0-9a-f]{24})(?:\.(\d+))?\.json$/;

/** Path of the log a viewer started by `review_open` writes its output to. */
export function viewerLogPath(projectRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(viewerRecordDir(env), `${recordKey(projectRoot)}.log`);
}

/** Path of the "a viewer is starting" marker review_open writes while a viewer it spawned loads. */
export function viewerStartingPath(projectRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(viewerRecordDir(env), `${recordKey(projectRoot)}.starting`);
}

let tempSeq = 0;

/** Temp file for one write before it is renamed into place: `<file>.<pid>.<n>.tmp`. */
function tempPathFor(path: string, pid: number): string {
  return `${path}.${pid}.${++tempSeq}.tmp`;
}

/** Removes this pid's temp files for `path` (writes it had in flight when it exited). */
function removeTempFilesSync(path: string, pid: number): void {
  const prefix = `${basename(path)}.${pid}.`;
  try {
    for (const name of readdirSync(dirname(path))) {
      if (name.startsWith(prefix) && name.endsWith(".tmp")) unlinkSync(join(dirname(path), name));
    }
  } catch {
    // No directory, or nothing to remove.
  }
}

/** Temp files older than this are left over from a writer that died mid-write. */
const STALE_TEMP_MS = 60_000;

/** Creates the viewers directory (0700) and returns it. */
export async function ensureViewerRecordDir(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const dir = viewerRecordDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return dir;
}

/**
 * Removes `.tmp` files older than a minute from the viewers directory: half-written records
 * (which may hold a token) left by a writer that was killed mid-write. Never throws.
 */
export async function removeStaleTempFiles(
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now()
): Promise<string[]> {
  const dir = viewerRecordDir(env);
  const removed: string[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!name.endsWith(".tmp")) continue;
    const path = join(dir, name);
    try {
      if (now - (await stat(path)).mtimeMs > STALE_TEMP_MS) {
        await unlink(path);
        removed.push(path);
      }
    } catch {
      // Gone already, or not ours to remove.
    }
  }
  return removed;
}

/**
 * Writes a viewer's own record (0600), at a path that names its pid, so it never replaces
 * another viewer's. The write is atomic (a temp file renamed into place), so a reader never
 * sees half a record; what dead viewers left behind is swept first. Returns the record's path.
 */
export async function writeViewerRecord(
  record: ViewerRecord,
  env: NodeJS.ProcessEnv = process.env,
  /** Told what the sweep removed, when it removed anything. */
  onSwept?: (swept: SweepResult) => void
): Promise<string> {
  await ensureViewerRecordDir(env);
  const swept = await sweepViewerRegistry({ env }).catch(() => null);
  if (swept && swept.removed.length > 0) onSwept?.(swept);
  const path = viewerRecordPath(record.projectRoot, record.pid, env);
  const stored: ViewerRecord = { ...record, projectRoot: canonicalProjectRoot(record.projectRoot) };
  const temp = tempPathFor(path, process.pid);
  try {
    await writeFile(temp, JSON.stringify(stored, null, 2) + "\n", { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return path;
}

function parseRecord(text: string): ViewerRecord | null {
  try {
    const data = JSON.parse(text);
    if (
      data &&
      typeof data === "object" &&
      Number.isInteger(data.pid) &&
      Number.isInteger(data.port) &&
      (typeof data.token === "string" || data.token === null) &&
      typeof data.projectRoot === "string"
    ) {
      return {
        pid: data.pid,
        port: data.port,
        token: data.token,
        projectRoot: data.projectRoot,
        startedAt: typeof data.startedAt === "string" ? data.startedAt : "",
        withChangesets: data.withChangesets === true,
        ...(typeof data.cliVersion === "string" ? { cliVersion: data.cliVersion } : {}),
        ...(Number.isInteger(data.serverPid) ? { serverPid: data.serverPid } : {}),
        ...(data.startedBy === "review_open" || data.startedBy === "cli" ? { startedBy: data.startedBy } : {}),
        ...(typeof data.idleExitHours === "number" && data.idleExitHours > 0
          ? { idleExitHours: data.idleExitHours }
          : {}),
      };
    }
  } catch {
    // Unparseable: treated as no record.
  }
  return null;
}

/** A record file in the viewers directory: its path and what it holds (null when unreadable). */
interface RecordFile {
  path: string;
  /** The project hash in the file's name. */
  key: string;
  record: ViewerRecord | null;
}

/** Every record file in the viewers directory, or only one project's. */
async function readRecordFiles(env: NodeJS.ProcessEnv, projectRoot?: string): Promise<RecordFile[]> {
  const dir = viewerRecordDir(env);
  const key = projectRoot === undefined ? undefined : recordKey(projectRoot);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: RecordFile[] = [];
  for (const name of names.sort()) {
    const match = RECORD_FILE.exec(name);
    if (!match || (key !== undefined && match[1] !== key)) continue;
    const path = join(dir, name);
    const text = await readFile(path, "utf8").catch(() => null);
    if (text === null) continue; // Removed since the listing.
    files.push({ path, key: match[1], record: parseRecord(text) });
  }
  return files;
}

function recordFilesSync(env: NodeJS.ProcessEnv, projectRoot: string): RecordFile[] {
  const dir = viewerRecordDir(env);
  const key = recordKey(projectRoot);
  const files: RecordFile[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of names) {
    const match = RECORD_FILE.exec(name);
    if (!match || match[1] !== key) continue;
    const path = join(dir, name);
    try {
      files.push({ path, key, record: parseRecord(readFileSync(path, "utf8")) });
    } catch {
      // Removed since the listing.
    }
  }
  return files;
}

/**
 * A project's viewer records as written (one per viewer, plus the single record a CLI before
 * 0.7.0 wrote), without checking that the viewers still run. Unreadable files are left out.
 */
export async function readViewerRecords(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ViewerRecord[]> {
  const root = canonicalProjectRoot(projectRoot);
  const records: ViewerRecord[] = [];
  for (const file of await readRecordFiles(env, projectRoot)) {
    if (file.record && file.record.projectRoot === root) records.push(file.record);
  }
  return records;
}

export interface RemoveViewerRecordOptions {
  /** Remove only this viewer's record (so a viewer never removes another's). Without it, all of the project's. */
  pid?: number;
  env?: NodeJS.ProcessEnv;
}

/** Whether a record file is the one to remove: any of the project's, or the given pid's. */
function isRecordOf(file: RecordFile, pid: number | undefined): boolean {
  return pid === undefined || file.record?.pid === pid;
}

/** Removes a project's viewer records, or one viewer's. Missing is fine. Returns the paths removed. */
export async function removeViewerRecord(
  projectRoot: string,
  options: RemoveViewerRecordOptions = {}
): Promise<string[]> {
  const env = options.env ?? process.env;
  const removed: string[] = [];
  for (const file of await readRecordFiles(env, projectRoot)) {
    if (!isRecordOf(file, options.pid)) continue;
    try {
      await unlink(file.path);
      removed.push(file.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return removed;
}

/** Synchronous removeViewerRecord, for a process "exit" handler. Never throws. */
export function removeViewerRecordSync(projectRoot: string, options: RemoveViewerRecordOptions = {}): void {
  const env = options.env ?? process.env;
  const pid = options.pid ?? process.pid;
  // A write this process had in flight when it exited.
  removeTempFilesSync(viewerRecordPath(projectRoot, pid, env), pid);
  try {
    for (const file of recordFilesSync(env, projectRoot)) {
      if (isRecordOf(file, options.pid)) unlinkSync(file.path);
    }
  } catch {
    // Best effort at exit; the next read of the registry sweeps stale records anyway.
  }
}

/** Whether a process with this pid exists (EPERM means it exists but belongs to someone else). */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** What a viewer's health check says. */
export interface ViewerHealth {
  status: "ok" | "degraded";
  /** Version of the CLI serving the viewer. Absent before 0.6.0, which did not report it. */
  cliVersion?: string;
}

/** A dr viewer's answer to its health check on this port, or null when nothing answers as one. */
export async function viewerHealth(port: number, timeoutMs = 1500): Promise<ViewerHealth | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const body = (await response.json()) as { status?: unknown; cliVersion?: unknown };
    if (body?.status !== "ok" && body?.status !== "degraded") return null;
    return { status: body.status, ...(typeof body.cliVersion === "string" ? { cliVersion: body.cliVersion } : {}) };
  } catch {
    return null;
  }
}

/** Whether a dr viewer answers its health check on this port. */
export async function viewerAnswers(port: number, timeoutMs = 1500): Promise<boolean> {
  return (await viewerHealth(port, timeoutMs)) !== null;
}

export interface SweepViewerRegistryOptions {
  env?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to isProcessAlive. */
  isAlive?: (pid: number) => boolean;
  now?: number;
}

/** What a sweep of the viewers directory removed. */
export interface SweepResult {
  /** Every path removed. */
  removed: string[];
  /** Records of viewers that are gone (dead pid, a pid another program holds, or unreadable). */
  records: number;
  /** "Starting" markers of viewers that never came up. */
  markers: number;
  /** Logs of viewers gone longer than the keep period (DR_VIEWER_LOG_KEEP_DAYS). */
  logs: number;
  /** Half-written temp files a writer left when it was killed. */
  tempFiles: number;
}

/** A sweep that removed nothing. */
export function emptySweep(): SweepResult {
  return { removed: [], records: 0, markers: 0, logs: 0, tempFiles: 0 };
}

/** Adds one sweep's removals to another's. */
export function addSweep(into: SweepResult, more: SweepResult): SweepResult {
  into.removed.push(...more.removed);
  into.records += more.records;
  into.markers += more.markers;
  into.logs += more.logs;
  into.tempFiles += more.tempFiles;
  return into;
}

/** A sweep's removals in words ("2 stale records and 1 old log"), or "" when it removed nothing. */
export function describeSweep(sweep: SweepResult): string {
  const part = (count: number, one: string, many: string) => (count === 0 ? [] : [`${count} ${count === 1 ? one : many}`]);
  const parts = [
    ...part(sweep.records, "stale record", "stale records"),
    ...part(sweep.markers, "marker of a viewer that never started", "markers of viewers that never started"),
    ...part(sweep.logs, "old log", "old logs"),
    ...part(sweep.tempFiles, "leftover temp file", "leftover temp files"),
  ];
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Removes what dead viewers left in the viewers directory: records whose pid is dead or that
 * cannot be read, "starting" markers of dead pids, logs of viewers gone longer than the keep
 * period (DR_VIEWER_LOG_KEEP_DAYS, default 7), and stale temp files. Run whenever the registry is
 * read. Returns what it removed, with a count of each kind; never throws.
 */
export async function sweepViewerRegistry(options: SweepViewerRegistryOptions = {}): Promise<SweepResult> {
  const env = options.env ?? process.env;
  const isAlive = options.isAlive ?? isProcessAlive;
  const now = options.now ?? Date.now();
  const dir = viewerRecordDir(env);
  const logKeepMs = viewerSetting("logKeepDays", env) * 24 * 60 * 60 * 1000;
  const result = emptySweep();
  result.removed = await removeStaleTempFiles(env, now);
  result.tempFiles = result.removed.length;
  const drop = async (path: string, kind: "records" | "markers" | "logs") => {
    try {
      await unlink(path);
      result.removed.push(path);
      result[kind]++;
    } catch {
      // Gone already, or not ours to remove.
    }
  };

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return result;
  }

  // Projects (by hash) that still have a viewer running or starting: their logs are kept.
  const live = new Set<string>();
  for (const name of names) {
    const path = join(dir, name);
    const record = RECORD_FILE.exec(name);
    if (record) {
      const text = await readFile(path, "utf8").catch(() => null);
      if (text === null) continue;
      const parsed = parseRecord(text);
      if (parsed && isAlive(parsed.pid)) live.add(record[1]);
      else await drop(path, "records");
    } else if (name.endsWith(".starting")) {
      let pid: unknown;
      try {
        pid = JSON.parse(await readFile(path, "utf8")).pid;
      } catch {
        pid = undefined;
      }
      if (typeof pid === "number" && Number.isInteger(pid) && isAlive(pid)) live.add(name.slice(0, -".starting".length));
      else await drop(path, "markers");
    }
  }
  for (const name of names) {
    if (!name.endsWith(".log") || live.has(name.slice(0, -".log".length))) continue;
    const path = join(dir, name);
    try {
      if (now - (await stat(path)).mtimeMs > logKeepMs) await drop(path, "logs");
    } catch {
      // Gone already.
    }
  }
  return result;
}

/** Every viewer record whose process is alive, across projects, after a sweep, and what the sweep removed. */
export async function listViewerRecords(
  options: SweepViewerRegistryOptions = {}
): Promise<{ records: ViewerRecord[]; swept: SweepResult }> {
  const env = options.env ?? process.env;
  const isAlive = options.isAlive ?? isProcessAlive;
  const swept = await sweepViewerRegistry(options);
  const records: ViewerRecord[] = [];
  for (const file of await readRecordFiles(env)) {
    if (file.record && isAlive(file.record.pid)) records.push(file.record);
  }
  return { records, swept };
}

export interface FindRunningViewerOptions {
  env?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to isProcessAlive. */
  isAlive?: (pid: number) => boolean;
  /** Injected for tests; defaults to viewerHealth. Called with the probe's timeout. */
  health?: (port: number, timeoutMs: number) => Promise<ViewerHealth | null>;
  /** Injected for tests, when the CLI version does not matter: whether a viewer answers on the port. */
  answers?: (port: number, timeoutMs: number) => Promise<boolean>;
  /**
   * Whether a live pid that does not answer is still a viewer (true), another program that got
   * the pid after the viewer died (false), or unknown (null). Defaults to its command line.
   */
  looksLikeViewer?: (pid: number) => boolean | null;
  /** The CLI version to prefer when several viewers run (default: this CLI's). */
  cliVersion?: string;
  /** First health probe's timeout (default: DR_VIEWER_HEALTH_TIMEOUT_MS, 1.5s). */
  probeTimeoutMs?: number;
  /** The second probe's timeout, when no viewer answered the first (default: DR_VIEWER_HEALTH_RETRY_TIMEOUT_MS, 5s). */
  retryTimeoutMs?: number;
}

/**
 * What the registry knows about a project's viewers:
 * - `none`: no record, or only stale ones (pid dead, or reused by another program), which are removed.
 * - `running`: a viewer's pid is alive and its server answers its health check. With several, the
 *   one to reuse: on the caller's CLI version first, then with changeset mode, then the oldest.
 *   `cliVersion` is what its health check reported (absent before 0.6.0).
 * - `unreachable`: a pid is alive but no server answered, twice. The record is kept: the viewer
 *   may only be busy, and a second viewer for the project would be wrong.
 *
 * `swept` is there when reading the registry removed something (any project's): what, and how many.
 */
export type ViewerProbe = (
  | { state: "none" }
  | { state: "running"; record: ViewerRecord; cliVersion?: string }
  | { state: "unreachable"; record: ViewerRecord }
) & { swept?: SweepResult };

/** Oldest first; a record with no start time sorts last. */
function byStartedAt(a: ViewerRecord, b: ViewerRecord): number {
  if (a.startedAt === b.startedAt) return a.pid - b.pid;
  if (!a.startedAt) return 1;
  if (!b.startedAt) return -1;
  return a.startedAt < b.startedAt ? -1 : 1;
}

/** Checks a project's viewer records against their processes and health checks. */
export async function probeViewer(projectRoot: string, options: FindRunningViewerOptions = {}): Promise<ViewerProbe> {
  const env = options.env ?? process.env;
  const isAlive = options.isAlive ?? isProcessAlive;
  const answers = options.answers;
  const health: (port: number, timeoutMs: number) => Promise<ViewerHealth | null> =
    options.health ??
    (answers ? async (port, timeoutMs) => ((await answers(port, timeoutMs)) ? { status: "ok" } : null) : viewerHealth);
  const preferred = options.cliVersion ?? getCliVersion();

  const swept = await sweepViewerRegistry({ env, isAlive });
  const sweptPart = () => (swept.removed.length > 0 ? { swept } : {});
  const records = (await readViewerRecords(projectRoot, env)).filter((record) => isAlive(record.pid));
  if (records.length === 0) return { state: "none", ...sweptPart() };

  const probe = (timeoutMs: number, candidates: ViewerRecord[]) =>
    Promise.all(candidates.map(async (record) => ({ record, health: await health(record.port, timeoutMs) })));
  let probed = await probe(options.probeTimeoutMs ?? viewerSetting("healthTimeoutMs", env), records);
  const silent = probed.filter((entry) => !entry.health).map((entry) => entry.record);
  if (silent.length === records.length) {
    // Nothing answered: give a busy viewer longer before calling it unreachable.
    probed = await probe(options.retryTimeoutMs ?? viewerSetting("healthRetryTimeoutMs", env), silent);
  }

  const running = probed.filter((entry) => entry.health);
  if (running.length > 0) {
    const rank = (entry: (typeof running)[number]) =>
      (entry.health?.cliVersion === preferred ? 0 : 2) + (entry.record.withChangesets ? 0 : 1);
    running.sort((a, b) => rank(a) - rank(b) || byStartedAt(a.record, b.record));
    const best = running[0];
    return {
      state: "running",
      record: best.record,
      ...(best.health?.cliVersion ? { cliVersion: best.health.cliVersion } : {}),
      ...sweptPart(),
    };
  }

  // Alive and silent. A pid that now belongs to another program is not a viewer that is busy:
  // the viewer died and the pid was reused (every record after a reboot), so its record goes.
  const looksLikeViewer = options.looksLikeViewer ?? processLooksLikeViewer;
  const stuck: ViewerRecord[] = [];
  for (const record of silent) {
    if (looksLikeViewer(record.pid) === false) {
      const removed = await removeViewerRecord(projectRoot, { env, pid: record.pid });
      swept.removed.push(...removed);
      swept.records += removed.length;
    } else stuck.push(record);
  }
  if (stuck.length === 0) return { state: "none", ...sweptPart() };
  return { state: "unreachable", record: stuck.sort(byStartedAt)[0], ...sweptPart() };
}

/**
 * The viewer serving this project, or null. A record counts only when its pid is alive and the
 * server answers its health check. A record whose pid is dead is removed; one whose pid is alive
 * but doesn't answer is kept (probeViewer tells the two apart).
 */
export async function findRunningViewer(
  projectRoot: string,
  options: FindRunningViewerOptions = {}
): Promise<ViewerRecord | null> {
  const probe = await probeViewer(projectRoot, options);
  return probe.state === "running" ? probe.record : null;
}

/** A viewer review_open spawned that has not recorded itself yet. */
export interface ViewerStarting {
  pid: number;
  startedAt: string;
  logPath?: string;
}

/** Marks that a viewer is starting for the project (0600), so other callers wait for it. */
export async function writeViewerStarting(
  projectRoot: string,
  starting: ViewerStarting,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await ensureViewerRecordDir(env);
  const path = viewerStartingPath(projectRoot, env);
  const temp = tempPathFor(path, process.pid);
  await writeFile(temp, JSON.stringify(starting) + "\n", { mode: 0o600 });
  await rename(temp, path);
}

/** The viewer starting for the project while its pid is alive; a dead one's marker is removed. */
export async function readViewerStarting(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  isAlive: (pid: number) => boolean = isProcessAlive
): Promise<ViewerStarting | null> {
  const path = viewerStartingPath(projectRoot, env);
  let data: ViewerStarting;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") await unlink(path).catch(() => {});
    return null;
  }
  if (!Number.isInteger(data?.pid) || !isAlive(data.pid)) {
    await unlink(path).catch(() => {});
    return null;
  }
  return data;
}

/** Removes the starting marker (only this pid's, when given). */
export async function removeViewerStarting(
  projectRoot: string,
  options: { pid?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<void> {
  const env = options.env ?? process.env;
  const path = viewerStartingPath(projectRoot, env);
  if (options.pid !== undefined) {
    try {
      const data = JSON.parse(await readFile(path, "utf8")) as ViewerStarting;
      if (data.pid !== options.pid) return;
    } catch {
      return;
    }
  }
  await unlink(path).catch(() => {});
}

/** The live dr viewers the registry knows of on this port (any project). */
export async function viewersOnPort(
  port: number,
  env: NodeJS.ProcessEnv = process.env,
  isAlive: (pid: number) => boolean = isProcessAlive
): Promise<ViewerRecord[]> {
  const found: ViewerRecord[] = [];
  for (const file of await readRecordFiles(env).catch(() => [])) {
    if (file.record && file.record.port === port && isAlive(file.record.pid)) found.push(file.record);
  }
  return found;
}

/**
 * Says what holds a port, for an error a person reads: another project's dr viewer (from the
 * registry), else the listening process `lsof` names, else "another program". Never throws.
 */
export async function describePortHolder(port: number, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const viewers = await viewersOnPort(port, env).catch(() => []);
  if (viewers.length > 0) {
    const viewer = viewers[0];
    return `the dr viewer for ${viewer.projectRoot} (pid ${viewer.pid})`;
  }
  try {
    const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], {
      encoding: "utf8",
      timeout: 2000,
    });
    const lines = (result.stdout ?? "").split("\n");
    const pid = lines.find((line) => line.startsWith("p"))?.slice(1);
    const command = lines.find((line) => line.startsWith("c"))?.slice(1);
    if (pid) return `${command ? `${command} ` : "a process "}(pid ${pid})`;
  } catch {
    // No lsof: fall through.
  }
  return "another program";
}

export interface ViewerUrlOptions {
  /** Open this changeset in the viewer's changeset overlay. */
  changesetId?: string;
}

/**
 * Link into a running viewer. The viewer reads the token from the query string before the hash
 * (`/?token=...#/route`), stores it and drops it from the address bar; the route and its search
 * params go in the hash. Without auth there is no token.
 */
export function viewerUrl(record: Pick<ViewerRecord, "port" | "token">, options: ViewerUrlOptions = {}): string {
  const query = record.token ? `?token=${encodeURIComponent(record.token)}` : "";
  const route = options.changesetId
    ? `#/changesets/list?changeset=${encodeURIComponent(options.changesetId)}`
    : "";
  return `http://localhost:${record.port}/${query}${route}`;
}
