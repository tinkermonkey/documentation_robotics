# Filesystem Snapshot Engine

The snapshot engine provides efficient filesystem state capture and comparison for detecting behavioral differences between CLIs after command execution.

## Overview

The snapshot engine is designed to:

- **Capture filesystem state** recursively across directory trees (~60 files in <200ms)
- **Detect changes** by comparing SHA-256 content hashes
- **Generate unified diffs** for modified files with line-by-line changes
- **Support directory-level filtering** to compare specific layers or sections
- **Lazy-load content** only when generating diffs to minimize memory overhead

## Core Components

### Data Structures

```typescript
interface FileSnapshot {
  exists: boolean;              // Whether file exists
  hash: string;                 // SHA-256 content hash
  mtime: number;                // Modification time (ms since epoch)
  size: number;                 // File size in bytes
  content?: string;             // Optional: loaded on-demand for diffs
}

interface FilesystemSnapshot {
  files: Map<string, FileSnapshot>;  // All files by relative path
}

type FileChangeType = 'added' | 'deleted' | 'modified' | 'unchanged';

interface FileChange {
  path: string;                 // Relative file path
  type: FileChangeType;         // Type of change
  beforeHash?: string;          // Hash before change
  afterHash?: string;           // Hash after change
  diff?: string;                // Unified diff format (optional)
}

interface DiffOptions {
  includeUnchanged?: boolean;   // Include unchanged files (default: false)
  generateDiffs?: boolean;      // Generate unified diffs (default: false)
  filterPaths?: string[];       // Filter to specific paths (supports dirs)
}
```

## API Reference

### `captureSnapshot(directory: string): Promise<FilesystemSnapshot>`

Recursively captures filesystem state by scanning the directory tree.

**Features:**
- Walks all subdirectories recursively
- Computes SHA-256 hash for each file
- Skips hidden files and directories (except `.dr`)
- Normalizes paths to forward slashes
- Does not load file content initially (lazy-loaded on demand)

**Example:**

```typescript
const snapshot = await captureSnapshot('/path/to/model');
console.log(`Captured ${snapshot.files.size} files`);

// Access specific file metadata
const manifest = snapshot.files.get('documentation-robotics/model/manifest.yaml');
if (manifest) {
  console.log(`  Hash: ${manifest.hash.slice(0, 8)}...`);
  console.log(`  Size: ${manifest.size} bytes`);
  console.log(`  Modified: ${new Date(manifest.mtime).toISOString()}`);
}
```

### `diffSnapshots(before, after, directory, options): Promise<FileChange[]>`

Compares two snapshots and detects changes.

**Parameters:**
- `before`: FilesystemSnapshot of the initial state
- `after`: FilesystemSnapshot after changes
- `directory`: Directory path (used for loading content if needed)
- `options`: DiffOptions for customizing comparison

**Returns:** Array of FileChange objects representing detected changes

**Features:**
- Detects added files (in `after` but not in `before`)
- Detects deleted files (in `before` but not in `after`)
- Detects modified files (hash mismatch)
- Optionally includes unchanged files
- Supports filtering to specific paths or directories

**Example:**

```typescript
const before = await captureSnapshot(pythonCliDir);

// ... execute Python CLI command ...

const after = await captureSnapshot(pythonCliDir);

// Compare snapshots
const changes = await diffSnapshots(before, after, pythonCliDir, {
  includeUnchanged: false,
  generateDiffs: true,
});

for (const change of changes) {
  console.log(`${change.type}: ${change.path}`);
  if (change.diff) {
    console.log(change.diff);
  }
}
```

### `generateUnifiedDiff(path, beforeContent, afterContent): string`

Generates a unified diff for file content changes.

**Format:**
```
--- path/to/file
+++ path/to/file
@@ -start,count +start,count @@
 unchanged line
-removed line
+added line
 unchanged line
```

**Example:**

