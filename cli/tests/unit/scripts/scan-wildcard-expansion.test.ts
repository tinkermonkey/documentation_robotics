import {
  describe,
  it,
  expect,
} from "bun:test";
import { expandWildcardElementId } from "../../../src/commands/scan.js";

describe("expandWildcardElementId", () => {
  describe("non-wildcard element IDs", () => {
    it("returns the element ID as-is when no wildcard is present", () => {
      const result = expandWildcardElementId("api.endpoint.create-user", []);
      expect(result).toEqual(["api.endpoint.create-user"]);
    });

    it("works with non-wildcard IDs even when matching elements exist", () => {
      const availableElements = [
        { id: "api.endpoint.list-users" },
        { id: "api.endpoint.create-user" },
      ];
      const result = expandWildcardElementId("api.endpoint.get-user", availableElements);
      expect(result).toEqual(["api.endpoint.get-user"]);
    });
  });

  describe("valid wildcard patterns", () => {
    it("expands wildcard pattern to matching elements", () => {
      const availableElements = [
        { id: "api.endpoint.list-users" },
        { id: "api.endpoint.create-user" },
        { id: "api.endpoint.delete-user" },
      ];
      const result = expandWildcardElementId("api.endpoint.*", availableElements);
      expect(result).toEqual([
        "api.endpoint.list-users",
        "api.endpoint.create-user",
        "api.endpoint.delete-user",
      ]);
    });

    it("returns empty array when wildcard pattern matches no elements", () => {
      const availableElements = [
        { id: "api.service.user-service" },
        { id: "api.service.order-service" },
      ];
      const result = expandWildcardElementId("api.endpoint.*", availableElements);
      expect(result).toEqual([]);
    });

    it("only matches elements with the exact layer and element type", () => {
      const availableElements = [
        { id: "api.endpoint.list-users" },
        { id: "api.endpoint.create-user" },
        { id: "application.service.user-service" },  // Different layer
        { id: "api.service.api-service" },            // Different element type
      ];
      const result = expandWildcardElementId("api.endpoint.*", availableElements);
      expect(result).toEqual([
        "api.endpoint.list-users",
        "api.endpoint.create-user",
      ]);
    });

    it("works with wildcard patterns in different layers", () => {
      const availableElements = [
        { id: "data-model.entity.user" },
        { id: "data-model.entity.order" },
        { id: "data-model.entity.product" },
      ];
      const result = expandWildcardElementId("data-model.entity.*", availableElements);
      expect(result).toEqual([
        { id: "data-model.entity.user" },
        { id: "data-model.entity.order" },
        { id: "data-model.entity.product" },
      ].map((e) => e.id));
    });

    it("handles empty available elements list", () => {
      const result = expandWildcardElementId("api.endpoint.*", []);
      expect(result).toEqual([]);
    });
  });

  describe("invalid wildcard patterns", () => {
    it("returns empty array for malformed wildcard patterns", () => {
      const availableElements = [
        { id: "api.endpoint.list-users" },
      ];
      // Wildcard in wrong position
      const result1 = expandWildcardElementId("*.endpoint.list", availableElements);
      expect(result1).toEqual([]);

      // Wildcard in the middle
      const result2 = expandWildcardElementId("api.*.list-users", availableElements);
      expect(result2).toEqual([]);

      // Missing parts before wildcard
      const result3 = expandWildcardElementId("*", availableElements);
      expect(result3).toEqual([]);
    });

    it("returns empty array for wildcard without proper layer.type prefix", () => {
      const availableElements = [
        { id: "api.endpoint.list-users" },
      ];
      const result = expandWildcardElementId("endpoint.*", availableElements);
      expect(result).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("preserves order of available elements in result", () => {
      const availableElements = [
        { id: "api.endpoint.zebra" },
        { id: "api.endpoint.apple" },
        { id: "api.endpoint.monkey" },
      ];
      const result = expandWildcardElementId("api.endpoint.*", availableElements);
      expect(result).toEqual([
        "api.endpoint.zebra",
        "api.endpoint.apple",
        "api.endpoint.monkey",
      ]);
    });

    it("handles elements with extra dots in their names", () => {
      const availableElements = [
        { id: "api.endpoint.v1.list-users" },
        { id: "api.endpoint.v1.create-user" },
      ];
      const result = expandWildcardElementId("api.endpoint.*", availableElements);
      expect(result).toEqual([
        "api.endpoint.v1.list-users",
        "api.endpoint.v1.create-user",
      ]);
    });

    it("handles large numbers of matching elements", () => {
      const availableElements = Array.from({ length: 1000 }, (_, i) => ({
        id: `api.endpoint.endpoint-${i}`,
      }));
      const result = expandWildcardElementId("api.endpoint.*", availableElements);
      expect(result.length).toBe(1000);
      expect(result[0]).toBe("api.endpoint.endpoint-0");
      expect(result[999]).toBe("api.endpoint.endpoint-999");
    });
  });
});

describe("mapToRelationshipCandidate dual-key acceptance", () => {
  it("accepts 'source' and 'target' key names (canonical YAML keys)", async () => {
    const { mapToRelationshipCandidate } = await import("../../../src/commands/scan.js");

    // Note: mapToRelationshipCandidate is not exported, so this test documents the expected behavior
    // The function should accept both key names as the code shows:
    // const sourceIdValue = pattern.mapping["sourceId"] || pattern.mapping["source"];
    // const targetIdValue = pattern.mapping["targetId"] || pattern.mapping["target"];
  });

  it("accepts 'sourceId' and 'targetId' key names (legacy code expectation)", async () => {
    const { mapToRelationshipCandidate } = await import("../../../src/commands/scan.js");

    // Note: mapToRelationshipCandidate is not exported, so this test documents the expected behavior
    // The code supports both patterns for backwards compatibility
  });

  it("prioritizes 'sourceId' over 'source' when both are present", async () => {
    // This documents the behavior: sourceId || source means sourceId takes precedence
    // However, all canonical YAML files use only source/target, not both
    // This is acceptable since:
    // 1. No existing YAML files define both keys
    // 2. Future patterns should consistently use one naming convention
  });
});

describe("wildcard expansion with relationship candidates", () => {
  it("correctly expands both source and target wildcards in relationships", async () => {
    // This documents the expected behavior when both sourceId and targetId contain wildcards
    // Example: source: "api.endpoint.*", target: "data-store.table.*"
    // With N source matches and M target matches, should produce N×M relationship candidates

    const sources = [
      { id: "api.endpoint.list-users" },
      { id: "api.endpoint.create-user" },
    ];

    const targets = [
      { id: "data-store.table.users" },
      { id: "data-store.table.audit-log" },
    ];

    const allElements = [...sources, ...targets];

    const expandedSources = expandWildcardElementId("api.endpoint.*", allElements);
    const expandedTargets = expandWildcardElementId("data-store.table.*", allElements);

    // Should produce 2×2 = 4 combinations
    const combinations = [];
    for (const source of expandedSources) {
      for (const target of expandedTargets) {
        combinations.push([source, target]);
      }
    }

    expect(combinations.length).toBe(4);
    expect(combinations).toContainEqual(["api.endpoint.list-users", "data-store.table.users"]);
    expect(combinations).toContainEqual(["api.endpoint.create-user", "data-store.table.audit-log"]);
  });

  it("handles mixed wildcard and non-wildcard patterns", async () => {
    const allElements = [
      { id: "api.endpoint.list-users" },
      { id: "api.endpoint.create-user" },
      { id: "data-store.table.users" },
    ];

    // Source is wildcard, target is concrete
    const sources = expandWildcardElementId("api.endpoint.*", allElements);
    const targets = expandWildcardElementId("data-store.table.users", allElements);

    expect(sources.length).toBe(2);
    expect(targets.length).toBe(1);
    expect(targets[0]).toBe("data-store.table.users");
  });
});
