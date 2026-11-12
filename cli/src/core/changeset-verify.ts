/**
 * Changeset verify — compare what a change PLANNED (a staged changeset) with what was BUILT.
 *
 * The planned side is always a changeset: its net changes (adds, updates and deletes of elements and
 * relationships, replayed in sequence order). The built side is a `BuiltSide`, which can come from:
 *
 * - another changeset (`builtFromGraph`): an as-built changeset, normally written by
 *   `codebase_extract`. The built world is the base model with that changeset applied, and what the
 *   build changed is known, so unplanned changes are reported in full. When it came from extraction,
 *   planned changes extraction can't produce are unverifiable, not missing (see
 *   `extraction-observability.ts`).
 * - the base model (`builtFromBase`): e.g. after an as-built changeset was committed on the branch.
 *   What the build changed is not known, so unplanned changes are limited to relationships the build
 *   gave the elements the plan adds.
 * - a plain snapshot of elements and relationships (`builtFromSnapshot`), the shape an extraction
 *   cascade can produce without writing a changeset first.
 *
 * Matching is tolerant of renames. Elements match by id first, then by layer + type + normalized
 * name, then by layer + normalized name with a different type, then (optionally) by layer + type +
 * shared source file. Anything other than an id match is reported as a probable match with its
 * reason, never as exact. Relationships match by (source, predicate, target) after mapping the
 * planned endpoints through the element matches, so a relationship between renamed elements still
 * matches (probably).
 *
 * Descriptions are not compared (prose against a docstring differs without the build being wrong):
 * a difference is a note on the match. A planned update that changes the description still has it
 * checked.
 *
 * See docs/CHANGE_MODELING.md (Verify).
 */

import { Changeset, type StagedChange } from "./changeset.js";
import { ChangesetGraph, type GraphElement, type GraphRelationship } from "./changeset-graph.js";
import type { Model } from "./model.js";
import type { SourceReference } from "../types/source-reference.js";
import { tryReadBaseIndex } from "./changeset-base-index.js";
import { stagedSourceReference } from "./staged-source-reference.js";
import { loadExtractionCoverage, type ExtractionCoverage } from "./extraction-observability.js";
import { currentGitHead, resolveAnalyzerName } from "../analyzers/active-analyzer.js";
import { decisionKey } from "../analyzers/extraction-plan.js";
import { checkPlanAcceptedGaps, type AcceptedGapsCheck } from "./accepted-gaps-verify.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Attribute fields whose expected progress is not a divergence: a plan says `status: planned`, the
 * build says `delivered`. Only a move to a later stage of LIFECYCLE_STAGES counts; a move back, or
 * to a value outside them, stays a divergence.
 */
export const LIFECYCLE_FIELDS: readonly string[] = ["attributes.status"];

/**
 * The stages of the spec's status enums, in order (values in one stage are alternatives from
 * different types: goals, product items, milestones, test cases). Off-ramps such as `deprecated`,
 * `abandoned`, `cancelled` and `at-risk` are not stages, so moving to one is reported as a divergence.
 */
export const LIFECYCLE_STAGES: readonly (readonly string[])[] = [
  ["proposed", "draft"],
  ["planned", "under-review"],
  ["approved", "in-progress", "developing", "active"],
  ["implemented", "delivered", "achieved", "completed"],
  ["automated"],
];

function lifecycleStage(value: unknown): number {
  if (typeof value !== "string") return -1;
  const v = value.trim().toLowerCase();
  return LIFECYCLE_STAGES.findIndex((stage) => stage.includes(v));
}

