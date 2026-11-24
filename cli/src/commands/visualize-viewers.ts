/**
 * `dr visualize --list` and `dr visualize --stop`: see and stop the farm's central DR process,
 * and the per-project viewers older CLIs left running (issue 1279, slice 4A; #1237 before it).
 *
 * `--list` shows the central process for the farm in use (pid, port, CLI version, and from its
 * `/health` with the token: browser tabs, MCP sessions, DrBot turns, loaded checkouts), then every
 * legacy per-project viewer with the reason the central process's start-up sweep keeps it
 * (legacy-viewer-sweep.ts). `--stop` stops the central process, with the same confirmed stop as
 * `dr serve --stop`. `--stop --all` also stops every legacy viewer whose pids are confirmed.
 *
 * Neither command passes off a partial answer as a whole one. The list says how many viewers it
 * found and where (the registry, the process table), and states what it leaves out: viewers the
 * registry lost when the process table could not be read, processes it could not confirm to be
 * dr's, other users' viewers, records it could not read. A stop says how many viewers were
 * running, how many it stopped, and names each one it did not, with why.
 *
 * A legacy viewer found only in the process table (another state directory's, or one whose
 * record was lost) is stopped only with --include-unrecorded, so a session with its own state
 * directory cannot stop the user's viewers by accident. Only pids confirmed to be a viewer's are
 * signalled (viewer-control.ts).
 */

import ansis from "ansis";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  stopViewer,
  surveyCaveats,
  surveyViewers,
  type ListRunningViewersDeps,
  type RunningViewer,
  type StopOutcome,
  type StopViewerOptions,
  type ViewerSurvey,
} from "../server/viewer-control.js";
import type { ServerRecord } from "../core/checkout-types.js";
import { resolveFarm } from "../core/project-registry.js";
import type { CentralHealth } from "../server/central-server-contract.js";
import { sweepDecision, type KeptReason } from "../server/legacy-viewer-sweep.js";
import { findRunningServer } from "../server/server-record.js";
import { canonicalProjectRoot, describeSweep } from "../server/viewer-registry.js";
import { ignoredViewerSettings, viewerSettingsInEffect } from "../server/viewer-settings.js";
import { CLIError } from "../utils/errors.js";
import { isJson } from "../utils/globals.js";
import { findProjectRoot } from "../utils/project-paths.js";
import { getCliVersion } from "../utils/spec-version.js";

/** A viewer as `--json` prints it: everything but its auth token. */
export type ListedViewer = Omit<RunningViewer, "token">;

/** Why the start-up sweep leaves a legacy viewer running, or `unused` when the next sweep stops it. */
export type LegacyViewerReason = Exclude<KeptReason, "excluded" | "stop-failed"> | "unused";

/** A legacy viewer as `--list` shows it: with the sweep's reason for keeping it. */
export type ListedLegacyViewer = ListedViewer & { keptReason: LegacyViewerReason };

const REASON_TEXT: Record<LegacyViewerReason, string> = {
  "not-started-by-review-open": "kept: started from a terminal (or by a CLI before 0.7.0)",
  "tabs-connected": "kept: a browser tab is connected",
  "unknown-tabs": "kept: its tabs could not be read",
  unconfirmed: "kept: its pids could not be confirmed",
  unused: "unused: the next start of the DR process stops it",
};

/** The sweep's reason for a legacy viewer, as `--list` shows it. */
export function legacyViewerReason(viewer: RunningViewer, excludePids: number[] = []): LegacyViewerReason | null {
  const decision = sweepDecision(viewer, new Set(excludePids));
  if (decision === "excluded") return null;
  if (decision === "stop") return "unused";
  return decision === "stop-failed" ? "unconfirmed" : decision;
}

/** The farm's central process as `--list` sees it. */
export interface CentralProcessState {
  farmRoot: string;
  /** Null when no process is recorded (or its pid is gone). */
  record: ServerRecord | null;
  /** Its `/health` with the token; null when it doesn't answer. */
  health: CentralHealth | null;
}

