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
import { compactId } from "../utils/id-generator.js";

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

/** An element the batch refused to add: why, and what it was sent as, so a reference to it can say so. */
export interface RejectedElement {
  reason: string;
  name: string;
  layer: string;
  type: string;
}

/**
 * An id two different names give, of which the batch kept one element and refused the other
 * (#1297): "galaxyLayout tests" and "galaxy-layout tests" both give `...galaxy-layout-tests`. A
 * reference by that id, exact or without its hyphens, could mean either, and one by the refused name
 * means the element that was not added: both are reported, never bound to the element kept.
 */
export interface IdCollision {
  /** The id both names give. */
  id: string;
  /** The element that holds the id: its name, and where it is (`elements[0], which this call adds`). */
  kept: { name?: string; where: string };
  /** The name the batch refused for the id. */
  refusedName: string;
}

/** A slug reduced to its letters and digits, so `graph-layout-snapshot` and `graphlayoutsnapshot` compare equal. */
function compactSlug(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The candidate id of the same layer and type that starts most like `id`, when they share at least
 * {@link MIN_SHARED_START} characters of the name and half of the shorter name. Two tools that cut
 * or slug one long name differently give ids that are far apart by edit distance and identical at
 * the start.
 */
export function longestSharedStart(id: string, candidates: string[]): string | undefined {
  const [layer, type, ...rest] = id.split(".");
  const slug = rest.join(".");
  if (!layer || !type || !slug) return undefined;
  const prefix = `${layer}.${type}.`;
  let best: { id: string; shared: number } | undefined;
  for (const candidate of candidates) {
    if (!candidate.startsWith(prefix) || candidate === id) continue;
    const other = candidate.slice(prefix.length);
    let shared = 0;
    while (shared < slug.length && shared < other.length && slug[shared] === other[shared]) shared++;
    if (shared < MIN_SHARED_START || shared * 2 < Math.min(slug.length, other.length)) continue;
    if (!best || shared > best.shared) best = { id: candidate, shared };
  }
  return best?.id;
}

const MIN_SHARED_START = 12;

/**
 * The elements this call adds that `ref` names without their exact id: `layer.type.slug` whose type
 * and slug equal a new element's once hyphens (and case and other separators) are ignored, or the
 * element's name as sent. The id splits camelCase (`GraphLayoutSnapshot` becomes
 * `graph-layout-snapshot`), and an agent naming an element it adds in the same call often guesses
 * the id unsplit. The projection's own elements are matched the same way by the batch planner. More
 * than one match is ambiguous: the caller reports it rather than picking one.
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
    if (layer === elementLayer && compactSlug(type) === compactSlug(elementType) && slug === compactSlug(elementRest.join("."))) {
      matches.push(element);
    }
  }
  return matches;
}

/**
 * What a reference that is not an exact id names in the projection, by an element's name or by
 * its id without hyphens: the one live element (`id`), or every candidate when there are several
 * (`candidates`), or nothing. For the single form of relationship_add; a list goes through
 * {@link planRelationshipBatch}, which also knows the elements its call adds.
 */
export function resolveLooseReference(graph: ChangesetGraph, ref: string): { id: string } | { candidates: string[] } | undefined {
  const key = compactId(ref);
  const matches = [...graph.elements.values()]
    .filter((e) => e.status !== "deleted" && (e.name === ref || (key !== undefined && compactId(e.id) === key)))
    .map((e) => e.id);
  if (matches.length === 0) return undefined;
  return matches.length === 1 ? { id: matches[0] } : { candidates: matches };
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
  /** How an end that named an element without its exact id was read. */
  notes?: string[];
  /** The same as data: each end as sent that was not an exact id, and the id it was read as. */
  readAs?: Record<string, string>;
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
 * Ends may name elements in `pending` (added by the same call); `rejected` holds, by id, the
 * elements the same call refused to add, with why, so the reason says so. An end that is not an
 * exact id is read as the one element it names by its name or its id without hyphens, among
 * `pending` and the projection (the model as the changeset leaves it), with a note saying so.
 * `collisions` lists the ids two names in the call gave (one element kept, the other refused): an
 * end naming such an id, or a refused name, is reported instead of bound (#1297).
 */
export async function planRelationshipBatch(
  graph: ChangesetGraph,
  changeset: Changeset,
  items: RelationshipBatchItem[],
  options: {
    pending?: Map<string, PendingElement>;
    rejected?: Map<string, RejectedElement>;
    collisions?: IdCollision[];
    /** The status for an add: "staged" into the changeset (default), or "added" to the model. */
    addStatus?: "staged" | "added";
  } = {}
): Promise<RelationshipBatchPlan> {
  const addStatus = options.addStatus ?? "staged";
  const pending = options.pending ?? new Map<string, PendingElement>();
  const rejected = options.rejected ?? new Map<string, RejectedElement>();
  const collisionsById = new Map<string, IdCollision[]>();
  const collisionsByCompactId = new Map<string, IdCollision[]>();
  const collisionsByRefusedName = new Map<string, IdCollision[]>();
  const push = <K>(map: Map<K, IdCollision[]>, key: K, c: IdCollision) => map.set(key, [...(map.get(key) ?? []), c]);
  for (const c of options.collisions ?? []) {
    push(collisionsById, c.id, c);
    const key = compactId(c.id);
    if (key) push(collisionsByCompactId, key, c);
    push(collisionsByRefusedName, c.refusedName, c);
  }
  const catalog = new RelationshipCatalog();
  await catalog.load();

  const changes: RelationshipBatchPlan["changes"] = [];
  const unstageKeys: string[] = [];
  const results: RelationshipBatchResult[] = [];
  const seen = new Set<string>();

  const isLive = (id: string): boolean => {
    const element = graph.getElement(id);
    return !!element && element.status !== "deleted";
  };

  // The projection's live elements by name and by compacted id, built on the first reference that
  // is not an exact id: most batches name every element exactly and never need it.
  let liveByName: Map<string, PendingElement[]> | undefined;
  let liveByCompactId: Map<string, PendingElement[]> | undefined;
  const whereOf = new Map<string, string>();
  const looselyMatchedLive = (ref: string, by: { name: boolean }): Array<PendingElement & { where: string }> => {
    if (!liveByName || !liveByCompactId) {
      liveByName = new Map();
      liveByCompactId = new Map();
      for (const e of graph.elements.values()) {
        if (e.status === "deleted" || pending.has(e.id)) continue;
        const entry = { id: e.id, layer: e.layer, type: e.type, name: e.name };
        whereOf.set(e.id, e.status === "added" && !e.alreadyInBase ? "which this changeset adds" : "which the model has");
        if (e.name) liveByName.set(e.name, [...(liveByName.get(e.name) ?? []), entry]);
        const key = compactId(e.id);
        if (key) liveByCompactId.set(key, [...(liveByCompactId.get(key) ?? []), entry]);
      }
    }
    const found = new Map<string, PendingElement>();
    if (by.name) for (const e of liveByName.get(ref) ?? []) found.set(e.id, e);
    const key = compactId(ref);
    for (const e of (key && liveByCompactId.get(key)) || []) found.set(e.id, e);
    return [...found.values()].map((e) => ({ ...e, where: whereOf.get(e.id)! }));
  };

  type Endpoint = PendingElement & { note?: string; readFrom?: string };
  /** An end naming an id two names gave, or the name the batch refused for it: never bound (#1297). */
  const collisionError = (collisions: IdCollision[], role: "Source" | "Target", ref: string, byName: boolean) => {
    const { id, kept } = collisions[0];
    const refused = [...new Set(collisions.map((c) => `"${c.refusedName}"`))].join(" and ");
    const keptName = kept.name !== undefined ? `"${kept.name}"` : "an element";
    const error = byName
      ? `${role} ${ref} was not added: the name gives the id ${id}, which ${keptName} holds (${kept.where})`
      : `${role} ${ref} is the id of more than one name: ${keptName} (${kept.where}) and ${refused} (not added)`;
    return {
      error,
      suggestions: [
        `Give ${refused} a name that differs in its letters or digits, then send it and its relationships again`,
        ...(kept.name !== undefined ? [`To link ${keptName}, name it by its name`] : []),
      ],
    };
  };

  const endpoint = (id: string, role: "Source" | "Target"): Endpoint | { error: string; suggestions: string[] } => {
    const contested = collisionsById.get(id);
    if (contested) return collisionError(contested, role, id, false);
    const added = pending.get(id);
    if (added) return added;
    const element = graph.getElement(id);
    if (element && element.status !== "deleted") return { id: element.id, layer: element.layer, type: element.type };
    if (element) return { error: `${role} element ${id} not found (this changeset deletes it)`, suggestions: [] };
    const refusal = rejected.get(id);
    if (refusal) return { error: `${role} element ${id} was not added: ${refusal.reason}`, suggestions: [] };
    const refusedName = collisionsByRefusedName.get(id);
    if (refusedName) return collisionError(refusedName, role, `"${id}"`, true);
    const compactKey = compactId(id);
    const contestedLoosely = compactKey ? collisionsByCompactId.get(compactKey) : undefined;
    if (contestedLoosely) return collisionError(contestedLoosely, role, id, false);

    // Not an exact id: it may name an element by its unhyphenated id or its name. The elements
    // this call adds and the ones the projection already holds (the model, and what the active
    // changeset stages) are matched alike, so a later call can name what an earlier one staged.
    const loose = looselyMatchedPending(id, pending.values());
    const looseRefusals = looselyMatchedPending(
      id,
      [...rejected.entries()]
        // A refused id that a later element added after all names that element, as an exact id
        // would; one already live in the model names that element, which `existing` lists.
        .filter(([rejectedId]) => !pending.has(rejectedId) && !isLive(rejectedId))
        .map(([rejectedId, r]) => ({ id: rejectedId, layer: r.layer, type: r.type, name: r.name }))
    );
    // One match, among this call's elements and the projection's, is what the reference names.
    // More than one is never guessed at, even when one of them is this call's own: a name shared
    // with an element of another layer (an entity, its table, its schema) could mean either, and
    // a wrong link staged quietly is worse than one item sent again with its id.
    const existing = looselyMatchedLive(id, { name: true });
    const matches = [...loose, ...existing];
    if (matches.length === 1 && looseRefusals.length === 0) {
      const where = loose.length === 1 ? "which this call adds" : existing[0].where;
      return {
        id: matches[0].id,
        layer: matches[0].layer,
        type: matches[0].type,
        note: `${role} ${id} read as ${matches[0].id}, ${where}`,
        readFrom: id,
      };
    }
    if (matches.length > 0) {
      // An element this call refused that matches the same way makes the reference ambiguous
      // too: linking to the accepted one could bypass the refusal.
      const refusedIds = looseRefusals.map((e) => `${e.id} (not added: ${rejected.get(e.id)!.reason})`);
      return {
        error:
          `${role} ${id} is not an exact id and matches more than one element: ` +
          [...loose.map((e) => `${e.id} (this call adds it)`), ...existing.map((e) => e.id), ...refusedIds].join(", "),
        suggestions: ["Name the element by its exact id"],
      };
    }
    if (looseRefusals.length === 1) {
      const rejectedId = looseRefusals[0].id;
      return { error: `${role} element ${rejectedId} was not added: ${rejected.get(rejectedId)!.reason}`, suggestions: [] };
    }
    const layerPrefix = `${id.split(".")[0]}.`;
    const candidates = [...graph.elements.values()]
      .filter((e) => e.status !== "deleted" && e.id.startsWith(layerPrefix))
      .map((e) => e.id)
      .concat([...pending.keys()].filter((k) => k.startsWith(layerPrefix)));
    // An id cut or slugged differently from the same long name is many edits away but starts the
    // same: offer the element whose id shares the longest beginning too (#1225).
    const sameStart = longestSharedStart(id, candidates);
    const similar = [...new Set([...(sameStart ? [sameStart] : []), ...findSimilar(id, candidates, 4)])].slice(0, 3);
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
    const readAs = Object.fromEntries([source, target].flatMap((end) => (end.readFrom ? [[end.readFrom, end.id]] : [])));
    const resolved = { ...asSent, ...triple, ...(notes.length ? { notes, readAs } : {}) };
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
