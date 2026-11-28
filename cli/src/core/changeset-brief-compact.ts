/**
 * The compact brief — what `changeset_brief` returns by default.
 *
 * The full brief (`buildBrief`) lists every changed element with its attributes, every connection
 * with the other end's name and layer, every unwired connection, and the code each element touches.
 * On a real plan that is 55–420 KB, more than an agent's client takes in one result. The compact
 * brief keeps what a planning pass reads: counts, reach, gaps (one line each), intent (ids), drift,
 * and each changed element with its connections as `predicate → id` lines. A large plan (more than
 * LARGE_PLAN changed elements, a bootstrap) has its elements summarised by type instead, and long id
 * lists summarised, so the default stays well under 30 KB. `sections` returns only the sections it
 * names (a small header besides), each in a compact form. A list too long for the size target
 * (SECTIONS_TARGET_BYTES, the caller's to change) comes a page at a time: `pages` gives each list's
 * true total, how many items the answer holds, and the call that returns the next page. No limit
 * here puts anything out of reach: counts and summaries are over the whole list, and every item is
 * a page away. `detail: "full"` returns the full brief unchanged, or the named sections as it has them.
 *
 * See "Iterating on a plan" in docs/CHANGE_MODELING.md.
 */

import { getAllLayerIds } from "../generated/layer-registry.js";
import { elementFilter, unknownFilterNote } from "./element-filter.js";
import { nextPageCall } from "./paging.js";
import type { BriefDelta } from "./changeset-brief-delta.js";
import { unwiredTotals } from "./changeset-analysis.js";
import type { BriefAcceptedGap, BriefDrift, BriefGap, ChangesetBrief, ElementUnwired } from "./changeset-analysis.js";

/**
 * Sections available through `sections`: each full-brief section, `changes` (the build view of
 * every changed element), and every other top-level block of the compact brief (`summary`,
 * `byLayer`, `reach`, `changesByType`, `neighborFiles`), so a block read in the default brief can be
 * asked for by its name (#1281). Naming sections returns only those, with a small header (revision,
 * the changeset's id, name and status, summary counts).
 */
export const BRIEF_SECTIONS = [
  "summary",
  "byLayer",
  "reach",
  "changes",
  "changesByType",
  "changeset",
  "drift",
  "layers",
  "relationshipChanges",
  "alreadyInBase",
  "gaps",
  "acceptedGaps",
  "unwired",
  "intent",
  "codeTouched",
  "neighborFiles",
  "feedback",
  "delta",
] as const;

export type BriefSection = (typeof BRIEF_SECTIONS)[number];

/** A changed element's description longer than this is cut (the changeset's own never is). */
const ELEMENT_DESCRIPTION_LIMIT = 160;

/** A feedback comment longer than this is cut. */
const FEEDBACK_LIMIT = 200;

/** A plan with more changed elements than this is summarised by type in the default brief. */
export const LARGE_PLAN = 60;

/** Ids listed per type in a large plan's summary. */
const IDS_PER_TYPE = 5;

/** An id list in the default brief (intent, the delta) longer than this is cut, with its count kept. */
export const LIST_LIMIT = 30;

/**
 * The size a `sections` answer aims for by default, in bytes of the JSON the tool returns: under
 * the 25,000 tokens a client takes in one tool result, with room for the ids, which tokenise
 * poorly. A target, not a cut-off: it decides how many items a page holds when the caller names no
 * `limit`, a page always holds at least one item, and the caller can pass another target.
 */
export const SECTIONS_TARGET_BYTES = 40 * 1024;

/**
 * Default for `maxConnections`: connections of one direction, predicate and other layer listed per
 * element in the compact `layers` section. The rest are counted, never dropped.
 */
export const CONNECTIONS_PER_GROUP = 8;

/**
 * A changed element as `sections: ["changes"]` returns it: the build view. What the build needs to
 * write the element (its name, description in full, attributes, the fields an update changes with
 * both values, its files) and its connections as `predicate → id` lines, without the full brief's
 * names and layers per connection.
 */
export interface BuildChange {
  id: string;
  op: "added" | "updated" | "deleted";
  name: string;
  description?: string;
  attributes?: Record<string, unknown>;
  /** Updates: each field that changes, before and after. */
  changedFields?: Array<{ field: string; before: unknown; after: unknown }>;
  sourceFiles?: string[];
  /** Who decided it, in one line (codebase_extract's changes only; see `originLabel`). */
  origin?: string;
  connections: string[];
}

/**
 * Narrows `sections` output to some elements: those with these ids, or those in these layers and of
 * these types (`layers` and `types` narrow together; either alone narrows by itself).
 */
export interface SectionFilter {
  layers?: string[];
  /** Element types, as `applicationservice` or `application.applicationservice`. */
  types?: string[];
  ids?: string[];
  /**
   * The compact `layers` section lists only connections whose other end is in these layers and counts
   * the rest. It narrows connections, not elements (a plan's 40 test cases on one service).
   */
  otherLayers?: string[];
}

/** A large plan's changed elements, per `layer.type`. */
export interface ChangesByType {
  type: string;
  added: number;
  updated: number;
  deleted: number;
  /** The first ids of the type, in brief order. */
  ids: string[];
  /** How many more of the type there are. */
  more?: number;
  /** Changes per decider (`tier0`, `tier1`, `agent`), when codebase_extract staged any of the type. */
  byOrigin?: Record<string, number>;
}

export interface CompactChange {
  id: string;
  // The type is the id's second segment (`layer.type.name`), so it is not repeated.
  op: "added" | "updated" | "deleted";
  /** The element's description, cut at 160 characters. */
  description?: string;
  /**
   * The files its source reference names: where the build edits. A file's name alone when no other
   * touched file has it; `codeTouched` has the path.
   */
  sourceFiles?: string[];
  /** Updates: the fields that change. */
  changedFields?: string[];
  /** Who decided it, in one line (`tier1 clef p=0.82/0.71`): codebase_extract's changes only. */
  origin?: string;
  /**
   * `predicate → id` for a relationship from this element, `predicate ← id` for one into it from an
   * element the changeset does not change, or from a changed element the answer leaves out (a filter
   * or ids that do not keep it). One between two changed elements the answer shows is listed once, on
   * its source. `(deleted)` marks a relationship the change removes, `(base)` one the base already has.
   */
  connections: string[];
}

export interface CompactDrift {
  isDrifted: boolean;
  warnings: string[];
  baseIndex?: string;
  /** `id: reason` for elements, `source --predicate--> target: reason` for relationships. */
  overlapping?: string[];
  baseChanges?: {
    counts: NonNullable<BriefDrift["baseChanges"]>["counts"];
    elementsChanged: string[];
    elementsRemoved: string[];
    truncated: boolean;
  };
}

export interface CompactDelta {
  since: number;
  revision: number;
  elements: { added: string[]; removed: string[]; updated: string[] };
  relationships: { added: string[]; removed: string[] };
  unstaged: string[];
  gaps: { opened: string[]; closed: string[] };
  /** Accepted gaps recorded or reopened since, one line each (see `acceptedGapLine`). */
  acceptedGaps?: { accepted: string[]; reopened: string[] };
  unwired: { wired: number; new: number; newElements: number };
  reach: BriefDelta["reach"];
  intent: BriefDelta["intent"];
  /**
   * The full length of each list the answer does not hold whole. `sections: ["delta"]` with `since`
   * pages them (`limit`, `offset`); `detail: "full"` with it returns them all at once.
   */
  counts?: Record<string, number>;
  warnings?: string[];
}

