/**
 * SpecDataService - High-level service for specification data operations
 *
 * Provides a convenient API for querying and analyzing specification metadata.
 * Manages the lifecycle of SpecDataLoader and provides caching and performance optimizations.
 */

import { SpecDataLoader } from "./spec-loader.js";
import {
  LayerSpec,
  NodeTypeSpec,
  RelationshipTypeSpec,
  PredicateSpec,
  SpecData,
  SpecStatistics,
  SpecLoaderOptions,
  NodeTypeQueryFilter,
  RelationshipTypeQueryFilter,
} from "./spec-loader-types.js";

/**
 * Relationship metadata computed from spec data
 */
export interface RelationshipMetadata {
  relationshipType: RelationshipTypeSpec;
  predicate: PredicateSpec | undefined;
  sourceNodeType: NodeTypeSpec | undefined;
  destinationNodeType: NodeTypeSpec | undefined;
  sourceLayer: LayerSpec | undefined;
  destinationLayer: LayerSpec | undefined;
}

/**
 * Node type metadata with computed relationships
 */
export interface NodeTypeMetadata {
  nodeType: NodeTypeSpec;
  layer: LayerSpec | undefined;
  incomingRelationships: RelationshipMetadata[];
  outgoingRelationships: RelationshipMetadata[];
}

/**
 * SpecDataService provides a high-level API for specification operations
 */
export class SpecDataService {
  private loader: SpecDataLoader;
  private nodeTypeMetadataCache: Map<string, NodeTypeMetadata> = new Map();

  constructor(options: SpecLoaderOptions = {}) {
    this.loader = new SpecDataLoader(options);
  }

  /**
   * Load specification data
   */
  async initialize(): Promise<void> {
    await this.loader.load();
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.loader.isLoaded();
  }

  /**
   * Get raw specification data
   */
  getSpecData(): SpecData {
    return this.loader.getSpecData();
  }

  /**
   * Get specification statistics
   */
  getStatistics(): SpecStatistics {
    return this.loader.getStatistics();
  }

  /**
   * Find node types by filter
   */
  findNodeTypes(filter: NodeTypeQueryFilter = {}): NodeTypeSpec[] {
    return this.loader.findNodeTypes(filter);
  }

  /**
   * Find relationship types by filter
   */
  findRelationshipTypes(filter: RelationshipTypeQueryFilter = {}): RelationshipTypeSpec[] {
    return this.loader.findRelationshipTypes(filter);
  }

  /**
   * Get all layers
   */
  getAllLayers(): LayerSpec[] {
    return this.loader.getAllLayers();
  }

  /**
   * Get layer by ID
   */
  getLayer(layerId: string): LayerSpec | undefined {
    return this.loader.getLayer(layerId);
  }

  /**
   * Get node type by spec_node_id
   */
  getNodeType(specNodeId: string): NodeTypeSpec | undefined {
    return this.loader.getNodeType(specNodeId);
  }

  /**
   * Get node types for a specific layer
   */
  getNodeTypesForLayer(layerId: string): NodeTypeSpec[] {
    return this.loader.getNodeTypesForLayer(layerId);
  }

  /**
   * Get all predicates
   */
  getAllPredicates(): PredicateSpec[] {
    return this.loader.getAllPredicates();
  }

  /**
   * Get predicate by name
   */
  getPredicate(predicateName: string): PredicateSpec | undefined {
    return this.loader.getPredicate(predicateName);
  }

  /**
   * Get enriched metadata for a node type (including relationships and layers)
   */
  getNodeTypeMetadata(specNodeId: string): NodeTypeMetadata | undefined {
    // Check cache first
    if (this.nodeTypeMetadataCache.has(specNodeId)) {
      return this.nodeTypeMetadataCache.get(specNodeId);
    }

    const nodeType = this.loader.getNodeType(specNodeId);
    if (!nodeType) {
      return undefined;
    }

    const layer = this.loader.getLayer(nodeType.layer_id);
    const incomingRelationships = this.getRelationshipMetadata(
      this.loader.getNodeTypesReferencingType(specNodeId)
    );
    const outgoingRelationships = this.getRelationshipMetadata(
      this.loader.getNodeTypesReferencedByType(specNodeId)
    );

    const metadata: NodeTypeMetadata = {
      nodeType,
      layer,
      incomingRelationships,
      outgoingRelationships,
    };

    // Cache the metadata
    this.nodeTypeMetadataCache.set(specNodeId, metadata);

    return metadata;
  }

  /**
   * Get enriched metadata for relationship types
   */
  private getRelationshipMetadata(relationshipTypes: RelationshipTypeSpec[]): RelationshipMetadata[] {
    return relationshipTypes.map((rt) => ({
      relationshipType: rt,
      predicate: this.loader.getPredicate(rt.predicate),
      sourceNodeType: this.loader.getNodeType(rt.source_spec_node_id),
      destinationNodeType: this.loader.getNodeType(rt.destination_spec_node_id),
      sourceLayer: this.loader.getLayer(rt.source_layer),
      destinationLayer: this.loader.getLayer(rt.destination_layer),
    }));
  }

