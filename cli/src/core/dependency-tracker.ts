import Graph from 'graphology';
import { ReferenceRegistry } from './reference-registry.js';
import { Model } from './model.js';

/**
 * Direction to trace dependencies (matches Python CLI TraceDirection enum)
 */
export enum TraceDirection {
  UP = 'up',     // Find what this depends on (successors/descendants)
  DOWN = 'down', // Find what depends on this (predecessors/ancestors)
  BOTH = 'both'  // Both directions
}

/**
 * Represents a dependency path between two elements
 */
export interface DependencyPath {
  source: string;
  target: string;
  path: string[];
  depth: number;
  relationship_types: string[];
}

/**
 * Dependency tracker - analyzes dependencies between elements
 *
 * Uses reference registry and graph algorithms to provide
 * dependency analysis and impact assessment.
 *
 * Matches Python CLI behavior from dependency_tracker.py
 */
export class DependencyTracker {
  private registry?: ReferenceRegistry;
  private graph: Graph;
  private model?: Model;

  constructor(registryOrGraph: ReferenceRegistry | Graph, model?: Model) {
    if (registryOrGraph instanceof Graph) {
      this.graph = registryOrGraph;
    } else {
      this.registry = registryOrGraph;
      this.graph = registryOrGraph.getDependencyGraph();
    }
    this.model = model;
  }

  /**
   * Get dependency graph
   */
  private getGraph(): Graph {
    if (this.registry) {
      // Rebuild from registry each time to reflect new references
      this.graph = this.registry.getDependencyGraph();
    }
    return this.graph;
  }

  /**
   * Trace dependencies from an element
   *
   * @param elementId - Element ID to start from
   * @param direction - Direction to trace (up, down, both)
   * @param maxDepth - Maximum depth to trace (null = unlimited)
   * @returns Array of dependent element IDs
   */
  traceDependencies(
    elementId: string,
    direction: TraceDirection = TraceDirection.BOTH,
    maxDepth: number | null = null
  ): string[] {
    const graph = this.getGraph();

    if (!graph.hasNode(elementId)) {
      return [];
    }

    const dependencies = new Set<string>();

    // Trace upward (what this element depends on - successors)
    if (direction === TraceDirection.UP || direction === TraceDirection.BOTH) {
      const upDeps = this._traceUp(graph, elementId, maxDepth);
      upDeps.forEach(id => dependencies.add(id));
    }

    // Trace downward (what depends on this element - predecessors)
    if (direction === TraceDirection.DOWN || direction === TraceDirection.BOTH) {
      const downDeps = this._traceDown(graph, elementId, maxDepth);
      downDeps.forEach(id => dependencies.add(id));
    }

    return Array.from(dependencies);
  }

  /**
   * Trace upward dependencies (what element depends on - successors)
   * Private helper matching Python CLI behavior
   */
  private _traceUp(graph: Graph, elementId: string, maxDepth: number | null): Set<string> {
    if (maxDepth === null) {
      // Get all descendants (unlimited depth)
      return this._getDescendants(graph, elementId);
    } else {
      // Get descendants within depth using BFS
      return this._getDescendantsLimited(graph, elementId, maxDepth);
    }
  }

  /**
   * Trace downward dependencies (what depends on element - predecessors)
   * Private helper matching Python CLI behavior
   */
  private _traceDown(graph: Graph, elementId: string, maxDepth: number | null): Set<string> {
    if (maxDepth === null) {
      // Get all ancestors (unlimited depth)
      return this._getAncestors(graph, elementId);
    } else {
      // Get ancestors within depth using BFS
      return this._getAncestorsLimited(graph, elementId, maxDepth);
    }
  }

