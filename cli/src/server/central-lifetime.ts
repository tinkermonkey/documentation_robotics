/**
 * The central DR process's lifetime (issue 1279, `docs/design/USER_LEVEL_DR.md` section 7,
 * "Lifecycle and the registry"): how it starts, records itself, sweeps the per-project viewers it
 * replaces, ends when idle and removes its record.
 *
 * `dr serve` (commands/serve.ts) launches `serve-entry.ts`, which calls `runCentralProcess` with
 * the real server (`startCentralServer`). Everything the process touches is injected here, so the
 * tests run it against a fake server, a fake sweep and a fake clock.
 *
 * - **One process per farm.** It refuses to start while the farm's record names another live
 *   process, and checks again once it listens, so two starts racing each other leave one running.
 * - **Port:** 8080, or the next free one (`--port` changes where the search starts). Recorded, so
 *   a stray process on 8080 can't block DR.
 * - **Record:** `servers/<farm-hash>.json` with its 0600 token file (server-record.ts), written
 *   once the server listens and removed when it stops. A crash leaves a record that
 *   `sweepServerRecords` clears on the next read.
 * - **Idle exit:** after `DR_VIEWER_IDLE_HOURS` (24; 0 means never) with no browser tab, no MCP
 *   session, no DrBot turn and no request other than `/health`. The per-project viewer's other
 *   exit, its project folder going away, does not apply: the central process serves every
 *   checkout of the farm, and a removed checkout closes its context instead (slice 2A).
 */

import { randomBytes, randomUUID } from "node:crypto";
import { isPortFree } from "../commands/visualize.js";
import { loadFarm, ProjectRegistry, type FarmLocation } from "../core/project-registry.js";
import type { ServerRecord } from "../core/checkout-types.js";
import { isProcessAlive } from "../utils/process-liveness.js";
import type { CentralActivity, CentralServer, CentralServerOptions, StartCentralServer } from "./central-server-contract.js";
import { sweepPerProjectViewers, type PerProjectViewerSweep, type SweepPerProjectViewersOptions } from "./legacy-viewer-sweep.js";
import { findRunningServer, removeServerRecord, sweepServerRecords, writeServerRecord } from "./server-record.js";
import { viewerSetting } from "./viewer-settings.js";

/** For tests only: a module path whose `startCentralServer` serve-entry runs instead of the real server. */
export const SERVE_TEST_STARTER_ENV = "DR_SERVE_TEST_STARTER";

/** serve-entry's exit code when another process already serves the farm. */
export const EXIT_ALREADY_RUNNING = 3;

/** The port the central process tries first. */
export const DEFAULT_SERVE_PORT = 8080;

// ---------------------------------------------------------------------------------------------
// Idle exit
// ---------------------------------------------------------------------------------------------

/** A duration in words ("24 hours", "90 seconds"), as the exit reason says it. */
export function describeDuration(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours >= 1) return `${Number(hours.toFixed(1))} hour${hours === 1 ? "" : "s"}`;
  const minutes = ms / 60_000;
  if (minutes >= 1) return `${Number(minutes.toFixed(1))} minute${minutes === 1 ? "" : "s"}`;
  return `${Number((ms / 1000).toFixed(1))} seconds`;
}

/** The idle limit in effect: `DR_VIEWER_IDLE_HOURS` (default 24) in ms; 0 means never. */
export function centralIdleMs(env: NodeJS.ProcessEnv = process.env): number {
  return viewerSetting("idleHours", env) * 3_600_000;
}

/**
 * Why the process should end for idleness, or null. Idle means nothing is connected (no tab, no
 * MCP session, no DrBot turn) and nothing but `/health` came in for `idleMs`. A connection holds
 * the process however long it lasts; the limit runs from when the last one went.
 */
export function centralIdleReason(activity: CentralActivity, idleMs: number, now: number): string | null {
  if (!(idleMs > 0)) return null;
  if (activity.clients > 0 || activity.mcpSessions > 0 || activity.drBotTurns > 0) return null;
  if (now - activity.lastActivityAt < idleMs) return null;
  return (
    `no browser tab, MCP session or DrBot turn was connected and no request came in for ` +
    describeDuration(idleMs)
  );
}

