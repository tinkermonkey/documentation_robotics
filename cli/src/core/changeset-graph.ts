/**
 * ChangesetGraph — the model as a changeset would leave it, elements and relationships both.
 *
 * The per-layer projection (`VirtualProjectionEngine`) merges staged element changes but keeps the
 * base model's relationships, so a traversal over it cannot see the connections a change adds or
 * removes. This view applies every staged change, relationship changes included, in sequence order,
 * and keeps a status on each element and relationship so callers can tell what the change touches.
 *
 * It reads the base model through `getBaseLayer()` and `getBaseRelationships()`, so it works for
 * any changeset (active or not) and is never affected by the model's own active-changeset
 * projection.
 */

import { createHash } from "node:crypto";
import type { Model } from "./model.js";
import type { Changeset, StagedChange, UnstagedChange } from "./changeset.js";
import { compactChange, nextSequenceNumber, sequenceOf } from "./changeset.js";
import type { SourceReference } from "../types/source-reference.js";
import { stagedSourceReference } from "./staged-source-reference.js";
import { readAcceptedGaps, type AcceptedGap } from "./accepted-gaps.js";

export type ChangeStatus = "added" | "updated" | "deleted" | "unchanged";

export interface GraphElement {
  /** Dotted path (`layer.type.name`), the id relationships and changes use. */
  id: string;
  uuid?: string;
  layer: string;
  type: string;
  name: string;
  description?: string;
  attributes: Record<string, unknown>;
  sourceReference?: SourceReference;
  /** Connections deliberately absent (the element's `accepted_gaps`), as the projection leaves them. */
  acceptedGaps?: AcceptedGap[];
  status: ChangeStatus;
  /** Element state before the change, for updated and deleted elements. */
  before?: Record<string, unknown>;
  /**
   * The changeset stages an add of this element, but the base model already has it (e.g. an as-built
   * changeset that created it was committed after the plan was staged). Commit skips such an add, so
   * the element keeps its base content and status; it is reported apart from the changeset's adds.
   */
  alreadyInBase?: true;
}

export interface GraphRelationship {
  source: string;
  predicate: string;
  target: string;
  layer: string;
  targetLayer?: string;
  properties?: Record<string, unknown>;
  status: Exclude<ChangeStatus, "updated">;
  /** Endpoints as the relationship row names them (a UUID or a path), when they differ from the resolved ones. */
  raw?: { source: string; target: string };
  /** The changeset stages an add of this relationship, but the base model already has it. */
  alreadyInBase?: true;
}

export interface Neighbor {
  relationship: GraphRelationship;
  /** "out" when the element is the relationship's source, "in" when it is the target. */
  direction: "out" | "in";
  other: string;
}

/**
 * A changeset's changes in sequence order, each with its sequence number (its index when the change
 * carries none).
 */
export function sequencedChanges(changeset: Changeset): Array<{ change: StagedChange; sequence: number }> {
  return (changeset.changes as StagedChange[])
    .map((change, index) => ({ change, sequence: sequenceOf(change, index) }))
    .sort((a, b) => a.sequence - b.sequence);
}

/**
 * The changes that made up the plan at `revision`, in sequence order: the staged changes numbered
 * at or below it, plus the unstaged ones (tombstones) that were staged by then and unstaged after.
 * Without a revision, the changes staged now.
 */