export interface CompactBrief {
  detail: "compact";
  revision: number;
  revisionToken: string;
  changeset: {
    id: string;
    name: string;
    status: string;
    description?: string;
    drift?: CompactDrift;
  };
  summary: ChangesetBrief["summary"];
  /** Changed elements per layer, in layer order. */
  byLayer: Array<{ layer: string; added: number; updated: number; deleted: number }>;
  reach: ChangesetBrief["reach"];
  /** `element: kind: detail`, one per gap (see `gapLines` for a long list). */
  gaps: string[];
  /**
   * Accepted gaps on the changed elements, one line each: decided against, with the reason, so not
   * open (see `acceptedGapLine`). Absent when there are none.
   */
  acceptedGaps?: string[];
  /** Intent: counts, and the ids of what does not trace (see `compactIntent`). */
  intent: CompactIntent;
  /** Unwired connections of added and updated elements, counted per other-end layer (listed when asked for). */
  unwired?: UnwiredCounts | ChangesetBrief["unwired"];
  /**
   * Every changed element. Left out of a brief with a delta, and of a large plan's (which has
   * `changesByType`); `sections: ["changes"]` lists them.
   */
  changes?: CompactChange[];
  /** A large plan's changed elements, counted per type with the first ids of each. */
  changesByType?: ChangesByType[];
  /** `status source --predicate--> target` for relationships between unchanged elements. */
  relationshipChanges: string[];
  alreadyInBase?: ChangesetBrief["alreadyInBase"];
  /** Files of the changed elements, with how many changed elements each has. */
  codeTouched: string[];
  /** Files that hold only existing elements next to the change: the build must not break them. */
  neighborFiles: string[];
  /** `annotationId on elementId (author, n replies[, staged]): content`. */
  feedback: string[];
  delta?: CompactDelta;
  /** Set when the call had arguments this form doesn't use (e.g. `layers` or `ids` without `sections`). */
  note?: string;
  /** How to get more. */
  more: string;
}

const rel = (r: { source: string; predicate: string; target: string }) => `${r.source} --${r.predicate}--> ${r.target}`;
const gapLine = (g: BriefGap) => `${g.element}: ${g.kind}: ${g.detail}`;

/** `element: accepted: --predicate--> type: reason`, marked when it is staged here or contradicted. */
export function acceptedGapLine(g: Pick<BriefAcceptedGap, "element" | "predicate" | "otherType" | "reason"> & {
  direction: string;
  stagedHere?: true;
  contradictedBy?: BriefAcceptedGap["contradictedBy"];
}): string {
  const triple =
    g.direction === "outgoing" || g.direction === "out"
      ? `--${g.predicate}--> ${g.otherType}`
      : `${g.otherType} --${g.predicate}--> it`;
  const marks = [
    ...(g.stagedHere ? ["staged here"] : []),
    ...(g.contradictedBy ? [`contradicted by ${rel(g.contradictedBy)}`] : []),
  ];
  return `${g.element}: accepted: ${triple}: ${g.reason}${marks.length > 0 ? ` (${marks.join("; ")})` : ""}`;
}

/** The `layer.type` of an element id, or the id when it is not one. */
const typeOfId = (id: string): string => {
  const parts = id.split(".");
  return parts.length >= 3 ? `${parts[0]}.${parts[1]}` : id;
};

/** How many times each key occurs. */
const countBy = (keys: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
};

/** What a group of gaps has in common: the kind and detail, or for a peer pattern the type and the connection. */
function gapGroupKey(g: BriefGap): string {
  if (g.kind !== "peer-pattern" || !g.connection) return `${g.kind}: ${g.detail}`;
  const { direction, predicate, otherType } = g.connection;
  const connection = direction === "out" ? `--${predicate}--> ${otherType}` : `${otherType} --${predicate}--> them`;
  return `peer-pattern: most existing ${typeOfId(g.element)} elements wired like these have ${connection}; these have none`;
}

/**
 * Gaps one line each; past `limit` (default LIST_LIMIT; or always, with `group`), gaps that say the
 * same thing (a bootstrap's unconnected adds, a peer pattern many elements of one type lack) share
 * one line, `kind: detail (n elements: first ids, +m more)`. Every gap is on a line or in a count.
 */
export function gapLines(gaps: BriefGap[], options: { group?: boolean; limit?: number; idsPerType?: number } = {}): string[] {
  const idsPerType = options.idsPerType ?? IDS_PER_TYPE;
  if (!options.group && gaps.length <= (options.limit ?? LIST_LIMIT)) return gaps.map(gapLine);
  const groups = new Map<string, string[]>();
  const single = new Map<string, BriefGap>();
  for (const g of gaps) {
    const key = gapGroupKey(g);
    groups.set(key, [...(groups.get(key) ?? []), g.element]);
    single.set(key, g);
  }
  return [...groups].map(([key, elements]) =>
    elements.length === 1
      ? gapLine(single.get(key)!)
      : `${key} (${elements.length} elements: ${elements.slice(0, idsPerType).join(", ")}` +
        `${elements.length > idsPerType ? `, +${elements.length - idsPerType} more` : ""})`
  );
}
const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/**
 * Unwired connections of added and updated elements. `total` and `byLayer` count the expected links
 * (required or rule-backed) of elements the change touches; `optional` counts the other catalog
 * triples, never listed by default; `preexisting` counts the expected links of updated elements whose
 * type and relationships the change leaves alone, which are not part of `total`.
 */
export interface UnwiredCounts {
  total: number;
  byLayer: Record<string, number>;
  optional: number;
  preexisting: number;
}

export function unwiredCounts(unwired: ElementUnwired[]): UnwiredCounts {
  const counts = new Map<string, number>();
  let total = 0;
  let optional = 0;
  let preexisting = 0;
  for (const element of unwired) {
    for (const { layer, entries } of element.byLayer) {
      const expected = entries.filter((e) => e.expected).length;
      optional += entries.length - expected;
      if (element.preexisting) {
        preexisting += expected;
        continue;
      }
      if (expected > 0) counts.set(layer, (counts.get(layer) ?? 0) + expected);
      total += expected;
    }
  }
  const order = getAllLayerIds();
  const rank = (layer: string) => (order.includes(layer) ? order.indexOf(layer) : order.length);
  const byLayer = Object.fromEntries([...counts].sort(([a], [b]) => rank(a) - rank(b)));
  return { total, byLayer, optional, preexisting };
}

/** How many ids of a list are of one `layer.type`. */
export interface IdsByType {
  type: string;
  count: number;
}

/**
 * The intent section as the compact brief and `sections` return it. What an agent acts on is
 * listed (the untraced and the unanchored); what it does not is counted (the traced, unless asked
 * for). Every count is over all the elements the filter keeps, whatever the lists hold: a list
 * shorter than its count is a page of it, never the whole.
 */
export interface CompactIntent {
  /** How many changed elements each group holds, listed or not. */
  counts: { traced: number; untraced: number; unanchored?: number; noCatalogRoute?: number };
  /**
   * Traced elements. Default brief: the first `limit` ids. Under `sections`: only with
   * `traced: true`, as `element → intent element` lines (`through <whole>` when it traces through
   * the whole that composes it, `anchored by <id>` when the intent element is one the changeset adds).
   */
  traced?: string[];
  /** Untraced ids: the first `limit` in the default brief, a page under `sections`. `counts.untraced` is how many there are. */
  untraced: string[];
  /** When `untraced` is not the whole list: every untraced element counted per `layer.type`, largest first. */
  untracedByType?: IdsByType[];
  /** `element → added intent element` for untraced elements that reach only intent which traces to nothing. */
  unanchored?: string[];
  /** When `unanchored` is not the whole list: how many elements reach each added intent element. */
  unanchoredByIntent?: Record<string, number>;
  /**
   * Elements that do not trace and cannot be linked to intent themselves, counted apart from
   * `untraced`: per type, with their ids (a page of them, like `untraced`).
   */
  noCatalogRoute?: { byType: Record<string, number>; ids: string[]; note: string };
  /**
   * The two numbers that bound the trace. `blockedByHub` is how many of the elements above do reach
   * intent within `maxHops` once hubs are walked through: not traced under the rule, and traced
   * with a larger `hubThreshold`.
   */
  walk: { maxHops: number; hubThreshold: number; blockedByHub?: number; note?: string };
  /** Why nothing was traced (every changed element is an intent element or a deletion). */
  note?: string;
  /** Default brief: set when a list holds fewer than its count, with the call that pages them all. */
  more?: string;
}

const NO_CATALOG_ROUTE_NOTE =
  "The catalog gives these types no relationship to a motivation, business or product type, so they trace only " +
  "through a neighbour: the element that composes, uses or realizes them. They are not counted as untraced.";

/** Ids counted per `layer.type`, largest type first. */
function idsByType(ids: string[]): IdsByType[] {
  return Object.entries(countBy(ids.map(typeOfId)))
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => ({ type, count }));
}

