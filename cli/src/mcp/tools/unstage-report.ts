/**
 * What changeset_unstage says it removed (#1299). Compact by default: the count, the count per
 * operation, and one line per change (`changeLine`) for the first UNSTAGE_LINES; the rest are
 * counted, never dropped silently. One item that takes 80 relationship changes is a count and 25
 * lines, not 25 KB of objects. `detail: "full"` returns each removed change as an object.
 *
 * An unstage cannot be repeated for a second page, so the result names the exact call that lists
 * the rest: changeset_brief with the delta since the revision the changeset was at before the write,
 * which lists every change unstaged since from its tombstones (the changeset keeps the newest
 * MAX_UNSTAGED_TOMBSTONES of them).
 */

import { z } from "zod";
import type { StagedChange } from "../../core/changeset.js";
import { changeLine } from "../../core/changeset-summary.js";
import { stagedRelationshipTriple } from "../../core/relationship-staging.js";
import { MAX_UNSTAGED_TOMBSTONES } from "../../core/staged-changeset-storage.js";

/** Removed changes listed as lines per unstage (or per item of a list); the rest are counted. */
export const UNSTAGE_LINES = 25;

export const unstageDetailField = z
  .enum(["compact", "full"])
  .optional()
  .describe(
    `"compact" (default): what was removed as counts per operation and one line per change (the first ` +
      `${UNSTAGE_LINES} of each unstage, the rest counted). "full": each removed change as an object.`
  );

/** A removed change as the full form lists it: its type, key and layer, and the relationship it names. */
export function unstagedObject(change: StagedChange): Record<string, unknown> {
  const triple = change.type.startsWith("relationship-") ? stagedRelationshipTriple(change) : null;
  return {
    type: change.type,
    elementId: change.elementId,
    layer: change.layerName,
    ...(triple ? { relationship: triple } : {}),
  };
}

export interface UnstagedReport {
  /** Lines (compact) or objects (full) for the changes removed. */
  unstaged: Array<string | Record<string, unknown>>;
  unstagedCount: number;
  byOperation: Record<string, number>;
  /** Compact only: how many removed changes have no line here. */
  unstagedNotListed?: number;
}

export function unstagedReport(removed: readonly StagedChange[], detail: "compact" | "full" = "compact"): UnstagedReport {
  const byOperation: Record<string, number> = {};
  for (const change of removed) byOperation[change.type] = (byOperation[change.type] ?? 0) + 1;
  if (detail === "full") {
    return { unstaged: removed.map(unstagedObject), unstagedCount: removed.length, byOperation };
  }
  const listed = removed.slice(0, UNSTAGE_LINES);
  return {
    unstaged: listed.map((change, index) => changeLine(change, index)),
    unstagedCount: removed.length,
    byOperation,
    ...(removed.length > listed.length ? { unstagedNotListed: removed.length - listed.length } : {}),
  };
}

/**
 * The sentence a result adds when some removed changes are counted, not listed: the exact call that
 * lists every one of them. `revision` is the changeset's revision before the write, `removed` how
 * many changes the write removed in all.
 */
export function unstagedNotListedNote(
  notListed: number,
  recovery: { changesetId: string; revision: number; removed: number }
): string | undefined {
  if (notListed <= 0) return undefined;
  const call = { changeset: recovery.changesetId, sections: ["delta"], since: recovery.revision };
  const kept =
    recovery.removed > MAX_UNSTAGED_TOMBSTONES
      ? ` The changeset keeps the newest ${MAX_UNSTAGED_TOMBSTONES} unstaged changes, so that lists the last ` +
        `${MAX_UNSTAGED_TOMBSTONES} of these ${recovery.removed}; byOperation counts them all.`
      : "";
  return (
    `${notListed} removed change(s) are counted in byOperation, not listed here (the first ${UNSTAGE_LINES} of each ` +
    `unstage are). changeset_brief ${JSON.stringify(call)} lists every change this unstage removed, in delta.unstaged.` +
    `${kept} detail: "full" on a later unstage lists what it removes as objects.`
  );
}
