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
 * small header besides), and `detail: "full"` returns the full brief unchanged.
 *
 * See "Iterating on a plan" in docs/CHANGE_MODELING.md.
 */

import { getAllLayerIds } from "../generated/layer-registry.js";
import type { BriefDelta } from "./changeset-brief-delta.js";
import type { BriefAcceptedGap, BriefDrift, BriefGap, ChangesetBrief, ElementUnwired } from "./changeset-analysis.js";

/**
 * Sections available through `sections`: each full-brief section in full, and `changes`, the
 * compact element list of every changed element. Naming sections returns only those, with a small
 * header (revision, the changeset's id, name and status, summary counts).
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
  connections: string[];
}

/** Narrows `sections` output to some elements: those in these layers, or with these ids. */
export interface SectionFilter {
  layers?: string[];
  ids?: string[];
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
  /** Set when a list was cut at LIST_LIMIT: each list's full length. `sections: ["delta"]` has them all. */
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
  intent: {
    traced: string[];
    untraced: string[];
    unanchored?: string[];
    /** Set when a list was cut at LIST_LIMIT: each list's full length. */
    counts?: { traced: number; untraced: number; unanchored?: number };
  };
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

/**
 * Gaps one line each; past LIST_LIMIT, gaps that say the same thing (a bootstrap's unconnected
 * adds) share one line, `kind: detail (n elements: first ids, +m more)`.
 */
export function gapLines(gaps: BriefGap[]): string[] {
  if (gaps.length <= LIST_LIMIT) return gaps.map(gapLine);
  const groups = new Map<string, string[]>();
  for (const g of gaps) {
    const key = `${g.kind}: ${g.detail}`;
    groups.set(key, [...(groups.get(key) ?? []), g.element]);
  }
  return [...groups].map(([key, elements]) =>
    elements.length === 1
      ? `${elements[0]}: ${key}`
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

  // Intent as ids; a long list is cut (a bootstrap has every element untraced) with its count kept.
  const cutLists: Record<string, number> = {};
  const unanchored = brief.intent.unanchored?.map((u) => u.element);
  const intent: CompactBrief["intent"] = {
    traced: capped(brief.intent.traced.map((t) => t.element), "traced", cutLists),
    untraced: capped(brief.intent.untraced, "untraced", cutLists),
    ...(unanchored ? { unanchored: capped(unanchored, "unanchored", cutLists) } : {}),
  };
  if (Object.keys(cutLists).length > 0) {
    intent.counts = {
      traced: brief.intent.traced.length,
      untraced: brief.intent.untraced.length,
      ...(unanchored ? { unanchored: unanchored.length } : {}),
    };
  }

  const withDelta = !!options.delta;
  const elementList = withDelta ? {} : large ? { changesByType: changesByType(brief) } : { changes };
  const sectionNames = `sections: [...] for only some sections, in full (${BRIEF_SECTIONS.join(", ")})`;
  const more =
    (withDelta
      ? 'With since, the changed elements are left out: the delta says what changed (sections: ["changes"] lists them). '
      : large
        ? `This plan changes ${changedCount} elements, so changesByType counts them per type with the first ${IDS_PER_TYPE} ids ` +
          'of each; sections: ["changes"] lists every one with its connections. '
        : "Each changed element is listed with a short description, its files and its connections; attributes are in the full brief. ") +
    (brief.gaps.length > LIST_LIMIT ? 'Gaps that say the same thing share a line (sections: ["gaps"] lists each). ' : "") +
    (intent.counts ? `Intent lists are cut at ${LIST_LIMIT} ids (intent.counts has their lengths; sections: ["intent"] has them all). ` : "") +
    `Pass detail: "full" for the whole brief, or ${sectionNames}.`;

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

/** A brief of named sections only: a small header, then each section in full. */
export interface SectionsBrief {
  detail: "compact";
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
  layers?: ChangesetBrief["layers"];
  relationshipChanges?: ChangesetBrief["relationshipChanges"];
  alreadyInBase?: ChangesetBrief["alreadyInBase"];
  gaps?: BriefGap[];
  acceptedGaps?: BriefAcceptedGap[];
  unwired?: ChangesetBrief["unwired"];
  intent?: ChangesetBrief["intent"];
  codeTouched?: ChangesetBrief["codeTouched"];
  feedback?: ChangesetBrief["feedback"];
  /** With since: the compact delta, or the full one when `delta` is named. */
  delta?: CompactDelta | BriefDelta;
  more: string;
}

/**
 * Only the named sections, each in full, under a small header. `changes` is the build view of every
 * changed element; with `since`, the delta comes too, compact unless `delta` is named. `filter`
 * narrows the element sections (changes, layers, gaps, unwired, intent, feedback) to the elements in
 * some layers or with some ids.
 */
export function briefSections(
  brief: ChangesetBrief,
  sections: readonly BriefSection[],
  options: { delta?: BriefDelta; filter?: SectionFilter } = {}
): SectionsBrief {
  const names = [...new Set(sections)];
  const filter = options.filter && (options.filter.layers?.length || options.filter.ids?.length) ? options.filter : undefined;
  const ids = filter?.ids ? new Set(filter.ids) : undefined;
  const layers = filter?.layers ? new Set(filter.layers) : undefined;
  const keep = (id: string): boolean => {
    if (!filter) return true;
    return (ids?.has(id) ?? false) || (layers?.has(id.split(".")[0]) ?? false);
  };
  const out: SectionsBrief = {
    detail: "compact",
    revision: brief.revision,
    revisionToken: brief.revisionToken,
    changeset: headerOf(brief),
    summary: brief.summary,
    sections: names,
    ...(filter ? { filter } : {}),
    more: "",
  };
  const notes: string[] = [];
  for (const name of names) {
    switch (name) {
      case "changes":
        out.changes = compactChanges(brief).build.filter((c) => keep(c.id));
        break;
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
      case "layers":
        out.layers = filter
          ? brief.layers.map((l) => ({ ...l, changes: l.changes.filter((c) => keep(c.id)) })).filter((l) => l.changes.length > 0)
          : brief.layers;
        break;
      case "relationshipChanges":
        out.relationshipChanges = brief.relationshipChanges;
        break;
      case "alreadyInBase":
        out.alreadyInBase = brief.alreadyInBase;
        break;
      case "gaps":
        out.gaps = brief.gaps.filter((g) => keep(g.element));
        break;
      case "acceptedGaps":
        out.acceptedGaps = brief.acceptedGaps.filter((g) => keep(g.element));
        break;
      case "unwired":
        if (brief.unwired) out.unwired = filter ? { ...brief.unwired, elements: brief.unwired.elements.filter((e) => keep(e.element)) } : brief.unwired;
        break;
      case "intent":
        out.intent = filter
          ? {
              traced: brief.intent.traced.filter((t) => keep(t.element)),
              untraced: brief.intent.untraced.filter(keep),
              ...(brief.intent.unanchored ? { unanchored: brief.intent.unanchored.filter((u) => keep(u.element)) } : {}),
            }
          : brief.intent;
        break;
      case "codeTouched":
        out.codeTouched = brief.codeTouched;
        break;
      case "feedback":
        out.feedback = brief.feedback.filter((f) => keep(f.elementId));
        break;
      case "delta":
        if (!options.delta) notes.push("delta needs since: pass the revisionToken of an earlier brief.");
        break;
    }
  }
  if (options.delta) out.delta = names.includes("delta") ? options.delta : compactDelta(options.delta);
  if (filter && ids) {
    const known = new Set(brief.layers.flatMap((l) => l.changes.map((c) => c.id)));
    const unknown = [...ids].filter((id) => !known.has(id));
    if (unknown.length > 0) notes.push(`Not changed by this changeset: ${unknown.join(", ")}.`);
  }
  out.more = [
    ...notes,
    `Only the sections asked for are returned (${names.join(", ")})` +
      (filter ? ", for the elements the filter keeps" : "") +
      `. Call without sections for the compact brief, or with detail: "full" for everything.`,
  ].join(" ");
  return out;
}