/** `element → intent element`, with how it got there. */
const tracedLine = (t: ChangesetBrief["intent"]["traced"][number]) =>
  `${t.element} → ${t.tracesTo}` + (t.through ? ` (through ${t.through})` : "") + (t.anchoredBy ? ` (anchored by ${t.anchoredBy.id})` : "");

/**
 * The compact form of the brief's intent. Counts always, over the whole of `intent`.
 *
 * - Default brief (no `page`): each list holds its first `listLimit` entries (default LIST_LIMIT).
 *   A longer untraced list is also counted per type, and `more` says which lists are not whole and
 *   names the call that pages them.
 * - Under `sections` (`page`): the untraced ids, the unanchored and the `noCatalogRoute` ids are
 *   each the same page (`limit` entries from `offset`); the traced are listed, as lines, only with
 *   `page.traced`. A list that is a page has its whole counted beside it (per type, per intent element).
 */
export function compactIntent(
  intent: ChangesetBrief["intent"],
  options: {
    listLimit?: number;
    tracedAs?: "ids" | "lines";
    page?: { offset: number; limit: number; traced?: boolean };
  } = {}
): CompactIntent {
  const page = options.page;
  const listLimit = options.listLimit ?? LIST_LIMIT;
  const cutOf = <T>(list: T[]): T[] => (page ? list.slice(page.offset, page.offset + page.limit) : list.slice(0, listLimit));
  const unanchored = intent.unanchored ?? [];
  const noRoute = intent.noCatalogRoute ?? [];
  const byType: Record<string, number> = {};
  for (const id of noRoute) byType[typeOfId(id)] = (byType[typeOfId(id)] ?? 0) + 1;
  const byIntent: Record<string, number> = {};
  for (const u of unanchored) byIntent[u.tracesTo] = (byIntent[u.tracesTo] ?? 0) + 1;

  const untraced = cutOf(intent.untraced);
  const unanchoredShown = cutOf(unanchored);
  const noRouteShown = cutOf(noRoute);
  const tracedShown = page ? (page.traced ? cutOf(intent.traced) : undefined) : cutOf(intent.traced);
  const lines = page ? true : options.tracedAs === "lines";
  const blocked = intent.walk.blockedByHub.length;

  // Default brief: say which lists are not whole. Under sections the answer's `page` and `more` do.
  const short: string[] = [];
  if (!page) {
    const part = (shown: number, total: number, what: string) => {
      if (shown < total) short.push(`${shown} of ${total} ${what}`);
    };
    part(untraced.length, intent.untraced.length, "untraced");
    part(unanchoredShown.length, unanchored.length, "unanchored");
    part(noRouteShown.length, noRoute.length, "noCatalogRoute");
    part(tracedShown?.length ?? 0, intent.traced.length, "traced");
  }

  return {
    counts: {
      traced: intent.traced.length,
      untraced: intent.untraced.length,
      ...(unanchored.length > 0 ? { unanchored: unanchored.length } : {}),
      ...(noRoute.length > 0 ? { noCatalogRoute: noRoute.length } : {}),
    },
    ...(tracedShown && intent.traced.length > 0 ? { traced: lines ? tracedShown.map(tracedLine) : tracedShown.map((t) => t.element) } : {}),
    untraced,
    // The ids are in `untraced` (its first entries, or a page): beside it, every one counted per type.
    ...(untraced.length < intent.untraced.length ? { untracedByType: idsByType(intent.untraced) } : {}),
    ...(unanchored.length > 0 ? { unanchored: unanchoredShown.map((u) => `${u.element} → ${u.tracesTo}`) } : {}),
    ...(unanchoredShown.length < unanchored.length ? { unanchoredByIntent: byIntent } : {}),
    ...(noRoute.length > 0 ? { noCatalogRoute: { byType, ids: noRouteShown, note: NO_CATALOG_ROUTE_NOTE } } : {}),
    walk: {
      maxHops: intent.walk.maxHops,
      hubThreshold: intent.walk.hubThreshold,
      ...(blocked > 0
        ? {
            blockedByHub: blocked,
            note:
              `The trace walks ${intent.walk.maxHops} hops and does not go through an element with more than ` +
              `${intent.walk.hubThreshold} relationships. ${blocked} of the elements that do not trace would, within ` +
              "the same hops and by a route the trace allows, if it did: a larger hubThreshold traces them.",
          }
        : {}),
    },
    ...(intent.note ? { note: intent.note } : {}),
    ...(short.length > 0
      ? {
          more:
            `Lists hold their first ${listLimit}: ${short.join(", ")}. counts has every total. ` +
            'changeset_brief with sections: ["intent"] pages every id (traced: true adds the traced), or pass a larger limit here.',
        }
      : {}),
  };
}

function compactDrift(drift: BriefDrift): CompactDrift {
  const overlapping = drift.overlapping
    ? [
        ...drift.overlapping.elements.map((e) => `${e.id}: ${e.reason}`),
        ...drift.overlapping.relationships.map((r) => `${rel(r)}: ${r.reason}${r.endpoints ? ` (${r.endpoints.join(", ")})` : ""}`),
      ]
    : undefined;
  return {
    isDrifted: drift.isDrifted,
    warnings: drift.warnings,
    ...(drift.baseIndex ? { baseIndex: drift.baseIndex } : {}),
    ...(overlapping ? { overlapping } : {}),
    ...(drift.baseChanges
      ? {
          baseChanges: {
            counts: drift.baseChanges.counts,
            elementsChanged: drift.baseChanges.elementsChanged,
            elementsRemoved: drift.baseChanges.elementsRemoved,
            truncated: drift.baseChanges.truncated,
          },
        }
      : {}),
  };
}

/**
 * What the compact drift leaves out: it counts every base change but lists only the elements changed
 * and removed (cut where describeDrift cut them). Undefined when it lists everything there is.
 */
export function driftListsNote(drift: BriefDrift): string | undefined {
  const base = drift.baseChanges;
  if (!base) return undefined;
  const unlisted = base.counts.elementsAdded + base.counts.relationshipsAdded + base.counts.relationshipsRemoved;
  if (unlisted === 0 && !base.truncated) return undefined;
  return (
    "The drift counts every base change (baseChanges.counts) and lists only some of them here: " +
    'changeset_brief with sections: ["drift"] lists them all, a page at a time.'
  );
}

/** The delta's lists that page, by the name `page.totals` and `delta.counts` give them. */
export function deltaLists(delta: BriefDelta): Record<string, unknown[]> {
  return {
    "elements.added": delta.elements.added,
    "elements.removed": delta.elements.removed,
    "elements.updated": delta.elements.updated,
    "relationships.added": delta.relationships.added,
    "relationships.removed": delta.relationships.removed,
    "acceptedGaps.accepted": delta.acceptedGaps.accepted,
    "acceptedGaps.reopened": delta.acceptedGaps.reopened,
    "intent.newlyTraced": delta.intent.newlyTraced,
    "intent.newlyUntraced": delta.intent.newlyUntraced,
    // What was unstaged since: up to MAX_UNSTAGED_TOMBSTONES, paged like the rest (an unstage's recovery call reads it).
    unstaged: delta.unstaged,
  };
}

/**
 * The delta with each of its lists (see `deltaLists`) a page: `limit` entries (default LIST_LIMIT)
 * from `offset`, the same for every list. `counts` has the full length of every list the page does
 * not hold whole, so nothing reads as complete when it is not.
 */
