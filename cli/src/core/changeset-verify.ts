/**
 * Changeset verify — compare what a change PLANNED (a staged changeset) with what was BUILT.
 *
 * The planned side is always a changeset: its net changes (adds, updates and deletes of elements and
 * relationships, replayed in sequence order). The built side is a `BuiltSide`, which can come from:
 *
 * - another changeset (`builtFromGraph`): an as-built changeset written by hand or, later, by the
 *   extraction cascade. The built world is the base model with that changeset applied, and what the
 *   build changed is known, so unplanned changes are reported in full.
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
 * See docs/CHANGE_MODELING.md (Verify).
 */

import { Changeset, type StagedChange } from "./changeset.js";
import { ChangesetGraph, type GraphElement, type GraphRelationship } from "./changeset-graph.js";
import type { Model } from "./model.js";
import type { SourceReference } from "../types/source-reference.js";

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
}

export type BuiltChange = "added" | "updated" | "deleted";

export interface BuiltElement extends VerifyElement {
  change?: BuiltChange;
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

export interface UnplannedRelationship extends VerifyRelationship {
  change: Exclude<BuiltChange, "updated"> | "present";
}

export interface RelationshipDeletionNotDone {
  planned: VerifyRelationship;
  built: VerifyRelationship;
}

export interface CategoryCounts {
  planned: number;
  matched: number;
  probable: number;
  missing: number;
  divergent: number;
  unplanned: number;
  deletionsNotDone: number;
}

export type Verdict = "match" | "probable-match" | "diverges" | "incomplete" | "empty-plan";

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
    unplanned: UnplannedElement[];
    deletionsNotDone: DeletionNotDone[];
  };
  relationships: {
    matched: RelationshipMatch[];
    divergent: DivergentRelationship[];
    missing: MissingRelationship[];
    unplanned: UnplannedRelationship[];
    deletionsNotDone: RelationshipDeletionNotDone[];
  };
  notes: string[];
}

export interface VerifyOptions {
  /** Match elements of the same layer and type that share a source file (default true). */
  matchBySource?: boolean;
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
        elements.set(id, {
          ...record,
          op: "update",
          ...(before ? { before, changedFields: changedFields(before, record) } : {}),
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
    const built: BuiltElement = {
      ...fromGraphElement(element),
      ...(element.status !== "unchanged" ? { change: element.status } : {}),
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
    elements: { matched: [], divergent: [], missing: [], unplanned: [], deletionsNotDone: [] },
    relationships: { matched: [], divergent: [], missing: [], unplanned: [], deletionsNotDone: [] },
    notes,
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

  for (const tier of tiers) {
    for (const planned of pending) {
      if (elementMap.has(planned.id)) continue;
      const candidates = built.elements.filter((c) => !claimed.has(c.id) && tier.test(planned, c));
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

  for (const planned of live) {
    const mapping = elementMap.get(planned.id);
    if (!mapping) {
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
            : "not found in the build by id, name or source file",
        ...(candidates ? { candidates } : {}),
      });
      continue;
    }

    const builtElement = builtById.get(mapping.built)!;
    const fields = compareElements(planned, builtElement, planned.op === "update" ? planned.changedFields : undefined);
    const match: ElementMatch = {
      planned: planned.id,
      built: mapping.built,
      op: planned.op,
      match: mapping.match,
      ...(mapping.reason ? { reason: mapping.reason } : {}),
    };

    if (planned.op === "update" && planned.changedFields && planned.changedFields.length > 0) {
      const unmet = new Set(fields.map((f) => f.field));
      if (planned.changedFields.every((f) => unmet.has(f))) {
        report.elements.missing.push({
          planned: planned.id,
          layer: planned.layer,
          type: planned.type,
          name: planned.name,
          op: planned.op,
          reason: "the element exists but the build does not carry the planned update",
          fields: fields.filter((f) => planned.changedFields!.includes(f.field)),
        });
        continue;
      }
    }

    if (fields.length > 0) report.elements.divergent.push({ ...match, fields });
    else report.elements.matched.push(match);
  }

  for (const planned of deletions) {
    const still = builtById.get(planned.id);
    if (still) {
      claimed.add(still.id);
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
    against: { changeset: Changeset } | { base: true };
    matchBySource?: boolean;
  }
): Promise<VerifyReport & { plannedChangeset: { id: string; name: string } }> {
  const { planned } = options;
  const plan = await planFromModel(model, planned);
  const notes: string[] = [];

  let built: BuiltSide;
  if ("changeset" in options.against) {
    const asBuilt = options.against.changeset;
    if (asBuilt.id === planned.id) {
      notes.push("The planned and as-built changesets are the same changeset, so everything matches by definition.");
    }
    built = builtFromGraph(await ChangesetGraph.build(model, asBuilt), `${asBuilt.name} (${asBuilt.id})`);
  } else {
    built = await builtFromBase(model);
    if (planned.status === "staged") {
      notes.push(
        "The planned changeset is still staged, so its own changes are not in the base model: anything " +
          "reported missing is missing from what was committed to the base (e.g. an as-built changeset)."
      );
    }
  }

  const report = verifyChangeset(plan, built, { matchBySource: options.matchBySource });
  report.notes.push(...notes);
  return { plannedChangeset: { id: planned.id, name: planned.name }, ...report };
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
    if (!sameValue(value, builtValue)) {
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
  return fields;
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
    ...(record.source_reference ? { sourceReference: record.source_reference as SourceReference } : {}),
  };
}

function emptyCounts(): CategoryCounts {
  return { planned: 0, matched: 0, probable: 0, missing: 0, divergent: 0, unplanned: 0, deletionsNotDone: 0 };
}

function countCategories(
  planned: number,
  section: {
    matched: Array<{ match: MatchKind }>;
    divergent: Array<{ match: MatchKind }>;
    missing: unknown[];
    unplanned: unknown[];
    deletionsNotDone: unknown[];
  }
): CategoryCounts {
  return {
    planned,
    matched: section.matched.length,
    probable: [...section.matched, ...section.divergent].filter((m) => m.match === "probable").length,
    missing: section.missing.length,
    divergent: section.divergent.length,
    unplanned: section.unplanned.length,
    deletionsNotDone: section.deletionsNotDone.length,
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

  if (e.missing + r.missing + e.deletionsNotDone + r.deletionsNotDone > 0) {
    return { verdict: "incomplete", text: `The build is incomplete: ${parts.join(", ")}.${probableText}` };
  }
  if (e.divergent + r.divergent + e.unplanned + r.unplanned > 0) {
    return { verdict: "diverges", text: `The build diverges from the plan: ${parts.join(", ")}.${probableText}` };
  }
  if (probable > 0) {
    return { verdict: "probable-match", text: `Everything planned was found.${probableText}` };
  }
  return { verdict: "match", text: "The build matches the plan." };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
