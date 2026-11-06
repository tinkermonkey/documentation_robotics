/**
 * Changeset analysis — pressure-testing a planned change against the model.
 *
 * Both functions read a `ChangesetGraph` (the base model with the changeset applied, relationships
 * included):
 *
 * - `computeImpact` walks outward from everything the changeset touches and lists the existing
 *   elements it reaches, with the source files they live in.
 * - `buildBrief` renders the changeset as a spec for the build: changes by layer with their
 *   connections, which layers the change reaches, gaps, whether each change traces to intent, the
 *   code it touches, and open review comments.
 *
 * See docs/CHANGE_MODELING.md.
 */

import { getAllLayerIds } from "../generated/layer-registry.js";
import { normalizeNodeType } from "../generated/node-types.js";
import { getValidRelationships } from "../generated/relationship-index.js";
import type { Annotation } from "./annotation-store.js";
import type { ChangesetDrift } from "./changeset-base-index.js";
import type { ChangesetGraph, GraphElement, GraphRelationship, Neighbor } from "./changeset-graph.js";
import {
  describeAlternatives,
  expectationsFor,
  isExpectationMet,
  loadExpectations,
  type ElementConnection,
  type ExpectationSet,
} from "./connection-expectations.js";

/** Layers that state why the system exists; every change should trace to one of them. */
export const INTENT_LAYERS = new Set(["motivation", "business", "product"]);

const INTENT_TRACE_DEPTH = 4;

// ---------------------------------------------------------------------------
// Impact
// ---------------------------------------------------------------------------

export interface ImpactOptions {
  /** How many hops to walk out from the changed elements (default 2). */
  depth?: number;
  /** Stop after this many reached elements (default 200). */
  maxElements?: number;
}

export interface ImpactedElement {
  id: string;
  name: string;
  type: string;
  distance: number;
  /** The relationship through which the walk first reached this element. */
  via: string;
  files: string[];
}

export interface ImpactReport {
  depth: number;
  /** Elements the changeset adds, updates or deletes: where the walk starts. */
  changed: number;
  /** Existing elements the walk reached. */
  reached: number;
  truncated: boolean;
  byLayer: Record<string, ImpactedElement[]>;
}

export function computeImpact(graph: ChangesetGraph, options: ImpactOptions = {}): ImpactReport {
  const depth = options.depth ?? 2;
  const maxElements = options.maxElements ?? 200;

  const changed = new Set(graph.changedElements().map((e) => e.id));
  const reached = new Map<string, ImpactedElement & { layer: string }>();
  const visited = new Set(changed);
  let truncated = false;

  const reach = (from: string, neighbor: Neighbor, distance: number): boolean => {
    if (visited.has(neighbor.other)) return false;
    const element = graph.getElement(neighbor.other);
    if (!element || element.status === "deleted") return false;
    visited.add(neighbor.other);
    if (reached.size >= maxElements) {
      truncated = true;
      return false;
    }
    reached.set(element.id, {
      id: element.id,
      layer: element.layer,
      name: element.name,
      type: element.type,
      distance,
      via: describeHop(from, neighbor),
      files: sourceFiles(element),
    });
    return true;
  };

  // A relationship the changeset adds or removes between two existing elements changes both of
  // them, so both ends start one hop out, reached through that relationship.
  let frontier: string[] = [];
  for (const rel of graph.changedRelationships()) {
    if (changed.has(rel.source) || changed.has(rel.target)) continue;
    const asNeighbor = (other: string, direction: "out" | "in"): Neighbor => ({ relationship: rel, direction, other });
    if (reach(rel.source, asNeighbor(rel.target, "out"), 1)) frontier.push(rel.target);
    if (reach(rel.target, asNeighbor(rel.source, "in"), 1)) frontier.push(rel.source);
  }

  let current = [...changed];
  for (let distance = 1; distance <= depth && current.length + frontier.length > 0 && !truncated; distance++) {
    const next: string[] = [];
    for (const id of current) {
      // From a changed element, follow the relationships the change deletes too: their other
      // ends are exactly what a removal affects. Past that, walk only what will still exist.
      for (const neighbor of graph.neighbors(id, { includeDeleted: changed.has(id) })) {
        if (reach(id, neighbor, distance)) next.push(neighbor.other);
        if (truncated) break;
      }
      if (truncated) break;
    }
    current = [...frontier, ...next];
    frontier = [];
  }

  const byLayer: Record<string, ImpactedElement[]> = {};
  for (const layer of orderedLayers([...reached.values()].map((e) => e.layer))) {
    byLayer[layer] = [...reached.values()]
      .filter((e) => e.layer === layer)
      .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
      .map(({ layer: _layer, ...rest }) => rest);
  }

  return { depth, changed: changed.size, reached: reached.size, truncated, byLayer };
}

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------

