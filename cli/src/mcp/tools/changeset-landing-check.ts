/**
 * What changeset_commit checks about several changesets before it lands the first (#1209, #1292):
 * that each one's dependsOn has landed or lands earlier in the same call, and how they overlap each
 * other. Nothing here refuses a landing for an overlap: it is said, as drift is, so the person who
 * asked for the landing knows. A dependency out of order is refused, before anything lands.
 */

import type { Changeset } from "../../core/changeset.js";
import { computeChangesetOverlaps, type ChangesetOverlap, type OverlapReport } from "../../core/changeset-overlaps.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";

/** How many conflicts the landing result names; the true count is always given. */
export const CONFLICTS_NAMED = 20;

/** Loads the staged changesets a call names, skipping any that are not staged (the landing says why). */
async function loadStaged(manager: StagingAreaManager, names: string[]): Promise<Changeset[]> {
  const loaded: Changeset[] = [];
  for (const name of names) {
    const found = await manager.load(name).catch(() => null);
    if (found && found.status === "staged") loaded.push(found);
  }
  return loaded;
}

/**
 * Refuses a call that lands a changeset before one it depends on: the dependency must already have
 * landed, or come earlier in `names`. Checked for the whole call first, so nothing lands half-way.
 */
export async function assertDependenciesInOrder(manager: StagingAreaManager, names: string[]): Promise<void> {
  const staged = await loadStaged(manager, names);
  const landedBefore = new Set<string>();
  for (const changeset of staged) {
    const refusal = await manager.dependencyRefusal(changeset, landedBefore);
    if (refusal) {
      const suggestions = refusal instanceof CLIError ? refusal.suggestions : undefined;
      throw new CLIError(refusal.message, ErrorCategory.USER, suggestions);
    }
    landedBefore.add(changeset.id);
  }
}

export interface LandingOverlaps {
  /** Counts over every overlap, the order the call asked for against the suggested one, and the conflicts named. */
  overlaps: {
    counts: OverlapReport["counts"];
    requestedOrder: string[];
    suggestedOrder: string[];
    orderNotes: string[];
    conflicts: ChangesetOverlap[];
    note: string;
  };
}

/**
 * How the changesets a call lands overlap each other: nothing when fewer than two are staged or
 * none overlap in a way that matters. The same comparison as changeset_overlaps.
 */
export async function overlapsForLanding(manager: StagingAreaManager, names: string[]): Promise<LandingOverlaps | undefined> {
  const staged = await loadStaged(manager, names);
  if (staged.length < 2) return undefined;
  const report = computeChangesetOverlaps(staged);
  if (report.counts.total === 0) return undefined;
  const conflicts = report.overlaps.filter((o) => o.severity === "conflict");
  const requestedOrder = staged.map((c) => c.name);
  const differs = requestedOrder.join("\u0000") !== report.suggestedOrder.join("\u0000");
  const notNamed = report.counts.bySeverity.conflict - Math.min(conflicts.length, CONFLICTS_NAMED);
  return {
    overlaps: {
      counts: report.counts,
      requestedOrder,
      suggestedOrder: report.suggestedOrder,
      orderNotes: report.orderNotes,
      conflicts: conflicts.slice(0, CONFLICTS_NAMED),
      note:
        `${report.counts.total} overlap(s) between these changesets (${report.counts.bySeverity.conflict} that can't both land as they are). ` +
        (differs ? `They landed in the order asked; the suggested order is ${report.suggestedOrder.join(", ")}. ` : "") +
        (notNamed > 0 ? `${notNamed} conflict(s) are not named here: ` : "") +
        "changeset_overlaps lists every one, with what a combined change would need.",
    },
  };
}
