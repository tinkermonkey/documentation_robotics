/**
 * ReportDataModel - Unified reporting interface for architecture models
 *
 * Combines statistics collection, relationship classification, and data model analysis
 * to provide comprehensive insights into architecture model structure, quality, and completeness.
 */

import { Model } from "./model.js";
import { StatsCollector, ModelStats } from "./stats-collector.js";
import { RelationshipCatalog, RelationshipType, type Directionality } from "./relationship-catalog.js";
import { getLayerOrder } from "./layers.js";
import type { Relationship } from "../types/index.js";

/**
 * Relationship with semantic classification metadata
 */
export interface ClassifiedRelationship {
  id: string;
  source: string; // Element ID
  target: string; // Element ID
  predicate: string;

  // Classification
  category: string; // e.g., "structural", "behavioral", "dependency"
  archimateAlignment: string | null;

  // Semantic properties
  directionality: Directionality;
  transitivity: boolean;
  symmetry: boolean;
  reflexivity?: boolean;

  // Analysis
  sourceLayer: string;
  targetLayer: string;
  isCrossLayer: boolean;
  isSpecCompliant: boolean;
}

/**
 * Data model entity (Layer 7 specific)
 */
export interface DataModelEntity {
  id: string;
  name: string;
  layer: string;
  attributes: string[];
  relatedEntities: string[];
  isReferenced: boolean; // Referenced from other layers
}

/**
 * Data model layer specific insights
 *
 * Coverage metrics are percentages (0-100) representing data model completeness:
 * - entityCoverage: Percentage of entities referenced from higher layers
 * - attributeCoverage: Percentage of attributes populated across entities
 */
export interface DataModelInsights {
  entityCount: number;
  attributeCount: number;
  relationshipCount: number;
  entities: DataModelEntity[];

  // Coverage metrics
  entityCoverage: number;
  attributeCoverage: number;

  // Complexity
  avgAttributesPerEntity: number;
  maxAttributesPerEntity: number;
  avgRelationshipsPerEntity: number;

  // Quality
  referencedEntities: number; // Entities referenced from higher layers
  orphanedEntities: string[];
}

/**
 * Relationship analysis results
 */
export interface RelationshipAnalysis {
  totalRelationships: number;
  classified: ClassifiedRelationship[];
  byCategory: Record<string, number>;
  byPredicate: Record<string, number>;
  crossLayerCount: number;
  intraLayerCount: number;
  circularDependencies: CircularPath[];
}

/**
 * Circular dependency detection result
 */
export interface CircularPath {
  elements: string[];
  predicates: string[];
  pathLength: number;
}

/**
 * Quality metrics for the model
 *
 * Percentages (0-100) represent quality metrics:
 * - Coverage metrics (elementCoverage, relationshipCoverage, documentationCoverage, archimateCompliance, specCompliance, semanticConsistency):
 *   Express completeness or compliance as percentages
 * - Composition metrics (crossLayerReferenceHealth):
 *   Descriptive ratio of cross-layer to total relationships (not a quality indicator)
 * - Structural metrics (orphanedElements, circularDependencies):
 *   Count of problematic elements
 * - Compliance metrics (layerComplianceScore):
 *   Percentage of relationships following higher→lower layer rule
 */
export interface QualityMetrics {
  // Coverage
  elementCoverage: number;
  relationshipCoverage: number;
  documentationCoverage: number;
  layerCoverage: number;

  // Structural quality
  orphanedElements: number;
  circularDependencies: number;

  // Semantic quality
  archimateCompliance: number;
  specCompliance: number;
  semanticConsistency: number;

  // Layering quality
  crossLayerReferenceHealth: number;
  layerComplianceScore: number;
}

/**
 * Complete report containing statistics, relationships, data model insights, and quality metrics
 */
export interface ReportData {
  timestamp: string;
  statistics: ModelStats;
  relationships: RelationshipAnalysis;
  dataModel: DataModelInsights;
  quality: QualityMetrics;
}

/**
 * Factory function to create a ClassifiedRelationship with enforced invariants
 *
 * Ensures that `isCrossLayer` correctly reflects whether sourceLayer !== targetLayer.
 * This prevents accidental bugs where the invariant could be violated.
 */
export function createClassifiedRelationship(
  rel: Omit<ClassifiedRelationship, "isCrossLayer" | "sourceLayer" | "targetLayer">,
  sourceLayer: string,
  targetLayer: string
): ClassifiedRelationship {
  return {
    ...rel,
    sourceLayer,
    targetLayer,
    isCrossLayer: sourceLayer !== targetLayer,
  };
}

/**
 * ReportDataModel class - Unified reporting interface
 */