/** Whether a field difference is the build moving a lifecycle field to a later stage. */
export function isLifecycleMove(difference: FieldDifference): boolean {
  if (!LIFECYCLE_FIELDS.includes(difference.field)) return false;
  const from = lifecycleStage(difference.planned);
  const to = lifecycleStage(difference.built);
  return from >= 0 && to > from;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface VerifyElement {
  /** Dotted path (`layer.type.name`). */
  id: string;
  layer: string;
  type: string;
  name: string;
  description?: string;
  attributes: Record<string, unknown>;
  sourceReference?: SourceReference;
}

export interface VerifyRelationship {
  source: string;
  predicate: string;
  target: string;
}

export interface PlannedElementChange extends VerifyElement {
  op: "add" | "update" | "delete";
  /** For updates: the fields the plan changes (`description`, `attributes.priority`, ...). */
  changedFields?: string[];
  /** For updates: each changed field's value before the plan, to tell a build that left it alone from one that changed it differently. */
  baseValues?: Record<string, unknown>;
}

export interface PlannedRelationshipChange extends VerifyRelationship {
  op: "add" | "delete";
}

export interface Plan {
  label: string;
  elements: PlannedElementChange[];
  relationships: PlannedRelationshipChange[];
  /** Changes that could not be read, and anything else worth knowing about the plan. */
  notes: string[];
  /**
   * Ids of the elements the base model had when the plan was created (its base index). Such an
   * element cannot be the built form of a planned add. Undefined when no index was recorded.
   */
  baseElementIds?: string[];
}

export type BuiltChange = "added" | "updated" | "deleted";

export interface BuiltElement extends VerifyElement {
  change?: BuiltChange;
  /**
   * The source provenance the as-built changeset itself staged: an add's, or an update's when the
   * update changed the source reference. Undefined when the change kept the base's source reference
   * (a hand update of an extracted base element is not extraction output).
   */
  stagedProvenance?: string;
  /**
   * For an update: the fields it changes from the base (`name`, `description`, `attributes.x`,
   * `source_reference`), each with its base value.
   */
  updatedFrom?: Record<string, unknown>;
}

export interface BuiltRelationship extends VerifyRelationship {
  change?: Exclude<BuiltChange, "updated">;
}

export interface BuiltSide {
  label: string;
  kind: "changeset" | "base" | "snapshot";
  /** Elements that exist in the built world. */
  elements: BuiltElement[];
  /** Relationships that exist in the built world. */
  relationships: BuiltRelationship[];
  /**
   * What the build changed, deletions included. Undefined when it is not known (the base model);
   * unplanned changes are then limited to the neighbourhood of the plan's additions.
   */
  changedElements?: BuiltElement[];
  changedRelationships?: BuiltRelationship[];
  notes: string[];
}

export type MatchKind = "exact" | "probable";

export interface FieldDifference {
  field: string;
  planned: unknown;
  built: unknown;
}

export interface ElementMatch {
  planned: string;
  built: string;
  op: PlannedElementChange["op"];
  match: MatchKind;
  /** Why a probable match was made. */
  reason?: string;
  /** Expected lifecycle progress (see LIFECYCLE_FIELDS): reported, not counted as divergence. */
  lifecycle?: FieldDifference[];
  /**
   * Differences reported for information only, not divergence: the description (prose against a
   * docstring, or extraction's placeholder text). A planned update that changes the description
   * still has it checked.
   */
  notes?: FieldDifference[];
  /**
   * Against extraction: planned fields extraction never writes (the description, attributes the
   * node mapping doesn't fill) that the build left as they were. Not compared.
   */
  unverifiableFields?: FieldDifference[];
  /** The built element was not staged by extraction (see AsBuiltShare.agentAdded): no evidence about the code. */
  builtByAgent?: true;
  /** The built element was extracted, then its name or attributes were changed: the edits. */
  editedAfterExtraction?: ExtractionEdit[];
}

export interface DivergentElement extends ElementMatch {
  fields: FieldDifference[];
}

export interface MissingElement {
  planned: string;
  layer: string;
  type: string;
  name: string;
  op: PlannedElementChange["op"];
  reason: string;
  /** Built elements that could be it, when matching was ambiguous. */
  candidates?: string[];
  /** For a planned update that the build does not carry: the fields it would have changed. */
  fields?: FieldDifference[];
}

/** A planned element the build can't show either way: extraction never produces it. */
export interface UnverifiableElement {
  planned: string;
  layer: string;
  type: string;
  name: string;
  op: PlannedElementChange["op"];
  reason: string;
  /** For a planned update of a found element: the fields extraction doesn't write. */
  fields?: FieldDifference[];
}

export interface UnplannedElement {
  id: string;
  layer: string;
  type: string;
  name: string;
  change: BuiltChange | "present";
}

export interface DeletionNotDone {
  planned: string;
  built: string;
}

export interface RelationshipMatch {
  planned: VerifyRelationship;
  built: VerifyRelationship;
  op: PlannedRelationshipChange["op"];
  match: MatchKind;
  reason?: string;
}

export interface DivergentRelationship extends RelationshipMatch {
  fields: FieldDifference[];
}

export interface MissingRelationship {
  planned: VerifyRelationship;
  reason: string;
  /** Relationships between the same elements that may predate the change (built side without changes). */
  candidates?: VerifyRelationship[];
}

/** A planned relationship extraction can't produce: an end it can't see, or no code edge maps to it. */
export interface UnverifiableRelationship {
  planned: VerifyRelationship;
  op: PlannedRelationshipChange["op"];
  reason: string;
}

export interface UnplannedRelationship extends VerifyRelationship {
  change: Exclude<BuiltChange, "updated"> | "present";
}

export interface RelationshipDeletionNotDone {
  planned: VerifyRelationship;
  built: VerifyRelationship;
}

export interface CategoryCounts {
  planned: number;
  /** Planned changes found in the build, divergent ones included (`divergent` is the subset that differs). */
  matched: number;
  probable: number;
  missing: number;
  divergent: number;
  unplanned: number;
  deletionsNotDone: number;
  /** Planned changes extraction can't see; not part of the verdict. */
  unverifiable: number;
}

export type Verdict = "match" | "probable-match" | "diverges" | "incomplete" | "unverifiable" | "empty-plan";

/** How much of the as-built side came from extraction, and how much was added by hand. */
export interface AsBuiltShare {
  elements: {
    /** Elements the as-built changeset adds, updates or deletes. */
    total: number;
    /**
     * By the source provenance the changeset staged (`extracted`, `manual`, `inferred`, `generated`,
     * `none`), `sourceUnchanged` for updates that kept the base element's source reference, and
     * `deleted` for deletes. This is what was declared; `fromExtraction` is what extraction's own
     * record confirms.
     */
    byProvenance: Record<string, number>;
    /**
     * Confirmed by extraction's record (`.dr/analyzers/extract/<id>.json`): adds it staged, or the
     * agent staged from one of its cards; updates it staged (`updated`); deletes of its candidate
     * deletes.
     */
    fromExtraction: number;
    /** The rest: added, changed or deleted by the agent, whatever provenance they declare (see `agentAdded`). */
    agentAdded: number;
  };
  relationships: {
    /** Relationships the as-built changeset adds. */
    total: number;
    /** Between two elements confirmed from extraction (relationships record no provenance of their own). */
    betweenExtracted: number;
    /** Touching an element that did not come from extraction. */
    other: number;
  };
  /**
   * Whether codebase_extract's record of this changeset was found: its own (`found`), or the record
   * of a run that staged nothing, for the changeset of that name at the current commit (`pending`).
   * Without it nothing is confirmed.
   */
  record: "found" | "pending" | "not-found";
  /** Each element not confirmed from extraction: its declared provenance and why it doesn't count. */
  agentAdded?: Array<{ id: string; declared: string; reason: string }>;
  /**
   * Extracted elements changed after extraction staged them: an add whose name or attributes
   * differ from what it staged, or an update that changes a field extraction didn't, or holds a
   * value extraction didn't write. They count toward `fromExtraction` (coverage), but not as
   * evidence: their matches are marked `builtByAgent` with the edits, and they count toward the
   * warning.
   */
  editedAfterExtraction?: Array<{ id: string; edits: ExtractionEdit[] }>;
  /**
   * As-built elements, not from extraction, whose id the plan also adds: likely copied from the
   * plan, so their match says nothing about the code.
   */
  copiedFromPlan?: string[];
}

/** A field of an extracted element changed after extraction staged it. */
export interface ExtractionEdit {
  field: string;
  extracted: unknown;
  now: unknown;
}

/** A symbol extraction offered: a card, an earlier card, or a symbol it staged. */
export interface OfferedSymbol {
  file: string | null;
  symbol: string;
  label?: string;
  name?: string;
  candidates?: string[];
  hint?: string;
  proposed?: { id?: string; name?: string };
}

/**
 * What `codebase_extract` recorded about an as-built changeset (`.dr/analyzers/extract/<id>.json`,
 * or `pending.json` for a run that staged nothing): the elements it staged (with the name and
 * attributes it gave them, when recorded), the updates it staged, its candidate deletes, and the
 * cards of its runs. Only the fields verify reads.
 */
export interface ExtractionRecord {
  source: "changeset" | "pending";
  /** For a pending record read at another commit: the commit it was read at. */
  readAt?: string;
  staged: Array<OfferedSymbol & { id: string; attributes?: Record<string, unknown> }>;
  cards: OfferedSymbol[];
  /** Cards earlier runs returned that the agent has since modelled. */
  earlierCards: OfferedSymbol[];
  /**
   * Updates extraction itself staged, with the fields when recorded (`description`,
   * `attributes.http_path`, `source_reference`), an update folded into an add included.
   */
  updated: Array<{
    id: string;
    fields?: string[];
    /** The value extraction wrote for each field, keyed like `fields`, when recorded. */
    values?: Record<string, unknown>;
  }>;
  candidateDeletes: string[];
}

function readList<T>(value: unknown, keep: (entry: any) => boolean): T[] {
  return Array.isArray(value) ? (value.filter((e) => e && typeof e === "object" && keep(e)) as T[]) : [];
}

async function readRecordFile(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Reads codebase_extract's record of a changeset; null when there is none. Without a record of its
 * own, the record of a run that staged nothing (`pending.json`) counts when it names this changeset.
 * When it was read at another commit than `gitHead` (the agent committed in between), `readAt` says
 * which, for a note.
 */
export async function readExtractionRecord(
  rootPath: string,
  changeset: { id: string; name: string },
  gitHead?: string | null
): Promise<ExtractionRecord | null> {
  const dir = path.join(rootPath, ".dr", "analyzers", "extract");
  let raw = await readRecordFile(path.join(dir, `${changeset.id.replace(/[^\w.-]/g, "_")}.json`));
  let source: ExtractionRecord["source"] = "changeset";
  if (raw && (raw.pending || (raw.changesetId !== undefined && raw.changesetId !== changeset.id))) raw = null;
  if (!raw) {
    const pending = await readRecordFile(path.join(dir, "pending.json"));
    if (pending?.pending && pending.changesetName === changeset.name) {
      raw = pending;
      source = "pending";
    }
  }
  if (!raw) return null;
  const symbol = (e: any) => typeof e.symbol === "string";
  const readAt = source === "pending" && typeof raw.gitHead === "string" && raw.gitHead !== gitHead ? raw.gitHead : undefined;
  return {
    source,
    ...(readAt ? { readAt } : {}),
    staged: readList(raw.staged, (e) => typeof e.id === "string"),
    cards: readList(raw.cards, symbol),
    earlierCards: readList(raw.earlierCards, symbol),
    updated: readList(raw.updated, (e) => typeof e.id === "string"),
    candidateDeletes: Array.isArray(raw.candidateDeletes) ? raw.candidateDeletes.filter((d): d is string => typeof d === "string") : [],
  };
}

export interface VerifyExtraction {
  /** Whether extraction's blind spots were taken into account (the built side came from extraction). */
  applied: boolean;
  /** Why or why not. */
  reason: string;
  analyzer?: string;
  /** Element types the analyzer's extraction can produce. */
  observableTypes?: string[];
  asBuilt?: AsBuiltShare;
}

/** What extraction can see; given when the built side came from extraction. */
export interface ObservabilityCheck {
  /** `unlocated`: unobservable only for want of a method, path or source reference (see ObservabilityVerdict). */
  element(element: VerifyElement): { observable: boolean; reason?: string; unlocated?: true };
  relationship(source: VerifyElement, predicate: string, target: VerifyElement): { observable: boolean; reason?: string };
  /** Whether extraction writes this field (`description`, `attributes.x`, ...) of such an element. */
  field?(element: VerifyElement, field: string): boolean;
}

export interface VerifyReport {
  planned: { label: string; elements: number; relationships: number };
  against: { label: string; kind: BuiltSide["kind"] };
  verdict: Verdict;
  verdictText: string;
  summary: { elements: CategoryCounts; relationships: CategoryCounts };
  elements: {
    matched: ElementMatch[];
    divergent: DivergentElement[];
    missing: MissingElement[];
    unverifiable: UnverifiableElement[];
    unplanned: UnplannedElement[];
    deletionsNotDone: DeletionNotDone[];
  };
  relationships: {
    matched: RelationshipMatch[];
    divergent: DivergentRelationship[];
    missing: MissingRelationship[];
    unverifiable: UnverifiableRelationship[];
    unplanned: UnplannedRelationship[];
    deletionsNotDone: RelationshipDeletionNotDone[];
  };
  /** Whether extraction's blind spots were taken into account, and where the as-built side came from. */
  extraction?: VerifyExtraction;
  /**
   * Set when the comparison says little about the code: more than half of the as-built side was not
   * staged by extraction (added by the agent, or copied from the plan).
   */
  warning?: string;
  notes: string[];
  /**
   * The plan's accepted gaps (`accepted_gaps` on its added and updated elements) and those the build
   * contradicts: its counterpart has a relationship the gap says is deliberately absent (#1026).
   * Absent when the plan has none.
   */
  acceptedGaps?: AcceptedGapsCheck;
}

export interface VerifyOptions {
  /** Match elements of the same layer and type that share a source file (default true). */
  matchBySource?: boolean;
  /**
   * When the built side came from extraction: what extraction can see. A planned change it can't
   * see that the build lacks is reported as unverifiable, not missing, and left out of the verdict.
   */
  observability?: ObservabilityCheck;
}

// ---------------------------------------------------------------------------
// Planned side
// ---------------------------------------------------------------------------

/**
 * The net changes of a changeset, replayed in sequence order: an add later updated is an add, an
 * add later deleted is nothing, a relationship added and then removed is nothing.
 *
 * `resolve` maps UUIDs to dotted paths (pass `graph.resolve` from the changeset's own graph);
 * `lookup` supplies an element's record when a delete carries no `before` snapshot.
 */
export function planFromChangeset(
  changeset: Changeset,
  context: { resolve?: (id: string) => string; lookup?: (id: string) => GraphElement | undefined } = {}
): Plan {
  const resolve = context.resolve ?? ((id: string) => id);
  const notes: string[] = [];
  const elements = new Map<string, PlannedElementChange & { before?: VerifyElement }>();
  const relationships = new Map<string, PlannedRelationshipChange>();

  const changes = [...(changeset.changes as StagedChange[])]
    .map((change, index) => ({ change, index }))
    .sort((a, b) => (a.change.sequenceNumber ?? a.index) - (b.change.sequenceNumber ?? b.index));

  for (const { change, index } of changes) {
    const where = `change #${change.sequenceNumber ?? index} (${change.type} ${change.elementId})`;

    if (change.type === "relationship-add" || change.type === "relationship-delete") {
      const rel = readRelationship(change, resolve);
      if (!rel) {
        notes.push(`Skipped ${where}: it does not name a source, predicate and target.`);
        continue;
      }
      const key = relKey(rel);
      const previous = relationships.get(key);
      if (change.type === "relationship-add") {
        // Re-adding a relationship this changeset removed restores it: no net change.
        if (previous?.op === "delete") relationships.delete(key);
        else relationships.set(key, { ...rel, op: "add" });
      } else {
        if (previous?.op === "add") relationships.delete(key);
        else relationships.set(key, { ...rel, op: "delete" });
      }
      continue;
    }

    const id = resolve(change.elementId);
    const previous = elements.get(id);

    if (change.type === "add" || change.type === "update") {
      if (!change.after) {
        notes.push(`Skipped ${where}: it has no element data.`);
        continue;
      }
      const record = toVerifyElement(change.after, change.layerName, id);
      if (change.type === "add" && previous?.op !== "delete") {
        elements.set(id, { ...record, op: "add" });
      } else if (previous?.op === "add") {
        elements.set(id, { ...record, op: "add" });
      } else {
        const before =
          previous?.before ??
          (change.before ? toVerifyElement(change.before, change.layerName, id) : undefined);
        const fields = before ? changedFields(before, record) : undefined;
        elements.set(id, {
          ...record,
          op: "update",
          ...(before && fields
            ? { before, changedFields: fields, baseValues: Object.fromEntries(fields.map((f) => [f, fieldValue(before, f)])) }
            : {}),
        });
      }
      continue;
    }

    if (change.type === "delete") {
      if (previous?.op === "add") {
        elements.delete(id);
        continue;
      }
      const known = context.lookup?.(id);
      const before =
        previous?.before ??
        (change.before
          ? toVerifyElement(change.before, change.layerName, id)
          : known
            ? fromGraphElement(known)
            : fromId(id, change.layerName));
      elements.set(id, { ...before, id, op: "delete", before });
      continue;
    }

    notes.push(`Skipped ${where}: unknown change type.`);
  }

  return {
    label: changeset.name,
    elements: [...elements.values()].map(({ before: _before, ...rest }) => rest),
    relationships: [...relationships.values()],
    notes,
  };
}

/** The planned side of a changeset, read through its projected graph over the model. */
export async function planFromModel(model: Model, changeset: Changeset): Promise<Plan> {
  const graph = await ChangesetGraph.build(model, changeset);
  return planFromChangeset(changeset, {
    resolve: (id) => graph.resolve(id),
    lookup: (id) => graph.getElement(id),
  });
}

// ---------------------------------------------------------------------------
// Built side
// ---------------------------------------------------------------------------

/** The built world of an as-built changeset: base + its changes, with what it changed. */
export function builtFromGraph(graph: ChangesetGraph, label = graph.changeset.name): BuiltSide {
  const elements: BuiltElement[] = [];
  const changedElements: BuiltElement[] = [];
  for (const element of graph.elements.values()) {
    const staged =
      element.status === "added" ||
      (element.status === "updated" &&
        !sameValue(element.sourceReference ?? null, (element.before && stagedSourceReference(element.before)) ?? null));
    const current = fromGraphElement(element);
    let updatedFrom: Record<string, unknown> | undefined;
    if (element.status === "updated" && element.before) {
      const before = toVerifyElement(element.before, element.layer, element.id);
      updatedFrom = Object.fromEntries(changedFields(before, current).map((f) => [f, fieldValue(before, f)]));
      if (!sameValue(current.sourceReference ?? null, before.sourceReference ?? null)) updatedFrom.source_reference = before.sourceReference ?? null;
    }
    const built: BuiltElement = {
      ...current,
      ...(element.status !== "unchanged" ? { change: element.status } : {}),
      ...(staged ? { stagedProvenance: element.sourceReference?.provenance ?? "none" } : {}),
      ...(updatedFrom ? { updatedFrom } : {}),
    };
    if (element.status !== "deleted") elements.push(built);
    if (element.status !== "unchanged") changedElements.push(built);
  }

  const relationships: BuiltRelationship[] = [];
  const changedRelationships: BuiltRelationship[] = [];
  for (const rel of graph.relationships()) {
    const built: BuiltRelationship = {
      source: rel.source,
      predicate: rel.predicate,
      target: rel.target,
      ...(rel.status !== "unchanged" ? { change: rel.status } : {}),
    };
    if (rel.status !== "deleted") relationships.push(built);
    if (rel.status !== "unchanged") changedRelationships.push(built);
  }

  return { label, kind: "changeset", elements, relationships, changedElements, changedRelationships, notes: [] };
}

/** The base model as the built world. What the build changed is not known. */
export async function builtFromBase(model: Model): Promise<BuiltSide> {
  const now = new Date().toISOString();
  const empty = new Changeset({
    id: "base",
    name: "base model",
    created: now,
    modified: now,
    status: "committed",
    baseSnapshot: "",
    changes: [],
  });
  const graph = await ChangesetGraph.build(model, empty);
  const side = builtFromGraph(graph, "base model");
  return {
    label: "base model",
    kind: "base",
    elements: side.elements,
    relationships: side.relationships,
    notes: [
      "Compared with the base model: what the build changed is not recorded, so unplanned changes are limited " +
        "to relationships the build gave the elements this plan adds. Compare with an as-built changeset for " +
        "a full list.",
    ],
  };
}

/**
 * A built side from plain elements and relationships, e.g. the output of an extraction pass.
 * With `allChanged`, every element and relationship given counts as a change of the build (an
 * extraction scoped to the branch's diff); otherwise they are the built world only.
 */
export function builtFromSnapshot(snapshot: {
  label: string;
  elements: BuiltElement[];
  relationships: BuiltRelationship[];
  allChanged?: boolean;
  notes?: string[];
}): BuiltSide {
  const elements = snapshot.elements.filter((e) => e.change !== "deleted");
  const relationships = snapshot.relationships.filter((r) => r.change !== "deleted");
  return {
    label: snapshot.label,
    kind: "snapshot",
    elements,
    relationships,
    ...(snapshot.allChanged
      ? {
          changedElements: snapshot.elements.map((e) => ({ ...e, change: e.change ?? "added" })),
          changedRelationships: snapshot.relationships.map((r) => ({ ...r, change: r.change ?? "added" })),
        }
      : {}),
    notes: snapshot.notes ?? [],
  };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export function verifyChangeset(plan: Plan, built: BuiltSide, options: VerifyOptions = {}): VerifyReport {
  const matchBySource = options.matchBySource ?? true;
  const notes = [...plan.notes, ...built.notes];

  const builtById = new Map(built.elements.map((e) => [e.id, e]));
  const changedIds = new Set((built.changedElements ?? []).map((e) => e.id));
  const claimed = new Set<string>();
  /** planned id → built id, with how it matched. */
  const elementMap = new Map<string, { built: string; match: MatchKind; reason?: string }>();

  const report: VerifyReport = {
    planned: { label: plan.label, elements: plan.elements.length, relationships: plan.relationships.length },
    against: { label: built.label, kind: built.kind },
    verdict: "match",
    verdictText: "",
    summary: { elements: emptyCounts(), relationships: emptyCounts() },
    elements: { matched: [], divergent: [], missing: [], unverifiable: [], unplanned: [], deletionsNotDone: [] },
    relationships: { matched: [], divergent: [], missing: [], unverifiable: [], unplanned: [], deletionsNotDone: [] },
    notes,
  };

  // Extraction's blind spots: a planned element it can't produce, that the build lacks, is unverifiable.
  const observability = options.observability;
  const unverifiableIds = new Map<string, string>();
  /** Why a planned element that could be unverifiable is reported missing instead. */
  const missingHints = new Map<string, string>();
  const markUnverifiable = (planned: PlannedElementChange): boolean => {
    if (!observability) return false;
    const verdict = observability.element(planned);
    if (verdict.observable) return false;
    if (verdict.unlocated) {
      // Nothing to find it by, but the build changed elements of its type the plan doesn't name: one
      // of them may be it, so it stays missing, with how to tell.
      const others = (built.changedElements ?? []).filter(
        (e) => e.change !== "deleted" && e.layer === planned.layer && sameType(e, planned) && !claimed.has(e.id)
      );
      if (others.length > 0) {
        missingHints.set(
          planned.id,
          `not found in the build by id or name, and it has no method, path or source reference to find it by; the build has ` +
            `${others.length} unplanned ${planned.layer}.${planned.type} element(s) (${others.slice(0, 5).map((e) => e.id).join(", ")}` +
            `${others.length > 5 ? ", ..." : ""}). If one of them is this one, give the plan's element its http_method and ` +
            "http_path, or its sourceFile and sourceSymbol, and verify again"
        );
        return false;
      }
    }
    const reason = verdict.reason ?? "extraction can't produce it";
    unverifiableIds.set(planned.id, reason);
    report.elements.unverifiable.push({
      planned: planned.id,
      layer: planned.layer,
      type: planned.type,
      name: planned.name,
      op: planned.op,
      reason,
    });
    return true;
  };

  // --- Elements: exact ids first, so a fuzzy match never takes an element another plan entry names.
  const live = plan.elements.filter((e) => e.op !== "delete");
  const deletions = plan.elements.filter((e) => e.op === "delete");

  for (const planned of live) {
    if (builtById.has(planned.id)) {
      claimed.add(planned.id);
      elementMap.set(planned.id, { built: planned.id, match: "exact" });
    }
  }

  const pending = live.filter((e) => !elementMap.has(e.id));
  const ambiguous = new Map<string, string[]>();
  const tiers: Array<{
    test: (planned: VerifyElement, candidate: VerifyElement) => boolean;
    reason: (planned: VerifyElement, candidate: VerifyElement) => string;
  }> = [
    {
      test: (p, c) => p.layer === c.layer && sameType(p, c) && namesMatch(p, c),
      reason: (p, c) =>
        `same layer and type, name matches ignoring case and separators ("${p.name}" ~ "${c.name}")`,
    },
    {
      test: (p, c) => p.layer === c.layer && !sameType(p, c) && namesMatch(p, c),
      reason: (p, c) => `same layer and name, but built as ${c.type} instead of ${p.type}`,
    },
  ];
  if (matchBySource) {
    tiers.push({
      test: (p, c) => p.layer === c.layer && sameType(p, c) && sharesSourceFile(p, c),
      reason: (p, c) => `same layer and type, shares source file ${sharedSourceFiles(p, c).join(", ")}`,
    });
  }

  // A planned add cannot have been built as an element that existed before the plan. With the plan's
  // base index that is exact; without one, an unchanged element with no relationship to the plan's
  // elements is taken to predate it.
  const baseIds = plan.baseElementIds ? new Set(plan.baseElementIds) : undefined;
  const builtNeighbors = new Map<string, Set<string>>();
  for (const rel of built.relationships) {
    for (const [a, b] of [
      [rel.source, rel.target],
      [rel.target, rel.source],
    ]) {
      const set = builtNeighbors.get(a) ?? new Set<string>();
      set.add(b);
      builtNeighbors.set(a, set);
    }
  }
  const planTouched = new Set<string>([
    ...plan.elements.map((e) => e.id),
    ...plan.relationships.flatMap((r) => [r.source, r.target]),
  ]);
  const neighborCache = new Map<string, Set<string>>();
  const plannedNeighbors = (id: string): Set<string> => {
    const cached = neighborCache.get(id);
    if (cached) return cached;
    const own = plan.relationships
      .filter((r) => r.op === "add" && (r.source === id || r.target === id))
      .map((r) => (r.source === id ? r.target : r.source));
    const ids = own.length > 0 ? own : [...planTouched].filter((other) => other !== id);
    const near = new Set(ids.flatMap((other) => [other, elementMap.get(other)?.built ?? other]));
    neighborCache.set(id, near);
    return near;
  };
  let fellBack = false;
  const canBeBuildOf = (planned: PlannedElementChange, candidate: VerifyElement): boolean => {
    if (planned.op !== "add") return true;
    if (baseIds) return !baseIds.has(candidate.id);
    if (changedIds.has(candidate.id)) return true;
    fellBack = true;
    const near = plannedNeighbors(planned.id);
    for (const other of builtNeighbors.get(candidate.id) ?? []) if (near.has(other)) return true;
    return false;
  };

  for (const tier of tiers) {
    for (const planned of pending) {
      if (elementMap.has(planned.id)) continue;
      const candidates = built.elements.filter(
        (c) => !claimed.has(c.id) && tier.test(planned, c) && canBeBuildOf(planned, c)
      );
      if (candidates.length === 0) continue;
      let chosen = candidates;
      if (chosen.length > 1 && changedIds.size > 0) {
        const changed = chosen.filter((c) => changedIds.has(c.id));
        if (changed.length > 0) chosen = changed;
      }
      if (chosen.length === 1) {
        const candidate = chosen[0];
        claimed.add(candidate.id);
        elementMap.set(planned.id, { built: candidate.id, match: "probable", reason: tier.reason(planned, candidate) });
        ambiguous.delete(planned.id);
      } else if (!ambiguous.has(planned.id)) {
        ambiguous.set(
          planned.id,
          chosen.map((c) => c.id)
        );
      }
    }
  }

  if (fellBack) {
    notes.push(
      `No base index was recorded for ${plan.label}, so the elements that existed before it are not known exactly: ` +
        "unchanged elements with no relationship to the plan's elements were not considered as the built form of " +
        "a planned add."
    );
  }

  const lifecycleMoves: string[] = [];
  for (const planned of live) {
    const mapping = elementMap.get(planned.id);
    if (!mapping) {
      if (markUnverifiable(planned)) continue;
      const candidates = ambiguous.get(planned.id);
      report.elements.missing.push({
        planned: planned.id,
        layer: planned.layer,
        type: planned.type,
        name: planned.name,
        op: planned.op,
        reason: candidates
          ? `several built elements could be it (${candidates.length}); none matched uniquely`
          : planned.op === "update"
            ? "the element the plan updates does not exist in the build"
            : (missingHints.get(planned.id) ?? "not found in the build by id, name or source file"),
        ...(candidates ? { candidates } : {}),
      });
      continue;
    }

    const builtElement = builtById.get(mapping.built)!;
    let fields = compareElements(planned, builtElement, planned.op === "update" ? planned.changedFields : undefined);
    const match: ElementMatch = {
      planned: planned.id,
      built: mapping.built,
      op: planned.op,
      match: mapping.match,
      ...(mapping.reason ? { reason: mapping.reason } : {}),
    };

    // Fields extraction never writes, that the build left as they were (or doesn't have): it can't
    // show them either way.
    const unverifiableFields = observability?.field
      ? fields.filter((f) => !observability.field!(planned, f.field) && buildLeft(planned, builtElement, f))
      : [];
    if (unverifiableFields.length > 0) {
      match.unverifiableFields = unverifiableFields;
      fields = fields.filter((f) => !unverifiableFields.includes(f));
    }

    if (planned.op === "update" && planned.changedFields && planned.changedFields.length > 0) {
      const checkable = planned.changedFields.filter((field) => !unverifiableFields.some((u) => u.field === field));
      if (checkable.length === 0) {
        // The element itself was found: only the update can't be shown, so its relationships still count.
        const reason = `extraction doesn't write ${unverifiableFields.map((f) => f.field).join(", ")}`;
        report.elements.unverifiable.push({
          planned: planned.id,
          layer: planned.layer,
          type: planned.type,
          name: planned.name,
          op: planned.op,
          reason,
          fields: unverifiableFields,
        });
        continue;
      }
      const unmet = fields.filter((f) => checkable.includes(f.field));
      // Missing only when the build left every field the plan changes alone. A field the build changed
      // to something else is a divergence, reported below with both values.
      const touched = unmet.some((f) => buildTouched(planned, builtElement, f.field));
      if (unmet.length === checkable.length && !touched) {
        if (markUnverifiable(planned)) continue;
        report.elements.missing.push({
          planned: planned.id,
          layer: planned.layer,
          type: planned.type,
          name: planned.name,
          op: planned.op,
          reason: "the element exists but the build does not carry the planned update",
          fields: unmet,
        });
        continue;
      }
    }

    const lifecycle = fields.filter(isLifecycleMove);
    // A description is prose: it differs from a docstring or extraction's placeholder without the
    // build being wrong. Only a planned update that changes it has it checked.
    const descriptionChecked = planned.op === "update" && (planned.changedFields ?? []).includes("description");
    const informational = fields.filter((f) => f.field === "description" && !descriptionChecked);
    const differences = fields.filter((f) => !isLifecycleMove(f) && !informational.includes(f));
    if (lifecycle.length > 0) {
      match.lifecycle = lifecycle;
      for (const f of lifecycle) {
        lifecycleMoves.push(`${planned.id} ${f.field} ${String(f.planned)} → ${String(f.built)}`);
      }
    }
    if (informational.length > 0) match.notes = informational;
    if (differences.length > 0) report.elements.divergent.push({ ...match, fields: differences });
    else report.elements.matched.push(match);
  }

  if (lifecycleMoves.length > 0) {
    notes.push(
      `Lifecycle progress, not counted as divergence (${LIFECYCLE_FIELDS.join(", ")} moving to a later stage of ` +
        `${LIFECYCLE_STAGES.map((stage) => stage.join("/")).join(" → ")}): ${lifecycleMoves.join("; ")}.`
    );
  }

  const described = [...report.elements.matched, ...report.elements.divergent].filter((m) => m.notes);
  if (described.length > 0) {
    notes.push(
      `${described.length} matched element${described.length === 1 ? " has a description that differs" : "s have descriptions that differ"} ` +
        "from the plan's (under notes on each match). Descriptions are not compared: no need to edit the plan to " +
        "match the build's text."
    );
  }
  const unwritten = [...report.elements.matched, ...report.elements.divergent].filter((m) => m.unverifiableFields);
  if (unwritten.length > 0) {
    notes.push(
      `${unwritten.length} matched element${unwritten.length === 1 ? " has" : "s have"} planned fields extraction ` +
        "doesn't write (under unverifiableFields on each match): check them in the code or the review."
    );
  }

  for (const planned of deletions) {
    const still = builtById.get(planned.id);
    if (still) {
      claimed.add(still.id);
      if (markUnverifiable(planned)) continue;
      report.elements.deletionsNotDone.push({ planned: planned.id, built: still.id });
    } else {
      claimed.add(planned.id);
      report.elements.matched.push({ planned: planned.id, built: planned.id, op: "delete", match: "exact" });
    }
  }

  if (built.changedElements) {
    for (const element of built.changedElements) {
      if (claimed.has(element.id)) continue;
      report.elements.unplanned.push({
        id: element.id,
        layer: element.layer,
        type: element.type,
        name: element.name,
        change: element.change ?? "added",
      });
    }
  }

  // --- Relationships, through the element matches.
  const builtRels = new Map(built.relationships.map((r) => [relKey(r), r]));
  const claimedRels = new Set<string>();
  const mapId = (id: string) => elementMap.get(id)?.built ?? id;
  const probableEndpoints = (rel: VerifyRelationship): string[] =>
    [rel.source, rel.target]
      .filter((id, i, all) => all.indexOf(id) === i)
      .filter((id) => elementMap.get(id)?.match === "probable")
      .map((id) => `${id} → ${elementMap.get(id)!.built}`);
  const missingEndpoints = new Set(report.elements.missing.map((m) => m.planned));

  // A planned relationship extraction can't produce: an end it can't see, or no mapped code edge.
  const plannedById = new Map(plan.elements.map((e) => [e.id, e]));
  // The element as built when it was found (extraction's source symbols), else as planned.
  const elementOf = (id: string): VerifyElement =>
    builtById.get(elementMap.get(id)?.built ?? "") ?? plannedById.get(id) ?? builtById.get(id) ?? fromId(id, "");
  const unverifiableReason = (rel: VerifyRelationship): string | undefined => {
    if (!observability) return undefined;
    for (const end of [rel.source, rel.target]) {
      const known = unverifiableIds.get(end);
      if (known !== undefined) return `${end} is unverifiable (${known})`;
      if (missingHints.has(end)) continue; // reported missing: its relationships are too
      const verdict = observability.element(elementOf(end));
      if (!verdict.observable) return `extraction can't see ${end}: ${verdict.reason ?? "no rule produces it"}`;
    }
    const verdict = observability.relationship(elementOf(rel.source), rel.predicate, elementOf(rel.target));
    return verdict.observable ? undefined : (verdict.reason ?? "no mapped code edge produces it");
  };
  const pushUnverifiable = (planned: PlannedRelationshipChange): boolean => {
    const reason = unverifiableReason(planned);
    if (reason === undefined) return false;
    report.relationships.unverifiable.push({ planned: strip(planned), op: planned.op, reason });
    return true;
  };

  const mapRel = (planned: PlannedRelationshipChange): VerifyRelationship => ({
    source: mapId(planned.source),
    predicate: planned.predicate,
    target: mapId(planned.target),
  });
  const matchInfoFor = (planned: PlannedRelationshipChange) => {
    const probable = probableEndpoints(planned);
    return probable.length > 0
      ? { match: "probable" as const, reason: `through probable element match: ${probable.join("; ")}` }
      : { match: "exact" as const };
  };

  // Pass 1: exact (source, predicate, target) hits, so the fallback below can never take a built
  // relationship that another planned relationship matches exactly.
  const unresolved: PlannedRelationshipChange[] = [];
  for (const planned of plan.relationships) {
    const mapped = mapRel(planned);
    const found = builtRels.get(relKey(mapped));
    if (!found || claimedRels.has(relKey(found))) {
      unresolved.push(planned);
      continue;
    }
    claimedRels.add(relKey(found));
    const plannedRef = strip(planned);
    if (planned.op === "delete") {
      if (pushUnverifiable(planned)) continue;
      report.relationships.deletionsNotDone.push({ planned: plannedRef, built: strip(found) });
    } else {
      report.relationships.matched.push({ planned: plannedRef, built: strip(found), op: "add", ...matchInfoFor(planned) });
    }
  }

  // Elements the plan adds, as built: a relationship touching one cannot predate the change.
  const addedBuiltIds = new Set(
    live.filter((e) => e.op === "add" && elementMap.has(e.id)).map((e) => elementMap.get(e.id)!.built)
  );

  // Pass 2: everything without an exact hit.
  for (const planned of unresolved) {
    const mapped = mapRel(planned);
    const plannedRef = strip(planned);
    const matchInfo = matchInfoFor(planned);

    if (planned.op === "delete") {
      claimedRels.add(relKey(mapped));
      report.relationships.matched.push({ planned: plannedRef, built: mapped, op: "delete", ...matchInfo });
      continue;
    }

    // Same endpoints, another predicate; or the same predicate the other way round.
    // Prefer what the build changed: an untouched base relationship is not the build's version of this one.
    const isAlternative = (r: VerifyRelationship) =>
      !claimedRels.has(relKey(r)) &&
      ((r.source === mapped.source && r.target === mapped.target && r.predicate !== mapped.predicate) ||
        (r.source === mapped.target && r.target === mapped.source && r.predicate === mapped.predicate));
    const alternative = built.changedRelationships
      ? built.changedRelationships.filter((r) => r.change !== "deleted").find(isAlternative)
      : // What the build changed is not known: only a relationship touching an element the plan adds
        // can be the build's version; one between pre-existing elements may simply predate the change.
        built.relationships.find(
          (r) => isAlternative(r) && (addedBuiltIds.has(r.source) || addedBuiltIds.has(r.target))
        );
    if (alternative) {
      claimedRels.add(relKey(alternative));
      const fields: FieldDifference[] =
        alternative.predicate !== mapped.predicate
          ? [{ field: "predicate", planned: mapped.predicate, built: alternative.predicate }]
          : [
              {
                field: "direction",
                planned: `${mapped.source} → ${mapped.target}`,
                built: `${alternative.source} → ${alternative.target}`,
              },
            ];
      report.relationships.divergent.push({
        planned: plannedRef,
        built: strip(alternative),
        op: "add",
        ...matchInfo,
        fields,
      });
      continue;
    }

    if (pushUnverifiable(planned)) continue;

    // Near matches that may predate the change: listed, not claimed.
    const candidates = built.changedRelationships ? [] : built.relationships.filter(isAlternative).map(strip);
    const absent = [planned.source, planned.target].filter(
      (id) => missingEndpoints.has(id) || (!elementMap.has(id) && !builtById.has(id))
    );
    report.relationships.missing.push({
      planned: plannedRef,
      reason:
        absent.length > 0
          ? `not built; endpoint${absent.length > 1 ? "s" : ""} ${absent.join(", ")} not found in the build`
          : candidates.length > 0
            ? "not found in the build; a relationship between the same elements exists, but it may predate the change"
            : "not found in the build",
      ...(candidates.length > 0 ? { candidates } : {}),
    });
  }

  if (built.changedRelationships) {
    for (const rel of built.changedRelationships) {
      if (claimedRels.has(relKey(rel))) continue;
      report.relationships.unplanned.push({ ...strip(rel), change: rel.change ?? "added" });
    }
  } else {
    // Base model: relationships the build gave the elements this plan adds, beyond the plan's own.
    for (const rel of built.relationships) {
      if (claimedRels.has(relKey(rel))) continue;
      if (addedBuiltIds.has(rel.source) || addedBuiltIds.has(rel.target)) {
        report.relationships.unplanned.push({ ...strip(rel), change: "present" });
      }
    }
  }

  report.summary.elements = countCategories(plan.elements.length, report.elements);
  report.summary.relationships = countCategories(plan.relationships.length, report.relationships);
  const { verdict, text } = decideVerdict(report);
  report.verdict = verdict;
  report.verdictText = text;
  return report;
}

/**
 * Verifies a planned changeset against an as-built changeset or the base model of `model`.
 * Used by the `changeset_verify` MCP tool and `dr changeset verify`.
 */
export async function verifyChangesetInModel(
  model: Model,
  options: {
    planned: Changeset;
    /** With `extracted`, the base holds a landed extraction of the build: apply the extraction rule. */
    against: { changeset: Changeset } | { base: true; extracted?: boolean };
    matchBySource?: boolean;
    /** The analyzer whose extraction wrote the as-built side (default: the project's, else cbm). */
    analyzer?: string;
    /** For tests: the extraction coverage to use instead of the analyzer's bundled mapping. */
    coverage?: ExtractionCoverage | null;
  }
): Promise<VerifyReport & { plannedChangeset: { id: string; name: string } }> {
  const { planned } = options;
  const plan = await planFromModel(model, planned);
  const notes: string[] = [];
  const baseIndex = await tryReadBaseIndex(model.rootPath, planned.id);
  if (baseIndex.index) plan.baseElementIds = Object.keys(baseIndex.index.elements);
  if (baseIndex.warning) notes.push(baseIndex.warning);

  let built: BuiltSide;
  let extraction: VerifyExtraction;
  let observability: ObservabilityCheck | undefined;
  let warning: string | undefined;
  if ("changeset" in options.against) {
    const asBuilt = options.against.changeset;
    if (asBuilt.id === planned.id) {
      notes.push("The planned and as-built changesets are the same changeset, so everything matches by definition.");
    }
    built = builtFromGraph(await ChangesetGraph.build(model, asBuilt), `${asBuilt.name} (${asBuilt.id})`);
    // Where the as-built side came from is read from codebase_extract's own record of the
    // changeset, never from the provenance its elements declare or its description.
    const record = await readExtractionRecord(model.rootPath, { id: asBuilt.id!, name: asBuilt.name }, currentGitHead(model.codebaseRoot));
    if (!record) {
      extraction = {
        applied: false,
        reason:
          "codebase_extract has no record of the as-built changeset (.dr/analyzers/extract/), so it is not taken as " +
          "extraction output: every planned change is checked, and its elements count as added by hand, whatever " +
          "provenance they declare.",
        asBuilt: asBuiltShare(built, plan, { record: null }),
      };
      if (EXTRACTION_MARKER.test(asBuilt.description ?? "")) {
        notes.push(
          "The as-built changeset's description says codebase_extract staged it, but its record is gone. Run " +
            "codebase_extract on it again (with the same since) to record what it stages, then verify again."
        );
      }
    } else {
      const codeFiles = [...new Set((built.changedElements ?? []).flatMap((e) => sourceFiles(e)))];
      const rule = await extractionRule(model, options, codeFiles, "The as-built changeset came from codebase_extract");
      ({ extraction, observability } = rule);
      const share = asBuiltShare(built, plan, { record, ...(observability ? { observe: (e) => observability!.element(e) } : {}) });
      extraction.asBuilt = share;
      if (record.readAt) {
        notes.push(
          `The extraction record is from a run that staged nothing, at ${record.readAt.slice(0, 7)}; the code has moved ` +
            "since (a commit after the extract). Its cards still name what extraction offered then; run codebase_extract " +
            "on this changeset again if the code changed since."
        );
      }
      if (share.copiedFromPlan?.length) {
        notes.push(
          `${share.copiedFromPlan.length} as-built element(s) share an id with the plan's adds but did not come from ` +
            `extraction (${share.copiedFromPlan.join(", ")}). If they were copied from the plan, their match says ` +
            "nothing about the code; extract again with codebase_extract and leave them out."
        );
      }
    }
    warning = asBuiltWarning(extraction.asBuilt!, extraction.applied);
  } else {
    built = await builtFromBase(model);
    if (planned.status === "staged") {
      notes.push(
        "The planned changeset is still staged, so its own changes are not in the base model: anything " +
          "reported missing is missing from what was committed to the base (e.g. an as-built changeset)."
      );
    }
    if (options.against.extracted) {
      ({ extraction, observability } = await extractionRule(
        model,
        options,
        [],
        "Compared with the base model, which holds a landed extraction (extracted: true)"
      ));
    } else {
      extraction = {
        applied: false,
        reason:
          "Compared with the base model: every planned change is checked. Pass extracted: true when the base holds " +
          "a landed extraction of the build.",
      };
    }
  }

  const report = verifyChangeset(plan, built, { matchBySource: options.matchBySource, observability });
  report.extraction = extraction;
  report.notes.push(...notes);
  const share = extraction.asBuilt;
  if (share) {
    // Matches against elements extraction didn't stage are no evidence; ones it staged and the agent
    // then edited carry the edits.
    const agentIds = new Set((share.agentAdded ?? []).map((a) => a.id));
    const edits = new Map((share.editedAfterExtraction ?? []).map((e) => [e.id, e.edits]));
    const matches = [...report.elements.matched, ...report.elements.divergent];
    // An element edited after extraction is no evidence either: treated as the agent's.
    const onEdited = matches.filter((m) => edits.has(m.built));
    for (const m of onEdited) m.editedAfterExtraction = edits.get(m.built);
    const onAgent = matches.filter((m) => agentIds.has(m.built) || edits.has(m.built));
    for (const m of onAgent) m.builtByAgent = true;
    if (onEdited.length > 0) {
      report.notes.push(
        `${onEdited.length} match(es) are against extracted elements changed after extraction staged them ` +
          "(editedAfterExtraction on each): the match shows the edit, not the code."
      );
    }
    if (warning) {
      report.warning = warning;
      report.verdictText += ` But ${warning.charAt(0).toLowerCase()}${warning.slice(1)}`;
    }
    if (onAgent.length > 0 && share.record !== "not-found") {
      // Against extraction, a match that rests on elements it didn't stage, or that were edited after
      // it, is not clean. (Without a record the comparison isn't against extraction at all: the
      // extraction note and the warning say so.)
      if (report.verdict === "match") report.verdict = "probable-match";
      report.verdictText +=
        ` ${onAgent.length} of the matches ${onAgent.length === 1 ? "rests" : "rest"} on elements extraction didn't stage` +
        (onEdited.length > 0 ? ` or that were edited after it (${onEdited.length})` : "") +
        " (builtByAgent): confirm them in the code.";
    }
  }
  await addAcceptedGapsCheck(model, planned, built, report);
  return { plannedChangeset: { id: planned.id, name: planned.name }, ...report };
}

/**
 * Reports the plan's accepted gaps the build contradicts, like a divergent element: a match is
 * no longer one (see accepted-gaps-verify.ts).
 */
async function addAcceptedGapsCheck(model: Model, planned: Changeset, built: BuiltSide, report: VerifyReport): Promise<void> {
  const counterpart = new Map([...report.elements.matched, ...report.elements.divergent].map((m) => [m.planned, m.built]));
  const check = checkPlanAcceptedGaps(await ChangesetGraph.build(model, planned), built, counterpart);
  if (check.checked === 0) return;
  report.acceptedGaps = check;
  const n = check.contradicted.length;
  if (n === 0) return;
  report.notes.push(
    `${n} accepted gap(s) in the plan are contradicted by the build (acceptedGaps.contradicted): the build has a ` +
      "relationship the plan decided was deliberately absent. Either the decision is stale (gap_reopen it in the plan) " +
      "or the code drifted from the plan."
  );
  if (report.verdict === "match" || report.verdict === "probable-match") report.verdict = "diverges";
  report.verdictText += ` The build contradicts ${n} accepted gap${n === 1 ? "" : "s"} in the plan (acceptedGaps.contradicted).`;
}

/** The extraction rule for a built side that came from extraction, from the analyzer's mapping. */
async function extractionRule(
  model: Model,
  options: { analyzer?: string; coverage?: ExtractionCoverage | null },
  codeFiles: string[],
  why: string
): Promise<{ extraction: VerifyExtraction; observability?: ObservabilityCheck }> {
  const analyzer = options.analyzer ?? (await resolveAnalyzerName(model.rootPath).catch(() => "cbm"));
  const coverage = options.coverage !== undefined ? options.coverage : await loadExtractionCoverage(analyzer);
  if (!coverage) {
    return {
      extraction: {
        applied: false,
        reason: `${why}, but the ${analyzer} mapping could not be read, so extraction's blind spots are not known: every planned change is checked.`,
        analyzer,
      },
    };
  }
  return {
    observability: {
      element: (element) => coverage.element(element, codeFiles),
      relationship: (source, predicate, target) => coverage.relationship(source, predicate, target),
      field: (element, field) => coverage.field(element, field),
    },
    extraction: {
      applied: true,
      reason:
        `${why}: planned changes extraction can't produce (intent, types or files no rule covers, relationships no ` +
        "code edge maps to, fields it doesn't write) are unverifiable, not missing.",
      analyzer: coverage.analyzer,
      observableTypes: coverage.observableTypes(),
    },
  };
}

/** The description codebase_extract gives the changesets it creates. */
const EXTRACTION_MARKER = /Staged by codebase_extract/;

/**
 * Where an as-built changeset's elements and relationships came from (see AsBuiltShare).
 *
 * Only extraction's record counts, never the provenance an element declares:
 * - an add, when extraction staged its id, or its file and symbol are one of the run's staged
 *   symbols, cards or earlier cards, and extraction can produce it there (the card's candidates, or
 *   for an open card the file-aware coverage check). One that would match a planned add by id or
 *   name must also be named after its symbol, not after the plan's element. An extracted add whose
 *   name or attributes differ from what extraction staged is listed in `editedAfterExtraction`;
 * - an update, when the record's `updated` lists its id;
 * - a delete, when it is one of the record's candidate deletes.
 * Without a record, nothing counts.
 */
export function asBuiltShare(
  built: BuiltSide,
  plan?: Plan,
  context: {
    record?: ExtractionRecord | null;
    /** What extraction can produce, for elements of open cards (file-aware). */
    observe?: (element: VerifyElement) => { observable: boolean; reason?: string };
  } = {}
): AsBuiltShare {
  const record = context.record ?? null;
  const changed = built.changedElements ?? [];
  const planAdds = (plan?.elements ?? []).filter((e) => e.op === "add");
  const plannedAdds = new Set(planAdds.map((e) => e.id));
  const plannedNames = new Set(planAdds.flatMap((e) => [...nameKeys(e)]));
  const stagedById = new Map((record?.staged ?? []).map((e) => [e.id, e]));
  const updatedById = new Map((record?.updated ?? []).map((u) => [u.id, u]));
  const candidateDeletes = new Set(record?.candidateDeletes ?? []);
  // Each symbol extraction offered (staged, or as a card now or earlier), by file and symbol.
  const offered = new Map<string, OfferedSymbol[]>();
  for (const entry of [...(record?.staged ?? []), ...(record?.cards ?? []), ...(record?.earlierCards ?? [])]) {
    const key = decisionKey(entry.file, entry.symbol);
    offered.set(key, [...(offered.get(key) ?? []), entry]);
  }

  const notFromExtraction = (e: BuiltElement): string | undefined => {
    if (!record) return "no codebase_extract record of this changeset confirms it";
    if (e.change === "deleted") return candidateDeletes.has(e.id) ? undefined : "a delete that is not one of extraction's candidate deletes";
    if (e.change === "updated") return updatedById.has(e.id) ? undefined : "an update extraction did not stage";
    const type = `${e.layer}.${e.type}`;
    // Where an element could be taken for the plan's, its name must come from the code.
    const looksPlanned = plannedAdds.has(e.id) || [...nameKeys(e)].some((k) => plannedNames.has(k));
    const staged = stagedById.get(e.id);
    const located = (e.sourceReference?.locations ?? []).filter((l) => typeof l?.symbol === "string" && l.symbol.length > 0);
    const cards = located.flatMap((l) => offered.get(decisionKey(normalizeFile(l.file), l.symbol!)) ?? []);
    if (!staged && cards.length === 0) {
      const verdict = context.observe?.(e);
      if (verdict && !verdict.observable) return `extraction can't produce it: ${verdict.reason ?? type}`;
      return located.length === 0
        ? "extraction did not stage it, and it names no source symbol"
        : "extraction did not stage it, and no card of its runs has its file and symbol";
    }
    // The type: one its card allows. A card with no candidates is open, and one recorded without
    // them (an older record's earlier card) is unknown: either way only the file-aware check of
    // what extraction can produce there applies, as it does to a staged element.
    const producible = context.observe ? context.observe(e) : { observable: true };
    const allowed = (c: OfferedSymbol): boolean =>
      c.candidates?.length ? c.candidates.some((t) => t === type || t === `${e.layer}.*`) : producible.observable;
    const fitting = cards.filter(allowed);
    const withCandidates = cards.filter((c) => c.candidates?.length);
    if (withCandidates.length > 0 && !withCandidates.some(allowed)) {
      return `its card allows ${[...new Set(withCandidates.flatMap((c) => c.candidates!))].join(", ")}, not ${type}`;
    }
    if (!producible.observable && withCandidates.length === 0) {
      return `extraction can't produce it ${staged ? "there" : "from its card"}: ${producible.reason ?? type}`;
    }
    if (!looksPlanned) return undefined;
    if ((staged && namedAfterCard(e, staged)) || fitting.some((c) => namedAfterCard(e, c))) return undefined;
    return staged ? "named after the plan's element, not after the symbol extraction staged it from" : "named after the plan's element, not after its card";
  };

  const byProvenance: Record<string, number> = {};
  const extracted = new Set<string>();
  const agentAdded: NonNullable<AsBuiltShare["agentAdded"]> = [];
  const edited: NonNullable<AsBuiltShare["editedAfterExtraction"]> = [];
  for (const e of changed) {
    // What the changeset staged, not the merged element: an update that kept the base's source
    // reference is counted apart, whatever that reference says.
    const declared =
      e.change === "deleted"
        ? "deleted"
        : (e.stagedProvenance ?? (e.change === "updated" ? "sourceUnchanged" : (e.sourceReference?.provenance ?? "none")));
    byProvenance[declared] = (byProvenance[declared] ?? 0) + 1;
    const reason = notFromExtraction(e);
    if (reason !== undefined) {
      agentAdded.push({ id: e.id, declared, reason });
      continue;
    }
    extracted.add(e.id);
    const edits = editsAfterExtraction(e, stagedById.get(e.id), updatedById.get(e.id));
    if (edits.length > 0) edited.push({ id: e.id, edits });
  }

  const relationships = (built.changedRelationships ?? []).filter((r) => r.change !== "deleted");
  const betweenExtracted = relationships.filter((r) => extracted.has(r.source) && extracted.has(r.target)).length;
  const addedIds = new Set(changed.filter((e) => e.change === "added").map((e) => e.id));
  const copied = agentAdded.filter((a) => plannedAdds.has(a.id) && addedIds.has(a.id)).map((a) => a.id);
  return {
    elements: { total: changed.length, byProvenance, fromExtraction: extracted.size, agentAdded: agentAdded.length },
    relationships: { total: relationships.length, betweenExtracted, other: relationships.length - betweenExtracted },
    record: record ? (record.source === "pending" ? "pending" : "found") : "not-found",
    ...(agentAdded.length > 0 ? { agentAdded } : {}),
    ...(edited.length > 0 ? { editedAfterExtraction: edited } : {}),
    ...(copied.length > 0 ? { copiedFromPlan: copied } : {}),
  };
}

/** A field's value as the record keys it: verify's names, plus `source_reference`. */
function recordFieldValue(element: VerifyElement, field: string): unknown {
  return field === "source_reference" ? (element.sourceReference ?? null) : fieldValue(element, field);
}

function sameRecordValue(field: string, a: unknown, b: unknown): boolean {
  if (field !== "source_reference") return sameFieldValue(field, a, b);
  // By where it points (file and symbol), whatever else either shape carries.
  const where = (v: unknown): string[] => {
    const locations = (v as { locations?: Array<{ file?: unknown; symbol?: unknown }> } | null)?.locations;
    return Array.isArray(locations) ? locations.map((l) => `${String(l?.file ?? "")}#${String(l?.symbol ?? "")}`).sort() : [];
  };
  return sameValue(where(a), where(b));
}

/**
 * What changed in an extracted element after extraction staged it.
 *
 * - An update: each field it changes from the base that the record's `updated` entry doesn't list
 *   (extraction didn't change it), and each listed field whose value differs from the one extraction
 *   wrote (`values`, when recorded).
 * - An add: the name and attributes against what extraction staged; a field extraction later
 *   updated on it (folded into the add) against the value it wrote, when recorded.
 */
function editsAfterExtraction(
  e: BuiltElement,
  staged: { name?: string; attributes?: Record<string, unknown> } | undefined,
  own: ExtractionRecord["updated"][number] | undefined
): ExtractionEdit[] {
  const edits: ExtractionEdit[] = [];
  const values = own?.values && typeof own.values === "object" ? own.values : undefined;
  const byValue = (field: string): ExtractionEdit | undefined => {
    if (!values || !Object.hasOwn(values, field)) return undefined;
    const now = recordFieldValue(e, field);
    return sameRecordValue(field, values[field], now) ? undefined : { field, extracted: values[field] ?? null, now: now ?? null };
  };
  if (e.change === "updated") {
    if (!own) return edits;
    for (const [field, was] of Object.entries(e.updatedFrom ?? {})) {
      if (own.fields && !own.fields.includes(field)) edits.push({ field, extracted: was ?? null, now: recordFieldValue(e, field) ?? null });
    }
    for (const field of own.fields ?? []) {
      const edit = byValue(field);
      if (edit) edits.push(edit);
    }
    return edits;
  }
  if (e.change !== "added") return edits;
  const folded = new Set(own?.fields ?? []);
  if (staged) {
    // Fields extraction itself updated on this add are checked against what it wrote instead.
    edits.push(...editsSinceExtraction(e, staged).filter((d) => !folded.has(d.field) && !(own && !own.fields)));
  }
  for (const field of folded) {
    const edit = byValue(field);
    if (edit) edits.push(edit);
  }
  return edits;
}

/**
 * The name and attributes of an extracted add that differ from what extraction staged. A record
 * entry with a name leaves `attributes` out when there were none; one without a name (an older
 * record) says nothing about either.
 */
function editsSinceExtraction(element: VerifyElement, staged: { name?: string; attributes?: Record<string, unknown> }): ExtractionEdit[] {
  const edits: ExtractionEdit[] = [];
  if (typeof staged.name !== "string") return edits;
  if (staged.name !== element.name) edits.push({ field: "name", extracted: staged.name, now: element.name });
  const stagedAttributes = staged.attributes && typeof staged.attributes === "object" ? staged.attributes : {};
  {
    const keys = new Set([...Object.keys(stagedAttributes), ...Object.keys(element.attributes ?? {})]);
    for (const key of [...keys].sort()) {
      const was = stagedAttributes[key];
      const now = element.attributes?.[key];
      if (!sameValue(was, now)) edits.push({ field: `attributes.${key}`, extracted: was ?? null, now: now ?? null });
    }
  }
  return edits;
}

/**
 * Whether an element is named after a card or staged symbol: the symbol (with or without its class
 * or module path), the card's name or proposal, a module's file, or for a route the same method and
 * path whatever its parameters are called (`GET /owners/{}` is `GET /owners/{ownerId}`).
 */
function namedAfterCard(element: VerifyElement, card: OfferedSymbol): boolean {
  if (card.proposed?.id && card.proposed.id === element.id) return true;
  const route = routeKey(card.symbol) ?? (card.name ? routeKey(card.name) : undefined);
  if (route && routeKey(element.name) === route) return true;
  const keys = nameKeys(element);
  const parts = card.symbol.split(/[.#/\s]+/).filter(Boolean);
  const file = card.file ?? "";
  const names = [card.symbol, card.name, card.proposed?.name, parts[parts.length - 1], file, file.replace(/\.[^./]+$/, "")];
  return names.some((n) => typeof n === "string" && n.length > 0 && keys.has(normalizeName(n)));
}

function normalizeFile(file: string | undefined): string | null {
  return typeof file === "string" && file.length > 0 ? file.replace(/\\/g, "/").replace(/^\.\//, "") : null;
}

/** The warning for an as-built side mostly not from extraction: more than half its elements. */
export function asBuiltWarning(share: AsBuiltShare, blindSpotsApplied = true): string | undefined {
  const { total, agentAdded } = share.elements;
  const edited = share.editedAfterExtraction?.length ?? 0;
  if (total === 0 || (agentAdded + edited) * 2 <= total) return undefined;
  const copied = share.copiedFromPlan?.length ?? 0;
  return (
    `${agentAdded + edited} of the ${total} as-built elements were not staged by extraction` +
    (edited > 0 ? ` or were edited after it (${edited})` : "") +
    (copied > 0 ? ` (${copied} share an id with the plan's adds)` : "") +
    ", so this comparison says little about the code." +
    (blindSpotsApplied
      ? " Extraction's blind spots were still applied."
      : share.record === "not-found"
        ? " No extraction record covers this changeset, so extraction's blind spots were not applied."
        : " Extraction's blind spots were not applied.") +
    " To verify the " +
    "code, discard this changeset and stage the build with codebase_extract: from its cards, named after them " +
    "(see extraction.asBuilt.agentAdded for why each one doesn't count)."
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lowercase with every non-alphanumeric removed: "Export Orders", "export-orders", "exportOrders" → "exportorders". */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function nameKeys(element: VerifyElement): Set<string> {
  const keys = new Set<string>();
  if (element.name) keys.add(normalizeName(element.name));
  const segment = idNameSegment(element.id);
  if (segment) keys.add(normalizeName(segment));
  keys.delete("");
  return keys;
}

function namesMatch(a: VerifyElement, b: VerifyElement): boolean {
  const keys = nameKeys(b);
  for (const key of nameKeys(a)) if (keys.has(key)) return true;
  return false;
}

function sameType(a: VerifyElement, b: VerifyElement): boolean {
  return normalizeName(a.type) === normalizeName(b.type);
}

function sourceFiles(element: VerifyElement): string[] {
  return (element.sourceReference?.locations ?? [])
    .map((l) => (typeof l?.file === "string" ? l.file.replace(/^\.\//, "").replace(/\\/g, "/") : ""))
    .filter((f) => f.length > 0);
}

function sharedSourceFiles(a: VerifyElement, b: VerifyElement): string[] {
  const files = new Set(sourceFiles(b));
  return sourceFiles(a).filter((f) => files.has(f));
}

function sharesSourceFile(a: VerifyElement, b: VerifyElement): boolean {
  return sharedSourceFiles(a, b).length > 0;
}

/**
 * Fields where the built element differs from what the plan states. Only what the plan states is
 * compared: a description or attribute the build adds beyond the plan is not a divergence. The
 * exception is `removedBy`: fields a planned update changes that the planned record no longer has
 * (an attribute removed, a description cleared). The build must not have them either.
 */
function compareElements(planned: VerifyElement, built: VerifyElement, removedBy?: string[]): FieldDifference[] {
  const fields: FieldDifference[] = [];
  if (planned.type && !sameType(planned, built)) {
    fields.push({ field: "type", planned: planned.type, built: built.type });
  }
  if (planned.name && normalizeName(planned.name) !== normalizeName(built.name)) {
    fields.push({ field: "name", planned: planned.name, built: built.name });
  }
  if (planned.description !== undefined && planned.description.trim() !== (built.description ?? "").trim()) {
    fields.push({ field: "description", planned: planned.description, built: built.description });
  }
  for (const [key, value] of Object.entries(planned.attributes ?? {})) {
    const builtValue = built.attributes?.[key];
    if (!sameAttribute(key, value, builtValue)) {
      fields.push({ field: `attributes.${key}`, planned: value, built: builtValue });
    }
  }
  for (const field of removedBy ?? []) {
    if (field === "description") {
      if (planned.description === undefined && (built.description ?? "").trim() !== "") {
        fields.push({ field, planned: undefined, built: built.description });
      }
    } else if (field.startsWith("attributes.")) {
      const key = field.slice("attributes.".length);
      const plannedHas = planned.attributes !== undefined && Object.hasOwn(planned.attributes, key);
      if (!plannedHas && built.attributes?.[key] !== undefined) {
        fields.push({ field, planned: undefined, built: built.attributes[key] });
      }
    }
  }
  // Both sides always, null where a side has no value, so "absent" reads differently from "same".
  return fields.map((f) => ({ field: f.field, planned: f.planned ?? null, built: f.built ?? null }));
}

/** A field's value on an element, by the names `compareElements` and `changedFields` use. */
function fieldValue(element: VerifyElement, field: string): unknown {
  if (field === "type") return element.type;
  if (field === "name") return element.name;
  if (field === "description") return element.description;
  if (field.startsWith("attributes.")) return element.attributes?.[field.slice("attributes.".length)];
  return undefined;
}

function sameFieldValue(field: string, a: unknown, b: unknown): boolean {
  if (field === "type" || field === "name") {
    return normalizeName(String(a ?? "")) === normalizeName(String(b ?? ""));
  }
  if (field === "description") return String(a ?? "").trim() === String(b ?? "").trim();
  if (field.startsWith("attributes.")) return sameAttribute(field.slice("attributes.".length), a, b);
  return sameValue(a, b);
}

/** A path with its parameters as `{}` (`{ownerId}`, `:ownerId`, `{}`) and no trailing slash. */
function normalizeHttpPath(p: string): string {
  return p.replace(/\{[^}]*\}|:[A-Za-z_]\w*/g, "{}").replace(/\/+$/, "") || "/";
}

/**
 * A route's method and normalized path, from `GET /owners/{ownerId}` or CBM's
 * `__route__GET__/owners/{ownerId}`; undefined for anything else.
 */
function routeKey(text: string): string | undefined {
  const m = /^__route__([A-Z]+)__(\/\S*)$/.exec(text.trim()) ?? /^([A-Z]+)\s+(\/\S*)$/.exec(text.trim());
  return m ? `${m[1]} ${normalizeHttpPath(m[2])}` : undefined;
}

/**
 * Attribute equality. An operation's path matches whatever its parameters are named, and its
 * method ignores case, as extraction compares them (`sameFact` in extraction-plan.ts).
 */
function sameAttribute(key: string, a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") {
    if (key === "http_path") return normalizeHttpPath(a) === normalizeHttpPath(b);
    if (key === "http_method") return a.toUpperCase() === b.toUpperCase();
  }
  return sameValue(a, b);
}

/**
 * Whether the build left a differing field as it was before the plan, or doesn't have it: what a
 * build from extraction looks like for a field extraction never writes.
 */
function buildLeft(planned: PlannedElementChange, built: BuiltElement, difference: FieldDifference): boolean {
  if (difference.built === null) return true;
  if (planned.op !== "update") return false;
  if (planned.baseValues && Object.hasOwn(planned.baseValues, difference.field)) {
    return sameFieldValue(difference.field, fieldValue(built, difference.field), planned.baseValues[difference.field]);
  }
  return built.change !== "updated" && built.change !== "added";
}

/**
 * Whether the build changed `field` from what it was before the plan. Uses the plan's recorded base
 * value; without one, falls back to whether the build changed the element at all (unknown against
 * the base model, where it counts as untouched).
 */
function buildTouched(planned: PlannedElementChange, built: BuiltElement, field: string): boolean {
  if (planned.baseValues && Object.hasOwn(planned.baseValues, field)) {
    return !sameFieldValue(field, fieldValue(built, field), planned.baseValues[field]);
  }
  return built.change === "updated" || built.change === "added";
}

function changedFields(before: VerifyElement, after: VerifyElement): string[] {
  const fields: string[] = [];
  if (before.type !== after.type) fields.push("type");
  if (before.name !== after.name) fields.push("name");
  if ((before.description ?? "") !== (after.description ?? "")) fields.push("description");
  const keys = new Set([...Object.keys(before.attributes ?? {}), ...Object.keys(after.attributes ?? {})]);
  for (const key of keys) {
    if (!sameValue(before.attributes?.[key], after.attributes?.[key])) fields.push(`attributes.${key}`);
  }
  return fields;
}

function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

function relKey(rel: VerifyRelationship): string {
  return `${rel.source}::${rel.predicate}::${rel.target}`;
}

function strip(rel: VerifyRelationship): VerifyRelationship {
  return { source: rel.source, predicate: rel.predicate, target: rel.target };
}

function readRelationship(change: StagedChange, resolve: (id: string) => string): VerifyRelationship | null {
  const data = (change.type === "relationship-delete" ? (change.before ?? change.after) : change.after) as
    | Partial<GraphRelationship>
    | undefined;
  const [source, predicate, target] =
    data?.source && data.predicate && data.target
      ? [data.source, data.predicate, data.target]
      : change.elementId.split("::");
  if (!source || !predicate || !target) return null;
  return { source: resolve(source), predicate, target: resolve(target) };
}

function idNameSegment(id: string): string | undefined {
  const parts = id.split(".");
  return parts.length >= 3 ? parts.slice(2).join(".") : undefined;
}

function fromId(id: string, layerName: string): VerifyElement {
  const parts = id.split(".");
  return {
    id,
    layer: parts.length >= 3 ? parts[0] : layerName,
    type: parts.length >= 3 ? parts[1] : "",
    name: idNameSegment(id) ?? id,
    attributes: {},
  };
}

function fromGraphElement(element: GraphElement): VerifyElement {
  return {
    id: element.id,
    layer: element.layer,
    type: element.type,
    name: element.name,
    ...(element.description !== undefined ? { description: element.description } : {}),
    attributes: element.attributes ?? {},
    ...(element.sourceReference ? { sourceReference: element.sourceReference } : {}),
  };
}

function toVerifyElement(record: Record<string, unknown>, layerName: string, id: string): VerifyElement {
  const str = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;
  const fallback = fromId(id, layerName);
  return {
    id,
    layer: str(record.layer_id) ?? str(record.layer) ?? fallback.layer,
    type: str(record.type) ?? fallback.type,
    name: str(record.name) ?? fallback.name,
    ...(str(record.description) !== undefined ? { description: str(record.description) } : {}),
    attributes:
      record.attributes && typeof record.attributes === "object"
        ? (record.attributes as Record<string, unknown>)
        : {},
    ...(stagedSourceReference(record) ? { sourceReference: stagedSourceReference(record) } : {}),
  };
}

function emptyCounts(): CategoryCounts {
  return { planned: 0, matched: 0, probable: 0, missing: 0, divergent: 0, unplanned: 0, deletionsNotDone: 0, unverifiable: 0 };
}

function countCategories(
  planned: number,
  section: {
    matched: Array<{ match: MatchKind }>;
    divergent: Array<{ match: MatchKind }>;
    missing: unknown[];
    unverifiable: unknown[];
    unplanned: unknown[];
    deletionsNotDone: unknown[];
  }
): CategoryCounts {
  return {
    planned,
    matched: section.matched.length + section.divergent.length,
    probable: [...section.matched, ...section.divergent].filter((m) => m.match === "probable").length,
    missing: section.missing.length,
    divergent: section.divergent.length,
    unplanned: section.unplanned.length,
    deletionsNotDone: section.deletionsNotDone.length,
    unverifiable: section.unverifiable.length,
  };
}

function decideVerdict(report: VerifyReport): { verdict: Verdict; text: string } {
  const e = report.summary.elements;
  const r = report.summary.relationships;
  if (e.planned === 0 && r.planned === 0) {
    return { verdict: "empty-plan", text: "The plan has no changes to verify." };
  }

  const parts: string[] = [];
  const say = (n: number, what: string) => {
    if (n > 0) parts.push(`${n} ${what}`);
  };
  say(e.missing, plural(e.missing, "planned element", "planned elements") + " missing");
  say(r.missing, plural(r.missing, "planned relationship", "planned relationships") + " missing");
  say(e.deletionsNotDone + r.deletionsNotDone, "planned deletion(s) not done");
  say(e.divergent, plural(e.divergent, "element differs", "elements differ"));
  say(r.divergent, plural(r.divergent, "relationship differs", "relationships differ"));
  say(e.unplanned, plural(e.unplanned, "unplanned element change", "unplanned element changes"));
  say(r.unplanned, plural(r.unplanned, "unplanned relationship", "unplanned relationships"));

  const probable = e.probable + r.probable;
  const probableText = probable > 0 ? ` ${probable} match(es) are probable, not exact; confirm them.` : "";
  const unverifiable = e.unverifiable + r.unverifiable;
  const unverifiableText =
    unverifiable > 0
      ? ` ${[
          e.unverifiable > 0 ? `${e.unverifiable} planned ${plural(e.unverifiable, "element", "elements")}` : "",
          r.unverifiable > 0 ? `${r.unverifiable} planned ${plural(r.unverifiable, "relationship", "relationships")}` : "",
        ]
          .filter(Boolean)
          .join(" and ")} can't be seen by extraction (unverifiable, not counted): check them in the code or the review.`
      : "";

  if (e.planned + r.planned === unverifiable && e.unplanned + r.unplanned === 0) {
    return {
      verdict: "unverifiable",
      text: `Nothing in the plan can be checked against extracted code.${unverifiableText}`,
    };
  }
  if (e.missing + r.missing + e.deletionsNotDone + r.deletionsNotDone > 0) {
    return { verdict: "incomplete", text: `The build is incomplete: ${parts.join(", ")}.${probableText}${unverifiableText}` };
  }
  if (e.divergent + r.divergent + e.unplanned + r.unplanned > 0) {
    return { verdict: "diverges", text: `The build diverges from the plan: ${parts.join(", ")}.${probableText}${unverifiableText}` };
  }
  const scope = unverifiable > 0 ? "Everything extraction can see was found." : "Everything planned was found.";
  if (probable > 0) {
    return { verdict: "probable-match", text: `${scope}${probableText}${unverifiableText}` };
  }
  return {
    verdict: "match",
    text: unverifiable > 0 ? `The build matches what extraction can see of the plan.${unverifiableText}` : "The build matches the plan.",
  };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
