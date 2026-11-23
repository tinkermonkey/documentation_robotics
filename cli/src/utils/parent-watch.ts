/**
 * Noticing that the process that started this one is gone.
 *
 * A child is not told when its parent dies: it is handed to init and runs on. That is how a test
 * run that was interrupted left `dr visualize` launchers behind, and how a launcher that was
 * SIGKILLed left its server holding the port (#1236, #1237). The viewer's server always watches
 * its launcher; the launcher watches its own parent only when asked (`--exit-with-parent`),
 * because a viewer review_open starts is meant to outlive the session that started it.
 */

import { isProcessAlive } from "./process-liveness.js";

export interface ParentWatchOptions {
  /** How often to look (default 1s). */
  intervalMs?: number;
  /** Injected for tests; defaults to process.ppid. */
  parentPid?: () => number;
  /** Injected for tests; defaults to utils/process-liveness, which counts a zombie as gone. */
  isAlive?: (pid: number) => boolean;
}

export interface ParentWatch {
  stop(): void;
}

/**
 * Calls `onGone` once when the parent this process had at the time of the call is gone: its pid
 * no longer exists or it has exited and was left unreaped (a zombie, #1275), or this process has
 * been handed to another parent. Does nothing for a process that already has no parent of its own
 * (pid 1 or 0). The timer does not keep the process alive.
 */
export function watchParent(onGone: () => void, options: ParentWatchOptions = {}): ParentWatch {
  const parentPid = options.parentPid ?? (() => process.ppid);
  const isAlive = options.isAlive ?? isProcessAlive;
  const original = parentPid();
  if (original <= 1) return { stop: () => {} };

  let timer: ReturnType<typeof setInterval> | undefined = setInterval(() => {
    if (parentPid() === original && isAlive(original)) return;
    stop();
    onGone();
  }, options.intervalMs ?? 1000);
  timer.unref?.();
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  return { stop };
}
