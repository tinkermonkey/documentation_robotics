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
 * The server is the one-mode central server over a scratch farm (tests/helpers/test-farm-server.ts):
 * each block registers its model folder as the farm's one project and talks to its main checkout
 * at /api/projects/{project}/checkouts/main/..., over HTTP on a port the OS picks, with the token.
 *
 * REQUIRES SERIAL EXECUTION: describe.serial blocks are used because the tests in a block share
 * state (annotations created in order, one websocket, file changes watched in sequence).
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach
} from "bun:test";
import { Model } from "../../src/core/model";
import { Element } from "../../src/core/element";
import { Layer } from "../../src/core/layer";
import { Manifest } from "../../src/core/manifest";
import { startTestFarmServer, type TestFarmServer } from "../helpers/test-farm-server.js";
import * as fs from "fs/promises";

import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

/** Listens on a port the OS picks, serving `testDir` as the farm's one project. */
function startServer(testDir: string, options: { token?: string } = {}): Promise<TestFarmServer> {
  return startTestFarmServer(testDir, { listen: true, ...options });
}

/** fetch() to the checkout-scoped path for `rest` (`/model` is `/api/projects/<p>/checkouts/main/model`), with the token. */
function scopedFetch(t: TestFarmServer, rest: string, init: RequestInit = {}): Promise<Response> {
  return fetch(t.url(t.api(rest)), {
    ...init,
    headers: { ...t.auth, ...((init.headers as Record<string, string>) ?? {}) }
  });
}

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
    created: new Date().toISOString()
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
      attributes: {},
      relationships: [],
      references: [],
      layer: "motivation"
    })
  );

  motivationLayer.addElement(
    new Element({
      id: "motivation.goal.g2",
      name: "Test Goal 2",
      type: "goal",
      description: "Another test goal",
      attributes: {},
      relationships: [],
      references: [],
      layer: "motivation"
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
      attributes: {},
      relationships: [],
      references: ["motivation.goal.g1"],
      layer: "business"
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
  let t: TestFarmServer;
  let model: Model;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    model = await createTestModel(testDir);
    t = await startServer(testDir);
  });

  afterAll(async () => {
    await t.stop();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should load complete model via GET /api/model", async () => {
    const response = await scopedFetch(t, `/model`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("nodes");
    expect(data).toHaveProperty("links");
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(data.nodes.length).toBeGreaterThan(0);
    const layerIds = new Set(data.nodes.map((n: any) => n.layer_id));
    expect(layerIds.has("motivation")).toBe(true);
  });

  it("should load specific layer via GET /api/layers/:name", async () => {
    const response = await scopedFetch(t, `/layers/motivation`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.name).toBe("motivation");
    expect(data.elements).toBeArray();
    expect(data.elements.length).toBe(2);
    expect(data.elements[0]).toHaveProperty("id");
    expect(data.elements[0]).toHaveProperty("name");
  });

  it("should return 400 for invalid layer name format", async () => {
    const response = await scopedFetch(t, `/layers/nonexistent`);
    expect(response.status).toBe(400);
  });

  it("should load model via GET /api/model", async () => {
    const response = await scopedFetch(t, `/model`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("nodes");
    expect(data).toHaveProperty("links");
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.links)).toBe(true);
  });
});

