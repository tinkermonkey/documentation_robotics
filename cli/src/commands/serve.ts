/**
 * `dr serve`: the user's central DR process for the farm in use (issue 1279,
 * `docs/design/USER_LEVEL_DR.md` section 7).
 *
 *   dr serve               start it detached; print its link and pid
 *   dr serve --foreground  run it attached to this terminal (Ctrl-C stops it)
 *   dr serve --port <n>    where the port search starts, used only when it starts the process
 *   dr serve --status      the running process's record and health, or "not running"
 *   dr serve --stop        stop it, and wait until it is gone
 *
 * It never opens a browser. It refuses to start a second process for a farm that already has a
 * live one, and points to the running one instead. The process itself is `serve-entry.ts`
 * (server/central-lifetime.ts).
 */

import ansis from "ansis";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { openSync, closeSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerRecord } from "../core/checkout-types.js";
import { ProjectRegistry, resolveFarm, type FarmLocation } from "../core/project-registry.js";
import type { CentralHealth } from "../server/central-server-contract.js";
import { EXIT_ALREADY_RUNNING } from "../server/central-lifetime.js";
import {
  ensureServerRecordDir,
  farmHash,
  findRunningServer,
  removeServerRecord,
  type RunningServer,
} from "../server/server-record.js";
import { viewerUrl } from "../server/viewer-link.js";
import { viewerSetting } from "../server/viewer-settings.js";
import { CLIError } from "../utils/errors.js";
import { isJson } from "../utils/globals.js";
import { isProcessAlive } from "../utils/process-liveness.js";

export interface ServeOptions {
  port?: string;
  foreground?: boolean;
  status?: boolean;
  stop?: boolean;
  json?: boolean;
}

/** Everything `dr serve` touches outside itself, injected for tests. */
export interface ServeDeps {
  env: NodeJS.ProcessEnv;
  cwd: string;
  resolveFarm: (options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<FarmLocation>;
  findRunningServer: (farmRoot: string, options: { env: NodeJS.ProcessEnv }) => Promise<RunningServer | null>;
  removeServerRecord: (farmRoot: string, options: { env: NodeJS.ProcessEnv; pid: number }) => Promise<boolean>;
  /** `/health` with the token; null when it doesn't answer. */
  fetchHealth: (record: ServerRecord, token: string | null) => Promise<CentralHealth | null>;
  /** The process's command line, or null when it can't be read. */
  commandLine: (pid: number) => string | null;
  isAlive: (pid: number) => boolean;
  kill: (pid: number, signal: NodeJS.Signals) => void;
  /** Starts serve-entry. Detached: returns once spawned. Foreground: resolves with its exit code. */
  spawnEntry: (options: SpawnEntryOptions) => SpawnedEntry;
  /** The deep link to the checkout `cwd` is in, when the farm knows it. */
  linkFor: (record: ServerRecord, token: string | null, farm: FarmLocation, cwd: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  stopTimeoutMs: number;
  startTimeoutMs: number;
  pollMs: number;
  out: (line: string) => void;
}

export interface SpawnEntryOptions {
  farm: FarmLocation;
  port?: number;
  foreground: boolean;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Detached: the file its output goes to. */
  logPath?: string;
}

export interface SpawnedEntry {
  pid: number | undefined;
  /** The exit code once it exits (null: by a signal). */
  exited: Promise<number | null>;
  /** Detached: the log file its output goes to. */
  logPath?: string;
}

/** Where serve-entry.js is: beside the commands folder in dist/. */
export function serveEntryPath(): string {
  return join(dirname(dirname(fileURLToPath(import.meta.url))), "serve-entry.js");
}

/** The log of a detached process: `servers/<farm-hash>.log` in the state directory. */
export async function serveLogPath(farmRoot: string, env: NodeJS.ProcessEnv): Promise<string> {
  return join(await ensureServerRecordDir(env), `${farmHash(farmRoot)}.log`);
}

/** Starts serve-entry: attached to this terminal, or detached with its output in `logPath`. */
export function spawnServeEntry(options: SpawnEntryOptions): SpawnedEntry {
  const env: NodeJS.ProcessEnv = { ...options.env, DR_SERVE_LAUNCHER_PID: String(process.pid) };
  // The entry resolves the farm again from the same cwd and environment, so it finds this one.
  if (options.port !== undefined) env.DR_SERVE_PORT = String(options.port);
  else delete env.DR_SERVE_PORT;

  let child: ChildProcess;
  if (options.foreground) {
    child = spawn(process.execPath, [serveEntryPath()], { cwd: options.cwd, env, stdio: "inherit" });
  } else {
    if (!options.logPath) throw new Error("A detached DR process needs a log file.");
    const fd = openSync(options.logPath, "a", 0o600);
    try {
      child = spawn(process.execPath, [serveEntryPath()], {
        cwd: options.cwd,
        env,
        stdio: ["ignore", fd, fd],
        detached: true,
      });
    } finally {
      closeSync(fd);
    }
    child.unref();
  }
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", () => resolve(1));
  });
  return { pid: child.pid, exited, logPath: options.logPath };
}

