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
 * Example: CALLS prefers depends-on, then uses, then accesses. A call from an
 * application.applicationprocess to an application.applicationfunction becomes
 * application.applicationprocess.depends-on.application.applicationfunction; a call from an
 * application.applicationservice to an application.dataobject has no depends-on or uses triple and
 * becomes application.applicationservice.accesses.application.dataobject.
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
  for (const pref of edgePreferences(m)) {
    const [source, destination] = pref.invert ? [toType, fromType] : [fromType, toType];
    const id = `${source}.${pref.predicate}.${destination}`;
    if (hasTriple(id)) return { id, source, predicate: pref.predicate, destination, inverted: pref.invert };
  }
  return null;
}
