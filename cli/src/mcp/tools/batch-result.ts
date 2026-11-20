/**
 * What a batch write tool returns (model_add, relationship_add and model_update with a list).
 *
 * A batch used to echo every item: 300 elements came back as 300 `{index, name, id, status}`
 * objects that all said "staged", the largest single cost in a model sync (#1182). The default
 * result is now the counts by status and the items that need attention: the ones that were not
 * written as sent (invalid, duplicate, restored, no-op), and the ones written with a warning or a
 * note (an id the name does not make obvious, a reference read by name).
 *
 * Nothing is dropped to keep the result small. A write cannot be paged by calling it again, so
 * one response accounts for every item:
 *
 * - `counts` covers the whole batch, always.
 * - `attention` lists items in full, the ones that were not written first, up to `limit`
 *   (default {@link DEFAULT_ATTENTION_LIMIT}); `attentionTotal` is how many there are in all.
 * - Past the limit, every remaining item is in `attentionNotListed.groups`: grouped by its reason
 *   (with the ids and names that differ between items taken out), with its position in the
 *   request, and its id when it was written. The group says what happened to each; the item's own
 *   message and suggestions come with a higher `limit` or `verbose: true`.
 * - `verbose: true` returns every item as `results`.
 */

import { z } from "zod";

/** How many attention items a batch lists in full unless `limit` says otherwise. */
export const DEFAULT_ATTENTION_LIMIT = 50;

export const verboseSchema = z
  .boolean()
  .optional()
  .describe(
    "Batch form only. Return every item's result (results) instead of the counts and the items that need " +
      "attention. Costs about 250 bytes an item; leave it off unless you need the id of every item."
  );

export const limitSchema = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe(
    `Batch form only. How many of the items that need attention are returned in full (default ${DEFAULT_ATTENTION_LIMIT}), ` +
      "the ones that were not written first. The rest are never dropped: each is listed by its position under its " +
      "reason (attentionNotListed). Pass a larger number to get more of them in full."
  );

export interface BatchItemResult {
  /** Position in the request, from 0. */
  index: number;
  status: string;
  /** The element the item is about, when it has one. */
  id?: string;
  reason?: string;
  suggestions?: string[];
  warnings?: string[];
  notes?: string[];
}

/** Attention items past the limit that share a status and a reason. Together the groups hold every such item. */
export interface BatchAttentionGroup {
  status: string;
  /** The items' reason, warning or note, with the ids and names that differ between items replaced. */
  reason: string;
  count: number;
  /** Positions in the request, from 0. */
  indexes: number[];
  /** For items that were written: their ids, in the order of `indexes`. */
  ids?: string[];
}

export interface BatchReport<T extends BatchItemResult> {
  /** Items in the request. */
  total: number;
  /** Items by status, over the whole batch. */
  counts: Record<string, number>;
  /** Every item, with `verbose`. */
  results?: T[];
  /** The items that need attention, in full: not written first, then written with a warning or a note. */
  attention?: Array<T | (Omit<T, "suggestions"> & { suggestionsAsFor: number })>;
  /** How many items need attention in all; `attention` holds the first `limit` of them. */
  attentionTotal?: number;
  /** The attention items not in `attention`, all of them, grouped by reason. Absent when `attention` is complete. */
  attentionNotListed?: { count: number; groups: BatchAttentionGroup[]; more: string };
}

/**
 * A reason with what differs from item to item taken out, so items refused for the same cause
 * group together: element ids, quoted names, and positions.
 */
export function reasonPattern(text: string): string {
  return text
    .replace(/@?\b[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z0-9][a-z0-9-]*\b/g, "<id>")
    .replace(/"[^"\n]*"/g, '"<name>"')
    .replace(/\[\d+\]/g, "[n]")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds a batch's report. `written` names the statuses that mean the item was written as sent
 * ("staged", "added", "updated"): such an item needs attention only when it carries a warning or
 * a note.
 */
export function batchReport<T extends BatchItemResult>(
  results: T[],
  options: { verbose?: boolean; limit?: number; written: readonly string[] }
): BatchReport<T> {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  if (options.verbose) return { total: results.length, counts, results };

  const isWritten = (r: T) => options.written.includes(r.status);
  const notWritten = results.filter((r) => !isWritten(r));
  const writtenFlagged = results.filter((r) => isWritten(r) && ((r.warnings?.length ?? 0) > 0 || (r.notes?.length ?? 0) > 0));
  // What the agent has to act on comes first, so the limit never hides a failure behind a note.
  const flagged = [...notWritten, ...writtenFlagged];
  if (flagged.length === 0) return { total: results.length, counts };

  const limit = options.limit ?? DEFAULT_ATTENTION_LIMIT;

  // The same suggestions on many items (a type's valid predicates, its required attributes) are
  // listed once and pointed at.
  const firstWith = new Map<string, number>();
  const attention = flagged.slice(0, limit).map((item) => {
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

  const report: BatchReport<T> = { total: results.length, counts, attention, attentionTotal: flagged.length };
  const rest = flagged.slice(limit);
  if (rest.length > 0) {
    const groups = new Map<string, BatchAttentionGroup>();
    for (const item of rest) {
      const written = isWritten(item);
      const said = item.reason ?? [...(item.warnings ?? []), ...(item.notes ?? [])].join(" ");
      const reason = reasonPattern(said) || item.status;
      const key = `${item.status}\n${reason}`;
      let group = groups.get(key);
      if (!group) {
        group = { status: item.status, reason, count: 0, indexes: [], ...(written ? { ids: [] } : {}) };
        groups.set(key, group);
      }
      group.count++;
      group.indexes.push(item.index);
      if (written) group.ids!.push(item.id ?? "");
    }
    for (const group of groups.values()) {
      if (group.ids && group.ids.every((id) => id === "")) delete group.ids;
    }
    report.attentionNotListed = {
      count: rest.length,
      groups: [...groups.values()],
      more:
        `${limit} of ${flagged.length} items that need attention are in attention, in full. The other ${rest.length} are all in ` +
        `groups: each by its position in the request (indexes) under its reason, with the ids and names that differ ` +
        `between items replaced. For each one's own message and suggestions, send the call's items that were not ` +
        `written again with limit: ${flagged.length} (nothing is written twice), or pass verbose: true for every item.`,
    };
  }
  return report;
}
