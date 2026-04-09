/**
 * Unit Tests for Filesystem Comparator
 *
 * Tests snapshot capture, comparison, and diff reporting functionality
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemSnapshot, FileInfo, compareSnapshots, formatComparisonResult, captureTargetedSnapshot } from '../comparator.js';

/**
 * Test assertion helpers for compatibility with Bun's expect-like syntax
 */
class TestAssertions {
  value: any;

  constructor(value: any) {
    this.value = value;
  }

  toContain(substring: string): void {
    assert(
      String(this.value).includes(substring),
      `Expected value to contain "${substring}"\nActual: ${String(this.value).slice(0, 200)}...`
    );
  }

  toMatch(regex: RegExp): void {
    assert(
      regex.test(String(this.value)),
      `Expected value to match regex ${regex}\nActual: ${String(this.value).slice(0, 200)}...`
    );
  }

  toBe(expected: any): void {
    assert.equal(this.value, expected, `Expected ${expected} but got ${this.value}`);
  }

  toBeTruthy(): void {
    assert(this.value, `Expected value to be truthy but got: ${this.value}`);
  }

  toBeLessThan(expected: number): void {
    assert(
      this.value < expected,
      `Expected value ${this.value} to be less than ${expected}`
    );
  }

  toBeUndefined(): void {
    assert.equal(this.value, undefined, `Expected value to be undefined but got: ${this.value}`);
  }
}

function expect(value: any): TestAssertions {
  return new TestAssertions(value);
}

// ============================================================================
// Snapshot Comparison Tests
// ============================================================================

describe('compareSnapshots', () => {
  it('should identify identical snapshots', () => {
    const before: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
        ['file2.json', { exists: true, hash: 'hash2', mtime: 200, size: 100 }],
      ]),
    };

    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
        ['file2.json', { exists: true, hash: 'hash2', mtime: 200, size: 100 }],
      ]),
    };

    const result = compareSnapshots(before, after);
    expect(result.identical).toBe(true);
    expect(result.summary.total).toBe(0);
  });

  it('should detect added files', () => {
    const before: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
        ['file2.json', { exists: true, hash: 'hash2', mtime: 200, size: 100 }],
      ]),
    };

    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
        ['file2.json', { exists: true, hash: 'hash2', mtime: 200, size: 100 }],
        ['file3.txt', { exists: true, hash: 'hash3', mtime: 300, size: 75 }],
      ]),
    };

    const result = compareSnapshots(before, after);
    expect(result.identical).toBe(false);
    expect(result.summary.added).toBe(1);
    expect(result.summary.total).toBe(1);
  });

  it('should detect deleted files', () => {
    const before: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
        ['file2.json', { exists: true, hash: 'hash2', mtime: 200, size: 100 }],
      ]),
    };

    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }]]),
    };

    const result = compareSnapshots(before, after);
    expect(result.identical).toBe(false);
    expect(result.summary.deleted).toBe(1);
    expect(result.summary.total).toBe(1);
  });

  it('should detect modified files', () => {
    const before: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
        ['file2.json', { exists: true, hash: 'hash2', mtime: 200, size: 100 }],
      ]),
    };

    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1_modified', mtime: 150, size: 55 }],
        ['file2.json', { exists: true, hash: 'hash2', mtime: 200, size: 100 }],
      ]),
    };

    const result = compareSnapshots(before, after);
    expect(result.identical).toBe(false);
    expect(result.summary.modified).toBe(1);
    expect(result.summary.total).toBe(1);
  });

  it('should handle multiple concurrent changes', () => {
    const before: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
        ['file2.json', { exists: true, hash: 'hash2', mtime: 200, size: 100 }],
      ]),
    };

    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1_modified', mtime: 150, size: 55 }],
        ['file3.txt', { exists: true, hash: 'hash3', mtime: 300, size: 75 }],
      ]),
    };

    const result = compareSnapshots(before, after);
    expect(result.summary.deleted).toBe(1);
    expect(result.summary.added).toBe(1);
    expect(result.summary.modified).toBe(1);
    expect(result.summary.total).toBe(3);
  });
});

