/**
 * Turn a CBM edge between two classified symbols into a DR relationship.
 *
 * An edge mapping (spec/analyzers/<name>/edge-mapping.json) that creates relationships
 * (`usage: "verification_and_mapping"`) lists, in `conditions.predicates`, the predicates that can
 * express it in order of preference, each optionally inverted (the DR relationship runs against
 * the CBM edge). The relationship is the first catalog triple
 * `{source type}.{predicate}.{destination type}` that exists for the two element types the ends
 * were classified as; the relationship catalog stays the authority on which triples are valid.
 * Without `conditions.predicates` the mapping's own `dr_relationship` and
 * `directionality_transform` are the only preference. A preference may carry its own `from_types`
 * / `to_types`: it applies only between those types (CALLS from a test case is `tests`).
 *
 * `conditions.from_types` / `conditions.to_types`, when present, restrict the element types the
 * CBM edge's source and target may have ("layer.type", or "layer.*" for any type of a layer); an
 * edge between other types creates no relationship, whatever the catalog holds. A preference that
 * names both its own `from_types` and `to_types` is a scoped pair: the mapping-level restriction
 * does not apply to it, so one edge can map a second, unrelated pair of types (USAGE from a
 * technology node to the image it runs is `composes`, while USAGE otherwise reaches only data).
 *
 * Example: CALLS prefers depends-on, then uses, then accesses. A call from an
 * application.applicationfunction to another becomes
 * application.applicationfunction.depends-on.application.applicationfunction; a call from an
 * application.applicationservice to an application.dataobject has no depends-on or uses triple and
 * becomes application.applicationservice.accesses.application.dataobject.
 *
 * Callers pass only edges between two different accepted elements, and should collapse duplicates
 * with dedupeRelationships: CALLS, CALL_REFERENCE and USAGE can all link the same pair.
 */
import type { AnalyzerEdgeMapping } from "./types.js";

export interface EdgePreference {
  predicate: string;
  /** true when the DR relationship runs from the CBM edge's target to its source */
  invert: boolean;
  /** Only when the CBM edge's source is one of these types ("layer.type" or "layer.*"). */
  from_types?: string[];
  /** Only when the CBM edge's target is one of these types. */
  to_types?: string[];
}

export interface EdgeRelationship {
  id: string;
  source: string;
  predicate: string;
  destination: string;
  inverted: boolean;
}

/** The predicates an edge mapping may use, in order of preference. */
export function edgePreferences(m: AnalyzerEdgeMapping): EdgePreference[] {
  if (m.usage !== "verification_and_mapping") return [];
  const listed = (m.conditions as { predicates?: unknown } | undefined)?.predicates;
  if (Array.isArray(listed) && listed.length) {
    return listed.map((p, i) => {
      if (typeof p === "string") return { predicate: p, invert: false };
      if (p && typeof p === "object" && typeof (p as { predicate?: unknown }).predicate === "string") {
        const o = p as { predicate: string; invert?: unknown; from_types?: unknown; to_types?: unknown };
        const types = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : undefined);
        const from = types(o.from_types);
        const to = types(o.to_types);
        return { predicate: o.predicate, invert: o.invert === true, ...(from ? { from_types: from } : {}), ...(to ? { to_types: to } : {}) };
      }
      throw new Error(`Edge mapping ${m.cbm_edge}: conditions.predicates[${i}] must be a predicate name or {predicate, invert}`);
    });
  }
  return m.dr_relationship ? [{ predicate: m.dr_relationship, invert: m.directionality_transform === "invert" }] : [];
}

function typeAllowed(allowed: unknown, type: string): boolean {
  if (!Array.isArray(allowed) || !allowed.length) return true;
  return allowed.some((a) => typeof a === "string" && (a === type || (a.endsWith(".*") && type.startsWith(a.slice(0, -1)))));
}

/** A preference naming both ends' types: the mapping-level from_types / to_types don't apply to it. */
function isScopedPair(p: EdgePreference): boolean {
  return !!p.from_types?.length && !!p.to_types?.length;
}

function prefAllows(p: EdgePreference, fromType: string, toType: string): boolean {
  return typeAllowed(p.from_types, fromType) && typeAllowed(p.to_types, toType);
}

/** Whether the mapping-level from_types / to_types allow these two element types (CBM direction). */
function mappingAllows(m: AnalyzerEdgeMapping, fromType: string, toType: string): boolean {
  const c = (m.conditions ?? {}) as { from_types?: unknown; to_types?: unknown };
  return typeAllowed(c.from_types, fromType) && typeAllowed(c.to_types, toType);
}

/**
 * Whether an edge mapping allows an edge between these two element types (CBM direction): its
 * mapping-level types do, or one of its scoped-pair preferences names them.
 */
export function edgeAllowed(m: AnalyzerEdgeMapping, fromType: string, toType: string): boolean {
  return mappingAllows(m, fromType, toType) || edgePreferences(m).some((p) => isScopedPair(p) && prefAllows(p, fromType, toType));
}

/**
 * The relationship a CBM edge `from → to` becomes, given the DR element types its ends were
 * classified as, or null when no preferred predicate has a catalog triple for that pair.
 */
export function relationshipFor(
  m: AnalyzerEdgeMapping,
  fromType: string,
  toType: string,
  hasTriple: (id: string) => boolean
): EdgeRelationship | null {
  const allowed = mappingAllows(m, fromType, toType);
  for (const pref of edgePreferences(m)) {
    if (!prefAllows(pref, fromType, toType)) continue;
    if (!allowed && !isScopedPair(pref)) continue;
    const [source, destination] = pref.invert ? [toType, fromType] : [fromType, toType];
    const id = `${source}.${pref.predicate}.${destination}`;
    if (hasTriple(id)) return { id, source, predicate: pref.predicate, destination, inverted: pref.invert };
  }
  return null;
}

/**
 * One relationship per (source element, relationship id, destination element), keeping the first.
 * `items` carry the element ids of the two ends alongside the relationship.
 */
export function dedupeRelationships<T extends { sourceId: string; destinationId: string; relationship: EdgeRelationship }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    if (x.sourceId === x.destinationId) return false;
    const key = `${x.sourceId}|${x.relationship.id}|${x.destinationId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