export function compactDelta(delta: BriefDelta, options: { limit?: number; offset?: number } = {}): CompactDelta {
  const limit = options.limit ?? LIST_LIMIT;
  const offset = options.offset ?? 0;
  const counts: Record<string, number> = {};
  const capped = <T>(list: T[], name: string): T[] => {
    const page = list.slice(offset, offset + limit);
    if (page.length < list.length) counts[name] = list.length;
    return page;
  };
  const out: CompactDelta = {
    since: delta.since,
    revision: delta.revision,
    elements: {
      added: capped(delta.elements.added, "elements.added"),
      removed: capped(delta.elements.removed, "elements.removed"),
      updated: capped(delta.elements.updated, "elements.updated").map((u) => `${u.element} (${u.fields.join(", ")})`),
    },
    relationships: {
      added: capped(delta.relationships.added, "relationships.added").map(rel),
      removed: capped(delta.relationships.removed, "relationships.removed").map(rel),
    },
    unstaged: capped(delta.unstaged, "unstaged").map(
      (u) =>
        `#${u.sequence} ${u.operation} ${u.source ? rel({ source: u.source, predicate: u.predicate ?? "?", target: u.target ?? "?" }) : (u.elementId ?? "")} (unstaged at ${u.removedAt})`
    ),
    gaps: { opened: gapLines(delta.gaps.opened), closed: gapLines(delta.gaps.closed) },
    ...(delta.acceptedGaps.accepted.length + delta.acceptedGaps.reopened.length > 0
      ? {
          acceptedGaps: {
            accepted: capped(delta.acceptedGaps.accepted, "acceptedGaps.accepted").map(acceptedGapLine),
            reopened: capped(delta.acceptedGaps.reopened, "acceptedGaps.reopened").map(acceptedGapLine),
          },
        }
      : {}),
    unwired: { wired: delta.unwired.wired.length, new: delta.unwired.new.length, newElements: delta.unwired.newElements.length },
    reach: delta.reach,
    intent: {
      newlyTraced: capped(delta.intent.newlyTraced, "intent.newlyTraced"),
      newlyUntraced: capped(delta.intent.newlyUntraced, "intent.newlyUntraced"),
    },
    ...(delta.warnings ? { warnings: delta.warnings } : {}),
  };
  if (Object.keys(counts).length > 0) out.counts = counts;
  return out;
}

/**
 * Each changed element in the compact form, and the touched files (changed ones counted, neighbour-only
 * ones apart). `shown` says which changed elements the answer shows: a relationship into an element
 * from a changed one is listed on its source only when the answer shows that source, and on the
 * element itself otherwise (#1258), so no staged relationship is out of sight.
 */
function compactChanges(
  brief: ChangesetBrief,
  shown: (id: string) => boolean = () => true
): {
  changes: CompactChange[];
  build: BuildChange[];
  files: Map<string, number>;
  neighborFiles: string[];
} {
  const changedIds = new Set(brief.layers.flatMap((l) => l.changes.map((c) => c.id)));

  // Files: per changed element, and those holding only neighbours.
  const filesOf = new Map<string, string[]>();
  const files = new Map<string, number>();
  const neighborFiles: string[] = [];
  // Per element, a file's name stands for its path when no other touched file has that name.
  const baseName = (file: string) => file.slice(file.lastIndexOf("/") + 1);
  const nameCount = new Map<string, number>();
  for (const { file } of brief.codeTouched) nameCount.set(baseName(file), (nameCount.get(baseName(file)) ?? 0) + 1);
  const shortName = (file: string) => (nameCount.get(baseName(file)) === 1 ? baseName(file) : file);
  for (const { file, elements } of brief.codeTouched) {
    const changed = elements.filter((e) => e.role === "changed");
    if (changed.length === 0) neighborFiles.push(file);
    else files.set(file, changed.length);
    for (const e of changed) filesOf.set(e.id, [...(filesOf.get(e.id) ?? []), shortName(file)]);
  }

  const changes: CompactChange[] = [];
  const build: BuildChange[] = [];
  for (const c of brief.layers.flatMap((l) => l.changes)) {
    const connections: string[] = [];
    for (const n of c.connections) {
      if (n.direction === "in" && changedIds.has(n.other) && shown(n.other)) continue; // listed on its source
      const mark = n.status === "deleted" ? " (deleted)" : n.status === "unchanged" ? " (base)" : "";
      connections.push(n.direction === "out" ? `${n.predicate} → ${n.other}${mark}` : `${n.predicate} ← ${n.other}${mark}`);
    }
    const sourceFiles = filesOf.has(c.id) ? { sourceFiles: filesOf.get(c.id) } : {};
    changes.push({
      id: c.id,
      op: c.op,
      ...(c.description ? { description: cut(c.description, ELEMENT_DESCRIPTION_LIMIT) } : {}),
      ...sourceFiles,
      ...(c.changedFields?.length ? { changedFields: c.changedFields.map((f) => f.field) } : {}),
      ...(c.origin ? { origin: c.origin } : {}),
      connections,
    });
    build.push({
      id: c.id,
      op: c.op,
      name: c.name,
      ...(c.description ? { description: c.description } : {}),
      ...(c.attributes && Object.keys(c.attributes).length > 0 ? { attributes: c.attributes } : {}),
      ...(c.changedFields?.length ? { changedFields: c.changedFields } : {}),
      ...sourceFiles,
      ...(c.origin ? { origin: c.origin } : {}),
      connections,
    });
  }
  return { changes, build, files, neighborFiles };
}

/** A large plan's changed elements per `layer.type`, in brief order, with the first ids of each. */
export function changesByType(brief: ChangesetBrief, idsPerType = IDS_PER_TYPE): ChangesByType[] {
  const groups = new Map<string, ChangesByType>();
  for (const layer of brief.layers) {
    for (const c of layer.changes) {
      const parts = c.id.split(".");
      const type = parts.length >= 3 ? `${parts[0]}.${parts[1]}` : layer.layer;
      const group = groups.get(type) ?? { type, added: 0, updated: 0, deleted: 0, ids: [] };
      group[c.op] += 1;
      if (group.ids.length < idsPerType) group.ids.push(c.id);
      else group.more = (group.more ?? 0) + 1;
      if (c.origin) {
        const by = c.origin.split(" ")[0];
        group.byOrigin = { ...group.byOrigin, [by]: (group.byOrigin?.[by] ?? 0) + 1 };
      }
      groups.set(type, group);
    }
  }
  return [...groups.values()];
}

function headerOf(brief: ChangesetBrief): { id: string; name: string; status: string } {
  return { id: brief.changeset.id, name: brief.changeset.name, status: brief.changeset.status };
}

/**
 * The compact form of a full brief. `unwired` is the per-element list, counted per layer (pass it
 * when the brief was built without its unwired listing). `briefSections` returns named sections only.
 */
export function compactBrief(
  brief: ChangesetBrief,
  options: {
    unwired?: ElementUnwired[];
    delta?: BriefDelta;
    /** Entries per id list (intent, the delta) and gaps listed before they are grouped (default LIST_LIMIT). */
    limit?: number;
    /** Ids shown per type in the summaries: changesByType and grouped gaps (default 5). */
    idsPerType?: number;
  } = {}
): CompactBrief {
  const limit = options.limit ?? LIST_LIMIT;
  const idsPerType = options.idsPerType ?? IDS_PER_TYPE;
  const { changes, files, neighborFiles } = compactChanges(brief);
  const changedCount = changes.length;
  const large = changedCount > LARGE_PLAN;

  // The description in full: decisions are recorded there (accepted gaps have their own section).
  const description = brief.changeset.description;
  const header: CompactBrief["changeset"] = { ...headerOf(brief), ...(description ? { description } : {}) };
  if (brief.changeset.drift) header.drift = compactDrift(brief.changeset.drift);

  // Intent: counts, and the first ids of each list (the untraced also per type when there are many: a bootstrap).
  const intent = compactIntent(brief.intent, { listLimit: limit });
  const deltaCut = options.delta ? Object.values(deltaLists(options.delta)).some((list) => list.length > limit) : false;

  const withDelta = !!options.delta;
  const elementList = withDelta ? {} : large ? { changesByType: changesByType(brief, idsPerType) } : { changes };
  const sectionNames = `sections: [...] for only some sections (${BRIEF_SECTIONS.join(", ")}; add detail: "full" for them in full)`;
  const more =
    (withDelta
      ? 'With since, the changed elements are left out: the delta says what changed (sections: ["changes"] lists them). ' +
        (deltaCut
          ? `The delta's lists hold their first ${limit} entries (delta.counts has the full lengths); ` +
            'sections: ["delta"] with since and offset pages them. '
          : "")
      : large
        ? `This plan changes ${changedCount} elements, so changesByType counts them per type with the first ${idsPerType} ids ` +
          'of each; sections: ["changes"] lists every one with its connections, a page at a time (page has the totals and nextOffset). '
        : "Each changed element is listed with a short description, its files and its connections; attributes are in the full brief. ") +
    (brief.gaps.length > limit ? 'Gaps that say the same thing share a line, every gap counted (sections: ["gaps"] lists each, a page at a time). ' : "") +
    (intent.more ? "intent.more says which intent lists are not whole. " : "") +
    (brief.changeset.drift && driftListsNote(brief.changeset.drift) ? `${driftListsNote(brief.changeset.drift)} ` : "") +
    `Pass ${sectionNames}, or detail: "full" for the whole brief.`;

  const out: CompactBrief = {
    detail: "compact",
    revision: brief.revision,
    revisionToken: brief.revisionToken,
    changeset: header,
    summary: brief.summary,
    byLayer: brief.layers.map((l) => ({
      layer: l.layer,
      added: l.changes.filter((c) => c.op === "added").length,
      updated: l.changes.filter((c) => c.op === "updated").length,
      deleted: l.changes.filter((c) => c.op === "deleted").length,
    })),
    reach: brief.reach,
    gaps: gapLines(brief.gaps, { limit, idsPerType }),
    ...(brief.acceptedGaps.length > 0 ? { acceptedGaps: brief.acceptedGaps.map(acceptedGapLine) } : {}),
    intent,
    ...(brief.unwired && !options.unwired
      ? { unwired: brief.unwired }
      : options.unwired
        ? { unwired: unwiredCounts(options.unwired) }
        : {}),
    ...elementList,
    relationshipChanges: brief.relationshipChanges.map((r) => `${r.status} ${rel(r)}`),
    codeTouched: [...files].map(([file, n]) => `${file} (${n})`),
    neighborFiles,
    feedback: brief.feedback.map(feedbackLine),
    more,
  };
  if (brief.alreadyInBase.elements.length + brief.alreadyInBase.relationships.length > 0) {
    // Short, and commit skips them: listed whenever there are any.
    out.alreadyInBase = brief.alreadyInBase;
  }
  if (options.delta) out.delta = compactDelta(options.delta, { limit });
  return out;
}

