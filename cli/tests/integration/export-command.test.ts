import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Manifest } from "@/core/manifest";
import { ensureDir, fileExists, readFile, writeJSON, readJSON } from "@/utils/file-io";
import * as path from "path";

describe("Export Command Integration Tests", () => {
  let testDir: string;
  let model: Model;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = `/tmp/test-export-${Date.now()}`;
    await ensureDir(testDir);
    await ensureDir(`${testDir}/.dr/layers`);

    // Create a test model with multiple layers
    const manifest = new Manifest({
      name: "Integration Test Model",
      version: "1.0.0",
      description: "Test model for export integration",
      author: "Test Suite",
    });

    model = new Model(testDir, manifest);

    // Add motivation layer
    const motivationLayer = new Layer("motivation");
    const goal = new Element({
      id: "motivation-goal-revenue",
      type: "goal",
      name: "Increase Revenue",
      description: "Generate more revenue through sales",
      properties: { priority: "critical", owner: "CFO" },
    });
    const requirement = new Element({
      id: "motivation-requirement-api",
      type: "requirement",
      name: "API Integration Requirement",
      description: "Must integrate with payment provider APIs",
    });
    motivationLayer.addElement(goal);
    motivationLayer.addElement(requirement);
    model.addLayer(motivationLayer);

    // Add business layer
    const businessLayer = new Layer("business");
    const process = new Element({
      id: "business-process-sales",
      type: "business-process",
      name: "Sales Process",
      description: "End-to-end sales workflow",
      references: [
        {
          source: "business-process-sales",
          target: "motivation-goal-revenue",
          type: "realizes",
        },
      ],
    });
    businessLayer.addElement(process);
    model.addLayer(businessLayer);

    // Add API layer
    const apiLayer = new Layer("api");
    const endpoint = new Element({
      id: "api-endpoint-create-order",
      type: "endpoint",
      name: "Create Order",
      description: "API endpoint for creating orders",
      properties: {
        path: "/api/orders",
        method: "POST",
        parameters: [
          { name: "customerId", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "201": { description: "Order created successfully" },
          "400": { description: "Bad request" },
        },
      },
    });
    apiLayer.addElement(endpoint);
    model.addLayer(apiLayer);

    // Add data-model layer
    const dataModelLayer = new Layer("data-model");
    const orderEntity = new Element({
      id: "data-model-entity-order",
      type: "entity",
      name: "Order",
      description: "Order data entity",
      properties: {
        properties: {
          id: { type: "string", description: "Order ID" },
          customerId: { type: "string", description: "Customer ID" },
          amount: { type: "number", description: "Order amount" },
          status: {
            type: "string",
            enum: ["pending", "processing", "completed", "cancelled"],
          },
        },
        required: ["id", "customerId", "amount"],
      },
    });
    dataModelLayer.addElement(orderEntity);
    model.addLayer(dataModelLayer);

    // Save model to disk
    await model.saveManifest();
    await model.saveLayer("motivation");
    await model.saveLayer("business");
    await model.saveLayer("api");
    await model.saveLayer("data-model");
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

  it("should successfully load and export model in archimate format", async () => {
    const loadedModel = await Model.load(testDir);

    // Verify model loaded correctly
    expect(loadedModel.manifest.name).toBe("Integration Test Model");
    expect(loadedModel.getLayerNames().length).toBeGreaterThan(0);

    // Export to ArchiMate
    const { ArchiMateExporter } = await import("@/export/archimate-exporter");
    const exporter = new ArchiMateExporter();
    const result = await exporter.export(loadedModel, {
      layers: ["motivation", "business"],
    });

    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    expect(result.includes("<?xml")).toBe(true);
    expect(result.includes("Integration Test Model")).toBe(true);
  });

  it("should successfully export model in openapi format", async () => {
    const loadedModel = await Model.load(testDir);

    const { OpenAPIExporter } = await import("@/export/openapi-exporter");
    const exporter = new OpenAPIExporter();
    const result = await exporter.export(loadedModel, { layers: ["api"] });

    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);

    const spec = JSON.parse(result);
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.info.title).toBe("Integration Test Model");
    expect(spec.paths).toBeDefined();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });

  it("should successfully export model in json-schema format", async () => {
    const loadedModel = await Model.load(testDir);

    const { JsonSchemaExporter } = await import("@/export/json-schema-exporter");
    const exporter = new JsonSchemaExporter();
    const result = await exporter.export(loadedModel, {});

    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);

    const schema = JSON.parse(result);
    expect(schema.$schema).toContain("json-schema.org");
    expect(schema.definitions).toBeDefined();
    expect(Object.keys(schema.definitions).length).toBeGreaterThan(0);
  });

  it("should successfully export model in plantuml format", async () => {
    const loadedModel = await Model.load(testDir);

    const { PlantUMLExporter } = await import("@/export/plantuml-exporter");
    const exporter = new PlantUMLExporter();
    const result = await exporter.export(loadedModel, {
      layers: ["motivation", "business"],
    });

    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    expect(result.includes("@startuml")).toBe(true);
    expect(result.includes("@enduml")).toBe(true);
    expect(result.includes("package")).toBe(true);
  });

  it("should successfully export model in graphml format", async () => {
    const loadedModel = await Model.load(testDir);

    const { GraphMLExporter } = await import("@/export/graphml-exporter");
    const exporter = new GraphMLExporter();
    const result = await exporter.export(loadedModel, {
      layers: ["motivation", "business"],
    });

    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    expect(result.includes("<?xml")).toBe(true);
    expect(result.includes("<graphml")).toBe(true);
  });

  it("should successfully export model in markdown format", async () => {
    const loadedModel = await Model.load(testDir);

    const { MarkdownExporter } = await import("@/export/markdown-exporter");
    const exporter = new MarkdownExporter();
    const result = await exporter.export(loadedModel, {});

    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    expect(result.includes("# Integration Test Model")).toBe(true);
    expect(result.includes("## Layer:")).toBe(true);
  });

  it("should respect layer filters during export", async () => {
    const loadedModel = await Model.load(testDir);

    const { MarkdownExporter } = await import("@/export/markdown-exporter");
    const exporter = new MarkdownExporter();

    // Export only motivation layer
    const result = await exporter.export(loadedModel, {
      layers: ["motivation"],
    });

    expect(result.includes("Motivation")).toBe(true);
    expect(result.includes("Business")).toBe(false);
  });

  it("should handle models with no elements in a layer", async () => {
    const loadedModel = await Model.load(testDir);

    const { MarkdownExporter } = await import("@/export/markdown-exporter");
    const exporter = new MarkdownExporter();

    // Add an empty layer
    const emptyLayer = new Layer("ux");
    loadedModel.addLayer(emptyLayer);

    // Should not crash when exporting empty layer
    const result = await exporter.export(loadedModel, { layers: ["ux"] });
    expect(result).toBeDefined();
  });

  it("should export all supported formats without errors", async () => {
    const loadedModel = await Model.load(testDir);

    const {
      ExportManager,
      ArchiMateExporter,
      OpenAPIExporter,
      JsonSchemaExporter,
      PlantUMLExporter,
      GraphMLExporter,
      MarkdownExporter,
    } = await import("@/export/index");

    const manager = new ExportManager();
    manager.register("archimate", new ArchiMateExporter(), {
      description: "ArchiMate",
      mimeType: "application/xml",
    });
    manager.register("openapi", new OpenAPIExporter(), {
      description: "OpenAPI",
      mimeType: "application/json",
    });
    manager.register("json-schema", new JsonSchemaExporter(), {
      description: "JSON Schema",
      mimeType: "application/json",
    });
    manager.register("plantuml", new PlantUMLExporter(), {
      description: "PlantUML",
      mimeType: "text/plain",
    });
    manager.register("graphml", new GraphMLExporter(), {
      description: "GraphML",
      mimeType: "application/xml",
    });
    manager.register("markdown", new MarkdownExporter(), {
      description: "Markdown",
      mimeType: "text/markdown",
    });

    const formats = manager.listFormats();
    expect(formats.length).toBe(6);

    for (const format of formats) {
      const result = await manager.export(loadedModel, format, {});
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("should export archimate with --layers filter", async () => {
    const loadedModel = await Model.load(testDir);

    const { ArchiMateExporter } = await import("@/export/archimate-exporter");
    const exporter = new ArchiMateExporter();
    const result = await exporter.export(loadedModel, {
      layers: ["motivation"],
    });

    expect(result).toBeDefined();
    expect(result.includes("<?xml")).toBe(true);
  });

  it("should export openapi with layer filter", async () => {
    const loadedModel = await Model.load(testDir);

    const { OpenAPIExporter } = await import("@/export/openapi-exporter");
    const exporter = new OpenAPIExporter();
    const result = await exporter.export(loadedModel, {
      layers: ["api"],
    });

    expect(result).toBeDefined();
    const spec = JSON.parse(result);
    expect(spec.paths).toBeDefined();
    expect(spec.paths["/api/orders"]).toBeDefined();
    expect(spec.paths["/api/orders"].post).toBeDefined();
    expect(spec.paths["/api/orders"].post.operationId).toBe("api-endpoint-create-order");
    expect(spec.paths["/api/orders"].post.responses["201"]).toBeDefined();
  });

  it("should export plantuml with multiple layer filters", async () => {
    const loadedModel = await Model.load(testDir);

    const { PlantUMLExporter } = await import("@/export/plantuml-exporter");
    const exporter = new PlantUMLExporter();
    const result = await exporter.export(loadedModel, {
      layers: ["motivation", "business", "api"],
    });

    expect(result).toBeDefined();
    expect(result.includes("@startuml")).toBe(true);
    expect(result.includes("@enduml")).toBe(true);
  });

  it("should exclude filtered-out layers in export", async () => {
    const loadedModel = await Model.load(testDir);

    const { MarkdownExporter } = await import("@/export/markdown-exporter");
    const exporter = new MarkdownExporter();
    const result = await exporter.export(loadedModel, {
      layers: ["api"],
    });

    expect(result.includes("API")).toBe(true);
    expect(result.includes("Data Model")).toBe(false);
  });

  it("should export graphml with filtered layers", async () => {
    const loadedModel = await Model.load(testDir);

    const { GraphMLExporter } = await import("@/export/graphml-exporter");
    const exporter = new GraphMLExporter();
    const result = await exporter.export(loadedModel, {
      layers: ["motivation", "business"],
    });

    expect(result).toBeDefined();
    expect(result.includes("<graphml")).toBe(true);
    expect(result.includes("</graphml>")).toBe(true);
  });

  it("should handle export with empty layer filter", async () => {
    const loadedModel = await Model.load(testDir);

    const { MarkdownExporter } = await import("@/export/markdown-exporter");
    const exporter = new MarkdownExporter();
    const result = await exporter.export(loadedModel, {
      layers: [],
    });

    expect(result).toBeDefined();
  });

  it("should handle export with non-existent layer in filter", async () => {
    const loadedModel = await Model.load(testDir);

    const { MarkdownExporter } = await import("@/export/markdown-exporter");
    const exporter = new MarkdownExporter();
    const result = await exporter.export(loadedModel, {
      layers: ["non-existent-layer"],
    });

    expect(result).toBeDefined();
  });

  it("should export jsonschema format correctly", async () => {
    const loadedModel = await Model.load(testDir);

    const { JsonSchemaExporter } = await import("@/export/json-schema-exporter");
    const exporter = new JsonSchemaExporter();
    const result = await exporter.export(loadedModel, {
      layers: ["data-model"],
    });

    expect(result).toBeDefined();
    const schema = JSON.parse(result);
    expect(schema.$schema).toBeDefined();
    expect(schema.$schema.includes("json-schema.org")).toBe(true);
    expect(schema.definitions).toBeDefined();
    expect(schema.definitions["data-model-entity-order"]).toBeDefined();
    expect(schema.definitions["data-model-entity-order"].properties.id.type).toBe("string");
  });
});
