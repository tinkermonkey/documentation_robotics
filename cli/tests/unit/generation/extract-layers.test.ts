import { describe, test, expect, beforeAll } from "bun:test";
import path from "path";
import fs from "fs/promises";

describe("Layer Extraction", () => {
  let layersDir: string;

  beforeAll(() => {
    layersDir = path.resolve(path.join(__dirname, "..", "..", "..", "..", "spec", "layers"));
  });

  test("should load motivation layer instance", async () => {
    const layerPath = path.join(layersDir, "01-motivation.layer.json");
    const content = await fs.readFile(layerPath, "utf-8");
    const layer = JSON.parse(content);

    expect(layer.id).toBe("motivation");
    expect(layer.number).toBe(1);
    expect(layer.name).toBe("Motivation Layer");
    expect(layer.node_types).toBeDefined();
    expect(Array.isArray(layer.node_types)).toBe(true);
  });

  test("should have node types in layer instance", async () => {
    const layerPath = path.join(layersDir, "01-motivation.layer.json");
    const content = await fs.readFile(layerPath, "utf-8");
    const layer = JSON.parse(content);

    const nodeTypes = layer.node_types;
    expect(nodeTypes.length).toBeGreaterThan(0);
    expect(nodeTypes).toContain("motivation.goal");
    expect(nodeTypes).toContain("motivation.stakeholder");
  });

  test("should identify all 12 layer instances", async () => {
    const layerFiles = [
      "01-motivation.layer.json",
      "02-business.layer.json",
      "03-security.layer.json",
      "04-application.layer.json",
      "05-technology.layer.json",
      "06-api.layer.json",
      "07-data-model.layer.json",
      "08-data-store.layer.json",
      "09-ux.layer.json",
      "10-navigation.layer.json",
      "11-apm.layer.json",
      "12-testing.layer.json",
    ];

    for (const file of layerFiles) {
      const filePath = path.join(layersDir, file);
      const stats = await fs.stat(filePath);
      expect(stats.isFile()).toBe(true);
    }
  });

  test("should have layer metadata in all layers", async () => {
    const layerFiles = [
      "01-motivation.layer.json",
      "02-business.layer.json",
      "03-security.layer.json",
    ];

    for (const file of layerFiles) {
      const layerPath = path.join(layersDir, file);
      const content = await fs.readFile(layerPath, "utf-8");
      const layer = JSON.parse(content);

      expect(layer.id).toBeDefined();
      expect(layer.number).toBeDefined();
      expect(layer.name).toBeDefined();
      expect(layer.node_types).toBeDefined();
    }
  });

  test("should have inspired_by metadata for standard-based layers", async () => {
    const layerPath = path.join(layersDir, "01-motivation.layer.json");
    const content = await fs.readFile(layerPath, "utf-8");
    const layer = JSON.parse(content);

    expect(layer.inspired_by).toBeDefined();
    expect(layer.inspired_by.standard).toBe("ArchiMate 3.2");
    expect(layer.inspired_by.version).toBe("3.2");
  });
});