  /**
   * Get all descendants (reachable via outgoing edges) - DFS
   * Equivalent to networkx.descendants()
   */
  private _getDescendants(graph: Graph, startNode: string): Set<string> {
    const visited = new Set<string>();
    const stack = [startNode];

    while (stack.length > 0) {
      const node = stack.pop()!;

      if (!graph.hasNode(node)) continue;

      for (const neighbor of graph.outNeighbors(node)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }

    return visited;
  }

  /**
   * Get ancestors (reachable via incoming edges) - DFS
   * Equivalent to networkx.ancestors()
   */
  private _getAncestors(graph: Graph, startNode: string): Set<string> {
    const visited = new Set<string>();
    const stack = [startNode];

    while (stack.length > 0) {
      const node = stack.pop()!;

      if (!graph.hasNode(node)) continue;

      for (const neighbor of graph.inNeighbors(node)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }

    return visited;
  }

  /**
   * Get descendants within max_depth using BFS level-by-level
   * Matches Python CLI behavior exactly
   */
  private _getDescendantsLimited(graph: Graph, startNode: string, maxDepth: number): Set<string> {
    const descendants = new Set<string>();
    let currentLevel = new Set([startNode]);

    for (let depth = 0; depth < maxDepth; depth++) {
      const nextLevel = new Set<string>();

      for (const node of currentLevel) {
        if (!graph.hasNode(node)) continue;

        for (const neighbor of graph.outNeighbors(node)) {
          nextLevel.add(neighbor);
        }
      }

      nextLevel.forEach(id => descendants.add(id));
      currentLevel = nextLevel;

      if (currentLevel.size === 0) {
        break;
      }
    }

    return descendants;
  }

  /**
   * Get ancestors within max_depth using BFS level-by-level
   * Matches Python CLI behavior exactly
   */
  private _getAncestorsLimited(graph: Graph, startNode: string, maxDepth: number): Set<string> {
    const ancestors = new Set<string>();
    let currentLevel = new Set([startNode]);

    for (let depth = 0; depth < maxDepth; depth++) {
      const nextLevel = new Set<string>();

      for (const node of currentLevel) {
        if (!graph.hasNode(node)) continue;

        for (const neighbor of graph.inNeighbors(node)) {
          nextLevel.add(neighbor);
        }
      }

      nextLevel.forEach(id => ancestors.add(id));
      currentLevel = nextLevel;

      if (currentLevel.size === 0) {
        break;
      }
    }

    return ancestors;
  }

  /**
   * Find all dependency paths between two elements
   *
   * @param sourceId - Source element ID
   * @param targetId - Target element ID
   * @param maxPaths - Maximum number of paths to return
   * @returns Array of dependency paths
   */
  findDependencyPaths(
    sourceId: string,
    targetId: string,
    maxPaths: number = 10
  ): DependencyPath[] {
    const graph = this.getGraph();

    if (!graph.hasNode(sourceId) || !graph.hasNode(targetId)) {
      return [];
    }

    // Find all simple paths (no cycles)
    const paths = this._findAllSimplePaths(graph, sourceId, targetId, maxPaths);

    // Convert to DependencyPath objects
    return paths.map(path => {
      // Get relationship types along path
      const relationshipTypes: string[] = [];
      for (let i = 0; i < path.length - 1; i++) {
        const edgeAttrs = graph.getEdgeAttributes(path[i], path[i + 1]);
        relationshipTypes.push(edgeAttrs?.type || 'unknown');
      }

      return {
        source: sourceId,
        target: targetId,
        path,
        depth: path.length - 1,
        relationship_types: relationshipTypes
      };
    });
  }

  /**
   * Find all simple paths between source and target
   * Implements DFS path-finding similar to networkx.all_simple_paths
   */
  private _findAllSimplePaths(
    graph: Graph,
    source: string,
    target: string,
    maxPaths: number
  ): string[][] {
    const paths: string[][] = [];
    const visited = new Set<string>();

    const dfs = (current: string, path: string[]) => {
      if (paths.length >= maxPaths) {
        return;
      }

      if (current === target) {
        paths.push([...path, current]);
        return;
      }

      visited.add(current);
      path.push(current);

      if (graph.hasNode(current)) {
        for (const neighbor of graph.outNeighbors(current)) {
          if (!visited.has(neighbor)) {
            dfs(neighbor, path);
          }
        }
      }

      path.pop();
      visited.delete(current);
    };

    dfs(source, []);
    return paths;
  }

  /**
   * Find hub elements (elements with many connections)
   *
   * @param threshold - Minimum number of connections to be considered a hub
   * @returns Array of [elementId, connectionCount] tuples, sorted by count descending
   */
  getHubElements(threshold: number = 10): [string, number][] {
    const graph = this.getGraph();
    const hubs: [string, number][] = [];

    for (const node of graph.nodes()) {
      const degree = graph.degree(node);
      if (degree >= threshold) {
        hubs.push([node, degree]);
      }
    }

    // Sort by degree descending
    hubs.sort((a, b) => b[1] - a[1]);

    return hubs;
  }

  /**
   * Get direct dependents (incoming edges)
   */
  getDependents(elementId: string): string[] {
    const graph = this.getGraph();
    if (!graph.hasNode(elementId)) return [];
    return graph.inNeighbors(elementId);
  }

  /**
   * Get direct dependencies (outgoing edges)
   */
  getDependencies(elementId: string): string[] {
    const graph = this.getGraph();
    if (!graph.hasNode(elementId)) return [];
    return graph.outNeighbors(elementId);
  }

  /**
   * Get all elements that transitively depend on the given element (ancestors)
   */
  getTransitiveDependents(elementId: string): string[] {
    const graph = this.getGraph();
    if (!graph.hasNode(elementId)) return [];
    return Array.from(this._getAncestors(graph, elementId));
  }

  /**
   * Get all elements this element transitively depends on (descendants)
   */
  getTransitiveDependencies(elementId: string): string[] {
    const graph = this.getGraph();
    if (!graph.hasNode(elementId)) return [];
    return Array.from(this._getDescendants(graph, elementId));
  }

  /**
   * Detect cycles in the dependency graph
   */
  detectCycles(): string[][] {
    const graph = this.getGraph();
    const visited = new Set<string>();
    const stack = new Set<string>();
    const path: string[] = [];
    const cycleMap = new Map<string, string[]>();

    const canonicalKey = (cycle: string[]): string => {
      // Normalize cycle representation to avoid duplicates
      const unique = Array.from(new Set(cycle));
      unique.sort();
      return unique.join('|');
    };

    const dfs = (node: string) => {
      visited.add(node);
      stack.add(node);
      path.push(node);

      for (const neighbor of graph.outNeighbors(node)) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (stack.has(neighbor)) {
          // Found a cycle, capture the slice from neighbor to current
          const idx = path.indexOf(neighbor);
          if (idx !== -1) {
            const cycle = path.slice(idx);
            const key = canonicalKey(cycle);
            if (!cycleMap.has(key)) {
              cycleMap.set(key, [...cycle]);
            }
          }
        }
      }

      stack.delete(node);
      path.pop();
    };

    for (const node of graph.nodes()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return Array.from(cycleMap.values());
  }

  /**
   * Calculate basic graph metrics
   */
  getMetrics(): { nodeCount: number; edgeCount: number; cycleCount: number; connectedComponents: number } {
    const graph = this.getGraph();

    const nodeCount = graph.order;
    const edgeCount = graph.size;
    const cycleCount = this.detectCycles().length;

    // Count weakly connected components
    const visited = new Set<string>();
    let connectedComponents = 0;

    const bfs = (start: string) => {
      const queue = [start];
      visited.add(start);

      while (queue.length > 0) {
        const node = queue.shift()!;
        const neighbors = new Set<string>([
          ...graph.outNeighbors(node),
          ...graph.inNeighbors(node)
        ]);

        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    };

    for (const node of graph.nodes()) {
      if (!visited.has(node)) {
        connectedComponents += 1;
        bfs(node);
      }
    }

    return { nodeCount, edgeCount, cycleCount, connectedComponents };
  }

  /**
   * Find elements with no incoming edges
   */
  findSourceElements(): string[] {
    const graph = this.getGraph();
    const sources: string[] = [];

    for (const node of graph.nodes()) {
      if (graph.inNeighbors(node).length === 0) {
        sources.push(node);
      }
    }

    return sources;
  }

  /**
   * Find elements with no outgoing edges
   */
  findSinkElements(): string[] {
    const graph = this.getGraph();
    const sinks: string[] = [];

    for (const node of graph.nodes()) {
      if (graph.outNeighbors(node).length === 0) {
        sinks.push(node);
      }
    }

    return sinks;
  }

  /**
   * Calculate how many elements would be impacted if this element changed
   * (all ancestors/predecessors excluding the element itself)
   */
  getImpactRadius(elementId: string): number {
    const graph = this.getGraph();
    if (!graph.hasNode(elementId)) return 0;
    const impacted = this._getAncestors(graph, elementId);
    return impacted.size;
  }

  /**
   * Get longest dependency chain depth from this element (outgoing edges)
   */
  getDependencyDepth(elementId: string): number {
    const graph = this.getGraph();
    if (!graph.hasNode(elementId)) return -1;

    const memo = new Map<string, number>();
    const stack = new Set<string>();

    const dfsDepth = (node: string): number => {
      if (memo.has(node)) return memo.get(node)!;
      if (stack.has(node)) return 0; // break cycles

      stack.add(node);
      let maxDepth = 0;

      for (const neighbor of graph.outNeighbors(node)) {
        const neighborDepth = dfsDepth(neighbor);
        maxDepth = Math.max(maxDepth, 1 + neighborDepth);
      }

      stack.delete(node);
      memo.set(node, maxDepth);
      return maxDepth;
    };

    return dfsDepth(elementId);
  }

  /**
   * Group dependencies by layer (requires model)
   */
  getDependencyLayers(elementId: string): Record<string, string[]> {
    if (!this.model) return {};

    const byLayer: Record<string, string[]> = {};
    const dependencies = this.traceDependencies(elementId, TraceDirection.BOTH);

    for (const depId of dependencies) {
      const element = this.model.getElementById(depId);
      if (!element || !element.layer) continue;

      if (!byLayer[element.layer]) {
        byLayer[element.layer] = [];
      }
      byLayer[element.layer].push(depId);
    }

    return byLayer;
  }

  /**
   * Find elements with no references (requires model)
   */
  getOrphanedElements(): any[] {
    if (!this.model) return [];

    const graph = this.getGraph();
    const orphaned: any[] = [];

    for (const layer of this.model.layers.values()) {
      for (const element of layer.elements.values()) {
        if (!graph.hasNode(element.id)) {
          orphaned.push(element);
        } else if (graph.degree(element.id) === 0) {
          orphaned.push(element);
        }
      }
    }

    return orphaned;
  }
}
