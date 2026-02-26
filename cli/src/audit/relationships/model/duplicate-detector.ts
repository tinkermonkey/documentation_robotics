/**
 * Model Duplicate Detector - Identifies duplicate relationship instances in the model
 *
 * Detects:
 * - Exact duplicates: same (source, predicate, target) triple appearing more than once
 * - Semantic duplicates: same (source_spec_node_id, dest_spec_node_id) pair with predicates
 *   in the same semantic category
 */

import { RelationshipCatalog } from "../../../core/relationship-catalog.js";
import type { Relationship } from "../../../core/relationships.js";
import type { Element } from "../../../core/element.js";
import { duplicateImpactScore, type DuplicateCandidate } from "../../types.js";

/**
 * Detect duplicates within a set of model relationship instances
 */
export function detectModelDuplicates(
  relationships: Relationship[],
  elements: Element[],
  catalog: RelationshipCatalog
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];
  const elementById = new Map<string, Element>(
    elements.map((e) => [e.id, e])
  );

  // --- Exact duplicates: same (source, predicate, target) ---
  const exactGroups = new Map<string, Relationship[]>();
  for (const rel of relationships) {
    const key = `${rel.source}|${rel.predicate}|${rel.target}`;
    const group = exactGroups.get(key) ?? [];
    group.push(rel);
    exactGroups.set(key, group);
  }

  for (const [compositeKey, group] of exactGroups) {
    if (group.length < 2) continue;
    const rel = group[0];
    const srcEl = elementById.get(rel.source);
    const dstEl = elementById.get(rel.target);
    // Use the composite key as both tuple elements so the differential-analyzer
    // produces a stable, unique signature for this duplicate pair.
    const exactImpactScore = duplicateImpactScore("high");
    candidates.push({
      relationships: [compositeKey, compositeKey],
      predicates: [rel.predicate, rel.predicate],
      sourceNodeType: srcEl?.spec_node_id ?? rel.source,
      destinationNodeType: dstEl?.spec_node_id ?? rel.target,
      reason: `Exact duplicate: (${rel.source}, ${rel.predicate}, ${rel.target}) appears ${group.length} times`,
      confidence: "high",
      impactScore: exactImpactScore,
      alignmentScore: 100 - exactImpactScore,
    });
  }

  // --- Semantic duplicates: same (src_spec_node_id, dst_spec_node_id) with same predicate category ---
  // Group by (source_spec_node_id, dest_spec_node_id) → list of predicates used
  const semanticGroups = new Map<
    string,
    Array<{ predicate: string; sourceId: string; targetId: string }>
  >();

  for (const rel of relationships) {
    const srcEl = elementById.get(rel.source);
    const dstEl = elementById.get(rel.target);
    if (!srcEl?.spec_node_id || !dstEl?.spec_node_id) continue;
    const key = `${srcEl.spec_node_id}|${dstEl.spec_node_id}`;
    const group = semanticGroups.get(key) ?? [];
    group.push({ predicate: rel.predicate, sourceId: rel.source, targetId: rel.target });
    semanticGroups.set(key, group);
  }

  for (const [key, group] of semanticGroups) {
    if (group.length < 2) continue;
    const [sourceSpecNodeId, destSpecNodeId] = key.split("|");

    // Check all pairs for same-category predicates
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const p1 = group[i].predicate;
        const p2 = group[j].predicate;
        if (p1 === p2) continue; // Already caught as exact duplicate above

        const type1 = catalog.getTypeByPredicate(p1);
        const type2 = catalog.getTypeByPredicate(p2);
        if (!type1 || !type2) continue;
        if (type1.category !== type2.category) continue;

        const confidence = assessSemanticConfidence(type1, type2);
        const semImpactScore = duplicateImpactScore(confidence);
        // Use composite keys of each relationship instance so the differential-analyzer
        // can build a stable, unique signature for each semantic duplicate pair.
        const rel1Key = `${group[i].sourceId}|${p1}|${group[i].targetId}`;
        const rel2Key = `${group[j].sourceId}|${p2}|${group[j].targetId}`;
        candidates.push({
          relationships: [rel1Key, rel2Key],
          predicates: [p1, p2],
          sourceNodeType: sourceSpecNodeId ?? "",
          destinationNodeType: destSpecNodeId ?? "",
          reason: `Both predicates '${p1}' and '${p2}' are in "${type1.category}" category between the same element types`,
          confidence,
          impactScore: semImpactScore,
          alignmentScore: 100 - semImpactScore,
        });
      }
    }
  }

  return candidates;
}

function assessSemanticConfidence(
  type1: ReturnType<RelationshipCatalog["getTypeByPredicate"]>,
  type2: ReturnType<RelationshipCatalog["getTypeByPredicate"]>
): "high" | "medium" | "low" {
  if (!type1 || !type2) return "low";
  if (
    type1.category === type2.category &&
    type1.semantics.transitivity === type2.semantics.transitivity &&
    type1.semantics.symmetry === type2.semantics.symmetry
  ) {
    return "high";
  }
  if (type1.category === type2.category) {
    return "medium";
  }
  return "low";
}
