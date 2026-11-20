/**
 * Whether a process a test watches has ended.
 *
 * `process.kill(pid, 0)` succeeds for a zombie: a process that has exited but that its parent has
 * not reaped yet. An orphaned `dr visualize` launcher or server is handed to PID 1 and is reaped
 * only if PID 1 reaps adopted children. In the release gate's container PID 1 is `npm` (bash
 * execs the script's last command), which never does, so every orphan that exits stays a zombie
 * for the life of the container and a signal-0 check reports it running forever.
 */

import { readdirSync, readFileSync } from "node:fs";

/** The state letter in a /proc stat file (Linux only), or null when it cannot be read. */
function statState(path: string): string | null {
  try {
    const stat = readFileSync(path, "utf8");
    // "<pid> (<comm>) <state> ...": comm may itself contain ") ", so read after the last one.
    return stat.slice(stat.lastIndexOf(")") + 2).charAt(0) || null;
  } catch {
    return null;
  }
}

/**
 * Whether /proc shows every thread of `pid` as exited: zombie (Z) or dead (X). Not the process's
 * own state alone: when a multi-threaded process (node, bun) is killed, its main thread can show
 * Z while the others are still exiting and the process still holds its sockets. Null when /proc
 * has nothing to say (not Linux, or no such process).
 */
function procExited(pid: number): boolean | null {
  let threads: string[];
  try {
    threads = readdirSync(`/proc/${pid}/task`);
  } catch {
    return null;
  }
  const states = threads.map((tid) => statState(`/proc/${pid}/task/${tid}/stat`));
  // A thread that vanished between the listing and the read has exited too.
  return states.every((state) => state === null || state === "Z" || state === "X");
}

/**
 * Whether `pid` names a process that is still running: it exists and, where /proc says, has a
 * thread that has not exited. A process that has exited counts as gone whether or not it was reaped.
 */
export function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  return procExited(pid) !== true;
}
