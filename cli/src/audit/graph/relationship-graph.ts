/**
 * Relationship Graph - Graph analysis wrapper for audit system
 *
 * Builds directed graphs from intra-layer relationships using GraphModel
 * and provides audit-specific graph queries.
 */

import { GraphModel, type GraphEdge } from "../../core/graph-model.js";
import { RELATIONSHIPS } from "../../generated/relationship-index.js";
import { getAllLayers } from "../../generated/layer-registry.js";

/**
 * Relationship graph for audit analysis
 */
export class RelationshipGraph {
  private graph: GraphModel;

  constructor() {
    this.graph = new GraphModel();
  }

  /**
   * Build graph from intra-layer relationships
   */
  async build(layerId?: string): Promise<void> {
    this.graph.clear();

    // Filter relationships by layer if specified
    const relationships = layerId
      ? RELATIONSHIPS.filter((r) =>
          r.sourceSpecNodeId.startsWith(`${layerId}.`)
        )
      : RELATIONSHIPS;

    // Add nodes (node types as graph nodes)
    const nodeTypes = new Set<string>();

    // First, collect nodes from relationships
    for (const rel of relationships) {
      nodeTypes.add(rel.sourceSpecNodeId);
      nodeTypes.add(rel.destinationSpecNodeId);
    }

    // If building a layer-specific graph, also add all node types from that layer
    // (even if they have no relationships)
    if (layerId) {
      const layers = getAllLayers();
      const layer = layers.find((l) => l.id === layerId);
      if (layer) {
        for (const nodeType of layer.nodeTypes) {
          nodeTypes.add(nodeType);
        }
      }
    }

    for (const nodeType of nodeTypes) {
      const [layer, type] = nodeType.split(".");
      this.graph.addNode({
        id: nodeType,
        layer: layer || "unknown",
        type: type || "unknown",
        name: nodeType,
        properties: {},
      });
    }

    // Add edges (relationships as graph edges)
    for (const rel of relationships) {
      try {
        this.graph.addEdge({
          id: rel.id,
          source: rel.sourceSpecNodeId,
          destination: rel.destinationSpecNodeId,
          predicate: rel.predicate,
          properties: {
            cardinality: rel.cardinality,
            strength: rel.strength,
            required: rel.required,
          },
        });
      } catch (error) {
        // Skip edges where nodes don't exist
        console.warn(`Skipping edge ${rel.id}: ${error}`);
      }
    }
  }

  /**
   * Get node count
   */
  getNodeCount(): number {
    return this.graph.getNodeCount();
  }

  /**
   * Get edge count
   */
  getEdgeCount(): number {
    return this.graph.getEdgeCount();
  }

  /**
   * Get all node types in the graph
   */
  getNodeTypes(): string[] {
    return Array.from(this.graph.nodes.keys());
  }

  /**
   * Get outgoing relationships for a node type
   */
  getOutgoingRelationships(nodeType: string): GraphEdge[] {
    return this.graph.getEdgesFrom(nodeType);
  }

  /**
   * Get incoming relationships for a node type
   */
  getIncomingRelationships(nodeType: string): GraphEdge[] {
    return this.graph.getEdgesTo(nodeType);
  }

  /**
   * Get all relationships for a node type
   */
  getAllRelationships(nodeType: string): GraphEdge[] {
    return [
      ...this.graph.getEdgesFrom(nodeType),
      ...this.graph.getEdgesTo(nodeType),
    ];
  }

  /**
   * Find paths between two node types
   */
  findPaths(
    sourceType: string,
    destType: string,
    maxDepth: number = 5
  ): string[][] {
    const paths: string[][] = [];
    const visited = new Set<string>();

    const dfs = (current: string, path: string[], depth: number) => {
      if (depth > maxDepth) {
        return;
      }

      if (current === destType) {
        paths.push([...path, current]);
        return;
      }

      if (visited.has(current)) {
        return;
      }

      visited.add(current);
      path.push(current);

      const outgoing = this.graph.getEdgesFrom(current);
      for (const edge of outgoing) {
        dfs(edge.destination, [...path], depth + 1);
      }

      visited.delete(current);
    };

    dfs(sourceType, [], 0);
    return paths;
  }

  /**
   * Get neighbors of a node type
   */
  getNeighbors(nodeType: string): string[] {
    const neighbors = new Set<string>();

    const outgoing = this.graph.getEdgesFrom(nodeType);
    for (const edge of outgoing) {
      neighbors.add(edge.destination);
    }

    const incoming = this.graph.getEdgesTo(nodeType);
    for (const edge of incoming) {
      neighbors.add(edge.source);
    }

    return Array.from(neighbors);
  }

  /**
   * Get the underlying graph model
   */
  getGraphModel(): GraphModel {
    return this.graph;
  }
}
