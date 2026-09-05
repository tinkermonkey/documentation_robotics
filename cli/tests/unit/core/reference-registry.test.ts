import { describe, it, expect, beforeEach } from "bun:test";
import { ReferenceRegistry } from "@/core/reference-registry";
import type { Reference } from "@/types/index";

describe("ReferenceRegistry", () => {
  let registry: ReferenceRegistry;

  beforeEach(() => {
    registry = new ReferenceRegistry();
  });

  describe("addReference", () => {
    it("should add a reference to the registry", () => {
      const ref: Reference = {
        source: "01-motivation-goal-create-customer",
        target: "02-business-process-create-order",
        type: "realizes",
        description: "Goal realized by process",
      };

      registry.addReference(ref);

      expect(registry.getReferencesFrom("01-motivation-goal-create-customer")).toHaveLength(1);
    });

    it("should add multiple references from same source", () => {
      const ref1: Reference = {
        source: "01-motivation-goal-create-customer",
        target: "02-business-process-create-order",
        type: "realizes",
      };

      const ref2: Reference = {
        source: "01-motivation-goal-create-customer",
        target: "02-business-process-validate-order",
        type: "realizes",
      };

      registry.addReference(ref1);
      registry.addReference(ref2);

      expect(registry.getReferencesFrom("01-motivation-goal-create-customer")).toHaveLength(2);
    });
  });

  describe("getReferencesFrom", () => {
    it("should return empty array for unknown source", () => {
      expect(registry.getReferencesFrom("unknown-element")).toEqual([]);
    });

    it("should return all references from a source", () => {
      const ref1: Reference = {
        source: "01-goal-test",
        target: "02-process-test",
        type: "realizes",
      };

      const ref2: Reference = {
        source: "01-goal-test",
        target: "03-security-policy-test",
        type: "requires",
      };

      registry.addReference(ref1);
      registry.addReference(ref2);

      const refs = registry.getReferencesFrom("01-goal-test");
      expect(refs).toHaveLength(2);
      expect(refs[0].target).toBe("02-process-test");
      expect(refs[1].target).toBe("03-security-policy-test");
    });
  });

  describe("getReferencesTo", () => {
    it("should return empty array for unknown target", () => {
      expect(registry.getReferencesTo("unknown-element")).toEqual([]);
    });

    it("should return all references to a target", () => {
      const ref1: Reference = {
        source: "01-goal-test",
        target: "02-process-test",
        type: "realizes",
      };

      const ref2: Reference = {
        source: "04-application-service-test",
        target: "02-process-test",
        type: "implements",
      };

      registry.addReference(ref1);
      registry.addReference(ref2);

      const refs = registry.getReferencesTo("02-process-test");
      expect(refs).toHaveLength(2);
    });
  });

  describe("getReferencesByType", () => {
    it("should return empty array for unknown type", () => {
      expect(registry.getReferencesByType("unknown-type")).toEqual([]);
    });

    it("should return all references of a specific type", () => {
      const ref1: Reference = {
        source: "01-goal-test",
        target: "02-process-test",
        type: "realizes",
      };

      const ref2: Reference = {
        source: "01-goal-test2",
        target: "02-process-test2",
        type: "realizes",
      };

      const ref3: Reference = {
        source: "01-goal-test3",
        target: "03-security-policy-test",
        type: "requires",
      };

      registry.addReference(ref1);
      registry.addReference(ref2);
      registry.addReference(ref3);

      const refs = registry.getReferencesByType("realizes");
      expect(refs).toHaveLength(2);
      expect(refs.every((ref) => ref.type === "realizes")).toBe(true);
    });
  });

  describe("hasReference", () => {
    it("should return false for non-existent reference", () => {
      expect(registry.hasReference("01-goal-test", "02-process-test")).toBe(false);
    });

    it("should return true for existing reference", () => {
      const ref: Reference = {
        source: "01-goal-test",
        target: "02-process-test",
        type: "realizes",
      };

      registry.addReference(ref);

      expect(registry.hasReference("01-goal-test", "02-process-test")).toBe(true);
    });
  });

  describe("getAllReferences", () => {
    it("should return empty array when no references", () => {
      expect(registry.getAllReferences()).toEqual([]);
    });

    it("should return all references", () => {
      const refs = [
        { source: "01-goal-test", target: "02-process-test", type: "realizes" },
        {
          source: "01-goal-test2",
          target: "02-process-test2",
          type: "realizes",
        },
        {
          source: "04-application-service-test",
          target: "06-api-endpoint-test",
          type: "exposes",
        },
      ];

      refs.forEach((ref) => registry.addReference(ref));

      expect(registry.getAllReferences()).toHaveLength(3);
    });
  });

  describe("clear", () => {
    it("should clear all references", () => {
      const ref: Reference = {
        source: "01-goal-test",
        target: "02-process-test",
        type: "realizes",
      };

      registry.addReference(ref);
      expect(registry.getAllReferences()).toHaveLength(1);

      registry.clear();
      expect(registry.getAllReferences()).toHaveLength(0);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", () => {
      const refs = [
        { source: "01-goal-test", target: "02-process-test", type: "realizes" },
        { source: "01-goal-test", target: "02-process-test2", type: "realizes" },
        {
          source: "04-application-service-test",
          target: "06-api-endpoint-test",
          type: "exposes",
        },
      ];

      refs.forEach((ref) => registry.addReference(ref));

      const stats = registry.getStats();
      expect(stats.totalReferences).toBe(3);
      expect(stats.uniqueSources).toBe(2);
      expect(stats.uniqueTargets).toBe(3);
      expect(stats.referenceTypes).toContain("realizes");
      expect(stats.referenceTypes).toContain("exposes");
    });
  });

  describe("registerElement", () => {
    it("should register all references from an element", () => {
      const elem = {
        id: "01-goal-test",
        type: "goal",
        name: "Test Goal",
        references: [
          {
            source: "01-goal-test",
            target: "02-process-test1",
            type: "realizes",
          },
          {
            source: "01-goal-test",
            target: "02-process-test2",
            type: "realizes",
          },
        ],
      };

      registry.registerElement(elem);

      const refs = registry.getReferencesFrom("01-goal-test");
      expect(refs.length).toBe(2);
    });

    it("should handle elements with no references", () => {
      const elem = {
        id: "01-goal-test",
        type: "goal",
        name: "Test Goal",
      };

      registry.registerElement(elem);

      expect(registry.getReferencesFrom("01-goal-test")).toEqual([]);
    });

    // Regression coverage for a bug where attribute NAME alone (a KNOWN_REF_PROPERTIES match,
    // or the *Ref/*Reference naming convention) was treated as sufficient evidence that the
    // attribute's VALUE was a DR element reference — with no check on the value's shape. Real
    // collision: api.link.operationRef is a schema-declared OpenAPI URL fragment
    // ("#/paths/~1users/get"), not an element id, yet matched the "*Ref" convention.
    describe("attribute-name heuristic requires the value to look like an element reference", () => {
      it("registers a *Ref-named attribute whose value looks like a real element id", () => {
        const elem = {
          id: "api.endpoint.get-users",
          type: "endpoint",
          name: "Get Users",
          attributes: {
            applicationServiceRef: "business.service.user-management",
          },
        };

        registry.registerElement(elem);

        const refs = registry.getReferencesFrom("api.endpoint.get-users");
        expect(refs).toHaveLength(1);
        expect(refs[0]).toMatchObject({
          target: "business.service.user-management",
          type: "applicationServiceRef",
        });
      });

      it("does NOT register a *Ref-named attribute whose value is a URL fragment, not an element id", () => {
        // api.link.operationRef's real schema: "A relative or absolute URL reference to an
        // operation" — mutually exclusive with operationId, never a DR element reference.
        const elem = {
          id: "api.link.example",
          type: "link",
          name: "Example Link",
          attributes: {
            operationRef: "#/paths/~1users/get",
          },
        };

        registry.registerElement(elem);

        expect(registry.getReferencesFrom("api.link.example")).toEqual([]);
      });

      it("also gates the top-level KNOWN_REF_PROPERTIES match on value shape", () => {
        const elem = {
          id: "business.process.example",
          type: "process",
          name: "Example",
          attributes: {
            // "uses" is a KNOWN_REF_PROPERTIES entry; a URL-shaped value is not a reference.
            uses: "https://example.com/not-an-element",
          },
        };

        registry.registerElement(elem);

        expect(registry.getReferencesFrom("business.process.example")).toEqual([]);
      });

      it("still registers a UUID-shaped *Ref value", () => {
        const elem = {
          id: "api.endpoint.get-orders",
          type: "endpoint",
          name: "Get Orders",
          attributes: {
            schemaRef: "550e8400-e29b-41d4-a716-446655440000",
          },
        };

        registry.registerElement(elem);

        const refs = registry.getReferencesFrom("api.endpoint.get-orders");
        expect(refs).toHaveLength(1);
        expect(refs[0].target).toBe("550e8400-e29b-41d4-a716-446655440000");
      });
    });
  });

  describe("findBrokenReferences", () => {
    it("should find references to non-existent elements", () => {
      const refs = [
        { source: "01-goal-test", target: "02-process-test", type: "realizes" },
        { source: "01-goal-test", target: "03-nonexistent", type: "requires" },
      ];

      refs.forEach((ref) => registry.addReference(ref));

      const validIds = new Set(["01-goal-test", "02-process-test"]);
      const broken = registry.findBrokenReferences(validIds);

      expect(broken.length).toBe(1);
      expect(broken[0].target).toBe("03-nonexistent");
    });

    it("should return empty array if no broken references", () => {
      const refs = [{ source: "01-goal-test", target: "02-process-test", type: "realizes" }];

      refs.forEach((ref) => registry.addReference(ref));

      const validIds = new Set(["01-goal-test", "02-process-test"]);
      const broken = registry.findBrokenReferences(validIds);

      expect(broken).toEqual([]);
    });
  });

  describe("getDependencyGraph", () => {
    it("should create a directed graph from references", () => {
      const refs = [
        { source: "01-goal-test", target: "02-process-test", type: "realizes" },
        { source: "02-process-test", target: "03-policy-test", type: "requires" },
      ];

      refs.forEach((ref) => registry.addReference(ref));

      const graph = registry.getDependencyGraph();

      expect(graph.order).toBe(3); // 3 nodes
      expect(graph.size).toBe(2); // 2 edges
      expect(graph.hasNode("01-goal-test")).toBe(true);
      expect(graph.hasNode("02-process-test")).toBe(true);
      expect(graph.hasNode("03-policy-test")).toBe(true);
      expect(graph.hasEdge("01-goal-test", "02-process-test")).toBe(true);
      expect(graph.hasEdge("02-process-test", "03-policy-test")).toBe(true);
    });

    it("should return empty graph for no references", () => {
      const graph = registry.getDependencyGraph();

      expect(graph.order).toBe(0);
      expect(graph.size).toBe(0);
    });

    it("should include edge attributes", () => {
      const refs = [
        {
          source: "01-goal-test",
          target: "02-process-test",
          type: "realizes",
          description: "Goal is realized by process",
        },
      ];

      refs.forEach((ref) => registry.addReference(ref));

      const graph = registry.getDependencyGraph();
      const edge = graph.getEdgeAttributes("01-goal-test", "02-process-test");

      expect(edge.type).toBe("realizes");
      expect(edge.description).toBe("Goal is realized by process");
    });
  });
});