// ============================================================================
// Change Detection Tests
// ============================================================================

describe('Change detection', () => {
  const before: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([
      ['a.yaml', { exists: true, hash: 'hash_a', mtime: 100, size: 10 }],
      ['b.yaml', { exists: true, hash: 'hash_b', mtime: 200, size: 20 }],
    ]),
  };

  it('should classify added files correctly', () => {
    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['a.yaml', { exists: true, hash: 'hash_a', mtime: 100, size: 10 }],
        ['b.yaml', { exists: true, hash: 'hash_b', mtime: 200, size: 20 }],
        ['c.yaml', { exists: true, hash: 'hash_c', mtime: 300, size: 30 }],
      ]),
    };

    const result = compareSnapshots(before, after);
    expect(result.changes.some((c) => c.type === 'added')).toBe(true);
    expect(result.changes.some((c) => c.path === 'c.yaml')).toBe(true);
  });

  it('should classify deleted files correctly', () => {
    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([['a.yaml', { exists: true, hash: 'hash_a', mtime: 100, size: 10 }]]),
    };

    const result = compareSnapshots(before, after);
    expect(result.changes.some((c) => c.type === 'deleted')).toBe(true);
    expect(result.changes.some((c) => c.path === 'b.yaml')).toBe(true);
  });

  it('should classify modified files correctly', () => {
    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['a.yaml', { exists: true, hash: 'hash_a_modified', mtime: 150, size: 15 }],
        ['b.yaml', { exists: true, hash: 'hash_b', mtime: 200, size: 20 }],
      ]),
    };

    const result = compareSnapshots(before, after);
    expect(result.changes.some((c) => c.type === 'modified')).toBe(true);
  });

  it('should sort changes by path', () => {
    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['z.yaml', { exists: true, hash: 'hash_z', mtime: 400, size: 40 }],
        ['a.yaml', { exists: true, hash: 'hash_a', mtime: 100, size: 10 }],
        ['m.yaml', { exists: true, hash: 'hash_m', mtime: 500, size: 50 }],
      ]),
    };

    const result = compareSnapshots(before, after);
    expect(result.changes.length).toBe(3);
    expect(result.changes[0].path < result.changes[1].path).toBe(true);
    expect(result.changes[1].path < result.changes[2].path).toBe(true);
  });
});

// ============================================================================
// Summary Statistics Tests
// ============================================================================

describe('Summary statistics', () => {
  it('should return zero statistics for empty snapshots', () => {
    const before: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map(),
    };

    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map(),
    };

    const result = compareSnapshots(before, after);
    expect(result.summary.total).toBe(0);
    expect(result.summary.added).toBe(0);
    expect(result.summary.deleted).toBe(0);
    expect(result.summary.modified).toBe(0);
  });

  it('should calculate statistics correctly for multiple changes', () => {
    const before: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['keep.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 10 }],
        ['delete1.yaml', { exists: true, hash: 'hash2', mtime: 200, size: 20 }],
        ['delete2.yaml', { exists: true, hash: 'hash3', mtime: 300, size: 30 }],
        ['modify.yaml', { exists: true, hash: 'hash4', mtime: 400, size: 40 }],
      ]),
    };

    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['keep.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 10 }],
        ['modify.yaml', { exists: true, hash: 'hash4_new', mtime: 450, size: 45 }],
        ['add1.yaml', { exists: true, hash: 'hash5', mtime: 500, size: 50 }],
        ['add2.yaml', { exists: true, hash: 'hash6', mtime: 600, size: 60 }],
        ['add3.yaml', { exists: true, hash: 'hash7', mtime: 700, size: 70 }],
      ]),
    };

    const result = compareSnapshots(before, after);
    expect(result.summary.deleted).toBe(2);
    expect(result.summary.added).toBe(3);
    expect(result.summary.modified).toBe(1);
    expect(result.summary.total).toBe(6);
  });
});

