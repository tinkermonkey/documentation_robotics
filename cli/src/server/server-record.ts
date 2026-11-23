/**
 * The central server record: which DR process serves a farm (issue 1279, design section 7).
 *
 * One central process serves every project and checkout of a farm. It records itself in the
 * user's state directory, the same one the viewer registry uses (`stateDir()`):
 *
 *   <state dir>/servers/<farm-hash>.json    the ServerRecord (farm root, pid, port, cliVersion, ...)
 *   <state dir>/servers/<farm-hash>.token   its auth token, mode 0600, never in the record
 *
 * `<farm-hash>` is a hash of the farm root's real path, so a farm reached through a symlink has one
 * record. The servers directory is 0700 and every file in it 0600. Writes are atomic (a temp file
 * renamed into place) and write the token before the record, so a reader never finds a record
 * whose token is missing; removal goes the other way.
 *
 * Reading sweeps: `sweepServerRecords` removes records whose process is gone, with their tokens,
 * tokens no record names and temp files a killed writer left. "Gone" includes an exited process
 * nobody reaped (utils/process-liveness, #1275).
 *
 * Slice 1 only provides this. Nothing writes a record in production until `dr serve` (slice 2).
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ServerRecord } from "../core/checkout-types.js";
import { isProcessAlive } from "../utils/process-liveness.js";
import { stateDir } from "./viewer-registry.js";

/** Directory holding the server records and their tokens. */
export function serverRecordDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDir(env), "servers");
}

/** The farm root's real path, or its resolved path when it doesn't exist. */
export function canonicalFarmRoot(farmRoot: string): string {
  try {
    return realpathSync(farmRoot);
  } catch {
    return resolve(farmRoot);
  }
}

/** The key of a farm's record: a hash of the farm root's real path. */
export function farmHash(farmRoot: string): string {
  return createHash("sha256").update(canonicalFarmRoot(farmRoot)).digest("hex").slice(0, 24);
}

/** Path of the farm's server record. */
export function serverRecordPath(farmRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(serverRecordDir(env), `${farmHash(farmRoot)}.json`);
}

/** Path of the farm's 0600 token file. */
export function serverTokenPath(farmRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(serverRecordDir(env), `${farmHash(farmRoot)}.token`);
}

/** A record file's name, and a token file's. */
const RECORD_FILE = /^([0-9a-f]{24})\.json$/;
const TOKEN_FILE = /^([0-9a-f]{24})\.token$/;

/** Temp files older than this are left over from a writer that died mid-write. */
const STALE_TEMP_MS = 60_000;

let tempSeq = 0;

/** Creates the servers directory (0700) and returns it. */
export async function ensureServerRecordDir(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const dir = serverRecordDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return dir;
}

