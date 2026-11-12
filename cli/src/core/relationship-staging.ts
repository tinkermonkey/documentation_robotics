/**
 * Relationship staging against a changeset's projected graph.
 *
 * Shared by `dr relationship add|delete` and the MCP `relationship_add|delete` /
 * `changeset_unstage` tools, so the CLI and an agent stage relationships the same way:
 *
 * - Adding a relationship the projected graph already holds (in the base model or staged by this
 *   changeset) is reported as a duplicate instead of staged twice.
 * - Re-adding a relationship this changeset staged for deletion unstages the deletion.
 * - Deleting a relationship this changeset added unstages the add instead of stacking a delete on it.
 *
 * Every function here works on staged keys (`source::predicate::target`) however a relationship's
 * ends are spelled (UUID or dotted path), by resolving them through the graph.
 */

import type { ChangesetGraph, GraphRelationship } from "./changeset-graph.js";
import type { Changeset, StagedChange } from "./changeset.js";
import type { StagingAreaManager } from "./staging-area.js";
import { RelationshipCatalog } from "./relationship-catalog.js";
import {
  getValidRelationships,
  getValidPredicatesForSource,
  getValidDestinationsForSourceAndPredicate,
} from "../generated/relationship-index.js";
import { normalizeNodeType } from "../generated/node-types.js";
import { findSimilar } from "../utils/errors.js";

export interface RelationshipTriple {
  source: string;
  predicate: string;
  target: string;
}

export type RelationshipChangeType = "relationship-add" | "relationship-delete";

/** The triple a staged relationship change names, read from its data or its composite key. */
export function stagedRelationshipTriple(change: StagedChange): RelationshipTriple | null {
  const data = (change.after ?? change.before) as Partial<GraphRelationship> | undefined;
  const [source, predicate, target] = data?.source
    ? [data.source, data.predicate, data.target]
    : change.elementId.split("::");
  return source && predicate && target ? { source, predicate, target } : null;
}

/**
 * Keys of the staged relationship changes of `type` that name `rel` (any predicate when
 * `rel.predicate` is omitted), however their ends are spelled.
 */
export function stagedRelationshipKeys(
  graph: ChangesetGraph,
  changeset: Changeset,
  type: RelationshipChangeType,
  rel: { source: string; predicate?: string; target: string }
): string[] {
  const source = graph.resolve(rel.source);
  const target = graph.resolve(rel.target);
  const keys = new Set<string>();
  for (const change of changeset.changes as StagedChange[]) {
    if (change.type !== type) continue;
    const triple = stagedRelationshipTriple(change);
    if (
      triple &&
      (!rel.predicate || triple.predicate === rel.predicate) &&
      graph.resolve(triple.source) === source &&
      graph.resolve(triple.target) === target
    ) {
      keys.add(change.elementId);
    }
  }
  return [...keys];
}

/**
 * The staged relationship changes (adds and deletes) with the given end: every one from `source`,
 * or every one to `target`, or between them when both are given; optionally one predicate.
 * Ends are compared through the graph, however they are spelled.
 */
export function stagedRelationshipChangesAtEnds(
  graph: ChangesetGraph,
  changeset: Changeset,
  ends: { source?: string; target?: string; predicate?: string }
): StagedChange[] {
  if (!ends.source && !ends.target) {
    throw new Error("stagedRelationshipChangesAtEnds needs a source or a target");
  }
  const source = ends.source ? graph.resolve(ends.source) : undefined;
  const target = ends.target ? graph.resolve(ends.target) : undefined;
  return (changeset.changes as StagedChange[]).filter((change) => {
    if (change.type !== "relationship-add" && change.type !== "relationship-delete") return false;
    const triple = stagedRelationshipTriple(change);
    return (
      !!triple &&
      (!ends.predicate || triple.predicate === ends.predicate) &&
      (!source || graph.resolve(triple.source) === source) &&
      (!target || graph.resolve(triple.target) === target)
    );
  });
}

/** What staging a relationship add would do, given the changeset's projected graph. */
export type RelationshipAddPlan =
  /** The projection already holds it, from the base model or this changeset. Stage nothing. */
  | { action: "duplicate" }
  /** This changeset deletes it. Unstage the deletion (these keys) instead of staging an add. */
  | { action: "restore"; keys: string[] }
  /** Not in the projection. Stage the add. */
  | { action: "stage" };

