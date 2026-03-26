import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createMcpClient, validateConnection, disconnectMcpClient } from "../../../src/scan/mcp-client.js";

describe("MCP Client", () => {
  describe("createMcpClient", () => {
    it("should throw error when codeprism config is missing", async () => {
      try {
        await createMcpClient({});
        throw new Error("Should have thrown");
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain("Missing scan configuration");
      }
    });

    it("should throw error when codeprism binary not found", async () => {
      try {
        await createMcpClient({
          codeprism: {
            command: "nonexistent-binary-xyz-12345",
          },
        });
        throw new Error("Should have thrown");
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        // Check for either "binary not found" or spawn/execution error messages
        const message = (error as Error).message;
        expect(
          message.includes("CodePrism binary not found") ||
          message.includes("nonexistent-binary-xyz-12345") ||
          message.includes("Failed to access CodePrism binary")
        ).toBe(true);
      }
    });

    it("should create client when codeprism binary is available", async () => {
      // Test with a binary that exists (e.g., 'node')
      const client = await createMcpClient({
        codeprism: {
          command: "node",
          args: ["--version"],
          timeout: 5000,
        },
      });

      expect(client).toBeDefined();
      expect(client.isConnected).toBe(false);
      expect(client.endpoint).toBeDefined();
    });
  });

  describe("validateConnection", () => {
    it("should mark client as connected when validation passes", async () => {
      const client = await createMcpClient({
        codeprism: {
          command: "node",
          args: ["--version"],
        },
      });

      await validateConnection(client);
      expect(client.isConnected).toBe(true);
    });

    it("should throw error when client endpoint is missing", async () => {
      const client = { isConnected: false };
      try {
        await validateConnection(client as any);
        throw new Error("Should have thrown");
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain("not properly configured");
      }
    });
  });

  describe("disconnectMcpClient", () => {
    it("should mark client as disconnected", async () => {
      const client = {
        isConnected: true,
        endpoint: "test",
        disconnect: async () => {},
      };

      await disconnectMcpClient(client);
      expect(client.isConnected).toBe(false);
    });
  });
});