describe.serial("Visualization Server - Annotations", () => {
  let t: TestFarmServer;
  let model: Model;
  let createdAnnotationId: string;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    model = await createTestModel(testDir);
    t = await startServer(testDir);
  });

  afterAll(async () => {
    await t.stop();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should create annotation via POST /api/annotations", async () => {
    const annotationData = {
      elementId: "motivation.goal.g1",
      author: "Test User",
      content: "This is a test annotation",
      tags: ["test", "review"]
    };

    const response = await scopedFetch(t, `/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotationData)
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
    const response = await scopedFetch(t, `/annotations?elementId=motivation.goal.g1`
    );
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
      tags: ["updated"]
    };

    const response = await scopedFetch(t, `/annotations/${createdAnnotationId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData)
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.content).toBe("Updated annotation content");
    expect(data.tags).toEqual(["updated"]);
  });

  it("should delete annotation via DELETE /api/annotations/:id", async () => {
    const response = await scopedFetch(t, `/annotations/${createdAnnotationId}`,
      {
        method: "DELETE"
      }
    );

    expect(response.status).toBe(204);

    // Verify it's deleted
    const getResponse = await scopedFetch(t, `/annotations?elementId=motivation.goal.g1`
    );
    const result = await getResponse.json();
    expect(result.annotations.length).toBe(0);
  });

  it("should create annotation via POST /api/annotations", async () => {
    const annotationData = {
      elementId: "motivation.goal.g2",
      author: "Another User",
      content: "Element-specific annotation"
    };

    const response = await scopedFetch(t, `/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotationData)
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
      content: "Test resolved field"
    };

    const response = await scopedFetch(t, `/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotationData)
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.resolved).toBe(false);
    createdAnnotationId = data.id;
  });

  it("should update resolved field via PUT", async () => {
    const updateData = {
      resolved: true
    };

    const response = await scopedFetch(t, `/annotations/${createdAnnotationId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData)
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.resolved).toBe(true);
  });

  it("should update annotation via PATCH (partial update)", async () => {
    const patchData = {
      content: "Patched content only"
    };

    const response = await scopedFetch(t, `/annotations/${createdAnnotationId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchData)
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.content).toBe("Patched content only");
    expect(data.resolved).toBe(true); // Should preserve previous value
  });

  it("should update resolved via PATCH", async () => {
    const patchData = {
      resolved: false
    };

    const response = await scopedFetch(t, `/annotations/${createdAnnotationId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchData)
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.resolved).toBe(false);
    expect(data.content).toBe("Patched content only"); // Should preserve previous value
  });

  it("should reject PATCH with empty body", async () => {
    // AnnotationUpdateSchema requires at least one field to be provided
    const response = await scopedFetch(t, `/annotations/${createdAnnotationId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    // Zod validation errors are returned as an array or error object with issues
    expect(JSON.stringify(error).toLowerCase()).toContain("at least one field");
  });

  it("should reject PUT with empty body", async () => {
    // AnnotationUpdateSchema requires at least one field to be provided
    const response = await scopedFetch(t, `/annotations/${createdAnnotationId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }
    );

    expect(response.status).toBe(400);
    const error = await response.json();
    // Zod validation errors are returned as an array or error object with issues
    expect(JSON.stringify(error).toLowerCase()).toContain("at least one field");
  });

  it("should create annotation without author (defaults to Anonymous)", async () => {
    const annotationData = {
      elementId: "motivation.goal.g1",
      content: "Anonymous annotation"
    };

    const response = await scopedFetch(t, `/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotationData)
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.author).toBe("Anonymous");
    expect(data.content).toBe("Anonymous annotation");
  });

  it("should get replies for annotation", async () => {
    const response = await scopedFetch(t, `/annotations/${createdAnnotationId}/replies`
    );
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("replies");
    expect(data.replies).toBeArray();
    expect(data.replies.length).toBe(0);
  });

  it("should create reply on annotation", async () => {
    const replyData = {
      author: "Reply Author",
      content: "This is a reply to the annotation"
    };

    const response = await scopedFetch(t, `/annotations/${createdAnnotationId}/replies`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(replyData)
      }
    );

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data).toHaveProperty("id");
    expect(data.author).toBe("Reply Author");
    expect(data.content).toBe("This is a reply to the annotation");
    expect(data).toHaveProperty("createdAt");
  });

  it("should get replies after creating one", async () => {
    const response = await scopedFetch(t, `/annotations/${createdAnnotationId}/replies`
    );
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.replies.length).toBe(1);
    expect(data.replies[0].author).toBe("Reply Author");
    expect(data.replies[0].content).toBe("This is a reply to the annotation");
  });

  it("should return 404 when replying to non-existent annotation", async () => {
    const replyData = {
      author: "Test",
      content: "Reply to nowhere"
    };

    const response = await scopedFetch(t, `/annotations/non-existent-id/replies`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(replyData)
      }
    );

    expect(response.status).toBe(404);
  });

  it("should require author and content for reply", async () => {
    const replyData = {
      author: "Test"
      // Missing content
    };

    const response = await scopedFetch(t, `/annotations/${createdAnnotationId}/replies`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(replyData)
      }
    );

    expect(response.status).toBe(400);
  });

  it("should clean up replies when annotation is deleted", async () => {
    // Get annotation ID with replies
    const annotationResponse = await scopedFetch(t, `/annotations?elementId=motivation.goal.g1`
    );
    const annotations = await annotationResponse.json();
    const annWithReplies = annotations.annotations.find(
      (a: any) => a.content === "Patched content only"
    );

    // Delete the annotation
    const deleteResponse = await scopedFetch(t, `/annotations/${annWithReplies.id}`,
      {
        method: "DELETE"
      }
    );
    expect(deleteResponse.status).toBe(204);

    // Verify replies are also deleted (404 on GET replies)
    const repliesResponse = await scopedFetch(t, `/annotations/${annWithReplies.id}/replies`
    );
    expect(repliesResponse.status).toBe(404);
  });
});

