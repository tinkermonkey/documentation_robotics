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
 * `directionality_transform` are the only preference.
 *
 * `conditions.from_types` / `conditions.to_types`, when present, restrict the element types the
 * CBM edge's source and target may have ("layer.type", or "layer.*" for any type of a layer); an
 * edge between other types creates no relationship, whatever the catalog holds.
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
        return { predicate: (p as { predicate: string }).predicate, invert: (p as { invert?: unknown }).invert === true };
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

/** Whether an edge mapping allows an edge between these two element types (CBM direction). */
export function edgeAllowed(m: AnalyzerEdgeMapping, fromType: string, toType: string): boolean {
  const c = (m.conditions ?? {}) as { from_types?: unknown; to_types?: unknown };
  return typeAllowed(c.from_types, fromType) && typeAllowed(c.to_types, toType);
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
  if (!edgeAllowed(m, fromType, toType)) return null;
  for (const pref of edgePreferences(m)) {
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
