/**
 * Session state and metadata persistence
 *
 * Provides file-based storage for analyzer session state, index metadata,
 * and analyzer status information in `.dr/analyzers/` directory.
 *
 * Per-analyzer files (index-meta.json, status.json) are stored in subdirectories:
 * - `.dr/analyzers/{analyzerName}/index-meta.json`
 * - `.dr/analyzers/{analyzerName}/status.json`
 *
 * Global files (session.json) are stored at the base level:
 * - `.dr/analyzers/session.json`
 *
 * All operations are async and use JSON for serialization.
 * Missing files gracefully return null rather than throwing errors.
 * Read operations validate JSON structure and throw errors for corrupted files.
 */

import { promises as fs } from "fs";
import * as path from "path";
import type { SessionState, IndexMeta, AnalyzerStatus } from "./types.js";

/**
 * Validate SessionState structure
 * @throws Error if data is missing required fields
 */
function validateSessionState(data: unknown): SessionState {
  if (!data || typeof data !== "object") {
    throw new Error("SessionState must be an object");
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.active_analyzer !== "string") {
    throw new Error("SessionState.active_analyzer must be a string");
  }

  if (typeof obj.selected_at !== "string") {
    throw new Error("SessionState.selected_at must be a string");
  }

  return {
    active_analyzer: obj.active_analyzer,
    selected_at: obj.selected_at,
  };
}

/**
 * Validate IndexMeta structure
 * @throws Error if data is missing required fields
 */
function validateIndexMeta(data: unknown): IndexMeta {
  if (!data || typeof data !== "object") {
    throw new Error("IndexMeta must be an object");
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.git_head !== "string") {
    throw new Error("IndexMeta.git_head must be a string");
  }

  if (typeof obj.timestamp !== "string") {
    throw new Error("IndexMeta.timestamp must be a string");
  }

  if (typeof obj.node_count !== "number") {
    throw new Error("IndexMeta.node_count must be a number");
  }

  if (typeof obj.edge_count !== "number") {
    throw new Error("IndexMeta.edge_count must be a number");
  }

  return {
    git_head: obj.git_head,
    timestamp: obj.timestamp,
    node_count: obj.node_count as number,
    edge_count: obj.edge_count as number,
  };
}

/**
 * Validate AnalyzerStatus structure
 * @throws Error if data is missing required fields or optional fields have wrong types
 */
function validateAnalyzerStatus(data: unknown): AnalyzerStatus {
  if (!data || typeof data !== "object") {
    throw new Error("AnalyzerStatus must be an object");
  }

  const obj = data as Record<string, unknown>;

  if (!obj.detected || typeof obj.detected !== "object") {
    throw new Error("AnalyzerStatus.detected must be an object");
  }

  const detected = obj.detected as Record<string, unknown>;
  if (typeof detected.installed !== "boolean") {
    throw new Error("AnalyzerStatus.detected.installed must be a boolean");
  }

  // Validate optional fields in detected if present
  if (detected.binary_path !== undefined && typeof detected.binary_path !== "string") {
    throw new Error("AnalyzerStatus.detected.binary_path must be a string");
  }

  if (detected.version !== undefined && typeof detected.version !== "string") {
    throw new Error("AnalyzerStatus.detected.version must be a string");
  }

  if (detected.mcp_registered !== undefined && typeof detected.mcp_registered !== "boolean") {
    throw new Error("AnalyzerStatus.detected.mcp_registered must be a boolean");
  }

  if (detected.contract_ok !== undefined && typeof detected.contract_ok !== "boolean") {
    throw new Error("AnalyzerStatus.detected.contract_ok must be a boolean");
  }

  if (typeof obj.indexed !== "boolean") {
    throw new Error("AnalyzerStatus.indexed must be a boolean");
  }

  if (typeof obj.fresh !== "boolean") {
    throw new Error("AnalyzerStatus.fresh must be a boolean");
  }

  // Validate optional index_meta if present
  let validatedIndexMeta: IndexMeta | undefined;
  if (obj.index_meta !== undefined) {
    validatedIndexMeta = validateIndexMeta(obj.index_meta);
  }

  // Validate optional last_indexed if present
  if (obj.last_indexed !== undefined && typeof obj.last_indexed !== "string") {
    throw new Error("AnalyzerStatus.last_indexed must be a string");
  }

  return {
    detected: {
      installed: detected.installed as boolean,
      binary_path: detected.binary_path as string | undefined,
      version: detected.version as string | undefined,
      mcp_registered: detected.mcp_registered as boolean | undefined,
      contract_ok: detected.contract_ok as boolean | undefined,
    },
    indexed: obj.indexed as boolean,
    fresh: obj.fresh as boolean,
    index_meta: validatedIndexMeta,
    last_indexed: obj.last_indexed as string | undefined,
  };
}

/**
 * Get the base directory for analyzer state files
 * Resolves to `.dr/analyzers/` (and optionally `{analyzerName}/` subdirectory)
 *
 * @param baseDir Optional base directory. Defaults to process.cwd()
 * @param analyzerName Optional analyzer name for per-analyzer subdirectory
 */
