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
import {
  getValidRelationships,
  RELATIONSHIPS_BY_DESTINATION,
  RELATIONSHIPS_BY_SOURCE,
} from "../generated/relationship-index.js";
import type { Annotation } from "./annotation-store.js";
import type { ChangesetDrift } from "./changeset-base-index.js";
import { changesetRevisionToken } from "./changeset-graph.js";
import type { ChangesetGraph, GraphElement, GraphRelationship, Neighbor } from "./changeset-graph.js";

/** Layers that state why the system exists; every change should trace to one of them. */
export const INTENT_LAYERS = new Set(["motivation", "business", "product"]);

const INTENT_TRACE_DEPTH = 4;

// ---------------------------------------------------------------------------
// Impact
// ---------------------------------------------------------------------------

/** An element with more live relationships than this is a hub: reported, not walked through. */
export const DEFAULT_HUB_THRESHOLD = 15;

export interface ImpactOptions {
  /** How many hops to walk out from the changed elements (default 2). */
  depth?: number;
  /** Stop after this many reached elements (default 200). */
  maxElements?: number;
  /**
   * Walk from these elements (ids or paths) instead of from everything the changeset changes.
   * Ids the projected graph does not have are reported in `unknownFrom`.
   */
  from?: string[];
  /** Degree above which a reached element is a hub (default 15). */
  hubThreshold?: number;
  /** Walk through hubs as through any other element (default false). */
  expandHubs?: boolean;
}

export interface ImpactedElement {
  id: string;
  name: string;
  type: string;
  distance: number;
  /** The relationship through which the walk first reached this element. */
  via: string;
  files: string[];
  /** Set when the element is itself changed by the changeset (only a walk `from` chosen elements reaches one). */
  status?: "added" | "updated";
}

export interface ImpactHub {
  id: string;
  /** Live relationships the element has in the projected graph. */
  degree: number;
  /** The hop at which the walk reached it. */
  depth: number;
}

export interface ImpactReport {
  depth: number;
  /** Elements the changeset adds, updates or deletes. Without `from`, where the walk starts. */
  changed: number;
  /** Existing elements the walk reached. */
  reached: number;
  truncated: boolean;
  byLayer: Record<string, ImpactedElement[]>;
  /** Elements reached at each hop. */
  perHop: Array<{ depth: number; reached: number }>;
  /** Reached elements with more relationships than `hubThreshold`; the walk did not go through them. */
  hubs: ImpactHub[];
  hubThreshold: number;
  /** The resolved start elements, when the walk started `from` chosen ones. */
  from?: string[];
  /** `from` ids the projected graph does not have. */
  unknownFrom?: string[];
  /** Why the walk is not what it looks like, e.g. a `from` with no start element. */
  warnings?: string[];
}

