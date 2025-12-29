/**
 * Unit Tests for Filesystem Comparator
 *
 * Tests snapshot capture, comparison, and diff reporting functionality
 */

import {
  FilesystemSnapshot,
  FileInfo,
  compareSnapshots,
  formatComparisonResult,
} from './comparator';

// ============================================================================
// Test Helper Utilities
// ============================================================================

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${message || ''}\nExpected: ${expected}\nActual: ${actual}`
    );
  }
}

function assertTrue(condition: boolean, message?: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message || 'Expected true'}`);
  }
}

function assertArrayLength<T>(array: T[], expectedLength: number, message?: string): void {
  if (array.length !== expectedLength) {
    throw new Error(
      `Array length mismatch: ${message || ''}\nExpected: ${expectedLength}\nActual: ${array.length}`
    );
  }
}

// ============================================================================
// Snapshot Comparison Tests
// ============================================================================

function testSnapshotComparison(): void {
  console.log('\n📋 Testing snapshot comparison...');

  // Create two identical snapshots
  const before: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([
      ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
      ['file2.json', { exists: true, hash: 'hash2', mtime: 200, size: 100 }],
    ]),
  };

  // Test 1: Identical snapshots
  const after1 = JSON.parse(JSON.stringify({ ...before }));
  after1.files = new Map(before.files);
  const result1 = compareSnapshots(before, after1);
  assertTrue(result1.identical, 'Identical snapshots should match');
  assertEqual(result1.summary.total, 0, 'No changes expected');

  // Test 2: Added file
  const after2: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([
      ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
      ['file2.json', { exists: true, hash: 'hash2', mtime: 200, size: 100 }],
      ['file3.txt', { exists: true, hash: 'hash3', mtime: 300, size: 75 }],
    ]),
  };
  const result2 = compareSnapshots(before, after2);
  assertTrue(!result2.identical, 'Different snapshots should not match');
  assertEqual(result2.summary.added, 1, 'One file added');
  assertEqual(result2.summary.total, 1, 'Total of 1 change');

  // Test 3: Deleted file
  const after3: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }]]),
  };
  const result3 = compareSnapshots(before, after3);
  assertTrue(!result3.identical, 'Different snapshots should not match');
  assertEqual(result3.summary.deleted, 1, 'One file deleted');
  assertEqual(result3.summary.total, 1, 'Total of 1 change');

  // Test 4: Modified file (hash changed)
  const after4: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([
      ['file1.yaml', { exists: true, hash: 'hash1_modified', mtime: 150, size: 55 }],
      ['file2.json', { exists: true, hash: 'hash2', mtime: 200, size: 100 }],
    ]),
  };
  const result4 = compareSnapshots(before, after4);
  assertTrue(!result4.identical, 'Different snapshots should not match');
  assertEqual(result4.summary.modified, 1, 'One file modified');
  assertEqual(result4.summary.total, 1, 'Total of 1 change');

  // Test 5: Multiple changes
  const after5: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([
      ['file1.yaml', { exists: true, hash: 'hash1_modified', mtime: 150, size: 55 }],
      ['file3.txt', { exists: true, hash: 'hash3', mtime: 300, size: 75 }],
    ]),
  };
  const result5 = compareSnapshots(before, after5);
  assertEqual(result5.summary.deleted, 1, 'One file deleted');
  assertEqual(result5.summary.added, 1, 'One file added');
  assertEqual(result5.summary.modified, 1, 'One file modified');
  assertEqual(result5.summary.total, 3, 'Total of 3 changes');

  console.log('✓ snapshot comparison: All tests passed');
}

// ============================================================================
// Change Detection Tests
// ============================================================================

function testChangeDetection(): void {
  console.log('\n📋 Testing change detection...');

  const before: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([
      ['a.yaml', { exists: true, hash: 'hash_a', mtime: 100, size: 10 }],
      ['b.yaml', { exists: true, hash: 'hash_b', mtime: 200, size: 20 }],
    ]),
  };

  // Test 1: Verify change type is 'added'
  const after1: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([
      ['a.yaml', { exists: true, hash: 'hash_a', mtime: 100, size: 10 }],
      ['b.yaml', { exists: true, hash: 'hash_b', mtime: 200, size: 20 }],
      ['c.yaml', { exists: true, hash: 'hash_c', mtime: 300, size: 30 }],
    ]),
  };
  const result1 = compareSnapshots(before, after1);
  assertTrue(result1.changes.some((c) => c.type === 'added'), 'Should detect added file');
  assertTrue(result1.changes.some((c) => c.path === 'c.yaml'), 'Should identify correct file');

  // Test 2: Verify change type is 'deleted'
  const after2: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([['a.yaml', { exists: true, hash: 'hash_a', mtime: 100, size: 10 }]]),
  };
  const result2 = compareSnapshots(before, after2);
  assertTrue(result2.changes.some((c) => c.type === 'deleted'), 'Should detect deleted file');
  assertTrue(result2.changes.some((c) => c.path === 'b.yaml'), 'Should identify correct file');

  // Test 3: Verify change type is 'modified'
  const after3: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([
      ['a.yaml', { exists: true, hash: 'hash_a_modified', mtime: 150, size: 15 }],
      ['b.yaml', { exists: true, hash: 'hash_b', mtime: 200, size: 20 }],
    ]),
  };
  const result3 = compareSnapshots(before, after3);
  assertTrue(result3.changes.some((c) => c.type === 'modified'), 'Should detect modified file');

  // Test 4: Changes should be sorted by path
  const after4: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([
      ['z.yaml', { exists: true, hash: 'hash_z', mtime: 400, size: 40 }],
      ['a.yaml', { exists: true, hash: 'hash_a', mtime: 100, size: 10 }],
      ['m.yaml', { exists: true, hash: 'hash_m', mtime: 500, size: 50 }],
    ]),
  };
  const result4 = compareSnapshots(before, after4);
  assertArrayLength(result4.changes, 3, 'Should have 3 changes');
  assertTrue(
    result4.changes[0].path < result4.changes[1].path,
    'Changes should be sorted by path'
  );

  console.log('✓ change detection: All tests passed');
}

