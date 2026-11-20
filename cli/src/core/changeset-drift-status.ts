/**
 * A changeset's base drift as a reader meets it before any commit attempt: one state and a
 * sentence saying what it means for a landing. The viewer's changeset endpoints report it (GET
 * /api/changesets and GET /api/changesets/:id), so drift shows before Apply.
 *
 * No drift logic lives here. The state is `StagingAreaManager.detectDrift`'s answer, the one a
 * commit reports. What changed is `describeDrift`'s, the description changeset_brief gives.
 *
 * Drift never refuses a commit (#1200): a drifted changeset lands, and the landing says what the
 * base overlapped and what it did about each overlap. `blocksCommit` is therefore always false. It
 * is kept so a reader built when `drifted` did block (the viewer held Apply on it) keeps working;
 * read `state` instead.
 *
 * It is read by the changeset's purpose (changeset-purpose.ts): drift is about landing, so a
 * record (a verification record or an upgrade record), which never lands, has none to report
 * (#1171), and neither has a changeset that is no longer staged.
 *
 * | State            | Means                                                                    | At a landing          |
 * | ---------------- | ------------------------------------------------------------------------ | --------------------- |
 * | `none`           | The base is as it was when the changeset was created or re-baselined     | No warning            |
 * | `content-free`   | The base changed, but it overlaps none of the staged changes (#1169)     | No warning            |
 * | `drifted`        | The base overlaps a staged change, or there is no base index to tell     | Lands, with a warning |
 * | `not-applicable` | A record (never lands), or a changeset that is no longer staged          | -                     |
 * | `unknown`        | No base snapshot was recorded, or the check failed                       | No warning            |
 */

import { getErrorMessage } from "../utils/errors.js";
import { describeDrift, describedAsDrifted, type BaseRead, type ChangesetDrift } from "./changeset-base-index.js";
import { ChangesetGraph } from "./changeset-graph.js";
import type { ChangesetPurpose } from "./changeset-purpose.js";
import type { Changeset } from "./changeset.js";
import type { Model } from "./model.js";
import type { StagingAreaManager } from "./staging-area.js";

export const DRIFT_STATES = ["none", "content-free", "drifted", "not-applicable", "unknown"] as const;
export type DriftState = (typeof DRIFT_STATES)[number];

/** The drift summary: cheap enough to compute for every changeset in a list. */
export interface DriftStatus {
  state: DriftState;
  /**
   * @deprecated Always false: drift warns at a landing and never refuses it (#1200). Kept so the
   * shape readers were built against stays; read `state`.
   */
  blocksCommit: false;
  /** One or two sentences saying what the state means for this changeset. Names no CLI command. */
  message: string;
}

/** The summary plus what changed, for one changeset. The lists are present only when the base's hash changed. */
export interface DriftDetail extends DriftStatus {
  /** What the description could not tell: no base index, an unreadable one, a failed comparison. Empty when it could tell everything. */
  warnings?: string[];
  baseIndex?: ChangesetDrift["baseIndex"];
  /** Set when the changeset was re-baselined: baseChanges then counts from that base. */
  rebaselined?: ChangesetDrift["rebaselined"];
  /** What could not be checked for overlaps, when anything could not. */
  notChecked?: ChangesetDrift["notChecked"];
  overlapping?: ChangesetDrift["overlapping"];
  baseChanges?: ChangesetDrift["baseChanges"];
}

export interface DriftSubject {
  changeset: Changeset;
  purpose: ChangesetPurpose;
  /** For a verification record: the plan it verifies, when that changeset still exists. */
  plan?: { name: string; status: string };
}

/** What a verification record's message says about its plan. */
function planClause(plan: DriftSubject["plan"]): string {
  if (!plan) return "";
  if (plan.status === "committed") return ` Its plan '${plan.name}' has landed.`;
  if (plan.status === "staged") return ` Its plan '${plan.name}' is still staged.`;
  return ` Its plan '${plan.name}' is ${plan.status}.`;
}

/** The status that needs no check, or undefined when the changeset's base has to be compared. */
function withoutCheck({ changeset, purpose, plan }: DriftSubject): DriftStatus | undefined {
  if (changeset.status !== "staged") {
    return {
      state: "not-applicable",
      blocksCommit: false,
      message: `The changeset is ${changeset.status}, so base drift no longer applies to it.`,
    };
  }
  if (purpose === "verification") {
    return {
      state: "not-applicable",
      blocksCommit: false,
      message: `A verification record is never landed, so base drift does not apply to it.${planClause(plan)}`,
    };
  }
  if (purpose === "upgrade-record") {
    return {
      state: "not-applicable",
      blocksCommit: false,
      message: "An upgrade record is never landed, so base drift does not apply to it.",
    };
  }
  if (!changeset.baseSnapshot) {
    return {
      state: "unknown",
      blocksCommit: false,
      message: "No base snapshot was recorded for this changeset, so drift cannot be checked.",
    };
  }
  return undefined;
}

