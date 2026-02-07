import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "../../src/core/model.js";
import { GraphMigrationService, GraphFormat } from "../../src/export/graph-migration.js";
import { Neo4jMigrationService, Neo4jCypherGenerator } from "../../src/export/neo4j-migration.js";
import { LadybugMigrationService } from "../../src/export/ladybug-migration.js";
import type { GraphNode, GraphEdge } from "../../src/export/graph-migration.js";

describe("Graph Migration Services", () => {
  let testDir: string;
  let model: Model;

  beforeEach(async () => {
    // Create test model with sample data
    testDir = await import("../helpers/golden-copy.js").then(m =>
      m.createTestWorkdir().then(w => w.path)
    );

    model = await Model.load(testDir);
  });

  afterEach(async () => {
    // Cleanup handled by test infrastructure
  });

  describe("GraphMigrationService", () => {
    it("should initialize with default options", () => {
      const service = new GraphMigrationService(model);
      expect(service).toBeDefined();
    });

    it("should initialize with custom options", () => {
      const service = new GraphMigrationService(model, {
        includeProperties: false,
        includeMetadata: false,
        validateReferences: false,
      });
      expect(service).toBeDefined();
    });

    it("should extract layers from model", async () => {
      const service = new GraphMigrationService(model);
      // Test through migration which internally extracts layers
      const result = await service.migrate(GraphFormat.NEO4J);

      expect(result.success).toBe(true);
      expect(result.nodeCount).toBeGreaterThanOrEqual(0);
      expect(result.edgeCount).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.layersProcessed)).toBe(true);
    });

    it("should validate graph integrity", async () => {
      const service = new GraphMigrationService(model, {
        validateReferences: true,
      });

      const result = await service.migrate(GraphFormat.LADYBUG);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("should handle empty models gracefully", async () => {
      const emptyModel = new Model(testDir, model.manifest);
      const service = new GraphMigrationService(emptyModel);

      const result = await service.migrate(GraphFormat.NEO4J);

      expect(result.nodeCount).toBe(0);
      expect(result.edgeCount).toBe(0);
    });

    it("should track migration duration", async () => {
      const service = new GraphMigrationService(model);
      const result = await service.migrate(GraphFormat.GRAPHML);

      expect(result.duration).toBeGreaterThan(0);
      expect(typeof result.duration).toBe("number");
    });
  });

  describe("Neo4jMigrationService", () => {
    it("should initialize with default options", () => {
      const service = new Neo4jMigrationService();
      expect(service).toBeDefined();
    });

    it("should initialize with custom database settings", () => {
      const service = new Neo4jMigrationService({
        uri: "bolt://localhost:7687",
        username: "neo4j",
        password: "test-password",
        database: "test-db",
      });
      expect(service).toBeDefined();
    });

    it("should generate migration script for nodes and edges", async () => {
      const nodes: GraphNode[] = [
        {
          id: "node1",
          labels: ["Element", "API"],
          properties: { name: "Test Node", layer: "api", type: "endpoint" },
        },
        {
          id: "node2",
          labels: ["Element", "Data"],
          properties: { name: "Test Data", layer: "data-model", type: "entity" },
        },
      ];

      const edges: GraphEdge[] = [
        {
          id: "edge1",
          source: "node1",
          target: "node2",
          relationship: "REFERENCES_DATA",
        },
      ];

      const service = new Neo4jMigrationService();
      const result = await service.generateMigrationScript(nodes, edges);

      expect(result.success).toBe(true);
      expect(result.scriptContent).toBeDefined();
      expect(result.scriptContent?.length || 0).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate input arrays", async () => {
      const service = new Neo4jMigrationService();

      // Test with empty nodes
      const result = await service.generateMigrationScript([], []);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should generate batch creation scripts", async () => {
      const nodes: GraphNode[] = Array.from({ length: 5 }, (_, i) => ({
        id: `node${i}`,
        labels: ["Element"],
        properties: { name: `Node ${i}` },
      }));

      const edges: GraphEdge[] = [
        {
          id: "edge1",
          source: "node0",
          target: "node1",
          relationship: "LINKS_TO",
        },
      ];

      const service = new Neo4jMigrationService({ batchSize: 2 });
      const { nodeScripts, edgeScripts } = await service.generateBatchCreationScripts(nodes, edges);

      expect(nodeScripts.length).toBeGreaterThan(0);
      expect(edgeScripts.length).toBeGreaterThan(0);
    });

    it("should generate Neo4j import CSV files", () => {
      const nodes: GraphNode[] = [
        {
          id: "test-node",
          labels: ["Element", "API"],
          properties: { name: "Test API", layer: "api", type: "endpoint" },
        },
      ];

      const edges: GraphEdge[] = [
        {
          id: "test-edge",
          source: "test-node",
          target: "other-node",
          relationship: "REFERENCES",
        },
      ];

      const service = new Neo4jMigrationService();
      const { nodesCsv, edgesCsv } = service.generateImportCsvFiles(nodes, edges);

      expect(nodesCsv).toContain("id:ID");
      expect(nodesCsv).toContain("test-node");
      expect(edgesCsv).toContain(":START_ID");
      expect(edgesCsv).toContain("test-edge");
    });

    it("should escape CSV special characters", () => {
      const nodes: GraphNode[] = [
        {
          id: "test-node",
          labels: ["Element"],
          properties: {
            name: 'Test "Node" with, special, characters',
            layer: "api",
            type: "endpoint",
          },
        },
      ];

      const service = new Neo4jMigrationService();
      const { nodesCsv } = service.generateImportCsvFiles(nodes, []);

      // CSV should properly escape the quoted name
      expect(nodesCsv).toContain('Test ""Node"" with');
    });

    it("should generate Cypher script with options", async () => {
      const nodes: GraphNode[] = [
        {
          id: "node1",
          labels: ["Element"],
          properties: { name: "Test" },
        },
      ];

      const service = new Neo4jMigrationService({ dropExisting: true });
      const result = await service.generateMigrationScript(nodes, []);

      expect(result.scriptContent).toBeDefined();
      // Should include drop hints when dropExisting is true
      expect(result.scriptContent).toContain("DROP INDEX IF EXISTS");
    });
  });

  describe("Neo4jCypherGenerator", () => {
    it("should generate node creation script", () => {
      const nodes: GraphNode[] = [
        {
          id: "node1",
          labels: ["Element", "API"],
          properties: { name: "API Node", layer: "api" },
        },
      ];

      const script = Neo4jCypherGenerator.generateNodeCreationScript(nodes);

      expect(script).toContain("CREATE CONSTRAINT");
      expect(script).toContain("CREATE INDEX");
      expect(script).toContain("UNWIND");
      expect(script).toContain("$nodes");
    });

    it("should generate edge creation script", () => {
      const edges: GraphEdge[] = [
        {
          id: "edge1",
          source: "node1",
          target: "node2",
          relationship: "REFERENCES",
        },
      ];

      const script = Neo4jCypherGenerator.generateEdgeCreationScript(edges);

      expect(script).toContain("MATCH (source:Element");
      expect(script).toContain("MATCH (target:Element");
      expect(script).toContain("$edges");
      expect(script).toContain("REFERENCES");
    });

    it("should generate complete migration script", () => {
      const nodes: GraphNode[] = [
        {
          id: "node1",
          labels: ["Element"],
          properties: { name: "Test" },
        },
      ];

      const edges: GraphEdge[] = [
        {
          id: "edge1",
          source: "node1",
          target: "node1",
          relationship: "SELF_REFERENCE",
        },
      ];

      const script = Neo4jCypherGenerator.generateCompleteMigrationScript(
        nodes,
        edges,
        true
      );

      expect(script).toContain("// Neo4j Migration Script");
      expect(script).toContain("// Generated from Documentation Robotics");
      expect(script).toContain("CREATE CONSTRAINT");
      expect(script).toContain("// Example queries");
      expect(script).toContain("// Drop existing data");
    });

    it("should generate connection configuration", () => {
      const config = Neo4jCypherGenerator.generateConnectionConfig({
        uri: "bolt://custom:7687",
        username: "admin",
        password: "secret",
      });

      expect(config.uri).toBe("bolt://custom:7687");
      expect(config.username).toBe("admin");
      expect(config.password).toBe("secret");
    });
  });

  describe("LadybugMigrationService", () => {
    it("should initialize with default options", () => {
      const service = new LadybugMigrationService();
      expect(service).toBeDefined();
    });

    it("should initialize with custom options", () => {
      const service = new LadybugMigrationService({
        includeMetadata: false,
        compress: true,
      });
      expect(service).toBeDefined();
    });

    it("should generate LadybugDB document", async () => {
      const nodes: GraphNode[] = [
        {
          id: "node1",
          labels: ["Element", "API"],
          properties: { name: "Test API", layer: "api", type: "endpoint" },
        },
      ];

      const edges: GraphEdge[] = [];

      const service = new LadybugMigrationService();
      const doc = await service.generateLadybugDocument(
        nodes,
        edges,
        "Test Model",
        "Test Description"
      );

      expect(doc.version).toBeDefined();
      expect(doc.metadata.name).toBe("Test Model");
      expect(doc.metadata.description).toBe("Test Description");
      expect(doc.metadata.nodeCount).toBe(1);
      expect(doc.metadata.edgeCount).toBe(0);
      expect(doc.schema).toBeDefined();
      expect(doc.data.nodes).toHaveLength(1);
    });

    it("should infer schema from graph data", async () => {
      const nodes: GraphNode[] = [
        {
          id: "node1",
          labels: ["Element", "API"],
          properties: {
            name: "API",
            layer: "api",
            type: "endpoint",
            count: 42,
            active: true,
            created: new Date().toISOString(),
          },
        },
      ];

      const service = new LadybugMigrationService();
      const doc = await service.generateLadybugDocument(nodes, [], "Test");

      expect(doc.schema.nodeTypes.size).toBeGreaterThan(0);
      expect(doc.schema.indexes.length).toBeGreaterThan(0);
    });

    it("should serialize document to JSON", async () => {
      const nodes: GraphNode[] = [
        {
          id: "node1",
          labels: ["Element"],
          properties: { name: "Test" },
        },
      ];

      const service = new LadybugMigrationService();
      const doc = await service.generateLadybugDocument(nodes, [], "Test");
      const json = service.serializeToJson(doc);

      expect(typeof json).toBe("string");
      expect(json).toContain('"version"');
      expect(json).toContain('"metadata"');
      expect(json).toContain('"schema"');
      expect(json).toContain('"data"');

      // Should be valid JSON
      const parsed = JSON.parse(json);
      expect(parsed.metadata.nodeCount).toBe(1);
    });

    it("should serialize document to compact JSON", async () => {
      const nodes: GraphNode[] = [
        {
          id: "node1",
          labels: ["Element"],
          properties: { name: "Test" },
        },
      ];

      const service = new LadybugMigrationService();
      const doc = await service.generateLadybugDocument(nodes, [], "Test");
      const compact = service.serializeToCompactJson(doc);

      expect(typeof compact).toBe("string");
      // Compact JSON should not contain newlines
      expect(compact).not.toContain("\n");
      // But should still be valid JSON
      const parsed = JSON.parse(compact);
      expect(parsed.metadata.nodeCount).toBe(1);
    });

    it("should generate schema definition", async () => {
      const nodes: GraphNode[] = [
        {
          id: "node1",
          labels: ["Element", "API"],
          properties: { name: "Test", layer: "api", type: "endpoint" },
        },
      ];

      const service = new LadybugMigrationService();
      const doc = await service.generateLadybugDocument(nodes, [], "Test");
      const schema = service.generateSchemaDefinition(doc.schema);

      expect(schema).toContain("-- LadybugDB Schema Definition");
      expect(schema).toContain("CREATE NODE TYPE");
      expect(schema).toContain("CREATE INDEX");
    });

    it("should validate graph with no errors for valid data", () => {
      const nodes: GraphNode[] = [
        {
          id: "node1",
          labels: ["Element"],
          properties: { name: "Test" },
        },
        {
          id: "node2",
          labels: ["Element"],
          properties: { name: "Test 2" },
        },
      ];

      const edges: GraphEdge[] = [
        {
          id: "edge1",
          source: "node1",
          target: "node2",
          relationship: "LINKS_TO",
        },
      ];

      const service = new LadybugMigrationService();
      const validation = service.validateGraph(nodes, edges);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should detect dangling references in validation", () => {
      const nodes: GraphNode[] = [
        {
          id: "node1",
          labels: ["Element"],
          properties: { name: "Test" },
        },
      ];

      const edges: GraphEdge[] = [
        {
          id: "edge1",
          source: "node1",
          target: "nonexistent",
          relationship: "LINKS_TO",
        },
      ];

      const service = new LadybugMigrationService();
      const validation = service.validateGraph(nodes, edges);

      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors[0]).toContain("nonexistent");
    });

    it("should warn about isolated nodes", () => {
      const nodes: GraphNode[] = [
        {
          id: "node1",
          labels: ["Element"],
          properties: { name: "Connected" },
        },
        {
          id: "node2",
          labels: ["Element"],
          properties: { name: "Isolated" },
        },
      ];

      const edges: GraphEdge[] = [
        {
          id: "edge1",
          source: "node1",
          target: "node1",
          relationship: "SELF",
        },
      ];

      const service = new LadybugMigrationService();
      const validation = service.validateGraph(nodes, edges);

      expect(validation.isValid).toBe(true);
      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(validation.warnings[0]).toContain("isolated");
    });
  });

  describe("GraphMigrationService - Format Support", () => {
    it("should support NEO4J format", async () => {
      const service = new GraphMigrationService(model);
      const result = await service.migrate(GraphFormat.NEO4J);

      expect(result.format).toBe("neo4j");
      expect(result.success).toBe(true);
    });

    it("should support LADYBUG format", async () => {
      const service = new GraphMigrationService(model);
      const result = await service.migrate(GraphFormat.LADYBUG);

      expect(result.format).toBe("ladybug");
      expect(result.success).toBe(true);
    });

    it("should support GRAPHML format", async () => {
      const service = new GraphMigrationService(model);
      const result = await service.migrate(GraphFormat.GRAPHML);

      expect(result.format).toBe("graphml");
      expect(result.success).toBe(true);
    });

    it("should support CYPHER format", async () => {
      const service = new GraphMigrationService(model);
      const result = await service.migrate(GraphFormat.CYPHER);

      expect(result.format).toBe("cypher");
      expect(result.success).toBe(true);
    });

    it("should support GREMLIN format", async () => {
      const service = new GraphMigrationService(model);
      const result = await service.migrate(GraphFormat.GREMLIN);

      expect(result.format).toBe("gremlin");
      expect(result.success).toBe(true);
    });
  });
});