/** Finds the farm's central process from its server record and asks its `/health`. Starts nothing. */
export async function readCentralProcess(cwd: string, env: NodeJS.ProcessEnv): Promise<CentralProcessState> {
  const farm = await resolveFarm({ cwd, env });
  const running = await findRunningServer(farm.root, { env });
  if (!running) return { farmRoot: farm.root, record: null, health: null };
  const { fetchCentralHealth } = await import("./serve.js");
  return { farmRoot: farm.root, record: running.record, health: await fetchCentralHealth(running.record, running.token) };
}

/** The central process in lines of text. */
export function formatCentralProcess(state: CentralProcessState): string[] {
  if (!state.record) return [`No DR process is running for ${shortPath(state.farmRoot)}.`];
  const r = state.record;
  const lines = [
    `DR process for ${shortPath(state.farmRoot)}`,
    `  pid ${r.pid}, port ${r.port}, CLI ${r.cliVersion}, started ${localTime(r.startedAt)}`,
  ];
  const h = state.health;
  if (!h) {
    lines.push(`  not answering on http://127.0.0.1:${r.port}/health`);
  } else {
    const count = (n: number | undefined, one: string, many: string) => (n === undefined ? `? ${many}` : plural(n, one, many));
    lines.push(
      `  ${count(h.clients, "browser tab", "browser tabs")}, ${count(h.mcpSessions, "MCP session", "MCP sessions")}, ` +
        `${count(h.drBotTurns, "DrBot turn", "DrBot turns")}, ${count(h.loadedCheckouts, "checkout loaded", "checkouts loaded")}`
    );
  }
  return lines;
}

function withoutToken(viewer: RunningViewer): ListedViewer {
  const { token: _token, ...listed } = viewer;
  return listed;
}

function shortPath(path: string | null): string {
  if (!path) return "(unknown project)";
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function localTime(iso: string): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "?";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** What is worth knowing about a viewer beyond its columns. */
export function viewerNotes(viewer: RunningViewer, cliVersion: string = getCliVersion()): string[] {
  const notes: string[] = [];
  if (viewer.startedBy === "review_open") notes.push("started by review_open");
  if (!viewer.inRegistry) notes.push("not in the registry");
  if (viewer.pid === null) notes.push(`launcher gone, server pid ${viewer.serverPid}`);
  if (viewer.port === null) notes.push("port not found");
  else if (!viewer.answering) notes.push("does not answer");
  else if (viewer.outdated) notes.push(`older than this CLI (${cliVersion})`);
  if (viewer.idleExitHours) notes.push(`exits after ${viewer.idleExitHours}h idle`);
  if (!viewer.confirmed) notes.push(`pid not confirmed: ${viewer.unconfirmed ?? "unknown"}`);
  return notes;
}

/** The viewers as a table, one line each. */
export function formatViewerTable(
  viewers: RunningViewer[],
  cliVersion: string = getCliVersion(),
  /** A note to put first, per viewer (the sweep's reason in `--list`). */
  lead?: (viewer: RunningViewer) => string
): string {
  const rows = viewers.map((viewer) => [
    shortPath(viewer.projectRoot),
    viewer.port === null ? "?" : String(viewer.port),
    String(viewer.pid ?? viewer.serverPid ?? "?"),
    viewer.cliVersion ?? (viewer.answering ? "<0.6.0" : "?"),
    localTime(viewer.startedAt),
    [...(lead ? [lead(viewer)] : []), ...viewerNotes(viewer, cliVersion)].join("; "),
  ]);
  const header = ["PROJECT", "PORT", "PID", "CLI", "STARTED", "NOTES"];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column])))
      .join("  ")
      .trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}

