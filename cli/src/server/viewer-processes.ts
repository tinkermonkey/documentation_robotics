/**
 * Finding `dr visualize` processes without the registry.
 *
 * A viewer is two processes: the launcher (`<runtime> <cli entry> visualize ...`) and the server
 * it runs (`<runtime> .../dist/server-entry.js`). The registry (viewer-registry.ts) records the
 * launcher, but a record can be missing: an older CLI kept one record per project and a later
 * `dr visualize` in the same folder replaced it (#1237). This module finds viewers from the
 * process table instead, so `dr visualize --list` and `--stop` reach those too.
 *
 * What counts as a viewer here decides what `--stop` may signal, so it is strict:
 *
 * - A **server** is a process running a `dist/server-entry.js` whose package (the `package.json`
 *   beside `dist/`) is the dr CLI. Another program's `dist/server-entry.js` is not one, whatever
 *   its `/health` answers. A `dist/server-entry.js` whose package cannot be read is a
 *   *candidate*: counted and reported, never listed as a viewer and never signalled.
 * - A **launcher** is the parent of a server, when that parent's command line has a `visualize`
 *   argument. A command line that merely looks like a launcher, with no dr server under it, is
 *   not one.
 * - A server whose parent is anything else (init, a subreaper) was left behind by a launcher
 *   that died.
 * - Only the current user's processes count. Another user's viewers are counted and reported.
 *
 * Uses `ps` and `lsof` (and /proc on Linux). Where they are missing (Windows), or with
 * DR_VIEWER_PROCESS_SCAN=off, the scan returns null and callers fall back to the registry alone,
 * and say so.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join } from "node:path";

/** "off" (or "0", "false", "no") turns the process scan off: the registry alone is consulted. */
export const PROCESS_SCAN_ENV = "DR_VIEWER_PROCESS_SCAN";

/** The dr CLI's package name, which a viewer's server script must belong to. */
export const DR_CLI_PACKAGE = "@documentation-robotics/cli";

/** One row of the process table. */
export interface ProcessInfo {
  pid: number;
  ppid: number;
  /** The owner's numeric user id; absent or null when ps did not say. */
  uid?: number | null;
  /** ISO timestamp of when the process started, or "" when ps did not say. */
  startedAt: string;
  command: string;
}

/** A viewer found in the process table. */
export interface ViewerProcess {
  /** The `dr visualize` launcher, or null when only its server is left (the launcher died). */
  launcherPid: number | null;
  /** The server process, or null for a launcher the registry names that has no server (yet). */
  serverPid: number | null;
  /** When the launcher (or the left-behind server) started. */
  startedAt: string;
  command: string;
}

/** What a scan of the process table found. */
export interface ViewerProcessScan {
  viewers: ViewerProcess[];
  /** Pids running a `dist/server-entry.js` that could not be confirmed to be the dr CLI's: not viewers, but worth saying. */
  candidates: number[];
  /** How many viewers belong to other users (not listed, never signalled). */
  otherUsers: number;
}

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/;

/** Parses `ps -A -ww -o pid=,ppid=,uid=,lstart=,args=` output (C locale). */
export function parsePs(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of output.split("\n")) {
    const match = PS_LINE.exec(line);
    if (!match) continue;
    const started = new Date(match[4]);
    processes.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      uid: Number(match[3]),
      startedAt: Number.isNaN(started.getTime()) ? "" : started.toISOString(),
      command: match[5].trim(),
    });
  }
  return processes;
}

/** Whether the process scan is turned off (DR_VIEWER_PROCESS_SCAN=off). */
export function processScanDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ["off", "0", "false", "no"].includes((env[PROCESS_SCAN_ENV] ?? "").trim().toLowerCase());
}

/** The process table, or null where `ps` is not available, fails, or the scan is turned off. */
export function listProcesses(env: NodeJS.ProcessEnv = process.env): ProcessInfo[] | null {
  if (process.platform === "win32" || processScanDisabled(env)) return null;
  try {
    const result = spawnSync("ps", ["-A", "-ww", "-o", "pid=,ppid=,uid=,lstart=,args="], {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, LC_ALL: "C" },
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0 || !result.stdout) return null;
    return parsePs(result.stdout);
  } catch {
    return null;
  }
}

/**
 * A CLI entry (cli.js, cli.ts or a `dr` binary), its global options (`--codebase-path` takes a
 * value), then the `visualize` command.
 */
const LAUNCHER_COMMAND =
  /(?:^|\s)(?:\S*\/)?(?:cli\.(?:js|mjs|cjs|ts)|dr)(?:\s+(?:--codebase-path(?:=\S+|\s+\S+)|-{1,2}[\w-]+(?:=\S+)?))*\s+visualize(?:\s|$)/;
