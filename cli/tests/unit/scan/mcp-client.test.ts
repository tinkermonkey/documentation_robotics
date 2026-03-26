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
