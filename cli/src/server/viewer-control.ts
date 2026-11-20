/**
 * Listing and stopping running viewers (`dr visualize --list`, `--stop`, and review_open's
 * restart).
 *
 * The list joins the registry's records (viewer-registry.ts) with a scan of the process table
 * (viewer-processes.ts), so it also shows a viewer the registry has no record of: one whose
 * record a CLI before 0.7.0 let a later `dr visualize` replace, or a server left behind by a
 * launcher that was killed (#1237).
 *
 * Stopping sends signals, so what may be signalled is decided here, once, and nowhere else. A
 * pid is signalled only when it is confirmed to be the viewer in question, in one of two ways:
 *
 * - **By the viewer itself.** The server answering on the record's port reports the record's own
 *   id, and names its pid and its launcher's, which must be the recorded pid (since 0.7.0).
 * - **By the process table.** The recorded pid started no later than the record was written,
 *   its command line has a `visualize` argument, and it has a server child whose script is the
 *   dr CLI's. For a viewer with no record, the server's script being the dr CLI's is the
 *   confirmation.
 *
 * Nothing else is enough: not that the pid is alive, not that some viewer answers on the port,
 * not that the command line could not be read. A recorded `serverPid` is never signalled on the
 * record's word. An unconfirmed viewer is listed as such and left running, and the caller is
 * told why.
 */

import { getCliVersion } from "../utils/spec-version.js";
import {
  answeringViewer,
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
  hasVisualizeArgument,
  isZombie,
  listProcesses,
  processStartTime,
  listeningPort,
  processCwd,
  processScanDisabled,
  projectRootFromCwd,
  scanViewerProcesses,
  type ProcessInfo,
  type ViewerProcessScan,
} from "./viewer-processes.js";
import { viewerSetting } from "./viewer-settings.js";

/** The pids of a viewer that may be signalled, and what confirmed them. */
export interface ConfirmedPids {
  launcher: number | null;
  server: number | null;
  /** "health": the viewer named them itself. "process": the process table did. */
  by: "health" | "process";
}

/** One running viewer, as `dr visualize --list` reports it. */
export interface RunningViewer {
  /** Real path of the project it serves; null when it could not be worked out. */
  projectRoot: string | null;
  /** The port it listens on; null when unknown (a lost viewer on a machine without lsof). */
  port: number | null;
  /** The `dr visualize` launcher's pid; null when only its server is left. */
  pid: number | null;
  /** The server process's pid; null when unknown. From the viewer itself or the process table, never from the record alone. */
  serverPid: number | null;
  /** CLI version from its health check; null when it does not answer or predates 0.6.0. */
  cliVersion: string | null;
  /** Whether that version is older than this CLI's (false when the version is unknown). */
  outdated: boolean;
  /** ISO timestamp of when it started, or "". */
  startedAt: string;
  /** Who started it; null when the registry has no record or an older CLI wrote it. */
  startedBy: ViewerStarter | null;
  /** Whether its chat may stage changes; null when the registry has no record and its command line does not say. */
  withChangesets: boolean | null;
  /** Hours of idleness after which it exits on its own; null when it never does or it is unknown. */
  idleExitHours: number | null;
  /** Whether the registry (this state directory's) has a record of it. False: found by the process scan alone. */
  inRegistry: boolean;
  /** Whether its own server answered its health check (not merely some viewer on its port). */
  answering: boolean;
  /** The pids that may be signalled to stop it; null when they could not be confirmed (see `unconfirmed`). */
  confirmed: ConfirmedPids | null;
  /** Why its pids could not be confirmed, in words; absent when they were. */
  unconfirmed?: string;
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
  health?: (port: number, timeoutMs: number, token?: string | null) => Promise<ViewerHealth | null>;
  /** Whether a command line's `dist/server-entry.js` is the dr CLI's (default: its package.json). */
  isDrServer?: (command: string) => boolean | null;
  /** The current user's id (default: this process's); null counts every user's processes. */
  uid?: number | null;
  cliVersion?: string;
  /** How long each viewer gets to answer its health check (default: DR_VIEWER_HEALTH_TIMEOUT_MS, 1.5s). */
  healthTimeoutMs?: number;
}