/**
 * A changeset's drift status. `manager` must hold the base model to compare with
 * (`new StagingAreaManager(rootPath, model)`).
 */
export async function driftStatus(
  manager: Pick<StagingAreaManager, "detectDrift">,
  subject: DriftSubject,
  options: DriftReadOptions = {}
): Promise<DriftStatus> {
  return (await checkedStatus(manager, subject, options)).status;
}

/** What the drift readers take besides the changeset. */
export interface DriftReadOptions {
  /**
   * One read of the base (`StagingAreaManager.readBase`) to share across the changesets of a list:
   * the base is indexed and hashed once for all of them.
   */
  base?: BaseRead;
  /** For the detail: how many entries of each `baseChanges` list (default 50, no upper bound). */
  limit?: number;
  /** For the detail: where in each `baseChanges` list to start (default 0). */
  offset?: number;
}

/** The status, with the description the check made on the way when it made one. */
async function checkedStatus(
  manager: Pick<StagingAreaManager, "detectDrift">,
  subject: DriftSubject,
  options: DriftReadOptions
): Promise<{ status: DriftStatus; described?: ChangesetDrift }> {
  const settled = withoutCheck(subject);
  if (settled) return { status: settled };
  try {
    const hash = await manager.detectDrift(subject.changeset, { base: options.base });
    const status = statusOf(hash);
    return { status, ...(hash.described ? { described: hash.described } : {}) };
  } catch (error) {
    return {
      status: {
        state: "unknown",
        blocksCommit: false,
        message: `Drift could not be checked: ${getErrorMessage(error)}`,
      },
    };
  }
}

function statusOf(hash: Awaited<ReturnType<StagingAreaManager["detectDrift"]>>): DriftStatus {
  if (hash.contentFree) {
    return { state: "content-free", blocksCommit: false, message: hash.warnings[0] };
  }
  if (hash.isDrifted) {
    return {
      state: "drifted",
      blocksCommit: false,
      // Either the base overlaps a staged change (`overlapping`, in the detail), or there is no base
      // index to tell an overlapping change from another.
      message:
        "The base model overlaps what this changeset stages (or it has no base index to tell). It still lands: " +
        "the landing says what overlaps and what it does about each overlap.",
    };
  }
  return {
    state: "none",
    blocksCommit: false,
    message: "The base model has not changed under this changeset.",
  };
}

/**
 * A changeset's drift status with what changed in the base under it: the staged changes the base
 * now overlaps and, with a base index, the elements and relationships added, removed or changed
 * since the changeset was created (`describeDrift`). Described only when the base's hash changed
 * (states `content-free` and `drifted`); a failure to describe it is a warning, not an error.
 *
 * `overlapping` is whole. The `baseChanges` lists are a page (`options.limit`, `options.offset`),
 * and `baseChanges.page` says what there is and where to go on.
 */
export async function driftDetail(
  model: Model,
  manager: Pick<StagingAreaManager, "detectDrift">,
  subject: DriftSubject,
  options: DriftReadOptions = {}
): Promise<DriftDetail> {
  const { status, described: fromCheck } = await checkedStatus(manager, subject, options);
  if (status.state !== "content-free" && status.state !== "drifted") return status;
  try {
    // The check described the drift to decide (the first page of its lists); it is described again
    // only for another page, or when the check could not describe it.
    // `overlapping` is returned as it is, so `warnings` doesn't say it a second time in a line.
    const firstPage = options.limit === undefined && options.offset === undefined;
    const described =
      fromCheck && firstPage
        ? describedAsDrifted(fromCheck)
        : await describeDrift(
            model,
            await ChangesetGraph.build(model, subject.changeset),
            { isDrifted: true, warnings: [] },
            { overlapWarning: false, base: options.base, limit: options.limit, offset: options.offset }
          );
    return {
      ...status,
      warnings: described.warnings,
      baseIndex: described.baseIndex,
      ...(described.rebaselined ? { rebaselined: described.rebaselined } : {}),
      ...(described.notChecked ? { notChecked: described.notChecked } : {}),
      overlapping: described.overlapping,
      ...(described.baseChanges ? { baseChanges: described.baseChanges } : {}),
    };
  } catch (error) {
    return { ...status, warnings: [`Could not name what changed in the base: ${getErrorMessage(error)}`] };
  }
}
