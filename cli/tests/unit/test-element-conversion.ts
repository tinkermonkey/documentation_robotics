import { describe, it, expect, beforeEach } from "bun:test";
import { Element } from "../../src/core/element.js";
import type { Element as IElement } from "../../src/types/index.js";

describe("Element Class - Spec-Node Conversion", () => {
  describe("Constructor - Legacy Format Detection", () => {
    it("should detect legacy format with elementId", () => {
      const legacyElement = new Element({
        id: "api.endpoint.create-customer",
        elementId: "api.endpoint.create-customer",
        type: "endpoint",
        name: "Create Customer",
        properties: { method: "POST" },
      });

      expect(legacyElement.spec_node_id).toBe("api.endpoint");
      expect(legacyElement.layer_id).toBe("api");
      expect(legacyElement.type).toBe("endpoint");
      expect(legacyElement.attributes).toEqual({ method: "POST" });
      expect(legacyElement.elementId).toBe("api.endpoint.create-customer");
    });

    it("should detect legacy format with semantic ID in id field", () => {
      const legacyElement = new Element({
        id: "motivation.goal.customer-satisfaction",
        type: "goal",
        name: "Customer Satisfaction",
        properties: { priority: "high" },
      });

      expect(legacyElement.spec_node_id).toBe("motivation.goal");
      expect(legacyElement.layer_id).toBe("motivation");
      expect(legacyElement.type).toBe("goal");
      expect(legacyElement.attributes).toEqual({ priority: "high" });
    });

    it("should generate UUID for legacy format without UUID", () => {
      const legacyElement = new Element({
        id: "api.endpoint.create-customer",
        type: "endpoint",
        name: "Create Customer",
      });

      // Should generate a UUID (UUIDv4 format)
      expect(legacyElement.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(legacyElement.elementId).toBe("api.endpoint.create-customer");
    });

    it("should preserve existing UUID in legacy format", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const legacyElement = new Element({
        id: uuid,
        type: "endpoint",
        layer_id: "api",
        name: "Create Customer",
      });

      expect(legacyElement.id).toBe(uuid);
    });

    it("should initialize from spec-node aligned format", () => {
      const specElement: IElement = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Create Customer",
        description: "Creates a new customer",
        attributes: { method: "POST", status: "active" },
      };

      const element = new Element(specElement);

      expect(element.id).toBe(specElement.id);
      expect(element.spec_node_id).toBe("api.endpoint");
      expect(element.type).toBe("endpoint");
      expect(element.layer_id).toBe("api");
      expect(element.name).toBe("Create Customer");
      expect(element.description).toBe("Creates a new customer");
      expect(element.attributes).toEqual({ method: "POST", status: "active" });
    });
  });

  describe("toSpecNode() - Conversion to Spec Node Format", () => {
    it("should convert Element to spec-node format", () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Create Customer",
        description: "Creates a new customer",
        attributes: { method: "POST" },
      });

      const specNode = element.toSpecNode();

      expect(specNode.id).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(specNode.spec_node_id).toBe("api.endpoint");
      expect(specNode.type).toBe("endpoint");
      expect(specNode.layer_id).toBe("api");
      expect(specNode.name).toBe("Create Customer");
      expect(specNode.description).toBe("Creates a new customer");
      expect(specNode.attributes).toEqual({ method: "POST" });
    });

    it("should exclude empty optional fields from spec-node format", () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Create Customer",
      });

      const specNode = element.toSpecNode();

      expect(specNode.description).toBeUndefined();
      expect(specNode.attributes).toBeUndefined();
      expect(specNode.source_reference).toBeUndefined();
      expect(specNode.metadata).toBeUndefined();
    });

    it("should include metadata when present", () => {
      const metadata = {
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-15T10:30:00Z",
        created_by: "user@example.com",
        version: 2,
      };

      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Create Customer",
        metadata,
      });

      const specNode = element.toSpecNode();

      expect(specNode.metadata).toEqual(metadata);
    });
  });

  describe("fromSpecNode() - Static Factory Method", () => {
    it("should create Element from spec-node format", () => {
      const specNodeData = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "motivation.goal",
        type: "goal",
        layer_id: "motivation",
        name: "Improve Customer Satisfaction",
        description: "A key business goal",
        attributes: { priority: "high", status: "active" },
      };

      const element = Element.fromSpecNode(specNodeData);

      expect(element.id).toBe(specNodeData.id);
      expect(element.spec_node_id).toBe(specNodeData.spec_node_id);
      expect(element.type).toBe(specNodeData.type);
      expect(element.layer_id).toBe(specNodeData.layer_id);
      expect(element.name).toBe(specNodeData.name);
      expect(element.description).toBe(specNodeData.description);
      expect(element.attributes).toEqual(specNodeData.attributes);
    });
  });

  describe("Round-trip Serialization", () => {
    it("should preserve data through spec-node conversion cycle", () => {
      const original: IElement = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Create Customer",
        description: "Creates a customer",
        attributes: { method: "POST", path: "/customers" },
        metadata: {
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-15T10:30:00Z",
          version: 1,
        },
      };

      // Element -> spec-node -> Element
      const element = new Element(original);
      const specNode = element.toSpecNode();
      const restored = Element.fromSpecNode(specNode);

      expect(restored.id).toBe(original.id);
      expect(restored.spec_node_id).toBe(original.spec_node_id);
      expect(restored.type).toBe(original.type);
      expect(restored.layer_id).toBe(original.layer_id);
      expect(restored.name).toBe(original.name);
      expect(restored.description).toBe(original.description);
      expect(restored.attributes).toEqual(original.attributes);
      expect(restored.metadata).toEqual(original.metadata);
    });

    it("should preserve legacy elementId through serialization", () => {
      const element = new Element({
        id: "api.endpoint.create-customer",
        type: "endpoint",
        name: "Create Customer",
        properties: { method: "POST" },
      });

      const json = element.toJSON();

      expect(json.elementId).toBe("api.endpoint.create-customer");
      expect(json.spec_node_id).toBe("api.endpoint");
    });
  });

  describe("toJSON() - Serialization", () => {
    it("should serialize Element to JSON with spec-node fields", () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Create Customer",
        attributes: { method: "POST" },
      });

      const json = element.toJSON();

      expect(json.id).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(json.spec_node_id).toBe("api.endpoint");
      expect(json.type).toBe("endpoint");
      expect(json.layer_id).toBe("api");
      expect(json.name).toBe("Create Customer");
      expect(json.attributes).toEqual({ method: "POST" });
    });

    it("should exclude empty attributes from JSON", () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Create Customer",
        attributes: {},
      });

      const json = element.toJSON();

      expect(json.attributes).toBeUndefined();
    });
  });

  describe("Backward Compatibility", () => {
    it("should maintain properties field during transition", () => {
      const element = new Element({
        id: "api.endpoint.create-customer",
        type: "endpoint",
        name: "Create Customer",
        properties: { method: "POST", status: "active" },
      });

      // Old code accessing properties should still work
      expect(element.properties).toEqual({ method: "POST", status: "active" });
      // New code accessing attributes should also work
      expect(element.attributes).toEqual({ method: "POST", status: "active" });
    });

    it("should support getProperty() and setProperty() methods", () => {
      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Create Customer",
        attributes: { method: "POST" },
      });

      // Old API should still work
      expect(element.getProperty("method")).toBe("POST");
      element.setProperty("status", "active");
      expect(element.attributes.status).toBe("active");
    });
  });

  describe("Layer-aware Source Reference Handling", () => {
    it("should extract source reference from legacy OpenAPI pattern (x-source-reference)", () => {
      const sourceRef = {
        provenance: "source-code" as const,
        locations: [{ file: "src/api.ts", line: 42 }],
      };

      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Create Customer",
        properties: { "x-source-reference": sourceRef },
        layer: "api",
      });

      expect(element.source_reference).toEqual(sourceRef);
    });

    it("should extract source reference from legacy ArchiMate pattern (properties.source.reference)", () => {
      const sourceRef = {
        provenance: "design-document" as const,
        locations: [{ file: "docs/architecture.md" }],
      };

      const element = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "motivation.goal",
        type: "goal",
        layer_id: "motivation",
        name: "Customer Satisfaction",
        properties: {
          source: { reference: sourceRef },
        },
        layer: "motivation",
      });

      expect(element.source_reference).toEqual(sourceRef);
    });
  });
});