/** Every running viewer that could be found, and what the answer leaves out. */
export interface ViewerSurvey {
  viewers: RunningViewer[];
  /**
   * Whether the process table could be read. False: only the registry was consulted, so a viewer
   * it has no record of is not in `viewers`. Whoever shows the list must say so.
   */
  processScan: boolean;
  /** Why there was no process scan: turned off by the setting, or not possible here. */
  processScanOff?: "disabled" | "unavailable";
  /** Pids running a `dist/server-entry.js` that could not be confirmed to be the dr CLI's: not listed. */
  candidates: number[];
  /** How many viewers of other users are running: not listed, never signalled. */
  otherUsers: number;
  /** What reading the registry removed, and which records it could not read and left. */
  swept: SweepResult;
}

/**
 * A recorded pid may be the record's viewer only if its process started no later than the record
 * was written. `ps` reports start times rounded down to the second, which only makes a process
 * look earlier, so no slack is needed: a reused pid passes this check only if it was reused in the
 * same second as the record was written.
 */
function startedNoLaterThan(info: ProcessInfo, record: ViewerRecord): boolean | null {
  const started = info.startedAt ? Date.parse(info.startedAt) : Number.NaN;
  const recorded = record.startedAt ? Date.parse(record.startedAt) : Number.NaN;
  if (Number.isNaN(started) || Number.isNaN(recorded)) return null;
  return started <= recorded;
}

/** What the process table and the viewer's own answer say about a recorded viewer. */
type Confirmation =
  | { kind: "confirmed"; pids: ConfirmedPids }
  /** The recorded pid is certainly not this viewer any more: the record is stale. */
  | { kind: "stale"; reason: string }
  | { kind: "unconfirmed"; reason: string };

/**
 * Decides whether a record's pid may be signalled (see the module comment). `health` is what
 * answered on the record's port, if anything did; `table` and `scan` are the process table and
 * its viewers, or null where there is none.
 */
export function confirmRecordedViewer(
  record: ViewerRecord,
  health: ViewerHealth | null,
  table: ProcessInfo[] | null,
  scan: ViewerProcessScan | null
): Confirmation {
  const namesItself = !!health && answeringViewer(record, health) === "this" && !!health.pid && health.launcherPid === record.pid;

  if (!table || !scan) {
    // By the viewer itself, when there is nothing to check it against.
    if (namesItself) return { kind: "confirmed", pids: { launcher: record.pid, server: health!.pid!, by: "health" } };
    return {
      kind: "unconfirmed",
      reason: health
        ? "the viewer on its port does not identify itself as this one, and there is no process table to check its pid against"
        : "it does not answer, and there is no process table to check its pid against",
    };
  }

  // With a process table, it has the last word, whatever /health says: a server that outlived its
  // launcher still reports the launcher pid it started with, which may now be another process's.
  const info = table.find((candidate) => candidate.pid === record.pid);
  if (!info) return { kind: "stale", reason: "its pid is gone" };
  if (!hasVisualizeArgument(info.command)) return { kind: "stale", reason: "its pid now runs another program" };
  const inTime = startedNoLaterThan(info, record);
  if (inTime === false) return { kind: "stale", reason: "its pid now runs a process that started after the record was written" };
  if (inTime === null) {
    return { kind: "unconfirmed", reason: "the start time of its pid or of its record is unknown, so the pid may have been reused" };
  }

  if (namesItself) {
    const server = table.find((candidate) => candidate.pid === health!.pid);
    if (!server || server.ppid !== record.pid) {
      return { kind: "unconfirmed", reason: "the server that names this viewer is not a child of its recorded pid" };
    }
    return { kind: "confirmed", pids: { launcher: record.pid, server: server.pid, by: "health" } };
  }

  const process_ = scan.viewers.find((viewer) => viewer.launcherPid === record.pid);
  if (!process_ || process_.serverPid === null) {
    return { kind: "unconfirmed", reason: "its pid is not a dr visualize launcher with a dr viewer server under it" };
  }
  return { kind: "confirmed", pids: { launcher: record.pid, server: process_.serverPid, by: "process" } };
}

/** Every running viewer on this machine (see surveyViewers, which also says what the list leaves out). */
export async function listRunningViewers(deps: ListRunningViewersDeps = {}): Promise<RunningViewer[]> {
  return (await surveyViewers(deps)).viewers;
}

