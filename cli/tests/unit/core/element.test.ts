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

  it("should throw error when creating element without id", () => {
    expect(() => {
      new Element({
        spec_node_id: "motivation.goal",
        type: "goal",
        name: "Test Goal",
        layer_id: "motivation",
      });
    }).toThrow(
      "Element must have an 'id' field. Missing ID prevents proper element tracking and causes silent data loss."
    );
  });

  describe("Constructor behavior", () => {
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