export function changesAtRevision(
  changeset: Changeset,
  revision?: number
): Array<{ change: StagedChange; sequence: number; unstagedAt?: number }> {
  const live = sequencedChanges(changeset);
  if (revision === undefined) return live;
  // Each sequence number at or below the revision, as it stood then: the staged change, unless a
  // tombstone says it was unstaged or rewritten after the revision; then the tombstone's version.
  const bySequence = new Map<number, { change: StagedChange; sequence: number; unstagedAt?: number }>();
  for (const entry of live) if (entry.sequence <= revision) bySequence.set(entry.sequence, entry);
  for (const t of tombstonesLiveAt(changeset, revision)) {
    bySequence.set(t.sequence, {
      change: { ...t.change, sequenceNumber: t.sequence } as StagedChange,
      sequence: t.sequence,
      ...(t.rewritten ? {} : { unstagedAt: t.removedAt }),
    });
  }
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

/**
 * For each sequence number at or below `revision` that was unstaged or rewritten after it, the
 * tombstone holding the version it had at `revision`: the earliest one removed after it.
 */
function tombstonesLiveAt(changeset: Changeset, revision: number): UnstagedChange[] {
  const earliest = new Map<number, UnstagedChange>();
  for (const t of changeset.unstaged ?? []) {
    if (t.sequence > revision || t.removedAt <= revision) continue;
    const kept = earliest.get(t.sequence);
    if (!kept || t.removedAt < kept.removedAt) earliest.set(t.sequence, t);
  }
  return [...earliest.values()].sort((a, b) => a.sequence - b.sequence);
}

/**
 * Tombstones of changes that were staged at `revision` and have been unstaged (not merely
 * rewritten) since: for each such sequence number, its unstage tombstone. A change rewritten and
 * then unstaged has both; the unstage one is reported.
 */
export function unstagedSince(changeset: Changeset, revision: number): UnstagedChange[] {
  const live = new Set(sequencedChanges(changeset).map(({ sequence }) => sequence));
  const result: UnstagedChange[] = [];
  for (const { sequence } of tombstonesLiveAt(changeset, revision)) {
    if (live.has(sequence)) continue;
    const unstage = (changeset.unstaged ?? [])
      .filter((t) => t.sequence === sequence && !t.rewritten && t.removedAt > revision)
      .sort((x, y) => y.removedAt - x.removedAt)[0];
    if (unstage) result.push(unstage);
  }
  return result;
}

/**
 * The changeset's revision: the last sequence number it has used, a stage or an unstage (each
 * takes one), or -1 when nothing was ever staged. For a changeset never unstaged from, its last
 * change's number.
 */
export function changesetRevision(changeset: Changeset): number {
  return nextSequenceNumber(changeset) - 1;
}

/**
 * A token naming the plan at a revision, not just its number: `<revision>:<hash>`, where the hash
 * covers every change that made up the plan at `throughSequence` (now, by default): its type,
 * element, timestamp and content, unstaged changes included while they were staged. An update can
 * rewrite a staged change in place, so the plan behind a revision number can change; the token
 * then differs. Nothing is stored for it: the token is recomputed from what is staged and the
 * unstage tombstones.
 */
export function changesetRevisionToken(changeset: Changeset, throughSequence?: number): string {
  const revision = throughSequence ?? changesetRevision(changeset);
  const hash = createHash("sha256");
  for (const { change, sequence } of changesAtRevision(changeset, revision)) {
    const compact = compactChange(change);
    hash.update(
      JSON.stringify([sequence, compact.type, compact.elementId, compact.timestamp ?? null, compact.before ?? null, compact.after ?? null])
    );
    hash.update("\n");
  }
  return `${revision}:${hash.digest("hex").slice(0, 12)}`;
}

/** Splits a revision token into its revision and hash, or returns undefined when it is not one. */
export function parseRevisionToken(token: string): { revision: number; hash: string } | undefined {
  const match = /^(-1|\d+):([0-9a-f]+)$/.exec(token);
  return match ? { revision: Number(match[1]), hash: match[2] } : undefined;
}

/** Relationship key used by staged changes: `source::predicate::target`. */
export function relationshipKey(rel: { source: string; predicate: string; target: string }): string {
  return `${rel.source}::${rel.predicate}::${rel.target}`;
}

export class ChangesetGraph {
  readonly elements = new Map<string, GraphElement>();
  private readonly relationshipsByKey = new Map<string, GraphRelationship>();
  /** UUID → dotted path, so relationship rows that name elements by UUID still resolve. */
  private readonly uuidToPath = new Map<string, string>();
  private adjacency: Map<string, Neighbor[]> | null = null;
  /** The staged changes this projection applied, in sequence order. */
  private appliedChanges: StagedChange[] = [];
  private _revision = -1;

  private constructor(readonly changeset: Changeset) {}

  /** The revision this projection shows (see `changesetRevision`); -1 when nothing was staged by then. */
  get revision(): number {
    return this._revision;
  }

  /**
   * Builds the projected graph of `changeset` over the base model. With `throughSequence`, the plan
   * as it stood at that revision, over today's base: the changes numbered at most that, including
   * ones unstaged since (rebuilt from their tombstones).
   */
  static async build(
    model: Model,
    changeset: Changeset,
    options: { throughSequence?: number } = {}
  ): Promise<ChangesetGraph> {
    const graph = new ChangesetGraph(changeset);

    for (const layerName of model.getLayerNames()) {
      const layer = await model.getBaseLayer(layerName);
      if (!layer) continue;
      for (const element of layer.listElements()) {
        const record = element.toJSON() as unknown as Record<string, unknown>;
        graph.putElement(fromRecord(record, layerName, "unchanged"));
      }
    }

    // The committed relationships: a model loaded with this changeset active has already merged
    // its staged relationship changes into `model.relationships`, and they are applied below.
    const baseRelationships =
      typeof model.getBaseRelationships === "function"
        ? model.getBaseRelationships()
        : model.relationships.getAll();
    for (const rel of baseRelationships) {
      const resolved = {
        source: graph.resolve(rel.source),
        predicate: rel.predicate,
        target: graph.resolve(rel.target),
      };
      graph.relationshipsByKey.set(relationshipKey(resolved), {
        ...resolved,
        layer: rel.layer,
        ...(rel.targetLayer ? { targetLayer: rel.targetLayer } : {}),
        ...(rel.properties ? { properties: rel.properties } : {}),
        status: "unchanged",
        ...(resolved.source !== rel.source || resolved.target !== rel.target
          ? { raw: { source: rel.source, target: rel.target } }
          : {}),
      });
    }

    // Up to a revision, changes unstaged after it count again (from their tombstones).
    const through = options.throughSequence;
    const applied = changesAtRevision(changeset, through);
    graph.appliedChanges = applied.map(({ change }) => change);
    const current = changesetRevision(changeset);
    graph._revision = through === undefined ? current : Math.min(through, current);
    for (const change of graph.appliedChanges) {
      graph.apply(change);
    }

    return graph;
  }

  /** Maps a UUID to its dotted path; returns any other identifier unchanged. */
  resolve(id: string): string {
    return this.uuidToPath.get(id) ?? id;
  }

  getElement(id: string): GraphElement | undefined {
    return this.elements.get(this.resolve(id));
  }

  /** Every relationship in the projection, including the ones the changeset deletes. */
  relationships(): GraphRelationship[] {
    return [...this.relationshipsByKey.values()];
  }

  /** Whether the projection holds a relationship that is not deleted. */
  hasLiveRelationship(source: string, predicate: string, target: string): boolean {
    const rel = this.relationshipsByKey.get(
      relationshipKey({ source: this.resolve(source), predicate, target: this.resolve(target) })
    );
    return !!rel && rel.status !== "deleted";
  }

  getRelationship(source: string, predicate: string, target: string): GraphRelationship | undefined {
    return this.relationshipsByKey.get(
      relationshipKey({ source: this.resolve(source), predicate, target: this.resolve(target) })
    );
  }

  /** Elements the changeset adds, updates or deletes, in the order of their first change. */
  changedElements(): GraphElement[] {
    const seen = new Set<string>();
    const result: GraphElement[] = [];
    for (const change of this.appliedChanges) {
      if (change.type.startsWith("relationship-")) continue;
      const element = this.getElement(change.elementId);
      if (!element || element.status === "unchanged" || seen.has(element.id)) continue;
      seen.add(element.id);
      result.push(element);
    }
    return result;
  }

  /** Relationships the changeset adds or deletes. */
  changedRelationships(): GraphRelationship[] {
    return this.relationships().filter((rel) => rel.status !== "unchanged");
  }

  /**
   * Staged adds the base model already has: elements and relationships the changeset adds whose id
   * (or source, predicate and target) now exists in the base. They are not counted as adds, since
   * commit skips them; a later staged update or delete of the same element still applies.
   */
  alreadyInBase(): { elements: GraphElement[]; relationships: GraphRelationship[] } {
    return {
      elements: [...this.elements.values()].filter((e) => e.alreadyInBase && e.status !== "deleted"),
      relationships: this.relationships().filter((r) => r.alreadyInBase && r.status === "unchanged"),
    };
  }

  /** Relationships touching an element, with the element's side of each. */
  neighbors(id: string, options: { includeDeleted?: boolean } = {}): Neighbor[] {
    const all = this.getAdjacency().get(this.resolve(id)) ?? [];
    return options.includeDeleted ? all : all.filter((n) => n.relationship.status !== "deleted");
  }

  private getAdjacency(): Map<string, Neighbor[]> {
    if (this.adjacency) return this.adjacency;
    const adjacency = new Map<string, Neighbor[]>();
    const push = (id: string, neighbor: Neighbor) => {
      const list = adjacency.get(id);
      if (list) list.push(neighbor);
      else adjacency.set(id, [neighbor]);
    };
    for (const rel of this.relationshipsByKey.values()) {
      push(rel.source, { relationship: rel, direction: "out", other: rel.target });
      if (rel.target !== rel.source) {
        push(rel.target, { relationship: rel, direction: "in", other: rel.source });
      }
    }
    this.adjacency = adjacency;
    return adjacency;
  }

  private putElement(element: GraphElement): void {
    this.elements.set(element.id, element);
    if (element.uuid && element.uuid !== element.id) {
      this.uuidToPath.set(element.uuid, element.id);
    }
  }

  /**
   * A committed changeset's changes are already in the base model, so a base element or
   * relationship matching one of its adds is that add, not an earlier copy of it.
   */
  private isCommitted(): boolean {
    return this.changeset.status === "committed";
  }

  private apply(change: StagedChange): void {
    switch (change.type) {
      case "add": {
        if (!change.after) return;
        const element = fromRecord(change.after, change.layerName, "added", change.elementId);
        const existing = this.getElement(element.id);
        if (existing && existing.status === "unchanged" && !this.isCommitted()) {
          // The base already has it: commit would skip this add, so the base element stands.
          // (A committed changeset's adds are in the base because it landed them; they stay adds.)
          existing.alreadyInBase = true;
          return;
        }
        this.putElement(element);
        return;
      }
      case "update": {
        if (!change.after) return;
        const existing = this.getElement(change.elementId);
        const status: ChangeStatus = existing?.status === "added" ? "added" : "updated";
        const element = fromRecord(change.after, change.layerName, status, change.elementId);
        element.before = existing?.before ?? change.before;
        this.putElement(element);
        return;
      }
      case "delete": {
        const existing = this.getElement(change.elementId);
        if (!existing) return;
        if (existing.status === "added") {
          this.elements.delete(existing.id);
        } else {
          existing.before = existing.before ?? change.before;
          existing.status = "deleted";
        }
        return;
      }
      case "relationship-add": {
        const data = change.after as Partial<GraphRelationship> | undefined;
        if (!data?.source || !data.target || !data.predicate) return;
        const rel = {
          source: this.resolve(data.source),
          predicate: data.predicate,
          target: this.resolve(data.target),
        };
        const key = relationshipKey(rel);
        const existing = this.relationshipsByKey.get(key);
        if (existing && existing.status === "unchanged" && !this.isCommitted()) {
          // The base already has it (a staged add made before it was committed there).
          existing.alreadyInBase = true;
          return;
        }
        this.relationshipsByKey.set(key, {
          ...rel,
          layer: data.layer ?? change.layerName,
          ...(data.targetLayer ? { targetLayer: data.targetLayer } : {}),
          ...(data.properties ? { properties: data.properties } : {}),
          // Re-adding a relationship this changeset deleted restores it. A committed changeset's add
          // is in the base because the changeset landed it, so it stays an add.
          status: existing?.status === "deleted" ? "unchanged" : "added",
          ...(existing?.raw ? { raw: existing.raw } : {}),
        });
        return;
      }
      case "relationship-delete": {
        const data = (change.before ?? change.after) as Partial<GraphRelationship> | undefined;
        const [source, predicate, target] = data?.source
          ? [data.source, data.predicate, data.target]
          : change.elementId.split("::");
        if (!source || !predicate || !target) return;
        const key = relationshipKey({
          source: this.resolve(source),
          predicate,
          target: this.resolve(target),
        });
        const existing = this.relationshipsByKey.get(key);
        if (!existing) return;
        if (existing.status === "added") this.relationshipsByKey.delete(key);
        else existing.status = "deleted";
        return;
      }
    }
  }
}

function fromRecord(
  record: Record<string, unknown>,
  layerName: string,
  status: ChangeStatus,
  fallbackId?: string
): GraphElement {
  const str = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;
  const id = str(record.path) ?? fallbackId ?? str(record.id) ?? "";
  const gaps = readAcceptedGaps(record.accepted_gaps);
  return {
    id,
    uuid: str(record.id),
    layer: str(record.layer_id) ?? str(record.layer) ?? layerName,
    type: str(record.type) ?? "",
    name: str(record.name) ?? id,
    description: str(record.description),
    attributes: (record.attributes as Record<string, unknown> | undefined) ?? {},
    sourceReference: stagedSourceReference(record),
    ...(gaps.length > 0 ? { acceptedGaps: gaps } : {}),
    status,
  };
}
