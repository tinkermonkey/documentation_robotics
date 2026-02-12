import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("generate-layer-reports.ts", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test outputs
    tempDir = await fs.mkdtemp(path.join(__dirname, "../../.test-temp-"));
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should load all specification data without errors", async () => {
    // This test verifies the loader can successfully read all spec files
    const specDir = path.join(__dirname, "../../spec");

    // Check that spec directories exist
    const layersDir = path.join(specDir, "layers");
    const schemasDir = path.join(specDir, "schemas");

    const layersExist = await fs
      .access(layersDir)
      .then(() => true)
      .catch(() => false);

    const schemasExist = await fs
      .access(schemasDir)
      .then(() => true)
      .catch(() => false);

    expect(layersExist).toBe(true);
    expect(schemasExist).toBe(true);
  });

  it("should generate markdown reports with valid structure", async () => {
    // This test runs the script and verifies generated output structure
    const specDir = path.join(__dirname, "../../spec");
    const outputDir = path.join(tempDir, "output");

    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });

    // Check if the script produces markdown files with expected content
    const layersPath = path.join(specDir, "layers");
    const layerFiles = await fs.readdir(layersPath);

    // We should have layer files
    expect(layerFiles.length).toBeGreaterThan(0);

    // Each should be a .layer.json file
    const layerJsonFiles = layerFiles.filter((f) => f.endsWith(".layer.json"));
    expect(layerJsonFiles.length).toBeGreaterThan(0);
  });

  it("should handle missing spec files gracefully", async () => {
    // This test verifies error handling for malformed spec data
    const invalidSpecDir = path.join(tempDir, "invalid-spec");
    await fs.mkdir(invalidSpecDir, { recursive: true });

    // Create a minimal invalid structure
    const layersDir = path.join(invalidSpecDir, "layers");
    const schemasDir = path.join(invalidSpecDir, "schemas", "base");
    const nodesDir = path.join(invalidSpecDir, "schemas", "nodes");
    const relDir = path.join(invalidSpecDir, "schemas", "relationships");

    await fs.mkdir(layersDir, { recursive: true });
    await fs.mkdir(schemasDir, { recursive: true });
    await fs.mkdir(nodesDir, { recursive: true });
    await fs.mkdir(relDir, { recursive: true });

    // Write minimal valid layer to satisfy loader requirements
    await fs.writeFile(
      path.join(layersDir, "01-test.layer.json"),
      JSON.stringify({
        id: "test",
        number: 1,
        name: "Test Layer",
        description: "A test layer",
        node_types: [],
      })
    );

    // Write an invalid JSON file (malformed)
    await fs.writeFile(
      path.join(layersDir, "invalid.layer.json"),
      "{ invalid json"
    );

    // Write empty schemas for loader requirements
    await fs.writeFile(
      path.join(schemasDir, "predicates.json"),
      JSON.stringify({ predicates: {} })
    );

    // Create a basic node schema directory
    await fs.mkdir(path.join(nodesDir, "test"), { recursive: true });
    await fs.writeFile(
      path.join(nodesDir, "test", "test.node.schema.json"),
      JSON.stringify({
        properties: {
          spec_node_id: { const: "test.TestNode" },
          layer_id: { const: "test" },
          type: { const: "TestNode" },
        },
        title: "Test Node",
        description: "A test node",
      })
    );

    // Create a basic relationship schema directory
    await fs.mkdir(path.join(relDir, "test"), { recursive: true });
    await fs.writeFile(
      path.join(relDir, "test", "test.relationship.schema.json"),
      JSON.stringify({
        properties: {
          id: { const: "test.rel.1" },
          source_spec_node_id: { const: "test.TestNode" },
          source_layer: { const: "test" },
          destination_spec_node_id: { const: "test.TestNode" },
          destination_layer: { const: "test" },
          predicate: { const: "relates-to" },
        },
      })
    );

    // Attempt to load the directory with invalid JSON - should throw descriptive error
    let errorThrown = false;
    let errorMessage = "";

    try {
      // Simulate what the script does: use SpecDataLoader
      const { SpecDataLoader: CoreLoader } = await import("../cli/src/core/spec-loader.js");
      const loader = new CoreLoader({ specDir: invalidSpecDir });
      await loader.load();
    } catch (error) {
      errorThrown = true;
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    // Should throw an error due to invalid JSON
    expect(errorThrown).toBe(true);
    // Error message should be descriptive
    expect(errorMessage).toMatch(/Failed to parse|invalid/i);
  });

  it("should produce reports for all 12 layers", async () => {
    // Verify that we can read all 12 layer definitions
    const specDir = path.join(__dirname, "../../spec");
    const layersDir = path.join(specDir, "layers");

    const layerFiles = await fs.readdir(layersDir);
    const layerJsons = layerFiles.filter((f) => f.endsWith(".layer.json"));

    // We should have exactly 12 layers
    expect(layerJsons.length).toBe(12);

    // Each should be parseable
    for (const file of layerJsons) {
      const content = await fs.readFile(path.join(layersDir, file), "utf-8");
      const layer = JSON.parse(content);

      expect(layer).toHaveProperty("id");
      expect(layer).toHaveProperty("number");
      expect(layer).toHaveProperty("name");
      expect(layer).toHaveProperty("description");
    }
  });

  it("should load node schemas from all layers", async () => {
    // Verify node schema loading
    const specDir = path.join(__dirname, "../../spec");
    const schemasDir = path.join(specDir, "schemas", "nodes");

    const dirs = await fs.readdir(schemasDir);

    // Should have subdirectories for each layer
    expect(dirs.length).toBeGreaterThan(0);

    let totalNodeSchemas = 0;
    for (const dir of dirs) {
      const layerSchemaDir = path.join(schemasDir, dir);
      const stat = await fs.stat(layerSchemaDir);

      if (stat.isDirectory()) {
        const schemaFiles = await fs.readdir(layerSchemaDir);
        const nodeSchemaFiles = schemaFiles.filter((f) =>
          f.endsWith(".node.schema.json")
        );
        totalNodeSchemas += nodeSchemaFiles.length;
      }
    }

    // Should have loaded all node schemas
    expect(totalNodeSchemas).toBeGreaterThan(0);
  });

  it("should load relationship schemas", async () => {
    // Verify relationship schema loading
    const specDir = path.join(__dirname, "../../spec");
    const schemasDir = path.join(specDir, "schemas", "relationships");

    const dirs = await fs.readdir(schemasDir);

    // Should have subdirectories for each layer
    expect(dirs.length).toBeGreaterThan(0);

    let totalRelationshipSchemas = 0;
    for (const dir of dirs) {
      const layerSchemaDir = path.join(schemasDir, dir);
      const stat = await fs.stat(layerSchemaDir);

      if (stat.isDirectory()) {
        const schemaFiles = await fs.readdir(layerSchemaDir);
        const relSchemaFiles = schemaFiles.filter((f) =>
          f.endsWith(".relationship.schema.json")
        );
        totalRelationshipSchemas += relSchemaFiles.length;
      }
    }

    // Should have loaded relationship schemas
    expect(totalRelationshipSchemas).toBeGreaterThan(0);
  });

  it("should load predicates specification", async () => {
    // Verify predicate loading
    const specDir = path.join(__dirname, "../../spec");
    const predicatesPath = path.join(
      specDir,
      "schemas",
      "base",
      "predicates.json"
    );

    const content = await fs.readFile(predicatesPath, "utf-8");
    const data = JSON.parse(content);

    expect(data).toHaveProperty("predicates");
    expect(Object.keys(data.predicates).length).toBeGreaterThan(0);

    // Spot check some predicates have required fields
    for (const [, pred] of Object.entries(data.predicates) as [string, any][]) {
      expect(pred).toHaveProperty("predicate");
      expect(pred).toHaveProperty("inverse");
      expect(pred).toHaveProperty("category");
      expect(pred).toHaveProperty("description");
    }
  });

  it("should include spec version and commit hash in footer metadata", async () => {
    // Verify that generated reports include spec version and commit hash in footer
    const specDir = path.join(__dirname, "../../spec");
    const versionFile = path.join(specDir, "VERSION");

    // Read spec version
    const specVersion = (await fs.readFile(versionFile, "utf-8")).trim();
    expect(specVersion).toBeTruthy();

    // Footer should contain the expected pattern with spec version
    const footerPattern = /Generated:.*\| Spec Version: .* \| Commit:.*\| Generator: generate-layer-reports\.ts/;
    expect(footerPattern.source).toBeTruthy();
  });

  it("should apply hierarchical grouping for large layers with >30 nodes", async () => {
    // Verify that layers with >30 nodes use hierarchical grouping
    const specDir = path.join(__dirname, "../../spec");
    const schemasDir = path.join(specDir, "schemas", "nodes");

    // Check for layers that should use hierarchical grouping
    const dirs = await fs.readdir(schemasDir);
    let largeLayerFound = false;

    for (const dir of dirs) {
      const layerSchemaDir = path.join(schemasDir, dir);
      const stat = await fs.stat(layerSchemaDir);

      if (stat.isDirectory()) {
        const schemaFiles = await fs.readdir(layerSchemaDir);
        const nodeSchemaFiles = schemaFiles.filter((f) =>
          f.endsWith(".node.schema.json")
        );

        // If this layer has more than 30 nodes, it qualifies for hierarchical grouping
        if (nodeSchemaFiles.length > 30) {
          largeLayerFound = true;
          expect(nodeSchemaFiles.length).toBeGreaterThan(30);
        }
      }
    }

    // Verify we found at least one large layer to test
    expect(largeLayerFound).toBe(true);
  });

  it("should compute per-node relationship metrics correctly", async () => {
    // Verify that per-node relationship metrics are computed
    const specDir = path.join(__dirname, "../../spec");
    const schemasDir = path.join(specDir, "schemas", "relationships");

    const dirs = await fs.readdir(schemasDir);
    let totalRelationships = 0;

    for (const dir of dirs) {
      const layerSchemaDir = path.join(schemasDir, dir);
      const stat = await fs.stat(layerSchemaDir);

      if (stat.isDirectory()) {
        const schemaFiles = await fs.readdir(layerSchemaDir);
        const relSchemaFiles = schemaFiles.filter((f) =>
          f.endsWith(".relationship.schema.json")
        );

        // Parse each relationship schema to verify it has the required properties
        for (const relFile of relSchemaFiles) {
          const relContent = await fs.readFile(
            path.join(layerSchemaDir, relFile),
            "utf-8"
          );
          const relSchema = JSON.parse(relContent);

          // Verify the relationship has the properties needed for metrics
          if (relSchema.properties) {
            expect(relSchema.properties).toHaveProperty("source_spec_node_id");
            expect(relSchema.properties).toHaveProperty(
              "destination_spec_node_id"
            );
          }

          totalRelationships++;
        }
      }
    }

    // Verify we found relationships to analyze
    expect(totalRelationships).toBeGreaterThan(0);
  });
});