export class ReportDataModel {
  private model: Model;
  private statsCollector: StatsCollector;
  private relationshipCatalog: RelationshipCatalog;

  private cachedStats: ModelStats | null = null;
  private cachedRelationships: RelationshipAnalysis | null = null;
  private cachedDataModel: DataModelInsights | null = null;
  private cachedQuality: QualityMetrics | null = null;
  private cachedReport: ReportData | null = null;

  private relationshipTypeMap: Map<string, RelationshipType> = new Map();
  private catalogLoaded = false;

  constructor(model: Model) {
    this.model = model;
    this.statsCollector = new StatsCollector(model);
    this.relationshipCatalog = new RelationshipCatalog();
  }

  /**
   * Load the relationship catalog and build relationship type map
   */
  async loadCatalog(): Promise<void> {
    if (this.catalogLoaded) return;

    await this.relationshipCatalog.load();
    const types = this.relationshipCatalog.getAllTypes();

    for (const type of types) {
      this.relationshipTypeMap.set(type.predicate, type);
    }

    this.catalogLoaded = true;
  }

  /**
   * Collect all report data (statistics, relationships, data model, quality metrics)
   */
  async collect(): Promise<ReportData> {
    if (this.cachedReport) {
      return this.cachedReport;
    }

    await this.loadCatalog();

    const statistics = await this.getStatistics();
    const relationships = await this.getRelationshipAnalysis();
    const dataModel = await this.getDataModelInsights();
    const quality = await this.getQualityMetrics();

    this.cachedReport = {
      timestamp: new Date().toISOString(),
      statistics,
      relationships,
      dataModel,
      quality,
    };

    return this.cachedReport;
  }

  /**
   * Get model statistics
   */
  async getStatistics(): Promise<ModelStats> {
    if (this.cachedStats) {
      return this.cachedStats;
    }

    this.cachedStats = await this.statsCollector.collect();
    return this.cachedStats;
  }

  /**
   * Get relationship analysis with classification
   */
  async getRelationshipAnalysis(): Promise<RelationshipAnalysis> {
    if (this.cachedRelationships) {
      return this.cachedRelationships;
    }

    await this.loadCatalog();

    const allRelationships = this.model.relationships.getAll();
    const classified: ClassifiedRelationship[] = [];
    const byCategory: Record<string, number> = {};
    const byPredicate: Record<string, number> = {};

    let crossLayerCount = 0;
    let intraLayerCount = 0;

    for (let i = 0; i < allRelationships.length; i++) {
      const rel = allRelationships[i];
      const relationshipId = `${rel.source}→${rel.predicate}→${rel.target}`;
      const classifiedRel = this.classifyRelationship(rel, relationshipId);
      classified.push(classifiedRel);

      // Count by category
      if (!byCategory[classifiedRel.category]) {
        byCategory[classifiedRel.category] = 0;
      }
      byCategory[classifiedRel.category]++;

      // Count by predicate
      if (!byPredicate[rel.predicate]) {
        byPredicate[rel.predicate] = 0;
      }
      byPredicate[rel.predicate]++;

      // Count cross vs intra-layer
      if (classifiedRel.isCrossLayer) {
        crossLayerCount++;
      } else {
        intraLayerCount++;
      }
    }

    const circularDependencies = this.detectCircularDependencies(classified);

    this.cachedRelationships = {
      totalRelationships: allRelationships.length,
      classified,
      byCategory,
      byPredicate,
      crossLayerCount,
      intraLayerCount,
      circularDependencies,
    };

    return this.cachedRelationships;
  }

  /**
   * Get relationships filtered by category
   */
  async getRelationshipsByCategory(category: string): Promise<ClassifiedRelationship[]> {
    const analysis = await this.getRelationshipAnalysis();
    return analysis.classified.filter((rel) => rel.category === category);
  }

