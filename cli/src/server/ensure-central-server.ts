/**
 * `ensureCentralServer` (issue 1279, slice 3A; `docs/design/USER_LEVEL_DR.md` section 7): the
 * central DR process for the farm in use, started when there is none.
 *
 * - It finds the farm's live process from its server record (`findRunningServer`).
 * - Otherwise it starts `dr serve` detached, under the starting marker
 *   (`servers/<farm-hash>.starting`, created exclusively): concurrent callers find the marker and
 *   wait for that one start instead of starting their own.
 * - A process older than this CLI is replaced only when no browser tab, MCP session or DrBot turn
 *   uses it. Otherwise it is returned as it is, with a notice saying so.
 *
 * (`application.applicationfunction.ensure-central-server`, `data-store.collection.server-starting-marker`)
 */

import { open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ServerRecord } from "../core/checkout-types.js";
import { resolveFarm, type FarmLocation } from "../core/project-registry.js";
import { SESSION_ENV_KEYS } from "../core/session-env.js";
import { fetchCentralHealth, serveLogPath, spawnServeEntry, type SpawnEntryOptions, type SpawnedEntry } from "../commands/serve.js";
import { getCliVersion } from "../utils/spec-version.js";
import { isProcessAlive } from "../utils/process-liveness.js";
import { EXIT_ALREADY_RUNNING } from "./central-lifetime.js";
import type { EnsureCentralServer, EnsureCentralServerOptions, EnsuredCentralServer } from "./central-mcp-contract.js";
import { MCP_ROOT_PATH_ENV } from "./central-mcp-contract.js";
import type { CentralHealth } from "./central-server-contract.js";
import {
  ensureServerRecordDir,
  farmHash,
  findRunningServer,
  removeServerRecord,
  serverRecordDir,
  type RunningServer,
} from "./server-record.js";

/** Everything ensureCentralServer touches outside itself, injected for tests. */
export interface EnsureCentralServerDeps {
  resolveFarm: (options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<FarmLocation>;
  findRunningServer: (farmRoot: string, options: { env: NodeJS.ProcessEnv }) => Promise<RunningServer | null>;
  removeServerRecord: (farmRoot: string, options: { env: NodeJS.ProcessEnv; pid: number }) => Promise<boolean>;
  fetchHealth: (record: ServerRecord, token: string | null) => Promise<CentralHealth | null>;
  /** Starts `dr serve`'s process detached (serve-entry). */
  spawnEntry: (options: SpawnEntryOptions) => SpawnedEntry;
  logPath: (farmRoot: string, env: NodeJS.ProcessEnv) => Promise<string>;
  isAlive: (pid: number) => boolean;
  kill: (pid: number, signal: NodeJS.Signals) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** This CLI's version: a process recording an older one is replaced when idle. */
  cliVersion: string;
  startTimeoutMs: number;
  stopTimeoutMs: number;
  pollMs: number;
}

function defaultDeps(): EnsureCentralServerDeps {
  return {
    resolveFarm: (options) => resolveFarm(options),
    findRunningServer: (farmRoot, options) => findRunningServer(farmRoot, options),
    removeServerRecord: (farmRoot, options) => removeServerRecord(farmRoot, options),
    fetchHealth: fetchCentralHealth,
    spawnEntry: spawnServeEntry,
    logPath: serveLogPath,
    isAlive: isProcessAlive,
    kill: (pid, signal) => process.kill(pid, signal),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
    cliVersion: getCliVersion(),
    startTimeoutMs: 30_000,
    stopTimeoutMs: 10_000,
    pollMs: 100,
  };
}

/** Path of the farm's starting marker, beside its server record. */
export function serverStartingPath(farmRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(serverRecordDir(env), `${farmHash(farmRoot)}.starting`);
}

/** What the starting marker holds: who is starting the process, and since when. */
export interface ServerStarting {
  pid: number;
  startedAt: number;
}

/**
 * -1, 0 or 1 as version `a` is older than, the same as or newer than `b` (numeric dot parts; a
 * pre-release is older than its release; anything unparsable compares equal, so it is never
 * replaced on a guess).
 */
export function compareCliVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
    return match ? { parts: match[1].split(".").map(Number), pre: match[2] } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (x.pre && !y.pre) return -1;
  if (!x.pre && y.pre) return 1;
  if (x.pre && y.pre && x.pre !== y.pre) return x.pre < y.pre ? -1 : 1;
  return 0;
}

/** The environment the central process starts with: the caller's, without what describes one session. */
export function centralProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...env };
  // A bridge DrBot started carries its chat's limits and checkout: those are its session's, sent
  // with it, never the shared process's.
  delete clean[MCP_ROOT_PATH_ENV];
  for (const key of SESSION_ENV_KEYS) delete clean[key];
  return clean;
}

