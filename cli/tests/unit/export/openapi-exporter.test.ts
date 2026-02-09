import { describe, it, expect, beforeEach } from "bun:test";
import { OpenAPIExporter } from "@/export/openapi-exporter";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Manifest } from "@/core/manifest";

describe("OpenAPIExporter", () => {
  let exporter: OpenAPIExporter;
  let model: Model;

  beforeEach(() => {
    exporter = new OpenAPIExporter();

    const manifest = new Manifest({
      name: "Test API",
      version: "1.0.0",
      description: "Test API description",
    });

    model = new Model("/test", manifest);

    const apiLayer = new Layer("api");
    const endpoint = new Element({
      id: "api-endpoint-get-users",
      type: "endpoint",
      name: "Get Users",
      description: "Retrieve list of users",
      properties: {
        path: "/users",
        method: "GET",
        responses: {
          "200": {
            description: "Successful response",
          },
        },
      },
    });

    apiLayer.addElement(endpoint);
    model.addLayer(apiLayer);
  });

  it("should export valid OpenAPI 3.0 spec", async () => {
    const output = await exporter.export(model, {});
    const spec = JSON.parse(output);

    expect(spec.openapi).toBe("3.0.0");
    expect(spec.info).toBeDefined();
    expect(spec.paths).toBeDefined();
  });

  it("should include source reference on operations", async () => {
    const apiLayer = new Layer("api");
    const endpoint = new Element({
      id: "api-endpoint-create-user",
      type: "endpoint",
      name: "Create User",
      properties: {
        path: "/users",
        method: "POST",
        "x-source-reference": {
          provenance: "extracted",
          locations: [
            {
              file: "src/api/users.ts",
              symbol: "createUser",
            },
          ],
          repository: {
            url: "https://github.com/example/repo",
            commit: "abc123def456789012345678901234567890abcd",
          },
        },
      },
    });

    apiLayer.addElement(endpoint);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(apiLayer);

    const output = await exporter.export(testModel, {});
    const spec = JSON.parse(output);

    expect(spec.paths["/users"].post["x-source-reference"]).toBeDefined();
    expect(spec.paths["/users"].post["x-source-reference"].provenance).toBe("extracted");
    expect(spec.paths["/users"].post["x-source-reference"].locations[0].file).toBe(
      "src/api/users.ts"
    );
    expect(spec.paths["/users"].post["x-source-reference"].locations[0].symbol).toBe("createUser");
  });

  it("should include source reference on path items", async () => {
    const apiLayer = new Layer("api");
    const endpoint = new Element({
      id: "api-endpoint-get-users",
      type: "endpoint",
      name: "Get Users",
      properties: {
        path: "/users",
        method: "GET",
        "x-source-reference": {
          provenance: "manual",
          locations: [
            {
              file: "src/api/users.ts",
            },
          ],
        },
      },
    });

    apiLayer.addElement(endpoint);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(apiLayer);

    const output = await exporter.export(testModel, {});
    const spec = JSON.parse(output);

    expect(spec.paths["/users"]["x-source-reference"]).toBeDefined();
    expect(spec.paths["/users"]["x-source-reference"].provenance).toBe("manual");
  });

  it("should handle endpoints without source references", async () => {
    const output = await exporter.export(model, {});
    const spec = JSON.parse(output);

    expect(spec.paths["/users"]).toBeDefined();
    expect(spec.paths["/users"].get).toBeDefined();
    // Should not have x-source-reference when not present
    expect(spec.paths["/users"].get["x-source-reference"]).toBeUndefined();
  });

  it("should handle multiple endpoints with mixed source references", async () => {
    const apiLayer = new Layer("api");

    const endpoint1 = new Element({
      id: "api-endpoint-get-users",
      type: "endpoint",
      name: "Get Users",
      properties: {
        path: "/users",
        method: "GET",
        "x-source-reference": {
          provenance: "extracted",
          locations: [{ file: "src/api/users.ts", symbol: "getUsers" }],
        },
      },
    });

    const endpoint2 = new Element({
      id: "api-endpoint-post-users",
      type: "endpoint",
      name: "Create User",
      properties: {
        path: "/users",
        method: "POST",
        // No source reference
      },
    });

    apiLayer.addElement(endpoint1);
    apiLayer.addElement(endpoint2);

    const testModel = new Model("/test", model.manifest);
    testModel.addLayer(apiLayer);

    const output = await exporter.export(testModel, {});
    const spec = JSON.parse(output);

    expect(spec.paths["/users"].get["x-source-reference"]).toBeDefined();
    expect(spec.paths["/users"].post["x-source-reference"]).toBeUndefined();
  });
});
