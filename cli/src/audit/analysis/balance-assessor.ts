/**
 * Balance Assessor - Assesses relationship density balance
 *
 * Applies heuristics to determine if node types have appropriate
 * numbers of relationships based on their category:
 * - Structural (2-4 relationships): entities, components
 * - Behavioral (3-5 relationships): processes, services
 * - Enumeration (1-2 relationships): states, values
 * - Reference (0-1 relationships): metadata, tags
 */

import { RELATIONSHIPS_BY_SOURCE } from "../../generated/relationship-index.js";
import {
  getAllLayers,
  type LayerMetadata,
} from "../../generated/layer-registry.js";
import type { BalanceAssessment } from "../types.js";

/**
 * Density targets for different node type categories
 */
const DENSITY_TARGETS: Record<string, [number, number]> = {
  structural: [2, 4], // Entities, components
  behavioral: [3, 5], // Processes, services
  enumeration: [1, 2], // States, values
  reference: [0, 1], // Metadata, tags
};

/**
 * Balance assessor for relationship density
 */
export class BalanceAssessor {
  /**
   * Assess balance for all layers
   */
  assessAll(): BalanceAssessment[] {
    const layers = getAllLayers();
    const assessments: BalanceAssessment[] = [];

    for (const layer of layers) {
      const layerAssessments = this.assessLayer(layer);
      assessments.push(...layerAssessments);
    }

    return assessments;
  }

  /**
   * Assess balance for a single layer
   */
  assessLayer(layer: LayerMetadata): BalanceAssessment[] {
    const assessments: BalanceAssessment[] = [];

    for (const nodeType of layer.nodeTypes) {
      const assessment = this.assessNodeType(nodeType, layer.id);
      assessments.push(assessment);
    }

    return assessments;
  }

  /**
   * Assess balance for a single node type
   */
  private assessNodeType(
    nodeType: string,
    layerId: string
  ): BalanceAssessment {
    const category = this.classifyNodeType(nodeType);
    const currentCount = this.getRelationshipCount(nodeType);
    const targetRange = DENSITY_TARGETS[category];
    const status = this.determineStatus(currentCount, targetRange);
    const recommendation = this.generateRecommendation(
      nodeType,
      category,
      currentCount,
      targetRange,
      status
    );

    return {
      nodeType,
      layer: layerId,
      category,
      currentCount,
      targetRange,
      status,
      recommendation,
    };
  }

  /**
   * Classify node type into category
   */
  private classifyNodeType(
    specNodeId: string
  ): "structural" | "behavioral" | "enumeration" | "reference" {
    const type = specNodeId.split(".")[1] || "";

    // Enumeration patterns
    if (
      type.endsWith("level") ||
      type.endsWith("type") ||
      type.endsWith("status") ||
      type.endsWith("priority") ||
      type.endsWith("scope") ||
      type.endsWith("action") ||
      type.endsWith("category") ||
      type.endsWith("format")
    ) {
      return "enumeration";
    }

    // Structural patterns
    if (
      type.includes("component") ||
      type.includes("container") ||
      type.includes("service") ||
      type.includes("module") ||
      type.includes("collaboration") ||
      type.includes("interface") ||
      type.includes("device") ||
      type.includes("node") ||
      type.includes("artifact")
    ) {
      return "structural";
    }

    // Behavioral patterns
    if (
      type.includes("process") ||
      type.includes("operation") ||
      type.includes("event") ||
      type.includes("flow") ||
      type.includes("interaction") ||
      type.includes("function") ||
      type.includes("trigger")
    ) {
      return "behavioral";
    }

    // Default to reference
    return "reference";
  }

  /**
   * Get relationship count for node type
   */
  private getRelationshipCount(nodeType: string): number {
    const relationships = RELATIONSHIPS_BY_SOURCE.get(nodeType) || [];
    return relationships.length;
  }

  /**
   * Determine balance status
   */
  private determineStatus(
    count: number,
    targetRange: [number, number]
  ): "under" | "balanced" | "over" {
    const [min, max] = targetRange;

    if (count < min) {
      return "under";
    }
    if (count > max) {
      return "over";
    }
    return "balanced";
  }

  /**
   * Generate recommendation
   */
  private generateRecommendation(
    nodeType: string,
    category: string,
    currentCount: number,
    targetRange: [number, number],
    status: "under" | "balanced" | "over"
  ): string | undefined {
    const [min, max] = targetRange;
    const typeName = nodeType.split(".").pop() || nodeType;

    if (status === "under") {
      const needed = min - currentCount;
      return `Add ${needed} relationship${needed > 1 ? "s" : ""} to ${typeName} (${category} type) to reach minimum target`;
    }

    if (status === "over") {
      const excess = currentCount - max;
      return `Consider removing ${excess} relationship${excess > 1 ? "s" : ""} from ${typeName} or reviewing ${category} type classification`;
    }

    return undefined;
  }

  /**
   * Get assessments by status
   */
  assessByStatus(
    status: "under" | "balanced" | "over"
  ): BalanceAssessment[] {
    const all = this.assessAll();
    return all.filter((a) => a.status === status);
  }

  /**
   * Get assessments by category
   */
  assessByCategory(
    category: "structural" | "behavioral" | "enumeration" | "reference"
  ): BalanceAssessment[] {
    const all = this.assessAll();
    return all.filter((a) => a.category === category);
  }
}