/**
 * Every running viewer of the current user: the registry's live records joined with the process
 * scan, with what the answer leaves out (no process scan, unconfirmed candidates, other users'
 * viewers, unreadable records) and what the registry sweep removed. A record whose pid certainly
 * is not its viewer any more is removed (and counted in `swept`), not listed.
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
  const table = deps.processes ? deps.processes() : listProcesses(env);
  const scan = table
    ? scanViewerProcesses(table, {
        knownLaunchers: new Set(records.map((record) => record.pid)),
        ...(deps.uid !== undefined ? { uid: deps.uid } : {}),
        ...(deps.isDrServer ? { isDrServer: deps.isDrServer } : {}),
      })
    : null;

  const viewers: RunningViewer[] = [];
  const claimed = new Set<number>(); // launcher pids that a kept record accounts for

  await Promise.all(
    records.map(async (record: ViewerRecord) => {
      const answer = await health(record.port, timeoutMs, record.token);
      const confirmation = confirmRecordedViewer(record, answer, table, scan);
      if (confirmation.kind === "stale") {
        // If a viewer still runs under that pid or on that port, the scan lists it as its own.
        const removed = await removeViewerRecord(record.projectRoot, { env, pid: record.pid }).catch(() => [] as string[]);
        swept.removed.push(...removed);
        swept.records += removed.length;
        return;
      }
      claimed.add(record.pid);
      // Its own server answered, not just some viewer on its port.
      const own = answer && answeringViewer(record, answer) !== "other" ? answer : null;
      const version = own?.cliVersion ?? null;
      viewers.push({
        projectRoot: record.projectRoot,
        port: record.port,
        pid: record.pid,
        serverPid: confirmation.kind === "confirmed" ? confirmation.pids.server : null,
        cliVersion: version,
        // A viewer that answers without a version predates 0.6.0; one that does not answer is unknown.
        outdated: own ? isOlderViewer(version, cliVersion) : false,
        startedAt: record.startedAt,
        startedBy: record.startedBy ?? null,
        withChangesets: record.withChangesets,
        idleExitHours: record.idleExitHours ?? null,
        inRegistry: true,
        answering: own !== null,
        confirmed: confirmation.kind === "confirmed" ? confirmation.pids : null,
        ...(confirmation.kind === "unconfirmed" ? { unconfirmed: confirmation.reason } : {}),
        token: record.token,
      });
    })
  );

  await Promise.all(
    (scan?.viewers ?? []).map(async (proc) => {
      // Recorded viewers are listed above; a launcher the registry named with no server is only there.
      if (proc.launcherPid !== null && (claimed.has(proc.launcherPid) || proc.serverPid === null)) return;
      const cwd = cwdOf(proc.launcherPid ?? proc.serverPid!) ?? (proc.serverPid ? cwdOf(proc.serverPid) : null);
      const port = proc.serverPid ? portOf(proc.serverPid) : null;
      const answer = port === null ? null : await health(port, timeoutMs);
      const version = answer?.cliVersion ?? null;
      viewers.push({
        projectRoot: cwd ? canonicalProjectRoot(projectRootFromCwd(cwd)) : null,
        port,
        pid: proc.launcherPid,
        serverPid: proc.serverPid,
        cliVersion: version,
        outdated: answer ? isOlderViewer(version, cliVersion) : false,
        startedAt: proc.startedAt,
        startedBy: null,
        // Only what its command line says for certain: without either flag the mode is the
        // default of the CLI that runs it, which changed in 0.7.0, so it is not guessed.
        withChangesets: /\s--with-changesets(?:\s|$)/.test(proc.command)
          ? true
          : /\s--read-only(?:\s|$)/.test(proc.command)
            ? false
            : null,
        idleExitHours: null,
        inRegistry: false,
        answering: answer !== null,
        // The scan lists a server only when its script is the dr CLI's.
        confirmed: { launcher: proc.launcherPid, server: proc.serverPid, by: "process" },
        token: null,
      });
    })
  );

  viewers.sort(
    (a, b) =>
      (a.projectRoot ?? "~").localeCompare(b.projectRoot ?? "~") ||
      a.startedAt.localeCompare(b.startedAt) ||
      (a.port ?? 0) - (b.port ?? 0)
  );
  return {
    viewers,
    processScan: table !== null,
    ...(table === null ? { processScanOff: processScanDisabled(env) ? ("disabled" as const) : ("unavailable" as const) } : {}),
    candidates: scan?.candidates ?? [],
    otherUsers: scan?.otherUsers ?? 0,
    swept,
  };
}

/**
 * What a survey leaves out, each as a sentence to show: a list is never shown without these.
 * Empty when nothing is known to be missing.
 */
