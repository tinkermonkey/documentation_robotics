/**
 * Dependency Tracker - Python CLI Compatibility Tests
 *
 * Tests TypeScript implementation against Python CLI behavior spec
 * Spec: cli-validation/dependency-tracker-spec.md
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { DependencyTracker, TraceDirection } from "@/core/dependency-tracker";
import { ReferenceRegistry } from "@/core/reference-registry";
import type { Reference } from "@/types/index";

describe("DependencyTracker - Python CLI Compatibility", () => {
  let registry: ReferenceRegistry;
  let tracker: DependencyTracker;

  beforeEach(() => {
    registry = new ReferenceRegistry();
    tracker = new DependencyTracker(registry);
  });

  describe("trace_dependencies() - UP direction", () => {
    it("should trace unlimited depth upward (what element depends on)", () => {
      // Graph: A -> B -> C
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "B", target: "C", type: "realizes" });

      const deps = tracker.traceDependencies("A", TraceDirection.UP);

      expect(deps).toContain("B");
      expect(deps).toContain("C");
      expect(deps).toHaveLength(2);
      expect(deps).not.toContain("A"); // Starting element not included
    });

    it("should trace limited depth upward", () => {
      // Graph: A -> B -> C -> D
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "B", target: "C", type: "realizes" });
      registry.addReference({ source: "C", target: "D", type: "realizes" });

      const deps = tracker.traceDependencies("A", TraceDirection.UP, 1);

      expect(deps).toContain("B");
      expect(deps).not.toContain("C");
      expect(deps).not.toContain("D");
      expect(deps).toHaveLength(1);
    });

    it("should handle depth 2 traversal", () => {
      // Graph: A -> B -> C -> D
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "B", target: "C", type: "realizes" });
      registry.addReference({ source: "C", target: "D", type: "realizes" });

      const deps = tracker.traceDependencies("A", TraceDirection.UP, 2);

      expect(deps).toContain("B");
      expect(deps).toContain("C");
      expect(deps).not.toContain("D");
      expect(deps).toHaveLength(2);
    });

    it("should return empty for element not in graph", () => {
      const deps = tracker.traceDependencies("nonexistent", TraceDirection.UP);
      expect(deps).toEqual([]);
    });

    it("should handle element with no outgoing edges", () => {
      // Graph: A -> B
      registry.addReference({ source: "A", target: "B", type: "realizes" });

      const deps = tracker.traceDependencies("B", TraceDirection.UP);
      expect(deps).toEqual([]);
    });
  });

  describe("trace_dependencies() - DOWN direction", () => {
    it("should trace unlimited depth downward (what depends on element)", () => {
      // Graph: A -> B -> C
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "B", target: "C", type: "realizes" });

      const deps = tracker.traceDependencies("C", TraceDirection.DOWN);

      expect(deps).toContain("A");
      expect(deps).toContain("B");
      expect(deps).toHaveLength(2);
      expect(deps).not.toContain("C");
    });

    it("should trace limited depth downward", () => {
      // Graph: A -> B -> C -> D
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "B", target: "C", type: "realizes" });
      registry.addReference({ source: "C", target: "D", type: "realizes" });

      const deps = tracker.traceDependencies("D", TraceDirection.DOWN, 1);

      expect(deps).toContain("C");
      expect(deps).not.toContain("B");
      expect(deps).not.toContain("A");
      expect(deps).toHaveLength(1);
    });

    it("should handle element with no incoming edges", () => {
      // Graph: A -> B
      registry.addReference({ source: "A", target: "B", type: "realizes" });

      const deps = tracker.traceDependencies("A", TraceDirection.DOWN);
      expect(deps).toEqual([]);
    });
  });

  describe("trace_dependencies() - BOTH direction", () => {
    it("should trace both directions", () => {
      // Graph: A -> B -> C
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "B", target: "C", type: "realizes" });

      const deps = tracker.traceDependencies("B", TraceDirection.BOTH);

      expect(deps).toContain("A"); // DOWN (what depends on B)
      expect(deps).toContain("C"); // UP (what B depends on)
      expect(deps).toHaveLength(2);
      expect(deps).not.toContain("B");
    });

    it("should handle max_depth with both directions", () => {
      // Graph: A -> B -> C -> D
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "B", target: "C", type: "realizes" });
      registry.addReference({ source: "C", target: "D", type: "realizes" });

      const deps = tracker.traceDependencies("C", TraceDirection.BOTH, 1);

      expect(deps).toContain("B"); // DOWN (1 hop)
      expect(deps).toContain("D"); // UP (1 hop)
      expect(deps).not.toContain("A"); // DOWN (2 hops - excluded)
      expect(deps).toHaveLength(2);
    });
  });

  describe("trace_dependencies() - Complex graphs", () => {
    it("should handle diamond pattern", () => {
      // Graph: A -> B -> D
      //        A -> C -> D
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "A", target: "C", type: "realizes" });
      registry.addReference({ source: "B", target: "D", type: "realizes" });
      registry.addReference({ source: "C", target: "D", type: "realizes" });

      const deps = tracker.traceDependencies("A", TraceDirection.UP);

      expect(deps).toContain("B");
      expect(deps).toContain("C");
      expect(deps).toContain("D");
      expect(deps).toHaveLength(3);
    });

    it("should handle multiple branches", () => {
      // Graph: A -> B
      //        A -> C
      //        A -> D
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "A", target: "C", type: "realizes" });
      registry.addReference({ source: "A", target: "D", type: "realizes" });

      const deps = tracker.traceDependencies("A", TraceDirection.UP);

      expect(deps).toContain("B");
      expect(deps).toContain("C");
      expect(deps).toContain("D");
      expect(deps).toHaveLength(3);
    });
  });

  describe("findDependencyPaths()", () => {
    it("should find single path between elements", () => {
      // Graph: A -> B -> C
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "B", target: "C", type: "accesses" });

      const paths = tracker.findDependencyPaths("A", "C");

      expect(paths).toHaveLength(1);
      expect(paths[0].source).toBe("A");
      expect(paths[0].target).toBe("C");
      expect(paths[0].path).toEqual(["A", "B", "C"]);
      expect(paths[0].depth).toBe(2);
      expect(paths[0].relationship_types).toEqual(["realizes", "accesses"]);
    });

    it("should find multiple paths", () => {
      // Graph: A -> B -> D
      //        A -> C -> D
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "A", target: "C", type: "realizes" });
      registry.addReference({ source: "B", target: "D", type: "accesses" });
      registry.addReference({ source: "C", target: "D", type: "accesses" });

      const paths = tracker.findDependencyPaths("A", "D");

      expect(paths).toHaveLength(2);

      const pathArrays = paths.map((p) => p.path);
      expect(pathArrays).toContainEqual(["A", "B", "D"]);
      expect(pathArrays).toContainEqual(["A", "C", "D"]);

      paths.forEach((path) => {
        expect(path.depth).toBe(2);
        expect(path.relationship_types).toHaveLength(2);
      });
    });

    it("should return empty array when no path exists", () => {
      // Graph: A -> B, C -> D (disconnected)
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "C", target: "D", type: "realizes" });

      const paths = tracker.findDependencyPaths("A", "D");
      expect(paths).toEqual([]);
    });

    it("should handle direct connection", () => {
      // Graph: A -> B
      registry.addReference({ source: "A", target: "B", type: "realizes" });

      const paths = tracker.findDependencyPaths("A", "B");

      expect(paths).toHaveLength(1);
      expect(paths[0].path).toEqual(["A", "B"]);
      expect(paths[0].depth).toBe(1);
      expect(paths[0].relationship_types).toEqual(["realizes"]);
    });

    it("should respect max_paths limit", () => {
      // Create graph with many paths
      // A -> B1 -> C, A -> B2 -> C, A -> B3 -> C, etc.
      for (let i = 1; i <= 10; i++) {
        const b = `B${i}`;
        registry.addReference({ source: "A", target: b, type: "realizes" });
        registry.addReference({ source: b, target: "C", type: "realizes" });
      }

      const paths = tracker.findDependencyPaths("A", "C", 5);

      expect(paths.length).toBeLessThanOrEqual(5);
    });

    it("should return empty for non-existent source", () => {
      registry.addReference({ source: "A", target: "B", type: "realizes" });

      const paths = tracker.findDependencyPaths("nonexistent", "B");
      expect(paths).toEqual([]);
    });

    it("should return empty for non-existent target", () => {
      registry.addReference({ source: "A", target: "B", type: "realizes" });

      const paths = tracker.findDependencyPaths("A", "nonexistent");
      expect(paths).toEqual([]);
    });
  });

  describe("getHubElements()", () => {
    it("should find hub elements above threshold", () => {
      // Create hub element with many connections
      for (let i = 1; i <= 15; i++) {
        registry.addReference({ source: "HUB", target: `E${i}`, type: "realizes" });
      }

      // Regular element with few connections
      registry.addReference({ source: "REGULAR", target: "E1", type: "realizes" });

      const hubs = tracker.getHubElements(10);

      expect(hubs.length).toBeGreaterThan(0);

      const hubIds = hubs.map((h) => h[0]);
      expect(hubIds).toContain("HUB");
      expect(hubIds).not.toContain("REGULAR");

      const hubEntry = hubs.find((h) => h[0] === "HUB");
      expect(hubEntry![1]).toBe(15);
    });

    it("should count both incoming and outgoing connections", () => {
      // Element with mixed connections
      registry.addReference({ source: "A", target: "HUB", type: "realizes" });
      registry.addReference({ source: "B", target: "HUB", type: "realizes" });
      registry.addReference({ source: "C", target: "HUB", type: "realizes" });
      registry.addReference({ source: "HUB", target: "D", type: "realizes" });
      registry.addReference({ source: "HUB", target: "E", type: "realizes" });

      const hubs = tracker.getHubElements(3);

      expect(hubs).toHaveLength(1);
      expect(hubs[0][0]).toBe("HUB");
      expect(hubs[0][1]).toBe(5); // 3 in + 2 out
    });

    it("should sort by degree descending", () => {
      // Create elements with different connection counts
      for (let i = 1; i <= 15; i++) {
        registry.addReference({ source: "HUB1", target: `E${i}`, type: "realizes" });
      }
      for (let i = 1; i <= 12; i++) {
        registry.addReference({ source: "HUB2", target: `F${i}`, type: "realizes" });
      }
      for (let i = 1; i <= 10; i++) {
        registry.addReference({ source: "HUB3", target: `G${i}`, type: "realizes" });
      }

      const hubs = tracker.getHubElements(10);

      expect(hubs[0][0]).toBe("HUB1");
      expect(hubs[0][1]).toBe(15);
      expect(hubs[1][0]).toBe("HUB2");
      expect(hubs[1][1]).toBe(12);
      expect(hubs[2][0]).toBe("HUB3");
      expect(hubs[2][1]).toBe(10);
    });

    it("should return empty array when no hubs found", () => {
      registry.addReference({ source: "A", target: "B", type: "realizes" });

      const hubs = tracker.getHubElements(10);
      expect(hubs).toEqual([]);
    });

    it("should respect custom threshold", () => {
      for (let i = 1; i <= 5; i++) {
        registry.addReference({ source: "A", target: `E${i}`, type: "realizes" });
      }

      const hubs = tracker.getHubElements(3);

      expect(hubs).toHaveLength(1);
      expect(hubs[0][0]).toBe("A");
      expect(hubs[0][1]).toBe(5);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty graph", () => {
      const deps = tracker.traceDependencies("A", TraceDirection.BOTH);
      expect(deps).toEqual([]);

      const paths = tracker.findDependencyPaths("A", "B");
      expect(paths).toEqual([]);

      const hubs = tracker.getHubElements();
      expect(hubs).toEqual([]);
    });

    it("should handle self-loops", () => {
      registry.addReference({ source: "A", target: "A", type: "realizes" });

      const deps = tracker.traceDependencies("A", TraceDirection.UP);
      // Should include A since it's reachable via self-loop
      expect(deps).toContain("A");
    });

    it("should handle max_depth of 0", () => {
      registry.addReference({ source: "A", target: "B", type: "realizes" });

      const deps = tracker.traceDependencies("A", TraceDirection.UP, 0);
      expect(deps).toEqual([]);
    });

    it("should handle circular dependencies", () => {
      // Graph: A -> B -> C -> A (cycle)
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "B", target: "C", type: "realizes" });
      registry.addReference({ source: "C", target: "A", type: "realizes" });

      const deps = tracker.traceDependencies("A", TraceDirection.UP);

      // Should include all nodes in cycle
      expect(deps).toContain("A");
      expect(deps).toContain("B");
      expect(deps).toContain("C");
    });
  });

  describe("Performance", () => {
    it("should handle large graphs efficiently", () => {
      // Create a large graph with 1000 elements
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        registry.addReference({
          source: `element${i}`,
          target: `element${i + 1}`,
          type: "realizes",
        });
      }

      const createTime = Date.now() - start;
      expect(createTime).toBeLessThan(1000);

      // Test traversal
      const traceStart = Date.now();
      const deps = tracker.traceDependencies("element0", TraceDirection.UP);
      const traceTime = Date.now() - traceStart;

      expect(deps).toHaveLength(1000);
      expect(traceTime).toBeLessThan(100); // Should be fast
    });
  });
});