/** Where a command's output goes; tests inject both. */
export interface OutputDeps {
  /** Prints one line (default: console.log). */
  log?: (line: string) => void;
  /** Print JSON (default: the global --json flag). */
  json?: boolean;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Where the listed viewers were found, over all of them. */
export function surveyCounts(survey: ViewerSurvey): { total: number; inRegistry: number; processOnly: number } {
  const inRegistry = survey.viewers.filter((viewer) => viewer.inRegistry).length;
  return { total: survey.viewers.length, inRegistry, processOnly: survey.viewers.length - inRegistry };
}

/** What `--list` reads: the legacy survey's deps, plus where the farm is and how to find its process. */
export type ListViewersDeps = ListRunningViewersDeps &
  OutputDeps & {
    /** Where to resolve the farm from (default: the working directory). */
    cwd?: string;
    /** Replaces readCentralProcess (tests). */
    readCentral?: (cwd: string, env: NodeJS.ProcessEnv) => Promise<CentralProcessState>;
  };

/** What `--list` found. */
export interface ViewerListing {
  central: CentralProcessState;
  survey: ViewerSurvey;
  legacy: ListedLegacyViewer[];
}

/**
 * `dr visualize --list`: the farm's central process, then every legacy per-project viewer with
 * its project, port, pid, CLI version, start time and the reason the start-up sweep keeps it; how
 * many there are and where they were found; what reading the registry removed; and what the list
 * leaves out (its caveats), whenever there is something.
 */
export async function listViewersCommand(deps: ListViewersDeps = {}): Promise<ViewerListing> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const env = deps.env ?? process.env;
  const central = await (deps.readCentral ?? readCentralProcess)(deps.cwd ?? process.cwd(), env);
  const survey = await surveyViewers(deps);
  const exclude = central.record ? [central.record.pid] : [];
  const viewers = survey.viewers.filter((viewer) => legacyViewerReason(viewer, exclude) !== null);
  const legacy: ListedLegacyViewer[] = viewers.map((viewer) => ({
    ...withoutToken(viewer),
    keptReason: legacyViewerReason(viewer, exclude)!,
  }));
  const counts = surveyCounts({ ...survey, viewers });
  const caveats = surveyCaveats(survey);
  const ignored = ignoredViewerSettings(env);
  const listing: ViewerListing = { central, survey, legacy };

  if (deps.json ?? isJson()) {
    const record = central.record ? (({ tokenPath: _tokenPath, ...rest }) => rest)(central.record) : null;
    log(
      JSON.stringify(
        {
          cliVersion: deps.cliVersion ?? getCliVersion(),
          central: { farmRoot: central.farmRoot, running: record !== null, answering: central.health !== null, record, health: central.health },
          // What the list may be missing, in words; empty when nothing is known to be missing.
          caveats,
          processScan: survey.processScan ? { available: true } : { available: false, why: survey.processScanOff },
          counts: { ...counts, unconfirmedCandidates: survey.candidates.length, otherUsers: survey.otherUsers },
          swept: {
            records: survey.swept.records,
            startingMarkers: survey.swept.markers,
            logs: survey.swept.logs,
            tempFiles: survey.swept.tempFiles,
            removed: survey.swept.removed,
            unreadable: survey.swept.unreadable,
          },
          settings: viewerSettingsInEffect(env),
          legacyViewers: legacy,
        },
        null,
        2
      )
    );
    return listing;
  }

  for (const warning of ignored) log(ansis.yellow(warning));
  for (const line of formatCentralProcess(central)) log(line);
  log("");
  if (viewers.length > 0) {
    log("Per-project viewers left by CLI 0.7 and earlier:");
    log(formatViewerTable(viewers, deps.cliVersion, (viewer) => REASON_TEXT[legacyViewerReason(viewer, exclude)!]));
    log("");
  }
  if (survey.processScan) {
    log(
      viewers.length === 0
        ? "No per-project viewers are running."
        : `${plural(counts.total, "per-project viewer", "per-project viewers")} running: ${counts.inRegistry} in the registry, ` +
            `${counts.processOnly} found only in the process table.`
    );
  }
  for (const caveat of caveats) log(ansis.yellow(caveat));
  const removed = describeSweep(survey.swept);
  if (removed) log(`Removed ${removed} from the registry.`);
  log(
    ansis.dim(
      "`dr visualize --stop` stops the DR process; `dr visualize --stop --all` also stops the per-project viewers " +
        "(one that is not in the registry only with `--include-unrecorded`)."
    )
  );
  return listing;
}

