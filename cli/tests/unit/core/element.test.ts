import { describe, it, expect } from "bun:test";
import { Element } from "@/core/element";

describe("Element", () => {
  it("should create an element with required fields", () => {
    const element = new Element({
      id: "motivation-goal-test-goal",
      spec_node_id: "motivation.goal",
      type: "goal",
      name: "Test Goal",
      layer_id: "motivation",
    });

    expect(element.id).toBe("motivation-goal-test-goal");
    expect(element.spec_node_id).toBe("motivation.goal");
    expect(element.type).toBe("goal");
    expect(element.name).toBe("Test Goal");
    expect(element.layer_id).toBe("motivation");
    expect(element.description).toBeUndefined();
  });

  it("should serialize to JSON with optional fields omitted", () => {
    const element = new Element({
      id: "motivation-goal-test-goal",
      spec_node_id: "motivation.goal",
      type: "goal",
      name: "Test Goal",
      layer_id: "motivation",
    });

    const json = element.toJSON();

    expect(json.id).toBe("motivation-goal-test-goal");
    expect(json.spec_node_id).toBe("motivation.goal");
    expect(json.type).toBe("goal");
    expect(json.name).toBe("Test Goal");
    expect(json.layer_id).toBe("motivation");
    expect(json.description).toBeUndefined();
    expect(json.attributes).toBeUndefined();
    expect(json.references).toBeUndefined();
    expect(json.relationships).toBeUndefined();
  });

  it("should return correct toString representation", () => {
    const element = new Element({
      id: "motivation-goal-test-goal",
      spec_node_id: "motivation.goal",
      type: "goal",
      name: "Test Goal",
      layer_id: "motivation",
    });

    expect(element.toString()).toBe("Element(motivation-goal-test-goal)");
  });

  it("should throw error when creating element without id or elementId", () => {
    expect(() => {
      new Element({
        spec_node_id: "motivation.goal",
        type: "goal",
        name: "Test Goal",
        layer_id: "motivation",
      });
    }).toThrow(
      "Element must have either 'id' or 'elementId' field. Missing ID prevents proper element tracking and causes silent data loss."
    );
  });

  it("should use elementId as fallback when id is not provided", () => {
    const element = new Element({
      elementId: "motivation.goal.test-goal",
      spec_node_id: "motivation.goal",
      type: "goal",
      name: "Test Goal",
      layer_id: "motivation",
    });

    expect(element.id).toBe("motivation.goal.test-goal");
  });

  describe("Backward compatibility constructor paths", () => {
    it("should use layer_id fallback when layer is not provided (line 70)", () => {
      const element = new Element({
        id: "motivation.goal.test",
        spec_node_id: "motivation.goal",
        type: "goal",
        name: "Test Goal",
        layer_id: "motivation",
      });

      expect(element.layer_id).toBe("motivation");
      expect(element.layer).toBe("motivation");
    });

    it("should prefer layer property over layer_id", () => {
      const element = new Element({
        id: "motivation.goal.test",
        spec_node_id: "motivation.goal",
        type: "goal",
        name: "Test Goal",
        layer: "motivation",
        layer_id: "business",
      });

      // layer_id should be set from input
      expect(element.layer_id).toBe("business");
      // layer should also be set
      expect(element.layer).toBe("motivation");
    });

    it("should migrate properties to attributes (line 76-83)", () => {
      const element = new Element({
        id: "api.endpoint.test",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        name: "Test Endpoint",
        layer_id: "api",
        properties: {
          method: "GET",
          path: "/test",
        },
      });

      expect(element.attributes).toEqual({
        method: "GET",
        path: "/test",
      });
      expect(element.properties).toEqual({
        method: "GET",
        path: "/test",
      });
    });

    it("should prefer attributes over properties", () => {
      const element = new Element({
        id: "api.endpoint.test",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        name: "Test Endpoint",
        layer_id: "api",
        attributes: {
          method: "POST",
          path: "/api/test",
        },
        properties: {
          method: "GET",
          path: "/test",
        },
      });

      expect(element.attributes).toEqual({
        method: "POST",
        path: "/api/test",
      });
    });

    it("should extract source_reference from top level (line 89-90)", () => {
      const sourceRef = {
        file: "src/api.ts",
        symbol: "createEndpoint",
        provenance: "manual",
      };

      const element = new Element({
        id: "api.endpoint.test",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        name: "Test Endpoint",
        layer_id: "api",
        source_reference: sourceRef,
      });

      expect(element.source_reference).toEqual(sourceRef);
      expect(element.getSourceReference()).toEqual(sourceRef);
    });

    it("should extract source_reference from legacy properties.source.reference (line 94-95)", () => {
      const sourceRef = {
        file: "src/api.ts",
        symbol: "createEndpoint",
        provenance: "manual",
      };

      const element = new Element({
        id: "api.endpoint.test",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        name: "Test Endpoint",
        layer_id: "api",
        properties: {
          source: {
            reference: sourceRef,
          },
        },
      });

      expect(element.source_reference).toEqual(sourceRef);
    });

    it("should extract source_reference from legacy properties['x-source-reference'] (line 96-98)", () => {
      const sourceRef = {
        file: "src/api.ts",
        symbol: "endpoint",
        provenance: "generated",
      };

      const element = new Element({
        id: "api.endpoint.test",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        name: "Test Endpoint",
        layer_id: "api",
        properties: {
          "x-source-reference": sourceRef,
        },
      });

      expect(element.source_reference).toEqual(sourceRef);
    });

    it("should prefer top-level source_reference over legacy properties format", () => {
      const topLevelRef = {
        file: "new.ts",
        symbol: "newEndpoint",
        provenance: "manual",
      };

      const legacyRef = {
        file: "old.ts",
        symbol: "oldEndpoint",
        provenance: "generated",
      };

      const element = new Element({
        id: "api.endpoint.test",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        name: "Test Endpoint",
        layer_id: "api",
        source_reference: topLevelRef,
        properties: {
          source: {
            reference: legacyRef,
          },
        },
      });

      expect(element.source_reference).toEqual(topLevelRef);
    });

    it("should handle empty properties and attributes gracefully", () => {
      const element = new Element({
        id: "api.endpoint.test",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        name: "Test Endpoint",
        layer_id: "api",
        properties: {},
        attributes: {},
      });

      expect(element.attributes).toEqual({});
      expect(element.properties).toEqual({});
    });
  });

  describe("Source reference methods", () => {
    it("should get source reference", () => {
      const sourceRef = {
        file: "src/api.ts",
        symbol: "endpoint",
        provenance: "manual",
      };

      const element = new Element({
        id: "api.endpoint.test",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        name: "Test Endpoint",
        layer_id: "api",
        source_reference: sourceRef,
      });

      expect(element.getSourceReference()).toEqual(sourceRef);
    });

    it("should set source reference", () => {
      const element = new Element({
        id: "api.endpoint.test",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        name: "Test Endpoint",
        layer_id: "api",
      });

      const sourceRef = {
        file: "src/api.ts",
        symbol: "endpoint",
        provenance: "manual",
      };

      element.setSourceReference(sourceRef);
      expect(element.getSourceReference()).toEqual(sourceRef);
    });

    it("should remove source reference by setting to undefined", () => {
      const sourceRef = {
        file: "src/api.ts",
        symbol: "endpoint",
        provenance: "manual",
      };

      const element = new Element({
        id: "api.endpoint.test",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        name: "Test Endpoint",
        layer_id: "api",
        source_reference: sourceRef,
      });

      expect(element.getSourceReference()).toEqual(sourceRef);
      element.setSourceReference(undefined);
      expect(element.getSourceReference()).toBeUndefined();
    });

    it("should check if element has source reference", () => {
      const element = new Element({
        id: "api.endpoint.test",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        name: "Test Endpoint",
        layer_id: "api",
      });

      expect(element.hasSourceReference()).toBe(false);

      element.setSourceReference({
        file: "src/api.ts",
        symbol: "endpoint",
        provenance: "manual",
      });

      expect(element.hasSourceReference()).toBe(true);
    });
  });

  describe("Metadata methods", () => {
    it("should get metadata with defensive copy", () => {
      const metadata = {
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
        created_by: "test-user",
        version: 1,
      };

      const element = new Element({
        id: "api.endpoint.test",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        name: "Test Endpoint",
        layer_id: "api",
        metadata,
      });

      const retrieved = element.getMetadata();
      expect(retrieved).toEqual(metadata);

      // Verify it's a copy, not the original
      if (retrieved) {
        retrieved.created_at = "MODIFIED";
        expect(element.metadata?.created_at).toBe("2024-01-01T00:00:00Z");
      }
    });

    it("should return undefined if no metadata", () => {
      const element = new Element({
        id: "api.endpoint.test",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        name: "Test Endpoint",
        layer_id: "api",
      });

      expect(element.getMetadata()).toBeUndefined();
    });
  });
});
