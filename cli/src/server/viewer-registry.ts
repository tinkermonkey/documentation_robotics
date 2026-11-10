/**
 * Viewer registry: which `dr visualize` is serving which project.
 *
 * `dr visualize` writes one record per project once its server is listening, and removes it on
 * exit. Tools that hand the human a link to the viewer (`review_open`, `project_status`) read it
 * with `findRunningViewer` and reuse a running viewer instead of starting another.
 *
 * The record holds the viewer's auth token, so it lives in the user's state directory, outside
 * any repository, where it can't be committed:
 *
 *   $DR_STATE_DIR/viewers/<hash>.json           (DR_STATE_DIR overrides, for tests)
 *   $XDG_STATE_HOME/dr/viewers/<hash>.json      (when XDG_STATE_HOME is set)
 *   ~/.local/state/dr/viewers/<hash>.json       (otherwise)
 *
 * `<hash>` is a hash of the project root's real path. Each file is mode 0600 and the viewers
 * directory 0700.
 *
 * Stable API (imported by MCP tools): ViewerRecord, writeViewerRecord, readViewerRecord,
 * removeViewerRecord, removeViewerRecordSync, findRunningViewer, probeViewer, viewerUrl.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/** Env var that points the user state directory somewhere else (tests). */
export const DR_STATE_DIR_ENV = "DR_STATE_DIR";

/** A running `dr visualize` for one project. */
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

/** Path of a project's viewer record. */
export function viewerRecordPath(projectRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(viewerRecordDir(env), `${recordKey(projectRoot)}.json`);
}

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
 * Writes a project's viewer record (0600), replacing any earlier one. The write is atomic (a
 * temp file renamed into place), so a reader never sees half a record; stale temp files from
 * earlier writers are cleaned up first. Returns the record's path.
 */
export async function writeViewerRecord(
  record: ViewerRecord,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  await ensureViewerRecordDir(env);
  await removeStaleTempFiles(env);
  const path = viewerRecordPath(record.projectRoot, env);
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
      };
    }
  } catch {
    // Unparseable: treated as no record.
  }
  return null;
}

/**
 * A project's viewer record as written, without checking that the viewer still runs. Undefined
 * when there is no record; null when the file is there but unreadable as a record.
 */
export async function readViewerRecord(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ViewerRecord | null | undefined> {
  let text: string;
  try {
    text = await readFile(viewerRecordPath(projectRoot, env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return parseRecord(text);
}

export interface RemoveViewerRecordOptions {
  /** Remove only if the record belongs to this pid (so a viewer never removes a newer one's). */
  pid?: number;
  env?: NodeJS.ProcessEnv;
}

/** Removes a project's viewer record. Missing is fine. */
export async function removeViewerRecord(
  projectRoot: string,
  options: RemoveViewerRecordOptions = {}
): Promise<void> {
  const env = options.env ?? process.env;
  const path = viewerRecordPath(projectRoot, env);
  if (options.pid !== undefined) {
    const current = await readViewerRecord(projectRoot, env).catch(() => undefined);
    if (current && current.pid !== options.pid) return;
  }
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Synchronous removeViewerRecord, for a process "exit" handler. Never throws. */
export function removeViewerRecordSync(projectRoot: string, options: RemoveViewerRecordOptions = {}): void {
  const env = options.env ?? process.env;
  const path = viewerRecordPath(projectRoot, env);
  // A write this process had in flight when it exited.
  removeTempFilesSync(path, options.pid ?? process.pid);
  try {
    if (!existsSync(path)) return;
    if (options.pid !== undefined) {
      const current = parseRecord(readFileSync(path, "utf8"));
      if (current && current.pid !== options.pid) return;
    }
    unlinkSync(path);
  } catch {
    // Best effort at exit; findRunningViewer clears stale records anyway.
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

/** Whether a dr viewer answers its health check on this port. */
export async function viewerAnswers(port: number, timeoutMs = 1500): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: unknown };
    return body?.status === "ok" || body?.status === "degraded";
  } catch {
    return false;
  }
}

export interface FindRunningViewerOptions {
  env?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to isProcessAlive. */
  isAlive?: (pid: number) => boolean;
  /** Injected for tests; defaults to viewerAnswers. Called with the probe's timeout. */
  answers?: (port: number, timeoutMs: number) => Promise<boolean>;
  /** First health probe's timeout (default 1.5s). */
  probeTimeoutMs?: number;
  /** The retry's timeout when the first probe fails and the pid is alive (default 5s). */
  retryTimeoutMs?: number;
}

/**
 * What the registry knows about a project's viewer:
 * - `none`: no record, or a stale one (its pid is dead), which is removed.
 * - `running`: the pid is alive and the server answers its health check.
 * - `unreachable`: the pid is alive but the server did not answer, twice. The record is kept: the
 *   viewer may only be busy, and a second viewer for the project would be wrong.
 */
export type ViewerProbe =
  | { state: "none" }
  | { state: "running"; record: ViewerRecord }
  | { state: "unreachable"; record: ViewerRecord };

/** Checks a project's viewer record against its process and its health check. */
export async function probeViewer(projectRoot: string, options: FindRunningViewerOptions = {}): Promise<ViewerProbe> {
  const env = options.env ?? process.env;
  const isAlive = options.isAlive ?? isProcessAlive;
  const answers = options.answers ?? viewerAnswers;

  const record = await readViewerRecord(projectRoot, env);
  if (record === undefined) return { state: "none" };
  if (record === null) {
    await removeViewerRecord(projectRoot, { env });
    return { state: "none" };
  }
  if (record.projectRoot !== canonicalProjectRoot(projectRoot)) return { state: "none" };
  if (!isAlive(record.pid)) {
    await removeViewerRecord(projectRoot, { env, pid: record.pid });
    return { state: "none" };
  }
  if (await answers(record.port, options.probeTimeoutMs ?? 1500)) return { state: "running", record };
  if (await answers(record.port, options.retryTimeoutMs ?? 5000)) return { state: "running", record };
  return { state: "unreachable", record };
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