/** `/health` of a central process, with its token when given; null when it doesn't answer. */
export async function fetchCentralHealth(record: ServerRecord, token: string | null): Promise<CentralHealth | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${record.port}/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(viewerSetting("healthTimeoutMs")),
    });
    if (!response.ok) return null;
    return (await response.json()) as CentralHealth;
  } catch {
    return null;
  }
}

function defaultCommandLine(pid: number): string | null {
  if (process.platform === "win32") return null;
  try {
    const result = spawnSync("ps", ["-ww", "-o", "args=", "-p", String(pid)], { encoding: "utf8", timeout: 3000 });
    const command = (result.stdout ?? "").trim();
    return result.error || !command ? null : command;
  } catch {
    return null;
  }
}

async function defaultLinkFor(record: ServerRecord, token: string | null, farm: FarmLocation, cwd: string): Promise<string> {
  try {
    const registry = await ProjectRegistry.open({ cwd });
    if (registry.farm.root === farm.root) {
      const resolved = await registry.resolveCheckout(cwd);
      if (resolved) return viewerUrl(record, resolved.ref, {}, token).url;
    }
  } catch {
    // The farm doesn't know this folder: the plain link below.
  }
  return `http://127.0.0.1:${record.port}/`;
}

function defaultDeps(): ServeDeps {
  return {
    env: process.env,
    cwd: process.cwd(),
    resolveFarm: (options) => resolveFarm(options),
    findRunningServer: (farmRoot, options) => findRunningServer(farmRoot, options),
    removeServerRecord: (farmRoot, options) => removeServerRecord(farmRoot, options),
    fetchHealth: fetchCentralHealth,
    commandLine: defaultCommandLine,
    isAlive: isProcessAlive,
    kill: (pid, signal) => process.kill(pid, signal),
    spawnEntry: spawnServeEntry,
    linkFor: defaultLinkFor,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
    stopTimeoutMs: viewerSetting("stopTimeoutMs"),
    startTimeoutMs: 30_000,
    pollMs: 100,
    out: (line) => console.log(line),
  };
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const port = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CLIError(`Invalid port number: ${raw}. Port must be between 1 and 65535.`);
  }
  return port;
}

