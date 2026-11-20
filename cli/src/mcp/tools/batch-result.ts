/**
 * What a batch write tool returns (model_add, relationship_add and model_update with a list).
 *
 * A batch used to echo every item: 300 elements came back as 300 `{index, name, id, status}`
 * objects that all said "staged", the largest single cost in a model sync (#1182). The default
 * result is now the counts by status and only the items that need attention: the ones that were
 * not written as sent (invalid, duplicate, restored, no-op), and the ones written with a warning
 * or a note (an id derived in a way the name does not make obvious, a reference read loosely).
 * `verbose: true` returns every item as before.
 */

import { z } from "zod";

/** The most attention items a batch lists; the rest are given by index. */
export const MAX_ATTENTION = 50;

export const verboseSchema = z
  .boolean()
  .optional()
  .describe(
    "Batch form only. Return every item's result (results) instead of the counts and the items that need " +
      "attention. Costs about 250 bytes an item; leave it off unless you need the id of every item."
  );

export interface BatchItemResult {
  /** Position in the request, from 0. */
  index: number;
  status: string;
  reason?: string;
  suggestions?: string[];
  warnings?: string[];
  notes?: string[];
}

export interface BatchReport<T extends BatchItemResult> {
  total: number;
  counts: Record<string, number>;
  /** Every item, with `verbose`. */
  results?: T[];
  /** The items that need attention (at most {@link MAX_ATTENTION}), without `verbose`. */
  attention?: Array<T | (Omit<T, "suggestions"> & { suggestionsAsFor: number })>;
  /** With more than {@link MAX_ATTENTION}: how many are not listed, and their indexes by status. */
  attentionNotListed?: { count: number; indexes: Record<string, number[]>; note: string };
}

/**
 * Builds a batch's report. `written` names the statuses that mean the item was written as sent
 * ("staged", "added", "updated"): such an item is listed only when it carries a warning or a note.
 */
export function batchReport<T extends BatchItemResult>(
  results: T[],
  options: { verbose?: boolean; written: readonly string[] }
): BatchReport<T> {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  if (options.verbose) return { total: results.length, counts, results };

  const flagged = results.filter(
    (r) => !options.written.includes(r.status) || (r.warnings?.length ?? 0) > 0 || (r.notes?.length ?? 0) > 0
  );
  if (flagged.length === 0) return { total: results.length, counts };

  // The same suggestions on many items (a type's valid predicates, its required attributes) are
  // listed once and pointed at.
  const firstWith = new Map<string, number>();
  const attention = flagged.slice(0, MAX_ATTENTION).map((item) => {
    if (!item.suggestions?.length) return item;
    const key = item.suggestions.join("\n");
    const first = firstWith.get(key);
    if (first === undefined) {
      firstWith.set(key, item.index);
      return item;
    }
    const { suggestions: _repeated, ...rest } = item;
    return { ...rest, suggestionsAsFor: first };
  });

  const report: BatchReport<T> = { total: results.length, counts, attention };
  const rest = flagged.slice(MAX_ATTENTION);
  if (rest.length > 0) {
    const indexes: Record<string, number[]> = {};
    for (const r of rest) (indexes[r.status] ??= []).push(r.index);
    report.attentionNotListed = {
      count: rest.length,
      indexes,
      note: `The first ${MAX_ATTENTION} are listed. Fix what they show and send the rest again, or pass verbose: true for every item.`,
    };
  }
  return report;
}
