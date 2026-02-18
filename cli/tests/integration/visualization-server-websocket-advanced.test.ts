/**
 * Advanced WebSocket Tests for Visualization Server
 * Tests WebSocket connection lifecycle, concurrent clients, file watcher integration,
 * and real-time event broadcasting
 *
 * REQUIRES SERIAL EXECUTION: Multiple describe.serial blocks are used because:
 * - Tests start/stop the visualization server requiring exclusive port access
 * - Tests establish WebSocket connections which cannot overlap on same port
 * - Concurrent execution would cause port conflicts and WebSocket binding failures
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Model } from "../../src/core/model.js";
import { VisualizationServer } from "../../src/server/server.js";
import { portAllocator } from "../helpers/port-allocator.js";
import { createTestModel } from "../helpers/test-model.js";
import * as fs from "fs/promises";
import { tmpdir } from "os";

/**
 * Generate unique test directory using cross-platform temp directory
 */
function getTestDir(): string {
  return `${tmpdir()}/dr-viz-websocket-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Helper to wait for a WebSocket message of a specific type
 */
function waitForMessage(ws: WebSocket, expectedType: string, timeout: number = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for message type: ${expectedType}`));
    }, timeout);

    const handler = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === expectedType) {
          ws.removeEventListener("message", handler);
          clearTimeout(timer);
          resolve(message);
        }
      } catch (error) {
        // Ignore parse errors, wait for next message
      }
    };

    ws.addEventListener("message", handler);
  });
}

describe.serial("WebSocket Connection Lifecycle", () => {
  let server: VisualizationServer;
  let model: Model;
  let port: number;
  let wsUrl: string;
  let testDir: string;

  beforeAll(async () => {
    port = await portAllocator.allocatePort();
    testDir = getTestDir();
    model = await createTestModel(testDir);
    server = new VisualizationServer(model, { authEnabled: false });
    await server.start(port);
    wsUrl = `ws://localhost:${port}/ws`;
  });

  afterAll(async () => {
    server.stop();
    portAllocator.releasePort(port);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should accept WebSocket connections on /ws", async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        resolve();
      };

      ws.onerror = (error) => {
        reject(new Error(`Failed to connect: ${error}`));
      };

      setTimeout(() => reject(new Error("Connection timeout")), 5000);
    });
  });

  it("should handle normal connection close", async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.close();
      };

      ws.onclose = () => {
        expect(ws.readyState).toBe(WebSocket.CLOSED);
        resolve();
      };

      ws.onerror = (error) => {
        reject(error);
      };

      setTimeout(() => reject(new Error("Close timeout")), 5000);
    });
  });

  it("should send connected message upon connection", async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "connected") {
            expect(message).toHaveProperty("version");
            ws.close();
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      };

      ws.onerror = (error) => {
        reject(error);
      };

      setTimeout(() => reject(new Error("Message timeout")), 5000);
    });
  });

  it("should handle terminate gracefully", async () => {
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
      setTimeout(() => resolve(), 5000);
    });

    if (ws.readyState === WebSocket.OPEN) {
      ws.terminate?.() || ws.close();
    }

    // Server should remain operational
    const ws2 = new WebSocket(wsUrl);
    return new Promise<void>((resolve, reject) => {
      ws2.onopen = () => {
        expect(ws2.readyState).toBe(WebSocket.OPEN);
        ws2.close();
        resolve();
      };

      ws2.onerror = (error) => {
        reject(error);
      };

      setTimeout(() => reject(new Error("Second connection timeout")), 5000);
    });
  });

  it("should respond to ping messages with pong", async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "ping" }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "pong") {
            ws.close();
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      };

      ws.onerror = (error) => {
        reject(error);
      };

      setTimeout(() => reject(new Error("Pong timeout")), 5000);
    });
  });
});


