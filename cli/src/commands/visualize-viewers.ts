/**
 * `dr visualize --list` and `dr visualize --stop`: see and stop the viewers running on this
 * machine (#1237).
 *
 * Viewers that review_open starts are detached and outlive the session that asked for them, so
 * nothing on screen says they exist. These commands show every one, across projects, and stop
 * them, including viewers the registry has no record of (see server/viewer-control.ts).
 *
 * Neither command passes off a partial answer as a whole one. The list says how many viewers it
 * found and where (the registry, the process table), and when the process table could not be
 * read it says that viewers the registry lost are not shown. A stop says how many viewers were
 * running, how many it was asked to stop, how many it stopped, and names each one it could not.
 */

import ansis from "ansis";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  stopViewer,
  surveyViewers,
  type ListRunningViewersDeps,
  type RunningViewer,
  type StopOutcome,
  type StopViewerOptions,
  type ViewerSurvey,
} from "../server/viewer-control.js";
import { canonicalProjectRoot, describeSweep } from "../server/viewer-registry.js";
import { ignoredViewerSettings, viewerSettingsInEffect } from "../server/viewer-settings.js";
import { CLIError } from "../utils/errors.js";
import { isJson } from "../utils/globals.js";
import { findProjectRoot } from "../utils/project-paths.js";
import { getCliVersion } from "../utils/spec-version.js";

/** A viewer as `--json` prints it: everything but its auth token. */
export type ListedViewer = Omit<RunningViewer, "token">;

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
  return notes;
}

