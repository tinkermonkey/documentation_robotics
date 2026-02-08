import { describe, it, expect, beforeEach } from "bun:test";
import { JsonSchemaExporter } from "@/export/json-schema-exporter";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Manifest } from "@/core/manifest";

describe("JsonSchemaExporter", () => {
  let exporter: JsonSchemaExporter;
  let model: Model;

  beforeEach(() => {
    exporter = new JsonSchemaExporter();

    const manifest = new Manifest({
      name: "Test Data Model",
      version: "1.0.0",
      description: "Test data model",
    });

    model = new Model("/test", manifest);

    const dataModelLayer = new Layer("data-model");
    const entity = new Element({
      id: "data-model-entity-user",
      type: "entity",
      name: "User",
      description: "User entity",
      properties: {
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
        required: ["id", "name"],
      },
    });

    dataModelLayer.addElement(entity);
    model.addLayer(dataModelLayer);
  });

  it("should export valid JSON Schema", async () => {
    const output = await exporter.export(model, {});
    const schema = JSON.parse(output);

    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.definitions).toBeDefined();
  });

  it("should include source reference on entity definitions", async () => {
    const dataModelLayer = new Layer("data-model");
    const entity = new Element({
      id: "data-model-entity-customer",
      type: "entity",
      name: "Customer",
      layer: "07-data-model-layer",
      properties: {
        properties: {
          id: { type: "string" },
          email: { type: "string" },
        },
        "x-source-reference": {
          provenance: "extracted",
          locations: [
            {
              file: "src/models/customer.ts",
              symbol: "Customer",
            },
          ],
          repository: {
            url: "https://github.com/example/repo",
            commit: "abc123def456789012345678901234567890abcd",
          },
        },
      },
    });

    dataModelLayer.addElement(entity);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(dataModelLayer);

    const output = await exporter.export(testModel, {});
    const schema = JSON.parse(output);

    expect(schema.definitions["data-model-entity-customer"]["x-source-reference"]).toBeDefined();
    expect(schema.definitions["data-model-entity-customer"]["x-source-reference"].provenance).toBe(
      "extracted"
    );
    expect(
      schema.definitions["data-model-entity-customer"]["x-source-reference"].locations[0].file
    ).toBe("src/models/customer.ts");
    expect(
      schema.definitions["data-model-entity-customer"]["x-source-reference"].locations[0].symbol
    ).toBe("Customer");
  });

  it("should handle entities without source references", async () => {
    const output = await exporter.export(model, {});
    const schema = JSON.parse(output);

    expect(schema.definitions["data-model-entity-user"]).toBeDefined();
    expect(schema.definitions["data-model-entity-user"]["x-source-reference"]).toBeUndefined();
  });

  it("should handle source reference without repository context", async () => {
    const dataModelLayer = new Layer("data-model");
    const entity = new Element({
      id: "data-model-entity-product",
      type: "entity",
      name: "Product",
      layer: "07-data-model-layer",
      properties: {
        properties: {
          id: { type: "string" },
        },
        "x-source-reference": {
          provenance: "manual",
          locations: [
            {
              file: "src/models/product.ts",
            },
          ],
        },
      },
    });

    dataModelLayer.addElement(entity);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(dataModelLayer);

    const output = await exporter.export(testModel, {});
    const schema = JSON.parse(output);

    expect(schema.definitions["data-model-entity-product"]["x-source-reference"]).toBeDefined();
    expect(schema.definitions["data-model-entity-product"]["x-source-reference"].provenance).toBe(
      "manual"
    );
    expect(
      schema.definitions["data-model-entity-product"]["x-source-reference"].repository
    ).toBeUndefined();
  });

  it("should handle multiple entities with mixed source references", async () => {
    const dataModelLayer = new Layer("data-model");

    const entity1 = new Element({
      id: "data-model-entity-order",
      type: "entity",
      name: "Order",
      layer: "07-data-model-layer",
      properties: {
        properties: {
          id: { type: "string" },
        },
        "x-source-reference": {
          provenance: "extracted",
          locations: [{ file: "src/models/order.ts", symbol: "Order" }],
        },
      },
    });

    const entity2 = new Element({
      id: "data-model-entity-invoice",
      type: "entity",
      name: "Invoice",
      layer: "07-data-model-layer",
      properties: {
        properties: {
          id: { type: "string" },
        },
        // No source reference
      },
    });

    dataModelLayer.addElement(entity1);
    dataModelLayer.addElement(entity2);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(dataModelLayer);

    const output = await exporter.export(testModel, {});
    const schema = JSON.parse(output);

    expect(schema.definitions["data-model-entity-order"]["x-source-reference"]).toBeDefined();
    expect(schema.definitions["data-model-entity-invoice"]["x-source-reference"]).toBeUndefined();
  });

  it("should handle multiple source locations", async () => {
    const dataModelLayer = new Layer("data-model");
    const entity = new Element({
      id: "data-model-entity-complex",
      type: "entity",
      name: "Complex",
      layer: "07-data-model-layer",
      properties: {
        properties: {
          id: { type: "string" },
        },
        "x-source-reference": {
          provenance: "extracted",
          locations: [
            {
              file: "src/models/complex.ts",
              symbol: "ComplexBase",
            },
            {
              file: "src/models/complex-extended.ts",
              symbol: "ComplexExtended",
            },
          ],
        },
      },
    });

    dataModelLayer.addElement(entity);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(dataModelLayer);

    const output = await exporter.export(testModel, {});
    const schema = JSON.parse(output);

    const sourceRef = schema.definitions["data-model-entity-complex"]["x-source-reference"];
    expect(sourceRef.locations).toHaveLength(2);
    expect(sourceRef.locations[0].file).toBe("src/models/complex.ts");
    expect(sourceRef.locations[1].file).toBe("src/models/complex-extended.ts");
  });
});
