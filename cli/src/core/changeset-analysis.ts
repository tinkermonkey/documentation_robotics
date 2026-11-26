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
  type RelationshipSpec,
} from "../generated/relationship-index.js";
import type { Annotation } from "./annotation-store.js";
import { originLabel } from "./changeset.js";
import type { ChangesetDrift } from "./changeset-base-index.js";
import { changesetRevisionToken } from "./changeset-graph.js";
import type { ChangesetGraph, GraphElement, GraphRelationship, Neighbor } from "./changeset-graph.js";
import { acceptedGapView, findAcceptedGap, toShortDirection, type AcceptedGapView } from "./accepted-gaps.js";

import { INTENT_LAYERS } from "./layers.js";

export { INTENT_LAYERS };

/** How many hops the intent trace walks from an element by default. */
export const INTENT_TRACE_DEPTH = 4;

// ---------------------------------------------------------------------------
// Impact
// ---------------------------------------------------------------------------

/** An element with more live relationships than this is a hub: reported, not walked through. */
export const DEFAULT_HUB_THRESHOLD = 15;

export interface ImpactOptions {
  /** How many hops to walk out from the changed elements (default 2). */
  depth?: number;
  /**
   * How many reached elements to list (default 200). A page size, not a stop: the walk always runs
   * to its depth, so `reached`, `perHop` and `hubs` count everything it reaches.
   */
  maxElements?: number;
  /** Skip this many reached elements (nearest first), to read the next page. */
  offset?: number;
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
  /** Existing elements the walk reached: all of them, listed or not. */
  reached: number;
  /**
   * Where `byLayer` sits in the reached elements (nearest first): `total` is `reached`, `returned`
   * the elements listed, and `nextOffset` where the next page starts, absent when nothing is left.
   */
  page: { total: number; returned: number; offset: number; nextOffset?: number };
  /** Whether `byLayer` lists fewer elements than the walk reached. */
  truncated: boolean;
  /** The listed elements, by layer. The whole of what was reached only when `truncated` is false. */
  byLayer: Record<string, ImpactedElement[]>;
  /** Elements reached at each hop. */
  perHop: Array<{ depth: number; reached: number }>;
  /**
   * Everything the walk reached, counted per layer and, within it, per element type (most common
   * first): the whole of it, whatever part `byLayer` lists.
   */
  reachedByLayer: Record<string, { count: number; types: Record<string, number> }>;
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
  const offset = Math.max(0, options.offset ?? 0);
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