export interface BriefConnection {
  direction: "out" | "in";
  predicate: string;
  other: string;
  otherName?: string;
  otherLayer?: string;
  status: GraphRelationship["status"];
}

export interface BriefElementChange {
  op: "added" | "updated" | "deleted";
  id: string;
  type: string;
  name: string;
  description?: string;
  attributes?: Record<string, unknown>;
  changedFields?: Array<{ field: string; before: unknown; after: unknown }>;
  connections: BriefConnection[];
}

export interface BriefGap {
  /**
   * - `unconnected`: an added element with no relationships.
   * - `missing-required`: the catalog marks a relationship from the element's type required.
   * - `missing-expected`: the spec expects a connection of the element's type (one of a set of
   *   alternatives) and the element has none of them: an added element that lacks it, or an
   *   existing one whose last such connection this changeset removes. Soft: a question, not an error.
   * - `peer-pattern`: most existing elements of the same type, wired to the same neighbours,
   *   have a connection this one lacks. The model's own convention, not a spec rule.
   */
  kind: "unconnected" | "missing-required" | "missing-expected" | "peer-pattern";
  element: string;
  detail: string;
  /** For `missing-expected`: the expectation's id and why the spec expects it. */
  expectation?: string;
  rationale?: string;
  /** For `peer-pattern`: up to three existing connections of this shape. */
  examples?: string[];
}

export interface BriefInput {
  graph: ChangesetGraph;
  annotations?: Annotation[];
  /** Hash-only drift (`{isDrifted, warnings}`) or the structured one from `describeDrift`. */
  drift?: BriefDrift;
  /** Connection expectations to check gaps against; defaults to the bundled spec's. */
  expectations?: ExpectationSet;
}

/** `isDrifted` and `warnings` always; the rest when `describeDrift` produced it. */
export type BriefDrift = { isDrifted: boolean; warnings: string[] } & Partial<Omit<ChangesetDrift, "isDrifted" | "warnings">>;

export interface ChangesetBrief {
  changeset: {
    id: string;
    name: string;
    description?: string;
    status: string;
    created: string;
    modified: string;
    drift?: BriefDrift;
  };
  summary: {
    /** Elements the changeset adds that the base does not have yet. */
    elementsAdded: number;
    elementsUpdated: number;
    elementsDeleted: number;
    /** Relationships the changeset adds that the base does not have yet. */
    relationshipsAdded: number;
    relationshipsDeleted: number;
    /** Staged adds whose element the base already has (e.g. an as-built changeset was committed). */
    elementsAlreadyInBase: number;
    /** Staged relationship adds the base already has. */
    relationshipsAlreadyInBase: number;
  };
  /** Staged adds the base already has; commit skips them. Counted apart from the adds above. */
  alreadyInBase: {
    elements: string[];
    relationships: Array<{ source: string; predicate: string; target: string }>;
  };
  layers: Array<{ layer: string; changes: BriefElementChange[] }>;
  /** Changed relationships whose two ends the changeset does not otherwise change. */
  relationshipChanges: Array<{ status: string; source: string; predicate: string; target: string }>;
  reach: { touched: string[]; untouched: string[] };
  gaps: BriefGap[];
  intent: {
    traced: Array<{ element: string; tracesTo: string; distance: number }>;
    untraced: string[];
  };
  codeTouched: Array<{ file: string; elements: Array<{ id: string; role: "changed" | "neighbor" }> }>;
  feedback: Array<{
    annotationId: string;
    elementId: string;
    author: string;
    content: string;
    tags: string[];
    replies: number;
  }>;
  /** Problems loading the spec's connection expectations; present only when there were any. */
  expectationWarnings?: string[];
}

