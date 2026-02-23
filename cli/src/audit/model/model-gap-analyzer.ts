/**
 * Model Gap Analyzer - Identifies missing relationship instances in the model
 *
 * For each spec-defined relationship type (source_spec_node_id → predicate → dest_spec_node_id):
 * - If both endpoint spec_node_ids have at least one element instance in the model
 * - And zero instances of that (source_type, predicate, dest_type) combination exist
 * - → Report as a gap
 */

import { RELATIONSHIPS_BY_SOURCE } from "../../generated/relationship-index.js";
import type { Relationship } from "../../core/relationships.js";
import type { Element } from "../../core/element.js";
import type { GapCandidate } from "../types.js";

/**
 * Analyze gaps for a single layer
 */
export function analyzeLayerGaps(
  elements: Element[],
  intraLayerRels: Relationship[]
): GapCandidate[] {
  const candidates: GapCandidate[] = [];

  // Build set of spec_node_ids that have at least one element instance
  const presentSpecNodeIds = new Set<string>(
    elements.map((e) => e.spec_node_id).filter(Boolean)
  );

  // Build set of (source_spec_node_id, predicate, dest_spec_node_id) tuples already in use
  // We derive source spec_node_id from the source element and dest from the target element
  const elementById = new Map<string, Element>(
    elements.map((e) => [e.id, e])
  );

  const usedCombinations = new Set<string>();
  for (const rel of intraLayerRels) {
    const srcEl = elementById.get(rel.source);
    const dstEl = elementById.get(rel.target);
    if (srcEl?.spec_node_id && dstEl?.spec_node_id) {
      usedCombinations.add(
        `${srcEl.spec_node_id}|${rel.predicate}|${dstEl.spec_node_id}`
      );
    }
  }

  // Check each spec-defined relationship for the node types present in this layer
  for (const sourceSpecNodeId of presentSpecNodeIds) {
    const specRels = RELATIONSHIPS_BY_SOURCE.get(sourceSpecNodeId) ?? [];
    for (const specRel of specRels) {
      const { destinationSpecNodeId, predicate, strength } = specRel;

      // Only consider intra-layer gaps (same layer prefix)
      const srcLayer = sourceSpecNodeId.split(".")[0];
      const dstLayer = destinationSpecNodeId.split(".")[0];
      if (srcLayer !== dstLayer) {
        continue;
      }

      // Both sides must have instances in the model
      if (!presentSpecNodeIds.has(destinationSpecNodeId)) {
        continue;
      }

      // Skip if at least one instance of this combination already exists
      const key = `${sourceSpecNodeId}|${predicate}|${destinationSpecNodeId}`;
      if (usedCombinations.has(key)) {
        continue;
      }

      candidates.push({
        sourceNodeType: sourceSpecNodeId,
        destinationNodeType: destinationSpecNodeId,
        suggestedPredicate: predicate,
        reason: `No '${predicate}' relationship instances found between ${sourceSpecNodeId} and ${destinationSpecNodeId} in the model`,
        priority: mapStrengthToPriority(strength),
      });
    }
  }

  return candidates;
}

function mapStrengthToPriority(
  strength: "critical" | "high" | "medium" | "low"
): "high" | "medium" | "low" {
  if (strength === "critical" || strength === "high") {
    return "high";
  }
  if (strength === "medium") {
    return "medium";
  }
  return "low";
}
