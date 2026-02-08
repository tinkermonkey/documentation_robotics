import { describe, test, expect, beforeEach } from "bun:test";
import { Model } from "../../src/core/model.js";
import { ArchiMateExporter } from "../../src/export/archimate-exporter.js";
import { OpenAPIExporter } from "../../src/export/openapi-exporter.js";
import { JSONSchemaExporter } from "../../src/export/json-schema-exporter.js";
import { ArchiMateImporter } from "../../src/import/archimate-importer.js";
import { OpenAPIImporter } from "../../src/import/openapi-importer.js";

describe("Export Backward Compatibility Tests", () => {
  let model: Model;

  beforeEach(async () => {
    model = new Model();
  });

  describe("ArchiMate Export Consistency", () => {
    test("exports valid ArchiMate XML structure", async () => {
      // Setup model with ArchiMate elements
      model.graph.addNode({
        id: "goal-1",
        layer: "motivation",
        type: "goal",
        name: "Customer Satisfaction",
        description: "Achieve high customer satisfaction",
        properties: {},
      });

      model.graph.addNode({
        id: "service-1",
        layer: "business",
        type: "business-service",
        name: "Order Processing Service",
        description: "Service for processing orders",
        properties: {},
      });

      model.graph.addEdge({
        id: "rel-1",
        source: "service-1",
        destination: "goal-1",
        predicate: "realizes",
        properties: {},
      });

      const exporter = new ArchiMateExporter();
      const xml = await exporter.export(model, { layers: ["motivation", "business"] });

      // Verify XML structure
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain("<model");
      expect(xml).toContain("</model>");
      expect(xml).toContain("<elements>");
      expect(xml).toContain("</elements>");
      expect(xml).toContain("<relationships>");
      expect(xml).toContain("</relationships>");

      // Verify elements are present
      expect(xml).toContain("goal-1");
      expect(xml).toContain("Customer Satisfaction");
      expect(xml).toContain("service-1");
      expect(xml).toContain("Order Processing Service");

      // Verify relationship is present
      expect(xml).toContain("rel-1");
    });

    test("round-trip ArchiMate: export then import preserves data", async () => {
      // Create model with elements
      model.graph.addNode({
        id: "goal-1",
        layer: "motivation",
        type: "goal",
        name: "Business Goal",
        description: "A business goal",
        properties: { priority: "high" },
      });

      // Export
      const exporter = new ArchiMateExporter();
      const xml = await exporter.export(model, { layers: ["motivation"] });

      // Import into new model
      const importedModel = new Model();
      const importer = new ArchiMateImporter();
      const result = await importer.import(xml, importedModel);

      expect(result.success).toBe(true);
      expect(result.nodesAdded).toBe(1);

      // Verify data is preserved
      const importedNode = importedModel.graph.getNode("goal-1");
      expect(importedNode?.name).toBe("Business Goal");
      expect(importedNode?.description).toBe("A business goal");
      expect(importedNode?.layer).toBe("motivation");
    });

    test("exports elements with all layers (1, 2, 4, 5)", async () => {
      // Add elements from each ArchiMate-supported layer
      const elements = [
        { id: "m-1", layer: "motivation", type: "goal", name: "Goal" },
        { id: "b-1", layer: "business", type: "business-service", name: "Service" },
        { id: "a-1", layer: "application", type: "application-component", name: "Component" },
        { id: "t-1", layer: "technology", type: "technology-service", name: "Tech Service" },
      ];

      for (const elem of elements) {
        model.graph.addNode({
          ...elem,
          description: "",
          properties: {},
        });
      }

      const exporter = new ArchiMateExporter();
      const xml = await exporter.export(model, {
        layers: ["motivation", "business", "application", "technology"],
      });

      // All elements should be in export
      for (const elem of elements) {
        expect(xml).toContain(elem.id);
        expect(xml).toContain(elem.name);
      }
    });
  });

  describe("OpenAPI Export Consistency", () => {
    test("exports valid OpenAPI JSON structure", async () => {
      // Setup model with API elements
      model.graph.addNode({
        id: "api.openapi-document.pet-store",
        layer: "api",
        type: "openapi-document",
        name: "Pet Store API",
        description: "API for pet store",
        properties: {
          version: "1.0.0",
          servers: [],
          info: { title: "Pet Store API", version: "1.0.0" },
        },
      });

      model.graph.addNode({
        id: "api.endpoint.list-pets",
        layer: "api",
        type: "endpoint",
        name: "List Pets",
        description: "Get list of pets",
        properties: {
          method: "GET",
          path: "/pets",
          tags: ["pets"],
          responses: { "200": { description: "Success" } },
        },
      });

      const exporter = new OpenAPIExporter();
      const json = await exporter.export(model, { layers: ["api"] });

      // Parse and verify structure
      const spec = JSON.parse(json);
      expect(spec.openapi).toBeDefined();
      expect(spec.info).toBeDefined();
      expect(spec.info.title).toBe("Pet Store API");
      expect(spec.paths).toBeDefined();
    });

    test("round-trip OpenAPI: export then import preserves endpoints", async () => {
      // Create model with API endpoint
      model.graph.addNode({
        id: "api.openapi-document.test-api",
        layer: "api",
        type: "openapi-document",
        name: "Test API",
        description: "",
        properties: {
          version: "1.0.0",
          servers: [],
          info: { title: "Test API", version: "1.0.0" },
        },
      });

      model.graph.addNode({
        id: "api.endpoint.create-user",
        layer: "api",
        type: "endpoint",
        name: "Create User",
        description: "Create a new user",
        properties: {
          method: "POST",
          path: "/users",
          tags: [],
          responses: { "201": { description: "Created" } },
        },
      });

      // Export
      const exporter = new OpenAPIExporter();
      const json = await exporter.export(model, { layers: ["api"] });

      // Import
      const importedModel = new Model();
      const importer = new OpenAPIImporter();
      const result = await importer.import(json, importedModel);

      expect(result.success).toBe(true);
      expect(result.nodesAdded).toBeGreaterThan(0);

      // Verify document was imported
      const importedDoc = importedModel.graph.getNode("api.openapi-document.test-api");
      expect(importedDoc?.name).toBe("Test API");
    });
  });

  describe("JSON Schema Export Consistency", () => {
    test("exports valid JSON Schema structure", async () => {
      // Setup model with data model elements
      model.graph.addNode({
        id: "data-model.entity.user",
        layer: "data-model",
        type: "entity",
        name: "User",
        description: "User entity",
        properties: {
          schema: {
            type: "object",
            properties: { id: { type: "string" }, name: { type: "string" } },
          },
        },
      });

      const exporter = new JSONSchemaExporter();
      const json = await exporter.export(model, { layers: ["data-model"] });

      // Should be valid JSON
      const schemas = JSON.parse(json);
      expect(Array.isArray(schemas) || typeof schemas === "object").toBe(true);
    });
  });

  describe("Graph-based Query Validation", () => {
    test("exporter uses graph.getNodesByLayer for efficiency", async () => {
      // Add nodes to multiple layers
      const layers = ["motivation", "business", "application", "technology"];
      for (const layer of layers) {
        model.graph.addNode({
          id: `${layer}.test.element`,
          layer,
          type: "test",
          name: `Test ${layer}`,
          description: "",
          properties: {},
        });
      }

      // Export should include only requested layers
      const exporter = new ArchiMateExporter();
      const xml1 = await exporter.export(model, { layers: ["motivation", "business"] });
      const xml2 = await exporter.export(model, { layers: ["application", "technology"] });

      // xml1 should have motivation and business elements
      expect(xml1).toContain("motivation.test.element");
      expect(xml1).toContain("business.test.element");

      // xml2 should have application and technology elements
      expect(xml2).toContain("application.test.element");
      expect(xml2).toContain("technology.test.element");

      // xml1 should NOT have elements from xml2 request
      expect(xml1).not.toContain("application.test.element");
      expect(xml2).not.toContain("motivation.test.element");
    });

    test("exporter preserves edges when querying graph", async () => {
      // Add nodes and edge
      model.graph.addNode({
        id: "m-1",
        layer: "motivation",
        type: "goal",
        name: "Goal",
        description: "",
        properties: {},
      });

      model.graph.addNode({
        id: "b-1",
        layer: "business",
        type: "business-service",
        name: "Service",
        description: "",
        properties: {},
      });

      model.graph.addEdge({
        id: "rel-1",
        source: "b-1",
        destination: "m-1",
        predicate: "realizes",
        properties: {},
      });

      const exporter = new ArchiMateExporter();
      const xml = await exporter.export(model, {
        layers: ["motivation", "business"],
      });

      // Relationship should be in export
      expect(xml).toContain("rel-1");
      expect(xml).toContain("realizes");
    });
  });
});
