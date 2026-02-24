/**
 * Unit tests for RelationshipGraph
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { RelationshipGraph } from "../../../src/audit/relationships/graph/relationship-graph.js";

describe("RelationshipGraph", () => {
  let graph: RelationshipGraph;

  beforeEach(async () => {
    graph = new RelationshipGraph();
    await graph.build();
  });

  it("should build graph from relationships", async () => {
    expect(graph.getNodeCount()).toBeGreaterThan(0);
    expect(graph.getEdgeCount()).toBeGreaterThan(0);
  });

  it("should get node types", () => {
    const nodeTypes = graph.getNodeTypes();

    expect(nodeTypes).toBeDefined();
    expect(Array.isArray(nodeTypes)).toBe(true);
    expect(nodeTypes.length).toBeGreaterThan(0);

    // Node types should follow format: layer.type
    for (const nodeType of nodeTypes) {
      expect(nodeType).toContain(".");
      const parts = nodeType.split(".");
      expect(parts.length).toBe(2);
    }
  });

  it("should get outgoing relationships", () => {
    const nodeTypes = graph.getNodeTypes();
    expect(nodeTypes.length).toBeGreaterThan(0);

    const firstNodeType = nodeTypes[0];
    const outgoing = graph.getOutgoingRelationships(firstNodeType);

    expect(Array.isArray(outgoing)).toBe(true);

    // Each edge should have required properties
    for (const edge of outgoing) {
      expect(edge).toHaveProperty("id");
      expect(edge).toHaveProperty("source");
      expect(edge).toHaveProperty("destination");
      expect(edge).toHaveProperty("predicate");
      expect(edge.source).toBe(firstNodeType);
    }
  });

  it("should get incoming relationships", () => {
    const nodeTypes = graph.getNodeTypes();

    // Find a node type with incoming relationships
    let nodeWithIncoming: string | null = null;
    for (const nodeType of nodeTypes) {
      const incoming = graph.getIncomingRelationships(nodeType);
      if (incoming.length > 0) {
        nodeWithIncoming = nodeType;
        break;
      }
    }

    if (nodeWithIncoming) {
      const incoming = graph.getIncomingRelationships(nodeWithIncoming);
      expect(incoming.length).toBeGreaterThan(0);

      for (const edge of incoming) {
        expect(edge.destination).toBe(nodeWithIncoming);
      }
    }
  });

  it("should get all relationships for a node", () => {
    const nodeTypes = graph.getNodeTypes();

    // Find a node with relationships
    let nodeWithRelationships: string | null = null;
    for (const nodeType of nodeTypes) {
      const all = graph.getAllRelationships(nodeType);
      if (all.length > 0) {
        nodeWithRelationships = nodeType;
        break;
      }
    }

    if (nodeWithRelationships) {
      const all = graph.getAllRelationships(nodeWithRelationships);
      const outgoing = graph.getOutgoingRelationships(nodeWithRelationships);
      const incoming = graph.getIncomingRelationships(nodeWithRelationships);

      expect(all.length).toBe(outgoing.length + incoming.length);
    }
  });

  it("should find paths between nodes", () => {
    const nodeTypes = graph.getNodeTypes();

    // Find two connected nodes
    let source: string | null = null;
    let destination: string | null = null;

    for (const nodeType of nodeTypes) {
      const outgoing = graph.getOutgoingRelationships(nodeType);
      if (outgoing.length > 0) {
        source = nodeType;
        destination = outgoing[0].destination;
        break;
      }
    }

    if (source && destination) {
      const paths = graph.findPaths(source, destination, 3);
      expect(paths.length).toBeGreaterThan(0);

      // First path should be direct connection
      expect(paths[0]).toContain(source);
      expect(paths[0]).toContain(destination);
    }
  });

  it("should get neighbors", () => {
    const nodeTypes = graph.getNodeTypes();

    // Find a node with neighbors
    let nodeWithNeighbors: string | null = null;
    for (const nodeType of nodeTypes) {
      const neighbors = graph.getNeighbors(nodeType);
      if (neighbors.length > 0) {
        nodeWithNeighbors = nodeType;
        break;
      }
    }

    if (nodeWithNeighbors) {
      const neighbors = graph.getNeighbors(nodeWithNeighbors);
      expect(neighbors.length).toBeGreaterThan(0);

      // Neighbors should be unique
      const uniqueNeighbors = new Set(neighbors);
      expect(uniqueNeighbors.size).toBe(neighbors.length);
    }
  });

  it("should build layer-specific graph", async () => {
    const motivationGraph = new RelationshipGraph();
    await motivationGraph.build("motivation");

    const nodeTypes = motivationGraph.getNodeTypes();

    // All node types should be from motivation layer
    for (const nodeType of nodeTypes) {
      expect(nodeType.startsWith("motivation.")).toBe(true);
    }
  });

  it("should handle zero-relationship layers", async () => {
    const securityGraph = new RelationshipGraph();
    await securityGraph.build("security");

    // Security layer should have node types but no edges
    expect(securityGraph.getNodeCount()).toBeGreaterThan(0);
    expect(securityGraph.getEdgeCount()).toBe(0);
  });

  it("should provide access to underlying graph model", () => {
    const graphModel = graph.getGraphModel();
    expect(graphModel).toBeDefined();
    expect(graphModel.getNodeCount).toBeDefined();
    expect(graphModel.getEdgeCount).toBeDefined();
  });
});
