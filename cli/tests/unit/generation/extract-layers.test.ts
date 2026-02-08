import { describe, test, expect, beforeAll } from "bun:test";
import path from "path";
import fs from "fs/promises";

describe("Layer Extraction", () => {
  let schemasDir: string;

  beforeAll(() => {
    schemasDir = path.resolve(path.join(__dirname, "..", "..", "..", "..", "spec", "schemas"));
  });

  test("should load motivation layer schema", async () => {
    const schemaPath = path.join(schemasDir, "01-motivation-layer.schema.json");
    const content = await fs.readFile(schemaPath, "utf-8");
    const schema = JSON.parse(content);

    expect(schema.layerMetadata).toBeDefined();
    expect(schema.layerMetadata.layerId).toBe("01-motivation-layer");
    expect(schema.definitions).toBeDefined();
  });

  test("should extract element types from layer schema", async () => {
    const schemaPath = path.join(schemasDir, "01-motivation-layer.schema.json");
    const content = await fs.readFile(schemaPath, "utf-8");
    const schema = JSON.parse(content);

    const elementTypes = Object.keys(schema.definitions || {});
    expect(elementTypes.length).toBeGreaterThan(0);
    expect(elementTypes).toContain("Goal");
    expect(elementTypes).toContain("Stakeholder");
  });

  test("should identify all 12 layer schemas", async () => {
    const layerFiles = [
      "01-motivation-layer.schema.json",
      "02-business-layer.schema.json",
      "03-security-layer.schema.json",
      "04-application-layer.schema.json",
      "05-technology-layer.schema.json",
      "06-api-layer.schema.json",
      "07-data-model-layer.schema.json",
      "08-data-store-layer.schema.json",
      "09-ux-layer.schema.json",
      "10-navigation-layer.schema.json",
      "11-apm-observability-layer.schema.json",
      "12-testing-layer.schema.json",
    ];

    for (const file of layerFiles) {
      const filePath = path.join(schemasDir, file);
      const stats = await fs.stat(filePath);
      expect(stats.isFile()).toBe(true);
    }
  });

  test("should extract layer metadata from all layers", async () => {
    const layerFiles = [
      "01-motivation-layer.schema.json",
      "02-business-layer.schema.json",
      "03-security-layer.schema.json",
    ];

    for (const file of layerFiles) {
      const schemaPath = path.join(schemasDir, file);
      const content = await fs.readFile(schemaPath, "utf-8");
      const schema = JSON.parse(content);

      expect(schema.layerMetadata).toBeDefined();
      expect(schema.layerMetadata.layerId).toBeDefined();
      expect(schema.layerMetadata.catalogVersion).toBeDefined();
    }
  });

  test("should have intraLayerRelationships defined", async () => {
    const schemaPath = path.join(schemasDir, "01-motivation-layer.schema.json");
    const content = await fs.readFile(schemaPath, "utf-8");
    const schema = JSON.parse(content);

    expect(schema.intraLayerRelationships).toBeDefined();
    expect(schema.intraLayerRelationships.allowed).toBeDefined();
    expect(Array.isArray(schema.intraLayerRelationships.allowed)).toBe(true);
  });
});
