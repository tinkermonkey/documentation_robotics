/**
 * Unit tests for ConnectivityAnalyzer
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { ConnectivityAnalyzer } from "../../../src/audit/relationships/graph/connectivity.js";
import { RelationshipGraph } from "../../../src/audit/relationships/graph/relationship-graph.js";
import { RelationshipCatalog } from "../../../src/core/relationship-catalog.js";

describe("ConnectivityAnalyzer", () => {
  let graph: RelationshipGraph;
  let catalog: RelationshipCatalog;
  let analyzer: ConnectivityAnalyzer;

  beforeAll(async () => {
    graph = new RelationshipGraph();
    await graph.build();

    catalog = new RelationshipCatalog();
    await catalog.load();

    analyzer = new ConnectivityAnalyzer(graph, catalog);
  });

  it("should find connected components", () => {
    const components = analyzer.findConnectedComponents();

    expect(components).toBeDefined();
    expect(Array.isArray(components)).toBe(true);
    expect(components.length).toBeGreaterThan(0);

    // Components should be sorted by size (largest first)
    for (let i = 1; i < components.length; i++) {
      expect(components[i - 1].nodes.length).toBeGreaterThanOrEqual(
        components[i].nodes.length
      );
    }

    // Each component should have valid properties
    for (const component of components) {
      expect(component).toHaveProperty("nodes");
      expect(component.nodes.length).toBeGreaterThan(0);
    }
  });

  it("should calculate degree distribution", () => {
    const degrees = analyzer.calculateDegreeDistribution();

    expect(degrees).toBeDefined();
    expect(Array.isArray(degrees)).toBe(true);
    expect(degrees.length).toBeGreaterThan(0);

    // Degrees should be sorted by total degree (highest first)
    for (let i = 1; i < degrees.length; i++) {
      expect(degrees[i - 1].totalDegree).toBeGreaterThanOrEqual(
        degrees[i].totalDegree
      );
    }

    // Each degree entry should have valid properties
    for (const degree of degrees) {
      expect(degree).toHaveProperty("nodeType");
      expect(degree).toHaveProperty("inDegree");
      expect(degree).toHaveProperty("outDegree");
      expect(degree).toHaveProperty("totalDegree");

      expect(degree.inDegree).toBeGreaterThanOrEqual(0);
      expect(degree.outDegree).toBeGreaterThanOrEqual(0);
      expect(degree.totalDegree).toBe(degree.inDegree + degree.outDegree);
    }
  });

  it("should find isolated nodes", () => {
    const isolated = analyzer.findIsolatedNodes();

    expect(isolated).toBeDefined();
    expect(Array.isArray(isolated)).toBe(true);

    // All isolated nodes should have zero degree
    const degrees = analyzer.calculateDegreeDistribution();
    const degreeMap = new Map(degrees.map((d) => [d.nodeType, d.totalDegree]));

    for (const nodeType of isolated) {
      expect(degreeMap.get(nodeType)).toBe(0);
    }
  });

  it("should identify security layer as isolated", async () => {
    // Build a layer-specific graph for security layer
    const securityGraph = new RelationshipGraph();
    await securityGraph.build("security");

    const securityAnalyzer = new ConnectivityAnalyzer(securityGraph, catalog);
    const isolated = securityAnalyzer.findIsolatedNodes();

    // Security layer has zero relationships, so all nodes should be isolated
    expect(isolated.length).toBe(securityGraph.getNodeCount());
    expect(securityGraph.getNodeCount()).toBeGreaterThan(0);
  });

  it("should find transitive chains", async () => {
    const chains = await analyzer.findTransitiveChains();

    expect(chains).toBeDefined();
    expect(Array.isArray(chains)).toBe(true);

    // Chains should be sorted by length (longest first)
    for (let i = 1; i < chains.length; i++) {
      expect(chains[i - 1].chain.length).toBeGreaterThanOrEqual(chains[i].chain.length);
    }

    // Each chain should have valid properties
    for (const chain of chains) {
      expect(chain).toHaveProperty("predicate");
      expect(chain).toHaveProperty("chain");

      expect(chain.chain.length).toBeGreaterThan(1); // At least 2 nodes

      // Predicate should be transitive
      const predicateType = catalog.getTypeByPredicate(chain.predicate);
      expect(predicateType).toBeDefined();
      expect(predicateType?.semantics.transitivity).toBe(true);
    }
  });

  it("should provide connectivity statistics", () => {
    const stats = analyzer.getConnectivityStats();

    expect(stats).toBeDefined();
    expect(stats).toHaveProperty("nodeCount");
    expect(stats).toHaveProperty("edgeCount");
    expect(stats).toHaveProperty("componentCount");
    expect(stats).toHaveProperty("isolatedNodeCount");
    expect(stats).toHaveProperty("largestComponentSize");
    expect(stats).toHaveProperty("averageDegree");

    // Validate statistics
    expect(stats.nodeCount).toBeGreaterThan(0);
    expect(stats.edgeCount).toBeGreaterThanOrEqual(0);
    expect(stats.componentCount).toBeGreaterThan(0);
    expect(stats.isolatedNodeCount).toBeGreaterThanOrEqual(0);
    expect(stats.largestComponentSize).toBeGreaterThan(0);
    expect(stats.averageDegree).toBeGreaterThanOrEqual(0);

    // Largest component should not be larger than total nodes
    expect(stats.largestComponentSize).toBeLessThanOrEqual(stats.nodeCount);

    // Isolated nodes should not exceed total nodes
    expect(stats.isolatedNodeCount).toBeLessThanOrEqual(stats.nodeCount);
  });

  it("should handle layers with no relationships", async () => {
    const uxGraph = new RelationshipGraph();
    await uxGraph.build("ux");

    const uxAnalyzer = new ConnectivityAnalyzer(uxGraph, catalog);

    const components = uxAnalyzer.findConnectedComponents();
    const isolated = uxAnalyzer.findIsolatedNodes();

    // All nodes should be isolated
    expect(isolated.length).toBe(uxGraph.getNodeCount());

    // Each node should be its own component
    expect(components.length).toBe(uxGraph.getNodeCount());
  });

  it("should calculate correct average degree", () => {
    const stats = analyzer.getConnectivityStats();
    const degrees = analyzer.calculateDegreeDistribution();

    const totalDegree = degrees.reduce((sum, d) => sum + d.totalDegree, 0);
    const expectedAverage = degrees.length > 0 ? totalDegree / degrees.length : 0;

    expect(stats.averageDegree).toBeCloseTo(expectedAverage, 5);
  });
});
