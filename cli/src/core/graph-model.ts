import { Element } from "./element.js";
import type { Relationship } from "../types/index.js";

/**
 * Graph node representing a model element
 * Replaces Element class for graph-based storage
 */
export interface GraphNode {
  id: string;                          // Unique identifier
  layer: string;                       // Layer this node belongs to
  type: string;                        // Element type
  name: string;                        // Display name
  description?: string;                // Optional description
  properties: Record<string, unknown>; // Custom properties
}

/**
 * Graph edge representing a relationship between nodes
 */
export interface GraphEdge {
  id: string;                          // Unique identifier
  source: string;                      // Source node ID
  destination: string;                 // Destination node ID
  predicate: string;                   // Relationship type
  properties?: Record<string, unknown>; // Optional properties
  category?: 'structural' | 'behavioral';
}

/**
 * Index structures for efficient querying
 */
interface GraphIndices {
  nodesByLayer: Map<string, Set<string>>;           // layer -> node IDs
  nodesByType: Map<string, Set<string>>;            // type -> node IDs
  edgesBySource: Map<string, Set<string>>;          // source node ID -> edge IDs
  edgesByDestination: Map<string, Set<string>>;     // destination node ID -> edge IDs
  edgesByPredicate: Map<string, Set<string>>;       // predicate -> edge IDs
}

/**
 * Graph model interface for node/edge storage with query capabilities
 */
export interface IGraphModel {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;

  // Query methods
  getNodesByLayer(layer: string): GraphNode[];
  getNodesByType(type: string): GraphNode[];
  getEdgesFrom(nodeId: string, predicate?: string): GraphEdge[];
  getEdgesTo(nodeId: string, predicate?: string): GraphEdge[];
  getEdgesBetween(sourceId: string, destinationId: string, predicate?: string): GraphEdge[];

  // Mutation methods
  addNode(node: GraphNode): void;
  removeNode(nodeId: string): boolean;
  updateNode(nodeId: string, updates: Partial<GraphNode>): boolean;

  addEdge(edge: GraphEdge): void;
  removeEdge(edgeId: string): boolean;
  updateEdge(edgeId: string, updates: Partial<GraphEdge>): boolean;

  // Traversal
  traverse(startNodeId: string, predicate?: string, maxDepth?: number): GraphNode[];

  // Utility
  getNodeCount(): number;
  getEdgeCount(): number;
  clear(): void;
}

/**
 * Implementation of graph model with indices for efficient queries
 */