describe.serial("WebSocket Concurrent Client Handling", () => {
  let server: VisualizationServer;
  let model: Model;
  let port: number;
  let wsUrl: string;
  let testDir: string;

  beforeAll(async () => {
    port = await portAllocator.allocatePort();
    testDir = getTestDir();
    model = await createTestModel(testDir);
    server = new VisualizationServer(model, { authEnabled: false });
    await server.start(port);
    wsUrl = `ws://localhost:${port}/ws`;
  });

  afterAll(async () => {
    server.stop();
    portAllocator.releasePort(port);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should handle multiple concurrent WebSocket connections", async () => {
    const clientCount = 5;
    const clients: WebSocket[] = [];

    return new Promise<void>(async (resolve, reject) => {
      // Create multiple concurrent connections
      for (let i = 0; i < clientCount; i++) {
        const ws = new WebSocket(wsUrl);
        clients.push(ws);

        ws.onerror = (error) => {
          reject(new Error(`Client ${i} error: ${error}`));
        };
      }

      // Wait for all connections to open
      const connectionPromises = clients.map((ws, i) => {
        return new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`Client ${i} connection timeout`));
          }, 5000);

          ws.onopen = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      });

      try {
        await Promise.all(connectionPromises);

        // Verify all are open
        expect(clients.every((ws) => ws.readyState === WebSocket.OPEN)).toBe(true);

        // Close all connections
        clients.forEach((ws) => ws.close());
        resolve();
      } catch (error) {
        clients.forEach((ws) => {
          if (ws.readyState === WebSocket.OPEN) ws.close();
        });
        reject(error);
      }
    });
  });


  it("should handle client disconnections without affecting others", async () => {
    let client1Closed = false;
    let client2Open = false;

    return new Promise<void>(async (resolve, reject) => {
      // Client 1
      const ws1 = new WebSocket(wsUrl);

      ws1.onopen = () => {
        // Client 1 closes
        ws1.close();
      };

      ws1.onclose = () => {
        client1Closed = true;
      };

      // Client 2
      const ws2 = new WebSocket(wsUrl);

      ws2.onopen = () => {
        client2Open = true;
      };

      ws2.onerror = (error) => {
        reject(error);
      };

      // Wait for both to be processed
      setTimeout(() => {
        expect(client1Closed).toBe(true);
        expect(client2Open).toBe(true);
        expect(ws2.readyState).toBe(WebSocket.OPEN);

        ws2.close();
        resolve();
      }, 2000);

      setTimeout(() => reject(new Error("Test timeout")), 10000);
    });
  });
});

