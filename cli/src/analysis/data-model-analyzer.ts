/**
 * Data Model Analyzer - Layer 7 specific analysis
 *
 * Provides specialized analysis for the Data Model layer (Layer 7).
 * Analyzes entities, relationships, constraints, and data quality.
 */

import { Model } from "../core/model.js";
import { DataModelEntity } from "../core/report-data-model.js";

/**
 * Entity constraint information
 */
export interface EntityConstraint {
  entityId: string;
  constraintType: "primary-key" | "unique" | "not-null" | "foreign-key" | "check";
  description: string;
  isValid: boolean;
}

/**
 * Cardinality information
 */
export interface CardinalityInfo {
  sourceEntity: string;
  targetEntity: string;
  cardinality: "one-to-one" | "one-to-many" | "many-to-many";
  isOptional: boolean;
}

/**
 * Data quality issue
 */
export interface DataQualityIssue {
  type: "incomplete" | "inconsistent" | "orphaned" | "invalid-reference" | "missing-constraint";
  entityId: string;
  description: string;
  severity: "low" | "medium" | "high";
}

/**
 * Entity relationship information
 */
export interface EntityRelationship {
  source: string;
  target: string;
  cardinality: string;
  type: string;
}

/**
 * Coverage metrics for data model
 */
export interface DataModelCoverageMetrics {
  totalEntities: number;
  entitiesWithAttributes: number;
  constraintsEntities: number;
  referencedEntities: number;
  orphanedEntities: number;
  attributeCoverage: number; // 0-100
  constraintCoverage: number; // 0-100
  referenceCoverage: number; // 0-100
}

/**
 * Data model complexity metrics
 */
export interface DataModelComplexityMetrics {
  avgAttributesPerEntity: number;
  maxAttributesPerEntity: number;
  minAttributesPerEntity: number;
  avgRelationshipsPerEntity: number;
  maxRelationshipsPerEntity: number;
  entityDensity: number; // Relationships per entity squared
}

/**
 * Data Model Analyzer
 */
export class DataModelAnalyzer {
  constructor(private model: Model) {}

  /**
   * Analyze entities in the data model layer
   */
  async analyzeEntities(): Promise<DataModelEntity[]> {
    const dataModelLayer = await this.model.getLayer("data-model");
    const entities: DataModelEntity[] = [];

    if (!dataModelLayer) {
      return entities;
    }

    // Get all references to data model entities from other layers
    const referencesFrom = new Set<string>();
    for (const layerName of this.model.getLayerNames()) {
      if (layerName === "data-model") continue;
      const layer = await this.model.getLayer(layerName);
      if (!layer) continue;

      for (const element of layer.listElements()) {
        if (element.references) {
          for (const ref of element.references) {
            if (ref.target.startsWith("data-model.")) {
              referencesFrom.add(ref.target);
            }
          }
        }
      }
    }

    // Analyze each entity
    for (const element of dataModelLayer.listElements()) {
      const attributes = element.attributes ? Object.keys(element.attributes) : [];
      const relationships = element.relationships ? element.relationships : [];

      entities.push({
        id: element.id || "",
        name: element.name,
        layer: "data-model",
        attributes,
        relatedEntities: relationships.map((r) => r.target),
        isReferenced: referencesFrom.has(element.id || ""),
      });
    }

    return entities;
  }

  /**
   * Check constraints for data model entities
   */
  async checkConstraints(): Promise<EntityConstraint[]> {
    const dataModelLayer = await this.model.getLayer("data-model");
    const constraints: EntityConstraint[] = [];

    if (!dataModelLayer) {
      return constraints;
    }

    for (const element of dataModelLayer.listElements()) {
      // Check if element has attributes
      if (!element.attributes || Object.keys(element.attributes).length === 0) {
        constraints.push({
          entityId: element.id || "",
          constraintType: "not-null",
          description: "Entity has no attributes defined",
          isValid: false,
        });
      }

      // Check if entity is documented
      if (!element.description || element.description.length === 0) {
        constraints.push({
          entityId: element.id || "",
          constraintType: "check",
          description: "Entity has no description",
          isValid: false,
        });
      }
    }

    return constraints;
  }

  /**
   * Analyze cardinality of relationships
   */
  async checkCardinality(): Promise<CardinalityInfo[]> {
    const dataModelLayer = await this.model.getLayer("data-model");
    const cardinalities: CardinalityInfo[] = [];

    if (!dataModelLayer) {
      return cardinalities;
    }

    for (const element of dataModelLayer.listElements()) {
      if (!element.relationships) continue;

      for (const rel of element.relationships) {
        // Infer cardinality from relationship properties or attributes
        let cardinality: "one-to-one" | "one-to-many" | "many-to-many" = "one-to-many";

        // Simple heuristic: if predicate contains "many", it's many-to-many or one-to-many
        if (rel.predicate.includes("one-to-one") || rel.predicate === "has-one") {
          cardinality = "one-to-one";
        } else if (rel.predicate.includes("many-to-many") || rel.predicate === "has-many-to-many") {
          cardinality = "many-to-many";
        }

        cardinalities.push({
          sourceEntity: element.id || "",
          targetEntity: rel.target,
          cardinality,
          isOptional: rel.properties?.optional === true || false,
        });
      }
    }

    return cardinalities;
  }