export class GraphModel implements IGraphModel {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  private indices: GraphIndices;

  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.indices = {
      nodesByLayer: new Map(),
      nodesByType: new Map(),
      edgesBySource: new Map(),
      edgesByDestination: new Map(),
      edgesByPredicate: new Map(),
    };
  }

  /**
   * Add a node to the graph and update indices
   */
  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);

    // Update layer index
    if (!this.indices.nodesByLayer.has(node.layer)) {
      this.indices.nodesByLayer.set(node.layer, new Set());
    }
    this.indices.nodesByLayer.get(node.layer)!.add(node.id);

    // Update type index
    if (!this.indices.nodesByType.has(node.type)) {
      this.indices.nodesByType.set(node.type, new Set());
    }
    this.indices.nodesByType.get(node.type)!.add(node.id);
  }

  /**
   * Remove a node from the graph
   * Also removes all associated edges
   */
  removeNode(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return false;
    }

    // Remove from nodes map
    this.nodes.delete(nodeId);

    // Remove from layer index
    const layerSet = this.indices.nodesByLayer.get(node.layer);
    if (layerSet) {
      layerSet.delete(nodeId);
      if (layerSet.size === 0) {
        this.indices.nodesByLayer.delete(node.layer);
      }
    }

    // Remove from type index
    const typeSet = this.indices.nodesByType.get(node.type);
    if (typeSet) {
      typeSet.delete(nodeId);
      if (typeSet.size === 0) {
        this.indices.nodesByType.delete(node.type);
      }
    }

    // Remove all edges involving this node
    const edgesInvolving: string[] = [];
    for (const [edgeId, edge] of this.edges.entries()) {
      if (edge.source === nodeId || edge.destination === nodeId) {
        edgesInvolving.push(edgeId);
      }
    }
    for (const edgeId of edgesInvolving) {
      this.removeEdge(edgeId);
    }

    return true;
  }

  /**
   * Update node properties
   */
  updateNode(nodeId: string, updates: Partial<GraphNode>): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return false;
    }

    // Handle layer change
    if (updates.layer && updates.layer !== node.layer) {
      const oldLayerSet = this.indices.nodesByLayer.get(node.layer);
      if (oldLayerSet) {
        oldLayerSet.delete(nodeId);
        if (oldLayerSet.size === 0) {
          this.indices.nodesByLayer.delete(node.layer);
        }
      }
      if (!this.indices.nodesByLayer.has(updates.layer)) {
        this.indices.nodesByLayer.set(updates.layer, new Set());
      }
      this.indices.nodesByLayer.get(updates.layer)!.add(nodeId);
    }

    // Handle type change
    if (updates.type && updates.type !== node.type) {
      const oldTypeSet = this.indices.nodesByType.get(node.type);
      if (oldTypeSet) {
        oldTypeSet.delete(nodeId);
        if (oldTypeSet.size === 0) {
          this.indices.nodesByType.delete(node.type);
        }
      }
      if (!this.indices.nodesByType.has(updates.type)) {
        this.indices.nodesByType.set(updates.type, new Set());
      }
      this.indices.nodesByType.get(updates.type)!.add(nodeId);
    }

    // Apply updates
    Object.assign(node, updates);
    return true;
  }

  /**
   * Add an edge to the graph and update indices
   */
  addEdge(edge: GraphEdge): void {
    this.edges.set(edge.id, edge);

    // Update source index
    if (!this.indices.edgesBySource.has(edge.source)) {
      this.indices.edgesBySource.set(edge.source, new Set());
    }
    this.indices.edgesBySource.get(edge.source)!.add(edge.id);

    // Update destination index
    if (!this.indices.edgesByDestination.has(edge.destination)) {
      this.indices.edgesByDestination.set(edge.destination, new Set());
    }
    this.indices.edgesByDestination.get(edge.destination)!.add(edge.id);

    // Update predicate index
    if (!this.indices.edgesByPredicate.has(edge.predicate)) {
      this.indices.edgesByPredicate.set(edge.predicate, new Set());
    }
    this.indices.edgesByPredicate.get(edge.predicate)!.add(edge.id);
  }

  /**
   * Remove an edge from the graph
   */
  removeEdge(edgeId: string): boolean {
    const edge = this.edges.get(edgeId);
    if (!edge) {
      return false;
    }

    // Remove from edges map
    this.edges.delete(edgeId);

    // Remove from source index
    const sourceSet = this.indices.edgesBySource.get(edge.source);
    if (sourceSet) {
      sourceSet.delete(edgeId);
      if (sourceSet.size === 0) {
        this.indices.edgesBySource.delete(edge.source);
      }
    }

    // Remove from destination index
    const destSet = this.indices.edgesByDestination.get(edge.destination);
    if (destSet) {
      destSet.delete(edgeId);
      if (destSet.size === 0) {
        this.indices.edgesByDestination.delete(edge.destination);
      }
    }

    // Remove from predicate index
    const predicateSet = this.indices.edgesByPredicate.get(edge.predicate);
    if (predicateSet) {
      predicateSet.delete(edgeId);
      if (predicateSet.size === 0) {
        this.indices.edgesByPredicate.delete(edge.predicate);
      }
    }

    return true;
  }

  /**
   * Update edge properties
   */
  updateEdge(edgeId: string, updates: Partial<GraphEdge>): boolean {
    const edge = this.edges.get(edgeId);
    if (!edge) {
      return false;
    }

    // Handle predicate change
    if (updates.predicate && updates.predicate !== edge.predicate) {
      const oldPredicateSet = this.indices.edgesByPredicate.get(edge.predicate);
      if (oldPredicateSet) {
        oldPredicateSet.delete(edgeId);
        if (oldPredicateSet.size === 0) {
          this.indices.edgesByPredicate.delete(edge.predicate);
        }
      }
      if (!this.indices.edgesByPredicate.has(updates.predicate)) {
        this.indices.edgesByPredicate.set(updates.predicate, new Set());
      }
      this.indices.edgesByPredicate.get(updates.predicate)!.add(edgeId);
    }

    // Note: Source and destination changes are not supported (use removeEdge + addEdge)
    // Apply updates
    Object.assign(edge, updates);
    return true;
  }

  /**
   * Get all nodes in a specific layer
   */
  getNodesByLayer(layer: string): GraphNode[] {
    const nodeIds = this.indices.nodesByLayer.get(layer) ?? new Set();
    return Array.from(nodeIds).map((id) => this.nodes.get(id)!);
  }

  /**
   * Get all nodes of a specific type
   */
  getNodesByType(type: string): GraphNode[] {
    const nodeIds = this.indices.nodesByType.get(type) ?? new Set();
    return Array.from(nodeIds).map((id) => this.nodes.get(id)!);
  }

  /**
   * Get outgoing edges from a node, optionally filtered by predicate
   */
  getEdgesFrom(nodeId: string, predicate?: string): GraphEdge[] {
    const edgeIds = this.indices.edgesBySource.get(nodeId) ?? new Set();
    const edges = Array.from(edgeIds).map((id) => this.edges.get(id)!);

    if (predicate) {
      return edges.filter((e) => e.predicate === predicate);
    }
    return edges;
  }

  /**
   * Get incoming edges to a node, optionally filtered by predicate
   */
  getEdgesTo(nodeId: string, predicate?: string): GraphEdge[] {
    const edgeIds = this.indices.edgesByDestination.get(nodeId) ?? new Set();
    const edges = Array.from(edgeIds).map((id) => this.edges.get(id)!);

    if (predicate) {
      return edges.filter((e) => e.predicate === predicate);
    }
    return edges;
  }

  /**
   * Get edges between two specific nodes
   */
  getEdgesBetween(sourceId: string, destinationId: string, predicate?: string): GraphEdge[] {
    const outgoing = this.getEdgesFrom(sourceId, predicate);
    return outgoing.filter((e) => e.destination === destinationId);
  }

  /**
   * Traverse the graph starting from a node using breadth-first search
   */
  traverse(startNodeId: string, predicate?: string, maxDepth: number = Infinity): GraphNode[] {
    const visited = new Set<string>();
    const result: GraphNode[] = [];
    const queue: { nodeId: string; depth: number }[] = [{ nodeId: startNodeId, depth: 0 }];

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;

      if (visited.has(nodeId) || depth > maxDepth) {
        continue;
      }

      visited.add(nodeId);
      const node = this.nodes.get(nodeId);
      if (node) {
        result.push(node);
      }

      // Find outgoing edges
      const edges = this.getEdgesFrom(nodeId, predicate);
      for (const edge of edges) {
        if (!visited.has(edge.destination)) {
          queue.push({ nodeId: edge.destination, depth: depth + 1 });
        }
      }
    }

    return result;
  }

  /**
   * Get total number of nodes
   */
  getNodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Get total number of edges
   */
  getEdgeCount(): number {
    return this.edges.size;
  }

  /**
   * Clear all data from the graph
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.indices.nodesByLayer.clear();
    this.indices.nodesByType.clear();
    this.indices.edgesBySource.clear();
    this.indices.edgesByDestination.clear();
    this.indices.edgesByPredicate.clear();
  }

  /**
   * Convert Element to GraphNode
   */
  static fromElement(element: Element): GraphNode {
    return {
      id: element.id,
      layer: element.layer || 'unknown',
      type: element.type,
      name: element.name,
      description: element.description,
      properties: element.properties,
    };
  }

  /**
   * Convert Relationship to GraphEdge
   */
  static relationshipToEdge(relationship: Relationship, edgeId: string): GraphEdge {
    return {
      id: edgeId,
      source: relationship.source,
      destination: relationship.target,
      predicate: relationship.predicate,
      properties: relationship.properties,
    };
  }
}
