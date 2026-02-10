/**
 * Reference Registry - Python CLI Compatibility Tests
 *
 * Tests TypeScript implementation against Python CLI behavior spec
 * Spec: cli-validation/reference-registry-spec.md
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ReferenceRegistry } from "@/core/reference-registry";
import { Element } from "@/core/element";
import type { Reference } from "@/types/index";

describe("ReferenceRegistry - Python CLI Compatibility", () => {
  let registry: ReferenceRegistry;

  beforeEach(() => {
    registry = new ReferenceRegistry();
  });

  describe("registerElement() - Core Functionality", () => {
    it("should extract single string reference from known property", () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "business.service",
        type: "service",
        layer_id: "business",
        name: "Customer Service",
        properties: {
          realizes: "motivation.goal.crm",
        },
      });

      registry.registerElement(element);

      const refs = registry.getReferencesFrom("550e8400-e29b-41d4-a716-446655440000");
      expect(refs).toHaveLength(1);
      expect(refs[0].source).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(refs[0].target).toBe("motivation.goal.crm");
      expect(refs[0].type).toBe("realizes");
    });

    it("should extract array of references from known property", () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440001",
        spec_node_id: "application.service",
        type: "service",
        layer_id: "application",
        name: "User Service",
        properties: {
          accesses: ["data.entity.user", "data.entity.role"],
        },
      });

      registry.registerElement(element);

      const refs = registry.getReferencesFrom("550e8400-e29b-41d4-a716-446655440001");
      expect(refs).toHaveLength(2);

      const targets = refs.map((r) => r.target).sort();
      expect(targets).toEqual(["data.entity.role", "data.entity.user"]);

      refs.forEach((ref) => {
        expect(ref.source).toBe("550e8400-e29b-41d4-a716-446655440001");
        expect(ref.type).toBe("accesses");
      });
    });

    it("should handle element with no references", () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440002",
        spec_node_id: "business.element",
        type: "element",
        layer_id: "business",
        name: "Test",
        properties: {
          someProperty: "value",
        },
      });

      registry.registerElement(element);

      const refs = registry.getReferencesFrom("550e8400-e29b-41d4-a716-446655440002");
      expect(refs).toHaveLength(0);
    });

    it("should handle element with references property array", () => {
      const elementId = "550e8400-e29b-41d4-a716-446655440003";
      const element = new Element({
        id: elementId,
        spec_node_id: "business.element",
        type: "element",
        layer_id: "business",
        name: "Test",
        references: [
          { source: elementId, target: "target1", type: "custom" },
          { source: elementId, target: "target2", type: "custom" },
        ],
      });

      registry.registerElement(element);

      const refs = registry.getReferencesFrom(elementId);
      expect(refs).toHaveLength(2);
    });
  });

  describe("registerElement() - All Known Reference Properties", () => {
    const KNOWN_REF_PROPERTIES = [
      "realizes",
      "realizedBy",
      "serves",
      "servedBy",
      "accesses",
      "accessedBy",
      "uses",
      "usedBy",
      "composedOf",
      "partOf",
      "flows",
      "triggers",
      "archimateRef",
      "businessActorRef",
      "stakeholderRef",
      "motivationGoalRef",
      "dataObjectRef",
      "apiOperationRef",
      "applicationServiceRef",
      "schemaRef",
    ];

    KNOWN_REF_PROPERTIES.forEach((propName) => {
      it(`should recognize '${propName}' as reference property`, () => {
        const elementId = `550e8400-e29b-41d4-a716-44665544000${Math.floor(Math.random() * 10)}`;
        const element = new Element({
          id: elementId,
          spec_node_id: "business.element",
          type: "element",
          layer_id: "business",
          name: "Test",
          properties: {
            [propName]: "target.element",
          },
        });

        registry.registerElement(element);

        const refs = registry.getReferencesFrom(elementId);
        expect(refs.length).toBeGreaterThan(0);
        expect(refs[0].target).toBe("target.element");
      });
    });
  });

  describe("getReferencesFrom()", () => {
    it("should return all outgoing references from element", () => {
      const ref1: Reference = { source: "A", target: "B", type: "realizes" };
      const ref2: Reference = { source: "A", target: "C", type: "accesses" };

      registry.addReference(ref1);
      registry.addReference(ref2);

      const refs = registry.getReferencesFrom("A");
      expect(refs).toHaveLength(2);
      expect(refs).toContainEqual(ref1);
      expect(refs).toContainEqual(ref2);
    });

    it("should return empty array for element with no outgoing references", () => {
      const refs = registry.getReferencesFrom("nonexistent");
      expect(refs).toEqual([]);
    });

    it("should not include incoming references", () => {
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "C", target: "B", type: "realizes" });

      const refs = registry.getReferencesFrom("B");
      expect(refs).toHaveLength(0);
    });
  });

  describe("getReferencesTo()", () => {
    it("should return all incoming references to element", () => {
      const ref1: Reference = { source: "A", target: "C", type: "realizes" };
      const ref2: Reference = { source: "B", target: "C", type: "accesses" };

      registry.addReference(ref1);
      registry.addReference(ref2);

      const refs = registry.getReferencesTo("C");
      expect(refs).toHaveLength(2);
      expect(refs).toContainEqual(ref1);
      expect(refs).toContainEqual(ref2);
    });

    it("should return empty array for element with no incoming references", () => {
      const refs = registry.getReferencesTo("nonexistent");
      expect(refs).toEqual([]);
    });

    it("should not include outgoing references", () => {
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "A", target: "C", type: "realizes" });

      const refs = registry.getReferencesTo("A");
      expect(refs).toHaveLength(0);
    });
  });

  describe("getReferencesByType()", () => {
    it("should return all references of specified type", () => {
      const ref1: Reference = { source: "A", target: "B", type: "realizes" };
      const ref2: Reference = { source: "C", target: "D", type: "realizes" };
      const ref3: Reference = { source: "E", target: "F", type: "accesses" };

      registry.addReference(ref1);
      registry.addReference(ref2);
      registry.addReference(ref3);

      const realizesRefs = registry.getReferencesByType("realizes");
      expect(realizesRefs).toHaveLength(2);
      expect(realizesRefs).toContainEqual(ref1);
      expect(realizesRefs).toContainEqual(ref2);
    });

    it("should return empty array for non-existent type", () => {
      const refs = registry.getReferencesByType("nonexistent");
      expect(refs).toEqual([]);
    });
  });

  describe("hasReference()", () => {
    it("should return true if reference exists", () => {
      registry.addReference({ source: "A", target: "B", type: "realizes" });

      expect(registry.hasReference("A", "B")).toBe(true);
    });

    it("should return false if reference does not exist", () => {
      expect(registry.hasReference("A", "Z")).toBe(false);
    });
  });

  describe("findBrokenReferences()", () => {
    it("should find references to non-existent elements", () => {
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "A", target: "Z", type: "accesses" });
      registry.addReference({ source: "C", target: "D", type: "realizes" });

      const validIds = new Set(["A", "B", "C", "D"]);
      const broken = registry.findBrokenReferences(validIds);

      expect(broken).toHaveLength(1);
      expect(broken[0].target).toBe("Z");
    });

    it("should return empty array when all references are valid", () => {
      registry.addReference({ source: "A", target: "B", type: "realizes" });

      const validIds = new Set(["A", "B"]);
      const broken = registry.findBrokenReferences(validIds);

      expect(broken).toEqual([]);
    });

    it("should not validate source element existence", () => {
      registry.addReference({ source: "Z", target: "B", type: "realizes" });

      const validIds = new Set(["B"]);
      const broken = registry.findBrokenReferences(validIds);

      expect(broken).toEqual([]);
    });
  });

  describe("getAllReferences()", () => {
    it("should return all references", () => {
      const ref1: Reference = { source: "A", target: "B", type: "realizes" };
      const ref2: Reference = { source: "C", target: "D", type: "accesses" };

      registry.addReference(ref1);
      registry.addReference(ref2);

      const all = registry.getAllReferences();
      expect(all).toHaveLength(2);
      expect(all).toContainEqual(ref1);
      expect(all).toContainEqual(ref2);
    });

    it("should return empty array for empty registry", () => {
      const all = registry.getAllReferences();
      expect(all).toEqual([]);
    });
  });

  describe("clear()", () => {
    it("should remove all references", () => {
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "C", target: "D", type: "accesses" });

      registry.clear();

      expect(registry.getAllReferences()).toHaveLength(0);
      expect(registry.getReferencesFrom("A")).toHaveLength(0);
      expect(registry.getReferencesTo("B")).toHaveLength(0);
    });
  });

  describe("getDependencyGraph()", () => {
    it("should build directed graph from references", () => {
      registry.addReference({ source: "A", target: "B", type: "realizes" });
      registry.addReference({ source: "B", target: "C", type: "accesses" });

      const graph = registry.getDependencyGraph();

      expect(graph.hasNode("A")).toBe(true);
      expect(graph.hasNode("B")).toBe(true);
      expect(graph.hasNode("C")).toBe(true);
      expect(graph.hasDirectedEdge("A", "B")).toBe(true);
      expect(graph.hasDirectedEdge("B", "C")).toBe(true);
    });

    it("should include edge attributes", () => {
      registry.addReference({ source: "A", target: "B", type: "realizes" });

      const graph = registry.getDependencyGraph();

      const edgeAttrs = graph.getEdgeAttributes("A", "B");
      expect(edgeAttrs.type).toBe("realizes");
    });

    it("should return empty graph for empty registry", () => {
      const graph = registry.getDependencyGraph();

      expect(graph.order).toBe(0); // number of nodes
      expect(graph.size).toBe(0); // number of edges
    });
  });

  describe("Edge Cases", () => {
    it("should handle duplicate references", () => {
      const ref: Reference = { source: "A", target: "B", type: "realizes" };

      registry.addReference(ref);
      registry.addReference(ref);

      const refs = registry.getReferencesFrom("A");
      expect(refs).toHaveLength(2); // Python doesn't deduplicate
    });

    it("should handle self-references", () => {
      registry.addReference({ source: "A", target: "A", type: "realizes" });

      const outgoing = registry.getReferencesFrom("A");
      const incoming = registry.getReferencesTo("A");

      expect(outgoing).toHaveLength(1);
      expect(incoming).toHaveLength(1);
    });

    it("should handle empty string IDs", () => {
      registry.addReference({ source: "", target: "B", type: "realizes" });

      const refs = registry.getReferencesFrom("");
      expect(refs).toHaveLength(1);
    });
  });

  describe("Performance", () => {
    it("should handle large number of references efficiently", () => {
      const start = Date.now();

      // Add 10,000 references
      for (let i = 0; i < 10000; i++) {
        registry.addReference({
          source: `element${i}`,
          target: `target${i % 100}`,
          type: "realizes",
        });
      }

      const addTime = Date.now() - start;
      expect(addTime).toBeLessThan(1000); // Should complete in < 1 second

      // Lookup should be O(1)
      const lookupStart = Date.now();
      const refs = registry.getReferencesFrom("element5000");
      const lookupTime = Date.now() - lookupStart;

      expect(refs).toHaveLength(1);
      expect(lookupTime).toBeLessThan(10); // Should be nearly instant
    });
  });
});
