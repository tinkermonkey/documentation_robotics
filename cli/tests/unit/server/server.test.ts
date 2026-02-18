import { describe, it, expect, beforeEach } from "bun:test";
import { VisualizationServer } from "../../../src/server/server.js";
import { Model } from "../../../src/core/model.js";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";

describe("VisualizationServer.getOpenAPIDocument()", () => {
  let server: VisualizationServer;
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test model
    testDir = await mkdtemp(`${tmpdir()}/dr-test-`);

    // Create minimal model for server initialization
    const manifestData = {
      name: "Test Model",
      version: "0.1.0",
      specVersion: "0.6.0",
      created: new Date().toISOString(),
    };

    const model = await Model.init(testDir, manifestData, { lazyLoad: false });
    server = new VisualizationServer(model);
  });

  it("should return valid OpenAPI document structure", () => {
    const doc = server.getOpenAPIDocument({
      openapi: "3.0.0",
      info: {
        title: "Test API",
        version: "1.0.0",
      },
    });

    expect(doc).toBeDefined();
    // NOTE: getOpenAPIDocument always returns 3.1.0 regardless of input parameter
    // The openapi parameter is accepted for API compatibility but not used internally
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toBeDefined();
    expect(doc.info.title).toBe("Test API");
    expect(doc.info.version).toBe("1.0.0");
  });

  it("should include configured metadata in document", () => {
    const doc = server.getOpenAPIDocument({
      openapi: "3.0.0",
      info: {
        title: "Test API",
        version: "1.0.0",
        description: "Test API Description",
        contact: {
          name: "Support",
          url: "https://example.com",
        },
      },
    });

    expect(doc.info.description).toBe("Test API Description");
    expect(doc.info.contact).toEqual({
      name: "Support",
      url: "https://example.com",
    });
  });

  it("should handle missing optional config values", () => {
    const doc = server.getOpenAPIDocument({
      openapi: "3.0.0",
      info: {
        title: "Minimal API",
        version: "1.0.0",
      },
    });

    expect(doc.info.title).toBe("Minimal API");
    expect(doc.info.version).toBe("1.0.0");
    expect(doc.info.description).toBeUndefined();
  });

  it("should include servers when provided", () => {
    const doc = server.getOpenAPIDocument({
      openapi: "3.0.0",
      info: {
        title: "Test API",
        version: "1.0.0",
      },
      servers: [
        {
          url: "https://api.example.com",
          description: "Production",
        },
      ],
    });

    expect(doc.servers).toBeDefined();
    expect(doc.servers?.length).toBe(1);
    expect(doc.servers?.[0].url).toBe("https://api.example.com");
  });

  it("should generate consistent documents on multiple calls", () => {
    const config = {
      openapi: "3.0.0",
      info: {
        title: "Test API",
        version: "1.0.0",
      },
    };

    const doc1 = server.getOpenAPIDocument(config);
    const doc2 = server.getOpenAPIDocument(config);

    expect(JSON.stringify(doc1)).toBe(JSON.stringify(doc2));
  });
});
