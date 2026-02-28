import { describe, test, expect, beforeEach } from "bun:test";
import { OpenAPIImporter } from "../../src/import/openapi-importer.js";
import { Model } from "../../src/core/model.js";

describe("OpenAPIImporter", () => {
  let importer: OpenAPIImporter;
  let model: Model;

  beforeEach(async () => {
    importer = new OpenAPIImporter();
    model = new Model();
  });

  test("imports valid OpenAPI 3.0 specification", async () => {
    const spec = {
      openapi: "3.0.0",
      info: {
        title: "Pet Store API",
        version: "1.0.0",
      },
      paths: {
        "/pets": {
          get: {
            operationId: "listPets",
            summary: "List all pets",
            responses: { "200": { description: "Success" } },
          },
        },
      },
    };

    const result = await importer.import(JSON.stringify(spec), model);

    expect(result.success).toBe(true);
    expect(result.nodesAdded).toBeGreaterThanOrEqual(2); // doc + endpoint
    expect(result.edgesAdded).toBeGreaterThanOrEqual(1);
    expect(result.errorsCount).toBe(0);
  });

  test("creates document node with spec info", async () => {
    const spec = {
      openapi: "3.0.0",
      info: {
        title: "My API",
        version: "2.0.0",
        description: "Test API",
      },
      paths: {},
    };

    const result = await importer.import(JSON.stringify(spec), model);

    expect(result.success).toBe(true);
    const docNode = model.graph.getNode("api.openapi-document.my-api");
    expect(docNode).toBeDefined();
    expect(docNode?.name).toBe("My API");
    expect(docNode?.description).toBe("Test API");
  });

  test("creates endpoint nodes from paths", async () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "API", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            operationId: "getUsers",
            summary: "Get users",
            responses: { "200": { description: "OK" } },
          },
          post: {
            operationId: "createUser",
            summary: "Create user",
            responses: { "201": { description: "Created" } },
          },
        },
      },
    };

    const result = await importer.import(JSON.stringify(spec), model);

    expect(result.success).toBe(true);
    const getNode = model.graph.getNode("api.endpoint.getUsers");
    const postNode = model.graph.getNode("api.endpoint.createUser");

    expect(getNode?.name).toContain("Get users");
    expect(postNode?.name).toContain("Create user");
  });

  test("stores endpoint properties correctly", async () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "API", version: "1.0.0" },
      paths: {
        "/resource/{id}": {
          delete: {
            operationId: "deleteResource",
            summary: "Delete resource",
            deprecated: true,
            tags: ["resources"],
            parameters: [{ name: "id", in: "path", required: true }],
            responses: { "204": { description: "No Content" } },
          },
        },
      },
    };

    const result = await importer.import(JSON.stringify(spec), model);

    expect(result.success).toBe(true);
    const node = model.graph.getNode("api.endpoint.deleteResource");
    expect(node?.properties?.method).toBe("DELETE");
    expect(node?.properties?.path).toBe("/resource/{id}");
    expect(node?.properties?.deprecated).toBe(true);
    expect((node?.properties?.tags as string[])?.includes("resources")).toBe(true);
  });

  test("creates schema nodes from components", async () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "API", version: "1.0.0" },
      paths: {},
      components: {
        schemas: {
          User: {
            type: "object",
            description: "User model",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
            },
          },
          Pet: {
            type: "object",
            description: "Pet model",
          },
        },
      },
    };

    const result = await importer.import(JSON.stringify(spec), model);

    expect(result.success).toBe(true);
    const userSchema = model.graph.getNode("api.schema.User");
    const petSchema = model.graph.getNode("api.schema.Pet");

    expect(userSchema?.name).toBe("User");
    expect(userSchema?.description).toBe("User model");
    expect(petSchema?.name).toBe("Pet");
  });

  test("creates security scheme nodes", async () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "API", version: "1.0.0" },
      paths: {},
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "JWT authentication",
          },
          apiKey: {
            type: "apiKey",
            name: "X-API-Key",
            in: "header",
          },
        },
      },
    };

    const result = await importer.import(JSON.stringify(spec), model);

    expect(result.success).toBe(true);
    const bearerNode = model.graph.getNode("api.security-scheme.bearerAuth");
    const keyNode = model.graph.getNode("api.security-scheme.apiKey");

    expect(bearerNode?.properties?.scheme).toBe("bearer");
    expect(bearerNode?.properties?.bearerFormat).toBe("JWT");
    expect(keyNode?.properties?.type).toBe("apiKey");
  });

  test("handles invalid JSON", async () => {
    const result = await importer.import("not valid json", model);

    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toContain("Invalid JSON");
  });

  test("handles missing openapi field", async () => {
    const spec = {
      info: { title: "API" },
      paths: {},
    };

    const result = await importer.import(JSON.stringify(spec), model);

    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toContain("Not a valid OpenAPI specification");
  });

  test("handles swagger 2.0 format", async () => {
    const spec = {
      swagger: "2.0",
      info: { title: "API", version: "1.0.0" },
      paths: {},
    };

    const result = await importer.import(JSON.stringify(spec), model);

    // Should be recognized as valid OpenAPI (swagger is Swagger 2.0 which was predecessor)
    expect(result.success).toBe(true);
  });

  test("supports JSON format only", () => {
    // YAML and YAML are listed but not actually implemented
    // This documents the current limitation
    expect(importer.supportedFormats).toContain("json");
  });

  test("handles missing paths section gracefully", async () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "API", version: "1.0.0" },
    };

    const result = await importer.import(JSON.stringify(spec), model);

    expect(result.success).toBe(true);
    expect(result.nodesAdded).toBe(1); // just document node
  });

  test("handles empty components", async () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "API", version: "1.0.0" },
      paths: {},
      components: {},
    };

    const result = await importer.import(JSON.stringify(spec), model);

    expect(result.success).toBe(true);
  });
});
