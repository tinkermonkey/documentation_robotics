import { describe, test, expect, beforeAll } from "bun:test";
import path from "path";
import fs from "fs/promises";

describe("Node Type Extraction", () => {
  let specsDir: string;

  beforeAll(() => {
    specsDir = path.resolve(path.join(__dirname, "..", "..", "..", "..", "spec"));
  });

  test("should generate spec nodes for motivation layer", async () => {
    const layerPath = path.join(specsDir, "nodes", "motivation");
    const files = await fs.readdir(layerPath);
    const nodeFiles = files.filter((f) => f.endsWith(".node.json"));

    expect(nodeFiles.length).toBeGreaterThan(0);
    expect(nodeFiles).toContain("goal.node.json");
    expect(nodeFiles).toContain("stakeholder.node.json");
  });

  test("should have valid node structure", async () => {
    const nodeFile = path.join(specsDir, "nodes", "motivation", "goal.node.json");
    const content = await fs.readFile(nodeFile, "utf-8");
    const node = JSON.parse(content);

    expect(node.id).toBe("motivation.goal");
    expect(node.layer_id).toBe("motivation");
    expect(node.name).toBe("Goal");
    expect(node.description).toBeDefined();
    expect(node.attributes).toBeDefined();
    expect(Array.isArray(node.required_attributes)).toBe(true);
  });

  test("should extract attributes from node types", async () => {
    const nodeFile = path.join(specsDir, "nodes", "motivation", "goal.node.json");
    const content = await fs.readFile(nodeFile, "utf-8");
    const node = JSON.parse(content);

    expect(Object.keys(node.attributes).length).toBeGreaterThanOrEqual(0);
    // Attributes should have type and description
    for (const [, attr] of Object.entries(node.attributes)) {
      const attrDef = attr as Record<string, any>;
      expect(attrDef.type).toBeDefined();
      expect(attrDef.description).toBeDefined();
    }
  });

  test("should generate nodes for all 12 layers", async () => {
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
      const layerPath = path.join(specsDir, "nodes", layerId);
      const stats = await fs.stat(layerPath);
      expect(stats.isDirectory()).toBe(true);

      const files = await fs.readdir(layerPath);
      const nodeFiles = files.filter((f) => f.endsWith(".node.json"));
      expect(nodeFiles.length).toBeGreaterThan(0);
    }
  });

  test("should have consistent node id pattern", async () => {
    const nodeFile = path.join(specsDir, "nodes", "motivation", "goal.node.json");
    const content = await fs.readFile(nodeFile, "utf-8");
    const node = JSON.parse(content);

    // Node ID should follow pattern: {layer}.{element-type}
    expect(node.id).toMatch(/^[a-z-]+\.[a-z][a-z0-9-]*$/);
  });
});
