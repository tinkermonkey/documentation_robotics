/**
 * Statistics collector for architecture models
 * Gathers metrics about elements, relationships, and model completeness
 */

import { Model } from "./model.js";
import { Validator } from "../validators/validator.js";

export interface ElementTypeCount {
  [type: string]: number;
}

export interface LayerStats {
  name: string;
  totalElements: number;
  elementsByType: ElementTypeCount;
  coverage: number; // Percentage of element types used (0-100)
}

export interface RelationshipStats {
  total: number;
  byPredicate: Record<string, number>;
  crossLayerCount: number;
  intraLayerCount: number;
  byPair: Record<string, number>;
}

export interface ValidationInfo {
  isValid: boolean;
  lastValidated?: string;
  errors: number;
  warnings: number;
}

export interface ModelStats {
  project: {
    name: string;
    version: string;
    created: string;
    updated: string;
  };
  statistics: {
    totalElements: number;
    totalRelationships: number;
    totalLayers: number;
    populatedLayers: number;
  };
  validation: ValidationInfo;
  layers: LayerStats[];
  relationships: RelationshipStats;
  completeness: {
    overall: number; // 0-100
    byLayer: Record<string, number>;
  };
  orphanedElements: string[];
}

/**
 * Collects statistics from a model
 */
export class StatsCollector {
  constructor(private model: Model) {}

  /**
   * Collect all statistics from the model
   */
  async collect(): Promise<ModelStats> {
    const layerStats = await this.collectLayerStats();
    const relationshipStats = this.collectRelationshipStats();
    const validationInfo = await this.collectValidationInfo();
    const orphanedElements = await this.findOrphanedElements();

    const totalElements = layerStats.reduce((sum, l) => sum + l.totalElements, 0);
    const populatedLayers = layerStats.filter((l) => l.totalElements > 0).length;

    const overallCompleteness = this.calculateCompleteness(layerStats);
    const byLayerCompleteness: Record<string, number> = {};
    for (const layer of layerStats) {
      byLayerCompleteness[layer.name] = layer.coverage;
    }

    return {
      project: {
        name: this.model.manifest.name,
        version: this.model.manifest.version,
        created: this.model.manifest.created,
        updated: this.model.manifest.modified,
      },
      statistics: {
        totalElements,
        totalRelationships: relationshipStats.total,
        totalLayers: this.model.getLayerNames().length,
        populatedLayers,
      },
      validation: validationInfo,
      layers: layerStats,
      relationships: relationshipStats,
      completeness: {
        overall: overallCompleteness,
        byLayer: byLayerCompleteness,
      },
      orphanedElements,
    };
  }

  /**
   * Collect statistics for each layer
   */
  private async collectLayerStats(): Promise<LayerStats[]> {
    const layerNames = this.model.getLayerNames();
    const stats: LayerStats[] = [];

    for (const layerName of layerNames) {
      const layer = await this.model.getLayer(layerName);
      if (!layer) continue;

      const elements = layer.listElements();
      const elementsByType: ElementTypeCount = {};

      for (const element of elements) {
        if (!elementsByType[element.type]) {
          elementsByType[element.type] = 0;
        }
        elementsByType[element.type]++;
      }

      // Coverage is the percentage of element types used
      // For now, we use a simple heuristic: if layer has elements, coverage = number of types / expected types
      // This can be enhanced with layer schema information
      const typeCount = Object.keys(elementsByType).length;
      const expectedTypeCount = this.getExpectedTypeCount(layerName);
      const coverage =
        expectedTypeCount > 0 ? Math.min(100, (typeCount / expectedTypeCount) * 100) : 0;

      stats.push({
        name: layerName,
        totalElements: elements.length,
        elementsByType,
        coverage: Math.round(coverage),
      });
    }

    return stats;
  }

