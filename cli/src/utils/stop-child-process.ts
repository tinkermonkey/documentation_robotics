/**
 * Stopping a child process for certain: signal it, wait, and force-kill it if it is still there.
 *
 * `ChildProcess.killed` cannot be used for the "is it still there" check. It is true as soon as
 * kill() has sent a signal, whether or not the process exited, so a fallback guarded by
 * `!child.killed` never runs after the first signal (#1235: the visualization server was left
 * running by a launcher that believed it had stopped it).
 */

import type { ChildProcess } from "node:child_process";

/** How a child process ended up stopped. */
export type StopOutcome =
  /** It had exited before anything was sent. */
  | "already-exited"
  /** It exited on the signal, within the time allowed. */
  | "exited"
  /** It was still running when the time was up, and was sent SIGKILL. */
  | "force-killed";

/** How long to wait for a process to go after SIGKILL, which cannot be caught or ignored. */
const SIGKILL_WAIT_MS = 2000;

/**
 * Whether a child process has terminated: exitCode or signalCode is set only once it has.
 */
export function hasExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

/**
 * Send `signal` to `proc` and wait up to `timeoutMs` for it to exit; if it has not, send SIGKILL
 * and wait for that. Resolves once the process is gone (or SIGKILL has had its wait), never rejects.
 */
export async function stopChildProcess(
  proc: ChildProcess,
  signal: NodeJS.Signals,
  timeoutMs: number
): Promise<StopOutcome> {
  if (hasExited(proc)) return "already-exited";

  const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  const exitedWithin = async (ms: number): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    });
    try {
      return await Promise.race([exited.then(() => true), timedOut]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    proc.kill(signal);
  } catch {
    // The process went away between the check and the signal
  }
  if ((await exitedWithin(timeoutMs)) || hasExited(proc)) return "exited";

  try {
    proc.kill("SIGKILL");
  } catch {
    // Already gone
  }
  await exitedWithin(SIGKILL_WAIT_MS);
  return "force-killed";
}