export interface StopViewersOptions {
  /** A project folder; the current project when absent and neither `all` nor `port` is given. */
  project?: string;
  all?: boolean;
  /** Only the viewer on this port. */
  port?: string | number;
  /**
   * Also stop viewers found only in the process table: ones this registry has no record of
   * (another state directory's, or lost by an older CLI). Without it they are named and left.
   */
  includeUnrecorded?: boolean;
  /** Where to look for the current project (default: the working directory). */
  cwd?: string;
}

export interface StoppedViewer {
  viewer: ListedViewer;
  outcome: StopOutcome;
}

/** What a `--stop` run did, over every viewer it found. */
export interface StopSummary {
  /** Viewers running when the command looked. */
  found: number;
  /** Viewers the arguments named. */
  matched: number;
  /** Of those, how many were stopped (or had already exited). */
  stopped: number;
  /** Each one it signalled or tried to and that is still running, with why. */
  notStopped: StoppedViewer[];
  /** Matched viewers that are not in this registry and were left because --include-unrecorded was not given. */
  unrecordedLeft: ListedViewer[];
  /** Every viewer it acted on, with what happened to it. */
  results: StoppedViewer[];
  /** Running viewers whose project could not be worked out, so a stop by project could not consider them. */
  unknownProject: ListedViewer[];
  /** Whether the process table could be read; false means viewers the registry lost were not seen. */
  processScan: boolean;
  /** What the survey behind this stop leaves out, in words. */
  caveats: string[];
}

const OUTCOME_TEXT: Record<StopOutcome, string> = {
  stopped: "Stopped",
  "force-killed": "Stopped (it did not exit in time and was killed)",
  "not-running": "Already gone:",
  "not-permitted": "Could not stop (it belongs to another user):",
  unverified: "Left alone (its pid could not be confirmed to be this viewer):",
  "timed-out":
    "Did not exit in time, and was not killed because its start time could not be read to make sure the pid was still the viewer's:",
};

const NOT_STOPPED: ReadonlySet<StopOutcome> = new Set<StopOutcome>(["not-permitted", "unverified", "timed-out"]);

/** The viewers a `--stop` run names. Throws when it names nothing that can be resolved. */
export async function selectViewersToStop(viewers: RunningViewer[], options: StopViewersOptions): Promise<RunningViewer[]> {
  let port: number | undefined;
  if (options.port !== undefined) {
    port = Number.parseInt(String(options.port), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new CLIError(`Invalid port number: ${options.port}. Port must be between 1 and 65535.`);
    }
  }
  let selected = viewers;
  if (!options.all) {
    let projectRoot: string | null = null;
    if (options.project) {
      const named = resolve(options.cwd ?? process.cwd(), options.project);
      projectRoot = canonicalProjectRoot((await findProjectRoot(named)) ?? named);
    } else if (port === undefined) {
      const found = await findProjectRoot(options.cwd ?? process.cwd());
      if (!found) {
        throw new CLIError("No project here to stop the viewer of.", undefined, [
          "Name a project folder: dr visualize --stop <project>",
          "Or stop every viewer: dr visualize --stop --all",
          "See what is running: dr visualize --list",
        ]);
      }
      projectRoot = canonicalProjectRoot(found);
    }
    if (projectRoot !== null) selected = selected.filter((viewer) => viewer.projectRoot === projectRoot);
  }
  if (port !== undefined) selected = selected.filter((viewer) => viewer.port === port);
  return selected;
}

