/**
 * MCP Client Connection Tests
 *
 * Tests for CodePrism MCP client initialization, connection validation,
 * and tool invocation. These tests verify FR-1 and FR-1.3 requirements.
 */

import { describe, it, expect } from "bun:test";
import type { MCPClient, ScanConfig } from "../../src/scan/mcp-client.js";
import { createMockMcpClient } from "../helpers/mock-mcp-client.js";

describe("MCP Client", () => {
  describe("Tool Invocation", () => {
    it("should call tools and return results", async () => {
      const mockResults = [
        {
          type: "text" as const,
          text: JSON.stringify([
            { path: "/api/users", method: "GET", operationId: "getUsers" },
            { path: "/api/users/:id", method: "GET", operationId: "getUser" },
          ]),
        },
      ];

      const client = createMockMcpClient({
        search_code: mockResults,
      });

      const results = await client.callTool("search_code", {
        pattern: "(app|router)\\.(get|post)",
        language: "javascript",
      });

      expect(results).toBeDefined();
      expect(results.length).toBe(1);
      expect(results[0].type).toBe("text");

      if (results[0].text) {
        const parsed = JSON.parse(results[0].text);
        expect(parsed).toHaveLength(2);
        expect(parsed[0].path).toBe("/api/users");
      }
    });

    it("should handle error results from tools (tool-level errors)", async () => {
      const mockResults = [
        {
          type: "error" as const,
          text: "Tool not found",
        },
      ];

      const client = createMockMcpClient({
        unknown_tool: mockResults,
      });

      const results = await client.callTool("unknown_tool", {});

      expect(results).toBeDefined();
      expect(results[0].type).toBe("error");
      expect(results[0].text).toBe("Tool not found");
    });

    it("should throw transport errors that indicate connection loss", async () => {
      // Create a mock client that throws a transport error when a tool is called
      const transportError = new Error("ECONNREFUSED: Connection refused");
      const client = createMockMcpClient(
        {}, // no normal results
        { search_code: transportError } // this tool throws transport error
      );

      try {
        await client.callTool("search_code", {});
        throw new Error("Should have thrown a transport error");
      } catch (error) {
        // Verify it's a transport error (error should be thrown, not converted to ToolResult)
        expect(error instanceof Error).toBe(true);
        const message = (error as Error).message;
        // Should contain "connection lost" (from wrapped error message) and tool name
        expect(message).toContain("connection lost");
        expect(message).toContain("search_code");
      }
    });

    it("should throw when MCP server crashes mid-operation", async () => {
      const crashError = new Error("EPIPE: broken pipe");
      const client = createMockMcpClient(
        {},
        { analyze_api_surface: crashError }
      );

      try {
        await client.callTool("analyze_api_surface", {});
        throw new Error("Should have thrown");
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        const message = (error as Error).message;
        // Should contain "connection lost" and reference the tool name
        expect(message).toContain("connection lost");
        expect(message).toContain("analyze_api_surface");
      }
    });

    it("should list available tools", async () => {
      const client = createMockMcpClient();

      const tools = await client.listTools();

      expect(tools).toBeDefined();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === "search_code")).toBe(true);
    });
  });

  describe("Connection State", () => {
    it("should start as connected for mock client", async () => {
      const client = createMockMcpClient();

      expect(client.isConnected).toBe(true);
      expect(client.endpoint).toBe("mock://codeprism");
    });

    it("should disconnect cleanly", async () => {
      const client = createMockMcpClient();

      expect(client.isConnected).toBe(true);

      await client.disconnect();

      expect(client.isConnected).toBe(false);
    });
  });
});
