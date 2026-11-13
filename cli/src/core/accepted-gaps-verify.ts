/**
 * Accepted gaps in verification and extraction (#1026): an accepted gap that the build or the code
 * contradicts.
 *
 * Extraction (`splitByAcceptedGaps`): a relationship the edge mapping gives that matches an
 * accepted gap on either end is not staged, and is reported as contradicted.
 *
 * A plan's accepted gaps are the `accepted_gaps` on the elements it adds or updates, as the plan
 * leaves them. The build contradicts one when its counterpart of the element (the element verify
 * matched it to, else the element with the same id) has a relationship with the gap's triple: the
 * code shows the connection the plan decided was absent. Either the decision is stale or the code
 * drifted from the plan; `changeset_verify` reports it like a divergent element when it is the
 * plan's doing: the gap was staged in this plan, or the build added the contradicting relationship.
 * A gap the element inherited from the base, contradicted by a relationship the build didn't add, is
 * an older inconsistency the plan didn't cause: it is reported (`preexisting`), not held against the
 * plan.
 */

import {
  acceptedGapView,
  contradictedGaps,
  findAcceptedGap,
  type AcceptedGap,
  type AcceptedGapView,
} from "./accepted-gaps.js";
import type { ChangesetGraph } from "./changeset-graph.js";
import { normalizeNodeType } from "../generated/node-types.js";

export interface ContradictedGap extends AcceptedGapView {
  /** The planned element the gap is on. */
  element: string;
  /** Its counterpart in the build. */
  builtElement: string;
  /** The built relationship that has the gap's triple. */
  evidence: { source: string; predicate: string; target: string };
}

export interface AcceptedGapsCheck {
  /** Accepted gaps on the plan's added and updated elements. */
  checked: number;
  /**
   * Gaps the build contradicts because of this plan: the gap was staged in it, or the build added
   * the contradicting relationship. These make the verdict `diverges`.
   */
  contradicted: ContradictedGap[];
  /**
   * Gaps inherited from the base that a relationship the build didn't add contradicts: an older
   * inconsistency, reported for information. Absent when there are none.
   */
  preexisting?: ContradictedGap[];
}

/** A relationship extraction would stage that an accepted gap says is deliberately absent. */
export interface ContradictedByCode extends AcceptedGapView {
  /** The element the gap is on. */
  element: string;
  /** The relationship the code shows, not staged. */
  evidence: { source: string; predicate: string; target: string; edge?: string };
}

/**
 * Splits the relationships extraction would stage into those to stage and those an accepted gap on
 * either end contradicts. A contradicted one is not staged (the gap is not filled silently) and is
 * reported: the decision is stale or the code drifted. `typeOf` gives an element's `layer.type`;
 * `gapsOf` its accepted gaps as the model (with the changeset) leaves them.
 */
export function splitByAcceptedGaps<R extends { source: string; predicate: string; target: string; edge?: string }>(
  relationships: readonly R[],
  typeOf: (id: string) => string | undefined,
  gapsOf: (id: string) => readonly AcceptedGap[] | undefined
): { kept: R[]; contradicted: ContradictedByCode[] } {
  const kept: R[] = [];
  const contradicted: ContradictedByCode[] = [];
  const onEnd = (element: string, direction: "out" | "in", otherType: string | undefined, predicate: string) => {
    const gap = otherType ? findAcceptedGap(gapsOf(element), direction, predicate, otherType) : undefined;
    return gap ? { element, gap } : undefined;
  };
  for (const r of relationships) {
    const hit = onEnd(r.source, "out", typeOf(r.target), r.predicate) ?? onEnd(r.target, "in", typeOf(r.source), r.predicate);
    if (!hit) {
      kept.push(r);
      continue;
    }
    contradicted.push({
      element: hit.element,
      ...acceptedGapView(hit.gap),
      evidence: { source: r.source, predicate: r.predicate, target: r.target, ...(r.edge ? { edge: r.edge } : {}) },
    });
  }
  return { kept, contradicted };
}

/** A model element as the route check needs it. */
export interface LocatedElement {
  id: string;
  path?: string;
  layer: string;
  type: string;
  locations: Array<{ file?: string; symbol?: string }>;
  acceptedGaps?: readonly AcceptedGap[];
}

/** An accepted gap the code's route handler contradicts (codebase_verify). */
export interface ContradictedByHandler extends AcceptedGapView {
  /** The element the gap is on: the operation, or the handler (a gap seen from its side). */
  element: string;
  /** The route's handler, and the model element that holds it; the operation it handles. */
  evidence: { file: string; symbol: string; handledBy: string; handledByType: string; operation: string };
}

/** The triple extraction maps a route's HANDLES edge to: the operation realizes the handler function. */
const HANDLER_TYPE = "application.applicationfunction";
const OPERATION_TYPE = "api.operation";

/**
 * Accepted gaps on matched API elements, or on their handlers, that the code contradicts: the code
 * routes the operation to a handler (its file and symbol) that the model holds as an application
 * function, and either the operation accepted the gap `--realizes--> application.applicationfunction`
 * or the handler accepted `<--realizes-- api.operation` (the triple a route's HANDLES edge maps to,
 * seen from either end, as extraction checks it). The analyzer graph ties the two together, so the
 * decision that they don't connect is stale or the code drifted. A handler-side gap is reported
 * against the handler.
 */