  /**
   * Get data model layer (Layer 7) specific insights
   */
  async getDataModelInsights(): Promise<DataModelInsights> {
    if (this.cachedDataModel) {
      return this.cachedDataModel;
    }

    const dataModelLayer = await this.model.getLayer("data-model");
    const entities: DataModelEntity[] = [];
    let attributeCount = 0;

    if (dataModelLayer) {
      const elements = dataModelLayer.listElements();

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

      for (const element of elements) {
        const attributes = element.attributes ? Object.keys(element.attributes) : [];
        attributeCount += attributes.length;

        entities.push({
          id: element.id || "",
          name: element.name,
          layer: "data-model",
          attributes,
          relatedEntities: element.relationships ? element.relationships.map((r) => r.target) : [],
          isReferenced: referencesFrom.has(element.id || ""),
        });
      }
    }

    const entityCount = entities.length;
    const referencedCount = entities.filter((e) => e.isReferenced).length;
    const orphaned = entities.filter((e) => !e.isReferenced && e.relatedEntities.length === 0);

    // Calculate actual attribute coverage: percentage of entities that have at least one attribute
    const entitiesWithAttributes = entities.filter((e) => e.attributes.length > 0).length;
    const attributeCoverage =
      entityCount > 0 ? (entitiesWithAttributes / entityCount) * 100 : 0;

    const avgAttrs = entityCount > 0 ? attributeCount / entityCount : 0;
    const maxAttrs = Math.max(0, ...entities.map((e) => e.attributes.length));
    const avgRels =
      entityCount > 0 ? entities.reduce((sum, e) => sum + e.relatedEntities.length, 0) / entityCount : 0;

    this.cachedDataModel = {
      entityCount,
      attributeCount,
      relationshipCount: entities.reduce((sum, e) => sum + e.relatedEntities.length, 0),
      entities,
      entityCoverage: entityCount > 0 ? (referencedCount / entityCount) * 100 : 0,
      attributeCoverage,
      avgAttributesPerEntity: Math.round(avgAttrs * 10) / 10,
      maxAttributesPerEntity: maxAttrs,
      avgRelationshipsPerEntity: Math.round(avgRels * 10) / 10,
      referencedEntities: referencedCount,
      orphanedEntities: orphaned.map((e) => e.id),
    };

    return this.cachedDataModel;
  }

  /**
   * Get quality metrics for the model
   */
  async getQualityMetrics(): Promise<QualityMetrics> {
    if (this.cachedQuality) {
      return this.cachedQuality;
    }

    const stats = await this.getStatistics();
    const relationships = await this.getRelationshipAnalysis();

    // Coverage metrics
    const elementCoverage = stats.statistics.totalElements > 0 ? 100 : 0;
    const relationshipCoverage =
      stats.statistics.totalElements > 0
        ? (stats.statistics.totalRelationships / stats.statistics.totalElements) * 100
        : 0;
    const documentationCoverage = this.calculateDocumentationCoverage(stats);
    const layerCoverage = (stats.statistics.populatedLayers / stats.statistics.totalLayers) * 100;

    // Structural quality
    const orphanedElements = stats.orphanedElements.length;
    const circularDependencies = relationships.circularDependencies.length;

    // Semantic quality - simplified calculation
    const archimateCompliance = this.calculateArchimateCompliance(relationships);
    const specCompliance = this.calculateSpecCompliance(relationships);
    const semanticConsistency = (archimateCompliance + specCompliance) / 2;

    // Layering quality
    const crossLayerReferenceHealth =
      relationships.totalRelationships > 0
        ? (relationships.crossLayerCount / relationships.totalRelationships) * 100
        : 0;

    // Layer compliance score: proportion of relationships going higher -> lower
    const layerComplianceScore = this.calculateLayerComplianceScore(relationships);

    this.cachedQuality = {
      elementCoverage,
      relationshipCoverage: Math.min(100, relationshipCoverage),
      documentationCoverage: Math.min(100, documentationCoverage),
      layerCoverage: Math.min(100, layerCoverage),
      orphanedElements,
      circularDependencies,
      archimateCompliance,
      specCompliance,
      semanticConsistency,
      crossLayerReferenceHealth: Math.min(100, crossLayerReferenceHealth),
      layerComplianceScore,
    };

    return this.cachedQuality;
  }

  /**
   * Classify a single relationship with semantic metadata
   */
  private classifyRelationship(rel: Relationship, id: string): ClassifiedRelationship {
    // Extract layer name from element ID (format: layer.type.name)
    const sourceParts = rel.source.split(".");
    const targetParts = rel.target.split(".");

    // Validate element ID format: must have at least layer (part 0)
    const sourceLayer = sourceParts[0];
    const targetLayer = targetParts[0];

    if (!sourceLayer || !targetLayer) {
      // Log warning for malformed element IDs but continue with available data
      // This allows partial analysis without breaking the entire report
      console.warn(
        `Malformed element ID format in relationship: source="${rel.source}" (${sourceParts.length} parts), ` +
          `target="${rel.target}" (${targetParts.length} parts). ` +
          `Expected format: layer.type.name`
      );
    }

    const relationshipType = this.relationshipTypeMap.get(rel.predicate);

    // Determine spec compliance: unknown predicates are not compliant
    const isSpecCompliant = relationshipType !== undefined;

    return createClassifiedRelationship(
      {
        id,
        source: rel.source,
        target: rel.target,
        predicate: rel.predicate,
        category: relationshipType?.category || "unknown",
        archimateAlignment: relationshipType?.archimateAlignment || null,
        directionality: relationshipType?.semantics.directionality || "unidirectional",
        transitivity: relationshipType?.semantics.transitivity || false,
        symmetry: relationshipType?.semantics.symmetry || false,
        reflexivity: relationshipType?.semantics.reflexivity,
        isSpecCompliant,
      },
      sourceLayer,
      targetLayer
    );
  }

