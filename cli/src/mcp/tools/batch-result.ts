/**
 * What a batch write tool returns (model_add, relationship_add, model_update, model_delete and
 * relationship_delete with a list).
 *
 * The write tools answer summary first, by cause (#1295): `total` and `counts`, then `causes`,
 * every item that needs attention grouped by what is wrong, one entry per cause with its true count
 * (one missing target named by 123 relationships is one entry, count 123, not 123 lines). Items are
 * listed under their cause by position, up to `limit` across the causes (every cause gets one
 * before any gets two); the rest are counted (`notListed`), never silently dropped, and sending the
 * batch again with a larger limit lists them, since a re-sent item that is already written comes
 * back unchanged (#1296). See {@link batchCauses}.
 *
 * The older shape below (attention in full, then attentionNotListed) is what codebase_extract's
 * decide and reject lists still return.
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
    `Batch form only. How many of the items that need attention are listed by position under their cause (default ` +
      `${DEFAULT_ATTENTION_LIMIT}), across the causes: one of every cause first. Every cause is returned with its true ` +
      "count either way, and notListed counts the items not listed. Pass a larger number to list more."
  );

/** How a write tool's list answers, for its description. */
export const BATCH_RESULT_DESCRIPTION =
  "A list answers summary first: total and counts by status, then causes, every item that needs attention grouped " +
  "by what is wrong (one missing element named by many items is one cause), each with its true count and its items " +
  `by position (index), up to limit items across the causes (default ${DEFAULT_ATTENTION_LIMIT}); notListed counts ` +
  "the rest. An item already there as sent is unchanged: counted, not listed, so a list can be sent again after a " +
  "partial failure and writes nothing twice. verbose: true returns every item as results.";

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
  /**
   * The reason and suggestions are each item's own text, with nothing replaced: it already held a
   * placeholder's spelling (a reference sent as "<id>"), so it is kept whole to come back exactly.
   */
  literal?: true;
  count: number;
  items: BatchAttentionGroupItem[];
}

/**
 * One cause in a batch result (`causes`): the items that need attention for the same reason. The
 * reason and suggestions are the items' own text, with `<id>`, `"<name>"` and `[n]` where the items
 * differ (each item's `values` say what, in order); what every item shares is written out.
 */
export interface BatchCause {
  status: string;
  reason: string;
  suggestions?: string[];
  /** The text already held a placeholder's spelling, so it is each item's own text, nothing replaced. */
  literal?: true;
  /** How many items have this cause, all of them. */
  count: number;
  /** The items listed, by position in the request, up to the batch's limit. */
  items: BatchAttentionGroupItem[];
  /** How many of `count` are not listed in `items` (the limit). */
  notListed?: number;
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
  /** With byCause: every item that needs attention, grouped by cause, the largest first. */
  causes?: BatchCause[];
  /** With byCause: how many items the causes count but do not list (the limit). */
  notListed?: number;
  /** With byCause, when items are not listed: how to list them. */
  more?: string;
}

const VARYING = /(@?\b[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z0-9][a-z0-9-]*\b)|"([^"\n]*)"|\[(\d+)\]/g;

/**
 * A text split into its pattern and what varies: element ids become `<id>`, quoted names
 * `"<name>"` and positions `[n]`, and `values` holds what each stood for, in order. Items refused
 * for the same cause share a pattern, and a pattern with an item's values is that item's text.
 */
