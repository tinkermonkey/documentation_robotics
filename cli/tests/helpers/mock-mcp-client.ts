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
import { getErrorMessage } from "../../src/utils/errors.js";

// Tool type definition for mock purposes
type Tool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

/**
 * Detects if an error is a transport/infrastructure failure (matching real client logic).
 * This allows mock client to behave like the real client for testing error handling.
 *
 * @param error - The error to check
 * @returns true if this is a transport/infrastructure error
 */
function isTransportError(error: unknown): boolean {
  if (!error) return false;

  const errorMsg = getErrorMessage(error);
  const errorCode = (error as any)?.code || "";

  // Explicit error codes indicating transport failure
  if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EHOSTUNREACH"].includes(errorCode)) {
    return true;
  }

  // Message patterns indicating transport failure
  if (
    errorMsg.includes("disconnected") ||
    errorMsg.includes("connection closed") ||
    errorMsg.includes("ECONNREFUSED") ||
    errorMsg.includes("ECONNRESET") ||
    errorMsg.includes("refused") ||
    errorMsg.includes("reset by peer") ||
    errorMsg.includes("broken pipe") ||
    errorMsg.includes("EPIPE")
  ) {
    return true;
  }

  return false;
}

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
      // If this tool should throw an error (for testing transport failures)
      if (toolErrors[toolName]) {
        const error = toolErrors[toolName];

        // Apply same transport error wrapping logic as real client
        if (isTransportError(error)) {
          const errorMsg = getErrorMessage(error);
          throw new Error(
            `CodePrism connection lost while calling '${toolName}': ${errorMsg}\n\n` +
              "The MCP server may have crashed, become unreachable, or been terminated.\n" +
              "Remaining scan results are unreliable and the scan cannot continue."
          );
        }

        // For non-transport errors, throw as-is
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
