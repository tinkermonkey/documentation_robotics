/**
 * Relationship Classifier - Semantic classification of relationships
 *
 * Classifies relationships by semantic category, strength, and directionality.
 * Analyzes relationship patterns, validates against schemas, and detects issues.
 */

import { RelationshipCatalog, RelationshipType } from "../core/relationship-catalog.js";
import { ClassifiedRelationship } from "../core/report-data-model.js";
import { getLayerOrder } from "../core/layers.js";
import type { Relationship } from "../types/index.js";

/**
 * Relationship strength assessment
 */
export enum RelationshipStrength {
  Weak = "weak",
  Medium = "medium",
  Strong = "strong",
}

/**
 * Relationship pattern analysis result
 */
export interface RelationshipPattern {
  predicate: string;
  category: string;
  count: number;
  percentage: number;
  averageStrength: RelationshipStrength;
  examples: string[];
}

/**
 * Transitive analysis result
 */
export interface TransitiveAnalysis {
  predicate: string;
  isTransitive: boolean;
  chains: TransitiveChain[];
}

/**
 * Transitive chain (A -> B -> C where A is implied to relate to C)
 */
export interface TransitiveChain {
  elements: string[];
  pathLength: number;
}

/**
 * Classification statistics grouped by category
 */
export interface CategoryStatistics {
  category: string;
  count: number;
  percentage: number;
  predicates: string[];
  avgStrength: RelationshipStrength;
}

/**
 * Validates and analyzes semantic compliance
 */
export interface SemanticValidationResult {
  isValid: boolean;
  category: string;
  predicate: string;
  issues: string[];
  warnings: string[];
}

/**
 * Relationship Classifier
 */
export class RelationshipClassifier {
  private catalog: RelationshipCatalog;
  private relationshipTypeMap: Map<string, RelationshipType> = new Map();
  private catalogLoaded = false;

  constructor(catalog: RelationshipCatalog) {
    this.catalog = catalog;
  }

  /**
   * Load and prepare the catalog
   */
  async load(): Promise<void> {
    if (this.catalogLoaded) return;

    await this.catalog.load();
    const types = this.catalog.getAllTypes();

    for (const type of types) {
      this.relationshipTypeMap.set(type.predicate, type);
    }

    this.catalogLoaded = true;
  }

  /**
   * Classify a single relationship with detailed semantic information
   */
  async classify(
    rel: Relationship,
    relationshipId?: string
  ): Promise<ClassifiedRelationship> {
    await this.load();

    const sourceLayer = rel.source.split(".")[0];
    const targetLayer = rel.target.split(".")[0];
    const isCrossLayer = sourceLayer !== targetLayer;

    const relationshipType = this.relationshipTypeMap.get(rel.predicate);

    return {
      id: relationshipId || `${rel.source}→${rel.predicate}→${rel.target}`,
      source: rel.source,
      target: rel.target,
      predicate: rel.predicate,
      category: relationshipType?.category || "unknown",
      archimateAlignment: relationshipType?.archimateAlignment || null,
      directionality: relationshipType?.semantics.directionality || "unidirectional",
      transitivity: relationshipType?.semantics.transitivity || false,
      symmetry: relationshipType?.semantics.symmetry || false,
      reflexivity: relationshipType?.semantics.reflexivity,
      sourceLayer,
      targetLayer,
      isCrossLayer,
      isSpecCompliant: relationshipType !== undefined,
    };
  }

  /**
   * Classify a batch of relationships
   */
  async classifyBatch(
    relationships: Relationship[]
  ): Promise<ClassifiedRelationship[]> {
    const classified: ClassifiedRelationship[] = [];

    for (let i = 0; i < relationships.length; i++) {
      const classified_rel = await this.classify(relationships[i], i.toString());
      classified.push(classified_rel);
    }

    return classified;
  }

  /**
   * Get relationship breakdown by category
   */
  async getCategoryBreakdown(
    relationships: ClassifiedRelationship[]
  ): Promise<CategoryStatistics[]> {
    const byCategory: Record<string, ClassifiedRelationship[]> = {};

    for (const rel of relationships) {
      if (!byCategory[rel.category]) {
        byCategory[rel.category] = [];
      }
      byCategory[rel.category].push(rel);
    }

    const breakdown: CategoryStatistics[] = [];

    for (const [category, rels] of Object.entries(byCategory)) {
      const predicates = Array.from(new Set(rels.map((r) => r.predicate)));
      const avgStrength = this.calculateAverageStrength(rels);

      breakdown.push({
        category,
        count: rels.length,
        percentage: (rels.length / relationships.length) * 100,
        predicates,
        avgStrength,
      });
    }

    return breakdown.sort((a, b) => b.count - a.count);
  }

