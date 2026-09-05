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
  interLayerRels: Relationship[],
  catalog: RelationshipCatalog
): CoverageMetrics {
  // Distinct spec_node_ids present in this layer
  const specNodeIds = new Set<string>(
    elements.map((e) => e.spec_node_id).filter(Boolean)
  );
  const nodeTypeCount = specNodeIds.size;

  // Index elements by both UUID id and path/slug — relationships store slug paths.
  const elementById = new Map<string, Element>();
  for (const e of elements) {
    elementById.set(e.id, e);
    if (e.path && e.path !== e.id) elementById.set(e.path, e);
  }

  // Count relationship instances per spec_node_id — includes both intra and inter-layer
  // relationships for isolation scoring. A node type is only isolated if it participates
  // in no relationships at all (not just intra-layer ones).
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

  // Cross-layer relationships count toward isolation and predicate utilization.
  // Without this, node types that only participate in cross-layer relationships
  // appear isolated and their predicates don't appear in usedPredicates.
  for (const rel of interLayerRels) {
    const sourceEl = elementById.get(rel.source);
    if (sourceEl?.spec_node_id) {
      relCountBySpecNodeId.set(
        sourceEl.spec_node_id,
        (relCountBySpecNodeId.get(sourceEl.spec_node_id) ?? 0) + 1
      );
    }
    // Also count inbound rels — a node type targeted by a cross-layer relationship
    // is not isolated, even if it never acts as a source.
    const targetEl = elementById.get(rel.target);
    if (targetEl?.spec_node_id) {
      relCountBySpecNodeId.set(
        targetEl.spec_node_id,
        (relCountBySpecNodeId.get(targetEl.spec_node_id) ?? 0) + 1
      );
    }
    usedPredicatesSet.add(rel.predicate);
  }

  const relationshipCount = intraLayerRels.length;
  const interLayerRelationshipCount = interLayerRels.length;

  // Isolated: spec_node_ids present in layer with zero relationship instances (intra OR inter)
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
    interLayerRelationshipCount,
    isolatedNodeTypes,
    isolationPercentage,
    availablePredicates,
    usedPredicates,
    utilizationPercentage,
    relationshipsPerNodeType,
  };
}