/** `dr visualize --list` and `--stop` are not viewers. */
const MANAGEMENT_FLAG = /\s--(?:list|stop)(?:[\s=]|$)/;
const SERVER_SCRIPT = /\/dist\/server-entry\.js(?:\s|$)/;
const VISUALIZE_ARG = /(?:^|\s)visualize(?:\s|$)/;

/** Whether a command line has the shape of a `dr visualize` launcher (not a `--list` or `--stop` run). */
export function isLauncherCommand(command: string): boolean {
  return LAUNCHER_COMMAND.test(command) && !MANAGEMENT_FLAG.test(command);
}

/** Whether a command line runs some `dist/server-entry.js` (the dr CLI's or anyone's). */
export function isServerCommand(command: string): boolean {
  return SERVER_SCRIPT.test(command);
}

/** Whether a command line has a `visualize` argument and is not a `--list` or `--stop` run. */
export function hasVisualizeArgument(command: string): boolean {
  return VISUALIZE_ARG.test(command) && !MANAGEMENT_FLAG.test(command);
}

/** The `dist/server-entry.js` paths a command line could be naming (a path may hold spaces). */
export function serverScriptCandidates(command: string): string[] {
  const end = command.search(SERVER_SCRIPT);
  if (end < 0) return [];
  const script = command.slice(0, end + "/dist/server-entry.js".length);
  const candidates: string[] = [];
  for (let index = 0; index < script.length; index++) {
    if (script[index] === "/" && (index === 0 || script[index - 1] === " ")) candidates.push(script.slice(index));
  }
  // The shortest path first: the script is the last argument, so the runtime's path is not it.
  return candidates.reverse();
}

/**
 * Whether a command line's `dist/server-entry.js` is the dr CLI's: the `package.json` beside its
 * `dist/` names the dr CLI. True, false (another package's), or null when no such file can be read.
 */
export function isDrServerScript(command: string): boolean | null {
  let sawPackage = false;
  for (const script of serverScriptCandidates(command)) {
    const manifest = join(dirname(dirname(script)), "package.json");
    try {
      if (!existsSync(script) || !existsSync(manifest)) continue;
      sawPackage = true;
      if (JSON.parse(readFileSync(manifest, "utf8")).name === DR_CLI_PACKAGE) return true;
    } catch {
      // Unreadable: try the next candidate.
    }
  }
  return sawPackage ? false : null;
}

export interface FindViewerProcessesOptions {
  /** Launcher pids the registry names: listed even with no server under them (still loading). */
  knownLaunchers?: ReadonlySet<number>;
  /** The process doing the looking; never listed. */
  selfPid?: number;
  /** The current user's id; processes of others are counted, not listed. Null: everyone's count. */
  uid?: number | null;
  /** Whether a command line's server script is the dr CLI's (default: its package.json). */
  isDrServer?: (command: string) => boolean | null;
}

/**
 * The viewers in a process table: each dr server with the launcher above it, and each dr server
 * left behind by a launcher that died. See the module comment for what counts.
 */
export function scanViewerProcesses(processes: ProcessInfo[], options: FindViewerProcessesOptions = {}): ViewerProcessScan {
  const knownLaunchers = options.knownLaunchers ?? new Set<number>();
  const selfPid = options.selfPid ?? process.pid;
  const uid = options.uid === undefined ? (process.getuid?.() ?? null) : options.uid;
  const isDrServer = options.isDrServer ?? isDrServerScript;
  const byPid = new Map(processes.map((info) => [info.pid, info]));
  const mine = (info: ProcessInfo) => uid === null || info.uid === undefined || info.uid === null || info.uid === uid;

  const scan: ViewerProcessScan = { viewers: [], candidates: [], otherUsers: 0 };
  const paired = new Set<number>();
  for (const server of processes) {
    if (server.pid === selfPid || !isServerCommand(server.command)) continue;
    const confirmed = isDrServer(server.command);
    if (confirmed === false) continue;
    if (!mine(server)) {
      if (confirmed) scan.otherUsers++;
      continue;
    }
    if (confirmed === null) {
      scan.candidates.push(server.pid);
      continue;
    }
    const parent = byPid.get(server.ppid);
    // The parent counts as its launcher only when it is a dr launcher (a CLI entry running
    // `visualize`), not anything with a `visualize` argument, such as `make visualize`.
    const launcher =
      parent && parent.pid !== selfPid && parent.pid > 1 && isLauncherCommand(parent.command) && mine(parent) ? parent : null;
    if (launcher) paired.add(launcher.pid);
    scan.viewers.push({
      launcherPid: launcher?.pid ?? null,
      serverPid: server.pid,
      startedAt: (launcher ?? server).startedAt,
      command: (launcher ?? server).command,
    });
  }

  // A launcher the registry names that has not started its server yet: its record vouches for it.
  for (const pid of knownLaunchers) {
    const info = byPid.get(pid);
    if (!info || paired.has(pid) || pid === selfPid || !mine(info) || !isLauncherCommand(info.command)) continue;
    scan.viewers.push({ launcherPid: pid, serverPid: null, startedAt: info.startedAt, command: info.command });
  }
  return scan;
}