export function planRelationshipAdd(
  graph: ChangesetGraph,
  changeset: Changeset,
  triple: RelationshipTriple
): RelationshipAddPlan {
  const existing = graph.getRelationship(triple.source, triple.predicate, triple.target);
  if (!existing) return { action: "stage" };
  if (existing.status !== "deleted") return { action: "duplicate" };
  return { action: "restore", keys: stagedRelationshipKeys(graph, changeset, "relationship-delete", existing) };
}

/** Relationships in the projection from `source` to `target` (one predicate, or all) that are not deleted. */
export function liveRelationshipsBetween(
  graph: ChangesetGraph,
  source: string,
  target: string,
  predicate?: string
): GraphRelationship[] {
  const from = graph.resolve(source);
  const to = graph.resolve(target);
  return graph
    .relationships()
    .filter(
      (rel) =>
        rel.status !== "deleted" && rel.source === from && rel.target === to && (!predicate || rel.predicate === predicate)
    );
}

export interface StagedRelationshipDeleteResult {
  predicate: string;
  /** "unstaged": this changeset added it, so the add was dropped. "staged": a removal was staged. */
  status: "staged" | "unstaged";
}

/**
 * Removes `relationships` (live ones from the projection) within a changeset: unstages the ones
 * this changeset added and stages a deletion for the rest.
 */
export async function stageRelationshipDeletes(
  manager: StagingAreaManager,
  graph: ChangesetGraph,
  changeset: Changeset,
  relationships: GraphRelationship[]
): Promise<StagedRelationshipDeleteResult[]> {
  const results: StagedRelationshipDeleteResult[] = [];
  for (const rel of relationships) {
    if (rel.status === "added") {
      for (const key of stagedRelationshipKeys(graph, changeset, "relationship-add", rel)) {
        await manager.unstage(changeset.id!, key);
      }
      results.push({ predicate: rel.predicate, status: "unstaged" });
      continue;
    }
    // Name the row the way relationships.yaml does, so the commit finds it.
    const source = rel.raw?.source ?? rel.source;
    const target = rel.raw?.target ?? rel.target;
    await manager.stage(changeset.id!, {
      type: "relationship-delete",
      elementId: `${source}::${rel.predicate}::${target}`,
      layerName: rel.layer,
      before: {
        source,
        target,
        predicate: rel.predicate,
        layer: rel.layer,
        ...(rel.targetLayer ? { targetLayer: rel.targetLayer } : {}),
        ...(rel.properties ? { properties: rel.properties } : {}),
      },
    });
    results.push({ predicate: rel.predicate, status: "staged" });
  }
  return results;
}

/**
 * Validate a relationship combination using schema-driven registry
 * @returns {valid, suggestions} where suggestions are provided if invalid
 */