  /**
   * Detect circular dependencies in relationships
   */
  private detectCircularDependencies(relationships: ClassifiedRelationship[]): CircularPath[] {
    const circularPaths: CircularPath[] = [];
    const visited = new Set<string>();
    const path: string[] = [];
    const predicatePath: string[] = [];

    for (const rel of relationships) {
      if (!visited.has(rel.source)) {
        this.findCircles(rel.source, relationships, visited, path, predicatePath, circularPaths);
      }
    }

    return circularPaths;
  }

  /**
   * Helper to find circular paths using DFS
   */
  private findCircles(
    node: string,
    relationships: ClassifiedRelationship[],
    visited: Set<string>,
    path: string[],
    predicatePath: string[],
    circularPaths: CircularPath[]
  ): void {
    if (path.includes(node)) {
      const circleStart = path.indexOf(node);
      const circlePath = path.slice(circleStart);
      const circlePredicates = predicatePath.slice(circleStart);

      // Only add if not already found (use immutable sort for comparison)
      const circleKey = [...circlePath].sort().join("→");
      const isDuplicate = circularPaths.some(
        (c) => [...c.elements].sort().join("→") === circleKey
      );

      if (!isDuplicate && circlePath.length > 1) {
        circularPaths.push({
          elements: circlePath,
          predicates: circlePredicates,
          pathLength: circlePath.length,
        });
      }
      return;
    }

    if (visited.has(node)) {
      return;
    }

    path.push(node);
    visited.add(node);

    // Find all outgoing edges from this node
    for (const rel of relationships) {
      if (rel.source === node) {
        predicatePath.push(rel.predicate);
        this.findCircles(rel.target, relationships, visited, path, predicatePath, circularPaths);
        predicatePath.pop();
      }
    }

    path.pop();
  }

  /**
   * Calculate documentation coverage percentage
   * Checks what proportion of elements have meaningful descriptions
   */
  private calculateDocumentationCoverage(stats: ModelStats): number {
    if (stats.statistics.totalElements === 0) return 0;

    // Count elements with descriptions across all layers
    let documentedCount = 0;
    for (const layerName of this.model.getLayerNames()) {
      const layer = this.model.layers.get(layerName);
      if (!layer) continue;

      for (const element of layer.listElements()) {
        if (element.description && element.description.trim().length > 0) {
          documentedCount++;
        }
      }
    }

    return Math.round((documentedCount / stats.statistics.totalElements) * 100);
  }

  /**
   * Calculate ArchiMate alignment percentage
   */
  private calculateArchimateCompliance(analysis: RelationshipAnalysis): number {
    if (analysis.totalRelationships === 0) return 100;

    const archimateAligned = analysis.classified.filter((r) => r.archimateAlignment).length;
    return Math.round((archimateAligned / analysis.totalRelationships) * 100);
  }

  /**
   * Calculate spec compliance percentage
   */
  private calculateSpecCompliance(analysis: RelationshipAnalysis): number {
    if (analysis.totalRelationships === 0) return 100;

    const specCompliant = analysis.classified.filter((r) => r.isSpecCompliant).length;
    return Math.round((specCompliant / analysis.totalRelationships) * 100);
  }

  /**
   * Calculate layer compliance score (directional compliance)
   * Measures adherence to the higher -> lower layer reference rule
   */
  private calculateLayerComplianceScore(analysis: RelationshipAnalysis): number {
    // Only count relationships with known (valid) layer names
    const validRelationships = analysis.classified.filter((rel) => {
      const sourceOrder = getLayerOrder(rel.sourceLayer);
      const targetOrder = getLayerOrder(rel.targetLayer);
      return sourceOrder > 0 && targetOrder > 0;
    });

    if (validRelationships.length === 0) return 100;

    let compliantCount = 0;

    for (const rel of validRelationships) {
      const sourceOrder = getLayerOrder(rel.sourceLayer);
      const targetOrder = getLayerOrder(rel.targetLayer);

      // Compliant if source >= target (higher layer -> lower/same layer)
      if (sourceOrder >= targetOrder) {
        compliantCount++;
      }
    }

    return Math.round((compliantCount / validRelationships.length) * 100);
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cachedStats = null;
    this.cachedRelationships = null;
    this.cachedDataModel = null;
    this.cachedQuality = null;
    this.cachedReport = null;
  }

  /**
   * Get the relationship catalog
   */
  getCatalog(): RelationshipCatalog {
    return this.relationshipCatalog;
  }
}
