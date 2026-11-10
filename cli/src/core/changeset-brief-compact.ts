/**
 * The compact brief — what `changeset_brief` returns by default.
 *
 * The full brief (`buildBrief`) lists every changed element with its attributes, every connection
 * with the other end's name and layer, every unwired connection, and the code each element touches.
 * On a real plan that is 55–420 KB, more than an agent's client takes in one result. The compact
 * brief keeps what a planning pass reads: counts, reach, gaps (one line each), intent (ids), drift,
 * and each changed element with its connections as `predicate → id` lines. Each full section is
 * still there on request (`sections`), and `detail: "full"` returns the full brief unchanged.
 *
 * See "Iterating on a plan" in docs/CHANGE_MODELING.md.
 */

import { getAllLayerIds } from "../generated/layer-registry.js";
import type { BriefDelta } from "./changeset-brief-delta.js";
import type { BriefDrift, BriefGap, ChangesetBrief, ElementUnwired } from "./changeset-analysis.js";

/**
 * Sections available through `sections`: each full-brief section in full, and `changes`, the
 * compact element list, which a brief with a delta leaves out unless asked for.
 */
export const BRIEF_SECTIONS = [
  "changes",
  "changeset",
  "drift",
  "layers",
  "relationshipChanges",
  "alreadyInBase",
  "gaps",
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
  unwired: { wired: number; new: number; newElements: number };
  reach: BriefDelta["reach"];
  intent: BriefDelta["intent"];
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
    drift?: CompactDrift | BriefDrift;
  };
  summary: ChangesetBrief["summary"];
  /** Changed elements per layer, in layer order. */
  byLayer: Array<{ layer: string; added: number; updated: number; deleted: number }>;
  reach: ChangesetBrief["reach"];
  /** `element: kind: detail`, one per gap. */
  gaps: string[] | BriefGap[];
  intent: { traced: string[]; untraced: string[]; unanchored?: string[] } | ChangesetBrief["intent"];
  /** Unwired connections of added and updated elements, counted per other-end layer. */
  unwired?: { total: number; byLayer: Record<string, number> } | ChangesetBrief["unwired"];
  /** Every changed element. Left out of a brief with a delta unless `sections` names it. */
  changes?: CompactChange[];
  layers?: ChangesetBrief["layers"];
  /** `status source --predicate--> target` for relationships between unchanged elements. */
  relationshipChanges: string[] | ChangesetBrief["relationshipChanges"];
  alreadyInBase?: ChangesetBrief["alreadyInBase"];
  /** Files of the changed elements, with how many changed elements each has. */
  codeTouched: string[] | ChangesetBrief["codeTouched"];
  /**
   * Files that hold only existing elements next to the change: the build must not break them.
   * Left out when `codeTouched` is returned in full (which has them).
   */
  neighborFiles?: string[];
  /** `annotationId on elementId (author, n replies): content`. */
  feedback: string[] | ChangesetBrief["feedback"];
  delta?: CompactDelta | BriefDelta;
  /** How to get more. */
  more: string;
}

const rel = (r: { source: string; predicate: string; target: string }) => `${r.source} --${r.predicate}--> ${r.target}`;
const gapLine = (g: BriefGap) => `${g.element}: ${g.kind}: ${g.detail}`;
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
        ...drift.overlapping.relationships.map((r) => `${rel(r)}: ${r.reason}`),
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

export function compactDelta(delta: BriefDelta): CompactDelta {
  return {
    since: delta.since,
    revision: delta.revision,
    elements: {
      added: delta.elements.added,
      removed: delta.elements.removed,
      updated: delta.elements.updated.map((u) => `${u.element} (${u.fields.join(", ")})`),
    },
    relationships: { added: delta.relationships.added.map(rel), removed: delta.relationships.removed.map(rel) },
    unstaged: delta.unstaged.map(
      (u) =>
        `#${u.sequence} ${u.operation} ${u.source ? rel({ source: u.source, predicate: u.predicate ?? "?", target: u.target ?? "?" }) : (u.elementId ?? "")} (unstaged at ${u.removedAt})`
    ),
    gaps: { opened: delta.gaps.opened.map(gapLine), closed: delta.gaps.closed.map(gapLine) },
    unwired: { wired: delta.unwired.wired.length, new: delta.unwired.new.length, newElements: delta.unwired.newElements.length },
    reach: delta.reach,
    intent: delta.intent,
    ...(delta.warnings ? { warnings: delta.warnings } : {}),
  };
}

