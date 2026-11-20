/**
 * When a viewer's server ends on its own (#1237).
 *
 * - Its project is gone: the project's documentation-robotics/ folder is missing on two checks in
 *   a row (a worktree that was removed, a checkout that was deleted). Any viewer.
 * - It is idle: no browser tab has been connected and no request has come in for the idle limit.
 *   Only a viewer given a limit, which is what review_open does for the viewers it starts
 *   (`dr visualize --idle-exit <hours>`); one run in a terminal has none.
 *
 * "Idle" is measured from the last sign of use: a request other than the health check, or a
 * browser tab's WebSocket opening or closing. While a tab is connected the viewer is never idle,
 * so a review left open overnight is still there in the morning. Health checks do not count:
 * review_open, project_status and `dr visualize --list` all probe a viewer without anyone using
 * it.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { viewerSetting } from "./viewer-settings.js";

/** What the server knows about its use. */
export interface ViewerActivity {
  /** Browser tabs connected now (WebSocket clients). */
  clients: number;
  /** When it was last used: a request other than /health, or a tab connecting or disconnecting. */
  lastActivityAt: number;
}

export interface ViewerLifetimeOptions {
  projectRoot: string;
  activity: () => ViewerActivity;
  /** Exit after this long idle. Absent or 0: never exit for idleness. */
  idleExitMs?: number;
  /** Called once, with the reason in words, when the server should end. */
  onExit: (reason: string) => void;
  /** How often to check (default: DR_VIEWER_LIFETIME_CHECK_MS, 30s, so a removed project ends its viewer within a minute). */
  intervalMs?: number;
  /** Injected for tests. */
  now?: () => number;
  exists?: (path: string) => boolean;
}

export interface ViewerLifetimeWatch {
  /** Runs one check now; returns the reason to exit, or null. */
  check(): string | null;
  stop(): void;
}


function describeDuration(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours >= 1) return `${Number(hours.toFixed(1))} hour${hours === 1 ? "" : "s"}`;
  const minutes = ms / 60_000;
  if (minutes >= 1) return `${Number(minutes.toFixed(1))} minute${minutes === 1 ? "" : "s"}`;
  return `${Number((ms / 1000).toFixed(1))} seconds`;
}

/** Watches a viewer's project folder and its idleness, and says when its server should end. */
export function watchViewerLifetime(options: ViewerLifetimeOptions): ViewerLifetimeWatch {
  const now = options.now ?? Date.now;
  const exists = options.exists ?? existsSync;
  const modelFolder = join(options.projectRoot, "documentation-robotics");
  let missingChecks = 0;
  let done = false;

  const check = (): string | null => {
    // Twice in a row: a branch switch or a rebase can take the folder away for a moment.
    missingChecks = exists(modelFolder) ? 0 : missingChecks + 1;
    if (missingChecks >= 2) return `its project folder is gone (${modelFolder})`;

    if (options.idleExitMs && options.idleExitMs > 0) {
      const { clients, lastActivityAt } = options.activity();
      if (clients === 0 && now() - lastActivityAt >= options.idleExitMs) {
        return `no browser tab was connected and no request came in for ${describeDuration(options.idleExitMs)}`;
      }
    }
    return null;
  };

  let timer: ReturnType<typeof setInterval> | undefined = setInterval(() => {
    if (done) return;
    const reason = check();
    if (reason === null) return;
    done = true;
    stop();
    options.onExit(reason);
  }, options.intervalMs ?? viewerSetting("lifetimeCheckMs"));
  timer.unref?.();
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  return { check, stop };
}