describe.serial("WebSocket Subscription Management", () => {
  let server: VisualizationServer;
  let model: Model;
  let port: number;
  let wsUrl: string;
  let baseUrl: string;
  let testDir: string;

  beforeAll(async () => {
    port = await portAllocator.allocatePort();
    testDir = getTestDir();
    model = await createTestModel(testDir);
    server = new VisualizationServer(model, { authEnabled: false });
    await server.start(port);
    wsUrl = `ws://localhost:${port}/ws`;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    server.stop();
    portAllocator.releasePort(port);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should broadcast annotation create events to subscribed clients", async () => {
    return new Promise<void>(async (resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const messages: any[] = [];

      ws.onopen = () => {
        // Subscribe to annotations
        ws.send(JSON.stringify({ type: "subscribe", topics: ["annotations"] }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          messages.push(message);

          if (message.type === "annotation.added") {
            expect(message).toHaveProperty("elementId");
            expect(message).toHaveProperty("annotationId");
            ws.close();
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      };

      ws.onerror = (error) => {
        reject(error);
      };

      // Wait a moment for subscription to register, then create annotation
      setTimeout(async () => {
        try {
          await fetch(`${baseUrl}/api/annotations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              elementId: "motivation.goal.ws-1",
              author: "Test User",
              content: "Test annotation for event broadcast",
            }),
          });
        } catch (error) {
          reject(error);
        }
      }, 100);

      setTimeout(() => reject(new Error("Event broadcast timeout")), 8000);
    });
  });

  it("should broadcast annotation update events", async () => {
    return new Promise<void>(async (resolve, reject) => {
      // First, create an annotation
      const createRes = await fetch(`${baseUrl}/api/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          elementId: "motivation.goal.ws-2",
          author: "Test User",
          content: "Original content",
        }),
      });

      const createdAnnotation = await createRes.json();
      const annotationId = createdAnnotation.id;

      // Now connect WebSocket and listen for update event
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "subscribe", topics: ["annotations"] }));
      };

      ws.onerror = (error) => {
        reject(error);
      };

      // Wait a moment for subscription, then update annotation
      setTimeout(async () => {
        try {
          await fetch(`${baseUrl}/api/annotations/${annotationId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: "Updated content",
            }),
          });
        } catch (error) {
          reject(error);
        }
      }, 100);

      // Use helper to wait for specific message type
      try {
        const message = await waitForMessage(ws, "annotation.updated", 8000);
        expect(message).toHaveProperty("annotationId");
        ws.close();
        resolve();
      } catch (error) {
        ws.close();
        reject(error);
      }
    });
  });

  it("should broadcast annotation delete events", async () => {
    return new Promise<void>(async (resolve, reject) => {
      // Create annotation
      const createRes = await fetch(`${baseUrl}/api/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          elementId: "motivation.goal.ws-1",
          author: "Test User",
          content: "To be deleted",
        }),
      });

      const createdAnnotation = await createRes.json();
      const annotationId = createdAnnotation.id;

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "subscribe", topics: ["annotations"] }));
      };

      ws.onerror = (error) => {
        reject(error);
      };

      setTimeout(async () => {
        try {
          await fetch(`${baseUrl}/api/annotations/${annotationId}`, {
            method: "DELETE",
          });
        } catch (error) {
          reject(error);
        }
      }, 100);

      // Use helper to wait for specific message type
      try {
        const message = await waitForMessage(ws, "annotation.deleted", 8000);
        expect(message).toHaveProperty("annotationId");
        ws.close();
        resolve();
      } catch (error) {
        ws.close();
        reject(error);
      }
    });
  });

  it("should handle subscribe messages with topic list", async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "subscribe",
            topics: ["model", "annotations"],
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "subscribed") {
            expect(message).toHaveProperty("topics");
            expect(Array.isArray(message.topics)).toBe(true);
            ws.close();
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      };

      ws.onerror = (error) => {
        reject(error);
      };

      setTimeout(() => reject(new Error("Subscribe timeout")), 5000);
    });
  });

  it("should handle invalid JSON messages gracefully", async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        // Send invalid JSON
        ws.send("{ invalid json }");
        // Server should not crash, allow for error response
        setTimeout(() => {
          ws.close();
          resolve();
        }, 500);
      };

      ws.onerror = (error) => {
        // Some browsers may report error for invalid JSON
        ws.close();
        resolve();
      };

      setTimeout(() => reject(new Error("Invalid JSON test timeout")), 5000);
    });
  });

  it("should reject messages with invalid schema and return error response", async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let errorResponseReceived = false;

      ws.onopen = () => {
        // Send valid JSON but invalid WebSocket message schema
        // (missing required type or jsonrpc/method fields)
        ws.send(JSON.stringify({
          invalid: "message",
          extraField: "value"
        }));
      };

      ws.onmessage = (event) => {
        try {
          const response = JSON.parse(event.data);
          // Expect error response from server
          if (response.error === "Invalid message format") {
            expect(response).toHaveProperty("details");
            errorResponseReceived = true;
            ws.close();
            resolve();
          }
        } catch (error) {
          // Ignore parse errors
        }
      };

      ws.onerror = (error) => {
        reject(new Error(`WebSocket error: ${error}`));
      };

      // Timeout: if no error response received within timeout, fail the test
      setTimeout(() => {
        ws.close();
        reject(new Error("No error response received from server within timeout"));
      }, 5000);
    });
  });

  it("should handle malformed JSONRPC messages gracefully", async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let errorResponseReceived = false;

      ws.onopen = () => {
        // JSONRPC message missing required 'method' field (invalid as both request and response)
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          id: 1
          // Missing 'method' field for request, missing 'result'/'error' for response
        }));
      };

      ws.onmessage = (event) => {
        try {
          const response = JSON.parse(event.data);
          // Server should respond with error for validation failure
          if (response.error === "Invalid message format" && response.details) {
            expect(response).toHaveProperty("details");
            // Verify error describes the validation failure
            expect(response.details).toBeTruthy();
            errorResponseReceived = true;
            ws.close();
            resolve();
          }
        } catch (error) {
          // Ignore parse errors
        }
      };

      ws.onerror = (error) => {
        reject(new Error(`WebSocket error: ${error}`));
      };

      // Timeout: if no error response received within timeout, fail the test
      setTimeout(() => {
        ws.close();
        reject(new Error("No error response received from server within timeout"));
      }, 5000);
    });
  });
});
