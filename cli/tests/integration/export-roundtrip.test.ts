import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Manifest } from "@/core/manifest";
import { ensureDir } from "@/utils/file-io";

/**
 * Export Roundtrip Test Suite
 *
 * This suite exercises every exporter with populated models to verify:
 * 1. Output is non-empty
 * 2. Specific attribute values are correctly exported (not UUIDs, not wrong types)
 * 3. Data types are correct (arrays, objects, strings)
 * 4. Format-specific elements appear in output
 *
 * Bugs caught:
 * - BUG-2026-03-15-004: JSON Schema empty definitions
 * - BUG-9598-009: OpenAPI empty paths
 * - BUG-9598-010: ArchiMate empty XML
 * - BUG-6163-001: OpenAPI operationId uses UUID instead of stored value
 * - BUG-6163-002: OpenAPI operationId as URL path / all GET methods
 * - BUG-6163-003: OpenAPI tags as string instead of array
 * - BUG-ADVENTURE-2026-03-16_00-50-24-002: ArchiMate generic xsi:type
 * - BUG-6163-008: JSON Schema drops objectschema properties
 * - BUG-6163-009: JSON Schema schemaproperty with wrong type
 */

describe("Export Roundtrip Tests", () => {
  let testDir: string;
  let model: Model;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = `/tmp/test-export-roundtrip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await ensureDir(testDir);
    await ensureDir(`${testDir}/.dr/layers`);

    // Create a populated test model
    const manifest = new Manifest({
      name: "Export Roundtrip Test Model",
      version: "1.0.0",
      description: "Test model for export attribute accuracy",
      author: "Test Suite",
    });

    model = new Model(testDir, manifest);
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      const fs = await import("fs/promises");
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("OpenAPI Exporter - Attribute Accuracy", () => {
    let loadedModel: Model;
    let exporter: any;

    beforeEach(async () => {
      // Create API layer with operations
      const apiLayer = new Layer("api");

      // Operation 1: Create User (POST)
      const createUserOp = new Element({
        id: "api.operation.create-user",
        type: "operation",
        name: "Create User",
        description: "Create a new user",
        attributes: {
          path: "/users",
          method: "POST",
          operationId: "createUser",
          tags: ["users", "public"],
          parameters: [
            { name: "body", in: "body", required: true, schema: { type: "object" } },
          ],
          responses: {
            "201": { description: "User created successfully" },
            "400": { description: "Bad request" },
          },
        },
      });

      // Operation 2: Get User (GET)
      const getUserOp = new Element({
        id: "api.operation.get-user",
        type: "operation",
        name: "Get User",
        description: "Retrieve a user by ID",
        attributes: {
          path: "/users/{id}",
          method: "GET",
          operationId: "getUserById",
          tags: ["users"],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "User found" },
            "404": { description: "User not found" },
          },
        },
      });

      apiLayer.addElement(createUserOp);
      apiLayer.addElement(getUserOp);
      model.addLayer(apiLayer);

      // Save model
      await model.saveManifest();
      await model.saveLayer("api");

      // Load model and initialize exporter once per describe block
      loadedModel = await Model.load(testDir);
      const { OpenAPIExporter } = await import("@/export/openapi-exporter");
      exporter = new OpenAPIExporter();
    });

    it("should export non-empty OpenAPI paths", async () => {
      const result = await exporter.export(loadedModel, { layers: ["api"] });

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);

      const spec = JSON.parse(result);
      expect(spec.paths).toBeDefined();
      expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    });

    it("should export operationId matching stored attribute value, not UUID", async () => {
      const result = await exporter.export(loadedModel, { layers: ["api"] });

      const spec = JSON.parse(result);

      // Verify operationId matches stored value, not element ID or UUID
      expect(spec.paths["/users"].post.operationId).toBe("createUser");
      expect(spec.paths["/users"].post.operationId).not.toBe("api.operation.create-user");
      expect(spec.paths["/users/{id}"].get.operationId).toBe("getUserById");
      expect(spec.paths["/users/{id}"].get.operationId).not.toBe("api.operation.get-user");

      // Verify it's not a UUID (UUIDs have dashes and specific pattern)
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(uuidPattern.test(spec.paths["/users"].post.operationId)).toBe(false);
      expect(uuidPattern.test(spec.paths["/users/{id}"].get.operationId)).toBe(false);
    });

    it("should export tags as array, not string", async () => {
      const result = await exporter.export(loadedModel, { layers: ["api"] });

      const spec = JSON.parse(result);

      // Verify tags are arrays
      expect(Array.isArray(spec.paths["/users"].post.tags)).toBe(true);
      expect(spec.paths["/users"].post.tags).toEqual(["users", "public"]);

      expect(Array.isArray(spec.paths["/users/{id}"].get.tags)).toBe(true);
      expect(spec.paths["/users/{id}"].get.tags).toEqual(["users"]);

      // Verify tags are not strings
      expect(typeof spec.paths["/users"].post.tags).not.toBe("string");
    });

    it("should export correct HTTP method for each operation", async () => {
      const result = await exporter.export(loadedModel, { layers: ["api"] });

      const spec = JSON.parse(result);

      // Verify POST method on /users
      expect(spec.paths["/users"].post).toBeDefined();
      expect(spec.paths["/users"].get).toBeUndefined();

      // Verify GET method on /users/{id}
      expect(spec.paths["/users/{id}"].get).toBeDefined();
      expect(spec.paths["/users/{id}"].post).toBeUndefined();
    });

    it("should export operation paths matching stored path attribute", async () => {
      const result = await exporter.export(loadedModel, { layers: ["api"] });

      const spec = JSON.parse(result);

      // Verify paths exist as stored
      expect(spec.paths["/users"]).toBeDefined();
      expect(spec.paths["/users/{id}"]).toBeDefined();

      // Verify paths don't use element ID or UUID
      const allPaths = Object.keys(spec.paths);
      expect(allPaths.some((p) => p.includes("api.operation"))).toBe(false);
      expect(allPaths.some((p) => /[0-9a-f]{8}-[0-9a-f]{4}/.test(p))).toBe(false);
    });
  });

  describe("JSON Schema Exporter - Attribute Accuracy", () => {
    let loadedModel: Model;
    let exporter: any;

    beforeEach(async () => {
      // Create data-model layer with entities and properties
      const dataModelLayer = new Layer("data-model");

      // ObjectSchema element (complex type)
      const userObjectSchema = new Element({
        id: "data-model.objectschema.user",
        type: "objectschema",
        name: "User",
        description: "User object schema",
        attributes: {
          properties: {
            id: { type: "string", description: "User ID" },
            email: { type: "string", format: "email" },
            name: { type: "string" },
            age: { type: "integer", minimum: 0 },
            active: { type: "boolean" },
          },
          required: ["id", "email"],
        },
      });

      // Entity with properties
      const orderEntity = new Element({
        id: "data-model.entity.order",
        type: "entity",
        name: "Order",
        description: "Order entity",
        attributes: {
          properties: {
            id: { type: "string" },
            customerId: { type: "string" },
            amount: { type: "number" },
            status: { type: "string", enum: ["pending", "completed", "cancelled"] },
          },
          required: ["id", "customerId", "amount"],
        },
      });

      // SchemaProperty with specific type
      const userIdProperty = new Element({
        id: "data-model.schemaproperty.user-id",
        type: "schemaproperty",
        name: "user_id",
        description: "User ID property",
        attributes: {
          type: "string",
          format: "uuid",
        },
      });

      dataModelLayer.addElement(userObjectSchema);
      dataModelLayer.addElement(orderEntity);
      dataModelLayer.addElement(userIdProperty);
      model.addLayer(dataModelLayer);

      // Save model
      await model.saveManifest();
      await model.saveLayer("data-model");

      // Load model and initialize exporter once per describe block
      loadedModel = await Model.load(testDir);
      const { JsonSchemaExporter } = await import("@/export/json-schema-exporter");
      exporter = new JsonSchemaExporter();
    });

    it("should export non-empty JSON Schema definitions", async () => {
      const result = await exporter.export(loadedModel, { layers: ["data-model"] });

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);

      const schema = JSON.parse(result);
      expect(schema.definitions).toBeDefined();
      expect(Object.keys(schema.definitions).length).toBeGreaterThan(0);
    });

    it("should export objectschema with properties object present", async () => {
      const result = await exporter.export(loadedModel, { layers: ["data-model"] });

      const schema = JSON.parse(result);

      // Find objectschema definition
      const objectSchemaDef = schema.definitions["data-model.objectschema.user"];
      expect(objectSchemaDef).toBeDefined();

      // Verify properties object is present and not empty
      expect(objectSchemaDef.properties).toBeDefined();
      expect(typeof objectSchemaDef.properties).toBe("object");
      expect(Object.keys(objectSchemaDef.properties).length).toBeGreaterThan(0);

      // Verify specific properties exist
      expect(objectSchemaDef.properties.id).toBeDefined();
      expect(objectSchemaDef.properties.email).toBeDefined();
      expect(objectSchemaDef.properties.name).toBeDefined();
    });

    it("should export schemaproperty with stored type value, not fallback", async () => {
      const result = await exporter.export(loadedModel, { layers: ["data-model"] });

      const schema = JSON.parse(result);

      // Find schemaproperty definition
      const propertyDef = schema.definitions["data-model.schemaproperty.user-id"];
      expect(propertyDef).toBeDefined();

      // Verify type matches stored value, not fallback "object"
      expect(propertyDef.type).toBe("string");
      expect(propertyDef.type).not.toBe("object");
    });

    it("should export entity properties matching stored attributes", async () => {
      const result = await exporter.export(loadedModel, { layers: ["data-model"] });

      const schema = JSON.parse(result);

      const orderDef = schema.definitions["data-model.entity.order"];
      expect(orderDef).toBeDefined();

      // Verify properties
      expect(orderDef.properties.id.type).toBe("string");
      expect(orderDef.properties.amount.type).toBe("number");
      expect(orderDef.properties.status.enum).toEqual(["pending", "completed", "cancelled"]);

      // Verify required fields
      expect(orderDef.required).toEqual(["id", "customerId", "amount"]);
    });

    it("should export valid JSON Schema draft 7", async () => {
      const result = await exporter.export(loadedModel, { layers: ["data-model"] });

      const schema = JSON.parse(result);
      expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    });
  });

  describe("ArchiMate Exporter - Attribute Accuracy", () => {
    let loadedModel: Model;
    let exporter: any;

    beforeEach(async () => {
      // Create business layer first (for references)
      const businessLayer = new Layer("business");
      const businessProcess = new Element({
        id: "business.businessprocess.order-fulfillment",
        type: "businessprocess",
        name: "Order Fulfillment Process",
        description: "Process for fulfilling customer orders",
      });
      businessLayer.addElement(businessProcess);
      model.addLayer(businessLayer);

      // Create motivation layer
      const motivationLayer = new Layer("motivation");

      // Goal
      const goal = new Element({
        id: "motivation.goal.customer-satisfaction",
        type: "goal",
        name: "Customer Satisfaction",
        description: "Achieve high customer satisfaction",
        attributes: { priority: "critical" },
      });

      // Requirement with reference
      const requirement = new Element({
        id: "motivation.requirement.fast-fulfillment",
        type: "requirement",
        name: "Fast Fulfillment",
        description: "Orders must be fulfilled within 24 hours",
        references: [
          {
            source: "motivation.requirement.fast-fulfillment",
            target: "business.businessprocess.order-fulfillment",
            type: "implements",
          },
        ],
      });

      // Constraint
      const constraint = new Element({
        id: "motivation.constraint.budget-limit",
        type: "constraint",
        name: "Budget Limit",
        description: "Operating cost must not exceed $100k/month",
      });

      motivationLayer.addElement(goal);
      motivationLayer.addElement(requirement);
      motivationLayer.addElement(constraint);
      model.addLayer(motivationLayer);

      // Create application layer
      const appLayer = new Layer("application");
      const appComponent = new Element({
        id: "application.applicationcomponent.order-service",
        type: "applicationcomponent",
        name: "Order Service",
        description: "Microservice for order management",
      });
      appLayer.addElement(appComponent);
      model.addLayer(appLayer);

      // Save model
      await model.saveManifest();
      await model.saveLayer("motivation");
      await model.saveLayer("business");
      await model.saveLayer("application");

      // Load model and initialize exporter once per describe block
      loadedModel = await Model.load(testDir);
      const { ArchiMateExporter } = await import("@/export/archimate-exporter");
      exporter = new ArchiMateExporter();
    });

    it("should export non-empty ArchiMate XML", async () => {
      const result = await exporter.export(loadedModel, {});

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result.includes("<?xml")).toBe(true);
    });

    it("should export elements with specific ArchiMate xsi:type, not generic Element", async () => {
      const result = await exporter.export(loadedModel, {});

      // Verify specific ArchiMate types are used, not generic "Element"
      expect(result.includes('xsi:type="Goal"')).toBe(true);
      expect(result.includes('xsi:type="Requirement"')).toBe(true);
      expect(result.includes('xsi:type="Constraint"')).toBe(true);
      expect(result.includes('xsi:type="ApplicationComponent"')).toBe(true);
      expect(result.includes('xsi:type="BusinessProcess"')).toBe(true);

      // Verify generic type is not used
      expect(result.includes('xsi:type="Element"')).toBe(false);
    });

    it("should export element names matching stored values", async () => {
      const result = await exporter.export(loadedModel, {});

      // Verify element names are present
      expect(result.includes("<name>Customer Satisfaction</name>")).toBe(true);
      expect(result.includes("<name>Fast Fulfillment</name>")).toBe(true);
      expect(result.includes("<name>Order Service</name>")).toBe(true);

      // Verify element identifiers are preserved in identifier attribute
      expect(result.includes('identifier="motivation.goal.customer-satisfaction"')).toBe(true);
    });

    it("should export ArchiMate with proper XML structure", async () => {
      const result = await exporter.export(loadedModel, {});

      // Verify XML declaration
      expect(result.startsWith('<?xml version="1.0"')).toBe(true);

      // Verify model element
      expect(result.includes("<model xmlns=")).toBe(true);

      // Verify elements and organizations are present
      expect(result.includes("<elements>")).toBe(true);
      expect(result.includes("</elements>")).toBe(true);
    });
  });

  describe("GraphML Exporter - Non-Empty Output", () => {
    let loadedModel: Model;
    let exporter: any;

    beforeEach(async () => {
      // Create multiple layers with elements
      const motivationLayer = new Layer("motivation");
      const goal = new Element({
        id: "motivation.goal.revenue",
        type: "goal",
        name: "Increase Revenue",
      });
      motivationLayer.addElement(goal);
      model.addLayer(motivationLayer);

      const businessLayer = new Layer("business");
      const process = new Element({
        id: "business.process.sales",
        type: "process",
        name: "Sales Process",
      });
      businessLayer.addElement(process);
      model.addLayer(businessLayer);

      // Save model
      await model.saveManifest();
      await model.saveLayer("motivation");
      await model.saveLayer("business");

      // Load model and initialize exporter once per describe block
      loadedModel = await Model.load(testDir);
      const { GraphMLExporter } = await import("@/export/graphml-exporter");
      exporter = new GraphMLExporter();
    });

    it("should export non-empty GraphML with proper structure", async () => {
      const result = await exporter.export(loadedModel, {});

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);

      // Verify XML structure
      expect(result.includes("<?xml")).toBe(true);
      expect(result.includes("<graphml")).toBe(true);
      expect(result.includes("</graphml>")).toBe(true);

      // Verify graph elements are present
      expect(result.includes("<graph")).toBe(true);
      expect(result.includes("<node")).toBe(true);
    });

    it("should export element names in GraphML", async () => {
      const result = await exporter.export(loadedModel, {});

      // Verify element names appear in output
      expect(result.includes("Increase Revenue")).toBe(true);
      expect(result.includes("Sales Process")).toBe(true);
    });
  });

  describe("Markdown Exporter - Non-Empty Output", () => {
    let loadedModel: Model;
    let exporter: any;

    beforeEach(async () => {
      // Create layers with diverse elements
      const motivationLayer = new Layer("motivation");
      const goal = new Element({
        id: "motivation.goal.customer-focus",
        type: "goal",
        name: "Focus on Customer Needs",
        description: "Understand and meet customer needs better",
      });
      motivationLayer.addElement(goal);
      model.addLayer(motivationLayer);

      const businessLayer = new Layer("business");
      const service = new Element({
        id: "business.service.customer-support",
        type: "service",
        name: "Customer Support Service",
        description: "Provide 24/7 customer support",
      });
      businessLayer.addElement(service);
      model.addLayer(businessLayer);

      // Save model
      await model.saveManifest();
      await model.saveLayer("motivation");
      await model.saveLayer("business");

      // Load model and initialize exporter once per describe block
      loadedModel = await Model.load(testDir);
      const { MarkdownExporter } = await import("@/export/markdown-exporter");
      exporter = new MarkdownExporter();
    });

    it("should export non-empty markdown with proper structure", async () => {
      const result = await exporter.export(loadedModel, {});

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);

      // Verify markdown structure
      expect(result.includes("# Export Roundtrip Test Model")).toBe(true);
      expect(result.includes("## Layer:")).toBe(true);
    });

    it("should export element details in markdown", async () => {
      const result = await exporter.export(loadedModel, {});

      // Verify element names and descriptions appear
      expect(result.includes("Focus on Customer Needs")).toBe(true);
      expect(result.includes("Understand and meet customer needs better")).toBe(true);
      expect(result.includes("Customer Support Service")).toBe(true);
    });

    it("should respect layer filters in markdown export", async () => {
      // Export only motivation layer
      const result = await exporter.export(loadedModel, { layers: ["motivation"] });

      expect(result.includes("Focus on Customer Needs")).toBe(true);
      expect(result.includes("Customer Support Service")).toBe(false);
    });
  });

  describe("Cross-Format Consistency", () => {
    let loadedModel: Model;
    let exporters: {
      OpenAPIExporter: any;
      JsonSchemaExporter: any;
      MarkdownExporter: any;
      GraphMLExporter: any;
    };

    beforeEach(async () => {
      // Create comprehensive model used by multiple exporters
      const apiLayer = new Layer("api");
      const endpoint = new Element({
        id: "api.operation.list-items",
        type: "operation",
        name: "List Items",
        description: "Retrieve list of items",
        attributes: {
          path: "/items",
          method: "GET",
          operationId: "listItems",
          tags: ["items"],
          responses: { "200": { description: "Success" } },
        },
      });
      apiLayer.addElement(endpoint);
      model.addLayer(apiLayer);

      const dataModelLayer = new Layer("data-model");
      const itemEntity = new Element({
        id: "data-model.entity.item",
        type: "entity",
        name: "Item",
        description: "Item entity",
        attributes: {
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            price: { type: "number" },
          },
          required: ["id", "name"],
        },
      });
      dataModelLayer.addElement(itemEntity);
      model.addLayer(dataModelLayer);

      // Save model
      await model.saveManifest();
      await model.saveLayer("api");
      await model.saveLayer("data-model");

      // Load model and initialize exporters once per describe block
      loadedModel = await Model.load(testDir);
      exporters = await import("@/export/index");
    });

    it("should produce non-empty output for all major exporters", async () => {
      const exporter_list = [
        { name: "OpenAPI", exporter: new exporters.OpenAPIExporter(), layers: ["api"] },
        { name: "JSON Schema", exporter: new exporters.JsonSchemaExporter(), layers: ["data-model"] },
        { name: "Markdown", exporter: new exporters.MarkdownExporter(), layers: [] },
        { name: "GraphML", exporter: new exporters.GraphMLExporter(), layers: [] },
      ];

      for (const { name, exporter, layers } of exporter_list) {
        const result = await exporter.export(loadedModel, { layers: layers.length > 0 ? layers : undefined });
        expect(result).toBeDefined();
        expect(result.length).toBeGreaterThan(0);
      }
    });

    it("should preserve element names across all exporters", async () => {
      // OpenAPI should have "List Items"
      const openAPI = new exporters.OpenAPIExporter();
      const apiResult = await openAPI.export(loadedModel, { layers: ["api"] });
      expect(apiResult.includes("List Items")).toBe(true);

      // JSON Schema should have "Item"
      const jsonSchema = new exporters.JsonSchemaExporter();
      const schemaResult = await jsonSchema.export(loadedModel, { layers: ["data-model"] });
      expect(schemaResult.includes("Item")).toBe(true);

      // Markdown should have both
      const markdown = new exporters.MarkdownExporter();
      const mdResult = await markdown.export(loadedModel, {});
      expect(mdResult.includes("List Items")).toBe(true);
      expect(mdResult.includes("Item")).toBe(true);
    });
  });
});
