/**
 * Coverage Analyzer - Computes relationship coverage metrics
 *
 * Analyzes:
 * - Node isolation (node types with zero relationships)
 * - Predicate utilization (available vs. used predicates)
 * - Relationship density
 * - Standard alignment validation
 */

import { RelationshipCatalog } from "../../core/relationship-catalog.js";
import { RELATIONSHIPS_BY_SOURCE } from "../../generated/relationship-index.js";
import {
  getAllLayers,
  type LayerMetadata,
} from "../../generated/layer-registry.js";
import { LAYER_TEMPLATES } from "./layer-templates.js";
import type { CoverageMetrics } from "../types.js";

/**
 * Coverage analyzer for relationship metrics
 */
export class CoverageAnalyzer {
  constructor(private catalog: RelationshipCatalog) {}

  /**
   * Analyze coverage for all layers
   */
  async analyzeAll(): Promise<CoverageMetrics[]> {
    const layers = getAllLayers();
    const results: CoverageMetrics[] = [];
    const errors: Array<{ layer: string; error: Error }> = [];

    for (const layer of layers) {
      try {
        const metrics = await this.analyzeLayer(layer);
        results.push(metrics);
      } catch (error) {
        errors.push({
          layer: layer.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    // If all layers failed, throw the first error
    if (results.length === 0 && errors.length > 0) {
      throw errors[0].error;
    }

    return results;
  }

  /**
   * Analyze coverage for a single layer
   */
  async analyzeLayer(layer: LayerMetadata): Promise<CoverageMetrics> {
    const nodeTypes = layer.nodeTypes;
    const nodeTypeCount = nodeTypes.length;

    // Count relationships per node type
    const relationshipCounts = new Map<string, number>();
    const usedPredicatesSet = new Set<string>();

    for (const nodeType of nodeTypes) {
      const relationships = RELATIONSHIPS_BY_SOURCE.get(nodeType) || [];
      relationshipCounts.set(nodeType, relationships.length);

      // Track used predicates
      for (const rel of relationships) {
        usedPredicatesSet.add(rel.predicate);
      }
    }

    // Calculate total relationships
    const relationshipCount = Array.from(relationshipCounts.values()).reduce(
      (sum, count) => sum + count,
      0
    );

    // Identify isolated node types (zero relationships)
    const isolatedNodeTypes = nodeTypes.filter(
      (type) => (relationshipCounts.get(type) || 0) === 0
    );
    const isolationPercentage =
      nodeTypeCount > 0 ? (isolatedNodeTypes.length / nodeTypeCount) * 100 : 0;

    // Get available predicates for this layer
    const availablePredicates = await this.getAvailablePredicatesForLayer(
      layer.id
    );
    const usedPredicates = Array.from(usedPredicatesSet);
    const utilizationPercentage =
      availablePredicates.length > 0
        ? (usedPredicates.length / availablePredicates.length) * 100
        : 0;

    // Calculate density
    const relationshipsPerNodeType =
      nodeTypeCount > 0 ? relationshipCount / nodeTypeCount : 0;

    // Standard alignment (for ArchiMate layers)
    const standardAlignment = await this.analyzeStandardAlignment(layer);

    return {
      layer: layer.id,
      nodeTypeCount,
      relationshipCount,
      isolatedNodeTypes,
      isolationPercentage,
      availablePredicates,
      usedPredicates,
      utilizationPercentage,
      relationshipsPerNodeType,
      standardAlignment,
    };
  }

  /**
   * Get available predicates for a layer
   */
  private async getAvailablePredicatesForLayer(
    layerId: string
  ): Promise<string[]> {
    const relationshipTypes = this.catalog.getTypesForLayer(layerId);
    return relationshipTypes.map((rt) => rt.predicate);
  }

  /**
   * Analyze standard alignment for ArchiMate layers
   */
  private async analyzeStandardAlignment(
    layer: LayerMetadata
  ): Promise<CoverageMetrics["standardAlignment"] | undefined> {
    if (!layer.inspiredBy) {
      return undefined;
    }

    // Check if this is an ArchiMate layer
    if (layer.inspiredBy.standard !== "ArchiMate 3.2") {
      return undefined;
    }

    // ArchiMate 3.2 expected relationship patterns
    const expectedPatterns = this.getArchimateExpectedPatterns(layer.id);

    return {
      standard: layer.inspiredBy.standard,
      expectedRelationships: expectedPatterns.length,
      missingFromStandard: expectedPatterns,
    };
  }

  /**
   * Get expected ArchiMate relationship patterns for a layer
   */
  private getArchimateExpectedPatterns(layerId: string): string[] {
    const template = LAYER_TEMPLATES.find((t) => t.layer === layerId);
    if (!template) {
      return [];
    }

    return template.patterns.map(
      (p) => `${p.sourcePattern}→${p.predicate}→${p.destinationPattern}`
    );
  }
}
