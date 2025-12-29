/**
 * Test Runner for Node.js
 * Executes tests written in Bun-compatible format
 */

import {
  stripTimestamps,
  canonicalizePaths,
  trimWhitespace,
  normalizeYAML,
  normalizeJSON,
  normalize,
  detectFileType,
  FileType,
} from './normalizers/index';

import { compareSnapshots, formatComparisonResult } from './comparator';

// ============================================================================
// Simple test assertion framework
// ============================================================================

let testCount = 0;
let passedCount = 0;
let failedCount = 0;

function describe(name: string, callback: () => void) {
  console.log(`\n${name}`);
  callback();
}

function it(description: string, callback: () => void) {
  testCount++;
  try {
    callback();
    console.log(`  ✓ ${description}`);
    passedCount++;
  } catch (error) {
    console.log(`  ✗ ${description}`);
    console.log(`    ${error}`);
    failedCount++;
  }
}

function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}`);
      }
    },
  };
}

// ============================================================================
// Timestamp Normalizer Tests
// ============================================================================

describe('stripTimestamps', () => {
  it('should strip basic ISO-8601 with Z timezone', () => {
    const input = 'updated_at: 2025-12-29T10:30:45.123456Z';
    const output = stripTimestamps(input);
    expect(output).toBe('updated_at: <TIMESTAMP>');
  });

  it('should strip ISO-8601 with positive timezone offset', () => {
    const input = 'created: 2025-12-29T14:22:10+02:00';
    const output = stripTimestamps(input);
    expect(output).toBe('created: <TIMESTAMP>');
  });

  it('should strip multiple timestamps in one string', () => {
    const input = 'start: 2025-01-01T00:00:00Z, end: 2025-12-31T23:59:59Z';
    const output = stripTimestamps(input);
    expect(output).toBe('start: <TIMESTAMP>, end: <TIMESTAMP>');
  });

  it('should be idempotent', () => {
    const input = 'value: 2025-12-29T10:30:45Z';
    const normalized1 = stripTimestamps(input);
    const normalized2 = stripTimestamps(normalized1);
    expect(normalized1).toBe(normalized2);
  });
});

// ============================================================================
// Path Normalizer Tests
// ============================================================================

describe('canonicalizePaths', () => {
  it('should normalize Windows paths', () => {
    const input = 'path: C:\\Users\\test\\model.yaml';
    const output = canonicalizePaths(input);
    expect(output).toBe('path: C:/Users/test/model.yaml');
  });

  it('should normalize mixed paths', () => {
    const input = 'win: C:\\path\\to\\file, unix: /path/to/file';
    const output = canonicalizePaths(input);
    expect(output).toBe('win: C:/path/to/file, unix: /path/to/file');
  });

  it('should be idempotent', () => {
    const input = 'path: C:\\Users\\test\\file.yaml';
    const normalized1 = canonicalizePaths(input);
    const normalized2 = canonicalizePaths(normalized1);
    expect(normalized1).toBe(normalized2);
  });
});

// ============================================================================
// Whitespace Normalizer Tests
// ============================================================================

describe('trimWhitespace', () => {
  it('should remove trailing spaces on lines', () => {
    const input = 'line1:  \nline2:  \nline3';
    const output = trimWhitespace(input);
    expect(output).toBe('line1:\nline2:\nline3');
  });

  it('should remove trailing newlines', () => {
    const input = 'content\n\n\n';
    const output = trimWhitespace(input);
    expect(output).toBe('content');
  });

  it('should be idempotent', () => {
    const input = 'line1:  \nline2:   \n\n';
    const normalized1 = trimWhitespace(input);
    const normalized2 = trimWhitespace(normalized1);
    expect(normalized1).toBe(normalized2);
  });
});

// ============================================================================
// YAML Normalizer Tests
// ============================================================================

describe('normalizeYAML', () => {
  it('should sort keys alphabetically', () => {
    const input = 'zebra: value\napple: value\nmango: value';
    const output = normalizeYAML(input);
    if (!(output.indexOf('apple') < output.indexOf('zebra'))) {
      throw new Error('apple should come before zebra');
    }
  });

  it('should return original for invalid YAML', () => {
    const input = 'invalid: yaml: syntax: error:';
    const output = normalizeYAML(input);
    expect(output).toBe(input);
  });

  it('should be idempotent', () => {
    const input = 'zebra: 1\napple: 2';
    const normalized1 = normalizeYAML(input);
    const normalized2 = normalizeYAML(normalized1);
    expect(normalized1).toBe(normalized2);
  });
});

// ============================================================================
// JSON Normalizer Tests
// ============================================================================

describe('normalizeJSON', () => {
  it('should sort keys in flat object', () => {
    const input = '{"zebra": "value", "apple": "value"}';
    const output = normalizeJSON(input);
    if (!(output.indexOf('"apple"') < output.indexOf('"zebra"'))) {
      throw new Error('apple should come before zebra');
    }
  });

  it('should return original for invalid JSON', () => {
    const input = '{invalid json}';
    const output = normalizeJSON(input);
    expect(output).toBe(input);
  });

  it('should be idempotent', () => {
    const input = '{"zebra": 1, "apple": 2}';
    const normalized1 = normalizeJSON(input);
    const normalized2 = normalizeJSON(normalized1);
    expect(normalized1).toBe(normalized2);
  });
});

// ============================================================================
// File Type Detection Tests
// ============================================================================

describe('detectFileType', () => {
  it('should detect YAML with .yaml extension', () => {
    expect(detectFileType('manifest.yaml')).toBe(FileType.YAML);
  });

  it('should detect JSON', () => {
    expect(detectFileType('data.json')).toBe(FileType.JSON);
  });

  it('should detect Markdown as TEXT', () => {
    expect(detectFileType('README.md')).toBe(FileType.TEXT);
  });

  it('should be case insensitive', () => {
    expect(detectFileType('MANIFEST.YAML')).toBe(FileType.YAML);
  });
});

// ============================================================================
// Comparator Tests
// ============================================================================

describe('compareSnapshots', () => {
  it('should identify identical snapshots', () => {
    const before = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
      ]),
    };

    const after = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
      ]),
    };

    const result = compareSnapshots(before, after);
    expect(result.identical).toBe(true);
    expect(result.summary.total).toBe(0);
  });

  it('should detect added files', () => {
    const before = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
      ]),
    };

    const after = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
        ['file2.txt', { exists: true, hash: 'hash2', mtime: 200, size: 75 }],
      ]),
    };

    const result = compareSnapshots(before, after);
    expect(result.identical).toBe(false);
    expect(result.summary.added).toBe(1);
  });

  it('should detect deleted files', () => {
    const before = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
        ['file2.json', { exists: true, hash: 'hash2', mtime: 200, size: 100 }],
      ]),
    };

    const after = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
      ]),
    };

    const result = compareSnapshots(before, after);
    expect(result.identical).toBe(false);
    expect(result.summary.deleted).toBe(1);
  });

  it('should detect modified files', () => {
    const before = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1', mtime: 100, size: 50 }],
      ]),
    };

    const after = {
      timestamp: Date.now(),
      directory: '/test',
      files: new Map([
        ['file1.yaml', { exists: true, hash: 'hash1_modified', mtime: 150, size: 55 }],
      ]),
    };

    const result = compareSnapshots(before, after);
    expect(result.identical).toBe(false);
    expect(result.summary.modified).toBe(1);
  });
});

// ============================================================================
// Test Summary
// ============================================================================

console.log('\n========================================');
console.log('Test Results');
console.log('========================================');
console.log(`Total: ${testCount}`);
console.log(`Passed: ${passedCount}`);
console.log(`Failed: ${failedCount}`);

if (failedCount > 0) {
  console.log('\n❌ Some tests failed');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
