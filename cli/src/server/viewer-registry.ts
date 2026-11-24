/**
 * Viewer registry: the per-project viewers CLI 0.7.x and earlier left running, and the one
 * question today's tools ask, "which DR process serves this farm" (`findRunningViewer`).
 *
 * Since issue 1279 (slice 4A) one central process per farm serves every project and checkout
 * (`dr serve`, `dr visualize`). It records itself in a server record (server-record.ts).
 * Nothing writes a per-project viewer record any more: this file only reads the ones older CLIs
 * left, for the central process's start-up sweep (legacy-viewer-sweep.ts) and for
 * `dr visualize --list` and `--stop --all`, which find and stop old viewers.
 *
 * A legacy record holds that viewer's auth token, so it lives in the user's state directory:
 *
 *   $DR_STATE_DIR/viewers/<hash>.<pid>.json           (DR_STATE_DIR overrides, for tests)
 *   $XDG_STATE_HOME/dr/viewers/<hash>.<pid>.json      (when XDG_STATE_HOME is set)
 *   ~/.local/state/dr/viewers/<hash>.<pid>.json       (otherwise)
 *
 * `<hash>` is a hash of the project root's real path and `<pid>` the launcher's pid. A CLI before
 * 0.7.0 wrote `<hash>.json`, one per project; those are read too.
 *
 * Reading the registry sweeps it (sweepViewerRegistry): records of dead pids, markers of viewers
 * that never came up and old logs are removed, so old records go once their processes are gone.
 *
 * (`data-store.collection.legacy-viewer-records`, `data-model.objectschema.viewer-record`)
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ServerRecord } from "../core/checkout-types.js";
import { resolveFarm, type FarmLocation } from "../core/project-registry.js";
import { isProcessAlive as processIsAlive } from "../utils/process-liveness.js";
import type { CentralHealth } from "./central-server-contract.js";
import { findRunningServer, type RunningServer } from "./server-record.js";
import { viewerSetting } from "./viewer-settings.js";

/** Env var that points the user state directory somewhere else (tests). */
export const DR_STATE_DIR_ENV = "DR_STATE_DIR";
/** Set to "review_open" by review_open on the viewers it starts, so their records say who started them. */
export const VIEWER_STARTED_BY_ENV = "DR_VIEWER_STARTED_BY";
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
  /**
   * This viewer's id, which its server also reports on GET /health: how a reader tells that the
   * viewer answering on `port` is this one and not another that took the port. Absent in a
   * record a CLI before 0.7.0 wrote.
   */
  viewerId?: string;
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
        ...(typeof data.viewerId === "string" && data.viewerId ? { viewerId: data.viewerId } : {}),
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

/**
 * Whether a viewer's process is running. An exited process that nobody has reaped (a zombie,
 * where PID 1 doesn't reap orphans) counts as gone (#1275): see utils/process-liveness.
 */
export const isProcessAlive: (pid: number) => boolean = processIsAlive;

/** What a viewer's health check says. */
export interface ViewerHealth {
  status: "ok" | "degraded";
  /** Version of the CLI serving the viewer. Absent before 0.6.0, which did not report it. */
  cliVersion?: string;
  /** The viewer's id, as its registry record has it. Since 0.7.0. */
  viewerId?: string;
  /** The server's own pid. Since 0.7.0. */
  pid?: number;
  /** The pid of the launcher that runs the server. Since 0.7.0. */
  launcherPid?: number;
  /** Browser tabs connected now. Since 0.7.0. */
  clients?: number;
}

/**
 * Whether the viewer answering on a record's port is that record's viewer:
 * - `this`: it reports the record's id.
 * - `other`: it reports a different id, or reports one where the record (from an older CLI) has
 *   none: another viewer holds the port.
 * - `unknown`: neither has an id (an older viewer and an older record), so the answer alone
 *   cannot tell.
 */
export function answeringViewer(record: ViewerRecord, health: ViewerHealth): "this" | "other" | "unknown" {
  if (record.viewerId) return health.viewerId === record.viewerId ? "this" : "other";
  return health.viewerId ? "other" : "unknown";
}