export function validateRelationshipCombination(
  sourceSpecNodeId: string,
  predicate: string,
  destSpecNodeId: string
): { valid: boolean; suggestions?: string[] } {
  const valid =
    getValidRelationships(sourceSpecNodeId, predicate, destSpecNodeId).length >
    0;

  if (valid) {
    return { valid: true };
  }

  // Generate helpful suggestions
  const suggestions: string[] = [];
  const validPredicates = getValidPredicatesForSource(sourceSpecNodeId);

  if (validPredicates.length > 0) {
    suggestions.push(
      `Valid predicates for ${sourceSpecNodeId}: ${validPredicates.join(", ")}`
    );
  } else {
    suggestions.push(`No valid relationships defined for ${sourceSpecNodeId}`);
  }

  // If predicate is provided, show valid destinations
  if (predicate) {
    const validDests = getValidDestinationsForSourceAndPredicate(
      sourceSpecNodeId,
      predicate
    );
    if (validDests.length > 0) {
      suggestions.push(
        `Valid destinations for --[${predicate}]-->: ${validDests.join(", ")}`
      );
    } else {
      suggestions.push(
        `No valid destinations for ${sourceSpecNodeId} --[${predicate}]-->`
      );
    }
  }

  return { valid: false, suggestions };
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export interface RelationshipBatchItem {
  source: string;
  predicate: string;
  target: string;
  properties?: Record<string, unknown>;
}

/** An element the batch itself adds, so relationships in the same batch can name it. */
export interface PendingElement {
  id: string;
  layer: string;
  type: string;
  /** The name the element was sent with. A same-call reference may use it instead of the id. */
  name?: string;
}

/** A slug reduced to its letters and digits, so `graph-layout-snapshot` and `graphlayoutsnapshot` compare equal. */
function compactSlug(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The elements this call adds that `ref` names without their exact id: `layer.type.slug` whose slug
 * equals a new element's slug once hyphens (and case and other separators) are ignored, or the
 * element's name as sent. The id splits camelCase (`GraphLayoutSnapshot` becomes
 * `graph-layout-snapshot`), and an agent naming an element it adds in the same call often guesses
 * the id unsplit. Only this call's new elements are matched this way; a reference to an existing
 * element must name it exactly. More than one match is ambiguous: the caller reports it rather
 * than picking one.
 */
export function looselyMatchedPending(ref: string, pending: Iterable<PendingElement>): PendingElement[] {
  const [layer, type, ...rest] = ref.split(".");
  const slug = compactSlug(rest.join("."));
  const matches: PendingElement[] = [];
  for (const element of pending) {
    if (element.name !== undefined && element.name === ref) {
      matches.push(element);
      continue;
    }
    if (!slug) continue;
    const [elementLayer, elementType, ...elementRest] = element.id.split(".");
    if (layer === elementLayer && type.toLowerCase() === elementType && slug === compactSlug(elementRest.join("."))) {
      matches.push(element);
    }
  }
  return matches;
}

/** "added" is "staged" when no changeset is active and the add is written to the model. */
export type RelationshipBatchStatus = "staged" | "added" | "restored" | "duplicate" | "invalid";

export interface RelationshipBatchResult {
  /** Position in the request, from 0. */
  index: number;
  source: string;
  predicate: string;
  target: string;
  status: RelationshipBatchStatus;
  /** Why the item was a duplicate or invalid. */
  reason?: string;
  suggestions?: string[];
  /** How an end that named an element of this call without its exact id was read. */
  notes?: string[];
}

export interface RelationshipBatchPlan {
  /** The adds to stage (or write), in request order. */
  changes: Array<Omit<StagedChange, "sequenceNumber">>;
  /** Keys of staged deletions to unstage: the batch re-adds what this changeset deleted. */
  unstageKeys: string[];
  results: RelationshipBatchResult[];
}

/**
 * Checks a list of relationship adds against the projected graph and the catalog, without writing.
 * Each item is to be staged, a duplicate (in the projection, or earlier in the batch), restored
 * (the changeset deletes it), or invalid with the reason. An invalid item does not stop the rest.
 * Ends may name elements in `pending` (added by the same call); `rejected` names elements the same
 * call refused to add, with why, so the reason says so.
 */
export async function planRelationshipBatch(
  graph: ChangesetGraph,
  changeset: Changeset,
  items: RelationshipBatchItem[],
  options: {
    pending?: Map<string, PendingElement>;
    rejected?: Map<string, string>;
    /** The status for an add: "staged" into the changeset (default), or "added" to the model. */
    addStatus?: "staged" | "added";
  } = {}
): Promise<RelationshipBatchPlan> {
  const addStatus = options.addStatus ?? "staged";
  const pending = options.pending ?? new Map<string, PendingElement>();
  const rejected = options.rejected ?? new Map<string, string>();
  const catalog = new RelationshipCatalog();
  await catalog.load();

  const changes: RelationshipBatchPlan["changes"] = [];
  const unstageKeys: string[] = [];
  const results: RelationshipBatchResult[] = [];
  const seen = new Set<string>();

  type Endpoint = PendingElement & { note?: string };
  const endpoint = (id: string, role: "Source" | "Target"): Endpoint | { error: string; suggestions: string[] } => {
    const added = pending.get(id);
    if (added) return added;
    const element = graph.getElement(id);
    if (element && element.status !== "deleted") return { id: element.id, layer: element.layer, type: element.type };
    if (element) return { error: `${role} element ${id} not found (this changeset deletes it)`, suggestions: [] };
    const refusal = rejected.get(id);
    if (refusal) return { error: `${role} element ${id} was not added: ${refusal}`, suggestions: [] };

    // Not an exact id: it may name an element this call adds by its unhyphenated id or its name.
    const loose = looselyMatchedPending(id, pending.values());
    if (loose.length > 0) {
      // An existing element that matches the same way makes the reference ambiguous too.
      const existing = looselyMatchedPending(
        id,
        [...graph.elements.values()]
          .filter((e) => e.status !== "deleted" && !pending.has(e.id))
          .map((e) => ({ id: e.id, layer: e.layer, type: e.type }))
      );
      if (loose.length === 1 && existing.length === 0) {
        return { ...loose[0], note: `${role} ${id} read as ${loose[0].id}, which this call adds` };
      }
      return {
        error:
          `${role} ${id} is not an exact id and matches more than one element: ` +
          [...loose, ...existing].map((e) => e.id).join(", "),
        suggestions: ["Name the element by its exact id"],
      };
    }
    const looseRefusals = looselyMatchedPending(
      id,
      [...rejected.keys()].map((rejectedId) => ({ id: rejectedId, layer: "", type: "" }))
    );
    if (looseRefusals.length === 1) {
      const rejectedId = looseRefusals[0].id;
      return { error: `${role} element ${rejectedId} was not added: ${rejected.get(rejectedId)}`, suggestions: [] };
    }
    const layerPrefix = `${id.split(".")[0]}.`;
    const candidates = [...graph.elements.values()]
      .filter((e) => e.status !== "deleted" && e.id.startsWith(layerPrefix))
      .map((e) => e.id)
      .concat([...pending.keys()].filter((k) => k.startsWith(layerPrefix)));
    const similar = findSimilar(id, candidates, 4);
    return {
      error: `${role} element ${id} not found`,
      suggestions: similar.length
        ? [`Did you mean: ${similar.join(" or ")}?`]
        : ['Use "model_search" to find elements, or "changeset_brief" to see what this changeset adds'],
    };
  };

  items.forEach((item, index) => {
    const asSent = { index, source: item.source, predicate: item.predicate, target: item.target };
    const invalid = (reason: string, suggestions?: string[]) => {
      results.push({ ...asSent, status: "invalid", reason, ...(suggestions?.length ? { suggestions } : {}) });
    };

    if (!item.source || !item.predicate || !item.target) {
      return invalid("Each relationship needs source, predicate and target");
    }
    const source = endpoint(item.source, "Source");
    if ("error" in source) return invalid(source.error, source.suggestions);
    const target = endpoint(item.target, "Target");
    if ("error" in target) return invalid(target.error, target.suggestions);

    const sourceSpec = `${source.layer}.${normalizeNodeType(source.layer, source.type)}`;
    const targetSpec = `${target.layer}.${normalizeNodeType(target.layer, target.type)}`;
    const validation = validateRelationshipCombination(sourceSpec, item.predicate, targetSpec);
    if (!validation.valid) {
      return invalid(`The catalog has no ${sourceSpec} --[${item.predicate}]--> ${targetSpec}`, validation.suggestions);
    }
    const relType = catalog.getTypeByPredicate(item.predicate);
    if (relType && !relType.semantics.reflexivity && source.id === target.id) {
      return invalid(`Predicate "${item.predicate}" does not allow reflexive relationships`);
    }

    const triple = { source: source.id, predicate: item.predicate, target: target.id };
    const key = `${triple.source}::${triple.predicate}::${triple.target}`;
    const notes = [source, target].flatMap((end) => ("note" in end && end.note ? [end.note] : []));
    const resolved = { ...asSent, ...triple, ...(notes.length ? { notes } : {}) };
    if (seen.has(key)) {
      results.push({ ...resolved, status: "duplicate", reason: "Repeated earlier in this batch" });
      return;
    }
    seen.add(key);

    // Ends this batch adds are checked in the projection too: one the changeset deleted and the
    // batch re-adds may have relationships whose deletion is staged, which are restored.
    const plan = planRelationshipAdd(graph, changeset, triple);
    if (plan.action === "duplicate") {
      results.push({ ...resolved, status: "duplicate", reason: "Already in the model or this changeset" });
      return;
    }
    if (plan.action === "restore") {
      unstageKeys.push(...plan.keys);
      results.push({ ...resolved, status: "restored" });
      return;
    }
    changes.push({
      type: "relationship-add",
      elementId: key,
      layerName: source.layer,
      after: {
        source: triple.source,
        target: triple.target,
        predicate: triple.predicate,
        layer: source.layer,
        ...(target.layer !== source.layer ? { targetLayer: target.layer } : {}),
        category: "structural",
        ...(item.properties ? { properties: item.properties } : {}),
      },
    });
    results.push({ ...resolved, status: addStatus });
  });

  return { changes, unstageKeys, results };
}

/** Counts of a batch's results by status. */
export function countByStatus(results: Array<{ status: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}