export function buildBrief({ graph, annotations = [], drift, expectations: given }: BriefInput): ChangesetBrief {
  const expectations = given ?? loadExpectations();
  const changeset = graph.changeset;
  const changed = graph.changedElements();
  const changedIds = new Set(changed.map((e) => e.id));
  const changedRels = graph.changedRelationships();
  const inBase = graph.alreadyInBase();

  // Changes by layer
  const layers: ChangesetBrief["layers"] = [];
  for (const layer of orderedLayers(changed.map((e) => e.layer))) {
    layers.push({
      layer,
      changes: changed.filter((e) => e.layer === layer).map((e) => describeChange(graph, e)),
    });
  }

  const relationshipChanges = changedRels
    .filter((rel) => !changedIds.has(rel.source) && !changedIds.has(rel.target))
    .map((rel) => ({ status: rel.status, source: rel.source, predicate: rel.predicate, target: rel.target }));

  // Reach: a layer is touched when an element in it changes, or a relationship into it does.
  const touchedLayers = new Set(changed.map((e) => e.layer));
  for (const rel of changedRels) {
    for (const end of [rel.source, rel.target]) {
      const element = graph.getElement(end);
      if (element) touchedLayers.add(element.layer);
    }
  }
  const allLayers = getAllLayerIds();
  const reach = {
    touched: allLayers.filter((l) => touchedLayers.has(l)),
    untouched: allLayers.filter((l) => !touchedLayers.has(l)),
  };

  // Gaps
  const gaps: BriefGap[] = [];
  for (const element of changed.filter((e) => e.status === "added")) {
    const live = graph.neighbors(element.id);
    if (live.length === 0) {
      gaps.push({
        kind: "unconnected",
        element: element.id,
        detail: "Added with no relationships: nothing in the model says what it serves, realizes or uses.",
      });
    }
    for (const required of requiredOutgoing(element)) {
      const satisfied = live.some((n) => {
        if (n.direction !== "out" || n.relationship.predicate !== required.predicate) return false;
        const other = graph.getElement(n.other);
        return !!other && specNodeId(other) === required.destinationSpecNodeId;
      });
      if (!satisfied) {
        gaps.push({
          kind: "missing-required",
          element: element.id,
          detail: `The catalog requires ${required.sourceSpecNodeId} --${required.predicate}--> ${required.destinationSpecNodeId}.`,
        });
      }
    }
    gaps.push(...expectationGaps(graph, element, expectations));
    gaps.push(...peerPatternGaps(graph, element));
  }
  // An existing element can lose an expected connection: an end of a relationship the change
  // removes, or a neighbour of an element it deletes.
  const lostEnds = new Set<string>();
  for (const rel of changedRels.filter((r) => r.status === "deleted")) {
    lostEnds.add(rel.source);
    lostEnds.add(rel.target);
  }
  for (const element of changed.filter((e) => e.status === "deleted")) {
    for (const n of graph.neighbors(element.id)) lostEnds.add(n.other);
  }
  for (const id of lostEnds) {
    const element = graph.getElement(id);
    if (!element || element.status === "added" || element.status === "deleted") continue;
    gaps.push(...expectationGaps(graph, element, expectations, { onlyLost: true }));
  }

  // Intent: changed elements outside the intent layers should reach one within a few hops.
  const traced: ChangesetBrief["intent"]["traced"] = [];
  const untraced: string[] = [];
  for (const element of changed) {
    if (element.status === "deleted" || INTENT_LAYERS.has(element.layer)) continue;
    const hit = findIntent(graph, element.id);
    if (hit) traced.push({ element: element.id, tracesTo: hit.id, distance: hit.distance });
    else untraced.push(element.id);
  }

  // Code touched: files of changed elements and of the existing elements next to them.
  const files = new Map<string, Map<string, "changed" | "neighbor">>();
  const addFiles = (element: GraphElement, role: "changed" | "neighbor") => {
    for (const file of sourceFiles(element)) {
      const entry = files.get(file) ?? new Map();
      if (entry.get(element.id) !== "changed") entry.set(element.id, role);
      files.set(file, entry);
    }
  };
  const neighborIds = new Set<string>();
  for (const element of changed) {
    addFiles(element, "changed");
    for (const n of graph.neighbors(element.id, { includeDeleted: true })) {
      if (!changedIds.has(n.other)) neighborIds.add(n.other);
    }
  }
  for (const rel of changedRels) {
    for (const end of [rel.source, rel.target]) if (!changedIds.has(end)) neighborIds.add(end);
  }
  for (const id of neighborIds) {
    const element = graph.getElement(id);
    if (element && element.status !== "deleted") addFiles(element, "neighbor");
  }
  const codeTouched = [...files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, elements]) => ({
      file,
      elements: [...elements.entries()].map(([id, role]) => ({ id, role })),
    }));

  // Feedback: open annotations on what the change touches.
  const watched = new Set([...changedIds, ...neighborIds]);
  const feedback = annotations
    .filter((a) => !a.resolved && watched.has(graph.resolve(a.elementId)))
    .map((a) => ({
      annotationId: a.id,
      elementId: a.elementId,
      author: a.author,
      content: a.content,
      tags: a.tags,
      replies: a.replies.length,
    }));

  return {
    changeset: {
      id: changeset.id,
      name: changeset.name,
      ...(changeset.description ? { description: changeset.description } : {}),
      status: changeset.status,
      created: changeset.created,
      modified: changeset.modified,
      ...(drift ? { drift } : {}),
    },
    summary: {
      elementsAdded: changed.filter((e) => e.status === "added").length,
      elementsUpdated: changed.filter((e) => e.status === "updated").length,
      elementsDeleted: changed.filter((e) => e.status === "deleted").length,
      relationshipsAdded: changedRels.filter((r) => r.status === "added").length,
      relationshipsDeleted: changedRels.filter((r) => r.status === "deleted").length,
      elementsAlreadyInBase: inBase.elements.length,
      relationshipsAlreadyInBase: inBase.relationships.length,
    },
    alreadyInBase: {
      elements: inBase.elements.map((e) => e.id),
      relationships: inBase.relationships.map((r) => ({ source: r.source, predicate: r.predicate, target: r.target })),
    },
    layers,
    relationshipChanges,
    reach,
    gaps,
    intent: { traced, untraced },
    codeTouched,
    feedback,
    ...(expectations.warnings.length > 0 ? { expectationWarnings: expectations.warnings } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeChange(graph: ChangesetGraph, element: GraphElement): BriefElementChange {
  const op = element.status as BriefElementChange["op"];
  const connections = graph
    .neighbors(element.id, { includeDeleted: true })
    .map((n): BriefConnection => {
      const other = graph.getElement(n.other);
      return {
        direction: n.direction,
        predicate: n.relationship.predicate,
        other: n.other,
        ...(other ? { otherName: other.name, otherLayer: other.layer } : {}),
        status: n.relationship.status,
      };
    });

  const change: BriefElementChange = {
    op,
    id: element.id,
    type: element.type,
    name: element.name,
    ...(element.description ? { description: element.description } : {}),
    connections,
  };
  if (op !== "deleted" && Object.keys(element.attributes).length > 0) {
    change.attributes = element.attributes;
  }
  if (op === "updated" && element.before) {
    change.changedFields = diffFields(element.before, element);
  }
  return change;
}

function diffFields(
  before: Record<string, unknown>,
  after: GraphElement
): Array<{ field: string; before: unknown; after: unknown }> {
  const fields: Array<{ field: string; before: unknown; after: unknown }> = [];
  const compare = (field: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) fields.push({ field, before: a, after: b });
  };
  compare("name", before.name, after.name);
  compare("description", before.description, after.description);
  const beforeAttrs = (before.attributes as Record<string, unknown> | undefined) ?? {};
  for (const key of new Set([...Object.keys(beforeAttrs), ...Object.keys(after.attributes)])) {
    compare(`attributes.${key}`, beforeAttrs[key], after.attributes[key]);
  }
  return fields;
}

function findIntent(graph: ChangesetGraph, start: string): { id: string; distance: number } | null {
  const visited = new Set([start]);
  let frontier = [start];
  for (let distance = 1; distance <= INTENT_TRACE_DEPTH && frontier.length > 0; distance++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of graph.neighbors(id)) {
        if (visited.has(n.other)) continue;
        visited.add(n.other);
        const element = graph.getElement(n.other);
        if (!element || element.status === "deleted") continue;
        if (INTENT_LAYERS.has(element.layer)) return { id: element.id, distance };
        next.push(element.id);
      }
    }
    frontier = next;
  }
  return null;
}

