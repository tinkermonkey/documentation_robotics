import { describe, it, expect, beforeEach } from "bun:test";
import { ElementMigration } from "../../src/utils/element-migration.js";
import { Element } from "../../src/core/element.js";
import { Layer } from "../../src/core/layer.js";
import { Model } from "../../src/core/model.js";

describe("ElementMigration - Legacy to Spec-Node Format", () => {
  let migration: ElementMigration;

  beforeEach(() => {
    migration = new ElementMigration();
  });

  describe("Migration Detection", () => {
    it("should identify legacy elements with elementId field", () => {
      const legacyElement = new Element({
        id: "api.endpoint.create-customer",
        elementId: "api.endpoint.create-customer",
        type: "endpoint",
        name: "Create Customer",
        properties: { method: "POST" },
      });

      expect(legacyElement.elementId).toBe("api.endpoint.create-customer");
      expect(legacyElement.spec_node_id).toBeDefined();
    });

    it("should identify legacy elements with semantic ID in id field", () => {
      const legacyElement = new Element({
        id: "motivation.goal.customer-satisfaction",
        type: "goal",
        name: "Customer Satisfaction",
        properties: { priority: "high" },
      });

      expect(legacyElement.spec_node_id).toBe("motivation.goal");
    });

    it("should identify spec-node aligned elements (no migration needed)", () => {
      const specElement = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Create Customer",
      });

      expect(specElement.spec_node_id).toBe("api.endpoint");
      expect(specElement.layer_id).toBe("api");
    });
  });

  describe("Migration Results", () => {
    it("should report migration statistics", async () => {
      // Create a mock model with mixed legacy and spec-aligned elements
      const model = new Model();

      const apiLayer = new Layer("api", "06-api.layer.json");
      const motivationLayer = new Layer("motivation", "01-motivation.layer.json");

      // Legacy element
      const legacyElement = new Element({
        id: "api.endpoint.create-customer",
        type: "endpoint",
        name: "Create Customer",
        properties: { method: "POST" },
      });

      // Spec-node aligned element
      const specElement = new Element({
        id: "550e8400-e29b-41d4-a716-446655440000",
        spec_node_id: "motivation.goal",
        type: "goal",
        layer_id: "motivation",
        name: "Customer Satisfaction",
      });

      apiLayer.addElement(legacyElement);
      motivationLayer.addElement(specElement);

      model.addLayer(apiLayer);
      model.addLayer(motivationLayer);

      const result = await migration.migrateModel(model);

      expect(result.migrated).toBeGreaterThan(0);
      expect(result.skipped).toBeGreaterThan(0);
      expect(result.errors).toEqual([]);
    });

    it("should include detailed migration status for each element", async () => {
      const model = new Model();
      const apiLayer = new Layer("api", "06-api.layer.json");

      const element = new Element({
        id: "api.endpoint.get-customer",
        type: "endpoint",
        name: "Get Customer",
        properties: { method: "GET" },
      });

      apiLayer.addElement(element);
      model.addLayer(apiLayer);

      const result = await migration.migrateModel(model);

      expect(result.details).toBeDefined();
      expect(Array.isArray(result.details)).toBe(true);
      expect(result.details.length).toBeGreaterThan(0);

      // Check detail structure
      if (result.details.length > 0) {
        const detail = result.details[0];
        expect(detail.layerName).toBeDefined();
        expect(detail.elementId).toBeDefined();
        expect(["migrated", "skipped", "error"]).toContain(detail.status);
      }
    });

    it("should track errors and continue migration for other elements", async () => {
      const model = new Model();
      const layer = new Layer("api", "06-api.layer.json");

      // Add multiple elements to ensure migration continues on error
      const element1 = new Element({
        id: "api.endpoint.endpoint1",
        type: "endpoint",
        name: "Endpoint 1",
      });

      const element2 = new Element({
        id: "api.endpoint.endpoint2",
        type: "endpoint",
        name: "Endpoint 2",
      });

      layer.addElement(element1);
      layer.addElement(element2);
      model.addLayer(layer);

      const result = await migration.migrateModel(model);

      // Should process all elements even if one fails
      expect(result.details.length).toBe(2);
    });
  });

  describe("Metadata Initialization", () => {
    it("should initialize metadata with timestamps during migration", () => {
      const element = new Element({
        id: "api.endpoint.test",
        type: "endpoint",
        name: "Test",
      });

      expect(element.metadata).toBeDefined();
      expect(element.metadata?.created_at).toBeDefined();
      expect(element.metadata?.version).toBe(1);
    });

    it("should update metadata version on migration", () => {
      const element = new Element({
        id: "api.endpoint.test",
        type: "endpoint",
        name: "Test",
        metadata: {
          created_at: "2024-01-01T00:00:00Z",
          version: 2,
        },
      });

      expect(element.metadata?.version).toBe(2);
    });
  });

  describe("Properties to Attributes Migration", () => {
    it("should migrate properties to attributes", async () => {
      const model = new Model();
      const layer = new Layer("api", "06-api.layer.json");

      const element = new Element({
        id: "api.endpoint.create",
        type: "endpoint",
        name: "Create",
        properties: { method: "POST", path: "/api/v1/items" },
      });

      layer.addElement(element);
      model.addLayer(layer);

      // Element constructor should have already migrated
      expect(element.attributes).toEqual({ method: "POST", path: "/api/v1/items" });
      expect(element.properties).toEqual({ method: "POST", path: "/api/v1/items" });
    });

    it("should preserve empty attributes field", () => {
      const element = new Element({
        id: "api.endpoint.test",
        type: "endpoint",
        name: "Test",
      });

      expect(element.attributes).toEqual({});
    });
  });

  describe("UUID Handling", () => {
    it("should generate UUID for elements with semantic IDs", () => {
      const element = new Element({
        id: "api.endpoint.create-customer",
        type: "endpoint",
        name: "Create Customer",
      });

      expect(element.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("should preserve existing UUID", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const element = new Element({
        id: uuid,
        spec_node_id: "api.endpoint",
        type: "endpoint",
        layer_id: "api",
        name: "Test",
      });

      expect(element.id).toBe(uuid);
    });

    it("should handle elements with UUID in new format", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440001";
      const element = new Element({
        id: uuid,
        type: "endpoint",
        layer_id: "api",
        name: "Test",
      });

      expect(element.id).toBe(uuid);
    });
  });

  describe("Semantic ID Preservation", () => {
    it("should preserve semantic ID in elementId field", () => {
      const element = new Element({
        id: "api.endpoint.create-customer",
        type: "endpoint",
        name: "Create Customer",
      });

      expect(element.elementId).toBe("api.endpoint.create-customer");
    });

    it("should extract layer and type from semantic ID", () => {
      const element = new Element({
        id: "motivation.goal.customer-satisfaction",
        type: "goal",
        name: "Customer Satisfaction",
      });

      expect(element.layer_id).toBe("motivation");
      expect(element.type).toBe("goal");
      expect(element.spec_node_id).toBe("motivation.goal");
    });
  });
});
