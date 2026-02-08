import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "../../src/core/model.js";
import { ArchiMateExporter } from "../../src/export/archimate-exporter.js";
import { OpenAPIExporter } from "../../src/export/openapi-exporter.js";
import { JsonSchemaExporter } from "../../src/export/json-schema-exporter.js";
import { PlantUMLExporter } from "../../src/export/plantuml-exporter.js";
import { ArchiMateImporter } from "../../src/import/archimate-importer.js";
import { OpenAPIImporter } from "../../src/import/openapi-importer.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import type { GraphNode, GraphEdge } from "../../src/core/graph-model.js";

describe("Export/Import Adapters - Graph-Based Queries", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let model: Model;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    testDir = workdir.path;
    cleanup = workdir.cleanup;

    model = await Model.load(testDir);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("ArchiMate Exporter - Graph-Based Query", () => {
    test("exports ArchiMate XML using graph model queries", async () => {
      const exporter = new ArchiMateExporter();

      // Create test nodes
      const goalNode: GraphNode = {
        id: "motivation.goal.customer-satisfaction",
        layer: "motivation",
        type: "goal",
        name: "Customer Satisfaction",
        description: "Achieve high customer satisfaction",
        properties: { priority: "high" },
      };

      const requirementNode: GraphNode = {
        id: "motivation.requirement.performance-sla",
        layer: "motivation",
        type: "requirement",
        name: "Performance SLA",
        description: "Must respond within 100ms",
        properties: { slaThreshold: 100 },
      };

      model.graph.addNode(goalNode);
      model.graph.addNode(requirementNode);

      // Create edge between nodes
      const edge: GraphEdge = {
        id: "goal-requires-req",
        source: goalNode.id,
        destination: requirementNode.id,
        predicate: "realizes",
        properties: {},
      };
      model.graph.addEdge(edge);

      // Export
      const result = await exporter.export(model, { layers: ["motivation"] });

      // Verify XML structure
      expect(result).toContain('<?xml version="1.0"');
      expect(result).toContain('<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"');
      expect(result).toContain("Customer Satisfaction");
      expect(result).toContain("Performance SLA");
      expect(result).toContain("realizes");
      expect(result).toContain('identifier="goal-requires-req"');
    });

    test("filters nodes by layer in ArchiMate export", async () => {
      const exporter = new ArchiMateExporter();

      // Add nodes to multiple layers
      const motivationNode: GraphNode = {
        id: "motivation.goal.test",
        layer: "motivation",
        type: "goal",
        name: "Test Goal",
        properties: {},
      };

      const businessNode: GraphNode = {
        id: "business.service.test",
        layer: "business",
        type: "service",
        name: "Test Service",
        properties: {},
      };

      model.graph.addNode(motivationNode);
      model.graph.addNode(businessNode);

      // Export only motivation layer
      const result = await exporter.export(model, { layers: ["motivation"] });

      expect(result).toContain("Test Goal");
      expect(result).not.toContain("Test Service");
    });
  });

  describe("OpenAPI Exporter - Graph-Based Query", () => {
    test("exports OpenAPI using graph model queries for layer 6", async () => {
      const exporter = new OpenAPIExporter();

      // Create API document node
      const docNode: GraphNode = {
        id: "api.openapi-document.root",
        layer: "api",
        type: "openapi-document",
        name: "Test API",
        description: "Test API specification",
        properties: {
          version: "1.0.0",
          servers: [{ url: "https://api.example.com" }],
        },
      };

      // Create endpoint node
      const endpointNode: GraphNode = {
        id: "api.endpoint.get-users",
        layer: "api",
        type: "endpoint",
        name: "Get Users",
        description: "Retrieve list of users",
        properties: {
          method: "get",
          path: "/users",
          responses: { "200": { description: "Success" } },
        },
      };

      model.graph.addNode(docNode);
      model.graph.addNode(endpointNode);

      // Export
      const result = await exporter.export(model);
      const spec = JSON.parse(result);

      expect(spec.openapi).toBe("3.0.0");
      expect(spec.info.title).toBe("Test API");
      expect(spec.paths?.["/users"]?.get).toBeDefined();
      expect(spec.paths?.["/users"]?.get.summary).toBe("Get Users");
    });
  });

  describe("JSON Schema Exporter - Graph-Based Query", () => {
    test("exports JSON Schema using graph model queries for layer 7", async () => {
      const exporter = new JsonSchemaExporter();

      // Create entity node
      const entityNode: GraphNode = {
        id: "data-model.entity.user",
        layer: "data-model",
        type: "entity",
        name: "User",
        description: "A user entity",
        properties: {
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            email: { type: "string" },
          },
          required: ["id", "name"],
          additionalProperties: false,
        },
      };

      model.graph.addNode(entityNode);

      // Export
      const result = await exporter.export(model);
      const schema = JSON.parse(result);

      expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(schema.definitions?.["data-model.entity.user"]).toBeDefined();
      expect(schema.definitions?.["data-model.entity.user"].properties).toBeDefined();
      expect(schema.definitions?.["data-model.entity.user"].required).toContain("id");
    });
  });

  describe("PlantUML Exporter - Graph-Based Query", () => {
    test("exports PlantUML diagram using graph model queries", async () => {
      const exporter = new PlantUMLExporter();

      // Create component node
      const componentNode: GraphNode = {
        id: "application.component.user-service",
        layer: "application",
        type: "component",
        name: "User Service",
        description: "Manages user operations",
        properties: {},
      };

      model.graph.addNode(componentNode);

      // Export
      const result = await exporter.export(model, { layers: ["application"] });

      expect(result).toContain("@startuml");
      expect(result).toContain("@enduml");
      expect(result).toContain("User Service");
      expect(result).toContain("application");
    });
  });

  describe("ArchiMate Importer - XML to Graph", () => {
    test("imports ArchiMate XML into graph model", async () => {
      const importer = new ArchiMateImporter();

      const xmlData = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <elements>
    <element identifier="goal-1" xsi:type="Goal">
      <name>Improve Performance</name>
      <documentation>Reduce response time</documentation>
    </element>
    <element identifier="req-1" xsi:type="Requirement">
      <name>Response Time SLA</name>
    </element>
  </elements>
  <relationships>
    <relationship identifier="rel-1" source="goal-1" target="req-1">
      <name>realizes</name>
    </relationship>
  </relationships>
</model>`;

      const result = await importer.import(xmlData, model);

      expect(result.success).toBe(true);
      expect(result.nodesAdded).toBeGreaterThan(0);
      expect(result.edgesAdded).toBeGreaterThan(0);

      // Verify nodes were added to graph
      const goal = model.graph.getNode("goal-1");
      expect(goal).toBeDefined();
      expect(goal?.name).toBe("Improve Performance");
      expect(goal?.layer).toBe("motivation");

      const req = model.graph.getNode("req-1");
      expect(req).toBeDefined();
      expect(req?.layer).toBe("motivation");

      // Verify edge was added
      const edges = model.graph.getEdgesFrom("goal-1");
      expect(edges.length).toBeGreaterThan(0);
      expect(edges[0].predicate).toBe("realizes");
    });

    test("handles invalid XML gracefully", async () => {
      const importer = new ArchiMateImporter();

      const invalidXml = "<invalid>not a valid archimate document</invalid>";

      const result = await importer.import(invalidXml, model);

      expect(result.success).toBe(false);
      expect(result.errorsCount).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("OpenAPI Importer - JSON to Graph", () => {
    test("imports OpenAPI JSON specification into graph model", async () => {
      const importer = new OpenAPIImporter();

      const jsonData = JSON.stringify({
        openapi: "3.0.0",
        info: {
          title: "Sample API",
          version: "1.0.0",
          description: "A sample API",
        },
        paths: {
          "/users": {
            get: {
              summary: "List users",
              operationId: "listUsers",
              responses: {
                "200": { description: "Success" },
              },
            },
          },
        },
        components: {
          schemas: {
            User: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
              },
            },
          },
        },
      });

      const result = await importer.import(jsonData, model);

      expect(result.success).toBe(true);
      expect(result.nodesAdded).toBeGreaterThan(0);

      // Verify document node was created
      const docNode = model.graph.getNode("api.openapi-document.root");
      expect(docNode).toBeDefined();
      expect(docNode?.name).toBe("Sample API");

      // Verify endpoint was created
      const endpointNode = Array.from(model.graph.nodes.values()).find(
        (n) => n.type === "endpoint" && n.name.includes("users")
      );
      expect(endpointNode).toBeDefined();

      // Verify schema was created
      const schemaNode = Array.from(model.graph.nodes.values()).find(
        (n) => n.type === "schema" && n.name === "User"
      );
      expect(schemaNode).toBeDefined();
    });

    test("handles invalid JSON gracefully", async () => {
      const importer = new OpenAPIImporter();

      const invalidJson = "{ invalid json }";

      const result = await importer.import(invalidJson, model);

      expect(result.success).toBe(false);
      expect(result.errorsCount).toBeGreaterThan(0);
    });
  });

  describe("Round-Trip Tests - Export then Import", () => {
    test("ArchiMate export can be imported back into model", async () => {
      const exporter = new ArchiMateExporter();
      const importer = new ArchiMateImporter();

      // Create initial data
      const goalNode: GraphNode = {
        id: "motivation.goal.efficiency",
        layer: "motivation",
        type: "goal",
        name: "Operational Efficiency",
        properties: {},
      };

      model.graph.addNode(goalNode);

      // Export
      const exported = await exporter.export(model, { layers: ["motivation"] });

      // Create new model and import
      const newModel = new Model(testDir, model.manifest);
      const importResult = await importer.import(exported, newModel);

      expect(importResult.success).toBe(true);
      expect(importResult.nodesAdded).toBeGreaterThan(0);

      // Verify the reimported data
      const reimportedGoal = newModel.graph.getNode("motivation.goal.efficiency");
      expect(reimportedGoal).toBeDefined();
      expect(reimportedGoal?.name).toBe("Operational Efficiency");
    });

    test("OpenAPI export can be imported back into model", async () => {
      const exporter = new OpenAPIExporter();
      const importer = new OpenAPIImporter();

      // Create initial API structure
      const docNode: GraphNode = {
        id: "api.openapi-document.root",
        layer: "api",
        type: "openapi-document",
        name: "Test API",
        properties: { version: "1.0.0" },
      };

      const endpointNode: GraphNode = {
        id: "api.endpoint.list-items",
        layer: "api",
        type: "endpoint",
        name: "List Items",
        properties: {
          method: "GET",
          path: "/items",
          responses: { "200": { description: "OK" } },
        },
      };

      model.graph.addNode(docNode);
      model.graph.addNode(endpointNode);

      // Export
      const exported = await exporter.export(model);

      // Create new model and import
      const newModel = new Model(testDir, model.manifest);
      const importResult = await importer.import(exported, newModel);

      expect(importResult.success).toBe(true);
      expect(importResult.nodesAdded).toBeGreaterThan(0);

      // Verify endpoint was reimported
      const reimportedEndpoint = Array.from(newModel.graph.nodes.values()).find(
        (n) => n.type === "endpoint"
      );
      expect(reimportedEndpoint).toBeDefined();
      expect(reimportedEndpoint?.name).toContain("Items");
    });
  });

  describe("Backward Compatibility", () => {
    test("exports maintain structure and content from pre-refactoring", async () => {
      const exporter = new ArchiMateExporter();

      // Create test data
      const node: GraphNode = {
        id: "motivation.goal.test-backward-compat",
        layer: "motivation",
        type: "goal",
        name: "Test Goal",
        description: "Testing backward compatibility",
        properties: { source: "legacy-system" },
      };

      model.graph.addNode(node);

      const result = await exporter.export(model);

      // Verify all critical XML elements are present
      expect(result).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(result).toContain('<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"');
      expect(result).toContain("<elements>");
      expect(result).toContain("<relationships>");
      expect(result).toContain("Test Goal");
      expect(result).toContain("Testing backward compatibility");
    });

    test("OpenAPI export maintains required fields and structure", async () => {
      const exporter = new OpenAPIExporter();

      const docNode: GraphNode = {
        id: "api.openapi-document.root",
        layer: "api",
        type: "openapi-document",
        name: "Backward Compat API",
        properties: { version: "2.0.0" },
      };

      model.graph.addNode(docNode);

      const result = await exporter.export(model);
      const spec = JSON.parse(result);

      // Verify required OpenAPI 3.0 structure
      expect(spec.openapi).toBeDefined();
      expect(spec.info).toBeDefined();
      expect(spec.paths).toBeDefined();
    });
  });
});