  /**
   * Validate if a relationship is valid between two node types
   */
  isValidRelationship(
    sourceSpecNodeId: string,
    destSpecNodeId: string,
    predicate?: string
  ): boolean {
    const relationships = this.loader.findRelationshipTypes({
      sourceSpecNodeId,
      destinationSpecNodeId: destSpecNodeId,
      predicate,
    });

    return relationships.length > 0;
  }

  /**
   * Get valid relationship predicates between two node types
   */
  getValidPredicates(sourceSpecNodeId: string, destSpecNodeId: string): PredicateSpec[] {
    const relationships = this.loader.findRelationshipTypes({
      sourceSpecNodeId,
      destinationSpecNodeId: destSpecNodeId,
    });

    const predicateSet = new Set<string>();
    for (const rel of relationships) {
      predicateSet.add(rel.predicate);
    }

    return Array.from(predicateSet)
      .map((p) => this.loader.getPredicate(p))
      .filter((p): p is PredicateSpec => p !== undefined);
  }

  /**
   * Find all node types that can be a source for a given destination node type with a predicate
   */
  getSourceNodeTypesForDestination(
    destSpecNodeId: string,
    predicate?: string
  ): NodeTypeSpec[] {
    const relationships = this.loader.findRelationshipTypes({
      destinationSpecNodeId: destSpecNodeId,
      predicate,
    });

    const sourceSpecNodeIds = new Set(relationships.map((r) => r.source_spec_node_id));
    const sources: NodeTypeSpec[] = [];

    for (const id of sourceSpecNodeIds) {
      const nodeType = this.loader.getNodeType(id);
      if (nodeType) {
        sources.push(nodeType);
      }
    }

    return sources;
  }

  /**
   * Find all node types that can be a destination for a given source node type with a predicate
   */
  getDestinationNodeTypesForSource(
    sourceSpecNodeId: string,
    predicate?: string
  ): NodeTypeSpec[] {
    const relationships = this.loader.findRelationshipTypes({
      sourceSpecNodeId,
      predicate,
    });

    const destSpecNodeIds = new Set(relationships.map((r) => r.destination_spec_node_id));
    const destinations: NodeTypeSpec[] = [];

    for (const id of destSpecNodeIds) {
      const nodeType = this.loader.getNodeType(id);
      if (nodeType) {
        destinations.push(nodeType);
      }
    }

    return destinations;
  }

  /**
   * Get relationship types between two layers
   */
  getRelationshipsBetweenLayers(sourceLayerId: string, destLayerId?: string): RelationshipTypeSpec[] {
    return this.loader.getRelationshipTypesForLayerPair(sourceLayerId, destLayerId);
  }

  /**
   * Validate spec data integrity
   * Returns array of issues found, empty if valid
   */
  validateIntegrity(): string[] {
    const issues: string[] = [];
    const specData = this.loader.getSpecData();

    // Validate that all relationship type references exist
    for (const relType of specData.relationshipTypes) {
      if (!specData.nodeTypes.find((nt) => nt.spec_node_id === relType.source_spec_node_id)) {
        issues.push(
          `Relationship ${relType.id} references non-existent source node type: ${relType.source_spec_node_id}`
        );
      }

      if (
        relType.destination_spec_node_id &&
        !specData.nodeTypes.find((nt) => nt.spec_node_id === relType.destination_spec_node_id)
      ) {
        issues.push(
          `Relationship ${relType.id} references non-existent destination node type: ${relType.destination_spec_node_id}`
        );
      }

      if (relType.predicate && !specData.predicates.has(relType.predicate)) {
        issues.push(
          `Relationship ${relType.id} references non-existent predicate: ${relType.predicate}`
        );
      }
    }

    // Validate that all node types are defined in a layer
    for (const nodeType of specData.nodeTypes) {
      if (!specData.layers.find((l) => l.id === nodeType.layer_id)) {
        issues.push(
          `Node type ${nodeType.spec_node_id} references non-existent layer: ${nodeType.layer_id}`
        );
      }
    }

    return issues;
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.loader.clear();
    this.nodeTypeMetadataCache.clear();
  }
}

/**
 * Global singleton instance for SpecDataService
 */
let globalSpecDataService: SpecDataService | null = null;

/**
 * Get or create global SpecDataService instance
 * WARNING: Options are only applied on first call. Subsequent calls with different
 * options will be silently ignored and the existing instance returned. Call resetGlobalSpecDataService()
 * before calling this again with different options.
 */
export function getGlobalSpecDataService(options: SpecLoaderOptions = {}): SpecDataService {
  if (!globalSpecDataService) {
    globalSpecDataService = new SpecDataService(options);
  }
  return globalSpecDataService;
}

/**
 * Reset global SpecDataService instance
 */
export function resetGlobalSpecDataService(): void {
  globalSpecDataService = null;
}