/** The viewers as a table, one line each. */
export function formatViewerTable(viewers: RunningViewer[], cliVersion: string = getCliVersion()): string {
  const rows = viewers.map((viewer) => [
    shortPath(viewer.projectRoot),
    viewer.port === null ? "?" : String(viewer.port),
    String(viewer.pid ?? viewer.serverPid ?? "?"),
    viewer.cliVersion ?? (viewer.answering ? "<0.6.0" : "?"),
    localTime(viewer.startedAt),
    viewerNotes(viewer, cliVersion).join("; "),
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

/** Says that the list may be missing viewers, when the process table could not be read. */
export function incompleteNote(survey: ViewerSurvey): string | null {
  if (survey.processScan) return null;
  return (
    `The registry lists ${survey.viewers.length === 0 ? "no viewers" : plural(survey.viewers.length, "viewer", "viewers")}. ` +
    "A process scan was not possible (ps is unavailable here or failed), so viewers the registry has lost are not shown."
  );
}

/**
 * `dr visualize --list`: every running viewer, with its project, port, pid, CLI version and start
 * time; how many there are and where they were found; what reading the registry removed; and,
 * when the process table could not be read, that the list may be incomplete.
 */
export async function listViewersCommand(deps: ListRunningViewersDeps & OutputDeps = {}): Promise<ViewerSurvey> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const env = deps.env ?? process.env;
  const survey = await surveyViewers(deps);
  const { viewers } = survey;
  const counts = surveyCounts(survey);
  const incomplete = incompleteNote(survey);
  const ignored = ignoredViewerSettings(env);

  if (deps.json ?? isJson()) {
    log(
      JSON.stringify(
        {
          cliVersion: deps.cliVersion ?? getCliVersion(),
          complete: survey.processScan,
          processScan: survey.processScan
            ? { available: true }
            : { available: false, note: incomplete },
          counts,
          swept: {
            records: survey.swept.records,
            startingMarkers: survey.swept.markers,
            logs: survey.swept.logs,
            tempFiles: survey.swept.tempFiles,
            removed: survey.swept.removed,
          },
          settings: viewerSettingsInEffect(env),
          viewers: viewers.map(withoutToken),
        },
        null,
        2
      )
    );
    return survey;
  }

  for (const warning of ignored) log(ansis.yellow(warning));
  if (viewers.length > 0) {
    log(formatViewerTable(viewers, deps.cliVersion));
    log("");
  }
  if (incomplete) {
    log(ansis.yellow(incomplete));
  } else if (viewers.length === 0) {
    log("No viewers are running.");
  } else {
    log(
      `${plural(counts.total, "viewer", "viewers")} running: ${counts.inRegistry} in the registry, ` +
        `${counts.processOnly} found only in the process table.`
    );
  }
  const removed = describeSweep(survey.swept);
  if (removed) log(`Removed ${removed} from the registry.`);
  if (viewers.length > 0) {
    log(ansis.dim("Stop one with `dr visualize --stop <project>` (or `--stop --port <n>`), all with `dr visualize --stop --all`."));
  }
  return survey;
}

export interface StopViewersOptions {
  /** A project folder; the current project when absent and neither `all` nor `port` is given. */
  project?: string;
  all?: boolean;
  /** Only the viewer on this port. */
  port?: string | number;
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
  /** Each one that is still running, with why. */
  notStopped: StoppedViewer[];
  /** Every matched viewer with what happened to it. */
  results: StoppedViewer[];
  /** Running viewers whose project could not be worked out, so a stop by project could not consider them. */
  unknownProject: ListedViewer[];
  /** Whether the process table could be read; false means viewers the registry lost were not seen. */
  processScan: boolean;
}

const OUTCOME_TEXT: Record<StopOutcome, string> = {
  stopped: "Stopped",
  "force-killed": "Stopped (it did not exit in time and was killed)",
  "not-running": "Already gone:",
  "not-permitted": "Could not stop (it belongs to another user):",
  unverified: "Left alone (its pid could not be confirmed to be a viewer):",
};

const NOT_STOPPED: ReadonlySet<StopOutcome> = new Set<StopOutcome>(["not-permitted", "unverified"]);

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
 * `dr visualize --stop [project] [--all] [--port n]`: stops the viewers of the current or named
 * project, the one on a port, or all of them, and waits for each to exit. Says how many viewers
 * were running, how many it was asked to stop and how many it stopped, and names each one it
 * could not stop. Throws (exit 1) when any is still running.
 */
export async function stopViewersCommand(
  options: StopViewersOptions,
  deps: ListRunningViewersDeps & OutputDeps & { stop?: StopViewerOptions } = {}
): Promise<StopSummary> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const survey = await surveyViewers(deps);
  const { viewers } = survey;
  const selected = await selectViewersToStop(viewers, options);
  const results: StoppedViewer[] = [];
  for (const viewer of selected) {
    const outcome = await stopViewer(viewer, { env: deps.env, ...deps.stop });
    results.push({ viewer: withoutToken(viewer), outcome });
  }
  const notStopped = results.filter((result) => NOT_STOPPED.has(result.outcome));
  // A stop by project cannot match a viewer whose project is unknown: say so rather than skip it unseen.
  const byProject = !options.all && (options.project !== undefined || options.port === undefined);
  const unknownProject = byProject ? viewers.filter((viewer) => viewer.projectRoot === null).map(withoutToken) : [];
  const summary: StopSummary = {
    found: viewers.length,
    matched: selected.length,
    stopped: results.length - notStopped.length,
    notStopped,
    results,
    unknownProject,
    processScan: survey.processScan,
  };
  const incomplete = incompleteNote(survey);

  if (deps.json ?? isJson()) {
    log(JSON.stringify({ ...summary, complete: survey.processScan, ...(incomplete ? { note: incomplete } : {}) }, null, 2));
  } else {
    for (const { viewer, outcome } of results) {
      const done = outcome === "stopped" || outcome === "force-killed";
      const text = `${OUTCOME_TEXT[outcome]} ${done ? "the viewer for " : ""}${where(viewer)}`;
      log(done ? ansis.green(`✓ ${text}`) : ansis.yellow(text));
    }
    log(
      `${plural(summary.found, "viewer was", "viewers were")} running; ${summary.matched} matched; ${summary.stopped} stopped` +
        (notStopped.length > 0 ? `; ${notStopped.length} not stopped.` : ".")
    );
    if (unknownProject.length > 0) {
      log(
        ansis.yellow(
          `${plural(unknownProject.length, "running viewer has", "running viewers have")} a project that could not be worked out ` +
            `(${unknownProject.map((viewer) => `pid ${viewer.pid ?? viewer.serverPid}`).join(", ")}) and ` +
            "could not be matched by project. Stop by `--port <n>` or `--all`; `dr visualize --list` shows them."
        )
      );
    }
    if (incomplete) log(ansis.yellow(incomplete));
  }

  if (notStopped.length > 0) {
    throw new CLIError(
      `${plural(notStopped.length, "viewer is", "viewers are")} still running: ` +
        notStopped.map(({ viewer, outcome }) => `${where(viewer)}: ${outcome === "not-permitted" ? "belongs to another user" : "pid not confirmed to be a viewer"}`).join("; ")
    );
  }
  return summary;
}
