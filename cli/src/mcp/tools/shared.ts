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
import {
  CLIError,
  ModelNotFoundError,
  getErrorMessage,
  type ErrorContext,
} from "../../utils/errors.js";

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

/**
 * Per-rootPath cache of the loaded architecture model, held for the lifetime of the
 * MCP server process (see the architecture design's Model Lifecycle: the Model is
 * loaded once and reused across tool calls rather than reread from disk on every
 * invocation). Keyed by the raw `rootPath` argument (`""` for the server's default
 * cwd), matching how MCP clients address a model across calls.
 */
const modelCache = new Map<string, Promise<Model>>();

function modelCacheKey(rootPath?: string): string {
  return rootPath ?? "";
}

/** Reads the model fresh from disk, translating "no model found" into a CLIError consistently. */
async function readModelFromDisk(rootPath?: string): Promise<Model> {
  try {
    // Always a full, non-lazy load: the cached instance must be able to answer any
    // tool call regardless of which layers/options the first caller happened to need.
    return await Model.load(rootPath, { lazyLoad: false });
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }
    const message = getErrorMessage(error).toLowerCase();
    if (
      message.includes("no dr project") ||
      message.includes("model not found") ||
      message.includes("no model found")
    ) {
      throw new ModelNotFoundError(rootPath);
    }
    throw error;
  }
}

/** Returns the cached model for this rootPath, loading it from disk on first use. */
export async function loadModel(rootPath?: string): Promise<Model> {
  const key = modelCacheKey(rootPath);
  const cached = modelCache.get(key);
  if (cached) {
    return cached;
  }

  const promise = readModelFromDisk(rootPath);
  modelCache.set(key, promise);
  // Don't let a failed load poison the cache for subsequent (possibly-fixed) calls.
  promise.catch(() => modelCache.delete(key));
  return promise;
}

/** Forces a fresh read from disk, replacing any cached instance for this rootPath. */
export async function reloadModel(rootPath?: string): Promise<Model> {
  const key = modelCacheKey(rootPath);
  const promise = readModelFromDisk(rootPath);
  modelCache.set(key, promise);
  promise.catch(() => modelCache.delete(key));
  return promise;
}

/** Wraps structured data as the tool's JSON text content. */
export function jsonResult(data: unknown, options?: { isError?: boolean }): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    ...(options?.isError ? { isError: true } : {}),
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
    logToolError(error);
    return errorResult(error);
  }
}

/**
 * Logs a tool failure to stderr unconditionally (independent of telemetry
 * settings, which are off by default) so server operators have visibility
 * into failures. Non-CLIError exceptions include their stack trace, since
 * that's otherwise discarded once errorResult() reduces them to a message.
 */
function logToolError(error: unknown): void {
  if (error instanceof CLIError) {
    console.error(`[mcp] tool error: ${error.message}`);
  } else if (error instanceof Error) {
    console.error(`[mcp] tool error: ${error.stack ?? error.message}`);
  } else {
    console.error(`[mcp] tool error: ${getErrorMessage(error)}`);
  }
}