export interface CentralIdleOptions {
  activity: () => CentralActivity;
  /** Idle limit in ms. Absent or 0: never exit for idleness. */
  idleMs?: number;
  /** Called once, with the reason in words, when the process should end. */
  onExit: (reason: string) => void;
  /** How often to check (default: DR_VIEWER_LIFETIME_CHECK_MS, 30s). */
  intervalMs?: number;
  now?: () => number;
}

export interface CentralIdleWatch {
  /** Runs one check now; returns the reason to exit, or null. */
  check(): string | null;
  stop(): void;
}

/** Watches the central process's activity and says when it has been idle for its limit. */
export function watchCentralIdle(options: CentralIdleOptions): CentralIdleWatch {
  const now = options.now ?? Date.now;
  const idleMs = options.idleMs ?? 0;
  const check = () => centralIdleReason(options.activity(), idleMs, now());
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  if (idleMs > 0) {
    timer = setInterval(() => {
      const reason = check();
      if (reason === null) return;
      stop();
      options.onExit(reason);
    }, options.intervalMs ?? viewerSetting("lifetimeCheckMs"));
    timer.unref?.();
  }
  return { check, stop };
}

// ---------------------------------------------------------------------------------------------
// Port and token
// ---------------------------------------------------------------------------------------------

/** The first free port from `start` (default 8080). */
export async function chooseServePort(
  start: number = DEFAULT_SERVE_PORT,
  isFree: (port: number) => Promise<boolean> = isPortFree
): Promise<number> {
  if (!Number.isInteger(start) || start < 1 || start > 65535) {
    throw new Error(`Invalid port number: ${start}. Port must be between 1 and 65535.`);
  }
  for (let port = start; port <= 65535; port++) {
    if (await isFree(port)) return port;
  }
  throw new Error(`No free port from ${start} up.`);
}

/** A new token for the process: 32 random bytes, URL-safe. */
export function createServerToken(): string {
  return randomBytes(32).toString("base64url");
}

// ---------------------------------------------------------------------------------------------
// The process
// ---------------------------------------------------------------------------------------------

/** Another live process already serves the farm. */
export class CentralProcessRunningError extends Error {
  constructor(readonly record: ServerRecord) {
    super(
      `A DR process already serves this farm (${record.farmRoot}): pid ${record.pid}, ` +
        `http://127.0.0.1:${record.port}/. Use it, or stop it first with: dr serve --stop`
    );
    this.name = "CentralProcessRunningError";
  }
}

export interface RunCentralProcessOptions {
  farm: FarmLocation;
  /** The server to run: `startCentralServer` in production, a fake in tests. */
  startServer: StartCentralServer;
  /** Where the port search starts (default 8080). */
  port?: number;
  /** The process that started this one (`dr serve`), recorded and left alone by the sweep. */
  launcherPid?: number;
  cliVersion: string;
  /** Passed through to the server. */
  serverOptions?: Pick<CentralServerOptions, "pool" | "viewerPath" | "withChangesets" | "withDanger">;
  /** Called once when the process has been idle for its limit. */
  onIdleExit?: (reason: string) => void;
  /** Lines to log (default: console.log). */
  log?: (line: string) => void;

  // Injected for tests.
  env?: NodeJS.ProcessEnv;
  pid?: number;
  isAlive?: (pid: number) => boolean;
  isPortFree?: (port: number) => Promise<boolean>;
  openRegistry?: (farm: FarmLocation) => Promise<ProjectRegistry>;
  sweepViewers?: (options: SweepPerProjectViewersOptions) => Promise<PerProjectViewerSweep>;
  /** Idle limit in ms (default: `centralIdleMs(env)`). */
  idleMs?: number;
  idleCheckMs?: number;
  now?: () => number;
  token?: string;
  serverId?: string;
}

export interface CentralProcess {
  record: ServerRecord;
  server: CentralServer;
  serverId: string;
  /** What the start-up sweep stopped and kept; null when it failed (the failure is logged). */
  sweep: PerProjectViewerSweep | null;
  idle: CentralIdleWatch;
  /** Stops the server and removes this process's record. Safe to call more than once. */
  stop(): Promise<void>;
}

async function defaultOpenRegistry(farm: FarmLocation): Promise<ProjectRegistry> {
  return ProjectRegistry.fromManifest(farm, await loadFarm(farm, { create: false }));
}