export function surveyCaveats(survey: ViewerSurvey): string[] {
  const caveats: string[] = [];
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (!survey.processScan) {
    const listed = survey.viewers.length === 0 ? "no viewers" : count(survey.viewers.length, "viewer", "viewers");
    caveats.push(
      `The registry lists ${listed}. ` +
        (survey.processScanOff === "disabled"
          ? "The process scan is turned off (DR_VIEWER_PROCESS_SCAN), "
          : "A process scan was not possible (ps is unavailable here or failed), ") +
        "so viewers the registry has lost are not shown."
    );
  }
  if (survey.candidates.length > 0) {
    caveats.push(
      `${count(survey.candidates.length, "process runs", "processes run")} a dist/server-entry.js that could not be confirmed ` +
        `to be the dr CLI's (pid ${survey.candidates.join(", ")}): not listed, and never stopped from here.`
    );
  }
  if (survey.otherUsers > 0) {
    caveats.push(`${count(survey.otherUsers, "viewer of another user is", "viewers of other users are")} running: not listed, and never stopped from here.`);
  }
  if (survey.swept.unreadable.length > 0) {
    const n = survey.swept.unreadable.length;
    caveats.push(
      `${count(n, "record", "records")} in the registry could not be read by this CLI and ` +
        `${n === 1 ? "belongs to a process that is" : "belong to processes that are"} still running (a newer CLI's viewer, perhaps): ` +
        `left in place, and not listed (${survey.swept.unreadable.join(", ")}).`
    );
  }
  return caveats;
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
  | "unverified"
  /**
   * It did not exit on SIGTERM in time, and was not sent SIGKILL because its start time could not
   * be read to make sure the pid had not been reused meanwhile. It may still be running.
   */
  | "timed-out";

export interface StopViewerOptions {
  env?: NodeJS.ProcessEnv;
  /** How long the launcher gets to stop its server and exit before SIGKILL (default: DR_VIEWER_STOP_TIMEOUT_MS, 8s). */
  timeoutMs?: number;
  isAlive?: (pid: number) => boolean;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  /** When a pid's process started (default: from ps), or null when that cannot be read. */
  startTimeOf?: (pid: number) => string | null;
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
 * launcher or had none. Its record is removed. Only `viewer.confirmed` pids are signalled: a
 * viewer without them is left alone ("unverified"). Never signals pid 1 or this process.
 */
export async function stopViewer(viewer: RunningViewer, options: StopViewerOptions = {}): Promise<StopOutcome> {
  if (!viewer.confirmed) return "unverified";
  // A process that has exited but that its parent has not collected yet still has a pid.
  const isAlive = options.isAlive ?? ((pid: number) => isProcessAlive(pid) && !isZombie(pid));
  const kill = options.kill ?? ((pid: number, signal: NodeJS.Signals) => void process.kill(pid, signal));
  const startTimeOf = options.startTimeOf ?? processStartTime;
  const pollMs = options.pollMs ?? 150;
  // The processes as they are now, just confirmed. Before each later signal the pid's start time is
  // read again: a pid that exited and was reused while the stop waited is a different process.
  const startedAt = new Map<number, string | null>();
  const sameProcess = (pid: number): boolean | null => {
    if (!startedAt.has(pid)) return null;
    const then = startedAt.get(pid) ?? null;
    if (then === null) return null;
    const now = startTimeOf(pid);
    return now === null ? null : now === then;
  };
  const goneWithin = async (pid: number, ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (isAlive(pid)) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return true;
  };
  /** `recheck`: compare the start time before SIGTERM too (a signal later in the stop). */
  const stop = async (pid: number, timeoutMs: number, recheck: boolean): Promise<StopOutcome> => {
    if (pid <= 1 || pid === process.pid || !isAlive(pid)) return "not-running";
    if (recheck && sameProcess(pid) !== true) {
      // Reused (false), or cannot be told (null): either way not provably the viewer any more.
      return sameProcess(pid) === false ? "not-running" : "timed-out";
    }
    try {
      kill(pid, "SIGTERM");
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM" ? "not-permitted" : "not-running";
    }
    if (await goneWithin(pid, timeoutMs)) return "stopped";
    const same = sameProcess(pid);
    if (same === false) return "stopped"; // It exited and the pid was taken by another process.
    if (same === null) return "timed-out"; // Cannot make sure it is the same process: no SIGKILL.
    try {
      kill(pid, "SIGKILL");
    } catch {
      // Gone between the check and the signal.
    }
    await goneWithin(pid, SIGKILL_WAIT_MS);
    return "force-killed";
  };

  const { launcher, server } = viewer.confirmed;
  for (const pid of [launcher, server]) if (pid !== null) startedAt.set(pid, startTimeOf(pid));
  let outcome: StopOutcome = "not-running";
  if (launcher !== null) {
    outcome = await stop(launcher, options.timeoutMs ?? viewerSetting("stopTimeoutMs", options.env), false);
  }
  if (server !== null && outcome !== "not-permitted") {
    // Left behind when the launcher was force-killed, or all there was.
    // The first signal it gets when there is no launcher; otherwise after a wait, so checked again.
    const serverOutcome = await stop(server, SERVER_STOP_TIMEOUT_MS, launcher !== null);
    if (outcome === "not-running") outcome = serverOutcome;
  }
  if (viewer.inRegistry && viewer.projectRoot && viewer.pid !== null && outcome !== "not-permitted" && outcome !== "timed-out") {
    await removeViewerRecord(viewer.projectRoot, { env: options.env, pid: viewer.pid }).catch(() => {});
  }
  return outcome;
}

export interface StopRecordedViewerOptions extends StopViewerOptions {
  /** What answers on a port (default: the viewer's health check). */
  health?: (port: number, timeoutMs: number, token?: string | null) => Promise<ViewerHealth | null>;
  /** The process table, or null where it cannot be read. */
  processes?: () => ProcessInfo[] | null;
  isDrServer?: (command: string) => boolean | null;
  uid?: number | null;
}

/** What stopping a recorded viewer came to: the outcome, and why nothing was signalled when nothing was. */
export interface StopRecordedResult {
  outcome: StopOutcome;
  /** Set with "unverified" (why the pid could not be confirmed) and with "not-running" for a stale record. */
  reason?: string;
}

/**
 * Stops the viewer a registry record names (review_open replacing it), after confirming its
 * pids as `--stop` does. A record whose pid certainly is not its viewer any more is removed and
 * nothing is signalled ("not-running"). One that cannot be confirmed is left exactly as it is
 * ("unverified", with the reason): the caller must not go on as if it had been stopped.
 */
export async function stopRecordedViewer(
  record: ViewerRecord,
  options: StopRecordedViewerOptions = {}
): Promise<StopRecordedResult> {
  const env = options.env ?? process.env;
  const health = options.health ?? viewerHealth;
  const answer = await health(record.port, viewerSetting("healthTimeoutMs", env), record.token);
  const table = options.processes ? options.processes() : listProcesses(env);
  const scan = table
    ? scanViewerProcesses(table, {
        knownLaunchers: new Set([record.pid]),
        ...(options.uid !== undefined ? { uid: options.uid } : {}),
        ...(options.isDrServer ? { isDrServer: options.isDrServer } : {}),
      })
    : null;
  const confirmation = confirmRecordedViewer(record, answer, table, scan);
  if (confirmation.kind === "stale") {
    await removeViewerRecord(record.projectRoot, { env, pid: record.pid }).catch(() => {});
    return { outcome: "not-running", reason: confirmation.reason };
  }
  if (confirmation.kind === "unconfirmed") return { outcome: "unverified", reason: confirmation.reason };
  const outcome = await stopViewer(
    {
      projectRoot: record.projectRoot,
      port: record.port,
      pid: record.pid,
      serverPid: confirmation.pids.server,
      cliVersion: record.cliVersion ?? null,
      outdated: false,
      startedAt: record.startedAt,
      startedBy: record.startedBy ?? null,
      withChangesets: record.withChangesets,
      idleExitHours: record.idleExitHours ?? null,
      inRegistry: true,
      answering: answer !== null,
      confirmed: confirmation.pids,
      token: record.token,
    },
    options
  );
  return { outcome };
}
