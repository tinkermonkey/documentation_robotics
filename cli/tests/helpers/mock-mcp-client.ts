/**
 * Mock MCP Client for testing
 *
 * Provides a mock implementation of MCPClient that returns synthetic matches
 * for testing the pattern execution pipeline without requiring CodePrism.
 *
 * Includes transport error detection matching the real MCP client implementation,
 * so tests can verify proper error handling for connection failures vs tool-level errors.
 */

import type { MCPClient, ToolResult } from "../../src/scan/mcp-client.js";
import { isTransportError } from "../../src/scan/mcp-client.js";
import { getErrorMessage } from "../../src/utils/errors.js";

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
 * @param toolErrors - Map of tool names to errors they should throw (for testing transport errors)
 * @returns Mock MCPClient implementation
 */
export function createMockMcpClient(
  toolResults: Record<string, ToolResult[]> = {},
  toolErrors: Record<string, Error> = {}
): MCPClient {
  return {
    isConnected: true,
    endpoint: "mock://codeprism",

    async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult[]> {
      // If this tool should throw an error (for testing failures)
      if (toolErrors[toolName]) {
        const error = toolErrors[toolName];

        // Throw the raw error without wrapping. Transport error detection and wrapping
        // is the responsibility of the real client's callTool method (mcp-client.ts).
        // The mock only needs to throw what was configured; tests verify that
        // transport errors propagate correctly from the real client logic.
        throw error;
      }

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
