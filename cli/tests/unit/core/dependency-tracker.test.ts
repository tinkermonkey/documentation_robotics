import { describe, it, expect, beforeEach } from "bun:test";
import Graph from "graphology";
import { DependencyTracker } from "@/core/dependency-tracker";

describe("DependencyTracker", () => {
  let graph: Graph;
  let tracker: DependencyTracker;

  beforeEach(() => {
    graph = new Graph({ type: "directed" });
    tracker = new DependencyTracker(graph);
  });

  describe("getDependents", () => {
    it("should return direct dependents", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addEdge("a", "b");
      graph.addEdge("c", "b");

      const dependents = tracker.getDependents("b");
      expect(dependents).toContain("a");
      expect(dependents).toContain("c");
      expect(dependents.length).toBe(2);
    });

    it("should return empty array for non-existent node", () => {
      expect(tracker.getDependents("non-existent")).toEqual([]);
    });
  });

  describe("getDependencies", () => {
    it("should return empty array for node with no dependencies", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addEdge("a", "b");

      expect(tracker.getDependencies("b")).toEqual([]);
    });

    it("should return direct dependencies", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addEdge("a", "b");
      graph.addEdge("a", "c");

      const dependencies = tracker.getDependencies("a");
      expect(dependencies).toContain("b");
      expect(dependencies).toContain("c");
      expect(dependencies.length).toBe(2);
    });

    it("should return empty array for non-existent node", () => {
      expect(tracker.getDependencies("non-existent")).toEqual([]);
    });
  });

  describe("getTransitiveDependents", () => {
    it("should return all elements that transitively depend on a node", () => {
      // Build a simple dependency chain: a → b → c
      // So c has transitive dependents [a, b]
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addEdge("a", "b");
      graph.addEdge("b", "c");

      const transitiveDependents = tracker.getTransitiveDependents("c");
      expect(transitiveDependents).toContain("a");
      expect(transitiveDependents).toContain("b");
      expect(transitiveDependents.length).toBe(2);
    });

    it("should not include the source element itself", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addEdge("a", "b");

      const transitiveDependents = tracker.getTransitiveDependents("a");
      expect(transitiveDependents).not.toContain("a");
    });

    it("should handle complex dependency graphs", () => {
      // Build: a → c, b → c, c → d
      // So d has transitive dependents [a, b, c]
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addNode("d");
      graph.addEdge("a", "c");
      graph.addEdge("b", "c");
      graph.addEdge("c", "d");

      const transitiveDependents = tracker.getTransitiveDependents("d");
      expect(transitiveDependents).toContain("a");
      expect(transitiveDependents).toContain("b");
      expect(transitiveDependents).toContain("c");
      expect(transitiveDependents.length).toBe(3);
    });
  });

  describe("getTransitiveDependencies", () => {
    it("should return all elements a node transitively depends on", () => {
      // Build: a → b → c
      // So a transitively depends on [b, c]
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addEdge("a", "b");
      graph.addEdge("b", "c");

      const transitiveDeps = tracker.getTransitiveDependencies("a");
      expect(transitiveDeps).toContain("b");
      expect(transitiveDeps).toContain("c");
      expect(transitiveDeps.length).toBe(2);
    });

    it("should not include the source element itself", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addEdge("a", "b");

      const transitiveDeps = tracker.getTransitiveDependencies("a");
      expect(transitiveDeps).not.toContain("a");
    });

    it("should handle complex dependency graphs", () => {
      // Build: a → b, a → c, b → d
      // So a transitively depends on [b, c, d]
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addNode("d");
      graph.addEdge("a", "b");
      graph.addEdge("a", "c");
      graph.addEdge("b", "d");

      const transitiveDeps = tracker.getTransitiveDependencies("a");
      expect(transitiveDeps).toContain("b");
      expect(transitiveDeps).toContain("c");
      expect(transitiveDeps).toContain("d");
      expect(transitiveDeps.length).toBe(3);
    });

    it("should return empty array for node with no dependencies", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addEdge("b", "a");

      const transitiveDeps = tracker.getTransitiveDependencies("a");
      expect(transitiveDeps.length).toBe(0);
    });
  });

  describe("detectCycles", () => {
    it("should return empty array for acyclic graph", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addEdge("a", "b");
      graph.addEdge("b", "c");

      const cycles = tracker.detectCycles();
      expect(cycles.length).toBe(0);
    });

    it("should detect simple cycle", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addEdge("a", "b");
      graph.addEdge("b", "a");

      const cycles = tracker.detectCycles();
      expect(cycles.length).toBeGreaterThan(0);
    });

    it("should detect self-loop", () => {
      graph.addNode("a");
      graph.addEdge("a", "a");

      const cycles = tracker.detectCycles();
      expect(cycles.length).toBeGreaterThan(0);
    });

    it("should detect multiple cycles", () => {
      // Create two separate cycles: a ↔ b and c ↔ d
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addNode("d");
      graph.addEdge("a", "b");
      graph.addEdge("b", "a");
      graph.addEdge("c", "d");
      graph.addEdge("d", "c");

      const cycles = tracker.detectCycles();
      expect(cycles.length).toBeGreaterThanOrEqual(2);
    });

    it("should detect cycle in larger graph", () => {
      // a → b → c → d → b (cycle: b → c → d → b)
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addNode("d");
      graph.addEdge("a", "b");
      graph.addEdge("b", "c");
      graph.addEdge("c", "d");
      graph.addEdge("d", "b");

      const cycles = tracker.detectCycles();
      expect(cycles.length).toBeGreaterThan(0);
      const hasCycle = cycles.some(
        (cycle) => cycle.includes("b") && cycle.includes("c") && cycle.includes("d")
      );
      expect(hasCycle).toBe(true);
    });
  });

  describe("getMetrics", () => {
    it("should return correct metrics for empty graph", () => {
      const metrics = tracker.getMetrics();
      expect(metrics.nodeCount).toBe(0);
      expect(metrics.edgeCount).toBe(0);
      expect(metrics.cycleCount).toBe(0);
    });

    it("should return correct metrics for simple graph", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addEdge("a", "b");
      graph.addEdge("b", "c");

      const metrics = tracker.getMetrics();
      expect(metrics.nodeCount).toBe(3);
      expect(metrics.edgeCount).toBe(2);
      expect(metrics.cycleCount).toBe(0);
      expect(metrics.connectedComponents).toBe(1);
    });

    it("should count disconnected components", () => {
      // Create two disconnected components
      graph.addNode("a");
      graph.addNode("b");
      graph.addEdge("a", "b");
      graph.addNode("c");
      graph.addNode("d");
      graph.addEdge("c", "d");

      const metrics = tracker.getMetrics();
      expect(metrics.connectedComponents).toBe(2);
    });
  });

  describe("findSourceElements", () => {
    it("should find elements with no incoming edges", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addEdge("a", "b");
      graph.addEdge("a", "c");

      const sources = tracker.findSourceElements();
      expect(sources).toContain("a");
      expect(sources.length).toBe(1);
    });

    it("should return all nodes if no edges", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");

      const sources = tracker.findSourceElements();
      expect(sources.length).toBe(3);
    });

    it("should return empty array for fully connected cycle", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addEdge("a", "b");
      graph.addEdge("b", "a");

      const sources = tracker.findSourceElements();
      expect(sources.length).toBe(0);
    });
  });

  describe("findSinkElements", () => {
    it("should find elements with no outgoing edges", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addEdge("a", "b");
      graph.addEdge("a", "c");

      const sinks = tracker.findSinkElements();
      expect(sinks).toContain("b");
      expect(sinks).toContain("c");
      expect(sinks.length).toBe(2);
    });

    it("should return all nodes if no edges", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");

      const sinks = tracker.findSinkElements();
      expect(sinks.length).toBe(3);
    });
  });

  describe("getImpactRadius", () => {
    it("should calculate impact radius correctly", () => {
      // a ← b ← c, a ← d
      // Impact radius of a = 3 (b, c, d depend on a)
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addNode("d");
      graph.addEdge("b", "a");
      graph.addEdge("c", "b");
      graph.addEdge("d", "a");

      const impactRadius = tracker.getImpactRadius("a");
      expect(impactRadius).toBe(3);
    });
  });

  describe("getDependencyDepth", () => {
    it("should calculate depth correctly for linear chain", () => {
      // a → b → c → d
      // depth(a) = 3, depth(d) = 0
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addNode("d");
      graph.addEdge("a", "b");
      graph.addEdge("b", "c");
      graph.addEdge("c", "d");

      expect(tracker.getDependencyDepth("a")).toBe(3);
      expect(tracker.getDependencyDepth("d")).toBe(0);
    });

    it("should calculate depth for branching dependencies", () => {
      // a → b, a → c, b → d
      // depth(a) = 2 (longest path a → b → d)
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addNode("d");
      graph.addEdge("a", "b");
      graph.addEdge("a", "c");
      graph.addEdge("b", "d");

      expect(tracker.getDependencyDepth("a")).toBe(2);
      expect(tracker.getDependencyDepth("c")).toBe(0);
    });

    it("should return -1 for non-existent node", () => {
      expect(tracker.getDependencyDepth("non-existent")).toBe(-1);
    });

    it("should return 0 for leaf node", () => {
      graph.addNode("a");
      graph.addNode("b");
      graph.addEdge("a", "b");

      expect(tracker.getDependencyDepth("b")).toBe(0);
    });

    it("should handle cycles correctly without infinite recursion", () => {
      // a → b → c → a (cycle)
      graph.addNode("a");
      graph.addNode("b");
      graph.addNode("c");
      graph.addEdge("a", "b");
      graph.addEdge("b", "c");
      graph.addEdge("c", "a");

      // Should not cause infinite recursion
      // When a cycle is detected, the calculation breaks and returns the depth before the cycle
      const depthA = tracker.getDependencyDepth("a");
      expect(typeof depthA).toBe("number");
      expect(depthA).toBeGreaterThanOrEqual(0);
    });
  });
});
