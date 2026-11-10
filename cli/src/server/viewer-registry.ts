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
 * removeViewerRecord, removeViewerRecordSync, findRunningViewer, viewerUrl.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

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

/** Creates the viewers directory (0700) and returns it. */
export async function ensureViewerRecordDir(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const dir = viewerRecordDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return dir;
}

/**
 * Writes a project's viewer record (0600), replacing any earlier one. The write is atomic, so
 * a reader never sees half a record. Returns the record's path.
 */
export async function writeViewerRecord(
  record: ViewerRecord,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  await ensureViewerRecordDir(env);
  const path = viewerRecordPath(record.projectRoot, env);
  const stored: ViewerRecord = { ...record, projectRoot: canonicalProjectRoot(record.projectRoot) };
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
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
  /** Injected for tests; defaults to viewerAnswers. */
  answers?: (port: number) => Promise<boolean>;
}

/**
 * The viewer serving this project, or null. A record counts only when its pid is alive and the
 * server answers its health check; otherwise the record is stale and is removed.
 */
export async function findRunningViewer(
  projectRoot: string,
  options: FindRunningViewerOptions = {}
): Promise<ViewerRecord | null> {
  const env = options.env ?? process.env;
  const isAlive = options.isAlive ?? isProcessAlive;
  const answers = options.answers ?? ((port: number) => viewerAnswers(port));

  const record = await readViewerRecord(projectRoot, env);
  if (record === undefined) return null;
  if (record === null) {
    await removeViewerRecord(projectRoot, { env });
    return null;
  }
  if (record.projectRoot !== canonicalProjectRoot(projectRoot)) return null;
  if (!isAlive(record.pid) || !(await answers(record.port))) {
    await removeViewerRecord(projectRoot, { env, pid: record.pid });
    return null;
  }
  return record;
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
