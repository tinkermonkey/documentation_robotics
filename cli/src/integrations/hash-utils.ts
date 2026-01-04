/**
 * File Hashing Utilities
 *
 * Provides SHA256-based file hashing for change detection in integration files.
 * Uses streaming for memory efficiency when handling large files.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Compute SHA256 hash of a file, truncated to 8 characters
 *
 * Uses streaming to efficiently handle files of any size without loading
 * them entirely into memory. Matches Python implementation using the same
 * truncation length (8 characters) for consistency.
 *
 * @param filePath - Absolute path to file to hash
 * @returns Promise resolving to 8-character hex hash
 * @throws Error if file cannot be read
 *
 * @example
 * const hash = await computeFileHash('/path/to/file.ts');
 * // Returns: 'a1b2c3d4'
 */
export async function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (data: Buffer) => {
      hash.update(data);
    });

    stream.on('end', () => {
      const fullHash = hash.digest('hex');
      resolve(fullHash.substring(0, 8));
    });

    stream.on('error', (error: Error) => {
      reject(error);
    });
  });
}

/**
 * Compute hashes for all files in a directory recursively
 *
 * Scans the directory tree and computes hashes for all files, optionally
 * filtering by a filename prefix. Returns a map of relative paths to hashes,
 * enabling efficient comparison of installed vs. source files.
 *
 * @param baseDir - Base directory to scan
 * @param prefix - Optional prefix filter (only include files matching prefix)
 * @returns Promise resolving to Map of relative paths to 8-character hashes
 * @throws Error if directory cannot be read
 *
 * @example
 * const hashes = await computeDirectoryHashes('/path/to/dir', 'dr-');
 * // Returns: Map { 'dr-file1.md' => 'a1b2c3d4', 'subdir/dr-file2.md' => 'e5f6g7h8' }
 */
export async function computeDirectoryHashes(
  baseDir: string,
  prefix?: string
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();

  async function scanDir(dir: string, relativePrefix: string = ''): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = relativePrefix ? join(relativePrefix, entry.name) : entry.name;

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          await scanDir(fullPath, relativePath);
        } else if (entry.isFile()) {
          // Check prefix filter
          if (prefix && !entry.name.startsWith(prefix)) {
            continue;
          }

          // Compute hash for file
          try {
            const hash = await computeFileHash(fullPath);
            hashes.set(relativePath, hash);
          } catch (error) {
            // Log error but continue processing other files
            console.error(`Failed to hash file ${fullPath}:`, error);
          }
        }
      }
    } catch (error) {
      // Re-throw directory read errors
      throw error;
    }
  }

  await scanDir(baseDir);
  return hashes;
}