export function computeImpact(graph: ChangesetGraph, options: ImpactOptions = {}): ImpactReport {
  const depth = options.depth ?? 2;
  const maxElements = options.maxElements ?? 200;
  const hubThreshold = options.hubThreshold ?? DEFAULT_HUB_THRESHOLD;
  const expandHubs = options.expandHubs ?? false;

  const changed = new Set(graph.changedElements().map((e) => e.id));

  let start: Set<string>;
  let unknownFrom: string[] | undefined;
  if (options.from) {
    start = new Set();
    unknownFrom = [];
    for (const id of options.from) {
      const element = graph.getElement(id);
      if (element) start.add(element.id);
      else unknownFrom.push(id);
    }
  } else {
    start = changed;
  }

  const reached = new Map<string, ImpactedElement & { layer: string }>();
  const visited = new Set(start);
  const hubs: ImpactHub[] = [];
  const perHop = new Map<number, number>();
  let truncated = false;

  /** Records a reached element; returns whether the walk should continue through it. */
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
      ...(element.status === "added" || element.status === "updated" ? { status: element.status } : {}),
    });
    perHop.set(distance, (perHop.get(distance) ?? 0) + 1);
    const degree = graph.neighbors(element.id).length;
    if (degree > hubThreshold) {
      hubs.push({ id: element.id, degree, depth: distance });
      if (!expandHubs) return false;
    }
    return true;
  };

  // A relationship the changeset adds or removes between two existing elements changes both of
  // them, so both ends start one hop out, reached through that relationship. A walk from chosen
  // elements starts only from those.
  let frontier: string[] = [];
  if (!options.from) {
    for (const rel of graph.changedRelationships()) {
      if (changed.has(rel.source) || changed.has(rel.target)) continue;
      const asNeighbor = (other: string, direction: "out" | "in"): Neighbor => ({ relationship: rel, direction, other });
      if (reach(rel.source, asNeighbor(rel.target, "out"), 1)) frontier.push(rel.target);
      if (reach(rel.target, asNeighbor(rel.source, "in"), 1)) frontier.push(rel.source);
    }
  }

  let current = [...start];
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

  return {
    depth,
    changed: changed.size,
    reached: reached.size,
    truncated,
    byLayer,
    perHop: [...perHop.entries()].sort(([a], [b]) => a - b).map(([d, n]) => ({ depth: d, reached: n })),
    hubs: hubs.sort((a, b) => a.depth - b.depth || b.degree - a.degree || a.id.localeCompare(b.id)),
    hubThreshold,
    ...(options.from ? { from: [...start], unknownFrom: unknownFrom ?? [] } : {}),
    ...(options.from && start.size === 0
      ? {
          warnings: [
            options.from.length === 0
              ? "from is empty, so the walk had no start element and reached nothing; omit from to walk from every changed element."
              : "None of the from ids is in the projected model, so the walk had no start element and reached nothing; see unknownFrom.",
          ],
        }
      : {}),
  };
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
   * - `peer-pattern`: most existing elements of the same type, wired to the same neighbours,
   *   have a connection this one lacks. The model's own convention, not a spec rule.
   */
  kind: "unconnected" | "missing-required" | "peer-pattern";
  element: string;
  detail: string;
  /** For `peer-pattern`: up to three existing connections of this shape. */
  examples?: string[];
}

/** A connection the catalog defines for an element's type that the element does not have. */
export interface UnwiredEntry {
  /** "out" when the element would be the source, "in" when it would be the target. */
  direction: "out" | "in";
  predicate: string;
  /** Spec node id of the other end (`layer.type`). */
  otherType: string;
  /** Live elements of `otherType` in the projected model (the element itself not counted). */
  existingCount: number;
}

/** One added or updated element's unwired connections, as computed (every layer). */
export interface ElementUnwired {
  element: string;
  /** Spec node id of the element's type. */
  type: string;
  /** By the other end's layer, in layer order. */
  byLayer: Array<{ layer: string; entries: UnwiredEntry[] }>;
}

/**
 * - `summary` (default): per element, a count per layer, with the entries for the layers the change
 *   already reaches (and for any layer named in `unwiredLayers`).
 * - `full`: every entry.
 * - `none`: no unwired section.
 */
export type UnwiredMode = "summary" | "full" | "none";

export interface BriefUnwired {
  mode: Exclude<UnwiredMode, "none">;
  /** The layer filter, when one was given. */
  layers?: string[];
  /** Filter layers that are not layers of the model. */
  unknownLayers?: string[];
  elements: Array<{
    element: string;
    type: string;
    /** Unwired connections across the layers shown. */
    total: number;
    byLayer: Array<{ layer: string; count: number; entries?: UnwiredEntry[] }>;
  }>;
}

export interface BriefInput {
  graph: ChangesetGraph;
  annotations?: Annotation[];
  /** Hash-only drift (`{isDrifted, warnings}`) or the structured one from `describeDrift`. */
  drift?: BriefDrift;
  /** How to show unwired connections (default `summary`). */
  unwired?: UnwiredMode;
  /** Only show unwired connections whose other end is in these layers. */
  unwiredLayers?: string[];
}

/** `isDrifted` and `warnings` always; the rest when `describeDrift` produced it. */
export type BriefDrift = { isDrifted: boolean; warnings: string[] } & Partial<Omit<ChangesetDrift, "isDrifted" | "warnings">>;

export interface ChangesetBrief {
  /** The changeset's last sequence number (-1 when nothing is staged); pass it back as `since`. */
  revision: number;
  /**
   * Names the plan at `revision`, not just its length (see `changesetRevisionToken`). Pass it back
   * as `since` to have the delta warn when changes up to that revision were unstaged or rewritten.
   */
  revisionToken: string;
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
  /**
   * Connections the catalog defines for each added or updated element's type, in either direction,
   * that the element has no live relationship for. Absent when `unwired` is `none`.
   */
  unwired?: BriefUnwired;
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
}

