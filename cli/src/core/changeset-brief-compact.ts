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
import type { BriefDelta } from "./changeset-brief-delta.js";
import type { BriefAcceptedGap, BriefDrift, BriefGap, ChangesetBrief, ElementUnwired } from "./changeset-analysis.js";

/**
 * Sections available through `sections`: each full-brief section, and `changes`, the build view of
 * every changed element. Naming sections returns only those, with a small header (revision, the
 * changeset's id, name and status, summary counts).
 */
export const BRIEF_SECTIONS = [
  "changes",
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

/** Narrows `sections` output to some elements: those in these layers, or with these ids. */
export interface SectionFilter {
  layers?: string[];
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
   * element the changeset does not change (one between two changed elements is listed once, on its
   * source). `(deleted)` marks a relationship the change removes, `(base)` one the base already has.
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
  unwired?: { total: number; byLayer: Record<string, number> } | ChangesetBrief["unwired"];
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
  /** `annotationId on elementId (author, n replies): content`. */
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

/** What a group of gaps has in common: the kind and detail, or for a peer pattern the type and the connection. */
function gapGroupKey(g: BriefGap): string {
  if (g.kind !== "peer-pattern" || !g.connection) return `${g.kind}: ${g.detail}`;
  const { direction, predicate, otherType } = g.connection;
  const connection = direction === "out" ? `--${predicate}--> ${otherType}` : `${otherType} --${predicate}--> them`;
  return `peer-pattern: most existing ${typeOfId(g.element)} elements wired like these have ${connection}; these have none`;
}

/**
 * Gaps one line each; past LIST_LIMIT (or always, with `group`), gaps that say the same thing (a
 * bootstrap's unconnected adds, a peer pattern many elements of one type lack) share one line,
 * `kind: detail (n elements: first ids, +m more)`.
 */
export function gapLines(gaps: BriefGap[], options: { group?: boolean } = {}): string[] {
  if (!options.group && gaps.length <= LIST_LIMIT) return gaps.map(gapLine);
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
      : `${key} (${elements.length} elements: ${elements.slice(0, IDS_PER_TYPE).join(", ")}` +
        `${elements.length > IDS_PER_TYPE ? `, +${elements.length - IDS_PER_TYPE} more` : ""})`
  );
}
const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/** Unwired connections counted per other-end layer, across every added or updated element. */
export function unwiredCounts(unwired: ElementUnwired[]): { total: number; byLayer: Record<string, number> } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const element of unwired) {
    for (const { layer, entries } of element.byLayer) {
      counts.set(layer, (counts.get(layer) ?? 0) + entries.length);
      total += entries.length;
    }
  }
  const order = getAllLayerIds();
  const rank = (layer: string) => (order.includes(layer) ? order.indexOf(layer) : order.length);
  const byLayer = Object.fromEntries([...counts].sort(([a], [b]) => rank(a) - rank(b)));
  return { total, byLayer };
}

/** Ids of one `layer.type`: how many, and (where the ids are not listed beside it) the first of them. */
export interface IdsByType {
  type: string;
  count: number;
  /** The first ids of the type, in brief order. Absent when the ids come as a page beside it. */
  ids?: string[];
  /** How many more of the type there are than `ids` lists. */
  more?: number;
}

/**
 * The intent section as the compact brief and `sections` return it. What an agent acts on is
 * listed (the untraced and the unanchored); what it does not is counted (the traced, past a few).
 * Every count is over all the elements the filter keeps, whatever the lists hold.
 */
export interface CompactIntent {
  /** How many changed elements each group holds, listed or not. */
  counts: { traced: number; untraced: number; unanchored?: number; noCatalogRoute?: number };
  /**
   * The traced elements, when there are at most `listLimit`: ids in the default brief, and
   * `element → intent element` lines under `sections` (`through <whole>` when it traces through the
   * whole that composes it, `anchored by <id>` when the intent element is one the changeset adds).
   */
  traced?: string[];
  /**
   * Untraced ids: all of them, or under `sections` a page of them (`pages.intent` has the total and
   * the call for the next page). Absent from the default brief when the list is long.
   */
  untraced?: string[];
  /** When `untraced` is not the whole list: every untraced element counted per `layer.type`, largest first. */
  untracedByType?: IdsByType[];
  /** `element → added intent element` for untraced elements that reach only intent which traces to nothing. */
  unanchored?: string[];
  /** When there are more unanchored elements than `listLimit`: how many reach each added intent element. */
  unanchoredByIntent?: Record<string, number>;
  /**
   * Elements that do not trace and cannot be linked to intent themselves, counted apart from
   * `untraced`: per type, with the ids when there are at most `listLimit`.
   */
  noCatalogRoute?: { byType: Record<string, number>; ids?: string[]; note: string };
  /** Why nothing was traced (every changed element is an intent element or a deletion). */
  note?: string;
}