  /** Records a reached element; returns whether the walk should continue through it. */
  const reach = (from: string, neighbor: Neighbor, distance: number): boolean => {
    if (visited.has(neighbor.other)) return false;
    const element = graph.getElement(neighbor.other);
    if (!element || element.status === "deleted") return false;
    visited.add(neighbor.other);
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
  for (let distance = 1; distance <= depth && current.length + frontier.length > 0; distance++) {
    const next: string[] = [];
    for (const id of current) {
      // From a changed element, follow the relationships the change deletes too: their other
      // ends are exactly what a removal affects. Past that, walk only what will still exist.
      for (const neighbor of graph.neighbors(id, { includeDeleted: changed.has(id) })) {
        if (reach(id, neighbor, distance)) next.push(neighbor.other);
      }
    }
    current = [...frontier, ...next];
    frontier = [];
  }

  // The page listed: nearest first, then in layer order, so the same call with the next offset continues it.
  const layerRank = new Map(orderedLayers([...reached.values()].map((e) => e.layer)).map((layer, i) => [layer, i]));
  const ordered = [...reached.values()].sort(
    (a, b) => a.distance - b.distance || layerRank.get(a.layer)! - layerRank.get(b.layer)! || a.id.localeCompare(b.id)
  );
  const page = ordered.slice(offset, offset + maxElements);
  const byLayer: Record<string, ImpactedElement[]> = {};
  for (const layer of orderedLayers(page.map((e) => e.layer))) {
    byLayer[layer] = page.filter((e) => e.layer === layer).map(({ layer: _layer, ...rest }) => rest);
  }
  const nextOffset = offset + page.length < ordered.length ? offset + page.length : undefined;
  const reachedByLayer: ImpactReport["reachedByLayer"] = {};
  for (const layer of orderedLayers(ordered.map((e) => e.layer))) {
    const types = new Map<string, number>();
    for (const e of ordered) if (e.layer === layer) types.set(e.type, (types.get(e.type) ?? 0) + 1);
    reachedByLayer[layer] = {
      count: [...types.values()].reduce((sum, n) => sum + n, 0),
      types: Object.fromEntries([...types].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    };
  }

  return {
    depth,
    changed: changed.size,
    reached: reached.size,
    page: { total: reached.size, returned: page.length, offset, ...(nextOffset !== undefined ? { nextOffset } : {}) },
    truncated: page.length < reached.size,
    byLayer,
    perHop: [...perHop.entries()].sort(([a], [b]) => a - b).map(([d, n]) => ({ depth: d, reached: n })),
    reachedByLayer,
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
  /**
   * Who decided the element's change, in one line (`tier1 clef p=0.82/0.71`, `tier0
   * node-mapping:Route`; see `originLabel`): elements codebase_extract staged only.
   */
  origin?: string;
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
  /**
   * For `missing-required` and `peer-pattern`: the connection the gap is about, from the element's
   * side. Gaps on elements of one type that lack the same connection can share a line.
   */
  connection?: { direction: "out" | "in"; predicate: string; otherType: string };
}

/** A connection the catalog defines for an element's type that the element does not have. */
export interface UnwiredEntry {
  /** "out" when the element would be the source, "in" when it would be the target. */
  direction: "out" | "in";
  predicate: string;
  /** Spec node id of the other end (`layer.type`). */
  otherType: string;
  /**
   * Elements of `otherType` that exist outside the changeset's own adds: base elements, updated
   * ones included, that the change does not delete (the element itself not counted).
   */
  existingCount: number;
  /** Elements of `otherType` the changeset adds (the element itself not counted). */
  addedCount: number;
  /**
   * An element of this type is expected to have the link: the catalog marks it required or of high
   * strength, or an existing element of the type in the model has it. The rest are optional catalog
   * triples that nothing of the type carries.
   */
  expected: boolean;
}

/** One added or updated element's unwired connections, as computed (every layer). */
export interface ElementUnwired {
  element: string;
  /** Spec node id of the element's type. */
  type: string;
  /** By the other end's layer, in layer order. Expected links come before optional ones in a layer. */
  byLayer: Array<{ layer: string; entries: UnwiredEntry[] }>;
  /**
   * An updated element whose changed fields include neither its type nor its relationships: its
   * unwired connections predate the change, so they are counted apart from the headline.
   */
  preexisting?: true;
  /**
   * Connections the catalog defines that the element has accepted as gaps (its `accepted_gaps`):
   * not counted or listed as unwired.
   */
  accepted?: AcceptedUnwired[];
}

/** An unwired connection the element has accepted as a gap, with the reason. */
export interface AcceptedUnwired {
  direction: "out" | "in";
  predicate: string;
  otherType: string;
  reason: string;
}

/**
 * An accepted gap on a changed element, as the brief lists it: the decision, where it was staged,
 * the open gaps it answers, and the relationship that contradicts it when the plan wires it anyway.
 */
export interface BriefAcceptedGap extends AcceptedGapView {
  element: string;
  /** The gap was accepted in this changeset (it lands with it). */
  stagedHere?: true;
  /** The peer-pattern gap it answers, which is therefore not listed under `gaps`. */
  answersPeerPattern?: string;
  /** A live relationship with this triple: the plan wires what the gap says is absent. */
  contradictedBy?: { source: string; predicate: string; target: string };
}

/**
 * Counts are of expected links; optional catalog triples are counted apart. Entries listed are
 * expected links, except in `full`, which lists the optional ones too (flagged `expected: false`).
 *
 * - `summary` (default): per element, a count per layer, with the entries for the layers the change
 *   already reaches (and for any layer named in `unwiredLayers`). Only entries whose other type the
 *   projected model has (existing or added) are listed; the rest are counted per layer as
 *   `typesNotInModel`.
 * - `full`: every entry.
 * - `none`: no unwired section.
 */
export type UnwiredMode = "summary" | "full" | "none";

export interface BriefUnwired {
  mode: Exclude<UnwiredMode, "none">;
  /**
   * Over the layers shown: `expected` links (required or rule-backed) the added and changed elements
   * lack, which is the headline; `optional` catalog triples, counted and never listed by default;
   * `preexisting` expected links of updated elements the change does not touch the type or
   * relationships of, left out of `expected`.
   */
  totals: { expected: number; optional: number; preexisting: number };
  /** The layer filter, when one was given. */
  layers?: string[];
  /** Filter layers that are not layers of the model. */
  unknownLayers?: string[];
  elements: Array<{
    element: string;
    type: string;
    /** Expected unwired connections across the layers shown. */
    total: number;
    /** Optional catalog triples across the layers shown, counted only. */
    optional: number;
    /** Set on an updated element whose unwired connections predate the change (see `ElementUnwired`). */
    preexisting?: true;
    byLayer: Array<{
      layer: string;
      /** Expected unwired connections in this layer, listed or not. */
      count: number;
      /** Optional catalog triples in this layer, not counted in `count` and listed only in `full`. */
      optional?: number;
      entries?: UnwiredEntry[];
      /**
       * Summary mode: unwired connections in this layer whose other type the projected model has no
       * element of (neither existing nor added), not listed in `entries`. `full` lists them.
       */
      typesNotInModel?: number;
    }>;
    /** Connections the element accepted as gaps (in the layers shown), with the reason: not open. */
    accepted?: AcceptedUnwired[];
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
  /** The intent trace does not walk through elements with more relationships than this (default 15, as impact). */
  hubThreshold?: number;
  /** How many hops the intent trace walks from an element (default INTENT_TRACE_DEPTH). */
  maxHops?: number;
}

/** A changed element that reaches intent, and how. */
export interface IntentTrace {
  element: string;
  /** The first intent element the walk reached. */
  tracesTo: string;
  distance: number;
  /** Element ids from the changed element to `tracesTo`, both included. */
  path: string[];
  /**
   * When `tracesTo` is an intent element the changeset adds: the existing intent element it traces
   * to, and the path there. An added intent element counts only when it has one.
   */
  anchoredBy?: { id: string; path: string[] };
  /**
   * Set when the element does not reach intent by its own walk and is carried by another: the
   * nearest element that composes or aggregates it, or that it realizes (directly or through others
   * of the kind), and that traces in its own right. `path` then runs up to it, and on along its own path.
   */
  through?: string;
}

/** A changed element whose only intent is an intent element the changeset adds, which traces to nothing. */
export interface UnanchoredTrace {
  element: string;
  /** The added intent element it reaches. */
  tracesTo: string;
  path: string[];
  detail: string;
}

/** `isDrifted` and `warnings` always; the rest when `describeDrift` produced it. */
export type BriefDrift = { isDrifted: boolean; warnings: string[] } & Partial<Omit<ChangesetDrift, "isDrifted" | "warnings">>;

export interface ChangesetBrief {
  /**
   * The changeset's revision: the last sequence number used, by a stage or an unstage (-1 when
   * nothing was ever staged); pass it back as `since`.
   */
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
   * Accepted gaps on the added and updated elements (their `accepted_gaps`): connections decided
   * against, with the reason. Unwired connections and peer-pattern gaps they match are not open.
   */
  acceptedGaps: BriefAcceptedGap[];
  /**
   * Connections the catalog defines for each added or updated element's type, in either direction,
   * that the element has no live relationship for. Absent when `unwired` is `none`.
   */
  unwired?: BriefUnwired;
  /**
   * Whether each added or updated element outside the intent layers (motivation, business, product)
   * reaches an intent element within a few hops, without walking through hubs, or is a part of a
   * whole that does (see `IntentTrace.through`). An intent element the changeset adds counts only
   * when it itself traces to an existing one. Changed elements in the intent layers are not traced:
   * they are what the others trace to.
   */
  intent: {
    traced: IntentTrace[];
    /**
     * Elements that trace to no intent (including the ones listed under `unanchored`) and whose
     * type the catalog relates to an intent type, so a relationship can be added.
     */
    untraced: string[];
    /** Untraced elements that reach only added intent elements which trace to nothing. */
    unanchored?: UnanchoredTrace[];
    /**
     * Elements that trace to no intent and whose type the catalog gives no relationship to any
     * motivation, business or product type (see `hasCatalogRouteToIntent`). They can trace only
     * through a neighbour: the element that composes, uses or realizes them. Not in `untraced`.
     */
    noCatalogRoute?: string[];
    /** Set when nothing was traced, to say why (every changed element is an intent element or a deletion). */
    note?: string;
    /**
     * The two numbers that bound the trace, and what they cost: `blockedByHub` lists the elements
     * in `untraced` or `noCatalogRoute` that do reach intent within `maxHops` once hubs are walked
     * through. They are not traced under the rule; a larger `hubThreshold` traces them.
     */
    walk: { maxHops: number; hubThreshold: number; blockedByHub: string[] };
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
  hubThreshold = DEFAULT_HUB_THRESHOLD,
  maxHops = INTENT_TRACE_DEPTH,
}: BriefInput): ChangesetBrief {
  const changeset = graph.changeset;
  const changed = graph.changedElements();
  const changedIds = new Set(changed.map((e) => e.id));
  const changedRels = graph.changedRelationships();
  const inBase = graph.alreadyInBase();

  // Changes by layer
  const layers: ChangesetBrief["layers"] = [];
  // Who decided each element's change (its latest staged change with an origin wins).
  const origins = new Map<string, string>();
  for (const change of changeset.changes) {
    if (change.origin && (change.type === "add" || change.type === "update" || change.type === "delete")) {
      origins.set(change.elementId, originLabel(change.origin));
    }
  }
  for (const layer of orderedLayers(changed.map((e) => e.layer))) {
    layers.push({
      layer,
      changes: changed.filter((e) => e.layer === layer).map((e) => describeChange(graph, e, origins.get(e.id))),
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
  // Peer-pattern gaps an accepted gap answers, by `element|direction|predicate|otherType`.
  const answeredPeerPatterns = new Map<string, string>();
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
          connection: { direction: "out", predicate: required.predicate, otherType: required.destinationSpecNodeId },
        });
      }
    }
    gaps.push(...peerPatternGaps(graph, element, answeredPeerPatterns));
  }

  // Accepted gaps on the changed elements: decided against, with the reason. A peer-pattern gap one
  // answers was left out of `gaps` above; a live relationship with the triple contradicts it.
  const acceptedGaps: BriefAcceptedGap[] = [];
  for (const element of changed) {
    if (element.status === "deleted" || !element.acceptedGaps?.length) continue;
    const live = graph.neighbors(element.id);
    for (const gap of element.acceptedGaps) {
      const direction = toShortDirection(gap.direction);
      const wired = live.find((n) => {
        if (n.direction !== direction || n.relationship.predicate !== gap.predicate) return false;
        const other = graph.getElement(n.other);
        return !!other && other.status !== "deleted" && specNodeId(other) === gap.other_spec_node_id;
      });
      const answered = answeredPeerPatterns.get(`${element.id}|${direction}|${gap.predicate}|${gap.other_spec_node_id}`);
      acceptedGaps.push({
        element: element.id,
        ...acceptedGapView(gap),
        ...(gap.changeset === changeset.id ? { stagedHere: true as const } : {}),
        ...(answered ? { answersPeerPattern: answered } : {}),
        ...(wired
          ? {
              contradictedBy: {
                source: wired.relationship.source,
                predicate: wired.relationship.predicate,
                target: wired.relationship.target,
              },
            }
          : {}),
      });
    }
  }

  const unwired =
    unwiredMode === "none"
      ? undefined
      : presentUnwired(computeUnwired(graph), unwiredMode, new Set(reach.touched), unwiredLayers);
  // Intent: changed elements outside the intent layers should reach one within a few hops.
  const traced: IntentTrace[] = [];
  const untraced: string[] = [];
  const unanchored: UnanchoredTrace[] = [];
  const noCatalogRoute: string[] = [];
  const intentWalk = new IntentWalk(graph, hubThreshold, maxHops);
  let intentElements = 0;
  let deletions = 0;
  for (const element of changed) {
    if (element.status === "deleted") {
      deletions++;
      continue;
    }
    if (INTENT_LAYERS.has(element.layer)) {
      intentElements++;
      continue;
    }
    const result = intentWalk.trace(element.id);
    if (result.traced) {
      traced.push({ element: element.id, ...result.traced });
    } else if (result.unanchored) {
      untraced.push(element.id);
      const { id, path } = result.unanchored;
      unanchored.push({
        element: element.id,
        tracesTo: id,
        path,
        detail: `traces to added intent element ${id}, which traces to nothing`,
      });
    } else if (hasCatalogRouteToIntent(specNodeId(element))) {
      untraced.push(element.id);
    } else {
      // No relationship of its own can reach intent: only a neighbour's can.
      noCatalogRoute.push(element.id);
    }
  }
  const intentNote = nothingToTraceNote(changed.length, intentElements, deletions);
  // What the hub rule costs: the elements it leaves untraced that reach intent once hubs are walked through.
  const withoutHubRule = new IntentWalk(graph, Number.POSITIVE_INFINITY, maxHops);
  const anchoredElsewhere = new Set(unanchored.map((u) => u.element));
  // Only routes the carrier rule allows: one that climbs to a carrier and then runs down to another of
  // its parts or realizers would trace a sibling through that sibling, which no hubThreshold should do.
  const blockedByHub = [...untraced, ...noCatalogRoute].filter((id) => {
    if (anchoredElsewhere.has(id)) return false;
    const traced = withoutHubRule.trace(id).traced;
    return !!traced && !climbsThenDescends(graph, traced.path);
  });

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
    acceptedGaps,
    ...(unwired ? { unwired } : {}),
    intent: {
      traced,
      untraced,
      ...(unanchored.length > 0 ? { unanchored } : {}),
      ...(noCatalogRoute.length > 0 ? { noCatalogRoute } : {}),
      ...(intentNote ? { note: intentNote } : {}),
      walk: { maxHops, hubThreshold, blockedByHub },
    },
    codeTouched,
    feedback,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeChange(graph: ChangesetGraph, element: GraphElement, origin?: string): BriefElementChange {
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
    ...(origin ? { origin } : {}),
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

/** Predicates from a whole to its part: a part exists for its whole, so it traces when the whole does. */
const WHOLE_PREDICATES = new Set(["composes", "aggregates"]);

/**
 * Whether a neighbour carries an element's trace: a whole that composes or aggregates it, or what it
 * realizes. An element exists to make concrete what it realizes, so it traces when that does.
 */
const carries = (n: Neighbor): boolean =>
  n.direction === "in" ? WHOLE_PREDICATES.has(n.relationship.predicate) : n.relationship.predicate === "realizes";

/**
 * The opposite: a neighbour that hangs from the element (its part, or what realizes it). A carrier's
 * own trace must not run down to one of these, or one part (one function) would carry all the others.
 */
const hangsFrom = (n: Neighbor): boolean =>
  n.direction === "out" ? WHOLE_PREDICATES.has(n.relationship.predicate) : n.relationship.predicate === "realizes";

type TraceResult = {
  traced?: Omit<IntentTrace, "element">;
  unanchored?: { id: string; path: string[] };
};

/**
 * The intent trace: a breadth-first walk from a changed element to the nearest intent element,
 * at most `maxHops` hops (default INTENT_TRACE_DEPTH), that does not walk through hubs (elements with more than
 * `hubThreshold` live relationships; a hub can still be reached). An existing intent element ends
 * the walk. An intent element the changeset adds ends it only when it is anchored, i.e. it traces
 * the same way to an existing intent element; an unanchored one is remembered and walked through.
 *
 * An element that walk leaves untraced still traces when something that does carries it: the
 * wholes that compose or aggregate it, and what it realizes, are followed upward at any depth and
 * through hubs (a whole with many parts, or a service many functions realize, is a hub by nature).
 * The nearest one that traces in its own right carries it: by its walk, not counting a route down
 * through one of its own parts or of the elements that realize it. No other relationship is followed
 * through a hub.
 */
class IntentWalk {
  private readonly anchors = new Map<string, { id: string; path: string[] } | null>();
  private readonly own = new Map<string, TraceResult>();
  private readonly asWhole = new Map<string, TraceResult>();

  constructor(
    private readonly graph: ChangesetGraph,
    private readonly hubThreshold: number,
    private readonly maxHops: number = INTENT_TRACE_DEPTH
  ) {}

  trace(start: string): TraceResult {
    const own = this.traceOwn(start);
    if (own.traced) return own;
    const carried = this.traceThroughCarrier(start);
    if (carried.traced) return carried;
    const unanchored = own.unanchored ?? carried.unanchored;
    return unanchored ? { unanchored } : {};
  }

  /** The nearest carrier of `start` (a whole, or what it realizes) that traces in its own right, with the path up to it and on. */
  private traceThroughCarrier(start: string): TraceResult {
    const parent = new Map<string, string>();
    const visited = new Set([start]);
    const chainTo = (id: string): string[] => {
      const chain = [id];
      for (let at = parent.get(id); at !== undefined; at = parent.get(at)) chain.unshift(at);
      return chain;
    };
    let unanchored: { id: string; path: string[] } | undefined;
    let frontier = [start];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const n of this.graph.neighbors(id)) {
          if (!carries(n) || visited.has(n.other)) continue;
          visited.add(n.other);
          const whole = this.graph.getElement(n.other);
          if (!whole || whole.status === "deleted") continue;
          parent.set(whole.id, id);
          const chain = chainTo(whole.id);
          // A carrier in an intent layer is itself the intent: the bounded walk already found it
          // unless it sits past a hub or deeper than the walk goes.
          const result: TraceResult = INTENT_LAYERS.has(whole.layer)
            ? this.intentHit(whole, [whole.id])
            : this.traceAsWhole(whole.id);
          if (result.traced) {
            const path = [...chain.slice(0, -1), ...result.traced.path];
            return { traced: { ...result.traced, distance: path.length - 1, path, through: whole.id } };
          }
          if (result.unanchored) {
            unanchored ??= { id: result.unanchored.id, path: [...chain.slice(0, -1), ...result.unanchored.path] };
          }
          next.push(whole.id);
        }
      }
      frontier = next;
    }
    return unanchored ? { unanchored } : {};
  }

  /** An intent element reached directly: traced when it exists or is anchored, else unanchored. */
  private intentHit(element: GraphElement, path: string[]): TraceResult {
    if (element.status !== "added") return { traced: { tracesTo: element.id, distance: path.length - 1, path } };
    const anchor = this.anchorOf(element.id);
    return anchor
      ? { traced: { tracesTo: element.id, distance: path.length - 1, path, anchoredBy: anchor } }
      : { unanchored: { id: element.id, path } };
  }

  /** The bounded walk from `start`, remembered. */
  private traceOwn(start: string): TraceResult {
    const known = this.own.get(start);
    if (known) return known;
    const result = this.walkToIntent(start, false);
    this.own.set(start, result);
    return result;
  }

  /**
   * Whether a carrier traces in its own right, remembered (it is asked once for all it carries): its
   * bounded walk, but not down to its own parts or to what realizes it. A whole that reaches intent
   * only through one part (a part a service accesses) does not carry the other parts there, nor a
   * service that reaches it only through one function the others that realize it.
   */
  private traceAsWhole(start: string): TraceResult {
    const known = this.asWhole.get(start);
    if (known) return known;
    const result = this.walkToIntent(start, true);
    this.asWhole.set(start, result);
    return result;
  }

  private walkToIntent(start: string, skipOwnParts: boolean): TraceResult {
    let unanchored: { id: string; path: string[] } | undefined;
    const hit = this.walk(
      start,
      (element, path) => {
        if (element.status !== "added") return true;
        if (this.anchorOf(element.id)) return true;
        unanchored ??= { id: element.id, path };
        return false;
      },
      skipOwnParts
    );
    if (!hit) return unanchored ? { unanchored } : {};
    const anchor = this.graph.getElement(hit.id)?.status === "added" ? this.anchorOf(hit.id) : null;
    return {
      traced: {
        tracesTo: hit.id,
        distance: hit.path.length - 1,
        path: hit.path,
        ...(anchor ? { anchoredBy: anchor } : {}),
      },
    };
  }

  /** The existing intent element an added intent element traces to, or null. */
  private anchorOf(id: string): { id: string; path: string[] } | null {
    if (this.anchors.has(id)) return this.anchors.get(id)!;
    this.anchors.set(id, null); // a cycle back to it finds nothing
    const hit = this.walk(id, (element) => element.status !== "added");
    this.anchors.set(id, hit);
    return hit;
  }

  /**
   * Walks from `start` and returns the first intent element `accept` takes, with the path to it.
   * Intent elements it refuses are walked through like any other.
   */
  private walk(
    start: string,
    accept: (element: GraphElement, path: string[]) => boolean,
    skipOwnParts = false
  ): { id: string; path: string[] } | null {
    const parent = new Map<string, string>();
    const visited = new Set([start]);
    const pathTo = (id: string): string[] => {
      const path = [id];
      for (let at = parent.get(id); at !== undefined; at = parent.get(at)) path.unshift(at);
      return path;
    };
    let frontier = [start];
    for (let distance = 1; distance <= this.maxHops && frontier.length > 0; distance++) {
      const next: string[] = [];
      for (const id of frontier) {
        if (id !== start && this.graph.neighbors(id).length > this.hubThreshold) continue;
        for (const n of this.graph.neighbors(id)) {
          if (visited.has(n.other)) continue;
          if (skipOwnParts && id === start && hangsFrom(n)) continue;
          visited.add(n.other);
          const element = this.graph.getElement(n.other);
          if (!element || element.status === "deleted") continue;
          parent.set(element.id, id);
          if (INTENT_LAYERS.has(element.layer) && accept(element, pathTo(element.id))) {
            return { id: element.id, path: pathTo(element.id) };
          }
          next.push(element.id);
        }
      }
      frontier = next;
    }
    return null;
  }
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
function peerPatternGaps(graph: ChangesetGraph, element: GraphElement, answered?: Map<string, string>): BriefGap[] {
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
        shape,
        gap: {
          kind: "peer-pattern" as const,
          element: element.id,
          detail: `${entry.peers.size} of ${peers.size} existing ${type} elements wired like this one have ${connection}; this one has none.`,
          examples: entry.examples,
          connection: { direction: direction as "out" | "in", predicate, otherType },
        },
      };
    })
    .filter(({ shape, gap }) => {
      // An accepted gap with this triple answers it: not an open gap.
      const [direction, predicate, otherType] = shape.split("|");
      if (!findAcceptedGap(element.acceptedGaps, direction as "out" | "in", predicate, otherType)) return true;
      answered?.set(`${element.id}|${shape}`, gap.detail);
      return false;
    })
    .map(({ gap }) => gap);
}

