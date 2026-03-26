/**
 * Mock MCP Client for testing
 *
 * Provides a mock implementation of MCPClient that returns synthetic matches
 * for testing the pattern execution pipeline without requiring CodePrism.
 */

import type { MCPClient, ToolResult } from "../../src/scan/mcp-client.js";

// Tool type definition for mock purposes
type Tool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

/**
 * Create a mock MCP client for testing
 *
 * @param toolResults - Map of tool names to mock result arrays
 * @returns Mock MCPClient implementation
 */
export function createMockMcpClient(
  toolResults: Record<string, ToolResult[]> = {}
): MCPClient {
  return {
    isConnected: true,
    endpoint: "mock://codeprism",

    async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult[]> {
      if (toolResults[toolName]) {
        return toolResults[toolName];
      }

      // Default: return empty matches
      return [
        {
          type: "text",
          text: JSON.stringify([]),
        },
      ];
    },

    async listTools(): Promise<Tool[]> {
      // Return a minimal set of mocked tools
      return [
        {
          name: "search_code",
          description: "Search code by pattern",
          inputSchema: {
            type: "object",
            properties: {
              pattern: { type: "string" },
              language: { type: "string" },
            },
          },
        },
        {
          name: "find_dependencies",
          description: "Find dependencies for a symbol",
          inputSchema: {
            type: "object",
            properties: {
              symbolId: { type: "string" },
            },
          },
        },
      ];
    },

    async disconnect(): Promise<void> {
      this.isConnected = false;
    },
  };
}