/** Writes `content` to `path` (0600) through a temp file renamed into place. */
async function writeAtomic(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}.${++tempSeq}.tmp`;
  try {
    await writeFile(temp, content, { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

function isPid(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** A record read from disk, or null when it is not one this CLI can read. */
export function parseServerRecord(text: string): ServerRecord | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const r = data as Record<string, unknown>;
  if (typeof r.farmRoot !== "string" || r.farmRoot === "") return null;
  if (!isPid(r.pid)) return null;
  if (typeof r.port !== "number" || !Number.isInteger(r.port) || r.port <= 0 || r.port > 65535) return null;
  if (typeof r.cliVersion !== "string") return null;
  if (typeof r.startedAt !== "string") return null;
  if (typeof r.tokenPath !== "string" || r.tokenPath === "") return null;
  if (r.launcherPid !== undefined && !isPid(r.launcherPid)) return null;
  const record: ServerRecord = {
    farmRoot: r.farmRoot,
    pid: r.pid,
    port: r.port,
    cliVersion: r.cliVersion,
    startedAt: r.startedAt,
    tokenPath: r.tokenPath,
  };
  if (r.launcherPid !== undefined) record.launcherPid = r.launcherPid as number;
  return record;
}

/** What writeServerRecord needs: the record without its token path, which it decides. */
export type NewServerRecord = Omit<ServerRecord, "tokenPath">;

/**
 * Writes the farm's server record and its token (both 0600, atomically, the token first), and
 * returns the record as written: the farm root as its real path, and the token file's path. A
 * record already there is replaced: one farm has one central process.
 */
export async function writeServerRecord(
  record: NewServerRecord,
  token: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ServerRecord> {
  if (token === "") throw new Error("A server record needs a token.");
  await ensureServerRecordDir(env);
  const farmRoot = canonicalFarmRoot(record.farmRoot);
  const stored: ServerRecord = { ...record, farmRoot, tokenPath: serverTokenPath(farmRoot, env) };
  await writeAtomic(stored.tokenPath, token);
  await writeAtomic(serverRecordPath(farmRoot, env), JSON.stringify(stored, null, 2) + "\n");
  return stored;
}

/** The farm's server record, whether or not its process is alive; null when there is none or it can't be read. */
export async function readServerRecord(
  farmRoot: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ServerRecord | null> {
  const text = await readFile(serverRecordPath(farmRoot, env), "utf8").catch(() => null);
  return text === null ? null : parseServerRecord(text);
}

/** The token a record names, or null when its file is missing or empty. */
export async function readServerToken(record: Pick<ServerRecord, "tokenPath">): Promise<string | null> {
  const text = await readFile(record.tokenPath, "utf8").catch(() => null);
  const token = text?.trim();
  return token ? token : null;
}

export interface RemoveServerRecordOptions {
  env?: NodeJS.ProcessEnv;
  /** Remove the record only when it is this process's: a server removes its own record, never a successor's. */
  pid?: number;
}

/**
 * Removes the farm's record and then its token. With `pid`, only when the record names that pid.
 * Returns whether the record was removed. Never throws.
 */
export async function removeServerRecord(farmRoot: string, options: RemoveServerRecordOptions = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  const path = serverRecordPath(farmRoot, env);
  if (options.pid !== undefined) {
    const current = await readServerRecord(farmRoot, env);
    if (current !== null && current.pid !== options.pid) return false;
  }
  try {
    await unlink(path);
  } catch {
    return false;
  } finally {
    await unlink(serverTokenPath(farmRoot, env)).catch(() => {});
  }
  return true;
}

export interface SweepServerRecordsOptions {
  env?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to utils/process-liveness. */
  isAlive?: (pid: number) => boolean;
  now?: number;
}

/** What a sweep of the servers directory removed. */
export interface ServerSweepResult {
  /** Every path removed. */
  removed: string[];
  /** Records of processes that are gone, or that can't be read and name no live pid. */
  records: number;
  /** Token files whose record is gone. */
  tokens: number;
  /** Half-written temp files a writer left when it was killed. */
  tempFiles: number;
  /**
   * Records this CLI cannot read whose `pid` is alive: left in place (a later CLI's record of a
   * running process, perhaps) and reported, so nothing reads their absence as "no server".
   */
  unreadable: string[];
}

/**
 * Removes what gone processes left in the servers directory: records whose pid is gone (an
 * unreaped zombie included) with their tokens, tokens with no record, and temp files older than a
 * minute. Returns what it removed; never throws.
 */
export async function sweepServerRecords(options: SweepServerRecordsOptions = {}): Promise<ServerSweepResult> {
  const env = options.env ?? process.env;
  const isAlive = options.isAlive ?? isProcessAlive;
  const now = options.now ?? Date.now();
  const dir = serverRecordDir(env);
  const result: ServerSweepResult = { removed: [], records: 0, tokens: 0, tempFiles: 0, unreadable: [] };
  const drop = async (path: string, kind: "records" | "tokens" | "tempFiles") => {
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

  const kept = new Set<string>();
  for (const name of names) {
    const match = RECORD_FILE.exec(name);
    if (!match) continue;
    const path = join(dir, name);
    const text = await readFile(path, "utf8").catch(() => null);
    if (text === null) continue;
    const record = parseServerRecord(text);
    if (record) {
      if (isAlive(record.pid)) kept.add(match[1]);
      else await drop(path, "records");
      continue;
    }
    // Not a record this CLI can read: while the pid it names is alive, it stays and is reported.
    let pid: unknown;
    try {
      pid = (JSON.parse(text) as { pid?: unknown }).pid;
    } catch {
      pid = undefined;
    }
    if (isPid(pid) && isAlive(pid)) {
      kept.add(match[1]);
      result.unreadable.push(path);
    } else await drop(path, "records");
  }

  for (const name of names) {
    const path = join(dir, name);
    const token = TOKEN_FILE.exec(name);
    if (token) {
      if (kept.has(token[1])) continue;
      if (names.includes(`${token[1]}.json`)) {
        // Its record was swept above.
        await drop(path, "tokens");
        continue;
      }
      // No record: a writer writes the token first, so a token newer than a minute may be one
      // whose record is on its way.
      const age = await stat(path).then((s) => now - s.mtimeMs, () => null);
      if (age !== null && age > STALE_TEMP_MS) await drop(path, "tokens");
    } else if (name.endsWith(".tmp")) {
      const age = await stat(path).then((s) => now - s.mtimeMs, () => null);
      if (age !== null && age > STALE_TEMP_MS) await drop(path, "tempFiles");
    }
  }
  return result;
}

/** A central process that is running, with its token. */
export interface RunningServer {
  record: ServerRecord;
  token: string | null;
}

/**
 * The central process serving a farm, when one is running: its record and token. A record whose
 * process is gone is removed (with its token) and null returned. Starts nothing.
 */
export async function findRunningServer(
  farmRoot: string,
  options: SweepServerRecordsOptions = {}
): Promise<RunningServer | null> {
  const env = options.env ?? process.env;
  const isAlive = options.isAlive ?? isProcessAlive;
  const record = await readServerRecord(farmRoot, env);
  if (record === null) return null;
  if (!isAlive(record.pid)) {
    await removeServerRecord(farmRoot, { env, pid: record.pid });
    return null;
  }
  return { record, token: await readServerToken(record) };
}