// ============================================================================
// Summary Statistics Tests
// ============================================================================

function testSummaryStatistics(): void {
  console.log('\n📋 Testing summary statistics...');

  // Test 1: Empty snapshots
  const before1: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map(),
  };
  const after1: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map(),
  };
  const result1 = compareSnapshots(before1, after1);
  assertEqual(result1.summary.total, 0, 'No changes in empty snapshots');
  assertEqual(result1.summary.added, 0, 'No additions');
  assertEqual(result1.summary.deleted, 0, 'No deletions');
  assertEqual(result1.summary.modified, 0, 'No modifications');

  // Test 2: Multiple changes
  const before2: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([
      ['keep.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 10 }],
      ['delete1.yaml', { exists: true, hash: 'hash2', mtime: 200, size: 20 }],
      ['delete2.yaml', { exists: true, hash: 'hash3', mtime: 300, size: 30 }],
      ['modify.yaml', { exists: true, hash: 'hash4', mtime: 400, size: 40 }],
    ]),
  };
  const after2: FilesystemSnapshot = {
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
  const result2 = compareSnapshots(before2, after2);
  assertEqual(result2.summary.deleted, 2, 'Should have 2 deletions');
  assertEqual(result2.summary.added, 3, 'Should have 3 additions');
  assertEqual(result2.summary.modified, 1, 'Should have 1 modification');
  assertEqual(result2.summary.total, 6, 'Total should be 6 changes');

  console.log('✓ summary statistics: All tests passed');
}

// ============================================================================
// Formatting Tests
// ============================================================================

function testFormatComparisonResult(): void {
  console.log('\n📋 Testing formatComparisonResult...');

  // Test 1: Identical snapshots
  const result1 = {
    identical: true,
    changes: [],
    summary: { added: 0, deleted: 0, modified: 0, total: 0 },
  };
  const formatted1 = formatComparisonResult(result1);
  assertTrue(formatted1.includes('IDENTICAL'), 'Should show IDENTICAL status');
  assertTrue(formatted1.includes('✓'), 'Should include success emoji');

  // Test 2: Different snapshots
  const result2 = {
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
  const formatted2 = formatComparisonResult(result2);
  assertTrue(formatted2.includes('DIFFERENT'), 'Should show DIFFERENT status');
  assertTrue(formatted2.includes('✗'), 'Should include failure emoji');
  assertTrue(formatted2.includes('3 changes'), 'Should show change count');
  assertTrue(formatted2.includes('+ added.yaml'), 'Should show added file');
  assertTrue(formatted2.includes('- deleted.yaml'), 'Should show deleted file');
  assertTrue(formatted2.includes('~ modified.yaml'), 'Should show modified file');

  console.log('✓ formatComparisonResult: All tests passed');
}

// ============================================================================
// Edge Cases Tests
// ============================================================================

function testEdgeCases(): void {
  console.log('\n📋 Testing edge cases...');

  // Test 1: Snapshots with single file
  const before1: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([['only.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 10 }]]),
  };
  const after1: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map(),
  };
  const result1 = compareSnapshots(before1, after1);
  assertEqual(result1.summary.deleted, 1, 'Should detect deletion');

  // Test 2: Large number of changes
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

  const before2: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: beforeFiles,
  };
  const after2: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: afterFiles,
  };
  const result2 = compareSnapshots(before2, after2);
  assertEqual(result2.summary.modified, fileCount, 'Should detect all modifications');

  // Test 3: Paths with special characters
  const before3: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([
      ['path/with spaces/file.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 10 }],
      ['path/with-dashes/file.yaml', { exists: true, hash: 'hash2', mtime: 200, size: 20 }],
    ]),
  };
  const after3: FilesystemSnapshot = {
    timestamp: Date.now(),
    directory: '/test',
    files: new Map([
      ['path/with spaces/file.yaml', { exists: true, hash: 'hash1_modified', mtime: 100, size: 10 }],
    ]),
  };
  const result3 = compareSnapshots(before3, after3);
  assertEqual(result3.summary.total, 2, 'Should handle special characters in paths');

  console.log('✓ edge cases: All tests passed');
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runAllTests(): Promise<void> {
  console.log('========================================');
  console.log('Filesystem Comparator Unit Tests');
  console.log('========================================');

  try {
    testSnapshotComparison();
    testChangeDetection();
    testSummaryStatistics();
    testFormatComparisonResult();
    testEdgeCases();

    console.log('\n========================================');
    console.log('✓ All tests passed!');
    console.log('========================================\n');
  } catch (error) {
    console.error('\n✗ Test failed:');
    console.error(error);
    process.exit(1);
  }
}

// Execute tests
runAllTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
