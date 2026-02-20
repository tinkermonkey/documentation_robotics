/**
 * Duplicate Detector - Identifies semantic duplicate relationships
 *
 * Detects relationships where multiple predicates express the same
 * architectural meaning using:
 * - Predicate category analysis
 * - Transitivity/symmetry semantics
 * - Source/destination endpoint matching
 */

import { RelationshipCatalog } from "../../core/relationship-catalog.js";
import {
  RELATIONSHIPS,
  type RelationshipSpec,
} from "../../generated/relationship-index.js";
import type { DuplicateCandidate } from "../types.js";

/**
 * Duplicate detector for semantic relationship overlap
 */
export class DuplicateDetector {
  private duplicateCache: DuplicateCandidate[] | null = null;

  constructor(private catalog: RelationshipCatalog) {}

  /**
   * Detect all duplicate candidates
   */
  detectDuplicates(): DuplicateCandidate[] {
    // Return cached results if available
    if (this.duplicateCache !== null) {
      return this.duplicateCache;
    }
    const candidates: DuplicateCandidate[] = [];
    const relationshipsByEndpoints = new Map<
      string,
      RelationshipSpec[]
    >();

    // Group relationships by source+destination
    for (const rel of RELATIONSHIPS) {
      const key = `${rel.sourceSpecNodeId}:${rel.destinationSpecNodeId}`;
      const group = relationshipsByEndpoints.get(key) || [];
      group.push(rel);
      relationshipsByEndpoints.set(key, group);
    }

    // Check for predicate overlap within same endpoints
    for (const [_, group] of relationshipsByEndpoints) {
      if (group.length < 2) {
        continue;
      }

      // Check all pairs within the group
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const candidate = this.checkDuplicatePair(group[i], group[j]);
          if (candidate) {
            candidates.push(candidate);
          }
        }
      }
    }

    // Cache the results
    this.duplicateCache = candidates;

    return candidates;
  }

  /**
   * Check if two relationships are semantic duplicates
   */
  private checkDuplicatePair(
    rel1: RelationshipSpec,
    rel2: RelationshipSpec
  ): DuplicateCandidate | null {
    const pred1 = this.catalog.getTypeByPredicate(rel1.predicate);
    const pred2 = this.catalog.getTypeByPredicate(rel2.predicate);

    if (!pred1 || !pred2) {
      return null;
    }

    // Check if predicates are in the same category
    if (pred1.category === pred2.category) {
      const confidence = this.assessConfidence(pred1, pred2);
      const reason = this.buildReason(pred1, pred2);

      return {
        relationships: [rel1.id, rel2.id],
        predicates: [rel1.predicate, rel2.predicate],
        sourceNodeType: rel1.sourceSpecNodeId,
        destinationNodeType: rel1.destinationSpecNodeId,
        reason,
        confidence,
      };
    }

    // Check for inverse relationships (may indicate redundancy)
    if (
      pred1.inversePredicate === pred2.predicate ||
      pred2.inversePredicate === pred1.predicate
    ) {
      return {
        relationships: [rel1.id, rel2.id],
        predicates: [rel1.predicate, rel2.predicate],
        sourceNodeType: rel1.sourceSpecNodeId,
        destinationNodeType: rel1.destinationSpecNodeId,
        reason: "Predicates are inverses of each other",
        confidence: "high",
      };
    }

    return null;
  }

  /**
   * Assess confidence level of duplicate detection
   */
  private assessConfidence(
    pred1: ReturnType<RelationshipCatalog["getTypeByPredicate"]>,
    pred2: ReturnType<RelationshipCatalog["getTypeByPredicate"]>
  ): "high" | "medium" | "low" {
    if (!pred1 || !pred2) {
      return "low";
    }

    // High confidence: same category + same semantics
    if (
      pred1.category === pred2.category &&
      pred1.semantics.transitivity === pred2.semantics.transitivity &&
      pred1.semantics.symmetry === pred2.semantics.symmetry
    ) {
      return "high";
    }

    // Medium confidence: same category + different semantics
    if (pred1.category === pred2.category) {
      return "medium";
    }

    return "low";
  }

  /**
   * Build reason explanation for duplicate detection
   */
  private buildReason(
    pred1: ReturnType<RelationshipCatalog["getTypeByPredicate"]>,
    pred2: ReturnType<RelationshipCatalog["getTypeByPredicate"]>
  ): string {
    if (!pred1 || !pred2) {
      return "Unknown";
    }

    const parts: string[] = [];

    // Category overlap
    if (pred1.category === pred2.category) {
      parts.push(`Both predicates in "${pred1.category}" category`);
    }

    // Semantic overlap
    if (pred1.semantics.transitivity && pred2.semantics.transitivity) {
      parts.push("both transitive");
    }
    if (pred1.semantics.symmetry && pred2.semantics.symmetry) {
      parts.push("both symmetric");
    }

    return parts.join(", ");
  }

  /**
   * Get duplicate candidates by layer
   */
  detectDuplicatesByLayer(layerId: string): DuplicateCandidate[] {
    const allDuplicates = this.detectDuplicates();
    return allDuplicates.filter((d) =>
      d.sourceNodeType.startsWith(`${layerId}.`)
    );
  }

  /**
   * Get duplicate candidates by confidence level
   */
  detectDuplicatesByConfidence(
    confidence: "high" | "medium" | "low"
  ): DuplicateCandidate[] {
    const allDuplicates = this.detectDuplicates();
    return allDuplicates.filter((d) => d.confidence === confidence);
  }
}
