import Graph from 'graphology';

/**
 * Dependency tracker - analyzes dependencies and relationships in the model graph
 */
export class DependencyTracker {
  private graph: Graph;

  constructor(graph: Graph) {
    this.graph = graph;
  }

  /**
   * Get direct dependents of an element (elements that have incoming edges)
   * These are elements that depend on the given element
   */
  getDependents(elementId: string): string[] {
    if (!this.graph.hasNode(elementId)) {
      return [];
    }
    return this.graph.inNeighbors(elementId);
  }

  /**
   * Get direct dependencies of an element (elements with outgoing edges)
   * These are elements that this element depends on
   */
  getDependencies(elementId: string): string[] {
    if (!this.graph.hasNode(elementId)) {
      return [];
    }
    return this.graph.outNeighbors(elementId);
  }

  /**
   * Get all transitive dependents (all elements that transitively depend on this element)
   * Uses DFS traversal in inbound direction
   */
  getTransitiveDependents(elementId: string): string[] {
    if (!this.graph.hasNode(elementId)) {
      return [];
    }

    const visited = new Set<string>();
    const stack = [elementId];

    while (stack.length > 0) {
      const node = stack.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);

      // Get all nodes that have edges TO this node (inbound)
      for (const neighbor of this.graph.inNeighbors(node)) {
        if (!visited.has(neighbor as string)) {
          stack.push(neighbor as string);
        }
      }
    }

    // Remove the source element itself
    visited.delete(elementId);
    return Array.from(visited);
  }

  /**
   * Get all transitive dependencies (all elements this element transitively depends on)
   * Uses DFS traversal in outbound direction
   */
  getTransitiveDependencies(elementId: string): string[] {
    if (!this.graph.hasNode(elementId)) {
      return [];
    }

    const visited = new Set<string>();
    const stack = [elementId];

    while (stack.length > 0) {
      const node = stack.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);

      // Get all nodes this node has edges to (outbound)
      for (const neighbor of this.graph.outNeighbors(node)) {
        if (!visited.has(neighbor as string)) {
          stack.push(neighbor as string);
        }
      }
    }

    // Remove the source element itself
    visited.delete(elementId);
    return Array.from(visited);
  }

  /**
   * Detect cycles in the dependency graph
   * Returns array of cycle paths, where each cycle is an array of node IDs
   */
  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const detectCycleFromNode = (
      node: string,
      path: string[]
    ): void => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      for (const neighbor of this.graph.outNeighbors(node)) {
        if (!visited.has(neighbor)) {
          detectCycleFromNode(neighbor, [...path]);
        } else if (recursionStack.has(neighbor)) {
          // Cycle detected - find where the cycle starts
          const cycleStart = path.indexOf(neighbor);
          cycles.push([...path.slice(cycleStart), neighbor]);
        }
      }

      recursionStack.delete(node);
    };

    for (const node of this.graph.nodes()) {
      if (!visited.has(node)) {
        detectCycleFromNode(node, []);
      }
    }

    return cycles;
  }

  /**
   * Get metrics about the dependency graph
   */
  getMetrics(): {
    nodeCount: number;
    edgeCount: number;
    cycleCount: number;
    connectedComponents: number;
  } {
    const cycles = this.detectCycles();

    return {
      nodeCount: this.graph.order,
      edgeCount: this.graph.size,
      cycleCount: cycles.length,
      connectedComponents: this.countConnectedComponents(),
    };
  }

  /**
   * Count the number of weakly connected components
   */
  private countConnectedComponents(): number {
    const visited = new Set<string>();
    let componentCount = 0;

    const visitComponent = (startNode: string): void => {
      const stack = [startNode];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (visited.has(node)) continue;

        visited.add(node);

        // Add all neighbors (both in and out)
        const outgoing = this.graph.outNeighbors(node);
        const incoming = this.graph.inNeighbors(node);
        const neighbors = [...new Set([...outgoing, ...incoming])];

        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            stack.push(neighbor as string);
          }
        }
      }
    };

    for (const node of this.graph.nodes()) {
      if (!visited.has(node)) {
        visitComponent(node as string);
        componentCount++;
      }
    }

    return componentCount;
  }

  /**
   * Find elements with no dependencies (sources in the graph)
   */
  findSourceElements(): string[] {
    const sources: string[] = [];
    for (const node of this.graph.nodes()) {
      if (this.graph.inDegree(node) === 0) {
        sources.push(node as string);
      }
    }
    return sources;
  }

  /**
   * Find elements with no dependents (sinks in the graph)
   */
  findSinkElements(): string[] {
    const sinks: string[] = [];
    for (const node of this.graph.nodes()) {
      if (this.graph.outDegree(node) === 0) {
        sinks.push(node as string);
      }
    }
    return sinks;
  }

  /**
   * Get the impact radius of an element (how many elements are affected if this changes)
   */
  getImpactRadius(elementId: string): number {
    return this.getTransitiveDependents(elementId).length;
  }

  /**
   * Get the dependency depth (longest path to a source)
   */
  getDependencyDepth(elementId: string): number {
    if (!this.graph.hasNode(elementId)) {
      return -1;
    }

    const depths = new Map<string, number>();

    const calculateDepth = (node: string): number => {
      if (depths.has(node)) {
        return depths.get(node)!;
      }

      const outgoing = this.graph.outNeighbors(node);
      if (outgoing.length === 0) {
        depths.set(node, 0);
        return 0;
      }

      let maxDepth = 0;
      for (const neighbor of outgoing) {
        const neighborDepth = calculateDepth(neighbor);
        maxDepth = Math.max(maxDepth, neighborDepth + 1);
      }

      depths.set(node, maxDepth);
      return maxDepth;
    };

    return calculateDepth(elementId);
  }
}