```typescript
const before = 'line1\nline2\nline3\n';
const after = 'line1\nmodified line2\nline3\nline4\n';

const diff = generateUnifiedDiff('file.txt', before, after);
console.log(diff);
// --- file.txt
// +++ file.txt
// @@ -1,3 +1,4 @@
//  line1
// -line2
// +modified line2
//  line3
// +line4
```

## Usage Patterns

### Pattern 1: Parallel CLI Comparison

Compare identical commands run on Python and TypeScript CLIs:

```typescript
import { captureSnapshot, diffSnapshots } from './snapshot-engine';
import { executeCommand } from './runner';

async function compareParallelExecution(
  pythonCliDir: string,
  tsCliDir: string,
  command: string
) {
  // Capture baseline
  const pythonBefore = await captureSnapshot(pythonCliDir);
  const tsBefore = await captureSnapshot(tsCliDir);

  // Execute command in parallel
  await Promise.all([
    executeCommand({
      command: '/path/to/python/cli',
      args: command.split(' '),
      cwd: pythonCliDir,
    }),
    executeCommand({
      command: 'node',
      args: ['cli.js', ...command.split(' ')],
      cwd: tsCliDir,
    }),
  ]);

  // Capture after execution
  const pythonAfter = await captureSnapshot(pythonCliDir);
  const tsAfter = await captureSnapshot(tsCliDir);

  // Compare changes
  const pythonChanges = await diffSnapshots(
    pythonBefore,
    pythonAfter,
    pythonCliDir,
    { generateDiffs: true }
  );

  const tsChanges = await diffSnapshots(
    tsBefore,
    tsAfter,
    tsCliDir,
    { generateDiffs: true }
  );

  // Analyze differences
  for (let i = 0; i < pythonChanges.length; i++) {
    const p = pythonChanges[i];
    const t = tsChanges[i];

    if (p.type !== t.type) {
      console.log(`DIFF: ${p.path} - Python: ${p.type}, TS: ${t.type}`);
    } else if (p.afterHash !== t.afterHash) {
      console.log(`DIFF: ${p.path} - Python and TS produced different content`);
      console.log(p.diff);
    }
  }
}
```

### Pattern 2: Layer-Specific Comparison

Compare changes in specific layers only:

```typescript
// Compare only the motivation and business layers
const motivationChanges = await diffSnapshots(before, after, directory, {
  filterPaths: [
    'documentation-robotics/model/01_motivation/',
    'documentation-robotics/model/02_business/',
  ],
  generateDiffs: true,
});

console.log(`Modified ${motivationChanges.length} files in motivation/business layers`);
```

### Pattern 3: Manifest-Only Comparison

Compare only specific files (useful for detecting model metadata changes):

```typescript
const manifestChanges = await diffSnapshots(before, after, directory, {
  filterPaths: [
    'documentation-robotics/model/manifest.yaml',
    'documentation-robotics/model/relationships.yaml',
  ],
  generateDiffs: true,
});
```

### Pattern 4: Change Summary Reporting

Generate human-readable summary of changes:

```typescript
import { formatComparisonResults } from './snapshot-engine';

const changes = await diffSnapshots(before, after, directory, {
  generateDiffs: true,
});

const summary = formatComparisonResults(changes);
console.log(summary);
// Output:
// Filesystem Changes Summary:
//   Added:      2
//   Deleted:    0
//   Modified:   5
//   Unchanged:  52
//   Total:      59
//
// Changes:
//   ✚ new-goal.yaml (added)
//     After: a1b2c3d4...
//   ...
```

## Performance Characteristics

| Operation | Files | Time | Notes |
|-----------|-------|------|-------|
| captureSnapshot() | 60 | <200ms | Includes hash computation |
| diffSnapshots() | 60 (5 modified) | <50ms | Hash-based comparison |
| generateDiffs() | 5 files | <100ms | Content diff generation |
| **Total workflow** | 60 files | **<2s** | Complete comparison cycle |

**Memory Usage:**
- Without content storage: ~1KB per file (hash, metadata)
- With content storage: ~50-100KB per file (typical for YAML)
- 60 files without content: ~60KB
- 60 files with content: ~3-6MB

