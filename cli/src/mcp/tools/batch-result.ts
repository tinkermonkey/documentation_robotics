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
 *   and suggestions with the ids, names and positions that differ between items taken out, and
 *   listed with its position in the request and those values in order. Nothing the full item says
 *   is lost: putting an item's `values` back into the group's `reason` and `suggestions` gives the
 *   item's own text. A higher `limit` or `verbose: true` returns items whole.
 * - `verbose: true` returns every item as `results`.
 *
 * What a write did without being asked in so many words is not a problem to look at: a
 * relationship end given by name and read as an id is reported once, in `readByName`
 * (relationship-tools.ts), not as an attention item per relationship.
 */

import { z } from "zod";

/**
 * The line width batch results are written at (jsonResult's compact form): wide enough that an
 * attention item or a group's item is one line, which is about a tenth off a large result.
 */
export const BATCH_RESULT_LINE_WIDTH = 400;

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

/** One item of a {@link BatchAttentionGroup}. */
export interface BatchAttentionGroupItem {
  /** Position in the request, from 0. */
  index: number;
  /** The item's element id, when it was written. */
  id?: string;
  /** What each `<id>`, `"<name>"` and `[n]` of the group's reason and suggestions stands for in this item, in order. */
  values?: Array<string | number>;
}

/** Attention items past the limit that share a status, a reason and suggestions. Together the groups hold every such item. */
export interface BatchAttentionGroup {
  status: string;
  /** The items' reason, warning or note, with the ids, names and positions that differ between items replaced. */
  reason: string;
  /** The items' suggestions, with the same replacements. */
  suggestions?: string[];
  count: number;
  items: BatchAttentionGroupItem[];
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

const VARYING = /(@?\b[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z0-9][a-z0-9-]*\b)|"([^"\n]*)"|\[(\d+)\]/g;

/**
 * A text split into its pattern and what varies: element ids become `<id>`, quoted names
 * `"<name>"` and positions `[n]`, and `values` holds what each stood for, in order. Items refused
 * for the same cause share a pattern, and a pattern with an item's values is that item's text.
 */
export function reasonParts(text: string): { pattern: string; values: Array<string | number> } {
  const values: Array<string | number> = [];
  const pattern = text
    .replace(VARYING, (_match, id: string | undefined, name: string | undefined, position: string | undefined) => {
      if (id !== undefined) {
        values.push(id);
        return "<id>";
      }
      if (name !== undefined) {
        values.push(name);
        return '"<name>"';
      }
      values.push(Number(position));
      return "[n]";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { pattern, values };
}

/** {@link reasonParts}' pattern alone. */
export function reasonPattern(text: string): string {
  return reasonParts(text).pattern;
}

/**
 * Puts back into a group's text the values every one of its items shares (a tool name in a
 * suggestion, the one target all the items name), so an item lists only what is its own.
 */
function foldSharedValues(group: BatchAttentionGroup): void {
  const first = group.items[0]?.values ?? [];
  const shared = first.map((value, j) => group.items.every((item) => item.values?.[j] === value));
  if (!shared.some(Boolean)) return;
  let position = 0;
  const fold = (text: string) =>
    text.replace(/<id>|"<name>"|\[n\]/g, (token) => {
      const j = position++;
      if (!shared[j]) return token;
      return token === "<id>" ? String(first[j]) : token === "[n]" ? `[${first[j]}]` : `"${first[j]}"`;
    });
  group.reason = fold(group.reason);
  if (group.suggestions) group.suggestions = group.suggestions.map(fold);
  for (const item of group.items) {
    const own = (item.values ?? []).filter((_, j) => !shared[j]);
    if (own.length > 0) item.values = own;
    else delete item.values;
  }
}

/**
 * Builds a batch's report. `written` names the statuses that mean the item was written as sent
 * ("staged", "added", "updated"): such an item needs attention only when it carries a warning or
 * a note.
 */
export function batchReport<T extends BatchItemResult>(
  results: T[],
  options: {
    verbose?: boolean;
    limit?: number;
    written: readonly string[];
    /** Whether a written item needs attention. Default: it carries a warning or a note. */
    writtenNeedsAttention?: (item: T) => boolean;
  }
): BatchReport<T> {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  if (options.verbose) return { total: results.length, counts, results };

  const isWritten = (r: T) => options.written.includes(r.status);
  const notWritten = results.filter((r) => !isWritten(r));
  const needs = options.writtenNeedsAttention ?? ((r: T) => (r.warnings?.length ?? 0) > 0 || (r.notes?.length ?? 0) > 0);
  const writtenFlagged = results.filter((r) => isWritten(r) && needs(r));
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
      const said = reasonParts(item.reason ?? [...(item.warnings ?? []), ...(item.notes ?? [])].join(" "));
      const hints = (item.suggestions ?? []).map(reasonParts);
      const reason = said.pattern || item.status;
      const suggestions = hints.map((hint) => hint.pattern);
      const key = [item.status, reason, ...suggestions].join("\n");
      let group = groups.get(key);
      if (!group) {
        group = { status: item.status, reason, ...(suggestions.length ? { suggestions } : {}), count: 0, items: [] };
        groups.set(key, group);
      }
      const values = [...said.values, ...hints.flatMap((hint) => hint.values)];
      group.count++;
      group.items.push({
        index: item.index,
        ...(isWritten(item) && item.id ? { id: item.id } : {}),
        ...(values.length ? { values } : {}),
      });
    }
    for (const group of groups.values()) foldSharedValues(group);
    report.attentionNotListed = {
      count: rest.length,
      groups: [...groups.values()],
      more:
        `${limit} of ${flagged.length} items that need attention are in attention, in full. The other ${rest.length} are all in ` +
        `groups, each under its reason and suggestions by its position in the request (index). A group's text has ` +
        `<id>, "<name>" or [n] where its items differ; an item's values are what those stand for, in order. ` +
        `To get items whole, pass limit: ${flagged.length} (sending items that were not written again writes nothing ` +
        `twice) or verbose: true.`,
    };
  }
  return report;
}
