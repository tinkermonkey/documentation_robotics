import { mkdir, rename, readFile as fsReadFile, writeFile as fsWriteFile, stat } from "node:fs/promises";
import { existsSync as fsExistsSync } from "node:fs";
import { startSpan, endSpan } from "../telemetry/index.js";

// Fallback for runtime environments where TELEMETRY_ENABLED is not defined by esbuild
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/**
 * Write content to a file atomically using a temporary file
 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const fileExists = fsExistsSync(path);

  const span = startSpan('file.write', {
    'file.path': path,
    'file.size': content.length,
    'file.created': !fileExists,
  });

  try {
    const tempPath = `${path}.tmp`;
    await fsWriteFile(tempPath, content, 'utf-8');
    // Rename temp file to target path (atomic operation)
    await rename(tempPath, path);
  } finally {
    endSpan(span);
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a file as text
 */
export async function readFile(path: string): Promise<string> {
  const span = startSpan('file.read', {
    'file.path': path,
    'file.exists': fsExistsSync(path),
  });

  try {
    const content = await fsReadFile(path, 'utf-8');

    if (isTelemetryEnabled && span) {
      span.setAttribute('file.size', content.length);
    }

    return content;
  } finally {
    endSpan(span);
  }
}

/**
 * Write content to a file
 */
export async function writeFile(path: string, content: string): Promise<void> {
  const fileExists = fsExistsSync(path);

  const span = startSpan('file.write', {
    'file.path': path,
    'file.size': content.length,
    'file.created': !fileExists,
  });

  try {
    await fsWriteFile(path, content, 'utf-8');
  } finally {
    endSpan(span);
  }
}

/**
 * Read a JSON file
 */
export async function readJSON<T>(path: string): Promise<T> {
  const content = await readFile(path);
  return JSON.parse(content) as T;
}

/**
 * Write a JSON object to a file
 * Uses atomic write to prevent corruption
 */
export async function writeJSON<T>(path: string, data: T, pretty: boolean = true): Promise<void> {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await atomicWrite(path, content);
}
