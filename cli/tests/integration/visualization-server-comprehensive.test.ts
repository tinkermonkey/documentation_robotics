/**
 * Comprehensive Visualization Server API Tests
 * Based on Python CLI visualization server functionality
 *
 * Tests:
 * 1. Loading model and spec
 * 2. Watching local model for changes
 * 3. Chatting with Claude Code
 * 4. Adding and removing annotations
 * 5. WebSocket protocol
 * 6. File monitoring
 *
 * REQUIRES SERIAL EXECUTION: Multiple describe.serial blocks are used because:
 * - Tests start/stop the visualization server which requires exclusive port access
 * - Tests watch the file system for changes which must happen sequentially
 * - Concurrent execution would cause port conflicts and file monitoring race conditions
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { VisualizationServer } from "../../src/server/server";
import { Model } from "../../src/core/model";
import { Element } from "../../src/core/element";
import { Layer } from "../../src/core/layer";
import { Manifest } from "../../src/core/manifest";
import { portAllocator } from "../helpers/port-allocator.js";
import * as fs from "fs/promises";

import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

async function createTestModel(testDir: string): Promise<Model> {
  const testModelRoot = `${testDir}/documentation-robotics`;
  // Create directory structure matching Python CLI
  await fs.mkdir(`${testModelRoot}/model`, { recursive: true });

  // Create basic manifest
  const manifestData = {
    name: "Test Visualization Model",
    version: "0.1.0",
    description: "Model for visualization server testing",
    specVersion: "0.6.0",
    created: new Date().toISOString(),
  };

  // Eager loading required: Visualization server renders complete model in UI
  // which requires all layers loaded upfront for comprehensive visualization
  const model = await Model.init(testDir, manifestData, { lazyLoad: false });

  // Manually create and add layers since init doesn't load them
  const motivationLayer = new Layer("motivation");
  motivationLayer.addElement(
    new Element({
      id: "motivation.goal.g1",
      name: "Test Goal 1",
      type: "goal",
      description: "A test goal for visualization",
      properties: {},
      relationships: [],
      references: [],
      layer: "motivation",
    })
  );

  motivationLayer.addElement(
    new Element({
      id: "motivation.goal.g2",
      name: "Test Goal 2",
      type: "goal",
      description: "Another test goal",
      properties: {},
      relationships: [],
      references: [],
      layer: "motivation",
    })
  );

  model.addLayer(motivationLayer);

  // Add test elements to business layer
  const businessLayer = new Layer("business");
  businessLayer.addElement(
    new Element({
      id: "business.service.s1",
      name: "Test Service",
      type: "service",
      description: "A test business service",
      properties: {},
      relationships: [],
      references: ["motivation.goal.g1"],
      layer: "business",
    })
  );

  model.addLayer(businessLayer);

  // Save layers
  await model.saveLayer("motivation");
  await model.saveLayer("business");
  await model.saveManifest();

  return model;
}

describe.serial("Visualization Server - Model Loading", () => {
  let server: VisualizationServer;
  let model: Model;
  let baseUrl: string;
  let testDir: string;
  let testPort: number;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    testPort = await portAllocator.allocatePort();
    model = await createTestModel(testDir);
    server = new VisualizationServer(model, { authEnabled: false });
    await server.start(testPort);
    baseUrl = `http://localhost:${testPort}`;
  });

  afterAll(async () => {
    server.stop();
    portAllocator.releasePort(testPort);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should load complete model via GET /api/model", async () => {
    const response = await fetch(`${baseUrl}/api/model`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("manifest");
    expect(data).toHaveProperty("layers");
    expect(data.manifest.name).toBe("Test Visualization Model");
    expect(Object.keys(data.layers).length).toBeGreaterThan(0);
  });

  it("should load specific layer via GET /api/layers/:name", async () => {
    const response = await fetch(`${baseUrl}/api/layers/motivation`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.name).toBe("motivation");
    expect(data.elements).toBeArray();
    expect(data.elements.length).toBe(2);
    expect(data.elements[0]).toHaveProperty("id");
    expect(data.elements[0]).toHaveProperty("name");
  });

  it("should return 400 for invalid layer name format", async () => {
    const response = await fetch(`${baseUrl}/api/layers/nonexistent`);
    expect(response.status).toBe(400);
  });

  it("should load model via GET /api/model", async () => {
    const response = await fetch(`${baseUrl}/api/model`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("layers");
    expect(typeof data.layers).toBe("object");
    expect(Object.keys(data.layers).length).toBeGreaterThan(0);
  });

  it("should get specific element via GET /api/elements/:id", async () => {
    const response = await fetch(`${baseUrl}/api/elements/motivation.goal.g1`);
    expect(response.status).toBe(200);

    const data = await response.json();
    // Element ID might be UUID or the semantic ID we set, just verify it matches one we expect
    expect(data.name).toBe("Test Goal 1");
    expect(data.type).toBe("goal");
    expect(data.description).toBe("A test goal for visualization");
  });

  it("should return 404 for non-existent element", async () => {
    const response = await fetch(`${baseUrl}/api/elements/nonexistent.element.id`);
    expect(response.status).toBe(404);
  });
});

describe.serial("Visualization Server - Annotations", () => {
  let server: VisualizationServer;
  let model: Model;
  let baseUrl: string;
  let createdAnnotationId: string;
  let annotationsPort: number;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    annotationsPort = await portAllocator.allocatePort();
    model = await createTestModel(testDir);
    server = new VisualizationServer(model, { authEnabled: false });
    await server.start(annotationsPort);
    baseUrl = `http://localhost:${annotationsPort}`;
  });

  afterAll(async () => {
    server.stop();
    portAllocator.releasePort(annotationsPort);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should create annotation via POST /api/annotations", async () => {
    const annotationData = {
      elementId: "motivation.goal.g1",
      author: "Test User",
      content: "This is a test annotation",
      tags: ["test", "review"],
    };

    const response = await fetch(`${baseUrl}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotationData),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data).toHaveProperty("id");
    expect(data.elementId).toBe("motivation.goal.g1");
    expect(data.author).toBe("Test User");
    expect(data.content).toBe("This is a test annotation");

    createdAnnotationId = data.id;
  });

  it("should get annotations for element via GET /api/annotations?elementId=", async () => {
    const response = await fetch(`${baseUrl}/api/annotations?elementId=motivation.goal.g1`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("annotations");
    expect(data.annotations).toBeArray();
    expect(data.annotations.length).toBe(1);
    expect(data.annotations[0].content).toBe("This is a test annotation");
  });

  it("should update annotation via PUT /api/annotations/:id", async () => {
    const updateData = {
      content: "Updated annotation content",
      tags: ["updated"],
    };

    const response = await fetch(`${baseUrl}/api/annotations/${createdAnnotationId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updateData),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.content).toBe("Updated annotation content");
    expect(data.tags).toEqual(["updated"]);
  });

  it("should delete annotation via DELETE /api/annotations/:id", async () => {
    const response = await fetch(`${baseUrl}/api/annotations/${createdAnnotationId}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);

    // Verify it's deleted
    const getResponse = await fetch(`${baseUrl}/api/annotations?elementId=motivation.goal.g1`);
    const result = await getResponse.json();
    expect(result.annotations.length).toBe(0);
  });

  it("should create annotation via POST /api/annotations", async () => {
    const annotationData = {
      elementId: "motivation.goal.g2",
      author: "Another User",
      content: "Element-specific annotation",
    };

    const response = await fetch(`${baseUrl}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotationData),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.elementId).toBe("motivation.goal.g2");
    expect(data.content).toBe("Element-specific annotation");
  });

  it("should default resolved to false when creating annotation", async () => {
    const annotationData = {
      elementId: "motivation.goal.g1",
      author: "Test User",
      content: "Test resolved field",
    };

    const response = await fetch(`${baseUrl}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotationData),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.resolved).toBe(false);
    createdAnnotationId = data.id;
  });

  it("should update resolved field via PUT", async () => {
    const updateData = {
      resolved: true,
    };

    const response = await fetch(`${baseUrl}/api/annotations/${createdAnnotationId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updateData),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.resolved).toBe(true);
  });

  it("should update annotation via PATCH (partial update)", async () => {
    const patchData = {
      content: "Patched content only",
    };

    const response = await fetch(`${baseUrl}/api/annotations/${createdAnnotationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchData),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.content).toBe("Patched content only");
    expect(data.resolved).toBe(true); // Should preserve previous value
  });

  it("should update resolved via PATCH", async () => {
    const patchData = {
      resolved: false,
    };

    const response = await fetch(`${baseUrl}/api/annotations/${createdAnnotationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchData),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.resolved).toBe(false);
    expect(data.content).toBe("Patched content only"); // Should preserve previous value
  });

  it("should reject PATCH with empty body", async () => {
    // AnnotationUpdateSchema requires at least one field to be provided
    const response = await fetch(`${baseUrl}/api/annotations/${createdAnnotationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.message).toContain("at least one field");
  });

  it("should reject PUT with empty body", async () => {
    // AnnotationUpdateSchema requires at least one field to be provided
    const response = await fetch(`${baseUrl}/api/annotations/${createdAnnotationId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.error.message).toContain("at least one field");
  });

  it("should create annotation without author (defaults to Anonymous)", async () => {
    const annotationData = {
      elementId: "motivation.goal.g1",
      content: "Anonymous annotation",
    };

    const response = await fetch(`${baseUrl}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotationData),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.author).toBe("Anonymous");
    expect(data.content).toBe("Anonymous annotation");
  });

  it("should get replies for annotation", async () => {
    const response = await fetch(`${baseUrl}/api/annotations/${createdAnnotationId}/replies`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("replies");
    expect(data.replies).toBeArray();
    expect(data.replies.length).toBe(0);
  });

  it("should create reply on annotation", async () => {
    const replyData = {
      author: "Reply Author",
      content: "This is a reply to the annotation",
    };

    const response = await fetch(`${baseUrl}/api/annotations/${createdAnnotationId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(replyData),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data).toHaveProperty("id");
    expect(data.author).toBe("Reply Author");
    expect(data.content).toBe("This is a reply to the annotation");
    expect(data).toHaveProperty("createdAt");
  });

  it("should get replies after creating one", async () => {
    const response = await fetch(`${baseUrl}/api/annotations/${createdAnnotationId}/replies`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.replies.length).toBe(1);
    expect(data.replies[0].author).toBe("Reply Author");
    expect(data.replies[0].content).toBe("This is a reply to the annotation");
  });

  it("should return 404 when replying to non-existent annotation", async () => {
    const replyData = {
      author: "Test",
      content: "Reply to nowhere",
    };

    const response = await fetch(`${baseUrl}/api/annotations/non-existent-id/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(replyData),
    });

    expect(response.status).toBe(404);
  });

  it("should require author and content for reply", async () => {
    const replyData = {
      author: "Test",
      // Missing content
    };

    const response = await fetch(`${baseUrl}/api/annotations/${createdAnnotationId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(replyData),
    });

    expect(response.status).toBe(400);
  });

  it("should clean up replies when annotation is deleted", async () => {
    // Get annotation ID with replies
    const annotationResponse = await fetch(
      `${baseUrl}/api/annotations?elementId=motivation.goal.g1`
    );
    const annotations = await annotationResponse.json();
    const annWithReplies = annotations.annotations.find(
      (a: any) => a.content === "Patched content only"
    );

    // Delete the annotation
    const deleteResponse = await fetch(`${baseUrl}/api/annotations/${annWithReplies.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(204);

    // Verify replies are also deleted (404 on GET replies)
    const repliesResponse = await fetch(`${baseUrl}/api/annotations/${annWithReplies.id}/replies`);
    expect(repliesResponse.status).toBe(404);
  });
});

// WebSocket tests now enabled - fixed by adding websocket handler to Bun.serve()
describe.serial("Visualization Server - WebSocket", () => {
  let server: VisualizationServer;
  let model: Model;
  let ws: WebSocket;
  let wsPort: number;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    wsPort = await portAllocator.allocatePort();
    model = await createTestModel(testDir);
    server = new VisualizationServer(model, { authEnabled: false });
    await server.start(wsPort);
  });

  afterAll(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    server.stop();
    portAllocator.releasePort(wsPort);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should connect to WebSocket at /ws", async () => {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(`ws://localhost:${wsPort}/ws`);

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        // Should receive connected message on connect
        if (message.type === "connected") {
          expect(ws.readyState).toBe(WebSocket.OPEN);
          expect(message.version).toBe("0.1.0");
          resolve(undefined);
        }
      };

      ws.onerror = (error) => {
        reject(error);
      };

      setTimeout(() => reject(new Error("WebSocket connection timeout")), 5000);
    });
  }, 10000);

  it("should receive pong response to ping", async () => {
    return new Promise((resolve, reject) => {
      // Set up message handler before sending
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "pong") {
          resolve(undefined);
        }
      };

      // Send ping after handler is set
      ws.send(JSON.stringify({ type: "ping" }));

      setTimeout(() => reject(new Error("Pong timeout")), 5000);
    });
  }, 10000);

  it("should subscribe to model updates", async () => {
    return new Promise((resolve, reject) => {
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "subscribed") {
          expect(message.topics).toContain("model");
          resolve(undefined);
        }
      };

      ws.send(
        JSON.stringify({
          type: "subscribe",
          topics: ["model", "annotations"],
        })
      );

      setTimeout(() => reject(new Error("Subscribe timeout")), 5000);
    });
  }, 10000);

  it("should receive annotation events via WebSocket", async () => {
    return new Promise(async (resolve, reject) => {
      // Set up message handler first
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        // Server sends 'annotation.added' event when annotation is created
        if (message.type === "annotation.added") {
          expect(message.annotationId).toBeDefined();
          expect(message.elementId).toBe("motivation.goal.g1");
          resolve(undefined);
        }
      };

      // Create annotation via HTTP
      await fetch(`http://localhost:${wsPort}/api/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          elementId: "motivation.goal.g1",
          author: "WS Test",
          content: "WebSocket test annotation",
        }),
      });

      setTimeout(() => reject(new Error("Annotation event timeout")), 5000);
    });
  }, 10000);
});

describe.serial("Visualization Server - File Watching", () => {
  let server: VisualizationServer;
  let model: Model;
  let baseUrl: string;
  let watchingPort: number;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    watchingPort = await portAllocator.allocatePort();
    model = await createTestModel(testDir);
    server = new VisualizationServer(model, { authEnabled: false });
    await server.start(watchingPort);
    baseUrl = `http://localhost:${watchingPort}`;
  });

  afterAll(async () => {
    server.stop();
    portAllocator.releasePort(watchingPort);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should detect changes to model files", async () => {
    // Get initial model state
    const response1 = await fetch(`${baseUrl}/api/layers/motivation`);
    const data1 = await response1.json();
    const initialCount = data1.elements.length;

    // Modify a layer file
    const motivationLayer = await model.getLayer("motivation");
    if (motivationLayer) {
      motivationLayer.addElement(
        new Element({
          id: "motivation-goal-g3",
          name: "Newly Added Goal",
          type: "goal",
          description: "Added while watching",
          properties: {},
          relationships: [],
          references: [],
          layer: "motivation",
        })
      );
      await model.saveLayer("motivation");
    }

    // Wait for file watcher to detect change (if implemented)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Reload model
    const reloadedModel = await Model.load(testDir);
    const reloadedLayer = await reloadedModel.getLayer("motivation");
    expect(reloadedLayer?.elements.size).toBe(initialCount + 1);
  });
});

describe.serial("Visualization Server - Changesets", () => {
  let server: VisualizationServer;
  let model: Model;
  let baseUrl: string;
  let changesetsPort: number;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    changesetsPort = await portAllocator.allocatePort();
    model = await createTestModel(testDir);
    server = new VisualizationServer(model, { authEnabled: false });
    await server.start(changesetsPort);
    baseUrl = `http://localhost:${changesetsPort}`;
  });

  afterAll(async () => {
    server.stop();
    portAllocator.releasePort(changesetsPort);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should list changesets via GET /api/changesets", async () => {
    const response = await fetch(`${baseUrl}/api/changesets`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("changesets");
    expect(typeof data.changesets).toBe("object");
  });
});

describe("Visualization Server - Authentication", () => {
  let server: VisualizationServer;
  let model: Model;
  let baseUrl: string;
  let authToken: string;
  let authPort: number;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    authPort = await portAllocator.allocatePort();
    model = await createTestModel(testDir);
    authToken = "test-auth-token-123";
    server = new VisualizationServer(model, {
      authEnabled: true,
      authToken: authToken,
    });
    await server.start(authPort);
    baseUrl = `http://localhost:${authPort}`;
  });

  afterAll(async () => {
    server.stop();
    portAllocator.releasePort(authPort);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should reject requests without auth token", async () => {
    const response = await fetch(`${baseUrl}/api/model`);
    expect(response.status).toBe(401);
  });

  it("should accept requests with valid Bearer token", async () => {
    const response = await fetch(`${baseUrl}/api/model`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    expect(response.status).toBe(200);
  });

  it("should accept requests with query parameter token", async () => {
    const response = await fetch(`${baseUrl}/api/model?token=${authToken}`);
    expect(response.status).toBe(200);
  });

  it("should reject requests with invalid token", async () => {
    const response = await fetch(`${baseUrl}/api/model`, {
      headers: {
        Authorization: "Bearer invalid-token",
      },
    });
    expect(response.status).toBe(403);
  });

  it("should allow health check without authentication", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
  });
});

describe("Visualization Server - Health and Status", () => {
  let server: VisualizationServer;
  let model: Model;
  let baseUrl: string;
  let healthPort: number;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    healthPort = await portAllocator.allocatePort();
    model = await createTestModel(testDir);
    server = new VisualizationServer(model, { authEnabled: false });
    await server.start(healthPort);
    baseUrl = `http://localhost:${healthPort}`;
  });

  afterAll(async () => {
    server.stop();
    portAllocator.releasePort(healthPort);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should return healthy status from GET /health", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe("ok");
    expect(data).toHaveProperty("version");
  });

  it("should serve viewer HTML at root /", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("<!DOCTYPE html>");
  });
});
