/**
 * The compact brief — what `changeset_brief` returns by default.
 *
 * The full brief (`buildBrief`) lists every changed element with its attributes, every connection
 * with the other end's name and layer, every unwired connection, and the code each element touches.
 * On a real plan that is 55–420 KB, more than an agent's client takes in one result. The compact
 * brief keeps what a planning pass reads: counts, reach, gaps (one line each), intent (ids), drift,
 * and each changed element with its connections as `predicate → id` lines. A large plan (more than
 * LARGE_PLAN changed elements, a bootstrap) has its elements summarised by type instead, and long id
 * lists cut, so the default stays well under 30 KB. `sections` returns only the sections it names (a
 * small header besides), each in a compact form and together within SECTIONS_BUDGET_BYTES: a section
 * that does not fit falls back to a summary or is cut, and `cut` says what was left out and how to
 * get it. `detail: "full"` returns the full brief unchanged, or the named sections as it has them.
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
 * What a `sections` answer may weigh, in bytes of the JSON the tool returns: under the 25,000
 * tokens a client takes in one tool result, with room for the ids, which tokenise poorly.
 */
export const SECTIONS_BUDGET_BYTES = 40 * 1024;

/** Changed connections of one direction, predicate and other layer listed per element in `layers`; the rest are counted. */
const CONNECTIONS_PER_GROUP = 8;

/** Unwired connections are listed per element up to this many elements; past it, per type. */
const UNWIRED_ELEMENTS_LIMIT = 25;

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
  /** Set when a list was cut at LIST_LIMIT: each list's full length. `detail: "full"` with `sections: ["delta"]` has them all. */
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

/** Ids of one `layer.type`: how many, and the first of them. */
export interface IdsByType {
  type: string;
  count: number;
  /** The first ids of the type, in brief order (none when the answer had no room for them). */
  ids: string[];
  /** How many more of the type there are. */
  more?: number;
}

/**
 * The intent section as the compact brief and `sections` return it. What an agent acts on is
 * listed (the untraced and the unanchored); what it does not is counted (the traced, past a few).
 */
export interface CompactIntent {
  /** How many changed elements each group holds, listed or not. */
  counts: { traced: number; untraced: number; unanchored?: number; noCatalogRoute?: number };
  /**
   * The traced elements, when there are at most LIST_LIMIT: ids in the default brief, and
   * `element → intent element` lines under `sections` (`through <whole>` when it traces through the
   * whole that composes it, `anchored by <id>` when the intent element is one the changeset adds).
   */
  traced?: string[];
  /** The untraced ids, when the list is short enough to give whole. */
  untraced?: string[];
  /** A long untraced list, per `layer.type`, largest first. */
  untracedByType?: IdsByType[];
  /** `element → added intent element` for untraced elements that reach only intent which traces to nothing. */
  unanchored?: string[];
  /**
   * Elements that do not trace and cannot be linked to intent themselves, counted apart from
   * `untraced`: per type, with the ids when there are few.
   */
  noCatalogRoute?: { byType: Record<string, number>; ids?: string[]; note: string };
  /** Why nothing was traced (every changed element is an intent element or a deletion). */
  note?: string;
}

const NO_CATALOG_ROUTE_NOTE =
  "The catalog gives these types no relationship to a motivation, business or product type, so they trace only " +
  "through a neighbour: the element that composes, uses or realizes them. They are not counted as untraced.";

/** Ids per `layer.type`, largest type first, with the first `idsPerType` ids of each. */
function idsByType(ids: string[], idsPerType: number): IdsByType[] {
  const groups = new Map<string, string[]>();
  for (const id of ids) groups.set(typeOfId(id), [...(groups.get(typeOfId(id)) ?? []), id]);
  return [...groups]
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([type, all]) => ({
      type,
      count: all.length,
      ids: all.slice(0, idsPerType),
      ...(all.length > idsPerType ? { more: all.length - idsPerType } : {}),
    }));
}

/**
 * The compact form of the brief's intent. Counts always. The untraced ids are listed up to
 * `listLimit` (default LIST_LIMIT) and past it given per type with the first `idsPerType` ids of
 * each; the traced elements are listed only when there are at most LIST_LIMIT, as ids or, with
 * `tracedAs: "lines"`, with what each traces to.
 */
