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
      // Special handling for batch_analysis: execute queries in sequence
      if (toolName === "batch_analysis") {
        const queries = args.queries as Array<{ patternId: string; tool: string; params: Record<string, unknown> }> | undefined;
        if (!queries || !Array.isArray(queries)) {
          return [
            {
              type: "error",
              text: "batch_analysis requires a 'queries' array parameter",
            },
          ];
        }

        // Execute each query and collect results in order
        const batchResults: ToolResult[] = [];
        for (const query of queries) {
          try {
            // Recursively call the tool specified in this query
            const result = await this.callTool(query.tool, query.params);
            // Add the results for this query to the batch results
            batchResults.push(...result);
          } catch (error) {
            // Transport errors should propagate, not be converted to error results
            // This ensures that connection failures fail the entire scan
            if (error instanceof Error && isTransportError(error)) {
              throw error;
            }
            // For non-transport errors, include error in batch results
            const errorMessage = error instanceof Error ? error.message : String(error);
            batchResults.push({
              type: "error",
              text: errorMessage,
            });
          }
        }
        return batchResults;
      }

      // If this tool should throw an error (for testing failures)
      if (toolErrors[toolName]) {
        const error = toolErrors[toolName];

        // Detect and wrap transport errors just like the real client does.
        // Transport errors (connection lost, timeouts, process crash) should include
        // tool context so callers can provide better error messages.
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
