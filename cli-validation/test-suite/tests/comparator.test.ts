/**
 * Unit Tests for Filesystem Comparator
 *
 * Tests snapshot capture, comparison, and diff reporting functionality
 */

import { describe, it, expect } from 'bun:test';
import { FilesystemSnapshot, FileInfo, compareSnapshots, formatComparisonResult } from '../comparator.js';

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
