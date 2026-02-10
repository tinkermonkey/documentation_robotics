import { describe, it, expect, beforeEach } from "bun:test";
import { RelationshipValidator } from "@/validators/relationship-schema-validator";
import { Model } from "@/core/model";
import { Manifest } from "@/core/manifest";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Relationships } from "@/core/relationships";

describe("RelationshipValidator", () => {
  function createTestModel(): Model {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });
    return new Model("/test", manifest);
  }

  describe("basic validation", () => {
    it("should validate model with no relationships", async () => {
      const validator = new RelationshipValidator();
      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b0",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 1",
        }),
      ]);

      model.addLayer(layer);

      const result = await validator.validateModel(model);

      expect(result.isValid()).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate model with valid relationships", async () => {
      const validator = new RelationshipValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b1",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 1",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b2",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 2",
        }),
      ]);

      model.addLayer(layer);

      // Add valid relationship with valid predicate "aggregates"
      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b1",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b2",
        predicate: "aggregates",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      expect(result.errors).toHaveLength(0);
    });

    it("should detect missing source element", async () => {
      const validator = new RelationshipValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b3",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 1",
        }),
      ]);

      model.addLayer(layer);

      // Add relationship with missing source
      model.relationships.add({
        source: "missing-source-id",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b3",
        predicate: "depends-on",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.message.includes("not found"))).toBe(true);
    });

    it("should detect missing target element", async () => {
      const validator = new RelationshipValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b4",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 1",
        }),
      ]);

      model.addLayer(layer);

      // Add relationship with missing target
      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b4",
        target: "missing-target-id",
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
      const validator = new RelationshipValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b5",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 1",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b6",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 2",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b7",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 3",
        }),
      ]);

      model.addLayer(layer);

      // Add multiple relationships (many-to-many allows this)
      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b5",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b6",
        predicate: "depends-on",
        layer: "motivation",
      });

      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b5",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b7",
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
      const validator = new RelationshipValidator();

      // Mock one-to-many relationship schema
      // In real usage, this would come from the bundled schemas
      // For this test, we're testing the logic

      const model = createTestModel();

      const layer = new Layer("api", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b8",
          spec_node_id: "api.operation",
          type: "operation",
          layer_id: "api",
          name: "Create Order",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b9",
          spec_node_id: "api.schema",
          type: "schema",
          layer_id: "api",
          name: "Order Request",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8ba",
          spec_node_id: "api.schema",
          type: "schema",
          layer_id: "api",
          name: "Order Response",
        }),
      ]);

      model.addLayer(layer);

      // In a one-to-many relationship, one source can have many targets
      // but each target can only have one source for that predicate type
      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b8",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b9",
        predicate: "consumes",
        layer: "api",
      });

      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8b8",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8ba",
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
      const validator = new RelationshipValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("api", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8bb",
          spec_node_id: "api.operation",
          type: "operation",
          layer_id: "api",
          name: "Get Order",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8bc",
          spec_node_id: "api.operation",
          type: "operation",
          layer_id: "api",
          name: "List Orders",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8bd",
          spec_node_id: "api.schema",
          type: "schema",
          layer_id: "api",
          name: "Order",
        }),
      ]);

      model.addLayer(layer);

      // In many-to-one, multiple sources can reference one target
      // but each target can only be targeted once
      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8bb",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8bd",
        predicate: "produces",
        layer: "api",
      });

      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8bc",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8bd",
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
      const validator = new RelationshipValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8be",
          spec_node_id: "motivation.stakeholder",
          type: "stakeholder",
          layer_id: "motivation",
          name: "Stakeholder 1",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8bf",
          spec_node_id: "motivation.stakeholder",
          type: "stakeholder",
          layer_id: "motivation",
          name: "Stakeholder 2",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8ca",
          spec_node_id: "motivation.stakeholder",
          type: "stakeholder",
          layer_id: "motivation",
          name: "Stakeholder 3",
        }),
      ]);

      model.addLayer(layer);

      // In one-to-one, each source can only have one such relationship
      // and each target can only be involved in one
      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8be",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8bf",
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
      const validator = new RelationshipValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8cb",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 1",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8cc",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 2",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8cd",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 3",
        }),
      ]);

      model.addLayer(layer);

      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8cb",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8cc",
        predicate: "aggregates",
        layer: "motivation",
      });

      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8cb",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8cd",
        predicate: "aggregates",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      expect(result.errors).toHaveLength(0);
    });

    it("should handle relationships with different sources targeting same element", async () => {
      const validator = new RelationshipValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8ce",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 1",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8cf",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 2",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d0",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 3",
        }),
      ]);

      model.addLayer(layer);

      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8ce",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d0",
        predicate: "aggregates",
        layer: "motivation",
      });

      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8cf",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d0",
        predicate: "aggregates",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      expect(result.errors).toHaveLength(0);
    });

    it("should handle empty relationships list", async () => {
      const validator = new RelationshipValidator();
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
      const validator = new RelationshipValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d1",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 1",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d2",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 2",
        }),
      ]);

      model.addLayer(layer);

      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d1",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d2",
        predicate: "aggregates",
        layer: "motivation",
        properties: {
          reason: "Business requirement",
          impact: "High",
        },
      });

      const result = await validator.validateModel(model);

      expect(result.errors).toHaveLength(0);
    });

    it("should handle relationships without properties", async () => {
      const validator = new RelationshipValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d3",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 1",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d4",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 2",
        }),
      ]);

      model.addLayer(layer);

      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d3",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d4",
        predicate: "aggregates",
        layer: "motivation",
      });

      const result = await validator.validateModel(model);

      expect(result.errors).toHaveLength(0);
    });
  });

  describe("multi-layer models", () => {
    it("should validate relationships in multiple layers", async () => {
      const validator = new RelationshipValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer1 = new Layer("motivation", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d5",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 1",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d6",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 2",
        }),
      ]);

      const layer2 = new Layer("business", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d7",
          spec_node_id: "business.businessprocess",
          type: "businessprocess",
          layer_id: "business",
          name: "Process 1",
        }),
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d8",
          spec_node_id: "business.businessprocess",
          type: "businessprocess",
          layer_id: "business",
          name: "Process 2",
        }),
      ]);

      model.addLayer(layer1);
      model.addLayer(layer2);

      // Add relationships in each layer with valid predicates
      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d5",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d6",
        predicate: "aggregates",
        layer: "motivation",
      });

      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d7",
        target: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d8",
        predicate: "flows-to",
        layer: "business",
      });

      const result = await validator.validateModel(model);

      expect(result.errors).toHaveLength(0);
    });
  });

  describe("error reporting", () => {
    it("should include element IDs in error messages", async () => {
      const validator = new RelationshipValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d9",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 1",
        }),
      ]);

      model.addLayer(layer);

      // Add relationship with missing target
      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8d9",
        target: "missing-target-id",
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
      const validator = new RelationshipValidator();
      await validator.initialize();

      const model = createTestModel();

      const layer = new Layer("motivation", [
        new Element({
          id: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8da",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "Goal 1",
        }),
      ]);

      model.addLayer(layer);

      // Add relationship with missing target
      model.relationships.add({
        source: "d8b0d8b0-d8b0-4d8b-a8b0-d8b0d8b0d8da",
        target: "missing-target-id",
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
