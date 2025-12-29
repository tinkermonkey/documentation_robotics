/**
 * Filesystem Comparator
 *
 * Captures snapshots of filesystem state before and after test execution,
 * applies normalization to content, and generates detailed diff reports.
 *
 * Snapshots include:
 * - File existence and paths
 * - Content hashes (SHA-256) of normalized content
 * - Metadata (modification time, size)
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import {
  normalize,
  detectFileType,
  FileType,
} from './normalizers/index';

/**
 * Information about a single file in a snapshot
 */
export interface FileInfo {
  exists: boolean;
  hash: string; // SHA-256 hash of normalized content
  mtime: number; // Modification time in milliseconds
  size: number; // File size in bytes
}

/**
 * A complete snapshot of a directory's filesystem state
 */
export interface FilesystemSnapshot {
  timestamp: number;
  directory: string;
  files: Map<string, FileInfo>;
}

/**
 * Represents a single file change between snapshots
 */
export interface FileChange {
  path: string;
  type: 'added' | 'deleted' | 'modified';
  oldHash?: string;
  newHash?: string;
  oldSize?: number;
  newSize?: number;
}

/**
 * Result of comparing two filesystem snapshots
 */
export interface ComparisonResult {
  identical: boolean;
  changes: FileChange[];
  summary: {
    added: number;
    deleted: number;
    modified: number;
    total: number;
  };
}

/**
 * Recursively walk directory tree and collect file information
 * Skips node_modules, .git, and other common non-content directories
 *
 * @param dirPath Root directory to start walking
 * @param rootPath Path to use as base for relative paths
 * @returns Array of relative file paths
 */
async function walkDirectory(dirPath: string, rootPath: string = dirPath): Promise<string[]> {
  const files: string[] = [];

  // Directories to skip during traversal
  const skipDirs = new Set([
    'node_modules',
    '.git',
    '.venv',
    'dist',
    'build',
    'coverage',
    '.next',
    '.nuxt',
  ]);

  async function walk(currentPath: string): Promise<void> {
    try {
      const entries = await readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name);
        const relativePath = relative(rootPath, fullPath);

        if (entry.isDirectory()) {
          // Skip certain directories
          if (!skipDirs.has(entry.name)) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          files.push(relativePath);
        }
      }
    } catch (error) {
      // Skip inaccessible directories
      console.warn(`Warning: Could not read directory ${currentPath}`);
    }
  }

  await walk(dirPath);
  return files;
}

/**
 * Calculate SHA-256 hash of normalized file content
 * Applies normalization pipeline based on file type before hashing
 *
 * @param content Raw file content
 * @param filePath Path to file (for type detection)
 * @returns SHA-256 hash of normalized content (hex string)
 */
