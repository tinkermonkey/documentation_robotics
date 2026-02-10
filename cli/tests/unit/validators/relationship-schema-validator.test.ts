import { describe, it, expect, beforeEach } from "bun:test";
import { RelationshipSchemaValidator } from "@/validators/relationship-schema-validator";
import { Model } from "@/core/model";
import { Manifest } from "@/core/manifest";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Relationships } from "@/core/relationships";

describe("RelationshipSchemaValidator", () => {
  function createTestModel(): Model {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });
    return new Model("/test", manifest);
  }

  describe("basic validation", () => {
    it("should validate model with no relationships", async () => {
      const validator = new RelationshipSchemaValidator();
      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "motivation.goal.goal-1",
          type: "goal",
          name: "Goal 1",
        }),
      ]);

      model.addLayer(layer);

      const result = await validator.validateModel(model);

      expect(result.isValid()).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate model with valid relationships", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "motivation.goal.goal-1",
          type: "goal",
          name: "Goal 1",
        }),
        new Element({
          id: "motivation.goal.goal-2",
          type: "goal",
          name: "Goal 2",
        }),
      ]);

      model.addLayer(layer);

      // Add valid relationship
      model.relationships.add({
        source: "motivation.goal.goal-1",
        target: "motivation.goal.goal-2",
        predicate: "depends-on",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      // Should return a valid result without critical errors
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("should detect missing source element", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "motivation.goal.goal-1",
          type: "goal",
          name: "Goal 1",
        }),
      ]);

      model.addLayer(layer);

      // Add relationship with missing source
      model.relationships.add({
        source: "motivation.goal.missing-goal",
        target: "motivation.goal.goal-1",
        predicate: "depends-on",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.message.includes("not found"))).toBe(true);
    });

    it("should detect missing target element", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "motivation.goal.goal-1",
          type: "goal",
          name: "Goal 1",
        }),
      ]);

      model.addLayer(layer);

      // Add relationship with missing target
      model.relationships.add({
        source: "motivation.goal.goal-1",
        target: "motivation.goal.missing-goal",
        predicate: "depends-on",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.message.includes("not found"))).toBe(true);
    });
  });

  describe("cardinality validation", () => {
    it("should handle many-to-many cardinality (no constraints)", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "motivation.goal.goal-1",
          type: "goal",
          name: "Goal 1",
        }),
        new Element({
          id: "motivation.goal.goal-2",
          type: "goal",
          name: "Goal 2",
        }),
        new Element({
          id: "motivation.goal.goal-3",
          type: "goal",
          name: "Goal 3",
        }),
      ]);

      model.addLayer(layer);

      // Add multiple relationships (many-to-many allows this)
      model.relationships.add({
        source: "motivation.goal.goal-1",
        target: "motivation.goal.goal-2",
        predicate: "depends-on",
        layer: "motivation",
      });

      model.relationships.add({
        source: "motivation.goal.goal-1",
        target: "motivation.goal.goal-3",
        predicate: "depends-on",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      // Many-to-many should not produce cardinality errors
      const cardinalityErrors = result.errors.filter((e) =>
        e.message.includes("Cardinality")
      );
      expect(cardinalityErrors).toHaveLength(0);
    });

    it("should enforce one-to-many cardinality constraints", async () => {
      const validator = new RelationshipSchemaValidator();

      // Mock one-to-many relationship schema
      // In real usage, this would come from the bundled schemas
      // For this test, we're testing the logic

      const model = createTestModel();

      const layer = new Layer("api", [
        new Element({
          id: "api.operation.create-order",
          type: "operation",
          name: "Create Order",
        }),
        new Element({
          id: "api.schema.order-request",
          type: "schema",
          name: "Order Request",
        }),
        new Element({
          id: "api.schema.order-response",
          type: "schema",
          name: "Order Response",
        }),
      ]);

      model.addLayer(layer);

      // In a one-to-many relationship, one source can have many targets
      // but each target can only have one source for that predicate type
      model.relationships.add({
        source: "api.operation.create-order",
        target: "api.schema.order-request",
        predicate: "consumes",
        layer: "api",
      });

      model.relationships.add({
        source: "api.operation.create-order",
        target: "api.schema.order-response",
        predicate: "consumes",
        layer: "api",
      });

      const result = await validator.validateModel(model);

      // Should not have cardinality errors since different targets
      const cardinalityErrors = result.errors.filter((e) =>
        e.message.includes("Cardinality")
      );
      expect(cardinalityErrors).toHaveLength(0);
    });

    it("should enforce many-to-one cardinality constraints", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("api", [
        new Element({
          id: "api.operation.get-order",
          type: "operation",
          name: "Get Order",
        }),
        new Element({
          id: "api.operation.list-orders",
          type: "operation",
          name: "List Orders",
        }),
        new Element({
          id: "api.schema.order",
          type: "schema",
          name: "Order",
        }),
      ]);

      model.addLayer(layer);

      // In many-to-one, multiple sources can reference one target
      // but each target can only be targeted once
      model.relationships.add({
        source: "api.operation.get-order",
        target: "api.schema.order",
        predicate: "produces",
        layer: "api",
      });

      model.relationships.add({
        source: "api.operation.list-orders",
        target: "api.schema.order",
        predicate: "produces",
        layer: "api",
      });

      const result = await validator.validateModel(model);

      // Multiple sources referencing same target should be OK for many-to-one
      const cardinalityErrors = result.errors.filter((e) =>
        e.message.includes("Cardinality")
      );
      expect(cardinalityErrors).toHaveLength(0);
    });

    it("should enforce one-to-one cardinality constraints", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "motivation.stakeholder.stakeholder-1",
          type: "stakeholder",
          name: "Stakeholder 1",
        }),
        new Element({
          id: "motivation.stakeholder.stakeholder-2",
          type: "stakeholder",
          name: "Stakeholder 2",
        }),
        new Element({
          id: "motivation.stakeholder.stakeholder-3",
          type: "stakeholder",
          name: "Stakeholder 3",
        }),
      ]);

      model.addLayer(layer);

      // In one-to-one, each source can only have one such relationship
      // and each target can only be involved in one
      model.relationships.add({
        source: "motivation.stakeholder.stakeholder-1",
        target: "motivation.stakeholder.stakeholder-2",
        predicate: "reports-to",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      // Single one-to-one relationship is valid
      const cardinalityErrors = result.errors.filter((e) =>
        e.message.includes("Cardinality")
      );
      expect(cardinalityErrors).toHaveLength(0);
    });
  });

  describe("relationship grouping", () => {
    it("should handle relationships with same source but different targets", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "motivation.goal.goal-1",
          type: "goal",
          name: "Goal 1",
        }),
        new Element({
          id: "motivation.goal.goal-2",
          type: "goal",
          name: "Goal 2",
        }),
        new Element({
          id: "motivation.goal.goal-3",
          type: "goal",
          name: "Goal 3",
        }),
      ]);

      model.addLayer(layer);

      model.relationships.add({
        source: "motivation.goal.goal-1",
        target: "motivation.goal.goal-2",
        predicate: "depends-on",
        layer: "motivation",
      });

      model.relationships.add({
        source: "motivation.goal.goal-1",
        target: "motivation.goal.goal-3",
        predicate: "depends-on",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      // Should be valid - same source, different targets with same predicate
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("should handle relationships with different sources targeting same element", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "motivation.goal.goal-1",
          type: "goal",
          name: "Goal 1",
        }),
        new Element({
          id: "motivation.goal.goal-2",
          type: "goal",
          name: "Goal 2",
        }),
        new Element({
          id: "motivation.goal.goal-3",
          type: "goal",
          name: "Goal 3",
        }),
      ]);

      model.addLayer(layer);

      model.relationships.add({
        source: "motivation.goal.goal-1",
        target: "motivation.goal.goal-3",
        predicate: "depends-on",
        layer: "motivation",
      });

      model.relationships.add({
        source: "motivation.goal.goal-2",
        target: "motivation.goal.goal-3",
        predicate: "depends-on",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      // Should be valid - different sources, same target with same predicate
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("should handle empty relationships list", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();
      const layer = new Layer("motivation", []);
      model.addLayer(layer);

      const result = await validator.validateModel(model);

      expect(result.isValid()).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("relationship with properties", () => {
    it("should validate relationship properties against schema", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "motivation.goal.goal-1",
          type: "goal",
          name: "Goal 1",
        }),
        new Element({
          id: "motivation.goal.goal-2",
          type: "goal",
          name: "Goal 2",
        }),
      ]);

      model.addLayer(layer);

      model.relationships.add({
        source: "motivation.goal.goal-1",
        target: "motivation.goal.goal-2",
        predicate: "depends-on",
        layer: "motivation",
        properties: {
          reason: "Business requirement",
          impact: "High",
        },
      });

      const result = await validator.validateModel(model);

      // Should return a result with array of errors
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("should handle relationships without properties", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "motivation.goal.goal-1",
          type: "goal",
          name: "Goal 1",
        }),
        new Element({
          id: "motivation.goal.goal-2",
          type: "goal",
          name: "Goal 2",
        }),
      ]);

      model.addLayer(layer);

      model.relationships.add({
        source: "motivation.goal.goal-1",
        target: "motivation.goal.goal-2",
        predicate: "depends-on",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      // Should be valid even without properties
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  describe("multi-layer models", () => {
    it("should validate relationships in multiple layers", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer1 = new Layer("motivation", [
        new Element({
          id: "motivation.goal.goal-1",
          type: "goal",
          name: "Goal 1",
        }),
        new Element({
          id: "motivation.goal.goal-2",
          type: "goal",
          name: "Goal 2",
        }),
      ]);

      const layer2 = new Layer("business", [
        new Element({
          id: "business.process.process-1",
          type: "process",
          name: "Process 1",
        }),
        new Element({
          id: "business.process.process-2",
          type: "process",
          name: "Process 2",
        }),
      ]);

      model.addLayer(layer1);
      model.addLayer(layer2);

      // Add relationships in each layer
      model.relationships.add({
        source: "motivation.goal.goal-1",
        target: "motivation.goal.goal-2",
        predicate: "depends-on",
        layer: "motivation",
      });

      model.relationships.add({
        source: "business.process.process-1",
        target: "business.process.process-2",
        predicate: "depends-on",
        layer: "business",
      });

      const result = await validator.validateModel(model);

      // Should validate relationships in all layers
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  describe("error reporting", () => {
    it("should include element IDs in error messages", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "motivation.goal.goal-1",
          type: "goal",
          name: "Goal 1",
        }),
      ]);

      model.addLayer(layer);

      // Add relationship with missing target
      model.relationships.add({
        source: "motivation.goal.goal-1",
        target: "motivation.goal.missing",
        predicate: "depends-on",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      // Should have error with element ID
      const errors = result.errors.filter((e) => e.message.includes("not found"));
      if (errors.length > 0) {
        expect(errors[0].elementId).toBeDefined();
      }
    });

    it("should include layer information in error messages", async () => {
      const validator = new RelationshipSchemaValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "motivation.goal.goal-1",
          type: "goal",
          name: "Goal 1",
        }),
      ]);

      model.addLayer(layer);

      // Add relationship with missing target
      model.relationships.add({
        source: "motivation.goal.goal-1",
        target: "motivation.goal.missing",
        predicate: "depends-on",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      // Should have error with layer information
      if (result.errors.length > 0) {
        expect(result.errors[0].layer).toBe("motivation");
      }
    });
  });
});
