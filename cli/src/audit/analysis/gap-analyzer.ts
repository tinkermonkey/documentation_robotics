/**
 * Gap Analyzer - Identifies missing relationships based on layer-specific templates
 *
 * Uses standard-based templates to identify missing architectural
 * relationships that should exist based on:
 * - ArchiMate 3.2 metamodel (layers 1, 2, 4, 5)
 * - OpenAPI 3.0 patterns (layer 6)
 * - NIST SP 800-53 (layer 3)
 * - Component patterns (layers 9, 10)
 */

import { RELATIONSHIPS_BY_SOURCE } from "../../generated/relationship-index.js";
import {
  getAllLayers,
  type LayerMetadata,
} from "../../generated/layer-registry.js";
import { LAYER_TEMPLATES } from "./layer-templates.js";
import type { GapCandidate } from "../types.js";

/**
 * Expected relationship pattern template
 */
interface RelationshipPattern {
  sourceType: string; // Node type pattern (e.g., "goal", "process")
  destinationType: string;
  predicate: string;
  reason: string;
  standardReference?: string;
}

/**
 * Gap analysis result with analysis status
 */
export interface GapAnalysisResult {
  analyzed: boolean; // Whether the layer was analyzed
  gaps: GapCandidate[]; // Gap candidates (empty array if analyzed with no gaps, or if not analyzed)
  reason?: string; // Reason for not analyzing (e.g., "No template available for layer")
}

/**
 * Gap analyzer for missing relationships
 */
export class GapAnalyzer {
  /**
   * Analyze gaps for all layers
   */
  analyzeAll(): GapCandidate[] {
    const layers = getAllLayers();
    const candidates: GapCandidate[] = [];

    for (const layer of layers) {
      const layerGaps = this.analyzeLayer(layer);
      candidates.push(...layerGaps);
    }

    return candidates;
  }

  /**
   * Analyze gaps for a single layer with analysis status
   */
  analyzeLayerWithStatus(layer: LayerMetadata): GapAnalysisResult {
    const patterns = this.getLayerTemplates(layer);

    // Check if layer has templates
    if (patterns.length === 0) {
      return {
        analyzed: false,
        gaps: [],
        reason: `No template available for layer '${layer.id}'`,
      };
    }

    const candidates: GapCandidate[] = [];

    for (const pattern of patterns) {
      // Find matching node types
      const sourceTypes = this.findMatchingNodeTypes(
        layer,
        pattern.sourceType
      );
      const destinationTypes = this.findMatchingNodeTypes(
        layer,
        pattern.destinationType
      );

      // Check for missing relationships
      for (const sourceType of sourceTypes) {
        for (const destType of destinationTypes) {
          const exists = this.relationshipExists(
            sourceType,
            destType,
            pattern.predicate
          );

          if (!exists) {
            candidates.push({
              sourceNodeType: sourceType,
              destinationNodeType: destType,
              suggestedPredicate: pattern.predicate,
              reason: pattern.reason,
              priority: this.assessPriority(layer, sourceType),
              standardReference: pattern.standardReference,
            });
          }
        }
      }
    }

    return {
      analyzed: true,
      gaps: candidates,
    };
  }

  /**
   * Analyze gaps for a single layer (legacy method for backward compatibility)
   */
  analyzeLayer(layer: LayerMetadata): GapCandidate[] {
    const result = this.analyzeLayerWithStatus(layer);
    return result.gaps;
  }

  /**
   * Get relationship templates for a layer
   */
  private getLayerTemplates(layer: LayerMetadata): RelationshipPattern[] {
    const template = LAYER_TEMPLATES.find((t) => t.layer === layer.id);
    if (!template) {
      return [];
    }

    return template.patterns.map((p) => ({
      sourceType: p.sourcePattern,
      destinationType: p.destinationPattern,
      predicate: p.predicate,
      reason: p.description,
      standardReference: `${template.standard}`,
    }));
  }

  /**
   * Find node types matching a pattern
   */
  private findMatchingNodeTypes(
    layer: LayerMetadata,
    pattern: string
  ): string[] {
    return layer.nodeTypes.filter((nodeType) => {
      const typeName = nodeType.split(".")[1];
      return typeName?.includes(pattern) || typeName === pattern;
    });
  }

  /**
   * Check if a relationship exists
   */
  private relationshipExists(
    sourceType: string,
    destType: string,
    predicate: string
  ): boolean {
    const relationships = RELATIONSHIPS_BY_SOURCE.get(sourceType) || [];
    return relationships.some(
      (rel) =>
        rel.destinationSpecNodeId === destType && rel.predicate === predicate
    );
  }

  /**
   * Assess priority of a gap
   */
  private assessPriority(
    layer: LayerMetadata,
    sourceType: string
  ): "high" | "medium" | "low" {
    // High priority: zero-relationship layers
    if (["security", "ux", "navigation"].includes(layer.id)) {
      return "high";
    }

    // Medium priority: container/composition types
    const typeName = sourceType.split(".")[1] || "";
    if (
      typeName.includes("component") ||
      typeName.includes("container") ||
      typeName.includes("service") ||
      typeName.includes("module")
    ) {
      return "medium";
    }

    // Low priority: all other patterns
    return "low";
  }
}