function describeUse(health: CentralHealth): string {
  const parts: string[] = [];
  const count = (n: number | undefined, one: string, many: string) => {
    if (n && n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  count(health.clients, "browser tab", "browser tabs");
  count(health.mcpSessions, "MCP session", "MCP sessions");
  count(health.drBotTurns, "DrBot turn", "DrBot turns");
  return parts.join(", ");
}

/** An ensureCentralServer with its dependencies replaced (tests). */
export function createEnsureCentralServer(overrides: Partial<EnsureCentralServerDeps> = {}): EnsureCentralServer {
  return (options = {}) => ensureWith(options, { ...defaultDeps(), ...overrides });
}

/** Finds or starts the central process for the farm in use. (`EnsureCentralServer` in central-mcp-contract.ts) */
export const ensureCentralServer: EnsureCentralServer = (options) => ensureWith(options ?? {}, defaultDeps());

async function ensureWith(options: EnsureCentralServerOptions, deps: EnsureCentralServerDeps): Promise<EnsuredCentralServer> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const startTimeoutMs = options.startTimeoutMs ?? deps.startTimeoutMs;
  const farm = await deps.resolveFarm({ cwd, env });
  const deadline = deps.now() + startTimeoutMs * 2;

  let replaced = false;
  for (;;) {
    const running = await deps.findRunningServer(farm.root, { env });
    if (running) {
      if (!running.token) {
        throw new Error(
          `The DR process for ${farm.root} (pid ${running.record.pid}) has no readable token file (${running.record.tokenPath}). Stop it with "dr serve --stop".`
        );
      }
      if (compareCliVersions(running.record.cliVersion, deps.cliVersion) >= 0) {
        return { record: running.record, token: running.token, started: replaced };
      }
      const health = await deps.fetchHealth(running.record, running.token);
      const inUse = health ? describeUse(health) : "";
      if (inUse) {
        return {
          record: running.record,
          token: running.token,
          started: false,
          notice:
            `The DR process for ${farm.root} (pid ${running.record.pid}) runs CLI ${running.record.cliVersion}, ` +
            `older than this CLI (${deps.cliVersion}), and was kept because it is in use (${inUse}). ` +
            `Once those are done, "dr serve --stop" stops it, and the next dr MCP session starts the new one.`,
        };
      }
      await stopProcess(farm, running.record, env, deps);
      replaced = true;
      continue;
    }

    const marker = await claimStartingMarker(farm.root, env, deps);
    if (!marker) {
      // Someone else is starting it: wait for its record (or for its marker to go away).
      if (deps.now() > deadline) {
        throw new Error(`Timed out waiting for another caller to start the DR process for ${farm.root}.`);
      }
      await deps.sleep(deps.pollMs);
      continue;
    }
    try {
      // A process may have recorded itself between the lookup and the claim.
      const raced = await deps.findRunningServer(farm.root, { env });
      if (raced) continue;
      const started = await startProcess(farm, cwd, env, startTimeoutMs, deps);
      return { record: started.record, token: started.token!, started: true };
    } finally {
      await marker.release();
    }
  }
}

/** Takes the starting marker, or returns null while a live caller holds it. A dead or stale holder's marker is removed. */
async function claimStartingMarker(
  farmRoot: string,
  env: NodeJS.ProcessEnv,
  deps: EnsureCentralServerDeps
): Promise<{ release: () => Promise<void> } | null> {
  await ensureServerRecordDir(env);
  const path = serverStartingPath(farmRoot, env);
  const mine: ServerStarting = { pid: process.pid, startedAt: deps.now() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(mine) + "\n");
      } finally {
        await handle.close();
      }
      return {
        release: async () => {
          const held = await readStarting(path);
          if (!held || (held.pid === mine.pid && held.startedAt === mine.startedAt)) await unlink(path).catch(() => {});
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const held = await readStarting(path);
    const stale =
      held === null
        ? attempt > 0 // unreadable twice in a row: a writer that died mid-write
        : !deps.isAlive(held.pid) || deps.now() - held.startedAt > deps.startTimeoutMs * 2;
    if (!stale) return null;
    await unlink(path).catch(() => {});
  }
  return null;
}

async function readStarting(path: string): Promise<ServerStarting | null> {
  try {
    const data = JSON.parse(await readFile(path, "utf8")) as Partial<ServerStarting>;
    if (Number.isInteger(data.pid) && typeof data.startedAt === "number") return data as ServerStarting;
  } catch {
    // Missing, or half written.
  }
  return null;
}

async function startProcess(
  farm: FarmLocation,
  cwd: string,
  env: NodeJS.ProcessEnv,
  startTimeoutMs: number,
  deps: EnsureCentralServerDeps
): Promise<RunningServer> {
  const logPath = await deps.logPath(farm.root, env);
  const entry = deps.spawnEntry({ farm, foreground: false, env: centralProcessEnv(env), cwd, logPath });
  let exitCode: number | null | undefined;
  void entry.exited.then((code) => (exitCode = code));
  const deadline = deps.now() + startTimeoutMs;
  for (;;) {
    const found = await deps.findRunningServer(farm.root, { env });
    if (found && found.token && (found.record.pid === entry.pid || exitCode === EXIT_ALREADY_RUNNING)) return found;
    if (exitCode !== undefined && exitCode !== EXIT_ALREADY_RUNNING) {
      throw new Error(`The DR process did not start: it exited with code ${exitCode}. Its log: ${logPath}`);
    }
    if (deps.now() >= deadline) {
      throw new Error(
        `The DR process did not record itself within ${Math.round(startTimeoutMs / 1000)}s. Its log: ${logPath}`
      );
    }
    await deps.sleep(deps.pollMs);
  }
}

async function stopProcess(
  farm: FarmLocation,
  record: ServerRecord,
  env: NodeJS.ProcessEnv,
  deps: EnsureCentralServerDeps
): Promise<void> {
  try {
    deps.kill(record.pid, "SIGTERM");
  } catch {
    // Gone already.
  }
  const deadline = deps.now() + deps.stopTimeoutMs;
  while (deps.isAlive(record.pid) && deps.now() < deadline) await deps.sleep(deps.pollMs);
  if (deps.isAlive(record.pid)) {
    try {
      deps.kill(record.pid, "SIGKILL");
    } catch {
      // Gone between the check and the signal.
    }
    const killDeadline = deps.now() + 2000;
    while (deps.isAlive(record.pid) && deps.now() < killDeadline) await deps.sleep(deps.pollMs);
    if (deps.isAlive(record.pid)) {
      throw new Error(`The older DR process (pid ${record.pid}) did not stop.`);
    }
  }
  await deps.removeServerRecord(farm.root, { env, pid: record.pid });
}
