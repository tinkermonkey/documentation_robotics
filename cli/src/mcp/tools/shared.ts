/**
 * Shared helpers for MCP model tool handlers.
 *
 * Centralizes model loading and the CLIError -> structured error content
 * translation so individual tool handlers stay focused on their own domain
 * logic.
 */

import { z, type ZodRawShape } from "zod";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { CallToolResult, RequestId } from "@modelcontextprotocol/sdk/types.js";
import { Model } from "../../core/model.js";
import {
  CLIError,
  ModelNotFoundError,
  getErrorMessage,
  type ErrorContext,
} from "../../utils/errors.js";
import { ChangesetOnlyError } from "../../core/changeset-only-guard.js";
import { changesetOnlyError } from "../changeset-only.js";
import { whenProjectRootSettled } from "../project-root.js";

/** Shared input field: lets a client point at a model outside the server's cwd. */
export const rootPathSchema = z
  .string()
  .optional()
  .describe(
    "Absolute path to the project root containing documentation-robotics/. Defaults to the project the client has open (its MCP roots), else the MCP server's working directory."
  );

/**
 * What the registry hands a handler besides its arguments: the session's low-level server, so a
 * tool can ask the client something (changeset_commit's confirmation elicitation), and the
 * tools/call request it answers, so that request travels with it. Absent when a handler is called
 * directly.
 */
export interface McpToolContext {
  server?: Server;
  requestId?: RequestId;
  signal?: AbortSignal;
}

export interface McpToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  /** Listed with the tool in tools/list (e.g. "anthropic/requiresUserInteraction"). */
  _meta?: Record<string, unknown>;
  // Method-shorthand (not an arrow-typed property) so tool definitions with
  // differently-shaped Args can share the heterogeneous MODEL_TOOLS array in
  // tool-registry.ts without a manual cast back to `any` at the storage site.
  handler(args: z.infer<z.ZodObject<Shape>>, context?: McpToolContext): Promise<CallToolResult>;
}

/**
 * Per-rootPath cache of the loaded architecture model, held for the lifetime of the
 * MCP server process: the Model is loaded once and reused across tool calls rather
 * than reread from disk on every invocation. Keyed by the raw `rootPath` argument
 * (`""` for the server's default cwd), matching how MCP clients address a model
 * across calls.
 */
const modelCache = new Map<string, Promise<Model>>();

function modelCacheKey(rootPath?: string): string {
  return rootPath ?? "";
}

/** Test-only escape hatch: clears the module-private model cache between test cases. */
export function clearModelCache(): void {
  modelCache.clear();
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
  // The default project may still be resolving from the client's roots.
  if (rootPath === undefined) await whenProjectRootSettled();
  const key = modelCacheKey(rootPath);
  const cached = modelCache.get(key);
  if (cached) {
    return cached;
  }

  const promise = readModelFromDisk(rootPath);
  modelCache.set(key, promise);
  evictOnFailure(key, promise);
  return promise;
}

/** Forces a fresh read from disk, replacing any cached instance for this rootPath. */
export async function reloadModel(rootPath?: string): Promise<Model> {
  if (rootPath === undefined) await whenProjectRootSettled();
  const key = modelCacheKey(rootPath);
  const promise = readModelFromDisk(rootPath);
  modelCache.set(key, promise);
  evictOnFailure(key, promise);
  return promise;
}

/**
 * Don't let a failed load poison the cache for subsequent (possibly-fixed) calls.
 * Guarded by identity: if a newer promise has since replaced this one for `key`
 * (e.g. a concurrent reloadModel()), a stale rejection must not evict it.
 */
function evictOnFailure(key: string, promise: Promise<Model>): void {
  promise.catch(() => {
    if (modelCache.get(key) === promise) {
      modelCache.delete(key);
    }
  });
}

/**
 * Wraps structured data as the tool's JSON text content. `compact` keeps the indentation of the
 * outer structure but writes any object or array that fits on a line on one line (the same JSON,
 * a fraction of the lines), for large results such as the brief.
 */
export function jsonResult(data: unknown, options?: { isError?: boolean; compact?: boolean }): CallToolResult {
  return {
    content: [{ type: "text", text: options?.compact ? compactJson(data) : JSON.stringify(data, null, 2) }],
    ...(options?.isError ? { isError: true } : {}),
  };
}

const COMPACT_LINE = 140;

/** JSON indented by two spaces, with every object or array whose one-line form is short kept on one line. */
export function compactJson(data: unknown): string {
  const write = (raw: unknown, indent: string): string | undefined => {
    const value =
      raw !== null && typeof raw === "object" && typeof (raw as { toJSON?: unknown }).toJSON === "function"
        ? (raw as { toJSON: () => unknown }).toJSON()
        : raw;
    const inline = JSON.stringify(value);
    if (inline === undefined || value === null || typeof value !== "object") return inline;
    if (inline.length + indent.length <= COMPACT_LINE) return inline;
    const inner = indent + "  ";
    if (Array.isArray(value)) {
      const items = value.map((item) => inner + (write(item, inner) ?? "null"));
      return `[\n${items.join(",\n")}\n${indent}]`;
    }
    const fields = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const text = write(item, inner);
        return text === undefined ? undefined : `${inner}${JSON.stringify(key)}: ${text}`;
      })
      .filter((line): line is string => line !== undefined);
    return `{\n${fields.join(",\n")}\n${indent}}`;
  };
  return write(data, "") ?? "null";
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
    if (error instanceof ChangesetOnlyError) {
      // A base-model save was refused (DR_CHANGESET_ONLY) after the handler may already have
      // edited the cached model in memory: drop the cache so the next call rereads disk, and
      // answer in MCP terms (changeset_create) rather than CLI ones.
      clearModelCache();
      return errorResult(changesetOnlyError());
    }
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