/**
 * Unwired connections of every added or updated element: each triple the catalog defines with the
 * element's type at one end, for which the element has no live relationship with that predicate
 * to (or from) an element of the other end's type. Only catalog triples are considered.
 */
export function computeUnwired(graph: ChangesetGraph): ElementUnwired[] {
  // Existing (base, updated or not) and added elements per type, counted apart.
  const existing = new Map<string, number>();
  const added = new Map<string, number>();
  for (const element of graph.elements.values()) {
    if (element.status === "deleted") continue;
    const counts = element.status === "added" ? added : existing;
    const type = specNodeId(element);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  // Connections the model already carries: `type|direction|predicate|otherType` for each base
  // relationship (one the change deletes included), from both ends. A link some existing element of the type has is one the type is
  // expected to have in this model; a catalog triple none carries is optional.
  const carried = new Set<string>();
  for (const rel of graph.relationships()) {
    if (rel.status === "added") continue;
    const source = graph.getElement(rel.source);
    const target = graph.getElement(rel.target);
    if (!source || !target) continue;
    carried.add(`${specNodeId(source)}|out|${rel.predicate}|${specNodeId(target)}`);
    carried.add(`${specNodeId(target)}|in|${rel.predicate}|${specNodeId(source)}`);
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
    const accepted = new Map<string, AcceptedUnwired>();
    const consider = (direction: "out" | "in", predicate: string, otherType: string, spec: RelationshipSpec) => {
      const key = `${direction}|${predicate}|${otherType}`;
      if (have.has(key) || entries.has(key) || accepted.has(key)) return;
      // Accepted as a gap: decided against, so listed apart with the reason and not counted.
      const gap = findAcceptedGap(element.acceptedGaps, direction, predicate, otherType);
      if (gap) {
        accepted.set(key, { direction, predicate, otherType, reason: gap.reason });
        return;
      }
      const self = otherType === type ? 1 : 0;
      const existingCount = (existing.get(otherType) ?? 0) - (element.status === "added" ? 0 : self);
      const addedCount = (added.get(otherType) ?? 0) - (element.status === "added" ? self : 0);
      entries.set(key, { direction, predicate, otherType, existingCount, addedCount, expected: isExpectedLink(spec) || carried.has(`${type}|${key}`) });
    };
    for (const spec of RELATIONSHIPS_BY_SOURCE.get(type) ?? []) consider("out", spec.predicate, spec.destinationSpecNodeId, spec);
    for (const spec of RELATIONSHIPS_BY_DESTINATION.get(type) ?? []) consider("in", spec.predicate, spec.sourceSpecNodeId, spec);

    const layerOf = (specId: string) => specId.split(".")[0];
    const all = [...entries.values()];
    const byLayer = orderedLayers(all.map((e) => layerOf(e.otherType))).map((layer) => ({
      layer,
      entries: all
        .filter((e) => layerOf(e.otherType) === layer)
        .sort(
          (a, b) =>
            Number(b.expected) - Number(a.expected) ||
            (a.direction === b.direction ? 0 : a.direction === "out" ? -1 : 1) ||
            a.predicate.localeCompare(b.predicate) ||
            a.otherType.localeCompare(b.otherType)
        ),
    }));
    result.push({
      element: element.id,
      type,
      byLayer,
      ...(isPreexisting(graph, element) ? { preexisting: true as const } : {}),
      ...(accepted.size > 0 ? { accepted: [...accepted.values()] } : {}),
    });
  }
  return result;
}

/**
 * A link the catalog itself expects of an element of the type: marked required, or of high or
 * critical strength. The layer rules have no structured form yet, so this is what the spec carries;
 * `computeUnwired` adds the links the model's existing elements of the type already have.
 */
function isExpectedLink(spec: RelationshipSpec): boolean {
  return spec.required || spec.strength === "high" || spec.strength === "critical";
}

/**
 * An updated element the change leaves with the connections it had: its type is unchanged and no
 * relationship of it is added or deleted. What is unwired on it was unwired before the change.
 */
function isPreexisting(graph: ChangesetGraph, element: GraphElement): boolean {
  if (element.status !== "updated") return false;
  const beforeType = element.before?.type;
  if (typeof beforeType === "string" && beforeType !== element.type) return false;
  return graph.neighbors(element.id, { includeDeleted: true }).every((n) => n.relationship.status === "unchanged");
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

  const elements = computed.map(({ element, type, byLayer, accepted, preexisting }) => {
    const acceptedShown = (accepted ?? []).filter((a) => !filter || filter.has(a.otherType.split(".")[0]));
    let optional = 0;
    const shown = byLayer
      .filter((l) => !filter || filter.has(l.layer))
      .map((l) => {
        const expected = l.entries.filter((e) => e.expected);
        const count = expected.length;
        const optionalCount = l.entries.length - count;
        optional += optionalCount;
        const optionalNote = optionalCount > 0 ? { optional: optionalCount } : {};
        if (mode === "full") return { layer: l.layer, count, ...optionalNote, entries: l.entries };
        // Summary: list only expected connections to types the projected model has; count the rest.
        const inModel = expected.filter((e) => e.existingCount + e.addedCount > 0);
        const typesNotInModel = count - inModel.length;
        const withEntries = reachedLayers.has(l.layer) || !!filter?.has(l.layer);
        return {
          layer: l.layer,
          count,
          ...optionalNote,
          ...(withEntries ? { entries: inModel } : {}),
          ...(typesNotInModel > 0 ? { typesNotInModel } : {}),
        };
      })
      // A layer with only optional triples has nothing to list or count as expected.
      .filter((l) => l.count > 0 || mode === "full");
    return {
      element,
      type,
      total: shown.reduce((sum, l) => sum + l.count, 0),
      optional,
      ...(preexisting ? { preexisting } : {}),
      byLayer: shown,
      ...(acceptedShown.length > 0 ? { accepted: acceptedShown } : {}),
    };
  });
  // Elements whose changes bring the links come first; the pre-existing ones after, in their order.
  elements.sort((a, b) => Number(!!a.preexisting) - Number(!!b.preexisting));

  const totals = { expected: 0, optional: 0, preexisting: 0 };
  for (const e of elements) {
    totals.optional += e.optional;
    if (e.preexisting) totals.preexisting += e.total;
    else totals.expected += e.total;
  }

  return {
    mode,
    totals,
    ...(layerFilter ? { layers: layerFilter } : {}),
    ...(unknownLayers.length > 0 ? { unknownLayers } : {}),
    elements,
  };
}

/** Key of one unwired entry of one element, for comparing two briefs. */
export function unwiredKey(element: string, entry: Pick<UnwiredEntry, "direction" | "predicate" | "otherType">): string {
  return `${element}|${entry.direction}|${entry.predicate}|${entry.otherType}`;
}

/**
 * Whether a trace path goes up to a carrier (a whole, or what an element realizes) and later down to
 * one of a carrier's own parts or realizers: the route the carrier rule does not let a sibling take.
 */
function climbsThenDescends(graph: ChangesetGraph, path: string[]): boolean {
  let climbed = false;
  for (let i = 0; i + 1 < path.length; i++) {
    const steps = graph.neighbors(path[i]).filter((n) => n.other === path[i + 1]);
    if (steps.some(carries)) climbed = true;
    else if (climbed && steps.some(hangsFrom)) return true;
  }
  return false;
}

let intentRouteTypes: Set<string> | undefined;

/**
 * Whether the relationship catalog defines any relationship, in either direction, between this node
 * type (`layer.type`) and a motivation, business or product type. An element of a type without one
 * (a sub-view, a schema composition, an application component) has no relationship of its own to
 * add: it traces to intent only through a neighbour, so the brief does not count it as untraced.
 */
export function hasCatalogRouteToIntent(specNodeId: string): boolean {
  if (!intentRouteTypes) {
    const layerOf = (id: string) => id.split(".")[0];
    intentRouteTypes = new Set();
    for (const [source, specs] of RELATIONSHIPS_BY_SOURCE) {
      for (const spec of specs) {
        if (INTENT_LAYERS.has(layerOf(spec.destinationSpecNodeId))) intentRouteTypes.add(source);
        if (INTENT_LAYERS.has(layerOf(source))) intentRouteTypes.add(spec.destinationSpecNodeId);
      }
    }
  }
  return intentRouteTypes.has(specNodeId);
}

/** Why the intent lists are empty, when no changed element was one the trace covers. */
function nothingToTraceNote(changed: number, intentElements: number, deletions: number): string | undefined {
  if (changed === 0 || intentElements + deletions < changed) return undefined;
  const what =
    changed === 1
      ? `the one changed element is ${deletions === 1 ? "a deletion" : "a motivation, business or product element"}`
      : deletions === 0
        ? `all ${changed} changed elements are motivation, business or product elements`
        : intentElements === 0
          ? `all ${changed} changed elements are deletions`
          : `${intentElements} of the ${changed} changed elements are motivation, business or product elements and the other ${deletions} are deletions`;
  return (
    `Nothing to trace: ${what}. Intent traces the added and updated elements of the other layers up to a ` +
    "goal, requirement or feature; the intent elements themselves are what those trace to, and are not listed."
  );
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