/** Lines describing a start-up sweep, for the process's log. */
export function describeViewerSweep(sweep: PerProjectViewerSweep): string[] {
  const lines: string[] = [];
  const where = (root: string | null, port: number | null) => `${root ?? "(unknown project)"}${port ? ` on port ${port}` : ""}`;
  lines.push(
    `Per-project viewers: stopped ${sweep.stopped.length}, kept ${sweep.kept.length}.`
  );
  for (const { viewer, outcome } of sweep.stopped) {
    lines.push(`  stopped (${outcome}): ${where(viewer.projectRoot, viewer.port)}, pid ${viewer.serverPid ?? viewer.pid}`);
  }
  for (const { viewer, reason } of sweep.kept) {
    const pids = [viewer.pid, viewer.serverPid].filter((pid): pid is number => pid !== null).join(", ");
    lines.push(`  kept (${reason}): ${where(viewer.projectRoot, viewer.port)}, pids ${pids || "unknown"}`);
  }
  for (const caveat of sweep.caveats) lines.push(`  note: ${caveat}`);
  return lines;
}

/**
 * Starts the central process for `farm`: refuses when another live process serves it, picks the
 * port, creates the token, starts the server, writes the record and its token file, sweeps the
 * per-project viewers it replaces and starts the idle watch.
 */
export async function runCentralProcess(options: RunCentralProcessOptions): Promise<CentralProcess> {
  const env = options.env ?? process.env;
  const pid = options.pid ?? process.pid;
  const isAlive = options.isAlive ?? isProcessAlive;
  const log = options.log ?? ((line: string) => console.log(line));
  const farmRoot = options.farm.root;

  const otherProcess = async (): Promise<ServerRecord | null> => {
    const running = await findRunningServer(farmRoot, { env, isAlive });
    return running && running.record.pid !== pid ? running.record : null;
  };

  // Clear what gone processes left, then refuse if one is still serving this farm.
  await sweepServerRecords({ env, isAlive });
  const before = await otherProcess();
  if (before) throw new CentralProcessRunningError(before);

  const port = await chooseServePort(options.port ?? DEFAULT_SERVE_PORT, options.isPortFree);
  const token = options.token ?? createServerToken();
  const serverId = options.serverId ?? randomUUID();
  const registry = await (options.openRegistry ?? defaultOpenRegistry)(options.farm);

  const server = await options.startServer({
    ...options.serverOptions,
    farm: options.farm,
    registry,
    port,
    token,
    serverId,
    ...(options.launcherPid !== undefined ? { launcherPid: options.launcherPid } : {}),
  });

  // Another start may have won the race while this one was starting: the first record stands.
  const raced = await otherProcess();
  if (raced) {
    await server.stop();
    throw new CentralProcessRunningError(raced);
  }

  const record = await writeServerRecord(
    {
      farmRoot,
      pid,
      port: server.port,
      cliVersion: options.cliVersion,
      startedAt: new Date((options.now ?? Date.now)()).toISOString(),
      ...(options.launcherPid !== undefined ? { launcherPid: options.launcherPid } : {}),
    },
    token,
    env
  );
  log(`[serve] Serving ${record.farmRoot} on http://127.0.0.1:${record.port}/ (pid ${pid})`);

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      idle.stop();
      try {
        await server.stop();
      } finally {
        await removeServerRecord(farmRoot, { env, pid });
      }
    })();
    return stopping;
  };

  const idle = watchCentralIdle({
    activity: () => server.activity(),
    idleMs: options.idleMs ?? centralIdleMs(env),
    intervalMs: options.idleCheckMs,
    now: options.now,
    onExit: (reason) => {
      log(`[serve] Stopping: ${reason}`);
      options.onIdleExit?.(reason);
    },
  });

  // The per-project viewers this process replaces. Never this process or its launcher.
  let sweep: PerProjectViewerSweep | null = null;
  try {
    const excludePids = [pid, options.launcherPid].filter((p): p is number => typeof p === "number");
    sweep = await (options.sweepViewers ?? sweepPerProjectViewers)({ excludePids });
    for (const line of describeViewerSweep(sweep)) log(`[serve] ${line}`);
  } catch (error) {
    log(`[serve] The sweep of per-project viewers failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { record, server, serverId, sweep, idle, stop };
}
