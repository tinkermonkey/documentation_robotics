import { describe, test, expect, beforeAll } from "bun:test";
import path from "path";
import fs from "fs/promises";

describe("Node Type Extraction", () => {
  let specsDir: string;

  beforeAll(() => {
    specsDir = path.resolve(path.join(__dirname, "..", "..", "..", "..", "spec"));
  });

  test("should generate spec node schemas for motivation layer", async () => {
    const layerPath = path.join(specsDir, "schemas", "nodes", "motivation");
    const files = await fs.readdir(layerPath);
    const nodeFiles = files.filter((f) => f.endsWith(".node.schema.json"));

    expect(nodeFiles.length).toBeGreaterThan(0);
    expect(nodeFiles).toContain("goal.node.schema.json");
    expect(nodeFiles).toContain("stakeholder.node.schema.json");
  });

  test("should have valid per-type schema structure", async () => {
    const nodeFile = path.join(specsDir, "schemas", "nodes", "motivation", "goal.node.schema.json");
    const content = await fs.readFile(nodeFile, "utf-8");
    const schema = JSON.parse(content);

    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.allOf).toBeDefined();
    expect(schema.allOf[0].$ref).toContain("spec-node.schema.json");
    expect(schema.properties.spec_node_id.const).toBe("motivation.goal");
    expect(schema.properties.layer_id.const).toBe("motivation");
    expect(schema.properties.type.const).toBe("goal");
    expect(schema.title).toBe("Goal");
    expect(schema.description).toBeDefined();
    expect(schema.properties.attributes).toBeDefined();
  });

  test("should have type-specific attribute schemas", async () => {
    const nodeFile = path.join(specsDir, "schemas", "nodes", "motivation", "goal.node.schema.json");
    const content = await fs.readFile(nodeFile, "utf-8");
    const schema = JSON.parse(content);

    const attrs = schema.properties.attributes;
    expect(attrs.type).toBe("object");
    expect(attrs.additionalProperties).toBe(false);

    // Attributes should be JSON Schema properties
    if (attrs.properties) {
      for (const [, prop] of Object.entries(attrs.properties)) {
        const propDef = prop as Record<string, any>;
        expect(propDef.type).toBeDefined();
      }
    }
  });

  test("should generate node schemas for all 12 layers", async () => {
    const layerIds = [
      "motivation",
      "business",
      "security",
      "application",
      "technology",
      "api",
      "data-model",
      "data-store",
      "ux",
      "navigation",
      "apm",
      "testing",
    ];

    for (const layerId of layerIds) {
      const layerPath = path.join(specsDir, "schemas", "nodes", layerId);
      const stats = await fs.stat(layerPath);
      expect(stats.isDirectory()).toBe(true);

      const files = await fs.readdir(layerPath);
      const nodeFiles = files.filter((f) => f.endsWith(".node.schema.json"));
      expect(nodeFiles.length).toBeGreaterThan(0);
    }
  });

  test("should have consistent spec_node_id pattern", async () => {
    const nodeFile = path.join(specsDir, "schemas", "nodes", "motivation", "goal.node.schema.json");
    const content = await fs.readFile(nodeFile, "utf-8");
    const schema = JSON.parse(content);

    // spec_node_id const should follow pattern: {layer}.{element-type}
    expect(schema.properties.spec_node_id.const).toMatch(/^[a-z-]+\.[a-z][a-z0-9-]*$/);
  });
});