/** A dr viewer's answer to its health check on this port, or null when nothing answers as one. */
export async function viewerHealth(port: number, timeoutMs = 1500, token?: string | null): Promise<ViewerHealth | null> {
  try {
    // With the viewer's token it also names itself (viewerId, pids, open tabs); without, only its status and version.
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    if (body?.status !== "ok" && body?.status !== "degraded") return null;
    const pid = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 1 ? value : undefined);
    return {
      status: body.status,
      ...(typeof body.cliVersion === "string" ? { cliVersion: body.cliVersion } : {}),
      ...(typeof body.viewerId === "string" && body.viewerId ? { viewerId: body.viewerId } : {}),
      ...(pid(body.pid) ? { pid: pid(body.pid) } : {}),
      ...(pid(body.launcherPid) ? { launcherPid: pid(body.launcherPid) } : {}),
      ...(typeof body.clients === "number" && Number.isInteger(body.clients) && body.clients >= 0
        ? { clients: body.clients }
        : {}),
    };
  } catch {
    return null;
  }
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
  /**
   * Records this CLI cannot read whose pid is alive: left in place (a later CLI's record of a
   * running viewer, perhaps), and reported so that nothing reads their absence as "no viewer".
   */
  unreadable: string[];
}

/** A sweep that removed nothing. */
export function emptySweep(): SweepResult {
  return { removed: [], records: 0, markers: 0, logs: 0, tempFiles: 0, unreadable: [] };
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

/** Says that records were left because this CLI cannot read them, or "" when there are none. */
export function describeUnreadable(sweep: SweepResult): string {
  const count = sweep.unreadable.length;
  if (count === 0) return "";
  return (
    `${count} viewer ${count === 1 ? "record" : "records"} in the registry could not be read by this CLI and ` +
    `${count === 1 ? "belongs to a process that is" : "belong to processes that are"} still running ` +
    `(a newer CLI's viewer, perhaps): left in place, and not listed.`
  );
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
      if (parsed) {
        if (isAlive(parsed.pid)) live.add(record[1]);
        else await drop(path, "records");
        continue;
      }
      // Not a record this CLI can read. Its file name says whose it is: while that pid is alive
      // it may be a later CLI's record of a running viewer, so it stays and is reported.
      const owner = record[2] === undefined ? null : Number(record[2]);
      if (owner !== null && isAlive(owner)) {
        live.add(record[1]);
        result.unreadable.push(path);
      } else await drop(path, "records");
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
  /** Where to resolve the farm from (default: the working directory). */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Injected for tests. */
  resolveFarm?: (options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<FarmLocation>;
  /** Injected for tests; defaults to the server record (`findRunningServer`). */
  findRunningServer?: (farmRoot: string, options: { env: NodeJS.ProcessEnv }) => Promise<RunningServer | null>;
  /** Injected for tests; defaults to `/health` with the token. */
  fetchHealth?: (record: ServerRecord, token: string | null) => Promise<CentralHealth | null>;
}

/** The central process serving a farm, with what its `/health` said. */
export interface RunningCentralViewer extends RunningServer {
  health: CentralHealth;
}

/**
 * The central process serving the farm `cwd` is in: from the server record alone (its pid alive)
 * and only while its `/health` answers. Null otherwise. Per-project viewers are no longer looked
 * up: they serve nothing a link should open. Starts nothing.
 * (`application.applicationfunction.find-running-viewer`)
 */
export async function findRunningViewer(options: FindRunningViewerOptions = {}): Promise<RunningCentralViewer | null> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const farm = await (options.resolveFarm ?? resolveFarm)({ cwd, env });
  const running = await (options.findRunningServer ?? findRunningServer)(farm.root, { env });
  if (!running) return null;
  const fetchHealth = options.fetchHealth ?? (await import("../commands/serve.js")).fetchCentralHealth;
  const health = await fetchHealth(running.record, running.token);
  return health ? { ...running, health } : null;
}
