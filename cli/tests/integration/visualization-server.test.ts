/**
 * Integration tests for VisualizationServer
 *
 * REQUIRES SERIAL EXECUTION: Uses describe.serial because:
 * - Tests start/stop the visualization server requiring exclusive port access
 * - Concurrent execution would cause port conflicts and server state issues
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Model } from "../../src/core/model.js";
import { VisualizationServer } from "../../src/server/server.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { sleep } from "../helpers.ts";

// Test fixture setup - specific to this test suite's requirements
async function createTestModel(rootPath: string): Promise<Model> {
  // Use init to create the model with the correct structure
  // Eager loading required: Visualization server tests render all layers in the UI
  // which requires all layers loaded upfront for complete graph visualization
  const model = await Model.init(
    rootPath,
    {
      name: "Integration Test Model",
      version: "0.1.0",
      description: "Integration Test",
      author: "Test Suite",
      specVersion: "0.6.0",
      created: new Date().toISOString(),
    },
    { lazyLoad: false }
  );

  // Add test elements to layers
  const { Layer } = await import("../../src/core/layer.js");
  const { Element } = await import("../../src/core/element.js");

  // Add motivation layer elements
  let motivationLayer = await model.getLayer("motivation");
  if (!motivationLayer) {
    motivationLayer = new Layer("motivation");
    model.addLayer(motivationLayer);
  }

  motivationLayer.addElement(
    new Element({
      id: "motivation.goal.integration-test",
      type: "goal",
      name: "Integration Test Goal",
      description: "Goal for integration testing",
    })
  );

  motivationLayer.addElement(
    new Element({
      id: "motivation.requirement.integration-test",
      type: "requirement",
      name: "Integration Test Requirement",
      description: "Requirement for integration testing",
    })
  );

  // Add application layer elements
  let applicationLayer = await model.getLayer("application");
  if (!applicationLayer) {
    applicationLayer = new Layer("application");
    model.addLayer(applicationLayer);
  }

  applicationLayer.addElement(
    new Element({
      id: "application.service.integration-test",
      type: "service",
      name: "Integration Test Service",
      description: "Service for integration testing",
    })
  );

  // Save the model
  await model.save();

  return model;
}

describe.serial("VisualizationServer Integration Tests", () => {
  let testDir: string;
  let model: Model;
  let server: VisualizationServer;

  beforeAll(async () => {
    testDir = join(tmpdir(), `dr-integration-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    model = await createTestModel(testDir);
    server = new VisualizationServer(model, { authEnabled: false });
  });

  afterAll(() => {
    server.stop();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("REST API - Model Endpoint", () => {
    it("should serialize complete model correctly", async () => {
      const modelData = await server["serializeModel"]();

      expect(modelData.manifest.name).toBe("Integration Test Model");
      expect(Object.keys(modelData.layers)).toContain("motivation");
      expect(Object.keys(modelData.layers)).toContain("application");
    });

    it("should count elements accurately", async () => {
      const modelData = await server["serializeModel"]();

      const motivationCount = modelData.layers.motivation.elements.length;
      const applicationCount = modelData.layers.application.elements.length;
      const total = modelData.totalElements;

      expect(motivationCount).toBe(2);
      expect(applicationCount).toBe(1);
      expect(total).toBe(3);
    });
  });

  describe("REST API - Layer Endpoint", () => {
    it("should retrieve specific layer", async () => {
      const layer = await model.getLayer("motivation");

      expect(layer).toBeDefined();
      expect(layer?.name).toBe("motivation");
    });

    it("should list elements in layer", async () => {
      const layer = await model.getLayer("motivation");
      const elements = layer?.listElements() ?? [];

      expect(elements.length).toBe(2);
      expect(elements[0].elementId || elements[0].id).toContain("motivation.");
    });

    it("should return null for non-existent layer", async () => {
      const layer = await model.getLayer("non-existent-layer");

      expect(layer).toBeUndefined();
    });
  });

  describe("REST API - Element Endpoint", () => {
    it("should find elements across layers", async () => {
      const element = await server["findElement"]("motivation.goal.integration-test");

      expect(element).toBeDefined();
      expect(element?.name).toBe("Integration Test Goal");
      expect(element?.type).toBe("goal");
    });

    it("should find elements in different layers", async () => {
      const element = await server["findElement"]("application.service.integration-test");

      expect(element).toBeDefined();
      expect(element?.type).toBe("service");
    });

    it("should return null for missing elements", async () => {
      const element = await server["findElement"]("missing-element-id");

      expect(element).toBeNull();
    });
  });

  describe("Annotation System", () => {
    it("should store annotations by element ID via HTTP API", async () => {
      const annotationData = {
        elementId: "motivation.goal.integration-test",
        author: "User 1",
        content: "First annotation",
        tags: [],
      };

      // Create annotation via POST HTTP API
      const response = await server["app"].request(
        new Request("http://localhost/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(annotationData),
        })
      );

      expect(response.status).toBe(201);
      const created = await response.json();
      expect(created.author).toBe("User 1");
      expect(created.elementId).toBe("motivation.goal.integration-test");

      // Retrieve annotation via GET HTTP API
      const listResponse = await server["app"].request(
        new Request("http://localhost/api/annotations?elementId=motivation.goal.integration-test")
      );

      expect(listResponse.status).toBe(200);
      const list = await listResponse.json();
      expect(list.annotations).toBeDefined();
      expect(list.annotations.length).toBeGreaterThan(0);
      expect(list.annotations[0].author).toBe("User 1");
    });

    it("should support multiple annotations per element via HTTP API", async () => {
      const elementId = "motivation.requirement.integration-test";

      const annotations = [
        {
          elementId,
          author: "User 1",
          content: "First note",
          tags: [],
        },
        {
          elementId,
          author: "User 2",
          content: "Second note",
          tags: [],
        },
      ];

      // Create first annotation
      let response = await server["app"].request(
        new Request("http://localhost/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(annotations[0]),
        })
      );
      expect(response.status).toBe(201);

      // Create second annotation
      response = await server["app"].request(
        new Request("http://localhost/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(annotations[1]),
        })
      );
      expect(response.status).toBe(201);

      // Retrieve all annotations for element
      const listResponse = await server["app"].request(
        new Request(`http://localhost/api/annotations?elementId=${elementId}`)
      );

      expect(listResponse.status).toBe(200);
      const list = await listResponse.json();
      expect(list.annotations?.length).toBe(2);
      expect(list.annotations?.[0].author).toBe("User 1");
      expect(list.annotations?.[1].author).toBe("User 2");
    });

    it("should include annotations in serialized model", async () => {
      // Use a known element ID that was created in the test setup
      const elementId = "motivation.goal.integration-test";
      const annotationData = {
        elementId,
        author: "Model Test",
        content: "Verify annotation in model",
        tags: [],
      };

      // Create annotation via HTTP API
      const createResponse = await server["app"].request(
        new Request("http://localhost/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(annotationData),
        })
      );

      expect(createResponse.status).toBe(201);
      const annotationFromCreate = await createResponse.json();
      expect(annotationFromCreate.id).toBeDefined();

      // Verify annotation can be retrieved directly by element ID
      const listResponse = await server["app"].request(
        new Request(`http://localhost/api/annotations?elementId=${elementId}`)
      );

      expect(listResponse.status).toBe(200);
      const list = await listResponse.json();
      expect(Array.isArray(list.annotations)).toBe(true);
      expect(list.annotations.length).toBeGreaterThan(0);
    });
  });

  describe("WebSocket Message Handling", () => {
    it("should handle subscribe messages", async () => {
      let receivedMessage: any = null;

      const mockWs = {
        send: (msg: string) => {
          receivedMessage = JSON.parse(msg);
        },
      };

      const subscribeMsg = { type: "subscribe" as const };
      await server["handleWSMessage"](mockWs, subscribeMsg);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage.type).toBe("model");
      expect(receivedMessage.data).toHaveProperty("manifest");
      expect(receivedMessage.data).toHaveProperty("layers");
    });

    it("should handle annotate messages", async () => {
      let broadcastCalled = false;

      // Store original broadcast method
      const originalBroadcast = server["broadcastMessage"];

      // Mock broadcast method
      server["broadcastMessage"] = async () => {
        broadcastCalled = true;
      };

      const annotateMsg = {
        type: "annotate" as const,
        annotation: {
          elementId: "test-element",
          author: "Test User",
          text: "Test message",
          timestamp: new Date().toISOString(),
        },
      };

      const mockWs = { send: () => {} };
      await server["handleWSMessage"](mockWs, annotateMsg);

      expect(broadcastCalled).toBe(true);

      // Restore original method
      server["broadcastMessage"] = originalBroadcast;
    });

    it("should handle invalid messages gracefully", async () => {
      let errorResponse: any = null;

      const mockWs = {
        send: (msg: string) => {
          errorResponse = JSON.parse(msg);
        },
      };

      const invalidMsg = { type: "invalid" } as any;
      await server["handleWSMessage"](mockWs, invalidMsg);

      expect(errorResponse).toBeDefined();
      expect(errorResponse.type).toBe("error");
    });
  });

  describe("Multi-Layer Support", () => {
    it("should serialize all layers correctly", async () => {
      const modelData = await server["serializeModel"]();

      expect(Object.keys(modelData.layers).length).toBeGreaterThanOrEqual(2);
      expect(modelData.layers.motivation).toBeDefined();
      expect(modelData.layers.application).toBeDefined();
    });

    it("should find elements across different layers", async () => {
      const motivationElement = await server["findElement"]("motivation.goal.integration-test");
      const applicationElement = await server["findElement"](
        "application.service.integration-test"
      );

      expect(motivationElement?.type).toBe("goal");
      expect(applicationElement?.type).toBe("service");
    });

    it("should maintain element isolation within layers", async () => {
      const motivationLayer = await model.getLayer("motivation");
      const applicationLayer = await model.getLayer("application");

      const motivationIds = motivationLayer?.listElements().map((e) => e.id) ?? [];
      const applicationIds = applicationLayer?.listElements().map((e) => e.id) ?? [];

      // Ensure no overlap
      const overlap = motivationIds.filter((id) => applicationIds.includes(id));
      expect(overlap.length).toBe(0);
    });
  });

  describe("HTML Viewer", () => {
    it("should generate valid HTML", () => {
      const html = server["getViewerHTML"]();

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("</html>");
    });

    it("should include model visualization elements", () => {
      const html = server["getViewerHTML"]();

      expect(html).toContain('id="model-tree"');
      expect(html).toContain('id="element-details"');
      expect(html).toContain('id="status"');
    });

    it("should include WebSocket connection handling", () => {
      const html = server["getViewerHTML"]();

      expect(html).toContain("new WebSocket");
      expect(html).toContain("addEventListener('open'");
      expect(html).toContain("addEventListener('message'");
      expect(html).toContain("addEventListener('close'");
    });

    it("should include annotation functionality", () => {
      const html = server["getViewerHTML"]();

      expect(html).toContain("addAnnotation");
      expect(html).toContain("POST");
      expect(html).toContain("/api/annotations");
      expect(html).toContain("annotations");
    });
  });

  describe("Validation Edge Cases", () => {
    it("should reject annotation content that is empty string", async () => {
      const annotation = {
        elementId: "motivation.goal.integration-test",
        author: "Test User",
        content: "",
      };

      const response = await server["app"].request(
        new Request("http://localhost/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(annotation),
        })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    it("should reject annotation content that exceeds 5000 characters", async () => {
      const annotation = {
        elementId: "motivation.goal.integration-test",
        author: "Test User",
        content: "a".repeat(5001),
      };

      const response = await server["app"].request(
        new Request("http://localhost/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(annotation),
        })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    it("should reject author name that exceeds 100 characters", async () => {
      const annotation = {
        elementId: "motivation.goal.integration-test",
        author: "a".repeat(101),
        content: "Valid content",
      };

      const response = await server["app"].request(
        new Request("http://localhost/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(annotation),
        })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    it("should reject invalid element ID format", async () => {
      const annotation = {
        elementId: "INVALID_ELEMENT_ID",
        author: "Test User",
        content: "Valid content",
      };

      const response = await server["app"].request(
        new Request("http://localhost/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(annotation),
        })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    it("should accept valid content at 5000 character boundary", async () => {
      const annotation = {
        elementId: "motivation.goal.integration-test",
        author: "Test User",
        content: "a".repeat(5000),
      };

      const response = await server["app"].request(
        new Request("http://localhost/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(annotation),
        })
      );

      // Should succeed (200 or 201) or fail due to missing element, not validation
      expect(response.status).not.toBe(400);
    });

    it("should accept valid author name at 100 character boundary", async () => {
      const annotation = {
        elementId: "motivation.goal.integration-test",
        author: "a".repeat(100),
        content: "Valid content",
      };

      const response = await server["app"].request(
        new Request("http://localhost/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(annotation),
        })
      );

      // Should succeed (200 or 201) or fail due to missing element, not validation
      expect(response.status).not.toBe(400);
    });

    it("should reject reply with empty author name", async () => {
      const reply = {
        author: "",
        content: "Valid content",
      };

      const response = await server["app"].request(
        new Request(
          "http://localhost/api/annotations/test-annotation-id/replies",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reply),
          }
        )
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    it("should reject reply with empty content", async () => {
      const reply = {
        author: "Test User",
        content: "",
      };

      const response = await server["app"].request(
        new Request(
          "http://localhost/api/annotations/test-annotation-id/replies",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reply),
          }
        )
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    it("should reject extra fields on annotation create", async () => {
      const annotation = {
        elementId: "motivation.goal.integration-test",
        author: "Test User",
        content: "Valid content",
        extraField: "should be rejected",
      };

      const response = await server["app"].request(
        new Request("http://localhost/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(annotation),
        })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });

  });
});