function tail(path: string | undefined, lines = 20): string {
  if (!path) return "";
  try {
    return readFileSync(path, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/** Whether `pid` is the central process the record names: its own /health says so, or its command line runs serve-entry. */
function confirmedServer(record: ServerRecord, health: CentralHealth | null, deps: ServeDeps): boolean {
  if (health?.pid !== undefined) return health.pid === record.pid;
  const command = deps.commandLine(record.pid);
  return command !== null && /serve-entry\.(?:js|ts)(?:\s|$)/.test(command);
}

async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs: number, deps: ServeDeps): Promise<boolean> {
  const deadline = deps.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (deps.now() >= deadline) return false;
    await deps.sleep(deps.pollMs);
  }
}

/** `dr serve`, `dr serve --status`, `dr serve --stop`. */
export async function serveCommand(options: ServeOptions, overrides: Partial<ServeDeps> = {}): Promise<void> {
  const deps: ServeDeps = { ...defaultDeps(), ...overrides };
  const json = options.json ?? isJson();

  const modes = [options.status && "--status", options.stop && "--stop", options.foreground && "--foreground"].filter(Boolean);
  if (modes.length > 1) throw new CLIError(`${modes.join(" and ")} don't go together.`);
  if ((options.status || options.stop) && options.port !== undefined) {
    throw new CLIError("--port is used only when dr serve starts the process.");
  }
  const port = parsePort(options.port);
  const farm = await deps.resolveFarm({ cwd: deps.cwd, env: deps.env });
  const running = await deps.findRunningServer(farm.root, { env: deps.env });

  if (options.status) {
    if (!running) {
      if (json) deps.out(JSON.stringify({ running: false, farmRoot: farm.root }));
      else deps.out(`No DR process is running for ${farm.root}.`);
      return;
    }
    const health = await deps.fetchHealth(running.record, running.token);
    if (json) {
      const { tokenPath: _tokenPath, ...record } = running.record;
      deps.out(JSON.stringify({ running: true, answering: health !== null, record, health }, null, 2));
      return;
    }
    const r = running.record;
    deps.out(`DR process for ${r.farmRoot}`);
    deps.out(`  pid ${r.pid}, port ${r.port}, CLI ${r.cliVersion}, started ${r.startedAt}`);
    if (r.launcherPid) deps.out(`  started by pid ${r.launcherPid}`);
    if (health) {
      const parts = [`status ${health.status}`];
      if (health.clients !== undefined) parts.push(`${health.clients} tab${health.clients === 1 ? "" : "s"}`);
      if (health.loadedCheckouts !== undefined) parts.push(`${health.loadedCheckouts} checkout${health.loadedCheckouts === 1 ? "" : "s"} loaded`);
      deps.out(`  health: ${parts.join(", ")}`);
    } else {
      deps.out(`  health: not answering on http://127.0.0.1:${r.port}/health`);
    }
    return;
  }

  if (options.stop) {
    if (!running) {
      if (json) deps.out(JSON.stringify({ stopped: false, running: false }));
      else deps.out(`No DR process is running for ${farm.root}.`);
      return;
    }
    const record = running.record;
    const health = await deps.fetchHealth(record, running.token);
    if (!confirmedServer(record, health, deps)) {
      throw new CLIError(
        `pid ${record.pid} in the server record could not be confirmed to be the DR process (it didn't answer as one, and its command line doesn't run serve-entry), so it was not signalled.`,
        1,
        [`If the process is gone, remove the record: ${record.tokenPath.replace(/\.token$/, ".json")}`]
      );
    }
    deps.kill(record.pid, "SIGTERM");
    let gone = await waitUntil(() => !deps.isAlive(record.pid), deps.stopTimeoutMs, deps);
    let forced = false;
    if (!gone) {
      forced = true;
      try {
        deps.kill(record.pid, "SIGKILL");
      } catch {
        // Gone between the check and the signal.
      }
      gone = await waitUntil(() => !deps.isAlive(record.pid), 2000, deps);
    }
    if (!gone) throw new CLIError(`The DR process (pid ${record.pid}) did not stop.`, 1);
    await deps.removeServerRecord(farm.root, { env: deps.env, pid: record.pid });
    if (json) deps.out(JSON.stringify({ stopped: true, pid: record.pid, forced }));
    else deps.out(`Stopped the DR process for ${farm.root} (pid ${record.pid}${forced ? ", killed after SIGTERM timed out" : ""}).`);
    return;
  }

  if (running) {
    const link = await deps.linkFor(running.record, running.token, farm, deps.cwd);
    throw new CLIError(
      `A DR process already serves ${farm.root}: pid ${running.record.pid}, ${link}`,
      1,
      ["dr serve --status shows it; dr serve --stop stops it."]
    );
  }

  if (options.foreground) {
    const entry = deps.spawnEntry({ farm, port, foreground: true, env: deps.env, cwd: deps.cwd });
    // Ctrl-C reaches the entry through the terminal's process group; this process waits for it.
    const ignore = () => {};
    const forward = () => entry.pid && deps.kill(entry.pid, "SIGTERM");
    process.on("SIGINT", ignore);
    process.on("SIGTERM", forward);
    try {
      const code = await entry.exited;
      if (code === EXIT_ALREADY_RUNNING) throw new CLIError("Another DR process started for this farm first.", 1);
      if (code !== 0 && code !== null) throw new CLIError(`The DR process exited with code ${code}.`, code);
    } finally {
      process.off("SIGINT", ignore);
      process.off("SIGTERM", forward);
    }
    return;
  }

  // Detached: wait until the entry has recorded itself, then print where it is.
  const logPath = await serveLogPath(farm.root, deps.env);
  const entry = deps.spawnEntry({ farm, port, foreground: false, env: deps.env, cwd: deps.cwd, logPath });
  let exitCode: number | null | undefined;
  void entry.exited.then((code) => (exitCode = code));
  let started: RunningServer | null = null;
  await waitUntil(
    async () => {
      if (exitCode !== undefined) return true;
      const found = await deps.findRunningServer(farm.root, { env: deps.env });
      if (found && found.record.pid === entry.pid) started = found;
      return started !== null;
    },
    deps.startTimeoutMs,
    deps
  );
  const ready = started as RunningServer | null;
  if (!ready) {
    const log = tail(logPath);
    const why =
      exitCode === EXIT_ALREADY_RUNNING
        ? "another DR process started for this farm first"
        : exitCode !== undefined
          ? `it exited with code ${exitCode}`
          : `it did not record itself within ${Math.round(deps.startTimeoutMs / 1000)}s`;
    throw new CLIError(`The DR process did not start: ${why}.${log ? `\n${log}` : ""}`, 1, [`Its log: ${logPath}`]);
  }
  const link = await deps.linkFor(ready.record, ready.token, farm, deps.cwd);
  if (json) {
    deps.out(JSON.stringify({ started: true, pid: ready.record.pid, port: ready.record.port, url: link, log: logPath }));
    return;
  }
  deps.out(ansis.green(`DR is serving ${farm.root}`));
  deps.out(`  ${link}`);
  deps.out(`  pid ${ready.record.pid}, port ${ready.record.port}`);
  deps.out(ansis.dim(`  log: ${logPath}`));
}