  /**
   * Get expected element type count for a layer
   * These are typical/common types for each layer
   */
  private getExpectedTypeCount(layerName: string): number {
    const expectedTypes: Record<string, number> = {
      motivation: 4, // goals, principles, requirements, stakeholders
      business: 2, // capabilities, services
      security: 4, // policies, threats, etc
      application: 2, // services, components
      technology: 4, // frameworks, libraries, databases, platforms
      api: 2, // operations, endpoints
      "data-model": 1, // entities/schemas
      "data-store": 1, // datastores
      ux: 2, // views, components
      navigation: 2, // routes, menus
      apm: 4, // metrics, analytics, collectors, etc
      testing: 4, // test-suites, fixtures, strategies, coverage
    };

    return expectedTypes[layerName] || 2;
  }

  /**
   * Collect relationship statistics
   */
  private collectRelationshipStats(): RelationshipStats {
    const relationships = this.model.relationships.getAll();

    const byPredicate: Record<string, number> = {};
    const byPair: Record<string, number> = {};
    let crossLayerCount = 0;
    let intraLayerCount = 0;

    for (const rel of relationships) {
      // Count by predicate
      if (!byPredicate[rel.predicate]) {
        byPredicate[rel.predicate] = 0;
      }
      byPredicate[rel.predicate]++;

      // Extract layers
      const sourceLayer = rel.source.split(".")[0];
      const targetLayer = rel.target.split(".")[0];

      // Count cross vs intra-layer
      if (sourceLayer === targetLayer) {
        intraLayerCount++;
      } else {
        crossLayerCount++;
      }

      // Count by pair
      const pair = `${sourceLayer}-${targetLayer}`;
      if (!byPair[pair]) {
        byPair[pair] = 0;
      }
      byPair[pair]++;
    }

    return {
      total: relationships.length,
      byPredicate,
      crossLayerCount,
      intraLayerCount,
      byPair,
    };
  }

  /**
   * Collect validation information
   * Runs model validation and returns actual validation status
   * Preserves error details for debugging
   */
  private async collectValidationInfo(): Promise<ValidationInfo> {
    try {
      const validator = new Validator();
      const result = await validator.validateModel(this.model);

      return {
        isValid: result.isValid(),
        lastValidated: new Date().toISOString(),
        errors: result.errors.length,
        warnings: result.warnings.length,
      };
    } catch (error) {
      // Preserve actual error information for debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[stats-collector] Validation failed: ${errorMessage}`);

      // Return failed state with sentinel error count -1 indicating collection failure
      // (cannot be confused with actual error count which is always >= 0)
      return {
        isValid: false,
        lastValidated: new Date().toISOString(),
        errors: -1, // Sentinel: validation collection itself failed
        warnings: 0,
      };
    }
  }

  /**
   * Find orphaned elements (elements with no relationships)
   */
  private async findOrphanedElements(): Promise<string[]> {
    const orphaned: string[] = [];
    const allRelationships = this.model.relationships.getAll();

    // Get all element IDs
    const allElements = new Set<string>();
    const layerNames = this.model.getLayerNames();

    for (const layerName of layerNames) {
      const layer = await this.model.getLayer(layerName);
      if (!layer) continue;

      for (const element of layer.listElements()) {
        allElements.add(element.id);
      }
    }

    // Find elements with no relationships
    const elementsWithRelationships = new Set<string>();
    for (const rel of allRelationships) {
      elementsWithRelationships.add(rel.source);
      elementsWithRelationships.add(rel.target);
    }

    for (const elementId of allElements) {
      if (!elementsWithRelationships.has(elementId)) {
        orphaned.push(elementId);
      }
    }

    return orphaned;
  }

  /**
   * Calculate overall model completeness
   * Weighted average of layer coverage
   */
  private calculateCompleteness(layerStats: LayerStats[]): number {
    if (layerStats.length === 0) return 0;

    const totalCoverage = layerStats.reduce((sum, layer) => sum + layer.coverage, 0);
    return Math.round(totalCoverage / layerStats.length);
  }
}
