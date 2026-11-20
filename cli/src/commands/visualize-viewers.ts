/**
 * `dr visualize --list` and `dr visualize --stop`: see and stop the viewers running on this
 * machine (#1237).
 *
 * Viewers that review_open starts are detached and outlive the session that asked for them, so
 * nothing on screen says they exist. These commands show every one, across projects, and stop
 * them, including viewers the registry has no record of (see server/viewer-control.ts).
 */

import ansis from "ansis";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  listRunningViewers,
  stopViewer,
  type ListRunningViewersDeps,
  type RunningViewer,
  type StopOutcome,
  type StopViewerOptions,
} from "../server/viewer-control.js";
import { canonicalProjectRoot } from "../server/viewer-registry.js";
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
  if (!viewer.answering) notes.push("does not answer");
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

/** `dr visualize --list`: every running viewer, with its project, port, pid, CLI version and start time. */
export async function listViewersCommand(deps: ListRunningViewersDeps & OutputDeps = {}): Promise<void> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const viewers = await listRunningViewers(deps);
  if (deps.json ?? isJson()) {
    log(JSON.stringify({ cliVersion: deps.cliVersion ?? getCliVersion(), viewers: viewers.map(withoutToken) }, null, 2));
    return;
  }
  if (viewers.length === 0) {
    log("No viewers are running.");
    return;
  }
  log(formatViewerTable(viewers, deps.cliVersion));
  log("");
  log(ansis.dim("Stop one with `dr visualize --stop <project>` (or `--stop --port <n>`), all with `dr visualize --stop --all`."));
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

const OUTCOME_TEXT: Record<StopOutcome, string> = {
  stopped: "Stopped",
  "force-killed": "Stopped (it did not exit in time and was killed)",
  "not-running": "Already gone:",
  "not-permitted": "Could not stop (it belongs to another user):",
  unverified: "Left alone (its pid could not be confirmed to be a viewer):",
};

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

/**
 * `dr visualize --stop [project] [--all] [--port n]`: stops the viewers of the current or named
 * project, the one on a port, or all of them, and waits for each to exit.
 */
export async function stopViewersCommand(
  options: StopViewersOptions,
  deps: ListRunningViewersDeps & OutputDeps & { stop?: StopViewerOptions } = {}
): Promise<StoppedViewer[]> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const viewers = await listRunningViewers(deps);
  const selected = await selectViewersToStop(viewers, options);
  const results: StoppedViewer[] = [];
  for (const viewer of selected) {
    const outcome = await stopViewer(viewer, { env: deps.env, ...deps.stop });
    results.push({ viewer: withoutToken(viewer), outcome });
  }

  if (deps.json ?? isJson()) {
    log(JSON.stringify({ stopped: results }, null, 2));
    return results;
  }
  if (results.length === 0) {
    log(viewers.length === 0 ? "No viewers are running." : "No running viewer matches. See `dr visualize --list`.");
    return results;
  }
  for (const { viewer, outcome } of results) {
    const where = `${shortPath(viewer.projectRoot)} (port ${viewer.port ?? "?"}, pid ${viewer.pid ?? viewer.serverPid ?? "?"})`;
    const text = `${OUTCOME_TEXT[outcome]} ${outcome === "stopped" || outcome === "force-killed" ? "the viewer for " : ""}${where}`;
    log(outcome === "stopped" || outcome === "force-killed" ? ansis.green(`✓ ${text}`) : ansis.yellow(text));
  }
  return results;
}
