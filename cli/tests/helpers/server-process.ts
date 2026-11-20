/**
 * Stopping a `dr visualize` process a test started.
 *
 * kill() only sends the signal. A test that then deletes the project folder, or returns, races the
 * server's shutdown, and a server that loses the race is left running after the test run (#1235).
 * Wait for the process to exit, and force-kill it if it has not.
 */

/** A process from Bun.spawn (`exited`) or node:child_process (`once("exit")`). */
interface StoppableProcess {
  kill(signal?: number | NodeJS.Signals): unknown;
  exited?: Promise<unknown>;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | string | null;
  once?(event: "exit", listener: () => void): unknown;
}

/**
 * Longer than the launcher's own wait for its server (3s to exit, then SIGKILL), so the launcher
 * gets to finish stopping the server before it is force-killed itself.
 */
const DEFAULT_STOP_TIMEOUT_MS = 8000;

function exitOf(proc: StoppableProcess): Promise<unknown> {
  if (proc.exited) return proc.exited;
  if (proc.exitCode != null || proc.signalCode != null) return Promise.resolve();
  return new Promise<void>((resolve) => proc.once?.("exit", () => resolve()));
}

/**
 * Send SIGTERM and wait for the process to exit; SIGKILL it after `timeoutMs`.
 * Returns whether it exited without being force-killed. Does nothing for null.
 */
export async function stopServerProcess(
  proc: StoppableProcess | null | undefined,
  timeoutMs: number = DEFAULT_STOP_TIMEOUT_MS
): Promise<boolean> {
  if (!proc) return true;
  const exited = exitOf(proc).then(() => true);
  try {
    proc.kill();
  } catch {
    // Already gone
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const clean = await Promise.race([exited, timedOut]);
  if (timer) clearTimeout(timer);
  if (!clean) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // Already gone
    }
    await exited;
  }
  return clean;
}