export function routeHandlerContradictions(
  matched: ReadonlyArray<{ id: string; source_file: string; source_symbol: string }>,
  elements: readonly LocatedElement[]
): ContradictedByHandler[] {
  const byId = new Map<string, LocatedElement>();
  for (const e of elements) {
    byId.set(e.id, e);
    if (e.path) byId.set(e.path, e);
  }
  const typeOf = (e: LocatedElement) => `${e.layer}.${normalizeNodeType(e.layer, e.type)}`;
  const result: ContradictedByHandler[] = [];
  for (const m of matched) {
    const operation = byId.get(m.id);
    if (!operation || !m.source_file || !m.source_symbol) continue;
    const handlers = elements.filter(
      (e) =>
        e !== operation &&
        typeOf(e) === HANDLER_TYPE &&
        e.locations.some((l) => l.file === m.source_file && l.symbol === m.source_symbol)
    );
    if (handlers.length === 0) continue;
    const evidenceFor = (handler: LocatedElement) => ({
      file: m.source_file,
      symbol: m.source_symbol,
      handledBy: handler.path ?? handler.id,
      handledByType: typeOf(handler),
      operation: operation.path ?? operation.id,
    });
    // A route's handler is the connection extraction maps HANDLES to; a gap on any other triple
    // says nothing about it.
    const fromOperation = findAcceptedGap(operation.acceptedGaps, "out", "realizes", HANDLER_TYPE);
    if (fromOperation) {
      result.push({ element: operation.path ?? operation.id, ...acceptedGapView(fromOperation), evidence: evidenceFor(handlers[0]) });
    }
    if (typeOf(operation) !== OPERATION_TYPE) continue;
    for (const handler of handlers) {
      const fromHandler = findAcceptedGap(handler.acceptedGaps, "in", "realizes", OPERATION_TYPE);
      if (fromHandler) {
        result.push({ element: handler.path ?? handler.id, ...acceptedGapView(fromHandler), evidence: evidenceFor(handler) });
      }
    }
  }
  return result;
}

interface BuiltLike {
  elements: Array<{ id: string; layer: string; type: string }>;
  /** `change` is "added" for a relationship the build added; anything else was already there. */
  relationships: Array<{ source: string; predicate: string; target: string; change?: string }>;
  /**
   * What the build changed, when known. A snapshot built side (an extraction scoped to the
   * branch's diff) marks its changes only here, so a relationship is also added when it is listed
   * here as added.
   */
  changedRelationships?: Array<{ source: string; predicate: string; target: string; change?: string }>;
}

/**
 * Checks the plan's accepted gaps against the built side. `counterpart` maps a planned element id to
 * the built element it was matched to; an unmatched one is looked up by its own id. `planId` is the
 * plan's changeset id: a gap staged in it, or one a relationship the build added contradicts, counts
 * against the plan (`contradicted`); the rest are `preexisting`.
 */
export function checkPlanAcceptedGaps(
  plan: ChangesetGraph,
  built: BuiltLike,
  counterpart: Map<string, string>,
  planId: string
): AcceptedGapsCheck {
  const typeOf = new Map(built.elements.map((e) => [e.id, `${e.layer}.${normalizeNodeType(e.layer, e.type)}`]));
  const relKey = (r: { source: string; predicate: string; target: string }) => `${r.source}::${r.predicate}::${r.target}`;
  const addedKeys = new Set(
    (built.changedRelationships ?? []).filter((r) => (r.change ?? "added") === "added").map(relKey)
  );
  const result: AcceptedGapsCheck = { checked: 0, contradicted: [] };
  const preexisting: ContradictedGap[] = [];
  for (const element of plan.changedElements()) {
    if (element.status === "deleted" || !element.acceptedGaps?.length) continue;
    result.checked += element.acceptedGaps.length;
    const builtId = counterpart.get(element.id) ?? element.id;
    if (!typeOf.has(builtId)) continue;
    type Edge = {
      source: string;
      predicate: string;
      target: string;
      direction: "out" | "in";
      otherType: string;
      added: boolean;
    };
    const edges = built.relationships.flatMap((r): Edge[] => {
      const added = r.change === "added" || addedKeys.has(relKey(r));
      if (r.source === builtId && typeOf.has(r.target)) {
        return [{ source: r.source, predicate: r.predicate, target: r.target, direction: "out", otherType: typeOf.get(r.target)!, added }];
      }
      if (r.target === builtId && typeOf.has(r.source)) {
        return [{ source: r.source, predicate: r.predicate, target: r.target, direction: "in", otherType: typeOf.get(r.source)!, added }];
      }
      return [];
    });
    // Prefer a relationship the build added as the evidence, so a gap it contradicts is counted
    // against the plan even when an older relationship has the same triple.
    const hits = contradictedGaps(element.acceptedGaps, edges.filter((e) => e.added));
    const hitGaps = new Set(hits.map((h) => h.gap));
    const rest = element.acceptedGaps.filter((g) => !hitGaps.has(g));
    hits.push(...contradictedGaps(rest, edges.filter((e) => !e.added)));
    for (const { gap, edge } of hits) {
      const found: ContradictedGap = {
        element: element.id,
        builtElement: builtId,
        ...acceptedGapView(gap),
        evidence: { source: edge.source, predicate: edge.predicate, target: edge.target },
      };
      if (gap.changeset === planId || edge.added) result.contradicted.push(found);
      else preexisting.push(found);
    }
  }
  if (preexisting.length > 0) result.preexisting = preexisting;
  return result;
}
