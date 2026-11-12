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
 * drifted from the plan; `changeset_verify` reports it like a divergent element.
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
  contradicted: ContradictedGap[];
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
  element: string;
  /** The route's handler, and the model element that holds it. */
  evidence: { file: string; symbol: string; handledBy: string; handledByType: string };
}

/**
 * Accepted gaps on matched API elements that the code contradicts: the code routes the operation to
 * a handler (its file and symbol) that the model holds as another element, and the operation
 * accepted a gap toward that element's type. The analyzer graph ties the two together, so the
 * decision that they don't connect is stale or the code drifted.
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
    if (!operation?.acceptedGaps?.length || !m.source_file || !m.source_symbol) continue;
    const handlers = elements.filter(
      (e) => e !== operation && e.locations.some((l) => l.file === m.source_file && l.symbol === m.source_symbol)
    );
    for (const gap of operation.acceptedGaps) {
      const handler = handlers.find((h) => typeOf(h) === gap.other_spec_node_id);
      if (!handler) continue;
      result.push({
        element: operation.path ?? operation.id,
        ...acceptedGapView(gap),
        evidence: {
          file: m.source_file,
          symbol: m.source_symbol,
          handledBy: handler.path ?? handler.id,
          handledByType: typeOf(handler),
        },
      });
    }
  }
  return result;
}

interface BuiltLike {
  elements: Array<{ id: string; layer: string; type: string }>;
  relationships: Array<{ source: string; predicate: string; target: string }>;
}

/**
 * Checks the plan's accepted gaps against the built side. `counterpart` maps a planned element id to
 * the built element it was matched to; an unmatched one is looked up by its own id.
 */
export function checkPlanAcceptedGaps(
  plan: ChangesetGraph,
  built: BuiltLike,
  counterpart: Map<string, string>
): AcceptedGapsCheck {
  const typeOf = new Map(built.elements.map((e) => [e.id, `${e.layer}.${normalizeNodeType(e.layer, e.type)}`]));
  const result: AcceptedGapsCheck = { checked: 0, contradicted: [] };
  for (const element of plan.changedElements()) {
    if (element.status === "deleted" || !element.acceptedGaps?.length) continue;
    result.checked += element.acceptedGaps.length;
    const builtId = counterpart.get(element.id) ?? element.id;
    if (!typeOf.has(builtId)) continue;
    type Edge = { source: string; predicate: string; target: string; direction: "out" | "in"; otherType: string };
    const edges = built.relationships.flatMap((r): Edge[] => {
      if (r.source === builtId && typeOf.has(r.target)) {
        return [{ source: r.source, predicate: r.predicate, target: r.target, direction: "out", otherType: typeOf.get(r.target)! }];
      }
      if (r.target === builtId && typeOf.has(r.source)) {
        return [{ source: r.source, predicate: r.predicate, target: r.target, direction: "in", otherType: typeOf.get(r.source)! }];
      }
      return [];
    });
    for (const { gap, edge } of contradictedGaps(element.acceptedGaps, edges)) {
      result.contradicted.push({
        element: element.id,
        builtElement: builtId,
        ...acceptedGapView(gap),
        evidence: { source: edge.source, predicate: edge.predicate, target: edge.target },
      });
    }
  }
  return result;
}
