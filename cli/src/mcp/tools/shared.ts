/**
 * Shared helpers for MCP model tool handlers.
 *
 * Centralizes model loading and the CLIError -> structured error content
 * translation (Domain Logic Invocation / Error Handling patterns from the
 * architecture design) so individual tool handlers stay focused on their
 * own domain logic.
 */

import { z, type ZodRawShape } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Model } from "../../core/model.js";
import type { ModelOptions } from "../../types/index.js";
import { CLIError, getErrorMessage, type ErrorContext } from "../../utils/errors.js";

/** Shared input field: lets a client point at a model outside the server's cwd. */
export const rootPathSchema = z
  .string()
  .optional()
  .describe(
    "Absolute path to the project root containing documentation-robotics/. Defaults to the MCP server's working directory."
  );

export interface McpToolDefinition<Args = any> {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (args: Args) => Promise<CallToolResult>;
}

/** Loads the architecture model, translating "no model found" into a CLIError consistently. */
export async function loadModel(rootPath?: string, options?: ModelOptions): Promise<Model> {
  return Model.load(rootPath, options);
}

/** Wraps structured data as the tool's JSON text content. */
export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/** Converts a thrown error into a structured, non-throwing tool error result. */
export function errorResult(error: unknown): CallToolResult {
  if (error instanceof CLIError) {
    const context: ErrorContext | undefined = error.context;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: error.message,
              category: errorCategoryName(error.exitCode),
              suggestions: error.suggestions ?? [],
              ...(context?.operation ? { operation: context.operation } : {}),
              ...(context?.relatedElements ? { relatedElements: context.relatedElements } : {}),
              ...(context?.partialProgress ? { partialProgress: context.partialProgress } : {}),
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ error: getErrorMessage(error) }, null, 2) }],
    isError: true,
  };
}

function errorCategoryName(exitCode: number): string {
  switch (exitCode) {
    case 1:
      return "user";
    case 2:
      return "not_found";
    case 3:
      return "system";
    case 4:
      return "validation";
    case 5:
      return "breaking_change";
    default:
      return "unknown";
  }
}

/** Runs a tool handler body, catching any error into a structured tool result instead of throwing. */
export async function runTool(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    return errorResult(error);
  }
}
