/**
 * Shared helpers for MCP model tool handlers.
 *
 * Centralizes model loading and the CLIError -> structured error content
 * translation so individual tool handlers stay focused on their own domain
 * logic.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import path from "node:path";
import { z, type ZodRawShape } from "zod";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { CallToolResult, RequestId } from "@modelcontextprotocol/sdk/types.js";
import { Model } from "../../core/model.js";
import { StagedChangesetStorage } from "../../core/staged-changeset-storage.js";
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
 * Per-rootPath cache of the loaded architecture model, held for the lifetime of the MCP server
 * process: the Model is read once and reused across tool calls while the files it was read from
 * are unchanged. Keyed by the raw `rootPath` argument (`""` for the server's default cwd),
 * matching how MCP clients address a model across calls.
 *
 * The model can change outside this process (a changeset landed in the viewer or with
 * `dr changeset commit`, `dr changeset activate` in a terminal, a pull, a hand edit), so each
 * entry keeps a {@link modelFingerprint} of those files and `loadModel` rereads the model when it
 * no longer matches. The server's own writes go to disk as they are made (base-model saves and
 * staged changes alike), so a reread after one keeps them.
 */
interface CachedModel {
  promise: Promise<Model>;
  /** The project root the model was read from; undefined until the first read of this key resolves. */
  root?: string;
  /** The fingerprint of the model's files when they were read. */
  fingerprint?: string | null;
}

const modelCache = new Map<string, CachedModel>();

function modelCacheKey(rootPath?: string): string {
  return rootPath ?? "";
}

/** Test-only escape hatch: clears the module-private model cache between test cases. */
export function clearModelCache(): void {
  modelCache.clear();
}

/** Path, mtime and size of every file under `dir`, sorted; empty when `dir` is missing. */
function fileStamps(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const stamps: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    try {
      const st = statSync(file);
      stamps.push(`${path.relative(dir, file)}\t${st.mtimeMs}\t${st.size}`);
    } catch {
      // Removed between the listing and the stat: the next check sees the listing without it.
    }
  }
  return stamps.sort();
}

/**
 * A fingerprint of the files `Model.load` reads for the project at `projectRoot`: everything under
 * the model directory (manifest, layers, relationships), the active-changeset marker, and the active
 * changeset's own files (a loaded model projects it). Stat'ing them is cheap next to a reread, and
 * synchronous so a read's fingerprint is taken in the same tick the read starts. Null when the
 * files can't be read (a read would fail too); two nulls compare equal.
 */
function modelFingerprint(projectRoot: string): string | null {
  try {
    const drDir = path.join(projectRoot, "documentation-robotics");
    // The standard layout, else a model whose manifest sits in the project root itself. Neither:
    // the model is gone, and a recursive listing of the project root is not worth taking.
    const modelDir = existsSync(path.join(drDir, "model"))
      ? path.join(drDir, "model")
      : existsSync(path.join(projectRoot, "manifest.yaml"))
        ? projectRoot
        : null;
    if (modelDir === null) return null;
    const hash = createHash("sha1");
    for (const stamp of fileStamps(modelDir)) hash.update(`m\t${stamp}\n`);
    let activeId = "";
    try {
      activeId = readFileSync(path.join(drDir, "changesets", ".active"), "utf-8").trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    hash.update(`active\t${activeId}\n`);
    if (activeId) {
      for (const stamp of fileStamps(new StagedChangesetStorage(projectRoot).getChangesetDir(activeId))) {
        hash.update(`c\t${stamp}\n`);
      }
    }
    return hash.digest("hex");
  } catch {
    return null;
  }
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

/**
 * Starts a read of the model into the cache for `key`. With the project root known from an earlier
 * read, the fingerprint is taken before the read, so a write that lands during it makes the next
 * `loadModel` read again. A key's first read learns the root only when it resolves, so its
 * fingerprint is taken then.
 */
function readIntoCache(key: string, rootPath: string | undefined, root: string | undefined): Promise<Model> {
  const entry: CachedModel = { promise: undefined as unknown as Promise<Model> };
  if (root !== undefined) {
    entry.root = root;
    entry.fingerprint = modelFingerprint(root);
  }
  entry.promise = readModelFromDisk(rootPath).then((model) => {
    const readFrom = (model as Partial<Model>).rootPath;
    if (typeof readFrom === "string" && readFrom !== entry.root) {
      entry.root = readFrom;
      entry.fingerprint = modelFingerprint(readFrom);
    }
    return model;
  });
  modelCache.set(key, entry);
  evictOnFailure(key, entry);
  return entry.promise;
}

/**
 * Returns the cached model for this rootPath, reading it from disk on first use and again whenever
 * the model's files changed since it was read (see {@link modelFingerprint}).
 */
export async function loadModel(rootPath?: string): Promise<Model> {
  // The default project may still be resolving from the client's roots.
  if (rootPath === undefined) await whenProjectRootSettled();
  const key = modelCacheKey(rootPath);
  const cached = modelCache.get(key);
  // A key's first read, still in flight, has no root yet: it is shared.
  if (cached && (cached.root === undefined || modelFingerprint(cached.root) === cached.fingerprint)) {
    return cached.promise;
  }
  return readIntoCache(key, rootPath, cached?.root);
}

/** Forces a fresh read from disk, replacing any cached instance for this rootPath. */
export async function reloadModel(rootPath?: string): Promise<Model> {
  if (rootPath === undefined) await whenProjectRootSettled();
  const key = modelCacheKey(rootPath);
  return readIntoCache(key, rootPath, modelCache.get(key)?.root);
}

/**
 * Don't let a failed load poison the cache for subsequent (possibly-fixed) calls.
 * Guarded by identity: if a newer entry has since replaced this one for `key`
 * (e.g. a concurrent reloadModel()), a stale rejection must not evict it.
 */
function evictOnFailure(key: string, entry: CachedModel): void {
  entry.promise.catch(() => {
    if (modelCache.get(key) === entry) {
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

/** Over MCP the agent creates the model itself, so point at the tools rather than `dr init`. */
const MCP_NO_MODEL_SUGGESTIONS = [
  "Call project_init to create a model in this folder (it needs a name)",
  "Call project_status to see where this folder stands with DR",
  "Pass rootPath if the model is in a different folder",
];

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
              suggestions:
                error instanceof ModelNotFoundError ? MCP_NO_MODEL_SUGGESTIONS : (error.suggestions ?? []),
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
