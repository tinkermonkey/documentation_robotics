/**
 * Moving users off per-project viewers (issue 1279, `docs/design/USER_LEVEL_DR.md` section 7).
 *
 * The central DR process calls `sweepPerProjectViewers` when it starts. It finds the per-project
 * viewers that CLI 0.7.x left running (their registry records and the process scan, through
 * `surveyViewers`) and stops the ones nobody is using: a viewer `review_open` started, whose own
 * server answers and reports no connected browser tab. Every other viewer is kept and reported
 * with its pids and the reason, for `dr visualize --list` to show and `dr visualize --stop` to end.
 * It never stops a viewer someone started from a terminal, one with a tab open, one whose pids it
 * can't confirm, or (given the farm's folders) one whose project is not in this process's farm: a
 * CLI run from source with its own farm leaves the installed CLI's viewers alone (#1369).
 * `dr serve --no-sweep`, and an isolated process (`--state-dir`), skip the sweep altogether.
 */

import { sep } from "node:path";
import {
  stopViewer,
  surveyCaveats,
  surveyViewers,
  type ListRunningViewersDeps,
  type RunningViewer,
  type StopOutcome,
  type StopViewerOptions,
  type ViewerSurvey,
} from "./viewer-control.js";

/** Why a per-project viewer was left running. */
export type KeptReason =
  /** Started by a person (`dr visualize` in a terminal), or by a CLI too old to record who started it. */
  | "not-started-by-review-open"
  /** One or more browser tabs are connected to it. */
  | "tabs-connected"
  /** Its own server didn't answer, or didn't report its tabs, so it can't be shown to be unused. */
  | "unknown-tabs"
  /** Its pids couldn't be confirmed to be a viewer's, so nothing may be signalled. */
  | "unconfirmed"
  /** It is one of the pids the caller excluded (the central process itself). */
  | "excluded"
  /** Its project is not in this process's farm (or it is unknown): another farm's process, or another CLI's, decides (#1369). */
  | "outside-farm"
  /** It was signalled but did not stop. */
  | "stop-failed";

export interface KeptViewer {
  viewer: RunningViewer;
  reason: KeptReason;
  /** For `stop-failed`: what the stop reported. */
  outcome?: StopOutcome;
}

export interface StoppedViewer {
  viewer: RunningViewer;
  outcome: Extract<StopOutcome, "stopped" | "force-killed" | "not-running">;
}

export interface PerProjectViewerSweep {
  stopped: StoppedViewer[];
  kept: KeptViewer[];
  /** What the survey leaves out (no process scan, unconfirmed candidates, other users' viewers), as sentences to show. */
  caveats: string[];
}

export interface SweepPerProjectViewersOptions {
  /** Pids that are never stopped or reported: the central process and its launcher. */
  excludePids?: number[];
  /**
   * The folders of this farm's projects and checkouts (real paths). When given, only a viewer whose
   * project is in one of them may be stopped; the others are kept as `outside-farm` (#1369).
   */
  farmRoots?: string[];
  /** Passed to `surveyViewers` (tests inject the process table, health checks and liveness). */
  survey?: ListRunningViewersDeps;
  /** Passed to `stopViewer`. */
  stop?: StopViewerOptions;
  /** Replaces `surveyViewers` (tests). */
  surveyViewers?: (deps: ListRunningViewersDeps) => Promise<ViewerSurvey>;
  /** Replaces `stopViewer` (tests). */
  stopViewer?: (viewer: RunningViewer, options: StopViewerOptions) => Promise<StopOutcome>;
}

/** Whether `folder` is one of `roots` or inside one. */
function insideAny(folder: string, roots: readonly string[]): boolean {
  return roots.some((root) => folder === root || folder.startsWith(root.endsWith(sep) ? root : root + sep));
}

/** Whether the sweep may stop this viewer, and if not, why. `farmRoots` limits it to this farm's folders. */
export function sweepDecision(
  viewer: RunningViewer,
  excluded: ReadonlySet<number> = new Set(),
  farmRoots?: readonly string[]
): "stop" | KeptReason {
  if ([viewer.pid, viewer.serverPid].some((pid) => pid !== null && excluded.has(pid))) return "excluded";
  if (viewer.startedBy !== "review_open") return "not-started-by-review-open";
  if (farmRoots && (viewer.projectRoot === null || !insideAny(viewer.projectRoot, farmRoots))) return "outside-farm";
  if (!viewer.answering || viewer.clients === undefined) return "unknown-tabs";
  if (viewer.clients > 0) return "tabs-connected";
  if (!viewer.confirmed) return "unconfirmed";
  return "stop";
}

/**
 * Stops the unused per-project viewers `review_open` started and reports the rest.
 * Viewers are stopped one at a time, so one that won't stop doesn't hold up the report of the others.
 */
export async function sweepPerProjectViewers(
  options: SweepPerProjectViewersOptions = {}
): Promise<PerProjectViewerSweep> {
  const survey = await (options.surveyViewers ?? surveyViewers)(options.survey ?? {});
  const stop = options.stopViewer ?? stopViewer;
  const excluded = new Set(options.excludePids ?? []);
  const result: PerProjectViewerSweep = { stopped: [], kept: [], caveats: surveyCaveats(survey) };

  for (const viewer of survey.viewers) {
    const decision = sweepDecision(viewer, excluded, options.farmRoots);
    if (decision === "excluded") continue;
    if (decision !== "stop") {
      result.kept.push({ viewer, reason: decision });
      continue;
    }
    const outcome = await stop(viewer, options.stop ?? {});
    if (outcome === "stopped" || outcome === "force-killed" || outcome === "not-running") {
      result.stopped.push({ viewer, outcome });
    } else {
      result.kept.push({ viewer, reason: "stop-failed", outcome });
    }
  }
  return result;
}