/** A peer pattern counts when at least this many peers, and at least half of them, have it. */
const PEER_MIN = 2;
const PEER_SHARE = 0.5;

/**
 * Connections an added element's peers usually have and it lacks. Peers are existing elements of
 * the same type that relate to one of the element's neighbours the same way it does (another
 * layout function that also realizes the layout service). Only shapes the catalog still allows are
 * reported, so a convention the spec has since retired is not suggested.
 */
function peerPatternGaps(graph: ChangesetGraph, element: GraphElement): BriefGap[] {
  const own = graph.neighbors(element.id);
  if (own.length === 0) return [];
  const type = specNodeId(element);

  const peers = new Set<string>();
  for (const mine of own) {
    for (const theirs of graph.neighbors(mine.other)) {
      // Seen from the shared neighbour, a peer's relationship points the opposite way to ours.
      if (theirs.relationship.predicate !== mine.relationship.predicate || theirs.direction === mine.direction) continue;
      const peer = graph.getElement(theirs.other);
      if (!peer || peer.id === element.id || peer.status === "added" || peer.status === "deleted") continue;
      if (specNodeId(peer) === type) peers.add(peer.id);
    }
  }
  if (peers.size < PEER_MIN) return [];

  const shapeOf = (n: Neighbor): string | null => {
    const other = graph.getElement(n.other);
    return other ? `${n.direction}|${n.relationship.predicate}|${specNodeId(other)}` : null;
  };
  const ownShapes = new Set(own.map(shapeOf));

  const shapes = new Map<string, { peers: Set<string>; examples: string[] }>();
  for (const peerId of peers) {
    for (const n of graph.neighbors(peerId)) {
      if (n.other === element.id) continue;
      const shape = shapeOf(n);
      if (!shape || ownShapes.has(shape)) continue;
      const entry = shapes.get(shape) ?? { peers: new Set<string>(), examples: [] };
      if (!entry.peers.has(peerId) && entry.examples.length < 3) entry.examples.push(describeHop(peerId, n));
      entry.peers.add(peerId);
      shapes.set(shape, entry);
    }
  }

  const threshold = Math.max(PEER_MIN, Math.ceil(peers.size * PEER_SHARE));
  return [...shapes.entries()]
    .filter(([, entry]) => entry.peers.size >= threshold)
    .filter(([shape]) => {
      const [direction, predicate, otherType] = shape.split("|");
      return direction === "out"
        ? getValidRelationships(type, predicate, otherType).length > 0
        : getValidRelationships(otherType, predicate, type).length > 0;
    })
    .sort(([, a], [, b]) => b.peers.size - a.peers.size)
    .map(([shape, entry]) => {
      const [direction, predicate, otherType] = shape.split("|");
      const connection =
        direction === "out" ? `--${predicate}--> ${otherType}` : `${otherType} --${predicate}--> them`;
      return {
        kind: "peer-pattern" as const,
        element: element.id,
        detail: `${entry.peers.size} of ${peers.size} existing ${type} elements wired like this one have ${connection}; this one has none.`,
        examples: entry.examples,
      };
    });
}

