/**
 * Model Coverage Analyzer - Coverage metrics from actual model relationship instances
 */

import type { Relationship } from "../../../core/relationships.js";
import type { Element } from "../../../core/element.js";
import { RelationshipCatalog } from "../../../core/relationship-catalog.js";
import type { CoverageMetrics } from "../../types.js";
import { createPercentage } from "../../types.js";

/**
 * Analyze relationship coverage for a single layer using model instances
 */
export function analyzeLayerCoverage(
  layerId: string,
  elements: Element[],
  intraLayerRels: Relationship[],
  catalog: RelationshipCatalog
): CoverageMetrics {
  // Distinct spec_node_ids present in this layer
  const specNodeIds = new Set<string>(
    elements.map((e) => e.spec_node_id).filter(Boolean)
  );
  const nodeTypeCount = specNodeIds.size;

  // Index elements by ID for O(1) lookups when processing relationships
  const elementById = new Map<string, Element>(elements.map((e) => [e.id, e]));

  // Count intra-layer relationship instances per spec_node_id (by source element's spec_node_id)
  const relCountBySpecNodeId = new Map<string, number>();
  const usedPredicatesSet = new Set<string>();

  for (const rel of intraLayerRels) {
    const sourceEl = elementById.get(rel.source);
    if (sourceEl?.spec_node_id) {
      relCountBySpecNodeId.set(
        sourceEl.spec_node_id,
        (relCountBySpecNodeId.get(sourceEl.spec_node_id) ?? 0) + 1
      );
    }
    usedPredicatesSet.add(rel.predicate);
  }

  const relationshipCount = intraLayerRels.length;

  // Isolated: spec_node_ids present in layer with zero intra-layer relationship instances
  const isolatedNodeTypes = Array.from(specNodeIds).filter(
    (id) => (relCountBySpecNodeId.get(id) ?? 0) === 0
  );
  const isolationPercentage = createPercentage(
    nodeTypeCount > 0 ? (isolatedNodeTypes.length / nodeTypeCount) * 100 : 0
  );

  // Available predicates for this layer from catalog
  const availablePredicates = catalog
    .getTypesForLayer(layerId)
    .map((t) => t.predicate);
  const availablePredicateSet = new Set(availablePredicates);

  // Only count predicates that the catalog defines for this layer
  const usedPredicates = Array.from(usedPredicatesSet).filter((p) =>
    availablePredicateSet.has(p)
  );

  const utilizationPercentage = createPercentage(
    availablePredicates.length > 0
      ? (usedPredicates.length / availablePredicates.length) * 100
      : 0
  );

  const relationshipsPerNodeType =
    nodeTypeCount > 0 ? relationshipCount / nodeTypeCount : 0;

  return {
    layer: layerId,
    nodeTypeCount,
    relationshipCount,
    isolatedNodeTypes,
    isolationPercentage,
    availablePredicates,
    usedPredicates,
    utilizationPercentage,
    relationshipsPerNodeType,
  };
}