// ============================================================================
// Formatting Tests
// ============================================================================

describe('formatComparisonResult', () => {
  it('should format identical snapshots correctly', () => {
    const result = {
      identical: true,
      changes: [],
      summary: { added: 0, deleted: 0, modified: 0, total: 0 },
    };

    const formatted = formatComparisonResult(result);
    expect(formatted.includes('IDENTICAL')).toBe(true);
    expect(formatted.includes('✓')).toBe(true);
  });

  it('should format different snapshots correctly', () => {
    const result = {
      identical: false,
      changes: [
        { path: 'added.yaml', type: 'added' as const, newHash: 'hash1', newSize: 10 },
        { path: 'deleted.yaml', type: 'deleted' as const, oldHash: 'hash2', oldSize: 20 },
        {
          path: 'modified.yaml',
          type: 'modified' as const,
          oldHash: 'hash3',
          newHash: 'hash3_new',
          oldSize: 30,
          newSize: 35,
        },
      ],
      summary: { added: 1, deleted: 1, modified: 1, total: 3 },
    };

    const formatted = formatComparisonResult(result);
    expect(formatted.includes('DIFFERENT')).toBe(true);
    expect(formatted.includes('✗')).toBe(true);
    expect(formatted.includes('3 changes')).toBe(true);
    expect(formatted.includes('+ added.yaml')).toBe(true);
    expect(formatted.includes('- deleted.yaml')).toBe(true);
    expect(formatted.includes('~ modified.yaml')).toBe(true);
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge cases', () => {
  it('should handle deletion of single file', () => {
    const before: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([['only.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 10 }]]),
    };

    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map(),
    };

    const result = compareSnapshots(before, after);
    expect(result.summary.deleted).toBe(1);
  });

  it('should handle large number of changes', () => {
    const fileCount = 100;
    const beforeFiles = new Map<string, FileInfo>();
    const afterFiles = new Map<string, FileInfo>();

    // Create 100 files in 'before'
    for (let i = 0; i < fileCount; i++) {
      beforeFiles.set(`file${i}.yaml`, {
        exists: true,
        hash: `hash${i}`,
        mtime: i * 100,
        size: i * 10,
      });
    }

    // In 'after', modify all of them (change hash)
    for (let i = 0; i < fileCount; i++) {
      afterFiles.set(`file${i}.yaml`, {
        exists: true,
        hash: `hash${i}_modified`,
        mtime: i * 100,
        size: i * 10,
      });
    }

    const before: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: beforeFiles,
    };

    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: afterFiles,
    };

    const result = compareSnapshots(before, after);
    expect(result.summary.modified).toBe(fileCount);
  });

  it('should handle paths with special characters', () => {
    const before: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['path/with spaces/file.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 10 }],
        ['path/with-dashes/file.yaml', { exists: true, hash: 'hash2', mtime: 200, size: 20 }],
      ]),
    };

    const after: FilesystemSnapshot = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['path/with spaces/file.yaml', { exists: true, hash: 'hash1_modified', mtime: 100, size: 10 }],
      ]),
    };

    const result = compareSnapshots(before, after);
    expect(result.summary.total).toBe(2);
  });
});

// ============================================================================
// Targeted Snapshot Tests
// ============================================================================