/** The viewers in a process table (see scanViewerProcesses, which also says what it could not confirm). */
export function findViewerProcesses(processes: ProcessInfo[], options: FindViewerProcessesOptions = {}): ViewerProcess[] {
  return scanViewerProcesses(processes, options).viewers;
}

function lsofField(args: string[], prefix: string): string[] {
  try {
    const result = spawnSync("lsof", args, { encoding: "utf8", timeout: 3000 });
    return (result.stdout ?? "")
      .split("\n")
      .filter((line) => line.startsWith(prefix))
      .map((line) => line.slice(prefix.length));
  } catch {
    return [];
  }
}

/** A process's working directory, or null when it cannot be read. */
export function processCwd(pid: number): string | null {
  if (process.platform === "linux") {
    try {
      return readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      // Fall through to lsof.
    }
  }
  if (process.platform === "win32") return null;
  return lsofField(["-a", "-p", String(pid), "-d", "cwd", "-Fn"], "n")[0] ?? null;
}

/** The TCP port a process listens on, or null when it has none or it cannot be read. */
export function listeningPort(pid: number): number | null {
  if (process.platform === "win32") return null;
  for (const name of lsofField(["-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-P", "-n", "-Fn"], "n")) {
    const match = /:(\d+)$/.exec(name);
    if (match) return Number(match[1]);
  }
  return null;
}

/** The project a viewer started in `cwd` serves: the nearest folder up holding documentation-robotics/. */
export function projectRootFromCwd(cwd: string): string {
  let current = cwd;
  for (let depth = 0; depth < 32; depth++) {
    if (existsSync(join(current, "documentation-robotics"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return cwd;
}

/**
 * Whether a pid could (still) be a `dr visualize` process: false when its command line has no
 * `visualize` argument, true when it has one, null when the command line cannot be read. A
 * recorded pid that is alive but is some other program was reused after the viewer died (a
 * reboot does this to every record). False is enough to drop a record. True is NOT enough to
 * signal the pid: that takes the checks in viewer-control.ts.
 */
export function looksLikeViewer(pid: number): boolean | null {
  if (process.platform === "win32") return null;
  try {
    const result = spawnSync("ps", ["-ww", "-o", "args=", "-p", String(pid)], { encoding: "utf8", timeout: 3000 });
    const command = (result.stdout ?? "").trim();
    if (result.error || !command) return null;
    return hasVisualizeArgument(command);
  } catch {
    return null;
  }
}

/**
 * When a process started, as `ps` reports it (ISO, whole seconds), or null when it cannot be read
 * (no such pid, no ps). Compared before each signal of a stop, so a pid that was reused while the
 * stop waited is not signalled.
 */
export function processStartTime(pid: number): string | null {
  if (process.platform === "win32" || pid <= 0) return null;
  try {
    const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 3000,
      env: { ...process.env, LC_ALL: "C" },
    });
    const text = (result.stdout ?? "").trim();
    if (result.error || !text) return null;
    const started = new Date(text);
    return Number.isNaN(started.getTime()) ? null : started.toISOString();
  } catch {
    return null;
  }
}

/**
 * Whether the dr server under a launcher pid listens on a port: true or false, or null when the
 * process table or the port cannot be read. A viewer from before 0.7.0 does not name itself on
 * /health, so this is how its record is tied to the viewer answering on its port.
 */
export function launcherServesPort(launcherPid: number, port: number, env: NodeJS.ProcessEnv = process.env): boolean | null {
  const table = listProcesses(env);
  if (!table) return null;
  const viewer = scanViewerProcesses(table, { knownLaunchers: new Set([launcherPid]) }).viewers.find(
    (candidate) => candidate.launcherPid === launcherPid
  );
  if (!viewer || viewer.serverPid === null) return false;
  const listening = listeningPort(viewer.serverPid);
  return listening === null ? null : listening === port;
}

/**
 * Whether a pid is a zombie: a process that has exited but whose parent has not collected it
 * yet. A signal-0 check still finds it, so a stop that waits for "no such pid" would wait out its
 * whole timeout on a viewer that is already gone.
 */
export function isZombie(pid: number): boolean {
  if (process.platform === "win32") return false;
  try {
    const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8", timeout: 3000 });
    return (result.stdout ?? "").trim().startsWith("Z");
  } catch {
    return false;
  }
}