const NO_CATALOG_ROUTE_NOTE =
  "The catalog gives these types no relationship to a motivation, business or product type, so they trace only " +
  "through a neighbour: the element that composes, uses or realizes them. They are not counted as untraced.";

/** Ids per `layer.type`, largest type first, with the first `idsPerType` ids of each (0: counts only). */
function idsByType(ids: string[], idsPerType: number): IdsByType[] {
  const groups = new Map<string, string[]>();
  for (const id of ids) groups.set(typeOfId(id), [...(groups.get(typeOfId(id)) ?? []), id]);
  return [...groups]
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([type, all]) => ({
      type,
      count: all.length,
      ...(idsPerType > 0 ? { ids: all.slice(0, idsPerType) } : {}),
      ...(idsPerType > 0 && all.length > idsPerType ? { more: all.length - idsPerType } : {}),
    }));
}

/**
 * The compact form of the brief's intent. Counts always, over the whole of `intent`.
 *
 * - Untraced: with `untracedPage` (what `sections` passes), that page of ids, and every untraced
 *   element counted per type when the page is not the whole list. Without it, the ids when there
 *   are at most `listLimit`, else per type with the first `idsPerType` ids of each.
 * - Traced, unanchored and `noCatalogRoute` ids: listed when there are at most `listLimit` of each
 *   (default LIST_LIMIT); past it they are counted (the unanchored per added intent element, the
 *   others per type). `listLimit` is the caller's `limit`, so a larger one lists them.
 */
