/**
 * Session state and metadata persistence
 *
 * Provides file-based storage for analyzer session state, index metadata,
 * and analyzer status information in `.dr/analyzers/` directory.
 *
 * All operations are async and use JSON for serialization.
 * Missing files gracefully return null rather than throwing errors.
 */

import { promises as fs } from "fs";
import * as path from "path";
import type { SessionState, IndexMeta, AnalyzerStatus } from "./types.js";

/**
 * Get the base directory for analyzer state files
 * Resolves to `.dr/analyzers/` under the current working directory
 */
function getStateDir(): string {
  return path.join(process.cwd(), ".dr", "analyzers");
}

/**
 * Ensure the state directory exists
 * Creates intermediate directories with recursive flag
 */
async function ensureStateDir(): Promise<void> {
  await fs.mkdir(getStateDir(), { recursive: true });
}

/**
 * Get the full path to a state file
 *
 * @param filename Name of the state file
 * @returns Full path to the file
 */
function getStatePath(filename: string): string {
  return path.join(getStateDir(), filename);
}

/**
 * Read session state from `.dr/analyzers/session.json`
 *
 * @returns Parsed session state, or null if file does not exist
 * @throws Error if file exists but is malformed JSON
 */
export async function readSession(): Promise<SessionState | null> {
  const filePath = getStatePath("session.json");
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as SessionState;
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
 */
export async function writeSession(state: SessionState): Promise<void> {
  await ensureStateDir();
  const filePath = getStatePath("session.json");
  const content = JSON.stringify(state, null, 2);
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * Read index metadata from `.dr/analyzers/index.meta.json`
 *
 * @returns Parsed index metadata, or null if file does not exist
 * @throws Error if file exists but is malformed JSON
 */
export async function readIndexMeta(): Promise<IndexMeta | null> {
  const filePath = getStatePath("index.meta.json");
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as IndexMeta;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Write index metadata to `.dr/analyzers/index.meta.json`
 *
 * Creates the state directory if it does not exist.
 * Writes with pretty-printed JSON (2-space indentation).
 *
 * @param meta Index metadata to persist
 */
export async function writeIndexMeta(meta: IndexMeta): Promise<void> {
  await ensureStateDir();
  const filePath = getStatePath("index.meta.json");
  const content = JSON.stringify(meta, null, 2);
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * Read analyzer status from `.dr/analyzers/status.json`
 *
 * @returns Parsed analyzer status, or null if file does not exist
 * @throws Error if file exists but is malformed JSON
 */
export async function readStatus(): Promise<AnalyzerStatus | null> {
  const filePath = getStatePath("status.json");
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as AnalyzerStatus;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Write analyzer status to `.dr/analyzers/status.json`
 *
 * Creates the state directory if it does not exist.
 * Writes with pretty-printed JSON (2-space indentation).
 *
 * @param status Analyzer status to persist
 */
export async function writeStatus(status: AnalyzerStatus): Promise<void> {
  await ensureStateDir();
  const filePath = getStatePath("status.json");
  const content = JSON.stringify(status, null, 2);
  await fs.writeFile(filePath, content, "utf-8");
}