export function reasonParts(text: string): { pattern: string; values: Array<string | number>; literal?: true } {
  // A text that already holds a placeholder's spelling (a reference sent as "<id>") would not come
  // back as it was: such a text is kept whole, and its group says so (`literal`).
  if (/<id>|\[n\]/.test(text)) return { pattern: text, values: [], literal: true };
  const values: Array<string | number> = [];
  const pattern = text.replace(VARYING, (_match, id: string | undefined, name: string | undefined, position: string | undefined) => {
      if (id !== undefined) {
        values.push(id);
        return "<id>";
      }
      if (name !== undefined) {
        values.push(name);
        return '"<name>"';
      }
      // Kept as written when a number would not give it back ("07").
      values.push(String(Number(position)) === position ? Number(position) : position!);
      return "[n]";
    });
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

/** An item's text, split for grouping: its reason (or warnings and notes) and suggestions, with what varies taken out. */
function splitItem(item: BatchItemResult): {
  rawReason: string;
  rawSuggestions: string[];
  reason: string;
  suggestions: string[];
  values: Array<string | number>;
  literal: boolean;
} {
  const rawReason = item.reason ?? [...(item.warnings ?? []), ...(item.notes ?? [])].join(" ");
  const rawSuggestions = item.suggestions ?? [];
  let said = reasonParts(rawReason);
  let hints = rawSuggestions.map(reasonParts);
  // One literal piece makes the whole item literal, so its values never shift.
  const literal = said.literal === true || hints.some((hint) => hint.literal);
  if (literal) {
    said = { pattern: rawReason, values: [] };
    hints = rawSuggestions.map((text) => ({ pattern: text, values: [] }));
  }
  return {
    rawReason,
    rawSuggestions,
    reason: said.pattern || item.status,
    suggestions: hints.map((hint) => hint.pattern),
    values: [...said.values, ...hints.flatMap((hint) => hint.values)],
    literal,
  };
}

/**
 * Groups the items that need attention by cause (#1295). Items with the same status and the same
 * text are one cause, whatever they name: one missing target named by 123 relationships is one
 * cause of 123. Items whose text is their own, alone, are grouped by the text with what differs taken
 * out (`Element <id> has invalid attributes`), each item keeping its values. Causes come in the
 * items' order of need (not written first), the largest first, and list items up to `limit` across
 * them: one item of every cause before a second of any. Every cause is returned, with its true count.
 */
export function batchCauses<T extends BatchItemResult>(
  flagged: T[],
  options: { limit: number; isWritten: (item: T) => boolean }
): { causes: BatchCause[]; notListed: number } {
  type Member = { item: T; parts: ReturnType<typeof splitItem> };
  const exact = new Map<string, Member[]>();
  for (const item of flagged) {
    const parts = splitItem(item);
    const key = [item.status, parts.rawReason, ...parts.rawSuggestions].join("\n");
    exact.set(key, [...(exact.get(key) ?? []), { item, parts }]);
  }

  // A cause many items share word for word is written out whole (`shared`); items whose text is
  // their own are grouped by its pattern (`pattern`).
  type Draft = { members: Member[]; written: boolean; kind: "shared" | "pattern" };
  const drafts: Draft[] = [];
  const byPattern = new Map<string, Draft>();
  for (const members of exact.values()) {
    const written = options.isWritten(members[0].item);
    if (members.length > 1) {
      drafts.push({ members, written, kind: "shared" });
      continue;
    }
    const { item, parts } = members[0];
    const key = [parts.literal ? "literal" : "", item.status, parts.reason, ...parts.suggestions].join("\n");
    const draft = byPattern.get(key);
    if (draft) {
      draft.members.push(members[0]);
    } else {
      const created: Draft = { members: [members[0]], written, kind: "pattern" };
      byPattern.set(key, created);
      drafts.push(created);
    }
  }

  drafts.sort(
    (a, b) =>
      Number(a.written) - Number(b.written) ||
      b.members.length - a.members.length ||
      a.members[0].item.index - b.members[0].item.index
  );

  let budget = Math.max(0, options.limit);
  const listed = drafts.map(() => 0);
  // One of every cause first, then fill in order.
  for (const [i, draft] of drafts.entries()) {
    if (budget === 0) break;
    if (draft.members.length > 0) {
      listed[i] = 1;
      budget--;
    }
  }
  for (const [i, draft] of drafts.entries()) {
    const more = Math.min(budget, draft.members.length - listed[i]);
    listed[i] += more;
    budget -= more;
  }

  let notListed = 0;
  const causes = drafts.map((draft, i): BatchCause => {
    const { members, kind } = draft;
    const first = members[0];
    const item = (m: Member, values: boolean): BatchAttentionGroupItem => ({
      index: m.item.index,
      ...(options.isWritten(m.item) && m.item.id ? { id: m.item.id } : {}),
      ...(values && m.parts.values.length ? { values: m.parts.values } : {}),
    });
    let group: BatchAttentionGroup;
    if (kind === "shared" || members.length === 1) {
      // One text: written out as the items have it.
      group = {
        status: first.item.status,
        reason: first.parts.rawReason || first.item.status,
        ...(first.parts.rawSuggestions.length ? { suggestions: first.parts.rawSuggestions } : {}),
        count: members.length,
        items: members.map((m) => item(m, false)),
      };
    } else {
      // Texts that differ only where they name an id, a name or a position: the pattern, with what
      // every item shares put back, and each item's own values.
      group = {
        status: first.item.status,
        reason: first.parts.reason,
        ...(first.parts.suggestions.length ? { suggestions: first.parts.suggestions } : {}),
        ...(first.parts.literal ? { literal: true as const } : {}),
        count: members.length,
        items: members.map((m) => item(m, true)),
      };
      foldSharedValues(group);
    }
    const items = group.items.slice(0, listed[i]);
    notListed += members.length - items.length;
    return {
      status: group.status,
      reason: group.reason,
      ...(group.suggestions?.length ? { suggestions: group.suggestions } : {}),
      ...(group.literal ? { literal: true as const } : {}),
      count: members.length,
      items,
      ...(members.length > items.length ? { notListed: members.length - items.length } : {}),
    };
  });
  return { causes, notListed };
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
    /**
     * Statuses that need no attention though nothing was written: the item is already as sent
     * ("unchanged", #1296). Counted, never listed.
     */
    settled?: readonly string[];
    /** Answer summary first, by cause (causes), instead of attention and attentionNotListed. */
    byCause?: boolean;
  }
): BatchReport<T> {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  if (options.verbose) return { total: results.length, counts, results };

  const isWritten = (r: T) => options.written.includes(r.status);
  const isSettled = (r: T) => options.settled?.includes(r.status) ?? false;
  const notWritten = results.filter((r) => !isWritten(r) && !isSettled(r));
  const needs = options.writtenNeedsAttention ?? ((r: T) => (r.warnings?.length ?? 0) > 0 || (r.notes?.length ?? 0) > 0);
  const writtenFlagged = results.filter((r) => isWritten(r) && needs(r));
  // What the agent has to act on comes first, so the limit never hides a failure behind a note.
  const flagged = [...notWritten, ...writtenFlagged];
  if (flagged.length === 0) return { total: results.length, counts };

  const limit = options.limit ?? DEFAULT_ATTENTION_LIMIT;
  if (options.byCause) {
    const { causes, notListed } = batchCauses(flagged, { limit, isWritten });
    return {
      total: results.length,
      counts,
      attentionTotal: flagged.length,
      causes,
      ...(notListed > 0
        ? {
            notListed,
            more:
              `${flagged.length - notListed} of ${flagged.length} items that need attention are listed under their cause, ` +
              `by position (index); notListed counts the rest (${notListed}). To list them, send the batch again with ` +
              `limit: ${flagged.length}, or verbose: true for every item: items already written come back unchanged, so ` +
              `nothing is written twice.`,
          }
        : {}),
    };
  }

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
      const rawReason = item.reason ?? [...(item.warnings ?? []), ...(item.notes ?? [])].join(" ");
      const rawSuggestions = item.suggestions ?? [];
      let said = reasonParts(rawReason);
      let hints = rawSuggestions.map(reasonParts);
      // One literal piece makes the whole item literal, so its values never shift.
      const literal = said.literal === true || hints.some((hint) => hint.literal);
      if (literal) {
        said = { pattern: rawReason, values: [] };
        hints = rawSuggestions.map((text) => ({ pattern: text, values: [] }));
      }
      const reason = said.pattern || item.status;
      const suggestions = hints.map((hint) => hint.pattern);
      const key = [literal ? "literal" : "", item.status, reason, ...suggestions].join("\n");
      let group = groups.get(key);
      if (!group) {
        group = {
          status: item.status,
          reason,
          ...(suggestions.length ? { suggestions } : {}),
          ...(literal ? { literal: true as const } : {}),
          count: 0,
          items: [],
        };
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
