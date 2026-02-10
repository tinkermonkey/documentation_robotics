/**
 * Tests for generated node type index (node-types.ts)
 */

import { describe, it, expect } from "bun:test";
import {
  NODE_TYPES,
  getNodeType,
  getNodeTypesForLayer,
  isValidNodeType,
  getRequiredAttributes,
  isValidSpecNodeId,
  type SpecNodeId,
  type NodeType,
  type LayerId,
  type NodeTypeInfo,
} from "../../src/generated/node-types.js";

describe("Node Type Index", () => {
  describe("NODE_TYPES Map", () => {
    it("should contain all 354 node types", () => {
      expect(NODE_TYPES.size).toBe(354);
    });

    it("should have NodeTypeInfo for each entry", () => {
      for (const [specNodeId, info] of NODE_TYPES) {
        expect(info.specNodeId).toBe(specNodeId);
        expect(info.layer).toBeDefined();
        expect(info.type).toBeDefined();
        expect(info.title).toBeDefined();
        expect(Array.isArray(info.requiredAttributes)).toBe(true);
        expect(Array.isArray(info.optionalAttributes)).toBe(true);
        expect(typeof info.attributeConstraints).toBe("object");
      }
    });

    it("all SpecNodeId keys should be valid", () => {
      for (const specNodeId of NODE_TYPES.keys()) {
        expect(specNodeId).toMatch(/^[a-z-]+\.[a-z-]+$/);
      }
    });
  });

  describe("getNodeType()", () => {
    it("should return NodeTypeInfo for valid SpecNodeId", () => {
      const info = getNodeType("motivation.goal" as SpecNodeId);
      expect(info).toBeDefined();
      expect(info?.specNodeId).toBe("motivation.goal");
      expect(info?.layer).toBe("motivation");
      expect(info?.type).toBe("goal");
    });

    it("should return undefined for invalid SpecNodeId", () => {
      const info = getNodeType("invalid.type" as SpecNodeId);
      expect(info).toBeUndefined();
    });

    it("should have required attributes for goal type", () => {
      const info = getNodeType("motivation.goal" as SpecNodeId);
      expect(info?.requiredAttributes).toContain("priority");
    });
  });

  describe("getNodeTypesForLayer()", () => {
    it("should return array of NodeTypeInfo for valid layer", () => {
      const types = getNodeTypesForLayer("motivation");
      expect(Array.isArray(types)).toBe(true);
      expect(types.length).toBeGreaterThan(0);

      for (const info of types) {
        expect(info.layer).toBe("motivation");
      }
    });

    it("should return empty array for invalid layer", () => {
      const types = getNodeTypesForLayer("invalid-layer");
      expect(Array.isArray(types)).toBe(true);
      expect(types.length).toBe(0);
    });

    it("motivation layer should have specific types", () => {
      const types = getNodeTypesForLayer("motivation");
      const typeNames = types.map((t) => t.type);
      expect(typeNames).toContain("goal");
      expect(typeNames).toContain("requirement");
    });

    it("api layer should have operation type (OpenAPI)", () => {
      const types = getNodeTypesForLayer("api");
      const typeNames = types.map((t) => t.type);
      expect(typeNames).toContain("operation");
    });

    it("data-store layer should have table type", () => {
      const types = getNodeTypesForLayer("data-store");
      const typeNames = types.map((t) => t.type);
      expect(typeNames).toContain("table");
    });
  });

  describe("isValidNodeType()", () => {
    it("should return true for valid layer and type combination", () => {
      expect(isValidNodeType("motivation", "goal")).toBe(true);
      expect(isValidNodeType("api", "operation")).toBe(true);
      expect(isValidNodeType("data-store", "table")).toBe(true);
    });

    it("should return false for invalid layer", () => {
      expect(isValidNodeType("invalid-layer", "goal")).toBe(false);
    });

    it("should return false for invalid type", () => {
      expect(isValidNodeType("motivation", "invalid-type")).toBe(false);
    });

    it("should return false for valid type in wrong layer", () => {
      expect(isValidNodeType("api", "goal")).toBe(false);
      expect(isValidNodeType("motivation", "endpoint")).toBe(false);
    });

    it("should reject goal type in api layer", () => {
      expect(isValidNodeType("api", "goal")).toBe(false);
    });

    it("should reject endpoint type in motivation layer", () => {
      expect(isValidNodeType("motivation", "endpoint")).toBe(false);
    });
  });

  describe("getRequiredAttributes()", () => {
    it("should return required attributes for goal", () => {
      const attrs = getRequiredAttributes("motivation.goal" as SpecNodeId);
      expect(Array.isArray(attrs)).toBe(true);
      expect(attrs).toContain("priority");
    });

    it("should return empty array for unknown spec node id", () => {
      const attrs = getRequiredAttributes("invalid.type" as SpecNodeId);
      expect(Array.isArray(attrs)).toBe(true);
      expect(attrs.length).toBe(0);
    });
  });

  describe("isValidSpecNodeId()", () => {
    it("should accept valid spec node IDs", () => {
      expect(isValidSpecNodeId("motivation.goal")).toBe(true);
      expect(isValidSpecNodeId("api.operation")).toBe(true);
      expect(isValidSpecNodeId("data-store.table")).toBe(true);
    });

    it("should reject invalid spec node IDs", () => {
      expect(isValidSpecNodeId("invalid.id")).toBe(false);
      expect(isValidSpecNodeId("motivation")).toBe(false);
      expect(isValidSpecNodeId("")).toBe(false);
      expect(isValidSpecNodeId(null)).toBe(false);
      expect(isValidSpecNodeId(undefined)).toBe(false);
      expect(isValidSpecNodeId(123)).toBe(false);
    });
  });

  describe("Type coverage", () => {
    it("should have types for all 12 layers", () => {
      const layers = new Set<string>();
      for (const info of NODE_TYPES.values()) {
        layers.add(info.layer);
      }

      const expectedLayers = [
        "motivation",
        "business",
        "security",
        "application",
        "technology",
        "api",
        "data-model",
        "data-store",
        "ux",
        "navigation",
        "apm",
        "testing",
      ];

      for (const layer of expectedLayers) {
        expect(layers.has(layer)).toBe(true);
      }
    });

    it("should not have duplicate spec_node_id entries", () => {
      const ids = new Set<SpecNodeId>();
      const duplicates: SpecNodeId[] = [];

      for (const specNodeId of NODE_TYPES.keys()) {
        if (ids.has(specNodeId)) {
          duplicates.push(specNodeId);
        }
        ids.add(specNodeId);
      }

      expect(duplicates.length).toBe(0);
    });

    it("each node type should have matching layer and spec_node_id", () => {
      for (const info of NODE_TYPES.values()) {
        const [layer, type] = info.specNodeId.split(".");
        expect(layer).toBe(info.layer);
        expect(type).toBe(info.type);
      }
    });
  });

  describe("Attribute metadata", () => {
    it("should extract optional attributes correctly", () => {
      const info = getNodeType("motivation.goal" as SpecNodeId);
      expect(info?.optionalAttributes.length).toBeGreaterThan(0);
    });

    it("required and optional attributes should not overlap", () => {
      for (const info of NODE_TYPES.values()) {
        const requiredSet = new Set(info.requiredAttributes);
        for (const optional of info.optionalAttributes) {
          expect(requiredSet.has(optional)).toBe(false);
        }
      }
    });

    it("should have attribute constraints for most types", () => {
      let withConstraints = 0;
      for (const info of NODE_TYPES.values()) {
        if (Object.keys(info.attributeConstraints).length > 0) {
          withConstraints++;
        }
      }
      // Most types should have at least some attribute constraints
      expect(withConstraints).toBeGreaterThan(100);
    });
  });

  describe("Title extraction", () => {
    it("should extract title from schema", () => {
      const info = getNodeType("motivation.goal" as SpecNodeId);
      expect(info?.title).toBe("Goal");
    });

    it("all types should have a title", () => {
      for (const info of NODE_TYPES.values()) {
        expect(info.title).toBeDefined();
        expect(info.title.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Layer consistency", () => {
    it("data-model layer should have at least 5 types", () => {
      const types = getNodeTypesForLayer("data-model");
      expect(types.length).toBeGreaterThanOrEqual(5);
    });

    it("data-store layer should have at least 10 types", () => {
      const types = getNodeTypesForLayer("data-store");
      expect(types.length).toBeGreaterThanOrEqual(10);
    });

    it("api layer should have more than 15 types", () => {
      const types = getNodeTypesForLayer("api");
      expect(types.length).toBeGreaterThan(15);
    });
  });
});
