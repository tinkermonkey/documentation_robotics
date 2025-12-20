import { mkdir, rename, readFile as fsReadFile, writeFile as fsWriteFile, stat } from "node:fs/promises";

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
  await fsWriteFile(tempPath, content, 'utf-8');
  // Rename temp file to target path (atomic operation)
  await rename(tempPath, path);
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
  return await fsReadFile(path, 'utf-8');
}

/**
 * Write content to a file
 */
export async function writeFile(path: string, content: string): Promise<void> {
  await fsWriteFile(path, content, 'utf-8');
}

/**
 * Read a JSON file
 */
export async function readJSON<T>(path: string): Promise<T> {
  const content = await fsReadFile(path, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Write a JSON object to a file
 */
export async function writeJSON<T>(path: string, data: T, pretty: boolean = true): Promise<void> {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await fsWriteFile(path, content, 'utf-8');
}