const feedbackLine = (f: ChangesetBrief["feedback"][number]) =>
  `${f.annotationId} on ${f.elementId} (${f.author}, ${f.replies} ${f.replies === 1 ? "reply" : "replies"}${f.staged ? ", staged in this changeset: lands with it" : ""}): ${cut(f.content, FEEDBACK_LIMIT)}`;


// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * A changed element in the compact `layers` section: what the full brief's `layers` has for it,
 * with its connections summarised. A connection the changeset adds or deletes is a line
 * (`predicate → id`, `predicate ← id`, marked `(deleted)`), up to `maxConnections` per direction,
 * predicate and other layer, and only when its other end is in `otherLayers` (when that is given).
 * Every other connection is counted, so the lines and the counts together are all of them.
 */
export interface CompactLayerChange {
  op: "added" | "updated" | "deleted";
  id: string;
  type: string;
  name: string;
  description?: string;
  attributes?: Record<string, unknown>;
  changedFields?: Array<{ field: string; before: unknown; after: unknown }>;
  origin?: string;
  connections: string[];
  /** Connections not listed, per `predicate → layer` (or `←`), marked `(base)` or `(deleted)`. */
  connectionCounts?: Record<string, number>;
}

/** A touched file in the compact `codeTouched` section. */
export interface CompactCodeFile {
  file: string;
  /** The changed elements in it (the ones the filter keeps). */
  changed: string[];
  /** How many existing elements next to the change it holds. */
  neighbors?: number;
}

/** Unwired connections per element type: the summary of an unwired listing that comes a page at a time. */
export interface UnwiredByType {
  /** `layer.type (n elements)` for the types with nothing unwired in the layers shown. */
  nothingUnwired?: string[];
  byType: Array<{
    type: string;
    /** Changed elements of the type (that the filter keeps). */
    elements: number;
    byLayer: Array<{
      layer: string;
      /** The most unwired connections one element of the type has in this layer. */
      count: number;
      /** `out predicate otherType (n existing, m added): k elements` for each connection listed. */
      entries?: string[];
      typesNotInModel?: number;
    }>;
  }>;
}

/**
 * Where a `sections` answer sits in its lists. One `offset` and one page size apply to every list
 * in the answer, so repeating the call with `nextOffset` pages them all together, each item once.
 * The names follow the paging convention the MCP tools share (several lists paged together).
 */
export interface SectionsPage {
  /** Where the page starts, in every list. */
  offset: number;
  /**
   * Each list's true length, by name: a section's name, the intent section's lists as
   * `intent.untraced`, `intent.unanchored`, `intent.noCatalogRoute` (and `intent.traced` when
   * asked for), the delta's as `delta.<list>`.
   */
  totals: Record<string, number>;
  /** How many items of each list this answer holds. Below its total: the list is a page, not the whole. */
  returned: Record<string, number>;
  /** Where the next page starts, for every list. Absent when no list has more. */
  nextOffset?: number;
  /** For each section the answer holds only part of: counts over the whole of it. */
  summaries?: Record<string, Record<string, unknown>>;
}

/** A brief of named sections only: a small header, then each section. */
export interface SectionsBrief {
  /** `compact`: each section in its compact form, long lists a page at a time. `full`: as the full brief has it. */
  detail: "compact" | "full";
  revision: number;
  revisionToken: string;
  /**
   * The changeset's id, name and status; its description and drift with the `changeset` section (the
   * drift only when the `drift` section is not asked for: it is named once, #1373).
   */
  changeset: { id: string; name: string; status: string; description?: string; drift?: BriefDrift | CompactDrift };
  summary: ChangesetBrief["summary"];
  /** With `summary` or `byLayer`: changed elements per layer, in layer order (the filter's, when one is given). */
  byLayer?: CompactBrief["byLayer"];
  reach?: ChangesetBrief["reach"];
  changesByType?: ChangesByType[];
  /** Files that hold only existing elements next to the change. */
  neighborFiles?: string[];
  /**
   * Elements `ids` names that the changeset does not change, each as a card (its connections as
   * the plan leaves them), so the elements a plan links to read in the same call (#1395).
   */
  unchanged?: unknown[];
  /** The sections returned, in the order asked. */
  sections: BriefSection[];
  /** The filter applied to the element sections, when one was given. */
  filter?: SectionFilter;
  /** The build view of each changed element (see BuildChange). */
  changes?: BuildChange[];
  drift?: BriefDrift;
  layers?: ChangesetBrief["layers"] | Array<{ layer: string; changes: CompactLayerChange[] }>;
  relationshipChanges?: ChangesetBrief["relationshipChanges"];
  alreadyInBase?: ChangesetBrief["alreadyInBase"];
  /** One line per gap; the gaps themselves, with examples, in full. */
  gaps?: string[] | BriefGap[];
  acceptedGaps?: BriefAcceptedGap[];
  unwired?: ChangesetBrief["unwired"];
  intent?: CompactIntent | ChangesetBrief["intent"];
  codeTouched?: CompactCodeFile[] | ChangesetBrief["codeTouched"];
  feedback?: ChangesetBrief["feedback"];
  /** With since: the compact delta, or in full the whole one when `delta` is named. */
  delta?: CompactDelta | BriefDelta;
  /**
   * Compact only, whenever the answer has a list: each list's total and how many items the answer
   * holds, and `nextOffset` when any list has more.
   */
  page?: SectionsPage;
  more: string;
}

export interface SectionsOptions {
  delta?: BriefDelta;
  filter?: SectionFilter;
  /** Each section as the full brief has it, whatever its size (`detail: "full"`). */
  full?: boolean;
  /** Skip this many items of every list in the answer. */
  offset?: number;
  /**
   * Items per list. When absent, the page holds as many as keep the answer near `targetBytes`
   * (every list whole, when they fit). When given, it is the page size whatever the bytes.
   */
  limit?: number;
  /** The size the answer aims for when `limit` is absent (default SECTIONS_TARGET_BYTES). A target: a page holds at least one item. */
  targetBytes?: number;
  /** Connections listed per direction, predicate and other layer in the compact `layers` section (default CONNECTIONS_PER_GROUP). */
  maxConnections?: number;
  /** The intent section also lists the traced elements, each with what it traces to, paged like the others (default: counted). */
  traced?: boolean;
  /**
   * The drift's base-change lists are whole (the caller set no driftLimit or driftOffset): the
   * `drift` section pages them with the answer's other lists.
   */
  driftWhole?: boolean;
  /** Bytes of a value as the caller serialises it (default: indented JSON, the largest it can be). */
  measure?: (value: unknown) => number;
  /** The caller's other arguments (changeset, filters, since), repeated in the next call `more` names. */
  callArgs?: Record<string, unknown>;
  /**
   * Cards for the ids the filter names that the changeset does not change: `cards` for those the
   * projected model has, `missing` for those it does not. Without it they are only named.
   */
  cardsFor?: (ids: string[]) => { cards: unknown[]; missing: string[] };
}