function where(viewer: ListedViewer): string {
  return `${shortPath(viewer.projectRoot)} (port ${viewer.port ?? "?"}, pid ${viewer.pid ?? viewer.serverPid ?? "?"})`;
}

/**
 * `dr visualize --stop [project] [--all] [--port n] [--include-unrecorded]`: stops the viewers of
 * the current or named project, the one on a port, or all of them, and waits for each to exit.
 * Acts on the viewers this registry records; ones found only in the process table are named and
 * left unless --include-unrecorded is given. Says how many viewers were running, how many
 * matched and how many it stopped, and names each one it did not stop, with why. Throws (exit 1)
 * when a matched viewer is still running.
 */
export async function stopViewersCommand(
  options: StopViewersOptions,
  deps: ListRunningViewersDeps & OutputDeps & { stop?: StopViewerOptions } = {}
): Promise<StopSummary> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const survey = await surveyViewers(deps);
  const { viewers } = survey;
  const matched = await selectViewersToStop(viewers, options);
  const toStop = matched.filter((viewer) => viewer.inRegistry || options.includeUnrecorded);
  const unrecordedLeft = matched.filter((viewer) => !viewer.inRegistry && !options.includeUnrecorded).map(withoutToken);

  const results: StoppedViewer[] = [];
  for (const viewer of toStop) {
    const outcome = await stopViewer(viewer, { env: deps.env, ...deps.stop });
    results.push({ viewer: withoutToken(viewer), outcome });
  }
  const notStopped = results.filter((result) => NOT_STOPPED.has(result.outcome));
  // A stop by project cannot match a viewer whose project is unknown: say so rather than skip it unseen.
  const byProject = !options.all && (options.project !== undefined || options.port === undefined);
  const unknownProject = byProject ? viewers.filter((viewer) => viewer.projectRoot === null).map(withoutToken) : [];
  const caveats = surveyCaveats(survey);
  const summary: StopSummary = {
    found: viewers.length,
    matched: matched.length,
    stopped: results.length - notStopped.length,
    notStopped,
    unrecordedLeft,
    results,
    unknownProject,
    processScan: survey.processScan,
    caveats,
  };

  const pids = (list: ListedViewer[]) => list.map((viewer) => `pid ${viewer.pid ?? viewer.serverPid}, port ${viewer.port ?? "?"}`).join("; ");
  if (deps.json ?? isJson()) {
    log(JSON.stringify(summary, null, 2));
  } else {
    for (const { viewer, outcome } of results) {
      const done = outcome === "stopped" || outcome === "force-killed";
      const reason = outcome === "unverified" && viewer.unconfirmed ? ` (${viewer.unconfirmed})` : "";
      const text = `${OUTCOME_TEXT[outcome]} ${done ? "the viewer for " : ""}${where(viewer)}${reason}`;
      log(done ? ansis.green(`✓ ${text}`) : ansis.yellow(text));
    }
    const left = notStopped.length + unrecordedLeft.length;
    log(
      `${plural(summary.found, "viewer was", "viewers were")} running; ${summary.matched} matched; ${summary.stopped} stopped` +
        (left > 0 ? `; ${left} not stopped.` : ".")
    );
    if (unrecordedLeft.length > 0) {
      log(
        ansis.yellow(
          `${plural(unrecordedLeft.length, "matching viewer is", "matching viewers are")} not in this registry ` +
            `(${pids(unrecordedLeft)}) and ${unrecordedLeft.length === 1 ? "was" : "were"} left running: ` +
            "another state directory may have started them. Add `--include-unrecorded` to stop them too."
        )
      );
    }
    if (unknownProject.length > 0) {
      log(
        ansis.yellow(
          `${plural(unknownProject.length, "running viewer has", "running viewers have")} a project that could not be worked out ` +
            `(${pids(unknownProject)}) and could not be matched by project. ` +
            "Stop by `--port <n>` or `--all`; `dr visualize --list` shows them."
        )
      );
    }
    for (const caveat of caveats) log(ansis.yellow(caveat));
  }

  if (notStopped.length + unrecordedLeft.length > 0) {
    const parts = [
      ...notStopped.map(
        ({ viewer, outcome }) =>
          `${where(viewer)}: ${
            outcome === "not-permitted"
              ? "belongs to another user"
              : outcome === "timed-out"
                ? "did not exit in time and its pid could not be checked again, so it was not killed"
                : `pid not confirmed to be this viewer${viewer.unconfirmed ? ` (${viewer.unconfirmed})` : ""}`
          }`
      ),
      ...unrecordedLeft.map((viewer) => `${where(viewer)}: not in this registry (add --include-unrecorded)`),
    ];
    throw new CLIError(`${plural(parts.length, "matching viewer is", "matching viewers are")} still running: ${parts.join("; ")}`);
  }
  return summary;
}