function hashContent(content: string, filePath: string): string {
  // Apply normalization pipeline based on file type
  const fileType = detectFileType(filePath);
  const normalized = normalize(content, fileType);

  // Generate SHA-256 hash of normalized content
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Capture a snapshot of the current filesystem state
 * Walks the directory tree, reads files, normalizes content, and generates hashes
 *
 * @param directory Root directory to snapshot
 * @returns FilesystemSnapshot with all files and their normalized content hashes
 *
 * @throws Error if directory is inaccessible
 *
 * @remarks
 * Large files are read into memory, so this should be used with reasonable
 * directory sizes. Normalization is applied to content before hashing to
 * ensure that only true behavioral differences are captured.
 */
export async function captureSnapshot(directory: string): Promise<FilesystemSnapshot> {
  // Walk the directory tree to get all files
  const filePaths = await walkDirectory(directory);

  const files = new Map<string, FileInfo>();

  // Process each file
  for (const relativePath of filePaths) {
    const fullPath = join(directory, relativePath);

    try {
      // Read file content and metadata
      const content = await readFile(fullPath, 'utf-8');
      const fileStats = await stat(fullPath);

      // Calculate hash of normalized content
      const hash = hashContent(content, relativePath);

      // Store file information
      files.set(relativePath, {
        exists: true,
        hash,
        mtime: fileStats.mtimeMs,
        size: fileStats.size,
      });
    } catch (error) {
      // Skip files that cannot be read (permissions, encoding, etc)
      console.warn(`Warning: Could not read file ${relativePath}: ${error}`);
    }
  }

  return {
    timestamp: Date.now(),
    directory,
    files,
  };
}

/**
 * Compare two filesystem snapshots and identify differences
 * Only reports files that changed, not files that didn't change
 *
 * @param before Snapshot from before the operation
 * @param after Snapshot from after the operation
 * @returns ComparisonResult with list of changes and summary
 *
 * @remarks
 * Changes are classified as:
 * - added: File exists in 'after' but not in 'before'
 * - deleted: File exists in 'before' but not in 'after'
 * - modified: File exists in both but hash differs (normalized content changed)
 */
export function compareSnapshots(
  before: FilesystemSnapshot,
  after: FilesystemSnapshot
): ComparisonResult {
  const changes: FileChange[] = [];
  const allPaths = new Set([...before.files.keys(), ...after.files.keys()]);

  for (const path of allPaths) {
    const beforeInfo = before.files.get(path);
    const afterInfo = after.files.get(path);

    if (!beforeInfo && afterInfo) {
      // File was added
      changes.push({
        path,
        type: 'added',
        newHash: afterInfo.hash,
        newSize: afterInfo.size,
      });
    } else if (beforeInfo && !afterInfo) {
      // File was deleted
      changes.push({
        path,
        type: 'deleted',
        oldHash: beforeInfo.hash,
        oldSize: beforeInfo.size,
      });
    } else if (beforeInfo && afterInfo && beforeInfo.hash !== afterInfo.hash) {
      // File was modified (hashes differ after normalization)
      changes.push({
        path,
        type: 'modified',
        oldHash: beforeInfo.hash,
        newHash: afterInfo.hash,
        oldSize: beforeInfo.size,
        newSize: afterInfo.size,
      });
    }
    // If hashes are identical, file hasn't changed (not included in results)
  }

  // Calculate summary statistics
  const added = changes.filter((c) => c.type === 'added').length;
  const deleted = changes.filter((c) => c.type === 'deleted').length;
  const modified = changes.filter((c) => c.type === 'modified').length;

  return {
    identical: changes.length === 0,
    changes: changes.sort((a, b) => a.path.localeCompare(b.path)),
    summary: {
      added,
      deleted,
      modified,
      total: changes.length,
    },
  };
}

/**
 * Format comparison results as a human-readable string
 * Useful for logging and debugging test failures
 *
 * @param result ComparisonResult from compareSnapshots
 * @returns Formatted string representation
 *
 * @example
 * ```
 * Comparison Results:
 * ├─ Status: DIFFERENT (3 changes)
 * ├─ Added: 1 files
 * ├─ Deleted: 1 files
 * ├─ Modified: 1 files
 * └─ Changes:
 *    ├─ + model/01_motivation/new.yaml
 *    ├─ - model/02_business/old.yaml
 *    └─ ~ model/manifest.yaml
 * ```
 */
export function formatComparisonResult(result: ComparisonResult): string {
  const statusEmoji = result.identical ? '✓' : '✗';
  const statusText = result.identical ? 'IDENTICAL' : 'DIFFERENT';
  const changeCount = result.summary.total === 1 ? 'change' : 'changes';

  let output = `Comparison Results:\n`;
  output += `├─ Status: ${statusEmoji} ${statusText}`;

  if (!result.identical) {
    output += ` (${result.summary.total} ${changeCount})`;
  }
  output += '\n';

  output += `├─ Added: ${result.summary.added} files\n`;
  output += `├─ Deleted: ${result.summary.deleted} files\n`;
  output += `├─ Modified: ${result.summary.modified} files\n`;

  if (result.changes.length > 0) {
    output += `└─ Changes:\n`;
    result.changes.forEach((change, index) => {
      const isLast = index === result.changes.length - 1;
      const prefix = isLast ? '   └─' : '   ├─';
      const typeSymbol =
        change.type === 'added' ? '+' : change.type === 'deleted' ? '-' : '~';
      output += `${prefix} ${typeSymbol} ${change.path}\n`;
    });
  }

  return output;
}

/**
 * Compare two directories after applying CLI commands
 * Convenience function that captures before/after snapshots and compares them
 *
 * @param directory Directory to monitor
 * @returns Object with before snapshot, after snapshot, and comparison result
 *
 * @remarks
 * Use this to validate that a command produced expected filesystem changes.
 * Normalization is automatically applied before comparison.
 */
export async function captureAndCompare(
  directory: string
): Promise<{
  before: FilesystemSnapshot;
  after: FilesystemSnapshot;
  result: ComparisonResult;
}> {
  const before = await captureSnapshot(directory);
  const after = await captureSnapshot(directory);

  const result = compareSnapshots(before, after);

  return { before, after, result };
}