/** One list of a compact answer: its name in `page.totals`, how long it is, and its section's summary of the whole. */
interface PagedList {
  key: string;
  section: BriefSection;
  total: number;
  summary?: () => Record<string, unknown>;
}

function compactLayerChange(
  c: ChangesetBrief["layers"][number]["changes"][number],
  maxConnections: number,
  otherLayers?: Set<string>
): CompactLayerChange {
  const connections: string[] = [];
  const counts: Record<string, number> = {};
  const listed = new Map<string, number>();
  for (const n of c.connections) {
    const arrow = n.direction === "out" ? "→" : "←";
    const layer = n.otherLayer ?? n.other.split(".")[0];
    const mark = n.status === "deleted" ? " (deleted)" : n.status === "unchanged" ? " (base)" : "";
    const group = `${n.predicate} ${arrow} ${layer}${mark}`;
    const inFilter = !otherLayers || otherLayers.has(layer);
    const seen = listed.get(group) ?? 0;
    if (n.status !== "unchanged" && inFilter && seen < maxConnections) {
      connections.push(`${n.predicate} ${arrow} ${n.other}${mark}`);
      listed.set(group, seen + 1);
    } else {
      counts[group] = (counts[group] ?? 0) + 1;
    }
  }
  return {
    op: c.op,
    id: c.id,
    type: c.type,
    name: c.name,
    ...(c.description ? { description: c.description } : {}),
    ...(c.attributes && Object.keys(c.attributes).length > 0 ? { attributes: c.attributes } : {}),
    ...(c.changedFields?.length ? { changedFields: c.changedFields } : {}),
    ...(c.origin ? { origin: c.origin } : {}),
    connections,
    ...(Object.keys(counts).length > 0 ? { connectionCounts: counts } : {}),
  };
}

/**
 * Unwired connections of many elements, per element type: each connection with how many elements
 * lack it. With `entries: false`, only the per-layer counts (for a summary that must stay small).
 */
function unwiredByType(elements: NonNullable<ChangesetBrief["unwired"]>["elements"], entries = true): UnwiredByType {
  type Group = {
    elements: number;
    layers: Map<string, { count: number; typesNotInModel: number; entries?: Map<string, { line: string; elements: number }> }>;
  };
  const groups = new Map<string, Group>();
  for (const element of elements) {
    const group: Group = groups.get(element.type) ?? { elements: 0, layers: new Map() };
    group.elements += 1;
    for (const l of element.byLayer) {
      // Optional triples (full mode lists them) are not expected links: the summary leaves them out.
      if (l.count === 0) continue;
      const layer = group.layers.get(l.layer) ?? { count: 0, typesNotInModel: 0 };
      layer.count = Math.max(layer.count, l.count);
      layer.typesNotInModel = Math.max(layer.typesNotInModel, l.typesNotInModel ?? 0);
      if (l.entries && entries) {
        layer.entries ??= new Map();
        for (const e of l.entries.filter((x) => x.expected)) {
          const key = `${e.direction} ${e.predicate} ${e.otherType}`;
          const entry = layer.entries.get(key) ?? { line: `${key} (${e.existingCount} existing, ${e.addedCount} added)`, elements: 0 };
          entry.elements += 1;
          layer.entries.set(key, entry);
        }
      }
      group.layers.set(l.layer, layer);
    }
    groups.set(element.type, group);
  }
  const order = getAllLayerIds();
  const rank = (layer: string) => (order.includes(layer) ? order.indexOf(layer) : order.length);
  const sorted = [...groups].sort(([, a], [, b]) => b.elements - a.elements);
  const none = sorted.filter(([, group]) => group.layers.size === 0);
  const plural = (n: number) => `${n} ${n === 1 ? "element" : "elements"}`;
  return {
    ...(none.length > 0 ? { nothingUnwired: none.map(([type, group]) => `${type} (${plural(group.elements)})`) } : {}),
    byType: sorted
      .filter(([, group]) => group.layers.size > 0)
      .map(([type, group]) => ({
        type,
        elements: group.elements,
        byLayer: [...group.layers]
          .sort(([a], [b]) => rank(a) - rank(b))
          .map(([layer, l]) => ({
            layer,
            count: l.count,
            ...(l.entries ? { entries: [...l.entries.values()].map((e) => `${e.line}: ${plural(e.elements)}`) } : {}),
            ...(l.typesNotInModel > 0 ? { typesNotInModel: l.typesNotInModel } : {}),
          })),
      })),
  };
}

/**
 * Only the named sections, under a small header. `changes` is the build view of every changed
 * element; with `since`, the delta comes too. `filter` narrows the element sections (changes,
 * layers, gaps, acceptedGaps, unwired, intent, codeTouched, feedback) to the elements in some layers
 * or with some ids.
 *
 * Each section comes in a compact form, and every list in the answer is the same page: `limit`
 * items from `offset`. `page` has each list's true total and how many items the answer holds, and
 * `nextOffset` while any list has more, so the same call with that offset continues them all and
 * the pages together are every item, once. Without `limit`, the page is as long as keeps the answer
 * near `targetBytes` (and at least one item); a section the answer holds only part of also gets a
 * summary counted over all of it. With `full`, each section is as the full brief has it, whatever
 * its size.
 */
