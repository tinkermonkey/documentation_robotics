/**
 * Whether a process is still running (issue 1275).
 *
 * `process.kill(pid, 0)` succeeds for a zombie: a process that has exited but that its parent has
 * not reaped yet. An orphan is handed to PID 1 and is reaped only if PID 1 reaps adopted children,
 * which it doesn't in a container without an init (Docker without `--init`, some CI and dev
 * containers). There a signal-0 check reports an exited orphan running forever.
 *
 * So on Linux a pid also counts as gone when /proc shows every thread of it as exited: zombie (Z)
 * or dead (X). Every thread, not the main thread alone: when a multi-threaded process (node, bun)
 * is killed, its main thread can show Z while the others are still exiting and the process still
 * holds its port. Elsewhere there is no /proc, and the signal-0 check stands.
 *
 * One check, shared by the viewer registry, the central server record, `parent-watch` and the
 * tests.
 */

import { readdirSync, readFileSync } from "node:fs";

/** The state letter in a /proc stat file, or null when it cannot be read. */
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
 * Whether /proc shows every thread of `pid` as exited (Z or X). Null when /proc has nothing to
 * say: not Linux, or no such process.
 */
export function procShowsExited(pid: number, procRoot = "/proc"): boolean | null {
  let threads: string[];
  try {
    threads = readdirSync(`${procRoot}/${pid}/task`);
  } catch {
    return null;
  }
  // A thread that vanished between the listing and the read has exited too.
  return threads.every((tid) => {
    const state = statState(`${procRoot}/${pid}/task/${tid}/stat`);
    return state === null || state === "Z" || state === "X";
  });
}

/**
 * Whether `pid` names a running process: it exists (EPERM means it exists but belongs to someone
 * else) and, where /proc says, has a thread that has not exited. A process that has exited counts
 * as gone whether or not it was reaped.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  return procShowsExited(pid) !== true;
}
