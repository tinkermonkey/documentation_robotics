/**
 * What changeset_unstage says it removed (#1299). Compact by default: the count, the count per
 * operation, and one line per change (`changeLine`) for the first UNSTAGE_LINES; the rest are
 * counted, never dropped silently. One item that takes 80 relationship changes is a count and 25
 * lines, not 25 KB of objects. `detail: "full"` returns each removed change as an object.
 *
 * An unstage cannot be repeated for a second page, so the lines not listed are named where they can
 * still be read: changeset_brief with `since` lists every change unstaged since that revision.
 */

import { z } from "zod";
import type { StagedChange } from "../../core/changeset.js";
import { changeLine } from "../../core/changeset-summary.js";
import { stagedRelationshipTriple } from "../../core/relationship-staging.js";

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

/** The sentence a result adds when some removed changes are counted, not listed. */
export function unstagedNotListedNote(notListed: number): string | undefined {
  if (notListed <= 0) return undefined;
  return (
    `${notListed} removed change(s) are counted in byOperation, not listed (the first ${UNSTAGE_LINES} of each ` +
    'unstage are). changeset_brief with since (an earlier revisionToken) lists every unstaged change; detail: "full" ' +
    "on an unstage lists them all."
  );
}
