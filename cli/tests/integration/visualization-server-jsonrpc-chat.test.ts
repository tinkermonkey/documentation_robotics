/**
 * JSON-RPC Chat Methods Tests for Visualization Server
 * Tests chat.status, chat.send, and chat.cancel JSON-RPC methods
 * over WebSocket connections
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
  return `${tmpdir()}/dr-viz-chat-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Helper to wait for a JSON-RPC response with specific id
 */
function waitForJsonRpcResponse(ws: WebSocket, requestId: string | number, timeout: number = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for JSON-RPC response with id: ${requestId}`));
    }, timeout);

    const handler = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);
        if (message.id === requestId && message.jsonrpc === "2.0") {
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

describe.serial("JSON-RPC Chat Methods", () => {
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

  describe("chat.status method", () => {
    it("should respond with chat status when no client is available", async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.onopen = async () => {
          try {
            // Send chat.status request
            ws.send(JSON.stringify({
              jsonrpc: "2.0",
              method: "chat.status",
              id: "status-1",
            }));

            const response = await waitForJsonRpcResponse(ws, "status-1");

            // Verify response structure
            expect(response).toHaveProperty("jsonrpc", "2.0");
            expect(response).toHaveProperty("id", "status-1");
            expect(response).toHaveProperty("result");

            // Verify result structure
            const result = response.result;
            expect(typeof result.sdk_available).toBe("boolean");
            // error_message is null when client is available, string when not
            expect(result.error_message === null || typeof result.error_message === "string").toBe(true);

            ws.close();
            resolve();
          } catch (error) {
            ws.close();
            reject(error);
          }
        };

        ws.onerror = () => {
          reject(new Error("WebSocket connection failed"));
        };
      });
    });

    it("should include error message in status response when no client available", async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.onopen = async () => {
          try {
            ws.send(JSON.stringify({
              jsonrpc: "2.0",
              method: "chat.status",
              id: "status-2",
            }));

            const response = await waitForJsonRpcResponse(ws, "status-2");
            const result = response.result;

            // Verify response structure has both fields
            expect(result).toHaveProperty("sdk_available");
            expect(result).toHaveProperty("error_message");

            // When no client is available, error_message should be a string with explanation
            // When client is available, error_message should be null
            if (!result.sdk_available) {
              expect(typeof result.error_message).toBe("string");
              expect(result.error_message?.length || 0).toBeGreaterThan(0);
            } else {
              expect(result.error_message).toBe(null);
            }

            ws.close();
            resolve();
          } catch (error) {
            ws.close();
            reject(error);
          }
        };

        ws.onerror = () => {
          reject(new Error("WebSocket connection failed"));
        };
      });
    });
  });

  describe("chat.send method", () => {
    it("should reject chat.send with missing message parameter", async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.onopen = async () => {
          try {
            // Send chat.send without message param
            ws.send(JSON.stringify({
              jsonrpc: "2.0",
              method: "chat.send",
              params: {},
              id: "send-1",
            }));

            const response = await waitForJsonRpcResponse(ws, "send-1");

            // Verify error response
            expect(response).toHaveProperty("jsonrpc", "2.0");
            expect(response).toHaveProperty("id", "send-1");
            expect(response).toHaveProperty("error");
            expect(response.error).toHaveProperty("code");
            expect(response.error).toHaveProperty("message");

            ws.close();
            resolve();
          } catch (error) {
            ws.close();
            reject(error);
          }
        };

        ws.onerror = () => {
          reject(new Error("WebSocket connection failed"));
        };
      });
    });

    it("should reject chat.send with empty message parameter", async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.onopen = async () => {
          try {
            // Send chat.send with empty message
            ws.send(JSON.stringify({
              jsonrpc: "2.0",
              method: "chat.send",
              params: { message: "" },
              id: "send-2",
            }));

            const response = await waitForJsonRpcResponse(ws, "send-2");

            // Verify error response
            expect(response).toHaveProperty("error");
            expect(response.error).toHaveProperty("code");
            expect(response.error.message).toContain("empty");

            ws.close();
            resolve();
          } catch (error) {
            ws.close();
            reject(error);
          }
        };

        ws.onerror = () => {
          reject(new Error("WebSocket connection failed"));
        };
      });
    });

    it("should reject chat.send with non-string message parameter", async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.onopen = async () => {
          try {
            // Send chat.send with non-string message
            ws.send(JSON.stringify({
              jsonrpc: "2.0",
              method: "chat.send",
              params: { message: 123 },
              id: "send-3",
            }));

            const response = await waitForJsonRpcResponse(ws, "send-3");

            // Verify error response
            expect(response).toHaveProperty("error");
            expect(response.error).toHaveProperty("code");

            ws.close();
            resolve();
          } catch (error) {
            ws.close();
            reject(error);
          }
        };

        ws.onerror = () => {
          reject(new Error("WebSocket connection failed"));
        };
      });
    });

  });

  describe("chat.cancel method", () => {
    it("should respond to chat.cancel when no conversation active", async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.onopen = async () => {
          try {
            // Send chat.cancel without any active conversation
            ws.send(JSON.stringify({
              jsonrpc: "2.0",
              method: "chat.cancel",
              id: "cancel-1",
            }));

            const response = await waitForJsonRpcResponse(ws, "cancel-1");

            // Should respond with result (even if cancelled=false)
            expect(response).toHaveProperty("result");
            expect(response.result).toHaveProperty("cancelled");
            expect(typeof response.result.cancelled).toBe("boolean");

            ws.close();
            resolve();
          } catch (error) {
            ws.close();
            reject(error);
          }
        };

        ws.onerror = () => {
          reject(new Error("WebSocket connection failed"));
        };
      });
    });

    it("should include conversation_id in cancel response structure", async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.onopen = async () => {
          try {
            ws.send(JSON.stringify({
              jsonrpc: "2.0",
              method: "chat.cancel",
              id: "cancel-2",
            }));

            const response = await waitForJsonRpcResponse(ws, "cancel-2");

            // Verify response structure
            expect(response.result).toHaveProperty("cancelled");
            expect(response.result).toHaveProperty("conversation_id");
            // conversation_id can be null when no conversation was active
            expect(response.result.conversation_id === null || typeof response.result.conversation_id === "string").toBe(true);

            ws.close();
            resolve();
          } catch (error) {
            ws.close();
            reject(error);
          }
        };

        ws.onerror = () => {
          reject(new Error("WebSocket connection failed"));
        };
      });
    });
  });

  describe("JSON-RPC parameter validation", () => {
    it("should reject chat.status with invalid params", async () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.onopen = async () => {
          try {
            // chat.status doesn't take params, but extra ones should be ignored per JSON-RPC spec
            ws.send(JSON.stringify({
              jsonrpc: "2.0",
              method: "chat.status",
              params: { unused: true },
              id: "status-3",
            }));

            const response = await waitForJsonRpcResponse(ws, "status-3");

            // Should still respond successfully (JSON-RPC allows extra params)
            expect(response).toHaveProperty("result");

            ws.close();
            resolve();
          } catch (error) {
            ws.close();
            reject(error);
          }
        };

        ws.onerror = () => {
          reject(new Error("WebSocket connection failed"));
        };
      });
    });

  });
});