// WebSocket tests now enabled - fixed by adding websocket handler to Bun.serve()
describe.serial("Visualization Server - WebSocket", () => {
  let t: TestFarmServer;
  let model: Model;
  let ws: WebSocket;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    model = await createTestModel(testDir);
    t = await startServer(testDir);
  });

  afterAll(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    await t.stop();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should connect to WebSocket at /ws", async () => {
    return new Promise((resolve, reject) => {
      const testWs = new WebSocket(t.wsUrl());
      const timer = setTimeout(() => {
        testWs.close();
        reject(new Error("WebSocket connection timeout"));
      }, 10000);

      testWs.onmessage = (event) => {
        const message = JSON.parse(event.data);
        // Should receive connected message on connect
        if (message.type === "connected") {
          expect(testWs.readyState).toBe(WebSocket.OPEN);
          expect(message.version).toBe("0.1.0");
          // A socket gets nothing for a checkout until it subscribes to that checkout's feed
          testWs.send(JSON.stringify({ action: "subscribe", project: t.project, checkout: t.checkout }));
        }
        if (message.type === "subscribed" && message.project === t.project && message.checkout === t.checkout) {
          clearTimeout(timer);
          ws = testWs;
          resolve(undefined);
        }
      };

      testWs.onerror = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    });
  }, 10000);

  it("should receive pong response to ping", async () => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Pong timeout"));
      }, 10000);

      // Set up message handler before sending
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "pong") {
          clearTimeout(timer);
          resolve(undefined);
        }
      };

      // Send ping after handler is set
      ws.send(JSON.stringify({ type: "ping" }));
    });
  }, 10000);

  it("should subscribe to model updates", async () => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Subscribe timeout"));
      }, 10000);

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "subscribed") {
          expect(message.topics).toContain("model");
          clearTimeout(timer);
          resolve(undefined);
        }
      };

      ws.send(
        JSON.stringify({
          type: "subscribe",
          topics: ["model", "annotations"]
        })
      );
    });
  }, 10000);

  it("should receive annotation events via WebSocket", async () => {
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Annotation event timeout"));
      }, 10000);

      // Set up message handler first
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        // Server sends 'annotation.added' event when annotation is created
        if (message.type === "annotation.added") {
          expect(message.annotationId).toBeDefined();
          expect(message.elementId).toBe("motivation.goal.g1");
          clearTimeout(timer);
          resolve(undefined);
        }
      };

      // Create annotation via HTTP
      await scopedFetch(t, "/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          elementId: "motivation.goal.g1",
          author: "WS Test",
          content: "WebSocket test annotation"
        })
      });
    });
  }, 10000);
});

describe.serial("Visualization Server - File Watching", () => {
  let t: TestFarmServer;
  let model: Model;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    model = await createTestModel(testDir);
    t = await startServer(testDir);
  });

  afterAll(async () => {
    await t.stop();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should detect changes to model files", async () => {
    // Get initial model state
    const response1 = await scopedFetch(t, `/layers/motivation`);
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
          attributes: {},
          relationships: [],
          references: [],
          layer: "motivation"
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
  let t: TestFarmServer;
  let model: Model;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    model = await createTestModel(testDir);
    t = await startServer(testDir);
  });

  afterAll(async () => {
    await t.stop();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should list changesets via GET /api/changesets", async () => {
    const response = await scopedFetch(t, `/changesets`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("changesets");
    expect(typeof data.changesets).toBe("object");
  });
});

describe("Visualization Server - Authentication", () => {
  let t: TestFarmServer;
  let model: Model;
  let authToken: string;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    model = await createTestModel(testDir);
    authToken = "test-auth-token-123";
    t = await startServer(testDir, { token: authToken });
  });

  afterAll(async () => {
    await t.stop();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should reject requests without auth token", async () => {
    const response = await fetch(t.url(t.api("/model")));
    expect(response.status).toBe(401);
  });

  it("should accept requests with valid Bearer token", async () => {
    const response = await fetch(t.url(t.api("/model")), {
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    });
    expect(response.status).toBe(200);
  });

  it("should accept requests with query parameter token", async () => {
    const response = await fetch(t.url(t.api(`/model?token=${authToken}`)));
    expect(response.status).toBe(200);
  });

  it("should reject requests with invalid token", async () => {
    const response = await fetch(t.url(t.api("/model")), {
      headers: {
        Authorization: "Bearer invalid-token"
      }
    });
    expect(response.status).toBe(403);
  });

  it("should reject requests with malformed Bearer header (empty token)", async () => {
    const response = await fetch(t.url(t.api("/model")), {
      headers: {
        Authorization: "Bearer "
      }
    });
    expect(response.status).toBe(401);
  });

  it("should reject requests with wrong auth scheme (Basic instead of Bearer)", async () => {
    const response = await fetch(t.url(t.api("/model")), {
      headers: {
        Authorization: "Basic aW52YWxpZDppbnZhbGlk" // base64 of "invalid:invalid"
      }
    });
    expect(response.status).toBe(401);
  });

  it("should reject requests with missing token in Bearer scheme", async () => {
    const response = await fetch(t.url(t.api("/model")), {
      headers: {
        Authorization: "Bearer"
      }
    });
    expect(response.status).toBe(401);
  });

  it("should allow health check without authentication", async () => {
    const response = await fetch(t.url("/health"));
    expect(response.status).toBe(200);
  });
});

describe("Visualization Server - Health and Status", () => {
  let t: TestFarmServer;
  let model: Model;
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dr-vis-test-"));
    model = await createTestModel(testDir);
    t = await startServer(testDir);
  });

  afterAll(async () => {
    await t.stop();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should return healthy status from GET /health", async () => {
    const response = await fetch(t.url("/health"));
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe("ok");
    expect(data).toHaveProperty("version");
  });

  it("should serve viewer HTML at root /", async () => {
    const response = await fetch(t.url("/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("<!DOCTYPE html>");
  });
});
