import { mkdir, rename } from "node:fs/promises";

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
  const tempPath = `${path}.tmp`;
  await Bun.write(tempPath, content);
  // Rename temp file to target path (atomic operation)
  await rename(tempPath, path);
}

/**
 * Check if a file exists
 */
export async function fileExists(path: string): Promise<boolean> {
  return await Bun.file(path).exists();
}

/**
 * Read a file as text
 */
export async function readFile(path: string): Promise<string> {
  const file = Bun.file(path);
  return await file.text();
}

/**
 * Write content to a file
 */
export async function writeFile(path: string, content: string): Promise<void> {
  await Bun.write(path, content);
}

/**
 * Read a JSON file
 */
export async function readJSON<T>(path: string): Promise<T> {
  const file = Bun.file(path);
  return (await file.json()) as T;
}

/**
 * Write a JSON object to a file
 */
export async function writeJSON<T>(path: string, data: T, pretty: boolean = true): Promise<void> {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await Bun.write(path, content);
}