export function buildBrief({
  graph,
  annotations = [],
  drift,
  unwired: unwiredMode = "summary",
  unwiredLayers,
}: BriefInput): ChangesetBrief {
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
    gaps.push(...peerPatternGaps(graph, element));
  }

  const unwired =
    unwiredMode === "none"
      ? undefined
      : presentUnwired(computeUnwired(graph), unwiredMode, new Set(reach.touched), unwiredLayers);
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
    revision: graph.revision,
    revisionToken: changesetRevisionToken(graph.changeset, graph.revision),
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
    ...(unwired ? { unwired } : {}),
    intent: { traced, untraced },
    codeTouched,
    feedback,
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
 * Unwired connections of every added or updated element: each triple the catalog defines with the
 * element's type at one end, for which the element has no live relationship with that predicate
 * to (or from) an element of the other end's type. Only catalog triples are considered.
 */
export function computeUnwired(graph: ChangesetGraph): ElementUnwired[] {
  const counts = new Map<string, number>();
  for (const element of graph.elements.values()) {
    if (element.status === "deleted") continue;
    const type = specNodeId(element);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  const result: ElementUnwired[] = [];
  for (const element of graph.changedElements()) {
    if (element.status !== "added" && element.status !== "updated") continue;
    const type = specNodeId(element);

    const have = new Set<string>();
    for (const n of graph.neighbors(element.id)) {
      const other = graph.getElement(n.other);
      if (other && other.status !== "deleted") have.add(`${n.direction}|${n.relationship.predicate}|${specNodeId(other)}`);
    }

    const entries = new Map<string, UnwiredEntry>();
    const consider = (direction: "out" | "in", predicate: string, otherType: string) => {
      const key = `${direction}|${predicate}|${otherType}`;
      if (have.has(key) || entries.has(key)) return;
      const existingCount = (counts.get(otherType) ?? 0) - (otherType === type ? 1 : 0);
      entries.set(key, { direction, predicate, otherType, existingCount });
    };
    for (const spec of RELATIONSHIPS_BY_SOURCE.get(type) ?? []) consider("out", spec.predicate, spec.destinationSpecNodeId);
    for (const spec of RELATIONSHIPS_BY_DESTINATION.get(type) ?? []) consider("in", spec.predicate, spec.sourceSpecNodeId);

    const layerOf = (specId: string) => specId.split(".")[0];
    const all = [...entries.values()];
    const byLayer = orderedLayers(all.map((e) => layerOf(e.otherType))).map((layer) => ({
      layer,
      entries: all
        .filter((e) => layerOf(e.otherType) === layer)
        .sort(
          (a, b) =>
            (a.direction === b.direction ? 0 : a.direction === "out" ? -1 : 1) ||
            a.predicate.localeCompare(b.predicate) ||
            a.otherType.localeCompare(b.otherType)
        ),
    }));
    result.push({ element: element.id, type, byLayer });
  }
  return result;
}

/** Shapes computed unwired connections for the brief: see `UnwiredMode`. */
function presentUnwired(
  computed: ElementUnwired[],
  mode: Exclude<UnwiredMode, "none">,
  reachedLayers: Set<string>,
  layerFilter?: string[]
): BriefUnwired {
  const known = new Set(getAllLayerIds());
  const filter = layerFilter ? new Set(layerFilter) : undefined;
  const unknownLayers = layerFilter?.filter((l) => !known.has(l)) ?? [];

  const elements = computed.map(({ element, type, byLayer }) => {
    const shown = byLayer
      .filter((l) => !filter || filter.has(l.layer))
      .map((l) => {
        const withEntries = mode === "full" || reachedLayers.has(l.layer) || !!filter?.has(l.layer);
        return { layer: l.layer, count: l.entries.length, ...(withEntries ? { entries: l.entries } : {}) };
      });
    return { element, type, total: shown.reduce((sum, l) => sum + l.count, 0), byLayer: shown };
  });

  return {
    mode,
    ...(layerFilter ? { layers: layerFilter } : {}),
    ...(unknownLayers.length > 0 ? { unknownLayers } : {}),
    elements,
  };
}

/** Key of one unwired entry of one element, for comparing two briefs. */
export function unwiredKey(element: string, entry: Pick<UnwiredEntry, "direction" | "predicate" | "otherType">): string {
  return `${element}|${entry.direction}|${entry.predicate}|${entry.otherType}`;
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