/**
 * Spec expectations the element does not meet. With `onlyLost`, only those it met before the
 * changeset and no longer does (for existing elements the change disconnects).
 */
function expectationGaps(
  graph: ChangesetGraph,
  element: GraphElement,
  set: ExpectationSet,
  options: { onlyLost?: boolean } = {}
): BriefGap[] {
  const expectations = expectationsFor(specNodeId(element), set);
  if (expectations.length === 0) return [];

  const connectionsOf = (neighbors: Neighbor[]): ElementConnection[] =>
    neighbors.flatMap((n) => {
      const other = graph.getElement(n.other);
      return other ? [{ direction: n.direction, predicate: n.relationship.predicate, otherType: specNodeId(other) }] : [];
    });
  const now = connectionsOf(graph.neighbors(element.id).filter((n) => graph.getElement(n.other)?.status !== "deleted"));
  // Before the change: every relationship but the ones it adds, to any element but the ones it adds.
  const before = options.onlyLost
    ? connectionsOf(
        graph
          .neighbors(element.id, { includeDeleted: true })
          .filter((n) => n.relationship.status !== "added" && graph.getElement(n.other)?.status !== "added")
      )
    : [];

  const gaps: BriefGap[] = [];
  for (const expectation of expectations) {
    if (isExpectationMet(expectation, now)) continue;
    if (options.onlyLost && !isExpectationMet(expectation, before)) continue;
    const wanted = describeAlternatives(expectation).join(", or ");
    gaps.push({
      kind: "missing-expected",
      element: element.id,
      detail: options.onlyLost
        ? `This change removes its last expected connection (${wanted}).`
        : `The spec expects ${wanted}; this one has none.`,
      expectation: expectation.id,
      rationale: expectation.rationale,
    });
  }
  return gaps;
}

function requiredOutgoing(element: GraphElement) {
  return getValidRelationships(specNodeId(element)).filter((r) => r.required);
}

function specNodeId(element: GraphElement): string {
  return `${element.layer}.${normalizeNodeType(element.layer, element.type)}`;
}

function describeHop(from: string, neighbor: Neighbor): string {
  const { predicate, status } = neighbor.relationship;
  const suffix = status === "unchanged" ? "" : ` (${status} by this changeset)`;
  return neighbor.direction === "out"
    ? `${from} --${predicate}--> ${neighbor.other}${suffix}`
    : `${neighbor.other} --${predicate}--> ${from}${suffix}`;
}

function sourceFiles(element: GraphElement): string[] {
  const locations = element.sourceReference?.locations ?? [];
  return [...new Set(locations.map((l) => l.file).filter((f): f is string => !!f))];
}

function orderedLayers(layers: Iterable<string>): string[] {
  const present = new Set(layers);
  const known = getAllLayerIds().filter((l) => present.has(l));
  const unknown = [...present].filter((l) => !known.includes(l)).sort();
  return [...known, ...unknown];
}