export interface StopCommandOptions {
  /** Also stop every legacy per-project viewer whose pids are confirmed. */
  all?: boolean;
  /** With `all`: also legacy viewers found only in the process table. */
  includeUnrecorded?: boolean;
  /** Where to resolve the farm from (default: the working directory). */
  cwd?: string;
}

/** What `dr visualize --stop [--all]` did. */
export interface StopCommandResult {
  /** `dr serve --stop`'s result: `{ stopped, pid?, forced?, running? }`. */
  central: Record<string, unknown> | null;
  /** With --all: the legacy viewers' stop summary. */
  legacy: StopSummary | null;
}

/**
 * `dr visualize --stop`: stops the farm's central process with `dr serve --stop`'s confirmed stop.
 * With `--all`, then stops every legacy per-project viewer whose pids are confirmed (and, with
 * `--include-unrecorded`, the ones found only in the process table). Throws (exit 1) when either
 * leaves something running, after doing both.
 */
export async function stopCommand(
  options: StopCommandOptions,
  deps: ListRunningViewersDeps &
    OutputDeps & {
      stop?: StopViewerOptions;
      /** Replaces `serveCommand` (tests). */
      serve?: (options: { stop: true; json: true }, overrides: { cwd: string; env: NodeJS.ProcessEnv; out: (line: string) => void }) => Promise<void>;
    } = {}
): Promise<StopCommandResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const json = deps.json ?? isJson();
  const env = deps.env ?? process.env;
  const serve = deps.serve ?? (async (opts, overrides) => (await import("./serve.js")).serveCommand(opts, overrides));
  const errors: unknown[] = [];
  const result: StopCommandResult = { central: null, legacy: null };

  const centralOut: string[] = [];
  try {
    await serve({ stop: true, json: true }, { cwd: options.cwd ?? process.cwd(), env, out: (line) => centralOut.push(line) });
    result.central = centralOut.length > 0 ? (JSON.parse(centralOut[centralOut.length - 1]) as Record<string, unknown>) : null;
  } catch (error) {
    errors.push(error);
  }
  if (!json) {
    const c = result.central;
    if (c?.stopped) log(ansis.green(`✓ Stopped the DR process (pid ${c.pid}${c.forced ? ", killed after SIGTERM timed out" : ""}).`));
    else if (c && c.running === false) log("No DR process is running for this farm.");
  }

  if (options.all) {
    const legacyOut: string[] = [];
    try {
      result.legacy = await stopViewersCommand(
        { all: true, includeUnrecorded: options.includeUnrecorded },
        { ...deps, json, log: json ? (line) => legacyOut.push(line) : log }
      );
    } catch (error) {
      errors.push(error);
      if (json && legacyOut.length > 0) result.legacy = JSON.parse(legacyOut[legacyOut.length - 1]) as StopSummary;
    }
  }

  if (json) log(JSON.stringify(result, null, 2));
  if (errors.length > 0) {
    if (errors.length === 1) throw errors[0];
    throw new CLIError(errors.map((error) => (error instanceof Error ? error.message : String(error))).join("\n"));
  }
  return result;
}
