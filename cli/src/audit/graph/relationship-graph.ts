/**
 * Relationship Graph - Graph analysis wrapper for audit system
 *
 * Builds directed graphs from intra-layer relationships using GraphModel
 * and provides audit-specific graph queries.
 */

import { GraphModel, type GraphEdge } from "../../core/graph-model.js";
import { RELATIONSHIPS } from "../../generated/relationship-index.js";
import { getAllLayers } from "../../generated/layer-registry.js";
import type { Relationship } from "../../core/relationships.js";
import type { Element } from "../../core/element.js";

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
    const skippedEdges: Array<{
      relationshipId: string;
      source: string;
      destination: string;
      reason: string;
    }> = [];

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
        // Track data integrity issues - relationships referencing non-existent node types
        const reason = error instanceof Error ? error.message : String(error);
        skippedEdges.push({
          relationshipId: rel.id,
          source: rel.sourceSpecNodeId,
          destination: rel.destinationSpecNodeId,
          reason,
        });

        // Log to stderr for visibility
        console.error(
          `⚠️  Data integrity issue: Relationship "${rel.id}" references non-existent node type. ${reason}`
        );
      }
    }

    // Report summary if any edges were skipped
    if (skippedEdges.length > 0) {
      console.error(
        `\n⚠️  Warning: ${skippedEdges.length} relationship(s) skipped due to missing node type references.`
      );
      console.error(
        `This indicates data integrity issues in the relationship schemas.`
      );
      console.error(
        `Run 'dr schema relationships' to validate relationship definitions.\n`
      );
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

  /**
   * Build graph from actual model relationship instances and elements.
   * Used by ModelAuditOrchestrator to analyse the project model rather than spec schemas.
   */
  buildFromModel(relationships: Relationship[], elements: Element[]): void {
    this.graph.clear();

    // Index elements by ID for quick lookup
    const elementById = new Map<string, Element>(
      elements.map((e) => [e.id, e])
    );

    // Add one graph node per distinct spec_node_id (using spec_node_id as the node id)
    const specNodeIds = new Set<string>(
      elements.map((e) => e.spec_node_id).filter(Boolean)
    );

    for (const specNodeId of specNodeIds) {
      const [layer, type] = specNodeId.split(".");
      this.graph.addNode({
        id: specNodeId,
        layer: layer ?? "unknown",
        type: type ?? "unknown",
        name: specNodeId,
        properties: {},
      });
    }

    // Add edges from relationship instances, keyed by source/target spec_node_id
    let edgeCounter = 0;
    for (const rel of relationships) {
      const srcEl = elementById.get(rel.source);
      const dstEl = elementById.get(rel.target);
      if (!srcEl?.spec_node_id || !dstEl?.spec_node_id) continue;

      try {
        this.graph.addEdge({
          id: `model-rel-${edgeCounter++}`,
          source: srcEl.spec_node_id,
          destination: dstEl.spec_node_id,
          predicate: rel.predicate,
          properties: rel.properties as Record<string, unknown> | undefined,
          category: rel.category,
        });
      } catch {
        // Silently skip edges where the node wasn't added (shouldn't happen but be safe)
      }
    }
  }
}
