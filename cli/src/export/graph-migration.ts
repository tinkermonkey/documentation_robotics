/**
 * Graph Migration Service
 *
 * Transforms architecture models to graph database formats.
 * Supports Neo4j and LadybugDB as primary targets.
 */

import type { Model } from "../core/model.js";
import type { GraphNode, GraphEdge } from "../core/graph-model.js";

// Re-export GraphNode and GraphEdge for convenience
export type { GraphNode, GraphEdge };

/**
 * Options for graph migration
 */
export interface GraphMigrationOptions {
  outputPath?: string;
  includeProperties?: boolean;
  includeMetadata?: boolean;
  validateReferences?: boolean;
  compressionLevel?: number; // 0-9, higher = more compression
}

/**
 * Represents the result of a graph migration
 */
export interface GraphMigrationResult {
  success: boolean;
  nodeCount: number;
  edgeCount: number;
  layersProcessed: string[];
  warnings: string[];
  errors: string[];
  duration: number;
  format: string;
  outputSize?: number;
}

/**
 * Graph database format enum
 */
export enum GraphFormat {
  NEO4J = "neo4j",
  LADYBUG = "ladybug",
  GRAPHML = "graphml",
  CYPHER = "cypher",
  GREMLIN = "gremlin",
}

/**
 * Migration-specific graph node (compatible with multiple formats)
 */
export interface MigrationGraphNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}

/**
 * Migration-specific graph edge (compatible with multiple formats)
 */
export interface MigrationGraphEdge {
  id: string;
  source: string;
  target: string;
  relationship: string;
  properties?: Record<string, unknown>;
}

/**
 * Graph Migration Service - coordinates format-specific migrations
 */
export class GraphMigrationService {
  private model: Model;
  private options: GraphMigrationOptions;

  constructor(model: Model, options: GraphMigrationOptions = {}) {
    this.model = model;
    this.options = {
      includeProperties: true,
      includeMetadata: true,
      validateReferences: true,
      ...options,
    };
  }

  /**
   * Migrate model to specified graph format
   */
  async migrate(format: GraphFormat): Promise<GraphMigrationResult> {
    const startTime = Date.now();
    const result: GraphMigrationResult = {
      success: false,
      nodeCount: 0,
      edgeCount: 0,
      layersProcessed: [],
      warnings: [],
      errors: [],
      duration: 0,
      format,
    };

    try {
      // Get model data
      const layers = await this.extractLayers();
      result.layersProcessed = Array.from(layers.keys());

      // Build graph representation
      const nodes = await this.extractNodes(layers);
      const edges = await this.extractEdges(layers);

      result.nodeCount = nodes.length;
      result.edgeCount = edges.length;

      // Validate if requested
      if (this.options.validateReferences) {
        const validationResult = this.validateGraphIntegrity(nodes, edges);
        result.warnings.push(...validationResult.warnings);
        result.errors.push(...validationResult.errors);
      }

      if (result.errors.length > 0) {
        result.success = false;
        return result;
      }

      result.success = true;
      result.duration = Date.now() - startTime;

      return result;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      result.duration = Date.now() - startTime;
      return result;
    }
  }

  /**
   * Extract layers from model
   */
  private async extractLayers(): Promise<Map<string, any>> {
    const layers = new Map();

    for (const layerName of this.model.manifest.layers ? Object.keys(this.model.manifest.layers) : []) {
      const layer = await this.model.getLayer(layerName);
      if (layer) {
        layers.set(layerName, layer);
      }
    }

    return layers;
  }

  /**
   * Extract nodes from layers
   */
  private async extractNodes(layers: Map<string, any>): Promise<MigrationGraphNode[]> {
    const nodes: MigrationGraphNode[] = [];

    for (const [layerName, layer] of layers) {
      for (const element of layer.listElements()) {
        const node: MigrationGraphNode = {
          id: element.id,
          labels: [layerName, element.type],
          properties: {
            name: element.name,
            type: element.type,
            layer: layerName,
            ...(element.description && { description: element.description }),
            ...(this.options.includeProperties && element.properties && {
              ...element.properties,
            }),
            ...(this.options.includeMetadata && {
              createdAt: element.createdAt,
              updatedAt: element.updatedAt,
            }),
          },
        };

        nodes.push(node);
      }
    }

    return nodes;
  }

  /**
   * Extract edges from layers
   */
  private async extractEdges(layers: Map<string, any>): Promise<MigrationGraphEdge[]> {
    const edges: MigrationGraphEdge[] = [];
    let edgeCounter = 0;

    for (const [, layer] of layers) {
      for (const element of layer.listElements()) {
        // Cross-layer references
        for (const ref of element.references || []) {
          edges.push({
            id: `edge_${edgeCounter++}`,
            source: element.id,
            target: ref.target,
            relationship: `REFERENCES_${ref.type.toUpperCase()}`,
            properties: ref.description ? { description: ref.description } : undefined,
          });
        }

        // Intra-layer relationships
        for (const rel of element.relationships || []) {
          edges.push({
            id: `edge_${edgeCounter++}`,
            source: element.id,
            target: rel.target,
            relationship: `${rel.predicate.toUpperCase()}`,
            properties: rel.metadata ? { ...rel.metadata } : undefined,
          });
        }
      }
    }

    return edges;
  }

  /**
   * Validate graph integrity
   */
  private validateGraphIntegrity(
    nodes: MigrationGraphNode[],
    edges: MigrationGraphEdge[]
  ): { warnings: string[]; errors: string[] } {
    const warnings: string[] = [];
    const errors: string[] = [];
    const nodeIds = new Set(nodes.map((n) => n.id));

    for (const edge of edges) {
      if (!nodeIds.has(edge.source)) {
        errors.push(`Edge ${edge.id}: Source node ${edge.source} not found`);
      }
      if (!nodeIds.has(edge.target)) {
        errors.push(`Edge ${edge.id}: Target node ${edge.target} not found`);
      }
    }

    // Check for isolated nodes
    const connectedNodes = new Set<string>();
    for (const edge of edges) {
      connectedNodes.add(edge.source);
      connectedNodes.add(edge.target);
    }

    const isolatedCount = nodes.length - connectedNodes.size;
    if (isolatedCount > 0) {
      warnings.push(
        `Found ${isolatedCount} isolated node(s) with no incoming or outgoing edges`
      );
    }

    return { warnings, errors };
  }
}