export function briefSections(brief: ChangesetBrief, sections: readonly BriefSection[], options: SectionsOptions = {}): SectionsBrief {
  const names = [...new Set(sections)];
  const given = options.filter;
  const filter = given && (given.layers?.length || given.types?.length || given.ids?.length) ? given : undefined;
  const ids = filter?.ids?.length ? new Set(filter.ids) : undefined;
  // Layers and types narrow together; ids keep an element by themselves.
  const byKind = filter && (filter.layers?.length || filter.types?.length)
    ? elementFilter({ layers: filter.layers, types: filter.types })
    : undefined;
  const keep = (id: string): boolean => {
    if (!filter) return true;
    return (ids?.has(id) ?? false) || (byKind?.keeps(id) ?? false);
  };
  const full = !!options.full;
  const out: SectionsBrief = {
    detail: full ? "full" : "compact",
    revision: brief.revision,
    revisionToken: brief.revisionToken,
    changeset: headerOf(brief),
    summary: brief.summary,
    sections: names,
    ...(filter
      ? {
          filter: {
            ...(filter.layers?.length ? { layers: filter.layers } : {}),
            ...(filter.types?.length ? { types: filter.types } : {}),
            ...(filter.ids?.length ? { ids: filter.ids } : {}),
          },
        }
      : {}),
    more: "",
  };
  const notes: string[] = [];
  /** Parts of the answer that are cut outside the paged lists (each named in a note): the answer is then never "whole". */
  const cutApart: string[] = [];
  // A layer or type that is not one keeps nothing: say so, or an empty answer reads as "no changes there".
  const unknownNote = unknownFilterNote(
    elementFilter({ layers: [...(given?.layers ?? []), ...(given?.otherLayers ?? [])], types: given?.types })
  );
  if (unknownNote) notes.push(unknownNote);
  const intent: ChangesetBrief["intent"] = filter
    ? {
        traced: brief.intent.traced.filter((t) => keep(t.element)),
        untraced: brief.intent.untraced.filter(keep),
        ...(brief.intent.unanchored ? { unanchored: brief.intent.unanchored.filter((u) => keep(u.element)) } : {}),
        ...(brief.intent.noCatalogRoute ? { noCatalogRoute: brief.intent.noCatalogRoute.filter(keep) } : {}),
        ...(brief.intent.note ? { note: brief.intent.note } : {}),
        walk: { ...brief.intent.walk, blockedByHub: brief.intent.walk.blockedByHub.filter(keep) },
      }
    : brief.intent;
  const unwired =
    brief.unwired && filter
      ? (() => {
          const kept = brief.unwired.elements.filter((e) => keep(e.element));
          return { ...brief.unwired, totals: unwiredTotals(kept), elements: kept };
        })()
      : brief.unwired;
  const offset = Math.max(0, options.offset ?? 0);
  const maxConnections = options.maxConnections ?? CONNECTIONS_PER_GROUP;
  const values = out as unknown as Record<string, unknown>;
  const lists: PagedList[] = [];
  /** Each sets its section's value to the page of `n` items from the offset. */
  const renderers: Array<(n: number) => void> = [];
  /** A list section: its items, how a page of them makes the section's value, and its summary of the whole. */
  const list = <T>(name: BriefSection, all: T[], wrap: (page: T[]) => unknown, summary?: () => Record<string, unknown>) => {
    lists.push({ key: name, section: name, total: all.length, ...(summary ? { summary } : {}) });
    renderers.push((n) => {
      values[name] = wrap(all.slice(offset, offset + n));
    });
  };

  for (const name of names) {
    switch (name) {
      case "changeset": {
        const description = brief.changeset.description;
        // The drift is named once: in the drift section when that is asked for, here otherwise (#1373).
        const drift = names.includes("drift") ? undefined : brief.changeset.drift;
        out.changeset = {
          ...out.changeset,
          ...(description ? { description } : {}),
          ...(drift ? { drift: full ? drift : compactDrift(drift) } : {}),
        };
        const dropped = drift && !full ? driftListsNote(drift) : undefined;
        if (dropped) {
          notes.push(dropped);
          cutApart.push("changeset.drift");
        }
        break;
      }
      case "drift": {
        const drift = brief.changeset.drift;
        if (!drift) {
          notes.push("No drift: the changeset is not staged.");
          break;
        }
        out.drift = drift;
        const driftPage = (drift.baseChanges as { page?: { nextOffset?: number } } | undefined)?.page;
        const baseChanges = drift.baseChanges;
        if (!full && options.driftWhole && baseChanges) {
          // The base-change lists came whole: they page with the answer's other lists, under the same
          // limit, offset and size target, and page.totals has each one's length (#1373).
          const { page: _page, truncated: _truncated, ...rest } = baseChanges as typeof baseChanges & { page?: unknown };
          const driftLists = {
            elementsAdded: baseChanges.elementsAdded,
            elementsRemoved: baseChanges.elementsRemoved,
            elementsChanged: baseChanges.elementsChanged,
            relationshipsAdded: baseChanges.relationshipsAdded,
            relationshipsRemoved: baseChanges.relationshipsRemoved,
          };
          for (const [key, all] of Object.entries(driftLists)) lists.push({ key: `drift.${key}`, section: name, total: all.length });
          renderers.push((n) => {
            const cutTo = <T>(all: T[]): T[] => all.slice(offset, offset + n);
            out.drift = {
              ...drift,
              baseChanges: {
                ...rest,
                elementsAdded: cutTo(driftLists.elementsAdded),
                elementsRemoved: cutTo(driftLists.elementsRemoved),
                elementsChanged: cutTo(driftLists.elementsChanged),
                relationshipsAdded: cutTo(driftLists.relationshipsAdded),
                relationshipsRemoved: cutTo(driftLists.relationshipsRemoved),
              } as typeof baseChanges,
            };
          });
          break;
        }
        // The drift's base-change lists page with driftLimit and driftOffset, apart from the answer's other lists.
        if (driftPage?.nextOffset !== undefined) {
          notes.push(
            "The drift's base-change lists are a page (drift.baseChanges.page; baseChanges.counts has the true totals). " +
              `Next: changeset_brief ${JSON.stringify({ ...options.callArgs, sections: names, driftOffset: driftPage.nextOffset })}.`
          );
        } else if (!driftPage && drift.baseChanges?.truncated) {
          notes.push(
            "The drift's base-change lists are cut where they are built (baseChanges.truncated): baseChanges.counts has " +
              "the true totals. driftLimit and driftOffset page them once the drift paging change (PR 1272) is on main."
          );
        }
        break;
      }
      case "delta":
        if (!options.delta) notes.push("delta needs since: pass the revisionToken of an earlier brief.");
        break;
      case "summary":
      case "byLayer":
        // The summary counts are in every answer's header; byLayer counts the elements the filter keeps.
        out.byLayer = brief.layers
          .map((l) => {
            const kept = l.changes.filter((c) => keep(c.id));
            const count = (op: string) => kept.filter((c) => c.op === op).length;
            return { layer: l.layer, added: count("added"), updated: count("updated"), deleted: count("deleted") };
          })
          .filter((l) => l.added + l.updated + l.deleted > 0);
        break;
      case "reach":
        out.reach = brief.reach;
        break;
      case "changesByType": {
        const kept = { ...brief, layers: brief.layers.map((l) => ({ ...l, changes: l.changes.filter((c) => keep(c.id)) })) };
        out.changesByType = changesByType(kept, full ? Number.MAX_SAFE_INTEGER : IDS_PER_TYPE);
        // Each type lists its first ids and counts the rest: say where every id of a type is listed.
        const cut = out.changesByType.filter((g) => g.more);
        if (cut.length > 0) {
          notes.push(
            `changesByType lists the first ${IDS_PER_TYPE} ids of each type and counts the rest in more ` +
              `(${cut.map((g) => `${g.type}: ${g.more} more`).join(", ")}). Every one is listed by ` +
              `changeset_brief ${JSON.stringify({ ...options.callArgs, sections: ["changes"], types: [cut[0].type] })}, ` +
              "one type at a time, a page at a time."
          );
          cutApart.push("changesByType");
        }
        break;
      }
      case "neighborFiles": {
        const files = compactChanges(brief).neighborFiles;
        if (full) out.neighborFiles = files;
        else list(name, files, (page) => page);
        break;
      }
      case "changes": {
        const all = compactChanges(brief, keep).build.filter((c) => keep(c.id));
        if (full) out.changes = all;
        else list(name, all, (page) => page, () => ({ byType: countBy(all.map((c) => typeOfId(c.id))) }));
        break;
      }
      case "layers": {
        if (full) {
          out.layers = filter
            ? brief.layers.map((l) => ({ ...l, changes: l.changes.filter((c) => keep(c.id)) })).filter((l) => l.changes.length > 0)
            : brief.layers;
          break;
        }
        const otherLayers = options.filter?.otherLayers?.length ? new Set(options.filter.otherLayers) : undefined;
        const all = brief.layers.flatMap((l) => l.changes.filter((c) => keep(c.id)).map((c) => ({ layer: l.layer, change: c })));
        list(
          name,
          all,
          (page) => {
            const grouped: Array<{ layer: string; changes: CompactLayerChange[] }> = [];
            for (const { layer, change } of page) {
              if (grouped[grouped.length - 1]?.layer !== layer) grouped.push({ layer, changes: [] });
              grouped[grouped.length - 1].changes.push(compactLayerChange(change, maxConnections, otherLayers));
            }
            return grouped;
          },
          () => ({ byType: countBy(all.map((a) => typeOfId(a.change.id))) })
        );
        break;
      }
      case "relationshipChanges":
        if (full) out.relationshipChanges = brief.relationshipChanges;
        else list(name, brief.relationshipChanges, (page) => page);
        break;
      case "alreadyInBase": {
        if (full) {
          out.alreadyInBase = brief.alreadyInBase;
          break;
        }
        type Entry = { element: string } | { relationship: ChangesetBrief["alreadyInBase"]["relationships"][number] };
        const entries: Entry[] = [
          ...brief.alreadyInBase.elements.map((element) => ({ element })),
          ...brief.alreadyInBase.relationships.map((relationship) => ({ relationship })),
        ];
        list(
          name,
          entries,
          (page) => ({
            elements: page.flatMap((e) => ("element" in e ? [e.element] : [])),
            relationships: page.flatMap((e) => ("relationship" in e ? [e.relationship] : [])),
          }),
          () => ({ elements: brief.alreadyInBase.elements.length, relationships: brief.alreadyInBase.relationships.length })
        );
        break;
      }
      case "gaps": {
        const kept = brief.gaps.filter((g) => keep(g.element));
        if (full) out.gaps = kept;
        else {
          list(name, kept.map(gapLine), (page) => page, () => ({
            byKind: countBy(kept.map((g) => g.kind)),
            byType: countBy(kept.map((g) => typeOfId(g.element))),
          }));
        }
        break;
      }
      case "acceptedGaps": {
        const kept = brief.acceptedGaps.filter((g) => keep(g.element));
        if (full) out.acceptedGaps = kept;
        else list(name, kept, (page) => page);
        break;
      }
      case "unwired": {
        if (!unwired) break;
        if (full) {
          out.unwired = unwired;
          break;
        }
        const { elements, ...head } = unwired;
        // The summary: each connection with how many elements lack it; per-layer counts alone when that would be long.
        list(name, elements, (page) => ({ ...head, elements: page }), () => {
          const withEntries = unwiredByType(elements);
          const measure = options.measure ?? ((value: unknown) => Buffer.byteLength(JSON.stringify(value, null, 2) ?? ""));
          const room = (options.targetBytes ?? SECTIONS_TARGET_BYTES) / 4;
          return { ...(measure(withEntries) <= room ? withEntries : unwiredByType(elements, false)) };
        });
        break;
      }
      case "intent": {
        if (full) {
          out.intent = intent;
          break;
        }
        // Three lists, or four with the traced: each the same page; the counts beside them are of all.
        const part = (key: string, total: number) => lists.push({ key: `intent.${key}`, section: name, total });
        part("untraced", intent.untraced.length);
        if (intent.unanchored?.length) part("unanchored", intent.unanchored.length);
        if (intent.noCatalogRoute?.length) part("noCatalogRoute", intent.noCatalogRoute.length);
        if (options.traced) part("traced", intent.traced.length);
        renderers.push((n) => {
          out.intent = compactIntent(intent, { page: { offset, limit: n, traced: options.traced } });
        });
        break;
      }
      case "codeTouched": {
        if (full) {
          out.codeTouched = brief.codeTouched;
          break;
        }
        const files: CompactCodeFile[] = [];
        for (const { file, elements } of brief.codeTouched) {
          const changed = elements.filter((e) => e.role === "changed" && keep(e.id)).map((e) => e.id);
          const neighbors = elements.filter((e) => e.role === "neighbor").length;
          // With a filter, only the files of the elements it keeps.
          if (filter && changed.length === 0) continue;
          files.push({ file, changed, ...(neighbors > 0 ? { neighbors } : {}) });
        }
        list(name, files, (page) => page, () => ({
          changedElements: files.reduce((sum, f) => sum + f.changed.length, 0),
          neighborOnlyFiles: files.filter((f) => f.changed.length === 0).length,
        }));
        break;
      }
      case "feedback": {
        const kept = brief.feedback.filter((f) => keep(f.elementId));
        if (full) out.feedback = kept;
        else list(name, kept, (page) => page);
        break;
      }
    }
  }
  if (filter && ids) {
    const known = new Set(brief.layers.flatMap((l) => l.changes.map((c) => c.id)));
    const unknown = [...ids].filter((id) => !known.has(id));
    if (unknown.length > 0 && options.cardsFor) {
      // What the plan links to but does not change, read in the same call (#1395): a list of this
      // answer like the others, paged with them.
      const { cards, missing } = options.cardsFor(unknown);
      if (cards.length > 0) {
        notes.push(`Not changed by this changeset, so in unchanged as the plan leaves them: ${cards.length} of the ids.`);
        if (full) out.unchanged = cards;
        else {
          lists.push({ key: "unchanged", section: "changes", total: cards.length });
          renderers.push((n) => {
            out.unchanged = cards.slice(offset, offset + n);
          });
        }
      }
      if (missing.length > 0) notes.push(`Not in the model or the plan: ${missing.join(", ")}.`);
    } else if (unknown.length > 0) {
      notes.push(`Not changed by this changeset: ${unknown.join(", ")}.`);
    }
  }
  const which = `(${names.join(", ")})${filter ? ", for the elements the filter keeps" : ""}`;
  if (full) {
    if (options.delta) out.delta = names.includes("delta") ? options.delta : compactDelta(options.delta);
    out.more = [...notes, `The sections asked for ${which}, in full. Call without sections for the compact brief.`].join(" ");
    return out;
  }

  // The delta's lists are lists of this answer when the delta is named; otherwise it comes from its start.
  const delta = options.delta;
  if (delta && names.includes("delta")) {
    for (const [key, all] of Object.entries(deltaLists(delta))) lists.push({ key: `delta.${key}`, section: "delta", total: all.length });
    renderers.push((n) => {
      out.delta = compactDelta(delta, { limit: n, offset });
    });
  } else if (delta) {
    out.delta = compactDelta(delta);
    if (Object.keys(out.delta.counts ?? {}).length > 0) {
      notes.push("The delta's lists hold their first entries (delta.counts has the full lengths): name delta in sections to page them.");
    }
  }

  const measure = options.measure ?? ((value: unknown) => Buffer.byteLength(JSON.stringify(value, null, 2) ?? ""));
  const target = options.targetBytes ?? SECTIONS_TARGET_BYTES;
  const longest = Math.max(0, ...lists.map((l) => l.total - offset));
  /** The answer with every list a page of `n` items from the offset. */
  const render = (n: number) => {
    for (const renderer of renderers) renderer(n);
    if (lists.length > 0) {
      const returned = (l: PagedList) => Math.max(0, Math.min(n, l.total - offset));
      const more = lists.some((l) => l.total > offset + n);
      const partial = [...new Set(lists.filter((l) => returned(l) < l.total && l.summary).map((l) => l))];
      out.page = {
        offset,
        totals: Object.fromEntries(lists.map((l) => [l.key, l.total])),
        returned: Object.fromEntries(lists.map((l) => [l.key, returned(l)])),
        ...(more ? { nextOffset: offset + n } : {}),
        ...(partial.length > 0 ? { summaries: Object.fromEntries(partial.map((l) => [l.key, l.summary!()])) } : {}),
      };
    }
    const page = out.page;
    const short = page ? lists.filter((l) => page.returned[l.key] < l.total) : [];
    const past = offset > 0 && lists.length > 0 && longest === 0;
    out.more = [
      ...notes,
      ...(past ? [`offset ${offset} is past the end of every list here (page.totals has their lengths).`] : []),
      `Only the sections asked for are returned ${which}, each in its compact form.` +
        (!page
          ? ""
          : short.length === 0
            ? cutApart.length === 0
              ? " Every list is whole (page.totals)."
              : ` The paged lists are whole (page.totals); ${cutApart.join(" and ")} ${cutApart.length === 1 ? "is" : "are"} not, as said above.`
            : page.nextOffset === undefined
              ? ` This is the last page (from ${offset}); page.totals has each list's length, and counts and summaries are over the whole lists.`
              : ` Not everything is here: ${short.map((l) => `${l.key} holds ${page.returned[l.key]} of ${l.total}`).join("; ")}` +
                `${offset > 0 ? ` (from ${offset})` : ""}; counts and summaries are over the whole lists.` +
                ` Next page: ${nextPageCall("changeset_brief", { ...options.callArgs, sections: names }, page.nextOffset)}.` +
                (options.limit === undefined
                  ? ` The page is sized to keep the answer near ${Math.round(target / 1024)} KB: pass targetBytes for larger or ` +
                    "smaller pages, limit for at most that many items, or narrow with layers, types or ids."
                  : "")) +
        ` Add detail: "full" for these sections in full at once, or call without sections for the compact brief.`,
    ].join(" ");
    return out;
  };

  // The page size: the longest page, up to the caller's limit, that keeps the answer near the target
  // (at least one item). A limit is the most a page holds, not a size that overrides the target (#1334).
  const cap = options.limit === undefined ? longest : Math.min(options.limit, Math.max(longest, 0));
  let size = options.limit ?? longest;
  const limitNote = (held: number) =>
    `limit ${options.limit} would take this answer past the ${Math.round(target / 1024)} KB target, so the page ` +
    `holds ${held}: pass a larger targetBytes for a larger page, or narrow with layers, types or ids.`;
  // With a limit, the note that may say the page holds fewer is measured with the page, so the
  // answer that carries it still fits the target. Its count only shrinks, so its length does too.
  const noteAt = notes.length;
  if (options.limit !== undefined) notes.push(limitNote(cap));
  if (cap > 0 && measure(render(cap)) > target) {
    let low = 1;
    let high = cap;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (measure(render(middle)) <= target) low = middle;
      else high = middle - 1;
    }
    size = low;
    if (options.limit !== undefined) notes[noteAt] = limitNote(size);
  } else if (options.limit !== undefined) {
    notes.splice(noteAt, 1);
  }
  return render(Math.max(0, size));
}
