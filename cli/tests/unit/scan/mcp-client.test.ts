import { describe, it, expect } from "bun:test";
import { validateConnection, disconnectMcpClient } from "../../../src/scan/mcp-client.js";

describe("MCP Client", () => {
  describe("validateConnection", () => {
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
    it("should call disconnect on the client", async () => {
      let disconnectCalled = false;
      const client = {
        get isConnected(): boolean {
          return false; // Mock is already disconnected
        },
        endpoint: "test",
        disconnect: async () => {
          disconnectCalled = true;
        },
      };

      await disconnectMcpClient(client);
      expect(disconnectCalled).toBe(true);
    });
  });
});