  /**
   * Find data quality issues
   */
  async identifyIssues(): Promise<DataQualityIssue[]> {
    const issues: DataQualityIssue[] = [];
    const entities = await this.analyzeEntities();
    const constraints = await this.checkConstraints();

    // Add constraint issues
    for (const constraint of constraints) {
      if (!constraint.isValid) {
        issues.push({
          type: constraint.constraintType === "not-null" ? "incomplete" : "missing-constraint",
          entityId: constraint.entityId,
          description: constraint.description,
          severity: "medium",
        });
      }
    }

    // Find orphaned entities
    for (const entity of entities) {
      if (!entity.isReferenced && entity.relatedEntities.length === 0) {
        issues.push({
          type: "orphaned",
          entityId: entity.id,
          description: `Entity "${entity.name}" is not referenced and has no relationships`,
          severity: "low",
        });
      }
    }

    return issues;
  }

  /**
   * Calculate coverage metrics
   */
  async calculateCoverage(): Promise<DataModelCoverageMetrics> {
    const entities = await this.analyzeEntities();

    let documentsCount = 0;
    let constraintCount = 0;
    let referencedCount = 0;
    let orphanedCount = 0;

    for (const entity of entities) {
      if (entity.attributes && entity.attributes.length > 0) {
        documentsCount++;
      }

      if (entity.isReferenced) {
        referencedCount++;
      }

      if (!entity.isReferenced && entity.relatedEntities.length === 0) {
        orphanedCount++;
      }

      // Simple heuristic for constraints: if entity has attributes
      if (entity.attributes && entity.attributes.length > 0) {
        constraintCount++;
      }
    }

    const totalEntities = entities.length;

    return {
      totalEntities,
      entitiesWithAttributes: documentsCount,
      constraintsEntities: constraintCount,
      referencedEntities: referencedCount,
      orphanedEntities: orphanedCount,
      attributeCoverage:
        totalEntities > 0 ? Math.round((documentsCount / totalEntities) * 100) : 0,
      constraintCoverage: totalEntities > 0 ? Math.round((constraintCount / totalEntities) * 100) : 0,
      referenceCoverage: totalEntities > 0 ? Math.round((referencedCount / totalEntities) * 100) : 0,
    };
  }

  /**
   * Calculate complexity metrics
   */
  async calculateComplexity(): Promise<DataModelComplexityMetrics> {
    const entities = await this.analyzeEntities();

    if (entities.length === 0) {
      return {
        avgAttributesPerEntity: 0,
        maxAttributesPerEntity: 0,
        minAttributesPerEntity: 0,
        avgRelationshipsPerEntity: 0,
        maxRelationshipsPerEntity: 0,
        entityDensity: 0,
      };
    }

    let totalAttributes = 0;
    let maxAttributes = 0;
    let minAttributes = Infinity;
    let totalRelationships = 0;
    let maxRelationships = 0;

    for (const entity of entities) {
      const attrCount = entity.attributes.length;
      const relCount = entity.relatedEntities.length;

      totalAttributes += attrCount;
      totalRelationships += relCount;

      maxAttributes = Math.max(maxAttributes, attrCount);
      minAttributes = Math.min(minAttributes, attrCount);
      maxRelationships = Math.max(maxRelationships, relCount);
    }

    const avgAttributes = totalAttributes / entities.length;
    const avgRelationships = totalRelationships / entities.length;
    const density =
      entities.length > 0
        ? totalRelationships / (entities.length * entities.length)
        : 0;

    return {
      avgAttributesPerEntity: Math.round(avgAttributes * 10) / 10,
      maxAttributesPerEntity: maxAttributes,
      minAttributesPerEntity: minAttributes === Infinity ? 0 : minAttributes,
      avgRelationshipsPerEntity: Math.round(avgRelationships * 10) / 10,
      maxRelationshipsPerEntity: maxRelationships,
      entityDensity: Math.round(density * 10000) / 10000,
    };
  }

  /**
   * Get entity dependency graph
   */
  async getEntityDependencyGraph(): Promise<Map<string, Set<string>>> {
    const entities = await this.analyzeEntities();
    const graph = new Map<string, Set<string>>();

    for (const entity of entities) {
      if (!graph.has(entity.id)) {
        graph.set(entity.id, new Set());
      }

      for (const relatedId of entity.relatedEntities) {
        const deps = graph.get(entity.id)!;
        deps.add(relatedId);
      }
    }

    return graph;
  }

  /**
   * Find entity clusters based on relationships
   */
  async findClusters(): Promise<Set<string>[]> {
    const graph = await this.getEntityDependencyGraph();
    const visited = new Set<string>();
    const clusters: Set<string>[] = [];

    for (const nodeId of graph.keys()) {
      if (!visited.has(nodeId)) {
        const cluster = new Set<string>();
        this.dfsCluster(nodeId, graph, visited, cluster);
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  /**
   * DFS to find connected components (clusters)
   */
  private dfsCluster(
    nodeId: string,
    graph: Map<string, Set<string>>,
    visited: Set<string>,
    cluster: Set<string>
  ): void {
    if (visited.has(nodeId)) {
      return;
    }

    visited.add(nodeId);
    cluster.add(nodeId);

    const neighbors = graph.get(nodeId);
    if (neighbors) {
      for (const neighbor of neighbors) {
        this.dfsCluster(neighbor, graph, visited, cluster);
      }
    }
  }
}