export function compactIntent(
  intent: ChangesetBrief["intent"],
  options: { listLimit?: number; idsPerType?: number; tracedAs?: "ids" | "lines" } = {}
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
  return {
    counts: {
      traced: intent.traced.length,
      untraced: intent.untraced.length,
      ...(unanchored.length > 0 ? { unanchored: unanchored.length } : {}),
      ...(noRoute.length > 0 ? { noCatalogRoute: noRoute.length } : {}),
    },
    ...(intent.traced.length > 0 && intent.traced.length <= LIST_LIMIT
      ? { traced: options.tracedAs === "lines" ? intent.traced.map(tracedLine) : intent.traced.map((t) => t.element) }
      : {}),
    ...(intent.untraced.length <= listLimit
      ? { untraced: intent.untraced }
      : { untracedByType: idsByType(intent.untraced, idsPerType) }),
    ...(unanchored.length > 0
      ? { unanchored: unanchored.slice(0, Math.max(listLimit, LIST_LIMIT)).map((u) => `${u.element} → ${u.tracesTo}`) }
      : {}),
    ...(noRoute.length > 0
      ? { noCatalogRoute: { byType, ...(noRoute.length <= LIST_LIMIT ? { ids: noRoute } : {}), note: NO_CATALOG_ROUTE_NOTE } }
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

/** A list cut at `limit`, recording its full length in `counts` under `name` when it was cut. */
function capped<T>(list: T[], name: string, counts: Record<string, number>, limit = LIST_LIMIT): T[] {
  if (list.length <= limit) return list;
  counts[name] = list.length;
  return list.slice(0, limit);
}

export function compactDelta(delta: BriefDelta): CompactDelta {
  const counts: Record<string, number> = {};
  const out: CompactDelta = {
    since: delta.since,
    revision: delta.revision,
    elements: {
      added: capped(delta.elements.added, "elements.added", counts),
      removed: capped(delta.elements.removed, "elements.removed", counts),
      updated: capped(delta.elements.updated, "elements.updated", counts).map((u) => `${u.element} (${u.fields.join(", ")})`),
    },
    relationships: {
      added: capped(delta.relationships.added, "relationships.added", counts).map(rel),
      removed: capped(delta.relationships.removed, "relationships.removed", counts).map(rel),
    },
    unstaged: delta.unstaged.map(
      (u) =>
        `#${u.sequence} ${u.operation} ${u.source ? rel({ source: u.source, predicate: u.predicate ?? "?", target: u.target ?? "?" }) : (u.elementId ?? "")} (unstaged at ${u.removedAt})`
    ),
    gaps: { opened: gapLines(delta.gaps.opened), closed: gapLines(delta.gaps.closed) },
    ...(delta.acceptedGaps.accepted.length + delta.acceptedGaps.reopened.length > 0
      ? {
          acceptedGaps: {
            accepted: capped(delta.acceptedGaps.accepted, "acceptedGaps.accepted", counts).map(acceptedGapLine),
            reopened: capped(delta.acceptedGaps.reopened, "acceptedGaps.reopened", counts).map(acceptedGapLine),
          },
        }
      : {}),
    unwired: { wired: delta.unwired.wired.length, new: delta.unwired.new.length, newElements: delta.unwired.newElements.length },
    reach: delta.reach,
    intent: {
      newlyTraced: capped(delta.intent.newlyTraced, "intent.newlyTraced", counts),
      newlyUntraced: capped(delta.intent.newlyUntraced, "intent.newlyUntraced", counts),
    },
    ...(delta.warnings ? { warnings: delta.warnings } : {}),
  };
  if (Object.keys(counts).length > 0) out.counts = counts;
  return out;
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
      ? 'With since, the changed elements are left out: the delta says what changed (sections: ["changes"] lists them). '
      : large
        ? `This plan changes ${changedCount} elements, so changesByType counts them per type with the first ${IDS_PER_TYPE} ids ` +
          'of each; sections: ["changes"] lists them with their connections, a page at a time (offset continues it). '
        : "Each changed element is listed with a short description, its files and its connections; attributes are in the full brief. ") +
    (brief.gaps.length > LIST_LIMIT ? 'Gaps that say the same thing share a line (sections: ["gaps"] with layers or ids lists each). ' : "") +
    (intentCut
      ? `Intent lists longer than ${LIST_LIMIT} are counted (intent.counts), the untraced per type; sections: ["intent"] with ` +
        "layers or ids lists them. "
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
 * (`predicate → id`, `predicate ← id`, marked `(deleted)`), up to CONNECTIONS_PER_GROUP per
 * direction, predicate and other layer, and only when its other end is in `otherLayers` (when that
 * is given). Every other connection is counted.
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

/** Unwired connections per element type, for more elements than are worth listing one by one. */
export interface UnwiredByType {
  mode: NonNullable<ChangesetBrief["unwired"]>["mode"];
  layers?: string[];
  unknownLayers?: string[];
  /** `layer.type (n elements)` for the types with nothing unwired in the layers shown. */
  nothingUnwired?: string[];
  byType: Array<{
    type: string;
    /** Changed elements of the type (that the filter keeps). */
    elements: number;
    ids: string[];
    more?: number;
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

/** What a `sections` answer summarised or left out to stay within its budget, and how to get it. */
export interface SectionCut {
  section: BriefSection;
  /** The form the section is in, when it is a summary and not its usual list. */
  summarised?: string;
  /** How many items the section shows, when its list was cut. */
  shown?: number;
  /** How many there are (the items the filter keeps, or the summary's lines). */
  of?: number;
  /** What an item is: elements, gaps, lines, files, types. */
  unit?: string;
  /** For `changes` and `layers`: the `offset` that continues the list. */
  nextOffset?: number;
  /** For `changes` and `layers`: the filter's elements per `layer.type`. */
  byType?: Record<string, number>;
  /** The call that returns the rest. */
  how: string;
}

/** A brief of named sections only: a small header, then each section. */
export interface SectionsBrief {
  /** `compact`: each section in its compact form, within the budget. `full`: as the full brief has it. */
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
  /** One line per gap (see `gapLines`); the gaps themselves, with examples, in full. */
  gaps?: string[] | BriefGap[];
  acceptedGaps?: BriefAcceptedGap[];
  unwired?: ChangesetBrief["unwired"] | UnwiredByType;
  intent?: CompactIntent | ChangesetBrief["intent"];
  codeTouched?: CompactCodeFile[] | string[] | ChangesetBrief["codeTouched"];
  feedback?: ChangesetBrief["feedback"];
  /** With since: the compact delta, or in full the whole one when `delta` is named. */
  delta?: CompactDelta | BriefDelta;
  /** Compact only: what was summarised or left out to stay within the budget. Absent when nothing was. */
  cut?: SectionCut[];
  more: string;
}

export interface SectionsOptions {
  delta?: BriefDelta;
  filter?: SectionFilter;
  /** Each section as the full brief has it, whatever its size (`detail: "full"`). */
  full?: boolean;
  /** Skip this many of the filter's elements in `changes` and `layers`. */
  offset?: number;
  /** The compact answer's size budget in bytes (default SECTIONS_BUDGET_BYTES). */
  budgetBytes?: number;
  /** Bytes of a value as the caller serialises it (default: indented JSON, the largest it can be). */
  measure?: (value: unknown) => number;
}

/** One way to render a section. */
interface SectionForm {
  value: unknown;
  /** The list the form can be cut along, with what an item is and how to rebuild the value from fewer. */
  items?: unknown[];
  unit?: string;
  wrap?: (items: unknown[]) => unknown;
  /** What the form is, when it is a summary. */
  summarised?: string;
}

/** A section's forms, most detailed first: the first that fits its share of the budget is used, the last cut if none does. */
interface SectionPlan {
  name: BriefSection;
  forms: Array<() => SectionForm>;
  /** How to get what a summary or a cut leaves out. */
  how: string;
  /** `changes` and `layers`: the filter's elements, for the offset and the per-type counts of a cut. */
  paged?: { offset: number; ids: string[] };
}

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

function compactLayerChange(
  c: ChangesetBrief["layers"][number]["changes"][number],
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
    if (n.status !== "unchanged" && inFilter && seen < CONNECTIONS_PER_GROUP) {
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

/** Unwired connections of many elements, per element type: each connection with how many elements lack it. */
function unwiredByType(unwired: NonNullable<ChangesetBrief["unwired"]>): UnwiredByType {
  type Group = {
    ids: string[];
    layers: Map<string, { count: number; typesNotInModel: number; entries?: Map<string, { line: string; elements: number }> }>;
  };
  const groups = new Map<string, Group>();
  for (const element of unwired.elements) {
    const group: Group = groups.get(element.type) ?? { ids: [], layers: new Map() };
    group.ids.push(element.element);
    for (const l of element.byLayer) {
      const layer = group.layers.get(l.layer) ?? { count: 0, typesNotInModel: 0 };
      layer.count = Math.max(layer.count, l.count);
      layer.typesNotInModel = Math.max(layer.typesNotInModel, l.typesNotInModel ?? 0);
      if (l.entries) {
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
  const sorted = [...groups].sort(([, a], [, b]) => b.ids.length - a.ids.length);
  const none = sorted.filter(([, group]) => group.layers.size === 0);
  return {
    mode: unwired.mode,
    ...(unwired.layers ? { layers: unwired.layers } : {}),
    ...(unwired.unknownLayers ? { unknownLayers: unwired.unknownLayers } : {}),
    ...(none.length > 0
      ? { nothingUnwired: none.map(([type, group]) => `${type} (${group.ids.length} ${group.ids.length === 1 ? "element" : "elements"})`) }
      : {}),
    byType: sorted
      .filter(([, group]) => group.layers.size > 0)
      .map(([type, group]) => ({
        type,
        elements: group.ids.length,
        ids: group.ids.slice(0, IDS_PER_TYPE),
        ...(group.ids.length > IDS_PER_TYPE ? { more: group.ids.length - IDS_PER_TYPE } : {}),
        byLayer: [...group.layers]
          .sort(([a], [b]) => rank(a) - rank(b))
          .map(([layer, l]) => ({
            layer,
            count: l.count,
            ...(l.entries
              ? { entries: [...l.entries.values()].map((e) => `${e.line}: ${e.elements} ${e.elements === 1 ? "element" : "elements"}`) }
              : {}),
            ...(l.typesNotInModel > 0 ? { typesNotInModel: l.typesNotInModel } : {}),
          })),
      })),
  };
}

/**
 * Gives each section the most detailed form that fits. When the first forms all fit the budget they
 * are used. Otherwise the budget is shared out, smallest section first, so a small section keeps
 * its list and what it leaves goes to the larger ones: each takes the first form within its share,
 * or its last form cut to it.
 */
function fitSections(
  plans: SectionPlan[],
  budget: number,
  measure: (value: unknown) => number
): Array<{ plan: SectionPlan; form: SectionForm; fallback: boolean; shown?: number }> {
  const first = plans.map((plan) => plan.forms[0]());
  const sizes = first.map((form) => measure(form.value));
  if (sizes.reduce((sum, n) => sum + n, 0) <= budget) {
    return plans.map((plan, i) => ({ plan, form: first[i], fallback: false }));
  }
  const fitted: Array<{ plan: SectionPlan; form: SectionForm; fallback: boolean; shown?: number }> = [];
  const order = plans.map((_, i) => i).sort((a, b) => sizes[a] - sizes[b]);
  let remaining = budget;
  order.forEach((index, position) => {
    const plan = plans[index];
    const share = Math.max(0, remaining) / (order.length - position);
    let form = first[index];
    let size = sizes[index];
    let at = 0;
    while (size > share && at + 1 < plan.forms.length) {
      at += 1;
      form = plan.forms[at]();
      size = measure(form.value);
    }
    let shown: number | undefined;
    if (size > share && form.items && form.wrap) {
      // The items that fit the share, at least one: an answer with nothing in it sends the agent back blind.
      let used = measure(form.wrap([]));
      shown = 0;
      for (const item of form.items) {
        const weight = measure(item) + 4;
        if (shown > 0 && used + weight > share) break;
        used += weight;
        shown += 1;
      }
      size = used;
    }
    remaining -= size;
    fitted[index] = { plan, form, fallback: at > 0, ...(shown !== undefined ? { shown } : {}) };
  });
  return fitted;
}

/**
 * Only the named sections, under a small header. `changes` is the build view of every changed
 * element; with `since`, the delta comes too. `filter` narrows the element sections (changes,
 * layers, gaps, acceptedGaps, unwired, intent, codeTouched, feedback) to the elements in some layers
 * or with some ids.
 *
 * Each section comes in a compact form, and together they stay within `budgetBytes`: a section too
 * large for its share falls back to a summary or is cut, and `cut` says what was left out and the
 * call that returns it (`offset` pages `changes` and `layers`). With `full`, each section is as the
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
  const whole = <T>(value: T[], unit: string): SectionForm => ({ value, items: value, unit, wrap: (items) => items });
  const fullNote = 'detail: "full" with these sections returns everything';
  const narrow = filter ? "narrower layers or ids" : "layers or ids";
  const plans: SectionPlan[] = [];

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
        else {
          const page = all.slice(offset);
          plans.push({
            name,
            forms: [() => whole(page, "elements")],
            how: `offset continues the list; ${narrow} give fewer elements; ${fullNote}`,
            paged: { offset, ids: all.map((c) => c.id) },
          });
        }
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
        const page = all.slice(offset).map(({ layer, change }) => ({ layer, change: compactLayerChange(change, otherLayers) }));
        const regroup = (items: unknown[]) => {
          const grouped: Array<{ layer: string; changes: CompactLayerChange[] }> = [];
          for (const { layer, change } of items as typeof page) {
            if (grouped[grouped.length - 1]?.layer !== layer) grouped.push({ layer, changes: [] });
            grouped[grouped.length - 1].changes.push(change);
          }
          return grouped;
        };
        plans.push({
          name,
          forms: [() => ({ value: regroup(page), items: page, unit: "elements", wrap: regroup })],
          how: `offset continues the list; ${narrow} give fewer elements, otherLayers fewer connections; ${fullNote}, with every connection's name and layer`,
          paged: { offset, ids: all.map((a) => a.change.id) },
        });
        break;
      }
      case "relationshipChanges":
        if (full) out.relationshipChanges = brief.relationshipChanges;
        else plans.push({ name, forms: [() => whole(brief.relationshipChanges, "relationships")], how: fullNote });
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
        const split = (items: unknown[]) => ({
          elements: (items as Entry[]).flatMap((e) => ("element" in e ? [e.element] : [])),
          relationships: (items as Entry[]).flatMap((e) => ("relationship" in e ? [e.relationship] : [])),
        });
        plans.push({ name, forms: [() => ({ value: brief.alreadyInBase, items: entries, unit: "entries", wrap: split })], how: fullNote });
        break;
      }
      case "gaps": {
        const kept = brief.gaps.filter((g) => keep(g.element));
        if (full) out.gaps = kept;
        else {
          plans.push({
            name,
            forms: [
              () => whole(kept.map(gapLine), "gaps"),
              () => ({
                ...whole(gapLines(kept, { group: true }), "lines"),
                summarised: "gaps that say the same thing share a line, with how many elements and the first ids",
              }),
            ],
            how: `${narrow} list each gap of those elements; ${fullNote}, each gap with its examples`,
          });
        }
        break;
      }
      case "acceptedGaps": {
        const kept = brief.acceptedGaps.filter((g) => keep(g.element));
        if (full) out.acceptedGaps = kept;
        else plans.push({ name, forms: [() => whole(kept, "accepted gaps")], how: `${narrow} give fewer; ${fullNote}` });
        break;
      }
      case "unwired": {
        if (!unwired) break;
        if (full) {
          out.unwired = unwired;
          break;
        }
        const perType = (): SectionForm => {
          const value = unwiredByType(unwired);
          return {
            value,
            items: value.byType,
            unit: "types",
            wrap: (items) => ({ ...value, byType: items }),
            summarised: "unwired connections per element type, each with how many elements lack it",
          };
        };
        plans.push({
          name,
          forms: [...(unwired.elements.length <= UNWIRED_ELEMENTS_LIMIT ? [(): SectionForm => ({ value: unwired })] : []), perType],
          how: `ids (up to ${UNWIRED_ELEMENTS_LIMIT} elements) lists each element's unwired connections; unwiredLayers gives fewer of them; ${fullNote}`,
        });
        break;
      }
      case "intent":
        if (full) out.intent = intent;
        else {
          plans.push({
            name,
            forms: [
              () => ({ value: compactIntent(intent, { listLimit: Infinity, tracedAs: "lines" }) }),
              () => ({
                value: compactIntent(intent, { tracedAs: "lines", listLimit: 0, idsPerType: 25 }),
                summarised: "the untraced elements per type, with the first 25 ids of each",
              }),
              () => ({
                value: compactIntent(intent, { tracedAs: "lines", listLimit: 0 }),
                summarised: `the untraced elements per type, with the first ${IDS_PER_TYPE} ids of each`,
              }),
              () => ({
                value: compactIntent(intent, { tracedAs: "lines", listLimit: 0, idsPerType: 0 }),
                summarised: "the untraced elements counted per type",
              }),
            ],
            how: `${narrow} list every untraced id among those elements when they fit; ${fullNote}, every id and each trace with its path`,
          });
        }
        break;
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
        plans.push({
          name,
          forms: [
            () => whole(files, "files"),
            () => ({
              ...whole(
                files.map((f) => `${f.file} (${f.changed.length} changed${f.neighbors ? `, ${f.neighbors} ${f.neighbors === 1 ? "neighbor" : "neighbors"}` : ""})`),
                "files"
              ),
              summarised: "files with how many changed and neighbor elements each holds",
            }),
          ],
          how: `${narrow} list the files of those elements with their ids; ${fullNote}, neighbors by id`,
        });
        break;
      }
      case "feedback": {
        const kept = brief.feedback.filter((f) => keep(f.elementId));
        if (full) out.feedback = kept;
        else plans.push({ name, forms: [() => whole(kept, "comments")], how: `${narrow} give fewer; ${fullNote}` });
        break;
      }
    }
  }
  if (options.delta) out.delta = full && names.includes("delta") ? options.delta : compactDelta(options.delta);
  if (filter && ids) {
    const known = new Set(brief.layers.flatMap((l) => l.changes.map((c) => c.id)));
    const unknown = [...ids].filter((id) => !known.has(id));
    if (unknown.length > 0) notes.push(`Not changed by this changeset: ${unknown.join(", ")}.`);
  }

  const which = `(${names.join(", ")})${filter ? ", for the elements the filter keeps" : ""}`;
  if (full) {
    out.more = [...notes, `The sections asked for ${which}, in full. Call without sections for the compact brief.`].join(" ");
    return out;
  }

  const measure = options.measure ?? ((value: unknown) => Buffer.byteLength(JSON.stringify(value, null, 2) ?? ""));
  const budget = options.budgetBytes ?? SECTIONS_BUDGET_BYTES;
  const target = out as unknown as Record<string, unknown>;
  for (const plan of plans) {
    if (plan.paged && plan.paged.offset > 0 && plan.paged.offset >= plan.paged.ids.length) {
      notes.push(
        `offset ${plan.paged.offset} is past the ${plan.paged.ids.length} elements ${filter ? "the filter keeps" : "of this changeset"} (${plan.name}).`
      );
    }
  }
  /** Places each section as fitted, then says what was summarised or cut and closes with `more`. */
  const finish = (fitted: ReturnType<typeof fitSections>) => {
    const cuts: SectionCut[] = [];
    for (const { plan, form, shown } of fitted) {
      const wasCut = shown !== undefined && form.items !== undefined && form.wrap !== undefined && shown < form.items.length;
      target[plan.name] = wasCut ? form.wrap!(form.items!.slice(0, shown)) : form.value;
      if (!wasCut && !form.summarised) continue;
      const cut: SectionCut = { section: plan.name, ...(form.summarised ? { summarised: form.summarised } : {}), how: plan.how };
      if (wasCut) {
        cut.shown = shown;
        cut.of = plan.paged ? plan.paged.ids.length : form.items!.length;
        cut.unit = form.unit;
        if (plan.paged) {
          cut.nextOffset = plan.paged.offset + shown!;
          const byType: Record<string, number> = {};
          for (const id of plan.paged.ids) byType[typeOfId(id)] = (byType[typeOfId(id)] ?? 0) + 1;
          cut.byType = byType;
          const rest = form.items!.slice(shown).reduce((sum: number, item) => sum + measure(item), 0);
          cut.how = plan.how.replace("offset continues the list", `offset: ${cut.nextOffset} continues the list (about ${kb(rest)} more)`);
        }
      }
      cuts.push(cut);
    }
    if (cuts.length > 0) out.cut = cuts;
    else delete out.cut;
    out.more = [
      ...notes,
      `Only the sections asked for are returned ${which}, each in its compact form and together within about ${kb(budget)}` +
        (cuts.length > 0 ? "; cut says what was summarised or left out, and the call that returns it" : "") +
        `. Add detail: "full" for these sections in full, or call without sections for the compact brief.`,
    ].join(" ");
  };

  // The header and the fixed sections (changeset, drift, the delta) come out of the budget first.
  const fitted = fitSections(plans, Math.max(0, budget - measure(out)), measure);
  finish(fitted);
  // A share is measured item by item; nesting adds indentation, and the cut notes take room too.
  // Trim the largest cut list until the whole answer fits.
  for (let pass = 0; pass < 60 && measure(out) > budget; pass++) {
    const cuttable = fitted.filter((f) => f.form.items && f.form.wrap && (f.shown ?? f.form.items.length) > 1);
    if (cuttable.length === 0) break;
    const largest = cuttable.reduce((a, b) => (measure(target[a.plan.name]) >= measure(target[b.plan.name]) ? a : b));
    const now = largest.shown ?? largest.form.items!.length;
    const over = measure(out) - budget;
    const each = measure(target[largest.plan.name]) / now;
    largest.shown = Math.max(1, Math.min(now - 1, now - Math.ceil(over / Math.max(1, each))));
    finish(fitted);
  }
  return out;
}