  /**
   * Analyze transitive relationships for a specific predicate
   */
  async analyzeTransitivity(
    relationships: ClassifiedRelationship[],
    predicate: string
  ): Promise<TransitiveAnalysis> {
    const type = this.relationshipTypeMap.get(predicate);
    const isTransitive = type?.semantics.transitivity || false;

    const chains: TransitiveChain[] = [];

    if (isTransitive) {
      // Build a map of relationships for this predicate
      const relsByPredicate = relationships.filter((r) => r.predicate === predicate);

      // Find chains A -> B -> C
      for (const rel1 of relsByPredicate) {
        for (const rel2 of relsByPredicate) {
          if (rel1.target === rel2.source && rel1.source !== rel2.target) {
            chains.push({
              elements: [rel1.source, rel1.target, rel2.target],
              pathLength: 2,
            });
          }
        }
      }

      // Remove duplicate chains
      const uniqueChains = Array.from(
        new Map(chains.map((c) => [c.elements.join("→"), c])).values()
      );

      return {
        predicate,
        isTransitive: true,
        chains: uniqueChains,
      };
    }

    return {
      predicate,
      isTransitive: false,
      chains: [],
    };
  }

  /**
   * Validate a relationship against semantic rules
   */
  async validateSemantics(
    rel: ClassifiedRelationship
  ): Promise<SemanticValidationResult> {
    await this.load();

    const issues: string[] = [];
    const warnings: string[] = [];

    const relationshipType = this.relationshipTypeMap.get(rel.predicate);

    if (!relationshipType) {
      issues.push(`Unknown predicate: ${rel.predicate}`);
    } else {
      // Check reflexivity
      if (!relationshipType.semantics.reflexivity && rel.source === rel.target) {
        issues.push(`Predicate "${rel.predicate}" does not support reflexive relationships`);
      }

      // Check symmetry
      if (relationshipType.semantics.symmetry && rel.directionality === "unidirectional") {
        warnings.push(`Predicate "${rel.predicate}" is symmetric but may be unidirectional`);
      }

      // Check layer direction for cross-layer relationships
      if (rel.isCrossLayer) {
        const layerOrder = this.getLayerOrder(rel.sourceLayer, rel.targetLayer);
        if (layerOrder < 0) {
          warnings.push(
            `Cross-layer relationship violates layer hierarchy: ${rel.sourceLayer} → ${rel.targetLayer}`
          );
        }
      }
    }

    return {
      isValid: issues.length === 0,
      category: rel.category,
      predicate: rel.predicate,
      issues,
      warnings,
    };
  }

  /**
   * Validate a batch of relationships
   */
  async validateBatch(
    relationships: ClassifiedRelationship[]
  ): Promise<SemanticValidationResult[]> {
    const results: SemanticValidationResult[] = [];

    for (const rel of relationships) {
      const result = await this.validateSemantics(rel);
      results.push(result);
    }

    return results;
  }

  /**
   * Find relationships that violate semantic rules
   */
  async findSemanticViolations(
    relationships: ClassifiedRelationship[]
  ): Promise<SemanticValidationResult[]> {
    const validations = await this.validateBatch(relationships);
    return validations.filter((v) => !v.isValid || v.issues.length > 0);
  }

  /**
   * Analyze relationship patterns
   */
  async analyzePatterns(
    relationships: ClassifiedRelationship[]
  ): Promise<RelationshipPattern[]> {
    const byPredicate: Record<string, ClassifiedRelationship[]> = {};

    for (const rel of relationships) {
      if (!byPredicate[rel.predicate]) {
        byPredicate[rel.predicate] = [];
      }
      byPredicate[rel.predicate].push(rel);
    }

    const patterns: RelationshipPattern[] = [];

    for (const [predicate, rels] of Object.entries(byPredicate)) {
      const relationshipType = this.relationshipTypeMap.get(predicate);
      const examples = rels.slice(0, 3).map((r) => `${r.source} → ${r.target}`);
      const avgStrength = this.calculateAverageStrength(rels);

      patterns.push({
        predicate,
        category: relationshipType?.category || "unknown",
        count: rels.length,
        percentage: (rels.length / relationships.length) * 100,
        averageStrength: avgStrength,
        examples,
      });
    }

    return patterns.sort((a, b) => b.count - a.count);
  }

  /**
   * Calculate average relationship strength
   */
  private calculateAverageStrength(
    relationships: ClassifiedRelationship[]
  ): RelationshipStrength {
    if (relationships.length === 0) return RelationshipStrength.Medium;

    let strongCount = 0;
    let weakCount = 0;

    for (const rel of relationships) {
      // Strong: transitive, symmetric relationships
      if (rel.transitivity && rel.symmetry) {
        strongCount++;
      }
      // Weak: unidirectional, non-reflexive
      else if (rel.directionality === "unidirectional" && rel.reflexivity === false) {
        weakCount++;
      }
    }

    const strongPercentage = (strongCount / relationships.length) * 100;

    if (strongPercentage > 50) {
      return RelationshipStrength.Strong;
    } else if (strongPercentage < 20) {
      return RelationshipStrength.Weak;
    }

    return RelationshipStrength.Medium;
  }

  /**
   * Get layer ordering for compliance checking
   */
  private getLayerOrder(layer1: string, layer2: string): number {
    const order1 = getLayerOrder(layer1);
    const order2 = getLayerOrder(layer2);
    return order1 - order2;
  }
}
