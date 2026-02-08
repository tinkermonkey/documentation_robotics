import { describe, test, expect } from "bun:test";
import { GraphModel, type GraphNode, type GraphEdge } from "../../src/core/graph-model.js";

describe("GraphModel Performance", () => {
  /**
   * Create a test graph with N nodes and M edges
   */
  function createTestGraph(nodeCount: number, edgeCount: number) {
    const graph = new GraphModel();

    // Add nodes across different layers
    const layers = ["motivation", "business", "application", "technology", "api"];
    for (let i = 0; i < nodeCount; i++) {
      const layer = layers[i % layers.length];
      const node: GraphNode = {
        id: `node-${i}`,
        layer,
        type: "element",
        name: `Node ${i}`,
        properties: { index: i },
      };
      graph.addNode(node);
    }

    // Add edges
    for (let i = 0; i < edgeCount; i++) {
      const sourceIdx = Math.floor(Math.random() * nodeCount);
      const destIdx = Math.floor(Math.random() * nodeCount);
      if (sourceIdx !== destIdx) {
        const edge: GraphEdge = {
          id: `edge-${i}`,
          source: `node-${sourceIdx}`,
          destination: `node-${destIdx}`,
          predicate: "references",
          properties: {},
        };
        graph.addEdge(edge);
      }
    }

    return graph;
  }

  test("Node lookup performance - 1000 nodes", () => {
    const graph = createTestGraph(1000, 2000);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const nodeId = `node-${Math.floor(Math.random() * 1000)}`;
      graph.getNode(nodeId);
    }
    const elapsed = performance.now() - start;

    // Should be very fast - < 1ms per lookup on average
    expect(elapsed).toBeLessThan(10);
  });

  test("Layer query performance - 1000 nodes", () => {
    const graph = createTestGraph(1000, 2000);

    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      graph.getNodesByLayer("motivation");
      graph.getNodesByLayer("business");
      graph.getNodesByLayer("application");
    }
    const elapsed = performance.now() - start;

    // Layer queries should use indices - very fast
    expect(elapsed).toBeLessThan(50);
  });

  test("Relationship lookup performance - 2000 edges", () => {
    const graph = createTestGraph(1000, 2000);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const nodeId = `node-${Math.floor(Math.random() * 1000)}`;
      graph.getEdgesFrom(nodeId);
    }
    const elapsed = performance.now() - start;

    // Relationship lookups should use indices - fast
    expect(elapsed).toBeLessThan(50);
  });

  test("Traversal performance - BFS from single node", () => {
    const graph = createTestGraph(500, 1000);

    const start = performance.now();
    graph.traverse("node-0", undefined, 3);
    const elapsed = performance.now() - start;

    // BFS traversal should be reasonable
    expect(elapsed).toBeLessThan(100);
  });

  test("Graph statistics", () => {
    const graph = createTestGraph(100, 200);

    const nodeCount = graph.getNodeCount();
    const edgeCount = graph.getEdgeCount();

    expect(nodeCount).toBe(100);
    expect(edgeCount).toBeLessThanOrEqual(200);
  });

  test("Memory efficiency - 10000 nodes", () => {
    const graph = createTestGraph(10000, 20000);

    // Should not throw or run out of memory
    expect(graph.getNodeCount()).toBe(10000);
    expect(graph.getEdgeCount()).toBeLessThanOrEqual(20000);

    // Queries should still work
    expect(graph.getNode("node-0")).toBeDefined();
    expect(graph.getNodesByLayer("motivation").length).toBeGreaterThan(0);
  });
});
