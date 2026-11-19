/**
 * A changeset's base drift as a reader meets it before any commit attempt: one state, whether it
 * blocks a commit, and a sentence saying why. The viewer's changeset endpoints report it (GET
 * /api/changesets and GET /api/changesets/:id), so drift shows before Apply instead of in Apply's
 * refusal.
 *
 * No drift logic lives here. The state is `StagingAreaManager.detectDrift`'s answer, the one a
 * commit acts on, so `blocksCommit` is true exactly when a commit would be refused for drift. What
 * changed is `describeDrift`'s, the description changeset_brief gives.
 *
 * It is read by the changeset's purpose (changeset-purpose.ts): drift is about landing, so a
 * record (a verification record or an upgrade record), which never lands, has none to report
 * (#1171), and neither has a changeset that is no longer staged.
 *
 * | State            | Means                                                                    | Blocks a commit |
 * | ---------------- | ------------------------------------------------------------------------ | --------------- |
 * | `none`           | The base is as it was when the changeset was created                     | No              |
 * | `content-free`   | The base changed, but it overlaps none of the staged changes (#1169)     | No              |
 * | `drifted`        | The base overlaps a staged change, or there is no base index to tell     | Yes             |
 * | `not-applicable` | A record (never lands), or a changeset that is no longer staged          | No              |
 * | `unknown`        | No base snapshot was recorded, or the check failed                       | No              |
 */

import { getErrorMessage } from "../utils/errors.js";
import { describeDrift, type ChangesetDrift } from "./changeset-base-index.js";
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
  /** True when a commit would be refused for drift. Only ever true in state `drifted`. */
  blocksCommit: boolean;
  /** One or two sentences saying what the state means for this changeset. Names no CLI command. */
  message: string;
}

/** The summary plus what changed, for one changeset. The lists are present only when the base's hash changed. */
export interface DriftDetail extends DriftStatus {
  /** What the description could not tell: no base index, an unreadable one, a failed comparison. Empty when it could tell everything. */
  warnings?: string[];
  baseIndex?: ChangesetDrift["baseIndex"];
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
      message: "No base snapshot was recorded for this changeset, so drift cannot be checked. A commit is not blocked by drift.",
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
  subject: DriftSubject
): Promise<DriftStatus> {
  const settled = withoutCheck(subject);
  if (settled) return settled;
  try {
    const hash = await manager.detectDrift(subject.changeset.id!);
    if (hash.contentFree) {
      return { state: "content-free", blocksCommit: false, message: hash.warnings[0] };
    }
    if (hash.isDrifted) {
      return {
        state: "drifted",
        blocksCommit: true,
        // Either the base overlaps a staged change (`overlapping`, in the detail), or there is no base
        // index to tell an overlapping change from another.
        message:
          "The base model changed under what this changeset stages since it was created (or it has no base index " +
          "to tell), so a commit is refused for drift.",
      };
    }
    return {
      state: "none",
      blocksCommit: false,
      message: "The base model has not changed since this changeset was created.",
    };
  } catch (error) {
    return {
      state: "unknown",
      blocksCommit: false,
      message: `Drift could not be checked: ${getErrorMessage(error)}`,
    };
  }
}

/**
 * A changeset's drift status with what changed in the base under it: the staged changes the base
 * now overlaps and, with a base index, the elements and relationships added, removed or changed
 * since the changeset was created (`describeDrift`). Described only when the base's hash changed
 * (states `content-free` and `drifted`); a failure to describe it is a warning, not an error.
 */
export async function driftDetail(
  model: Model,
  manager: Pick<StagingAreaManager, "detectDrift">,
  subject: DriftSubject
): Promise<DriftDetail> {
  const status = await driftStatus(manager, subject);
  if (status.state !== "content-free" && status.state !== "drifted") return status;
  try {
    // Described only when the hash changed, which is said here so a missing base index is reported.
    // `overlapping` is returned as it is, so `warnings` doesn't say it a second time in a line.
    const described = await describeDrift(
      model,
      await ChangesetGraph.build(model, subject.changeset),
      { isDrifted: true, warnings: [] },
      { overlapWarning: false }
    );
    return {
      ...status,
      warnings: described.warnings,
      baseIndex: described.baseIndex,
      overlapping: described.overlapping,
      ...(described.baseChanges ? { baseChanges: described.baseChanges } : {}),
    };
  } catch (error) {
    return { ...status, warnings: [`Could not name what changed in the base: ${getErrorMessage(error)}`] };
  }
}