function getStateDir(baseDir?: string, analyzerName?: string): string {
  const base = baseDir ?? process.cwd();
  const analyzersDir = path.join(base, ".dr", "analyzers");

  if (analyzerName) {
    return path.join(analyzersDir, analyzerName);
  }

  return analyzersDir;
}

/**
 * Ensure the state directory exists
 * Creates intermediate directories with recursive flag
 *
 * @param baseDir Optional base directory. Defaults to process.cwd()
 * @param analyzerName Optional analyzer name for per-analyzer subdirectory
 */
async function ensureStateDir(baseDir?: string, analyzerName?: string): Promise<void> {
  await fs.mkdir(getStateDir(baseDir, analyzerName), { recursive: true });
}

/**
 * Get the full path to a state file
 *
 * @param filename Name of the state file
 * @param baseDir Optional base directory. Defaults to process.cwd()
 * @param analyzerName Optional analyzer name for per-analyzer subdirectory
 * @returns Full path to the file
 */
function getStatePath(filename: string, baseDir?: string, analyzerName?: string): string {
  return path.join(getStateDir(baseDir, analyzerName), filename);
}

/**
 * Read session state from `.dr/analyzers/session.json`
 *
 * @param baseDir Optional base directory. Defaults to process.cwd()
 * @returns Parsed and validated session state, or null if file does not exist
 * @throws Error if file exists but is malformed JSON or invalid structure
 */
export async function readSession(baseDir?: string): Promise<SessionState | null> {
  const filePath = getStatePath("session.json", baseDir);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    return validateSessionState(parsed);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Write session state to `.dr/analyzers/session.json`
 *
 * Creates the state directory if it does not exist.
 * Writes with pretty-printed JSON (2-space indentation).
 *
 * @param state Session state to persist
 * @param baseDir Optional base directory. Defaults to process.cwd()
 */
export async function writeSession(state: SessionState, baseDir?: string): Promise<void> {
  await ensureStateDir(baseDir);
  const filePath = getStatePath("session.json", baseDir);
  const content = JSON.stringify(state, null, 2);
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * Read index metadata from `.dr/analyzers/{analyzerName}/index-meta.json`
 *
 * @param baseDir Optional base directory. Defaults to process.cwd()
 * @param analyzerName Analyzer name for per-analyzer subdirectory (required)
 * @returns Parsed and validated index metadata, or null if file does not exist
 * @throws Error if file exists but is malformed JSON or invalid structure
 */
export async function readIndexMeta(
  baseDir: string | undefined,
  analyzerName: string
): Promise<IndexMeta | null> {
  const filePath = getStatePath("index-meta.json", baseDir, analyzerName);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    return validateIndexMeta(parsed);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Write index metadata to `.dr/analyzers/{analyzerName}/index-meta.json`
 *
 * Creates the state directory (including analyzer subdirectory) if it does not exist.
 * Writes with pretty-printed JSON (2-space indentation).
 *
 * @param meta Index metadata to persist
 * @param baseDir Optional base directory. Defaults to process.cwd()
 * @param analyzerName Analyzer name for per-analyzer subdirectory (required)
 */
export async function writeIndexMeta(
  meta: IndexMeta,
  baseDir: string | undefined,
  analyzerName: string
): Promise<void> {
  await ensureStateDir(baseDir, analyzerName);
  const filePath = getStatePath("index-meta.json", baseDir, analyzerName);
  const content = JSON.stringify(meta, null, 2);
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * Read analyzer status from `.dr/analyzers/{analyzerName}/status.json`
 *
 * @param baseDir Optional base directory. Defaults to process.cwd()
 * @param analyzerName Analyzer name for per-analyzer subdirectory (required)
 * @returns Parsed and validated analyzer status, or null if file does not exist
 * @throws Error if file exists but is malformed JSON or invalid structure
 */
export async function readStatus(
  baseDir: string | undefined,
  analyzerName: string
): Promise<AnalyzerStatus | null> {
  const filePath = getStatePath("status.json", baseDir, analyzerName);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    return validateAnalyzerStatus(parsed);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Write analyzer status to `.dr/analyzers/{analyzerName}/status.json`
 *
 * Creates the state directory (including analyzer subdirectory) if it does not exist.
 * Writes with pretty-printed JSON (2-space indentation).
 *
 * @param status Analyzer status to persist
 * @param baseDir Optional base directory. Defaults to process.cwd()
 * @param analyzerName Analyzer name for per-analyzer subdirectory (required)
 */
export async function writeStatus(
  status: AnalyzerStatus,
  baseDir: string | undefined,
  analyzerName: string
): Promise<void> {
  await ensureStateDir(baseDir, analyzerName);
  const filePath = getStatePath("status.json", baseDir, analyzerName);
  const content = JSON.stringify(status, null, 2);
  await fs.writeFile(filePath, content, "utf-8");
}
