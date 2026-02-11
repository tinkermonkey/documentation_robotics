import type { Relationship } from "../types/index.js";

/**
 * Relationship type metadata
 */
export interface RelationshipTypeMetadata {
  id: string;
  predicate: string;
  inversePredicate?: string;
  category: string;
  description?: string;
  applicable_layers?: string[];
}

/**
 * Relationship registry - manages intra-layer relationships and their catalog
 *
 * NOTE: Future consolidation - Registry to GraphModel API
 * This registry will be consolidated into the GraphModel query API in a future refactoring.
 * The graph model provides the foundation with intra-layer relationship tracking via edges.
 * Current approach maintains backward compatibility while the transition occurs.
 *
 * Future approach: Use GraphModel.getEdgesFrom/To with predicate filtering
 * where source_layer === destination_layer for intra-layer relationships.
 *
 * See: https://github.com/tinkermonkey/documentation_robotics/discussions/317
 */
export class RelationshipRegistry {
  private relationships: Map<string, Relationship[]>;
  private relationshipTypes: Map<string, RelationshipTypeMetadata>;
  private predicateMap: Map<string, RelationshipTypeMetadata>;
  private layerIndex: Map<string, Relationship[]>;

  constructor() {
    this.relationships = new Map();
    this.relationshipTypes = new Map();
    this.predicateMap = new Map();
    this.layerIndex = new Map();
  }

  /**
   * Register a relationship type
   */
  registerType(metadata: RelationshipTypeMetadata): void {
    this.relationshipTypes.set(metadata.id, metadata);
    this.predicateMap.set(metadata.predicate, metadata);
  }

  /**
   * Get relationship type by ID
   */
  getType(id: string): RelationshipTypeMetadata | undefined {
    return this.relationshipTypes.get(id);
  }

  /**
   * Get relationship type by predicate
   */
  getTypeByPredicate(predicate: string): RelationshipTypeMetadata | undefined {
    return this.predicateMap.get(predicate);
  }

  /**
   * Add a relationship to the registry
   */
  addRelationship(relationship: Relationship): void {
    // Extract layer from element ID (format: {layer}-{type}-{kebab-case-name})
    const sourceParts = relationship.source.split("-");
    const layerKey = sourceParts[0]; // Get layer prefix

    // Add to source index
    if (!this.relationships.has(relationship.source)) {
      this.relationships.set(relationship.source, []);
    }
    this.relationships.get(relationship.source)!.push(relationship);

    // Add to layer index
    if (!this.layerIndex.has(layerKey)) {
      this.layerIndex.set(layerKey, []);
    }
    this.layerIndex.get(layerKey)!.push(relationship);
  }

  /**
   * Get all relationships from a source element
   */
  getRelationshipsFrom(sourceId: string): Relationship[] {
    return this.relationships.get(sourceId) ?? [];
  }

  /**
   * Get all relationships in a layer
   */
  getRelationshipsByLayer(layerPrefix: string): Relationship[] {
    return this.layerIndex.get(layerPrefix) ?? [];
  }

  /**
   * Get all relationships with a specific predicate
   */
  getRelationshipsByPredicate(predicate: string): Relationship[] {
    const allRels: Relationship[] = [];
    for (const rels of this.relationships.values()) {
      allRels.push(...rels.filter((rel) => rel.predicate === predicate));
    }
    return allRels;
  }

  /**
   * Check if a relationship exists
   */
  hasRelationship(sourceId: string, targetId: string, predicate: string): boolean {
    const rels = this.relationships.get(sourceId) ?? [];
    return rels.some((rel) => rel.target === targetId && rel.predicate === predicate);
  }

  /**
   * Get all relationships
   */
  getAllRelationships(): Relationship[] {
    const allRels: Relationship[] = [];
    for (const rels of this.relationships.values()) {
      allRels.push(...rels);
    }
    return allRels;
  }

  /**
   * Get all relationship types
   */
  getAllTypes(): RelationshipTypeMetadata[] {
    return Array.from(this.relationshipTypes.values());
  }

  /**
   * Check if a predicate is valid
   */
  isValidPredicate(predicate: string): boolean {
    return this.predicateMap.has(predicate);
  }

  /**
   * Get valid predicates for a layer
   */
  getValidPredicatesForLayer(layer: string): string[] {
    const layerPrefix = layer.split("-")[0];
    return this.getAllTypes()
      .filter((type) => !type.applicable_layers || type.applicable_layers.includes(layerPrefix))
      .map((type) => type.predicate);
  }

  /**
   * Clear all relationships and types
   */
  clear(): void {
    this.relationships.clear();
    this.relationshipTypes.clear();
    this.predicateMap.clear();
    this.layerIndex.clear();
  }

  /**
   * Get statistics about registered relationships
   */
  getStats(): {
    totalRelationships: number;
    uniquePredicates: number;
    uniqueLayers: number;
    totalTypes: number;
  } {
    const predicates = new Set<string>();
    for (const rels of this.relationships.values()) {
      for (const rel of rels) {
        predicates.add(rel.predicate);
      }
    }

    return {
      totalRelationships: this.getAllRelationships().length,
      uniquePredicates: predicates.size,
      uniqueLayers: this.layerIndex.size,
      totalTypes: this.relationshipTypes.size,
    };
  }
}
