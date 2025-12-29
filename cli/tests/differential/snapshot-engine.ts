import { readdir, stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { diffLines } from 'diff';

/**
 * Represents a snapshot of a single file's state
 */
export interface FileSnapshot {
  /** Whether the file exists */
  exists: boolean;
  /** SHA-256 hash of file content */
  hash: string;
  /** File modification time (milliseconds since epoch) */
  mtime: number;
  /** File size in bytes */
  size: number;
  /** File content (lazy-loaded only when needed for diffs) */
  content?: string;
}

/**
 * Represents a complete filesystem snapshot
 */
export interface FilesystemSnapshot {
  /** Map of relative file paths to their snapshots */
  files: Map<string, FileSnapshot>;
}

/**
 * Represents a change detected between two snapshots
 */
export interface FileChange {
  /** Relative path to the file */
  path: string;
  /** Type of change */
  type: 'added' | 'deleted' | 'modified' | 'unchanged';
  /** Hash before change (if applicable) */
  beforeHash?: string;
  /** Hash after change (if applicable) */
  afterHash?: string;
  /** Unified diff format (only generated for modified files when requested) */
  diff?: string;
}

/**
 * Options for snapshot comparison
 */
export interface DiffOptions {
  /** Include unchanged files in results (default: false) */
  includeUnchanged?: boolean;
  /** Generate diffs for modified files (default: false) */
  generateDiffs?: boolean;
  /** Filter to specific paths (supports glob patterns like '01_motivation/') */
  filterPaths?: string[];
}

/**
 * Recursively walk directory and capture file state
 */
async function walkDirectory(
  dir: string,
  basePath: string,
  files: Map<string, FileSnapshot>,
  captureContent: boolean = false
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    // Skip hidden files and common non-essential directories
    if (entry.name.startsWith('.') && entry.name !== '.dr') {
      continue;
    }

    const fullPath = join(dir, entry.name);
    const relativePath = relative(basePath, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      await walkDirectory(fullPath, basePath, files, captureContent);
    } else if (entry.isFile()) {
      const stats = await stat(fullPath);
      const content = await readFile(fullPath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');

      files.set(relativePath, {
        exists: true,
        hash,
        mtime: stats.mtimeMs,
        size: stats.size,
        // content is stored if requested (for diff generation)
        content: captureContent ? content : undefined,
      });
    }
  }
}

/**
 * Capture filesystem snapshot of a directory
 *
 * Walks the directory tree and records file metadata (hash, mtime, size) for
 * efficient change detection. File content is not loaded unless needed for diff generation.
 *
 * @param directory - Directory to snapshot
 * @returns FilesystemSnapshot with file state information
 */
export async function captureSnapshot(
  directory: string
): Promise<FilesystemSnapshot> {
  const files = new Map<string, FileSnapshot>();
  await walkDirectory(directory, directory, files);
  return { files };
}

/**
 * Check if a file path matches any filter patterns
 */
function matchesFilters(path: string, filters: string[]): boolean {
  return filters.some((filter) => {
    // Handle directory patterns like "01_motivation/"
    if (filter.endsWith('/')) {
      return path.startsWith(filter);
    }
    // Handle exact file matches
    return path === filter;
  });
}

/**
 * Generate unified diff for a modified file
 *
 * Creates a unified diff in the standard format showing line-by-line changes.
 * Content is loaded on-demand only for modified files.
 *
 * @param filePath - Path to the file (used in diff headers)
 * @param beforeContent - Content before the change
 * @param afterContent - Content after the change
 * @returns Unified diff string
 */
export function generateUnifiedDiff(
  filePath: string,
  beforeContent: string,
  afterContent: string
): string {
  const beforeLines = beforeContent.split('\n');
  const afterLines = afterContent.split('\n');

  // Use diffLines to get structured diffs
  const diffs = diffLines(beforeContent, afterContent);

  // Build unified diff format
  let result = `--- ${filePath}\n`;
  result += `+++ ${filePath}\n`;

  let beforeLineNum = 1;
  let afterLineNum = 1;
  let hunkStart = false;
  let hunkBeforeStart = 1;
  let hunkAfterStart = 1;
  let beforeHunkLines = 0;
  let afterHunkLines = 0;

  // First pass: identify hunks and collect changes
  const hunks: Array<{ changes: typeof diffs; beforeStart: number; afterStart: number }> = [];
  let currentHunk = { changes: [] as typeof diffs, beforeStart: 1, afterStart: 1 };

  for (const diff of diffs) {
    const lineCount = diff.value.split('\n').length - 1; // -1 because split on final newline

    if (diff.added) {
      afterLineNum += lineCount;
      afterHunkLines += lineCount;
    } else if (diff.removed) {
      beforeLineNum += lineCount;
      beforeHunkLines += lineCount;
    } else {
      if (beforeHunkLines > 0 || afterHunkLines > 0) {
        // Start a new hunk if we've accumulated changes
        hunks.push({
          changes: currentHunk.changes,
          beforeStart: hunkBeforeStart,
          afterStart: hunkAfterStart,
        });
        currentHunk = { changes: [], beforeStart: beforeLineNum, afterStart: afterLineNum };
        beforeHunkLines = 0;
        afterHunkLines = 0;
        hunkBeforeStart = beforeLineNum;
        hunkAfterStart = afterLineNum;
      }
      beforeLineNum += lineCount;
      afterLineNum += lineCount;
    }

    currentHunk.changes.push(diff);
  }

  if (beforeHunkLines > 0 || afterHunkLines > 0) {
    hunks.push({
      changes: currentHunk.changes,
      beforeStart: hunkBeforeStart,
      afterStart: hunkAfterStart,
    });
  }

  // Second pass: format hunks
  beforeLineNum = 1;
  afterLineNum = 1;

  for (const hunk of hunks) {
    const hunkLines: string[] = [];
    let hunkBeforeCount = 0;
    let hunkAfterCount = 0;

    for (const diff of hunk.changes) {
      const lines = diff.value.split('\n').filter((l) => l.length > 0);

      if (diff.added) {
        hunkAfterCount += lines.length;
        for (const line of lines) {
          hunkLines.push(`+${line}`);
        }
        afterLineNum += lines.length;
      } else if (diff.removed) {
        hunkBeforeCount += lines.length;
        for (const line of lines) {
          hunkLines.push(`-${line}`);
        }
        beforeLineNum += lines.length;
      } else {
        hunkBeforeCount += lines.length;
        hunkAfterCount += lines.length;
        for (const line of lines) {
          hunkLines.push(` ${line}`);
        }
        beforeLineNum += lines.length;
        afterLineNum += lines.length;
      }
    }

    if (hunkLines.length > 0) {
      // Add hunk header
      const beforeEnd = hunk.beforeStart + hunkBeforeCount - 1;
      const afterEnd = hunk.afterStart + hunkAfterCount - 1;
      result += `@@ -${hunk.beforeStart},${hunkBeforeCount} +${hunk.afterStart},${hunkAfterCount} @@\n`;
      result += hunkLines.join('\n') + '\n';
    }
  }

  return result;
}

/**
 * Compare two filesystem snapshots and detect changes
 *
 * Detects added, deleted, and modified files by comparing hashes.
 * Modified files are identified by differing hashes.
 * Content is taken from snapshots if available, otherwise read from disk.
 *
 * @param before - Snapshot before changes
 * @param after - Snapshot after changes
 * @param directory - Directory path (used for loading content when generating diffs if not in snapshot)
 * @param options - Diff options (include unchanged, generate diffs, filter paths)
 * @returns Array of FileChange objects
 */
export async function diffSnapshots(
  before: FilesystemSnapshot,
  after: FilesystemSnapshot,
  directory: string,
  options: DiffOptions = {}
): Promise<FileChange[]> {
  const changes: FileChange[] = [];

  // Collect all paths from both snapshots
  const allPaths = new Set([...before.files.keys(), ...after.files.keys()]);

  // Apply path filtering if specified
  const pathsToCompare = options.filterPaths
    ? Array.from(allPaths).filter((path) => matchesFilters(path, options.filterPaths!))
    : Array.from(allPaths);

  for (const path of pathsToCompare) {
    const beforeFile = before.files.get(path);
    const afterFile = after.files.get(path);

    if (!beforeFile && afterFile) {
      // File was added
      changes.push({
        path,
        type: 'added',
        afterHash: afterFile.hash,
      });
    } else if (beforeFile && !afterFile) {
      // File was deleted
      changes.push({
        path,
        type: 'deleted',
        beforeHash: beforeFile.hash,
      });
    } else if (beforeFile && afterFile && beforeFile.hash !== afterFile.hash) {
      // File was modified
      const change: FileChange = {
        path,
        type: 'modified',
        beforeHash: beforeFile.hash,
        afterHash: afterFile.hash,
      };

      // Generate diff if requested
      if (options.generateDiffs) {
        try {
          // Try to use content from snapshots first, fall back to disk if needed
          let beforeContent = beforeFile.content;
          let afterContent = afterFile.content;

          // If content wasn't captured in the snapshot, try reading from disk
          if (!beforeContent) {
            beforeContent = await readFile(join(directory, path), 'utf-8').catch(() => '');
          }
          if (!afterContent) {
            afterContent = await readFile(join(directory, path), 'utf-8').catch(() => '');
          }

          change.diff = generateUnifiedDiff(path, beforeContent || '', afterContent || '');
        } catch {
          // If we can't read the file, skip diff generation
        }
      }

      changes.push(change);
    } else if (options.includeUnchanged) {
      // File unchanged
      changes.push({
        path,
        type: 'unchanged',
        beforeHash: beforeFile?.hash,
        afterHash: afterFile?.hash,
      });
    }
  }

  return changes;
}

/**
 * Format a FileChange for display
 */
export function formatChange(change: FileChange): string {
  const typeSymbol = {
    added: '✚',
    deleted: '✖',
    modified: '◆',
    unchanged: '◯',
  }[change.type];

  let output = `${typeSymbol} ${change.path} (${change.type})`;

  if (change.beforeHash && change.afterHash) {
    output += `\n  Before: ${change.beforeHash.slice(0, 8)}...`;
    output += `\n  After:  ${change.afterHash.slice(0, 8)}...`;
  }

  if (change.diff) {
    output += `\n\n${change.diff}`;
  }

  return output;
}

/**
 * Format snapshot comparison results for display
 */
export function formatComparisonResults(changes: FileChange[]): string {
  const summary = {
    added: changes.filter((c) => c.type === 'added').length,
    deleted: changes.filter((c) => c.type === 'deleted').length,
    modified: changes.filter((c) => c.type === 'modified').length,
    unchanged: changes.filter((c) => c.type === 'unchanged').length,
  };

  let output = `Filesystem Changes Summary:\n`;
  output += `  Added:      ${summary.added}\n`;
  output += `  Deleted:    ${summary.deleted}\n`;
  output += `  Modified:   ${summary.modified}\n`;
  output += `  Unchanged:  ${summary.unchanged}\n`;
  output += `  Total:      ${changes.length}\n\n`;

  output += 'Changes:\n';
  output += changes.map((c) => `  ${formatChange(c)}`).join('\n');

  return output;
}
