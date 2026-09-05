/**
 * WebSocket Authentication Tests for Visualization Server
 * Tests WebSocket connections with authentication enabled to ensure token handling works correctly
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
  return `${tmpdir()}/dr-viz-websocket-auth-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Helper to wait for a WebSocket event
 */
function waitForEvent(
  ws: WebSocket,
  eventType: "open" | "close" | "error",
  timeout: number = 5000
): Promise<Event | CloseEvent | ErrorEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${eventType} event`));
    }, timeout);

    const handler = (event: Event | CloseEvent | ErrorEvent) => {
      ws.removeEventListener(eventType, handler as any);
      clearTimeout(timer);
      resolve(event);
    };

    ws.addEventListener(eventType, handler as any);
  });
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

describe.serial("WebSocket Authentication", () => {
  let server: VisualizationServer;
  let model: Model;
  let port: number;
  let authToken: string;
  let testDir: string;

  beforeAll(async () => {
    port = await portAllocator.allocatePort();
    testDir = getTestDir();
    model = await createTestModel(testDir);

    // Create server with authentication enabled and custom token
    authToken = "test-token-12345";
    server = new VisualizationServer(model, {
      authEnabled: true,
      authToken,
    });

    await server.start(port);
  });

  afterAll(async () => {
    server.stop();
    portAllocator.releasePort(port);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should reject WebSocket connection without token", async () => {
    const wsUrl = `ws://localhost:${port}/ws`;
    const ws = new WebSocket(wsUrl);

    // Wait for connection to fail (should get error or close event)
    const result = await Promise.race([
      waitForEvent(ws, "open").then(() => "opened"),
      waitForEvent(ws, "close").then(() => "closed"),
      waitForEvent(ws, "error").then(() => "error"),
    ]);

    // Connection should fail (not open successfully)
    expect(result).not.toBe("opened");

    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  it("should reject WebSocket connection with invalid token", async () => {
    const wsUrl = `ws://localhost:${port}/ws?token=invalid-token`;
    const ws = new WebSocket(wsUrl);

    const result = await Promise.race([
      waitForEvent(ws, "open").then(() => "opened"),
      waitForEvent(ws, "close").then(() => "closed"),
      waitForEvent(ws, "error").then(() => "error"),
    ]);

    // Connection should fail
    expect(result).not.toBe("opened");

    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  it("should accept WebSocket connection with valid token", async () => {
    const wsUrl = `ws://localhost:${port}/ws?token=${authToken}`;
    const ws = new WebSocket(wsUrl);

    // Wait for successful connection
    await waitForEvent(ws, "open");

    expect(ws.readyState).toBe(WebSocket.OPEN);

    // Should receive connected message
    const connectedMsg = await waitForMessage(ws, "connected");
    expect(connectedMsg.type).toBe("connected");
    expect(connectedMsg).toHaveProperty("version");

    ws.close();
  });

  it("should allow authenticated client to subscribe", async () => {
    const wsUrl = `ws://localhost:${port}/ws?token=${authToken}`;
    const ws = new WebSocket(wsUrl);

    await waitForEvent(ws, "open");

    // Send subscribe message
    ws.send(JSON.stringify({ type: "subscribe" }));

    // Should not receive error
    const result = await Promise.race([
      waitForMessage(ws, "error", 2000).then(() => "error"),
      new Promise<string>((resolve) => setTimeout(() => resolve("no-error"), 1500)),
    ]);

    expect(result).toBe("no-error");

    ws.close();
  });

  it("should allow authenticated client to ping", async () => {
    const wsUrl = `ws://localhost:${port}/ws?token=${authToken}`;
    const ws = new WebSocket(wsUrl);

    await waitForEvent(ws, "open");

    // Send ping
    ws.send(JSON.stringify({ type: "ping" }));

    // Should receive pong
    const pongMsg = await waitForMessage(ws, "pong");
    expect(pongMsg.type).toBe("pong");

    ws.close();
  });

  it("should handle token in different URL formats", async () => {
    // Test with encoded token
    const encodedToken = encodeURIComponent(authToken);
    const wsUrl = `ws://localhost:${port}/ws?token=${encodedToken}`;
    const ws = new WebSocket(wsUrl);

    await waitForEvent(ws, "open");

    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
  });
});

describe.serial("WebSocket Authentication Edge Cases", () => {
  let server: VisualizationServer;
  let model: Model;
  let port: number;
  let testDir: string;

  beforeAll(async () => {
    port = await portAllocator.allocatePort();
    testDir = getTestDir();
    model = await createTestModel(testDir);

    // Server with authentication but no custom token (auto-generated)
    server = new VisualizationServer(model, {
      authEnabled: true,
    });

    await server.start(port);
  });

  afterAll(async () => {
    server.stop();
    portAllocator.releasePort(port);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should work with auto-generated token", async () => {
    const autoToken = server.getAuthToken();
    expect(autoToken).toBeTruthy();
    expect(autoToken.length).toBeGreaterThan(0);

    const wsUrl = `ws://localhost:${port}/ws?token=${autoToken}`;
    const ws = new WebSocket(wsUrl);

    await waitForEvent(ws, "open");

    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
  });

  it("should reject empty token parameter", async () => {
    const wsUrl = `ws://localhost:${port}/ws?token=`;
    const ws = new WebSocket(wsUrl);

    const result = await Promise.race([
      waitForEvent(ws, "open").then(() => "opened"),
      waitForEvent(ws, "close").then(() => "closed"),
      waitForEvent(ws, "error").then(() => "error"),
    ]);

    expect(result).not.toBe("opened");

    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });
});