## Implementation Details

### Directory Traversal

The engine uses async/await with `readdir` and `stat` for efficient directory walking:

```typescript
async function walkDirectory(
  dir: string,
  basePath: string,
  files: Map<string, FileSnapshot>,
  captureContent: boolean = false
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    // Skip hidden files (except .dr)
    if (entry.name.startsWith('.') && entry.name !== '.dr') {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDirectory(fullPath, basePath, files, captureContent);
    } else if (entry.isFile()) {
      // Compute hash and capture metadata
      const content = await readFile(fullPath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');

      files.set(relativePath, {
        exists: true,
        hash,
        mtime: stats.mtimeMs,
        size: stats.size,
        content: captureContent ? content : undefined,
      });
    }
  }
}
```

### Hash-Based Comparison

Changes are detected using SHA-256 hashes rather than full content comparison:

```typescript
// Quick comparison
if (beforeFile.hash === afterFile.hash) {
  // File unchanged
} else {
  // File modified - only now load content if diffs needed
  if (options.generateDiffs) {
    const diff = generateUnifiedDiff(
      path,
      beforeFile.content || await readFile(...),
      afterFile.content || await readFile(...)
    );
  }
}
```

This approach minimizes I/O and memory usage for large models.

### Unified Diff Generation

The engine uses the `diff` npm package to generate structured diffs:

```typescript
import { diffLines } from 'diff';

const diffs = diffLines(beforeContent, afterContent);
// Returns array of: { value, added, removed }
```

The output is then formatted into standard unified diff format with:
- File headers (`--- path`, `+++ path`)
- Hunk headers (`@@ -line,count +line,count @@`)
- Prefixed lines (` `, `-`, `+`)

## Testing

The snapshot engine includes comprehensive test coverage:

- **Unit tests** (`snapshot-engine.test.ts`): 50+ test cases covering all APIs
- **Integration tests** (`snapshot-integration.test.ts`): Real-world scenarios
- **Performance tests**: Verify <2s performance with ~60 files

Run tests:

```bash
npm run test:unit -- tests/differential/snapshot-engine.test.ts
npm run test:unit -- tests/differential/snapshot-integration.test.ts
npm run test -- -t "Performance"
```

## Known Limitations

1. **Hidden Files**: Files in directories starting with `.` are skipped (except `.dr`)
   - Design choice to exclude environment/cache directories
   - Use explicit paths in `filterPaths` if access needed

2. **Binary Files**: Content is read as UTF-8
   - Works for text-based formats (YAML, JSON, etc.)
   - Binary files will have incorrect hashes if encoding matters

3. **Large Files**: Diff generation loads full content into memory
   - For files >1MB, consider streaming comparison
   - Content is loaded only when `generateDiffs: true`

4. **Symlinks**: Not followed or detected
   - Directory traversal treats symlinks as files
   - Implementation consistent with Node.js `readdir`

## Future Enhancements

Potential improvements for Phase 2+:

- [ ] Stream-based diff for files >1MB
- [ ] Binary file detection and handling
- [ ] Symbolic link support
- [ ] Incremental snapshots (delta compression)
- [ ] Changeset storage format (for replay)
- [ ] Parallel snapshot capture across multiple directories
- [ ] Custom normalization plugins (timestamps, UUIDs, etc.)

## Related Files

- `snapshot-engine.ts` - Core implementation
- `snapshot-engine.test.ts` - Unit tests
- `snapshot-integration.test.ts` - Integration tests
- `runner.ts` - Command execution utilities
- `comparator.ts` - Output comparison (complementary)

## References

- Acceptance Criteria: [Phase 2 Issue #91](https://github.com/tinkermonkey/documentation_robotics/issues/91)
- Design Discussion: [Discussion #92](https://github.com/tinkermonkey/documentation_robotics/discussions/92)
- RFC: File Content Comparison (US-8, US-10)
