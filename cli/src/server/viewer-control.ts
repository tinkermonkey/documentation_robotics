/**
 * Listing and stopping running viewers (`dr visualize --list`, `--stop`, and review_open's
 * restart).
 *
 * The list joins the registry's records (viewer-registry.ts) with a scan of the process table
 * (viewer-processes.ts), so it also shows a viewer the registry has no record of: one whose
 * record a CLI before 0.7.0 let a later `dr visualize` replace, or a server left behind by a
 * launcher that was killed (#1237).
 *
 * A pid is signalled only when it is known to be a viewer's: the process scan found it, or,
 * where there is no scan, its record's port answers as a viewer. A recorded pid that another
 * program now holds is never signalled.
 */

import { getCliVersion } from "../utils/spec-version.js";
import {
  canonicalProjectRoot,
  isProcessAlive,
  listViewerRecords,
  removeViewerRecord,
  viewerHealth,
  type SweepResult,
  type ViewerHealth,
  type ViewerRecord,
  type ViewerStarter,
} from "./viewer-registry.js";
import {
  findViewerProcesses,
  isZombie,
  listProcesses,
  listeningPort,
  looksLikeViewer,
  processCwd,
  projectRootFromCwd,
  type ProcessInfo,
} from "./viewer-processes.js";
import { viewerSetting } from "./viewer-settings.js";

/** One running viewer, as `dr visualize --list` reports it. */
export interface RunningViewer {
  /** Real path of the project it serves; null when it could not be worked out. */
  projectRoot: string | null;
  /** The port it listens on; null when unknown (a lost viewer on a machine without lsof). */
  port: number | null;
  /** The `dr visualize` launcher's pid; null when only its server is left. */
  pid: number | null;
  /** The server process's pid; null when unknown. */
  serverPid: number | null;
  /** CLI version from its health check; null when it does not answer or predates 0.6.0. */
  cliVersion: string | null;
  /** Whether that version is older than this CLI's (false when the version is unknown). */
  outdated: boolean;
  /** ISO timestamp of when it started, or "". */
  startedAt: string;
  /** Who started it; null when the registry has no record or an older CLI wrote it. */
  startedBy: ViewerStarter | null;
  withChangesets: boolean | null;
  /** Hours of idleness after which it exits on its own; null when it never does or it is unknown. */
  idleExitHours: number | null;
  /** Whether the registry has a record of it. False: found by the process scan alone. */
  inRegistry: boolean;
  /** Whether its server answered its health check. */
  answering: boolean;
  /**
   * Whether its pids are known to be a viewer's: the process scan found them, or, where there is
   * no scan, its recorded port answers as a viewer. Only a verified viewer is signalled.
   */
  verified: boolean;
  /** The auth token from its record, for a link; null without a record or without auth. */
  token: string | null;
}