export function compactIntent(
  intent: ChangesetBrief["intent"],
  options: { listLimit?: number; idsPerType?: number; tracedAs?: "ids" | "lines"; untracedPage?: string[] } = {}
): CompactIntent {
  const listLimit = options.listLimit ?? LIST_LIMIT;
  const idsPerType = options.idsPerType ?? IDS_PER_TYPE;
  const unanchored = intent.unanchored ?? [];
  const noRoute = intent.noCatalogRoute ?? [];
  const tracedLine = (t: ChangesetBrief["intent"]["traced"][number]) =>
    `${t.element} → ${t.tracesTo}` +
    (t.through ? ` (through ${t.through})` : "") +
    (t.anchoredBy ? ` (anchored by ${t.anchoredBy.id})` : "");
  const byType: Record<string, number> = {};
  for (const id of noRoute) byType[typeOfId(id)] = (byType[typeOfId(id)] ?? 0) + 1;
  const byIntent: Record<string, number> = {};
  for (const u of unanchored) byIntent[u.tracesTo] = (byIntent[u.tracesTo] ?? 0) + 1;
  const page = options.untracedPage;
  const untraced: Pick<CompactIntent, "untraced" | "untracedByType"> = page
    ? { untraced: page, ...(page.length < intent.untraced.length ? { untracedByType: idsByType(intent.untraced, 0) } : {}) }
    : intent.untraced.length <= listLimit
      ? { untraced: intent.untraced }
      : { untracedByType: idsByType(intent.untraced, idsPerType) };
  return {
    counts: {
      traced: intent.traced.length,
      untraced: intent.untraced.length,
      ...(unanchored.length > 0 ? { unanchored: unanchored.length } : {}),
      ...(noRoute.length > 0 ? { noCatalogRoute: noRoute.length } : {}),
    },
    ...(intent.traced.length > 0 && intent.traced.length <= listLimit
      ? { traced: options.tracedAs === "lines" ? intent.traced.map(tracedLine) : intent.traced.map((t) => t.element) }
      : {}),
    ...untraced,
    ...(unanchored.length === 0
      ? {}
      : unanchored.length <= listLimit
        ? { unanchored: unanchored.map((u) => `${u.element} → ${u.tracesTo}`) }
        : { unanchoredByIntent: byIntent }),
    ...(noRoute.length > 0
      ? { noCatalogRoute: { byType, ...(noRoute.length <= listLimit ? { ids: noRoute } : {}), note: NO_CATALOG_ROUTE_NOTE } }
      : {}),
    ...(intent.note ? { note: intent.note } : {}),
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

/** How a delta's lists were paged: what there is in all, what the answer holds, and where the next page starts. */
export interface DeltaPage {
  /** Entries across the delta's lists (elements, relationships, accepted gaps, intent). */
  total: number;
  returned: number;
  /** Set when a list has entries past this page. */
  nextOffset?: number;
}

/**
 * The delta with each list a page: `limit` entries (default LIST_LIMIT) from `offset`, the same for
 * every list. `counts` has the full length of every list the page does not hold whole, so nothing
 * reads as complete when it is not; `page`, when passed, is filled with the totals.
 */
export function compactDelta(delta: BriefDelta, options: { limit?: number; offset?: number; page?: DeltaPage } = {}): CompactDelta {
  const limit = options.limit ?? LIST_LIMIT;
  const offset = options.offset ?? 0;
  const counts: Record<string, number> = {};
  let total = 0;
  let returned = 0;
  let more = false;
  const capped = <T>(list: T[], name: string): T[] => {
    const page = list.slice(offset, offset + limit);
    total += list.length;
    returned += page.length;
    if (page.length < list.length) counts[name] = list.length;
    if (offset + page.length < list.length) more = true;
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
    unstaged: delta.unstaged.map(
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
  if (options.page) {
    options.page.total = total;
    options.page.returned = returned;
    if (more) options.page.nextOffset = offset + limit;
  }
  return out;
}

/** Whether any of a delta's paged lists is longer than a default page. */
function compactDeltaIsCut(delta: BriefDelta): boolean {
  const page: DeltaPage = { total: 0, returned: 0 };
  compactDelta(delta, { page });
  return page.returned < page.total;
}

/** Each changed element in the compact form, and the touched files (changed ones counted, neighbour-only ones apart). */
function compactChanges(brief: ChangesetBrief): {
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
      if (n.direction === "in" && changedIds.has(n.other)) continue; // listed on its source
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
export function compactBrief(brief: ChangesetBrief, options: { unwired?: ElementUnwired[]; delta?: BriefDelta } = {}): CompactBrief {
  const { changes, files, neighborFiles } = compactChanges(brief);
  const changedCount = changes.length;
  const large = changedCount > LARGE_PLAN;

  // The description in full: decisions are recorded there (accepted gaps have their own section).
  const description = brief.changeset.description;
  const header: CompactBrief["changeset"] = { ...headerOf(brief), ...(description ? { description } : {}) };
  if (brief.changeset.drift) header.drift = compactDrift(brief.changeset.drift);

  // Intent: counts, the untraced ids (per type when there are many: a bootstrap), the traced when few.
  const intent = compactIntent(brief.intent);
  const intentCut = !!intent.untracedByType || (brief.intent.traced.length > 0 && !intent.traced);

  const withDelta = !!options.delta;
  const elementList = withDelta ? {} : large ? { changesByType: changesByType(brief) } : { changes };
  const sectionNames = `sections: [...] for only some sections (${BRIEF_SECTIONS.join(", ")}; add detail: "full" for them in full)`;
  const more =
    (withDelta
      ? 'With since, the changed elements are left out: the delta says what changed (sections: ["changes"] lists them). ' +
        (options.delta && compactDeltaIsCut(options.delta)
          ? `The delta's lists hold the first ${LIST_LIMIT} entries each (delta.counts has the full lengths); ` +
            'sections: ["delta"] with since and offset pages them. '
          : "")
      : large
        ? `This plan changes ${changedCount} elements, so changesByType counts them per type with the first ${IDS_PER_TYPE} ids ` +
          'of each; sections: ["changes"] lists every one with its connections, a page at a time (pages.changes has the total and the next call). '
        : "Each changed element is listed with a short description, its files and its connections; attributes are in the full brief. ") +
    (brief.gaps.length > LIST_LIMIT ? 'Gaps that say the same thing share a line, every gap counted (sections: ["gaps"] lists each, a page at a time). ' : "") +
    (intentCut
      ? `Intent lists longer than ${LIST_LIMIT} are counted (intent.counts), the untraced per type with the first ids; ` +
        'sections: ["intent"] lists every untraced id, a page at a time. '
      : "") +
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
    gaps: gapLines(brief.gaps),
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
  if (options.delta) out.delta = compactDelta(options.delta);
  return out;
}

const feedbackLine = (f: ChangesetBrief["feedback"][number]) =>
  `${f.annotationId} on ${f.elementId} (${f.author}, ${f.replies} ${f.replies === 1 ? "reply" : "replies"}): ${cut(f.content, FEEDBACK_LIMIT)}`;


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
 * How much of one section's list a `sections` answer holds. Present for every list section named,
 * whole or not, so an agent never has to guess whether it has everything.
 */
export interface SectionPage {
  /** The items the filter keeps: the true count, whatever the answer holds. */
  total: number;
  /** The items in this answer. */
  returned: number;
  /** What an item is: elements, gaps, untraced elements, files, entries. */
  unit: string;
  /** Where this page starts, when not at the first item. */
  offset?: number;
  /** Where the next page starts. Absent when nothing is left. */
  nextOffset?: number;
  /** The call that returns the next page, with its arguments. Absent when nothing is left. */
  next?: string;
  /** When the answer does not hold the whole list: counts over the whole of it. */
  summary?: Record<string, unknown>;
}

/** A brief of named sections only: a small header, then each section. */
export interface SectionsBrief {
  /** `compact`: each section in its compact form, long lists a page at a time. `full`: as the full brief has it. */
  detail: "compact" | "full";
  revision: number;
  revisionToken: string;
  /** The changeset's id, name and status; its description and drift with the `changeset` section. */
  changeset: { id: string; name: string; status: string; description?: string; drift?: BriefDrift };
  summary: ChangesetBrief["summary"];
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
   * Compact only: per list section, its total, how many items the answer holds and, when more are
   * left, the call for the next page. A section with `returned` below `total` is a page, not the list.
   */
  pages?: Partial<Record<BriefSection, SectionPage>>;
  more: string;
}

export interface SectionsOptions {
  delta?: BriefDelta;
  filter?: SectionFilter;
  /** Each section as the full brief has it, whatever its size (`detail: "full"`). */
  full?: boolean;
  /** Skip this many items of each list section named (elements, gaps, untraced ids, files). */
  offset?: number;
  /**
   * Items per list section. When absent, a page holds what fits the size target. When given, it is
   * the page size whatever the bytes, and the most traced, unanchored and noCatalogRoute elements
   * the intent section lists by id (default LIST_LIMIT).
   */
  limit?: number;
  /** The size the answer aims for when `limit` is absent (default SECTIONS_TARGET_BYTES). A target: a page holds at least one item. */
  targetBytes?: number;
  /** Connections listed per direction, predicate and other layer in the compact `layers` section (default CONNECTIONS_PER_GROUP). */
  maxConnections?: number;
  /** Bytes of a value as the caller serialises it (default: indented JSON, the largest it can be). */
  measure?: (value: unknown) => number;
  /** The caller's other arguments (changeset, filters, since), repeated in each page's `next` call. */
  callArgs?: Record<string, unknown>;
}

/** A list section being fitted: its items from the offset on, and how to make the section's value from a page of them. */
interface SectionList {
  name: BriefSection;
  unit: string;
  /** The filter's items, all of them. */
  total: number;
  /** The items from the offset on. */
  items: unknown[];
  wrap: (page: unknown[]) => unknown;
  /** Counts over the whole list, given when the answer holds only a page of it. */
  summary?: () => Record<string, unknown>;
}

const countBy = (keys: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
};

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
      const layer = group.layers.get(l.layer) ?? { count: 0, typesNotInModel: 0 };
      layer.count = Math.max(layer.count, l.count);
      layer.typesNotInModel = Math.max(layer.typesNotInModel, l.typesNotInModel ?? 0);
      if (l.entries && entries) {
        layer.entries ??= new Map();
        for (const e of l.entries) {
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
 * How many items of each list a compact answer holds when the caller names no `limit`. When all the
 * lists fit the target whole, they are returned whole. Otherwise the target is shared out, smallest
 * list first, so a short list stays whole and what it leaves goes to the longer ones; a list longer
 * than its share returns the items that fit it, and at least one. Nothing is dropped: a list that
 * is not whole is a page, with its total and the call for the next one.
 */
function pageSizes(lists: SectionList[], target: number, measure: (value: unknown) => number): number[] {
  const sizes = lists.map((list) => measure(list.wrap(list.items)));
  const shown = lists.map((list) => list.items.length);
  if (sizes.reduce((sum, n) => sum + n, 0) <= target) return shown;
  const order = lists.map((_, i) => i).sort((a, b) => sizes[a] - sizes[b]);
  let remaining = target;
  order.forEach((index, position) => {
    const list = lists[index];
    const share = Math.max(0, remaining) / (order.length - position);
    if (sizes[index] <= share) {
      remaining -= sizes[index];
      return;
    }
    // A page: the summary of the whole list first, then the items that fit what is left of the share.
    let used = measure(list.wrap([])) + (list.summary ? measure(list.summary()) : 0);
    let count = 0;
    for (const item of list.items) {
      const weight = measure(item) + 4;
      if (count > 0 && used + weight > share) break;
      used += weight;
      count += 1;
    }
    shown[index] = count;
    remaining -= used;
  });
  return shown;
}

/**
 * Only the named sections, under a small header. `changes` is the build view of every changed
 * element; with `since`, the delta comes too. `filter` narrows the element sections (changes,
 * layers, gaps, acceptedGaps, unwired, intent, codeTouched, feedback) to the elements in some layers
 * or with some ids.
 *
 * Each section comes in a compact form. A list section (every one but `changeset` and `drift`)
 * reports in `pages` its total, how many items the answer holds and, when more are left, the
 * `nextOffset` and the call that returns them: `offset` and `limit` page each list named. Without
 * `limit`, the page sizes are chosen so the answer weighs about `targetBytes`; a list that is not
 * returned whole also gets a `summary` counted over all of it. With `full`, each section is as the
 * full brief has it, whatever its size.
 */
export function briefSections(brief: ChangesetBrief, sections: readonly BriefSection[], options: SectionsOptions = {}): SectionsBrief {
  const names = [...new Set(sections)];
  const filter = options.filter && (options.filter.layers?.length || options.filter.ids?.length) ? options.filter : undefined;
  const ids = filter?.ids ? new Set(filter.ids) : undefined;
  const layers = filter?.layers ? new Set(filter.layers) : undefined;
  const keep = (id: string): boolean => {
    if (!filter) return true;
    return (ids?.has(id) ?? false) || (layers?.has(id.split(".")[0]) ?? false);
  };
  const full = !!options.full;
  const out: SectionsBrief = {
    detail: full ? "full" : "compact",
    revision: brief.revision,
    revisionToken: brief.revisionToken,
    changeset: headerOf(brief),
    summary: brief.summary,
    sections: names,
    ...(filter ? { filter: { ...(filter.layers ? { layers: filter.layers } : {}), ...(filter.ids ? { ids: filter.ids } : {}) } } : {}),
    more: "",
  };
  const notes: string[] = [];
  const intent: ChangesetBrief["intent"] = filter
    ? {
        traced: brief.intent.traced.filter((t) => keep(t.element)),
        untraced: brief.intent.untraced.filter(keep),
        ...(brief.intent.unanchored ? { unanchored: brief.intent.unanchored.filter((u) => keep(u.element)) } : {}),
        ...(brief.intent.noCatalogRoute ? { noCatalogRoute: brief.intent.noCatalogRoute.filter(keep) } : {}),
        ...(brief.intent.note ? { note: brief.intent.note } : {}),
      }
    : brief.intent;
  const unwired =
    brief.unwired && filter ? { ...brief.unwired, elements: brief.unwired.elements.filter((e) => keep(e.element)) } : brief.unwired;
  const offset = Math.max(0, options.offset ?? 0);
  const maxConnections = options.maxConnections ?? CONNECTIONS_PER_GROUP;
  const lists: SectionList[] = [];
  /** A list section whose value is its items. */
  const plain = (name: BriefSection, unit: string, all: unknown[], summary?: () => Record<string, unknown>) =>
    lists.push({ name, unit, total: all.length, items: all.slice(offset), wrap: (page) => page, ...(summary ? { summary } : {}) });

  for (const name of names) {
    switch (name) {
      case "changeset": {
        const description = brief.changeset.description;
        out.changeset = {
          ...out.changeset,
          ...(description ? { description } : {}),
          ...(brief.changeset.drift ? { drift: brief.changeset.drift } : {}),
        };
        break;
      }
      case "drift":
        if (brief.changeset.drift) out.drift = brief.changeset.drift;
        else notes.push("No drift: the changeset is not staged.");
        break;
      case "delta":
        if (!options.delta) notes.push("delta needs since: pass the revisionToken of an earlier brief.");
        break;
      case "changes": {
        const all = compactChanges(brief).build.filter((c) => keep(c.id));
        if (full) out.changes = all;
        else plain(name, "elements", all, () => ({ byType: countBy(all.map((c) => typeOfId(c.id))) }));
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
        const items = all.slice(offset).map(({ layer, change }) => ({ layer, change: compactLayerChange(change, maxConnections, otherLayers) }));
        const regroup = (page: unknown[]) => {
          const grouped: Array<{ layer: string; changes: CompactLayerChange[] }> = [];
          for (const { layer, change } of page as typeof items) {
            if (grouped[grouped.length - 1]?.layer !== layer) grouped.push({ layer, changes: [] });
            grouped[grouped.length - 1].changes.push(change);
          }
          return grouped;
        };
        lists.push({
          name,
          unit: "elements",
          total: all.length,
          items,
          wrap: regroup,
          summary: () => ({ byType: countBy(all.map((a) => typeOfId(a.change.id))) }),
        });
        break;
      }
      case "relationshipChanges":
        if (full) out.relationshipChanges = brief.relationshipChanges;
        else plain(name, "relationships", brief.relationshipChanges);
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
        lists.push({
          name,
          unit: "entries",
          total: entries.length,
          items: entries.slice(offset),
          wrap: (page) => ({
            elements: (page as Entry[]).flatMap((e) => ("element" in e ? [e.element] : [])),
            relationships: (page as Entry[]).flatMap((e) => ("relationship" in e ? [e.relationship] : [])),
          }),
          summary: () => ({ elements: brief.alreadyInBase.elements.length, relationships: brief.alreadyInBase.relationships.length }),
        });
        break;
      }
      case "gaps": {
        const kept = brief.gaps.filter((g) => keep(g.element));
        if (full) out.gaps = kept;
        else {
          plain(name, "gaps", kept.map(gapLine), () => ({
            byKind: countBy(kept.map((g) => g.kind)),
            byType: countBy(kept.map((g) => typeOfId(g.element))),
          }));
        }
        break;
      }
      case "acceptedGaps": {
        const kept = brief.acceptedGaps.filter((g) => keep(g.element));
        if (full) out.acceptedGaps = kept;
        else plain(name, "accepted gaps", kept);
        break;
      }
      case "unwired": {
        if (!unwired) break;
        if (full) {
          out.unwired = unwired;
          break;
        }
        const { elements, ...head } = unwired;
        lists.push({
          name,
          unit: "elements",
          total: elements.length,
          items: elements.slice(offset),
          wrap: (page) => ({ ...head, elements: page }),
          // Each connection with how many elements lack it; per-layer counts alone when that would be long.
          summary: () => {
            const withEntries = unwiredByType(elements);
            const measure = options.measure ?? ((value: unknown) => Buffer.byteLength(JSON.stringify(value, null, 2) ?? ""));
            const room = (options.targetBytes ?? SECTIONS_TARGET_BYTES) / 4;
            return { ...(measure(withEntries) <= room ? withEntries : unwiredByType(elements, false)) };
          },
        });
        break;
      }
      case "intent": {
        if (full) {
          out.intent = intent;
          break;
        }
        // The list that pages is the untraced ids; the counts beside it are over all of them.
        lists.push({
          name,
          unit: "untraced elements",
          total: intent.untraced.length,
          items: intent.untraced.slice(offset),
          wrap: (page) => compactIntent(intent, { tracedAs: "lines", untracedPage: page as string[], listLimit: options.limit }),
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
        plain(name, "files", files, () => ({
          changedElements: files.reduce((sum, f) => sum + f.changed.length, 0),
          neighborOnlyFiles: files.filter((f) => f.changed.length === 0).length,
        }));
        break;
      }
      case "feedback": {
        const kept = brief.feedback.filter((f) => keep(f.elementId));
        if (full) out.feedback = kept;
        else plain(name, "comments", kept);
        break;
      }
    }
  }
  if (filter && ids) {
    const known = new Set(brief.layers.flatMap((l) => l.changes.map((c) => c.id)));
    const unknown = [...ids].filter((id) => !known.has(id));
    if (unknown.length > 0) notes.push(`Not changed by this changeset: ${unknown.join(", ")}.`);
  }
  const which = `(${names.join(", ")})${filter ? ", for the elements the filter keeps" : ""}`;
  if (full) {
    if (options.delta) out.delta = names.includes("delta") ? options.delta : compactDelta(options.delta);
    out.more = [...notes, `The sections asked for ${which}, in full. Call without sections for the compact brief.`].join(" ");
    return out;
  }

  const measure = options.measure ?? ((value: unknown) => Buffer.byteLength(JSON.stringify(value, null, 2) ?? ""));
  const target = options.targetBytes ?? SECTIONS_TARGET_BYTES;
  const values = out as unknown as Record<string, unknown>;
  const pages: Partial<Record<BriefSection, SectionPage>> = {};
  /** The call that returns a section's page at `at`: this call's own arguments, for that section alone. */
  const nextCall = (section: BriefSection, at: number) =>
    `changeset_brief ${JSON.stringify({ ...options.callArgs, sections: [section], offset: at })}`;

  // The delta's lists page with the same limit and offset when the delta is named; otherwise it comes from the start.
  if (options.delta) {
    const page: DeltaPage = { total: 0, returned: 0 };
    const paged = names.includes("delta");
    out.delta = compactDelta(options.delta, { page, ...(paged ? { limit: options.limit, offset } : {}) });
    const at = paged ? offset : 0;
    pages.delta = {
      total: page.total,
      returned: page.returned,
      unit: "entries",
      ...(at > 0 ? { offset: at } : {}),
      ...(page.nextOffset !== undefined ? { nextOffset: page.nextOffset, next: nextCall("delta", page.nextOffset) } : {}),
    };
  }

  // How many items each list returns: the caller's limit, or what fits the target.
  const shown =
    options.limit !== undefined
      ? lists.map((list) => Math.min(list.items.length, Math.max(0, options.limit!)))
      : pageSizes(lists, Math.max(0, target - measure(out)), measure);
  /** Places each list's page and its entry in `pages`, and closes with `more`. */
  const finish = () => {
    lists.forEach((list, i) => {
      const returned = shown[i];
      values[list.name] = list.wrap(list.items.slice(0, returned));
      const nextOffset = offset + returned < list.total ? offset + returned : undefined;
      pages[list.name] = {
        total: list.total,
        returned,
        unit: list.unit,
        ...(offset > 0 ? { offset } : {}),
        ...(nextOffset !== undefined ? { nextOffset, next: nextCall(list.name, nextOffset) } : {}),
        ...(returned < list.total && list.summary ? { summary: list.summary() } : {}),
      };
      if (offset > 0 && offset >= list.total && list.total > 0) {
        const note = `offset ${offset} is past the ${list.total} ${list.unit} of ${list.name}${filter ? " the filter keeps" : ""}.`;
        if (!notes.includes(note)) notes.push(note);
      }
    });
    if (Object.keys(pages).length > 0) out.pages = pages;
    const paged = Object.entries(pages).filter(([, page]) => page.nextOffset !== undefined);
    out.more = [
      ...notes,
      `Only the sections asked for are returned ${which}, each in its compact form.` +
        (paged.length > 0
          ? ` Not everything is here: ${paged.map(([name, page]) => `${name} holds ${page.returned} of ${page.total} ${page.unit}`).join("; ")}.` +
            " pages has the call for each next page; counts and summaries are over the whole lists."
          : " Every list is whole (pages has the totals).") +
        (options.limit === undefined && paged.length > 0
          ? ` Pages are sized to keep the answer near ${Math.round(target / 1024)} KB: pass limit for a fixed page size, or targetBytes for another target.`
          : "") +
        ` Add detail: "full" for these sections in full at once, or call without sections for the compact brief.`,
    ].join(" ");
  };
  finish();
  // A share is measured item by item; nesting adds indentation, and the page entries take room too.
  // With no limit named, shorten the largest page until the whole answer is near the target.
  for (let pass = 0; options.limit === undefined && pass < 60 && measure(out) > target; pass++) {
    const candidates = lists.map((list, i) => ({ list, i })).filter(({ i }) => shown[i] > 1);
    if (candidates.length === 0) break;
    const largest = candidates.reduce((a, b) => (measure(values[a.list.name]) >= measure(values[b.list.name]) ? a : b));
    const now = shown[largest.i];
    const over = measure(out) - target;
    const each = measure(values[largest.list.name]) / now;
    shown[largest.i] = Math.max(1, Math.min(now - 1, now - Math.ceil(over / Math.max(1, each))));
    finish();
  }
  return out;
}