describe('captureTargetedSnapshot', () => {
  it('should capture specified files successfully', async () => {
    const tempDir = join(tmpdir(), `dr-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      // Create test files
      await writeFile(join(tempDir, 'file1.yaml'), 'content1\n');
      await writeFile(join(tempDir, 'file2.json'), 'content2\n');

      // Capture specific files
      const snapshot = await captureTargetedSnapshot(tempDir, ['file1.yaml', 'file2.json']);

      expect(snapshot.directory).toBe(tempDir);
      expect(snapshot.files.size).toBe(2);
      expect(snapshot.files.has('file1.yaml')).toBe(true);
      expect(snapshot.files.has('file2.json')).toBe(true);

      // Verify file info exists
      const file1Info = snapshot.files.get('file1.yaml');
      assert(file1Info !== undefined);
      expect(file1Info.exists).toBe(true);
      expect(file1Info.hash.length).toBe(64); // SHA-256 hex is 64 chars
      expect(file1Info.size).toBe(9); // 'content1\n'
    } finally {
      // Cleanup
      await import('node:fs').then((fs) => fs.promises.rm(tempDir, { recursive: true, force: true }));
    }
  });

  it('should skip non-existent files gracefully', async () => {
    const tempDir = join(tmpdir(), `dr-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      // Create one file
      await writeFile(join(tempDir, 'exists.yaml'), 'content\n');

      // Try to capture both existing and non-existent files
      const snapshot = await captureTargetedSnapshot(tempDir, ['exists.yaml', 'does-not-exist.yaml']);

      // Should only include the file that exists
      expect(snapshot.files.size).toBe(1);
      expect(snapshot.files.has('exists.yaml')).toBe(true);
      expect(snapshot.files.has('does-not-exist.yaml')).toBe(false);
    } finally {
      // Cleanup
      await import('node:fs').then((fs) => fs.promises.rm(tempDir, { recursive: true, force: true }));
    }
  });

  it('should return empty snapshot when no files are specified', async () => {
    const tempDir = join(tmpdir(), `dr-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      // Create a file but don't request it
      await writeFile(join(tempDir, 'unused.yaml'), 'content\n');

      // Capture empty list of files
      const snapshot = await captureTargetedSnapshot(tempDir, []);

      expect(snapshot.directory).toBe(tempDir);
      expect(snapshot.files.size).toBe(0);
    } finally {
      // Cleanup
      await import('node:fs').then((fs) => fs.promises.rm(tempDir, { recursive: true, force: true }));
    }
  });

  it('should handle empty snapshot when all requested files are missing', async () => {
    const tempDir = join(tmpdir(), `dr-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      // Request files that don't exist
      const snapshot = await captureTargetedSnapshot(tempDir, [
        'missing1.yaml',
        'missing2.json',
      ]);

      expect(snapshot.directory).toBe(tempDir);
      expect(snapshot.files.size).toBe(0);
    } finally {
      // Cleanup
      await import('node:fs').then((fs) => fs.promises.rm(tempDir, { recursive: true, force: true }));
    }
  });

  it('should generate consistent hashes for identical content', async () => {
    const tempDir = join(tmpdir(), `dr-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      // Create two snapshots of the same file
      await writeFile(join(tempDir, 'test.yaml'), 'same content\n');

      const snapshot1 = await captureTargetedSnapshot(tempDir, ['test.yaml']);
      const snapshot2 = await captureTargetedSnapshot(tempDir, ['test.yaml']);

      // Hashes should be identical
      const hash1 = snapshot1.files.get('test.yaml')?.hash;
      const hash2 = snapshot2.files.get('test.yaml')?.hash;

      expect(hash1).toBe(hash2);
    } finally {
      // Cleanup
      await import('node:fs').then((fs) => fs.promises.rm(tempDir, { recursive: true, force: true }));
    }
  });

  it('should capture files in subdirectories', async () => {
    const tempDir = join(tmpdir(), `dr-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'subdir'), { recursive: true });

    try {
      // Create files in subdirectories
      await writeFile(join(tempDir, 'root.yaml'), 'root\n');
      await writeFile(join(tempDir, 'subdir', 'nested.yaml'), 'nested\n');

      // Capture files with relative paths
      const snapshot = await captureTargetedSnapshot(tempDir, ['root.yaml', 'subdir/nested.yaml']);

      expect(snapshot.files.size).toBe(2);
      expect(snapshot.files.has('root.yaml')).toBe(true);
      expect(snapshot.files.has('subdir/nested.yaml')).toBe(true);
    } finally {
      // Cleanup
      await import('node:fs').then((fs) => fs.promises.rm(tempDir, { recursive: true, force: true }));
    }
  });

  it('should re-throw non-filesystem errors', async () => {
    const tempDir = join(tmpdir(), `dr-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      // Create a subdirectory that we'll attempt to read as a file
      // This causes readFile to throw EISDIR (not a "skip" error like ENOENT/EACCES/EPERM)
      const subdirPath = join(tempDir, 'subdir');
      await mkdir(subdirPath, { recursive: true });

      // Attempting to capture the subdirectory as a file should throw EISDIR
      // (because readFile can't read a directory), which should be re-thrown, not skipped
      await assert.rejects(
        async () => {
          await captureTargetedSnapshot(tempDir, ['subdir']);
        },
        (error: any) => {
          // Verify the error is EISDIR - a non-skippable error code
          return error instanceof Error && error.code === 'EISDIR';
        }
      );
    } finally {
      // Cleanup
      await import('node:fs').then((fs) => fs.promises.rm(tempDir, { recursive: true, force: true }));
    }
  });

  it('should handle permission errors (EACCES) by skipping file', async () => {
    const tempDir = join(tmpdir(), `dr-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      // Create a file
      const testFile = join(tempDir, 'restricted.yaml');
      await writeFile(testFile, 'content\n');

      // Remove read permissions
      await chmod(testFile, 0o000);

      // Verify that permissions were actually restricted by attempting to read
      let permissionsActuallyRestricted = false;
      try {
        await readFile(testFile, 'utf-8');
        // If we got here, permissions weren't restricted (e.g., running as root)
        permissionsActuallyRestricted = false;
      } catch (error) {
        // Permissions were successfully restricted
        if ((error as any)?.code === 'EACCES' || (error as any)?.message?.includes('Permission')) {
          permissionsActuallyRestricted = true;
        }
      }

      if (!permissionsActuallyRestricted) {
        // Skip this test on systems where chmod doesn't restrict file owner access
        // (e.g., running as root or on certain filesystems)
        console.log('Skipping EACCES test: chmod did not restrict file access on this system');
        return;
      }

      // Attempt to capture - should skip the file due to permission error
      const snapshot = await captureTargetedSnapshot(tempDir, ['restricted.yaml']);

      // File should be skipped (not included in snapshot)
      expect(snapshot.files.has('restricted.yaml')).toBe(false);
    } finally {
      // Cleanup - restore permissions before cleanup
      const testFile = join(tempDir, 'restricted.yaml');
      try {
        await chmod(testFile, 0o644);
      } catch {
        // Ignore errors during cleanup
      }
      await import('node:fs').then((fs) => fs.promises.rm(tempDir, { recursive: true, force: true }));
    }
  });

  it('should include file metadata in snapshot', async () => {
    const tempDir = join(tmpdir(), `dr-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      // Create a test file
      const testFile = join(tempDir, 'metadata-test.yaml');
      await writeFile(testFile, 'test content for metadata\n');

      const snapshot = await captureTargetedSnapshot(tempDir, ['metadata-test.yaml']);

      const fileInfo = snapshot.files.get('metadata-test.yaml');
      assert(fileInfo !== undefined);

      // Verify all metadata fields are present
      expect(fileInfo.exists).toBe(true);
      expect(typeof fileInfo.hash).toBe('string');
      expect(fileInfo.hash.length).toBe(64); // SHA-256
      expect(typeof fileInfo.mtime).toBe('number');
      expect(fileInfo.mtime > 0).toBe(true);
      expect(typeof fileInfo.size).toBe('number');
      expect(fileInfo.size > 0).toBe(true);
    } finally {
      // Cleanup
      await import('node:fs').then((fs) => fs.promises.rm(tempDir, { recursive: true, force: true }));
    }
  });
});