/** Compares dotted versions numerically ("0.10.0" > "0.9.1"); a pre-release tag sorts before its release. */
export function compareCliVersions(a: string, b: string): number {
  const split = (version: string) => {
    const [core, pre] = version.split("-", 2);
    return { parts: core.split(".").map((part) => Number.parseInt(part, 10) || 0), pre };
  };
  const left = split(a);
  const right = split(b);
  for (let index = 0; index < Math.max(left.parts.length, right.parts.length); index++) {
    const diff = (left.parts[index] ?? 0) - (right.parts[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === undefined) return 1;
  if (right.pre === undefined) return -1;
  return left.pre < right.pre ? -1 : 1;
}

/** Whether a viewer on `viewerVersion` is older than the CLI asking (unknown counts as older: before 0.6.0). */
export function isOlderViewer(viewerVersion: string | undefined | null, cliVersion: string = getCliVersion()): boolean {
  if (!viewerVersion) return true;
  return compareCliVersions(viewerVersion, cliVersion) < 0;
}

export interface ListRunningViewersDeps {
  env?: NodeJS.ProcessEnv;
  isAlive?: (pid: number) => boolean;
  /** The process table, or null where it cannot be read. */
  processes?: () => ProcessInfo[] | null;
  cwdOf?: (pid: number) => string | null;
  portOf?: (pid: number) => number | null;
  health?: (port: number, timeoutMs: number) => Promise<ViewerHealth | null>;
  cliVersion?: string;
  /** How long each viewer gets to answer its health check (default: DR_VIEWER_HEALTH_TIMEOUT_MS, 1.5s). */
  healthTimeoutMs?: number;
}

/** Every running viewer that could be found, and how complete that answer is. */
export interface ViewerSurvey {
  viewers: RunningViewer[];
  /**
   * Whether the process table could be read. False: only the registry was consulted, so a viewer
   * it has no record of is not in `viewers`. Whoever shows the list must say so.
   */
  processScan: boolean;
  /** What reading the registry removed: stale records, markers of dead starts, old logs. */
  swept: SweepResult;
}

/** Every running viewer on this machine (see surveyViewers, which also says how complete the list is). */
export async function listRunningViewers(deps: ListRunningViewersDeps = {}): Promise<RunningViewer[]> {
  return (await surveyViewers(deps)).viewers;
}

/**
 * Every running viewer on this machine: the registry's live records joined with the process
 * scan, with whether the scan was possible and what the registry sweep removed. A record whose
 * pid is alive but runs something other than `dr visualize` is a reused pid: it is removed (and
 * counted in `swept`), not listed.
 */
export async function surveyViewers(deps: ListRunningViewersDeps = {}): Promise<ViewerSurvey> {
  const env = deps.env ?? process.env;
  const isAlive = deps.isAlive ?? isProcessAlive;
  const health = deps.health ?? viewerHealth;
  const cwdOf = deps.cwdOf ?? processCwd;
  const portOf = deps.portOf ?? listeningPort;
  const cliVersion = deps.cliVersion ?? getCliVersion();
  const timeoutMs = deps.healthTimeoutMs ?? viewerSetting("healthTimeoutMs", env);

  const { records, swept } = await listViewerRecords({ env, isAlive });
  const table = (deps.processes ?? listProcesses)();
  const scanned = table ? findViewerProcesses(table, new Set(records.map((record) => record.pid))) : null;

  const viewers: RunningViewer[] = [];
  const describe = async (
    base: Omit<RunningViewer, "cliVersion" | "outdated" | "answering" | "verified">,
    scanned: boolean
  ): Promise<RunningViewer> => {
    const answer = base.port === null ? null : await health(base.port, timeoutMs);
    const version = answer?.cliVersion ?? null;
    return {
      ...base,
      cliVersion: version,
      // A viewer that answers without a version predates 0.6.0; one that does not answer is unknown.
      outdated: answer ? isOlderViewer(version, cliVersion) : false,
      answering: answer !== null,
      verified: scanned || (table === null && answer !== null),
    };
  };

  await Promise.all(
    records.map(async (record: ViewerRecord) => {
      const proc = scanned?.find((candidate) => candidate.launcherPid === record.pid);
      const isViewerProcess = table ? isLauncherShaped(table, record.pid) : null;
      if (isViewerProcess === false) {
        // The pid went to another program after the viewer died. If a viewer still answers on
        // the recorded port, the scan lists it under its own pids.
        const removed = await removeViewerRecord(record.projectRoot, { env, pid: record.pid }).catch(() => [] as string[]);
        swept.removed.push(...removed);
        swept.records += removed.length;
        return;
      }
      const viewer = await describe({
        projectRoot: record.projectRoot,
        port: record.port,
        pid: record.pid,
        serverPid: proc?.serverPid ?? record.serverPid ?? null,
        startedAt: record.startedAt || proc?.startedAt || "",
        startedBy: record.startedBy ?? null,
        withChangesets: record.withChangesets,
        idleExitHours: record.idleExitHours ?? null,
        inRegistry: true,
        token: record.token,
      }, isViewerProcess === true);
      viewers.push(viewer);
    })
  );

  await Promise.all(
    (scanned ?? []).map(async (proc) => {
      // Recorded viewers are listed above (or were dropped as a reused pid).
      if (proc.launcherPid !== null && records.some((record) => record.pid === proc.launcherPid)) return;
      const cwd = cwdOf(proc.launcherPid ?? proc.serverPid!) ?? (proc.serverPid ? cwdOf(proc.serverPid) : null);
      const viewer = await describe({
        projectRoot: cwd ? canonicalProjectRoot(projectRootFromCwd(cwd)) : null,
        port: proc.serverPid ? portOf(proc.serverPid) : null,
        pid: proc.launcherPid,
        serverPid: proc.serverPid,
        startedAt: proc.startedAt,
        startedBy: null,
        withChangesets: /\s--with-changesets(?:\s|$)/.test(proc.command) ? true : proc.launcherPid ? false : null,
        idleExitHours: null,
        inRegistry: false,
        token: null,
      }, true);
      // A server with no launcher is taken for a viewer's only when it answers as one.
      if (proc.launcherPid === null && !viewer.answering) return;
      viewers.push(viewer);
    })
  );

  viewers.sort(
    (a, b) =>
      (a.projectRoot ?? "~").localeCompare(b.projectRoot ?? "~") ||
      a.startedAt.localeCompare(b.startedAt) ||
      (a.port ?? 0) - (b.port ?? 0)
  );
  return { viewers, processScan: table !== null, swept };
}

/** Whether the process table shows `pid` running something with a `visualize` argument. */
function isLauncherShaped(table: ProcessInfo[], pid: number): boolean | null {
  const info = table.find((candidate) => candidate.pid === pid);
  if (!info) return null; // Started or exited since the listing.
  return /(?:^|\s)visualize(?:\s|$)/.test(info.command);
}

export type StopOutcome =
  /** It exited on SIGTERM. */
  | "stopped"
  /** It was still running after the wait and was sent SIGKILL. */
  | "force-killed"
  /** There was no live process to stop. */
  | "not-running"
  /** The process belongs to another user. */
  | "not-permitted"
  /** Its pids could not be confirmed to be a viewer's, so nothing was signalled. */
  | "unverified";

export interface StopViewerOptions {
  env?: NodeJS.ProcessEnv;
  /** How long the launcher gets to stop its server and exit before SIGKILL (default: DR_VIEWER_STOP_TIMEOUT_MS, 8s). */
  timeoutMs?: number;
  isAlive?: (pid: number) => boolean;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  pollMs?: number;
}

/**
 * The stop timeout's default (DR_VIEWER_STOP_TIMEOUT_MS, 8s) is longer than the launcher's own
 * wait for its server (3s to exit, then SIGKILL), so the launcher gets to finish stopping the
 * server and remove its record before it is force-killed itself. A server that is left when its
 * launcher is gone gets the same 3s the launcher would have given it.
 */
const SERVER_STOP_TIMEOUT_MS = 3000;
const SIGKILL_WAIT_MS = 2000;

/**
 * Stops one viewer and waits for it to be gone: SIGTERM to its launcher, which stops its server;
 * SIGKILL if it is still there after the wait; then the server itself, if it outlived the
 * launcher or had none. Its record is removed. Never signals pid 1 or this process.
 */
export async function stopViewer(viewer: RunningViewer, options: StopViewerOptions = {}): Promise<StopOutcome> {
  // A process that has exited but that its parent has not collected yet still has a pid.
  const isAlive = options.isAlive ?? ((pid: number) => isProcessAlive(pid) && !isZombie(pid));
  const kill = options.kill ?? ((pid: number, signal: NodeJS.Signals) => void process.kill(pid, signal));
  const pollMs = options.pollMs ?? 150;
  const goneWithin = async (pid: number, ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (isAlive(pid)) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return true;
  };
  const stop = async (pid: number, timeoutMs: number): Promise<StopOutcome> => {
    if (pid <= 1 || pid === process.pid || !isAlive(pid)) return "not-running";
    try {
      kill(pid, "SIGTERM");
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM" ? "not-permitted" : "not-running";
    }
    if (await goneWithin(pid, timeoutMs)) return "stopped";
    try {
      kill(pid, "SIGKILL");
    } catch {
      // Gone between the check and the signal.
    }
    await goneWithin(pid, SIGKILL_WAIT_MS);
    return "force-killed";
  };

  if (!viewer.verified) return "unverified";
  let outcome: StopOutcome = "not-running";
  if (viewer.pid !== null) {
    outcome = await stop(viewer.pid, options.timeoutMs ?? viewerSetting("stopTimeoutMs", options.env));
  }
  if (viewer.serverPid !== null && outcome !== "not-permitted") {
    // Left behind when the launcher was force-killed, or all there was.
    const server = await stop(viewer.serverPid, SERVER_STOP_TIMEOUT_MS);
    if (outcome === "not-running") outcome = server;
  }
  if (viewer.inRegistry && viewer.projectRoot && viewer.pid !== null && outcome !== "not-permitted") {
    await removeViewerRecord(viewer.projectRoot, { env: options.env, pid: viewer.pid }).catch(() => {});
  }
  return outcome;
}

/**
 * Stops the viewer a registry record names (review_open replacing it). A pid that now runs
 * something other than `dr visualize` is not signalled; its record is just removed.
 */
export async function stopRecordedViewer(
  record: ViewerRecord,
  options: StopViewerOptions & { looksLikeViewer?: (pid: number) => boolean | null } = {}
): Promise<StopOutcome> {
  if ((options.looksLikeViewer ?? looksLikeViewer)(record.pid) === false) {
    await removeViewerRecord(record.projectRoot, { env: options.env, pid: record.pid }).catch(() => {});
    return "not-running";
  }
  return stopViewer(
    {
      projectRoot: record.projectRoot,
      port: record.port,
      pid: record.pid,
      serverPid: record.serverPid ?? null,
      cliVersion: record.cliVersion ?? null,
      outdated: false,
      startedAt: record.startedAt,
      startedBy: record.startedBy ?? null,
      withChangesets: record.withChangesets,
      idleExitHours: record.idleExitHours ?? null,
      inRegistry: true,
      answering: true,
      verified: true,
      token: record.token,
    },
    options
  );
}
