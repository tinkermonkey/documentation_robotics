/**
 * Refusals for a write that cannot go where it was aimed because its changeset landed, or is
 * landing (#1437). A write never reports success unless it is on disk in a staged changeset or in
 * the model, and never falls through to the base model in place of the changeset it was aimed at:
 *
 * - A landing holds its changeset's lock from the read it lands to the save that marks it committed
 *   (StagingAreaManager.commit), recording itself as the lock's owner. A write that finds that lock
 *   refuses at once (changesetBeingLandedError), and one that gets the lock afterwards finds the
 *   changeset committed and refuses (changesetNotStagedError).
 * - A landing of the active changeset leaves a landed note (active-changeset-marker.ts). Until a
 *   changeset is activated or created, or the checkout deactivates, a write refuses with the note
 *   (landedActiveChangesetError) instead of writing the base model.
 */

import { CLIError, ErrorCategory } from "../utils/errors.js";
import type { LockOwner } from "../utils/file-lock.js";
import type { LandedNote } from "./active-changeset-marker.js";

/** The purpose a landing records as its changeset lock's owner. */
export const LANDING_LOCK_PURPOSE = "landing";

/** What to do instead, for every refusal here. */
const NEXT_STEPS = [
  'To keep planning, create or activate a changeset ("changeset_create" or "changeset_activate"; dr changeset ' +
    "create or activate) and send the write again",
  'To write the base model instead, deactivate ("changeset_deactivate"; dr changeset deactivate) and send the write again',
];

/** A write refused because the changeset it was aimed at landed or is landing. Nothing was written. */
export class ChangesetClosedToWritesError extends CLIError {
  constructor(
    message: string,
    readonly changeset: { id: string; name: string },
    readonly state: "landing" | "landed" | "discarded" | "missing"
  ) {
    super(message, ErrorCategory.USER, NEXT_STEPS);
    this.name = "ChangesetClosedToWritesError";
  }
}

function when(at: string | undefined): string {
  return at ? ` at ${at}` : "";
}

/** The checkout's active changeset was landed (the landed note): the write is not made anywhere. */
export function landedActiveChangesetError(note: LandedNote): ChangesetClosedToWritesError {
  return new ChangesetClosedToWritesError(
    `Changeset '${note.name}' was landed${when(note.landedAt)} while it was the active changeset, so it takes no more ` +
      "writes, and this one was not made. Writes don't go to the base model in its place until you say so.",
    { id: note.id, name: note.name },
    "landed"
  );
}

/** The changeset's lock is held by its landing: the write is refused rather than lost. */
export function changesetBeingLandedError(changeset: { id: string; name: string }, owner: LockOwner | null): ChangesetClosedToWritesError {
  return new ChangesetClosedToWritesError(
    `Changeset '${changeset.name}' is being landed${owner?.since ? ` (since ${owner.since})` : ""}, so this write was not ` +
      "staged into it. Once it lands it takes no more writes.",
    changeset,
    "landing"
  );
}

/** The changeset is no longer staged (landed meanwhile, or discarded): the write was not staged. */
export function changesetNotStagedError(
  changeset: { id?: string; name: string; status: string; modified?: string }
): ChangesetClosedToWritesError {
  const landed = changeset.status === "committed";
  return new ChangesetClosedToWritesError(
    landed
      ? `Changeset '${changeset.name}' was landed${when(changeset.modified)}, so it takes no more writes, and this one was not staged.`
      : `Changeset '${changeset.name}' is ${changeset.status}, so it takes no writes, and this one was not staged.`,
    { id: changeset.id ?? changeset.name, name: changeset.name },
    landed ? "landed" : "discarded"
  );
}

/** The owner a landing records on its changeset's lock. */
export function landingLockOwner(changeset: { id?: string; name: string }): LockOwner {
  return { purpose: LANDING_LOCK_PURPOSE, changeset: changeset.name, ...(changeset.id ? { changesetId: changeset.id } : {}) };
}

/**
 * Refuses a write that finds its changeset's lock held by the landing (FileLock refuseWhenHeldBy):
 * at once, instead of waiting for a landing that will close the changeset to writes.
 */
export function refuseWhileLanding(changesetId: string) {
  return (owner: LockOwner | null) =>
    owner?.purpose === LANDING_LOCK_PURPOSE
      ? changesetBeingLandedError({ id: changesetId, name: typeof owner.changeset === "string" ? owner.changeset : changesetId }, owner)
      : null;
}
