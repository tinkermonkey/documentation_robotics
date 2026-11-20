/**
 * Finding `dr visualize` processes without the registry.
 *
 * A viewer is two processes: the launcher (`<runtime> <cli entry> visualize ...`) and the server
 * it runs (`<runtime> .../dist/server-entry.js`). The registry (viewer-registry.ts) records the
 * launcher, but a record can be missing: an older CLI kept one record per project and a later
 * `dr visualize` in the same folder replaced it (#1237). This module finds viewers from the
 * process table instead, with each one's working directory and listening port, so `dr visualize
 * --list` and `--stop` reach those too.
 *
 * Uses `ps` and `lsof` (and /proc on Linux). Where they are missing (Windows) the scan returns
 * null and callers fall back to the registry alone.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readlinkSync } from "node:fs";
import { dirname, join } from "node:path";

/** One row of the process table. */
export interface ProcessInfo {
  pid: number;
  ppid: number;
  /** ISO timestamp of when the process started, or "" when ps did not say. */
  startedAt: string;
  command: string;
}

/** A viewer found in the process table. */
export interface ViewerProcess {
  /** The `dr visualize` launcher, or null when only its server is left (the launcher was killed). */
  launcherPid: number | null;
  /** The server process, or null when the launcher has not started one (it is still loading). */
  serverPid: number | null;
  /** When the launcher (or the orphaned server) started. */
  startedAt: string;
  command: string;
}

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/;

/** Parses `ps -A -ww -o pid=,ppid=,lstart=,args=` output (C locale). */
export function parsePs(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of output.split("\n")) {
    const match = PS_LINE.exec(line);
    if (!match) continue;
    const started = new Date(match[3]);
    processes.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      startedAt: Number.isNaN(started.getTime()) ? "" : started.toISOString(),
      command: match[4].trim(),
    });
  }
  return processes;
}

/** The process table, or null where `ps` is not available or fails. */
export function listProcesses(): ProcessInfo[] | null {
  if (process.platform === "win32") return null;
  try {
    const result = spawnSync("ps", ["-A", "-ww", "-o", "pid=,ppid=,lstart=,args="], {
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

/** A CLI entry (cli.js, cli.ts or a `dr` binary), any options, then the `visualize` command. */
const LAUNCHER_COMMAND = /(?:^|\s)(?:\S*\/)?(?:cli\.(?:js|mjs|cjs|ts)|dr)(?:\s+-{1,2}[\w-]+)*\s+visualize(?:\s|$)/;
/** `dr visualize --list` and `--stop` are not viewers. */
const MANAGEMENT_FLAG = /\s--(?:list|stop)(?:[\s=]|$)/;
const SERVER_COMMAND = /\/dist\/server-entry\.js(?:\s|$)/;

/** Whether a command line is a `dr visualize` launcher (not a `--list` or `--stop` run). */
export function isLauncherCommand(command: string): boolean {
  return LAUNCHER_COMMAND.test(command) && !MANAGEMENT_FLAG.test(command);
}

/** Whether a command line is the server a launcher runs. */
export function isServerCommand(command: string): boolean {
  return SERVER_COMMAND.test(command);
}

/**
 * The viewers in a process table: each launcher with its server, and each server whose launcher
 * is gone. A launcher-shaped command with no server child is left out unless `knownLaunchers`
 * names it: without the server it cannot be told from another program's `cli.js visualize`.
 */
export function findViewerProcesses(
  processes: ProcessInfo[],
  knownLaunchers: ReadonlySet<number> = new Set(),
  selfPid: number = process.pid
): ViewerProcess[] {
  const servers = processes.filter((info) => isServerCommand(info.command));
  const found: ViewerProcess[] = [];
  const paired = new Set<number>();

  for (const info of processes) {
    if (info.pid === selfPid) continue;
    const known = knownLaunchers.has(info.pid);
    if (!known && !isLauncherCommand(info.command)) continue;
    const server = servers.find((candidate) => candidate.ppid === info.pid);
    if (!server && !known) continue;
    if (server) paired.add(server.pid);
    found.push({
      launcherPid: info.pid,
      serverPid: server?.pid ?? null,
      startedAt: info.startedAt,
      command: info.command,
    });
  }

  for (const server of servers) {
    if (paired.has(server.pid) || server.pid === selfPid) continue;
    // Only one handed to init when its launcher died counts. A server some other program runs
    // (a test's fixture) is not a viewer's to list or stop.
    if (server.ppid !== 1) continue;
    found.push({ launcherPid: null, serverPid: server.pid, startedAt: server.startedAt, command: server.command });
  }
  return found;
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
 * Whether a pid is (still) a `dr visualize` process: true or false from its command line, null
 * when that cannot be read. A recorded pid that is alive but is some other program was reused
 * after the viewer died (a reboot does this to every record), and must not be waited for or
 * signalled.
 */
export function looksLikeViewer(pid: number): boolean | null {
  if (process.platform === "win32") return null;
  try {
    const result = spawnSync("ps", ["-ww", "-o", "args=", "-p", String(pid)], { encoding: "utf8", timeout: 3000 });
    const command = (result.stdout ?? "").trim();
    if (result.error || !command) return null;
    return /(?:^|\s)visualize(?:\s|$)/.test(command);
  } catch {
    return null;
  }
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
