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

import { RelationshipCatalog } from "../../core/relationship-catalog.js";
import { RELATIONSHIPS_BY_SOURCE } from "../../generated/relationship-index.js";
import {
  getAllLayers,
  type LayerMetadata,
} from "../../generated/layer-registry.js";
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
 * Gap analyzer for missing relationships
 */
export class GapAnalyzer {
  constructor(private catalog: RelationshipCatalog) {}

  /**
   * Analyze gaps for all layers
   */
  async analyzeAll(): Promise<GapCandidate[]> {
    const layers = getAllLayers();
    const candidates: GapCandidate[] = [];

    for (const layer of layers) {
      const layerGaps = await this.analyzeLayer(layer);
      candidates.push(...layerGaps);
    }

    return candidates;
  }

  /**
   * Analyze gaps for a single layer
   */
  async analyzeLayer(layer: LayerMetadata): Promise<GapCandidate[]> {
    const patterns = this.getLayerTemplates(layer);
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

    return candidates;
  }

  /**
   * Get relationship templates for a layer
   */
  private getLayerTemplates(layer: LayerMetadata): RelationshipPattern[] {
    const templates: Record<string, RelationshipPattern[]> = {
      motivation: [
        {
          sourceType: "goal",
          destinationType: "principle",
          predicate: "supports",
          reason: "Goals should support guiding principles",
          standardReference: "ArchiMate 3.2 §5.2",
        },
        {
          sourceType: "requirement",
          destinationType: "goal",
          predicate: "realizes",
          reason: "Requirements realize goals",
          standardReference: "ArchiMate 3.2 §5.2",
        },
        {
          sourceType: "assessment",
          destinationType: "goal",
          predicate: "influence",
          reason: "Assessments influence goals",
          standardReference: "ArchiMate 3.2 §5.2",
        },
      ],
      business: [
        {
          sourceType: "process",
          destinationType: "process",
          predicate: "triggers",
          reason: "Business processes trigger other processes",
          standardReference: "ArchiMate 3.2 §6.2",
        },
        {
          sourceType: "role",
          destinationType: "process",
          predicate: "performs",
          reason: "Roles perform business processes",
          standardReference: "ArchiMate 3.2 §6.2",
        },
        {
          sourceType: "actor",
          destinationType: "role",
          predicate: "assigned-to",
          reason: "Actors are assigned to roles",
          standardReference: "ArchiMate 3.2 §6.2",
        },
      ],
      security: [
        {
          sourceType: "countermeasure",
          destinationType: "threat",
          predicate: "mitigates",
          reason: "Countermeasures mitigate threats",
          standardReference: "NIST SP 800-53 §3.1",
        },
        {
          sourceType: "role",
          destinationType: "permission",
          predicate: "authorizes",
          reason: "Roles authorize permissions",
          standardReference: "NIST SP 800-53 §3.2",
        },
        {
          sourceType: "policy",
          destinationType: "constraint",
          predicate: "enforces",
          reason: "Policies enforce security constraints",
          standardReference: "NIST SP 800-53 §3.3",
        },
      ],
      application: [
        {
          sourceType: "component",
          destinationType: "service",
          predicate: "realizes",
          reason: "Components realize application services",
          standardReference: "ArchiMate 3.2 §7.2",
        },
        {
          sourceType: "component",
          destinationType: "component",
          predicate: "uses",
          reason: "Components use other components",
          standardReference: "ArchiMate 3.2 §7.2",
        },
      ],
      technology: [
        {
          sourceType: "node",
          destinationType: "device",
          predicate: "composes",
          reason: "Nodes compose devices",
          standardReference: "ArchiMate 3.2 §8.2",
        },
        {
          sourceType: "artifact",
          destinationType: "component",
          predicate: "realizes",
          reason: "Artifacts realize application components",
          standardReference: "ArchiMate 3.2 §8.2",
        },
      ],
      api: [
        {
          sourceType: "operation",
          destinationType: "schema",
          predicate: "references",
          reason: "API operations reference schemas",
          standardReference: "OpenAPI 3.0 §4.7",
        },
        {
          sourceType: "securityscheme",
          destinationType: "operation",
          predicate: "serves",
          reason: "Security schemes serve operations",
          standardReference: "OpenAPI 3.0 §4.8",
        },
      ],
      ux: [
        {
          sourceType: "screen",
          destinationType: "component",
          predicate: "renders",
          reason: "Screens render UX components",
          standardReference: "React/Component patterns",
        },
        {
          sourceType: "component",
          destinationType: "entity",
          predicate: "binds-to",
          reason: "Components bind to data entities",
          standardReference: "React/Component patterns",
        },
      ],
      navigation: [
        {
          sourceType: "route",
          destinationType: "screen",
          predicate: "navigates-to",
          reason: "Routes navigate to screens",
          standardReference: "Router patterns",
        },
        {
          sourceType: "menuitem",
          destinationType: "route",
          predicate: "references",
          reason: "Menu items reference routes",
          standardReference: "Router patterns",
        },
      ],
    };

    return templates[layer.id] || [];
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
