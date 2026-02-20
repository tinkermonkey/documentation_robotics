/**
 * Connectivity Analyzer - Analyzes graph connectivity
 *
 * Provides:
 * - Connected component detection
 * - Node degree distribution
 * - Isolated node identification
 * - Transitive chain detection
 */

import { RelationshipCatalog } from "../../core/relationship-catalog.js";
import { RelationshipGraph } from "./relationship-graph.js";
import type {
  ConnectedComponent,
  NodeDegree,
  TransitiveChain,
} from "../types.js";

/**
 * Connectivity analyzer for relationship graphs
 */
export class ConnectivityAnalyzer {
  constructor(
    private graph: RelationshipGraph,
    private catalog: RelationshipCatalog
  ) {}

  /**
   * Find connected components using undirected traversal
   */
  findConnectedComponents(): ConnectedComponent[] {
    const visited = new Set<string>();
    const components: ConnectedComponent[] = [];

    for (const nodeType of this.graph.getNodeTypes()) {
      if (visited.has(nodeType)) {
        continue;
      }

      // BFS to find component
      const component = this.bfsComponent(nodeType, visited);
      if (component.length > 0) {
        components.push({
          nodes: component,
          size: component.length,
        });
      }
    }

    return components.sort((a, b) => b.size - a.size);
  }

  /**
   * BFS to find connected component (undirected)
   */
  private bfsComponent(start: string, visited: Set<string>): string[] {
    const component: string[] = [];
    const queue: string[] = [start];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);
      component.push(current);

      // Get neighbors (both incoming and outgoing)
      const neighbors = this.graph.getNeighbors(current);
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    return component;
  }

  /**
   * Calculate node degree distribution
   */
  calculateDegreeDistribution(): NodeDegree[] {
    const degrees: NodeDegree[] = [];

    for (const nodeType of this.graph.getNodeTypes()) {
      const outgoing = this.graph.getOutgoingRelationships(nodeType);
      const incoming = this.graph.getIncomingRelationships(nodeType);

      degrees.push({
        nodeType,
        inDegree: incoming.length,
        outDegree: outgoing.length,
        totalDegree: incoming.length + outgoing.length,
      });
    }

    return degrees.sort((a, b) => b.totalDegree - a.totalDegree);
  }

  /**
   * Identify isolated nodes (degree === 0)
   */
  findIsolatedNodes(): string[] {
    const degrees = this.calculateDegreeDistribution();
    return degrees
      .filter((d) => d.totalDegree === 0)
      .map((d) => d.nodeType);
  }

  /**
   * Find transitive chains for transitive predicates
   */
  async findTransitiveChains(): Promise<TransitiveChain[]> {
    const chains: TransitiveChain[] = [];

    // Get all transitive predicates
    const allTypes = this.catalog.getAllTypes();
    const transitivePredicates = allTypes
      .filter((t) => t.semantics.transitivity)
      .map((t) => t.predicate);

    // For each transitive predicate, find chains
    for (const predicate of transitivePredicates) {
      const predicateChains = this.findChainsForPredicate(predicate);
      chains.push(...predicateChains);
    }

    return chains.sort((a, b) => b.length - a.length);
  }

  /**
   * Find chains for a specific predicate
   */
  private findChainsForPredicate(predicate: string): TransitiveChain[] {
    const chains: TransitiveChain[] = [];
    const visited = new Set<string>();

    for (const nodeType of this.graph.getNodeTypes()) {
      if (visited.has(nodeType)) {
        continue;
      }

      // DFS to find chain
      const chain = this.dfsChain(nodeType, predicate, visited, []);
      if (chain.length > 1) {
        chains.push({
          predicate,
          chain,
          length: chain.length,
        });
      }
    }

    return chains;
  }

  /**
   * DFS to find transitive chain
   */
  private dfsChain(
    current: string,
    predicate: string,
    visited: Set<string>,
    path: string[]
  ): string[] {
    if (visited.has(current)) {
      return path;
    }

    visited.add(current);
    path.push(current);

    // Find outgoing edges with the predicate
    const outgoing = this.graph
      .getOutgoingRelationships(current)
      .filter((e) => e.predicate === predicate);

    if (outgoing.length === 0) {
      return path;
    }

    // Follow the first edge (prefer longest chain)
    let longestChain = path;
    for (const edge of outgoing) {
      const chain = this.dfsChain(
        edge.destination,
        predicate,
        new Set(visited),
        [...path]
      );
      if (chain.length > longestChain.length) {
        longestChain = chain;
      }
    }

    return longestChain;
  }

  /**
   * Get statistics about connectivity
   */
  getConnectivityStats(): {
    nodeCount: number;
    edgeCount: number;
    componentCount: number;
    isolatedNodeCount: number;
    largestComponentSize: number;
    averageDegree: number;
  } {
    const components = this.findConnectedComponents();
    const isolated = this.findIsolatedNodes();
    const degrees = this.calculateDegreeDistribution();

    const totalDegree = degrees.reduce(
      (sum, d) => sum + d.totalDegree,
      0
    );
    const averageDegree =
      degrees.length > 0 ? totalDegree / degrees.length : 0;

    return {
      nodeCount: this.graph.getNodeCount(),
      edgeCount: this.graph.getEdgeCount(),
      componentCount: components.length,
      isolatedNodeCount: isolated.length,
      largestComponentSize:
        components.length > 0 ? components[0].size : 0,
      averageDegree,
    };
  }
}