/**
 * The compact form of a full brief. `unwired` is the per-element list when the caller asked for
 * one (counted per layer); `full` names the sections to keep in full.
 */
export function compactBrief(
  brief: ChangesetBrief,
  options: { unwired?: ElementUnwired[]; delta?: BriefDelta; full?: readonly BriefSection[] } = {}
): CompactBrief {
  const full = new Set(options.full ?? []);
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

  const changes: CompactChange[] = brief.layers.flatMap((l) =>
    l.changes.map((c) => {
      const connections: string[] = [];
      for (const n of c.connections) {
        if (n.direction === "in" && changedIds.has(n.other)) continue; // listed on its source
        const mark = n.status === "deleted" ? " (deleted)" : n.status === "unchanged" ? " (base)" : "";
        connections.push(n.direction === "out" ? `${n.predicate} → ${n.other}${mark}` : `${n.predicate} ← ${n.other}${mark}`);
      }
      return {
        id: c.id,
        op: c.op,
        ...(c.description ? { description: cut(c.description, ELEMENT_DESCRIPTION_LIMIT) } : {}),
        ...(filesOf.has(c.id) ? { sourceFiles: filesOf.get(c.id) } : {}),
        ...(c.changedFields?.length ? { changedFields: c.changedFields.map((f) => f.field) } : {}),
        connections,
      };
    })
  );

  // The description in full: accepted gaps and decisions are recorded there.
  const description = brief.changeset.description;
  const header: CompactBrief["changeset"] = {
    id: brief.changeset.id,
    name: brief.changeset.name,
    status: brief.changeset.status,
    ...(description ? { description } : {}),
  };
  if (brief.changeset.drift) header.drift = full.has("drift") ? brief.changeset.drift : compactDrift(brief.changeset.drift);

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
    gaps: full.has("gaps") ? brief.gaps : brief.gaps.map(gapLine),
    intent: full.has("intent")
      ? brief.intent
      : {
          traced: brief.intent.traced.map((t) => t.element),
          untraced: brief.intent.untraced,
          ...(brief.intent.unanchored ? { unanchored: brief.intent.unanchored.map((u) => u.element) } : {}),
        },
    ...(brief.unwired && (full.has("unwired") || !options.unwired)
      ? { unwired: brief.unwired }
      : options.unwired
        ? { unwired: unwiredCounts(options.unwired) }
        : {}),
    ...(options.delta && !full.has("changes") ? {} : { changes }),
    relationshipChanges: full.has("relationshipChanges")
      ? brief.relationshipChanges
      : brief.relationshipChanges.map((r) => `${r.status} ${rel(r)}`),
    codeTouched: full.has("codeTouched") ? brief.codeTouched : [...files].map(([file, n]) => `${file} (${n})`),
    ...(full.has("codeTouched") ? {} : { neighborFiles }),
    feedback: full.has("feedback")
      ? brief.feedback
      : brief.feedback.map(
          (f) => `${f.annotationId} on ${f.elementId} (${f.author}, ${f.replies} ${f.replies === 1 ? "reply" : "replies"}): ${cut(f.content, FEEDBACK_LIMIT)}`
        ),
    more:
      (options.delta && !full.has("changes")
        ? 'With since, the changed elements are left out: the delta says what changed (sections: ["changes"] lists them). '
        : "Each changed element is listed with a short description, its files and its connections; attributes are in the full brief. ") +
      `Pass detail: "full" for the whole brief, or sections: [...] for some of it in full (${BRIEF_SECTIONS.join(", ")}).`,
  };
  if (full.has("layers")) out.layers = brief.layers;
  if (full.has("alreadyInBase") || brief.alreadyInBase.elements.length + brief.alreadyInBase.relationships.length > 0) {
    // Short, and commit skips them: listed whenever there are any.
    out.alreadyInBase = brief.alreadyInBase;
  }
  if (options.delta) out.delta = full.has("delta") ? options.delta : compactDelta(options.delta);
  return out;
}
