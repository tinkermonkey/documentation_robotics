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
