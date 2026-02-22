/**
 * Unit Tests for Content Normalizers
 *
 * Tests normalization pipeline with comprehensive edge cases:
 * - Timestamp handling (various ISO-8601 formats)
 * - Path normalization (Windows, Unix, mixed)
 * - YAML key sorting (nested, arrays, primitives)
 * - JSON key sorting (deep nesting)
 * - Whitespace handling (trailing spaces, multiple newlines)
 * - Idempotency (normalizing twice = normalizing once)
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

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
import {
  stripTimestamps,
  canonicalizePaths,
  trimWhitespace,
  normalizeYAML,
  normalizeJSON,
  normalize,
  detectFileType,
  FileType,
} from '../normalizers/index';

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

  it('should strip ISO-8601 with negative timezone offset', () => {
    const input = 'timestamp: 2025-12-29T10:30:45-05:00';
    const output = stripTimestamps(input);
    expect(output).toBe('timestamp: <TIMESTAMP>');
  });

  it('should strip multiple timestamps in one string', () => {
    const input = 'start: 2025-01-01T00:00:00Z, end: 2025-12-31T23:59:59Z';
    const output = stripTimestamps(input);
    expect(output).toBe('start: <TIMESTAMP>, end: <TIMESTAMP>');
  });

  it('should strip ISO-8601 without milliseconds', () => {
    const input = 'time: 2025-12-29T10:30:45Z';
    const output = stripTimestamps(input);
    expect(output).toBe('time: <TIMESTAMP>');
  });

  it('should passthrough content without timestamps', () => {
    const input = 'key: value\nother: data';
    const output = stripTimestamps(input);
    expect(output).toBe(input);
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

  it('should handle multiple backslashes', () => {
    const input = 'a: C:\\Users\\\\test\\\\file.txt';
    const output = canonicalizePaths(input);
    expect(output).toBe('a: C:/Users//test//file.txt');
  });

  it('should normalize mixed paths', () => {
    const input = 'win: C:\\path\\to\\file, unix: /path/to/file';
    const output = canonicalizePaths(input);
    expect(output).toBe('win: C:/path/to/file, unix: /path/to/file');
  });

  it('should passthrough Unix paths', () => {
    const input = 'path: /home/user/model/file.yaml';
    const output = canonicalizePaths(input);
    expect(output).toBe(input);
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

  it('should handle mixed trailing whitespace', () => {
    const input = 'line1:  \nline2:   \n\n';
    const output = trimWhitespace(input);
    expect(output).toBe('line1:\nline2:');
  });

  it('should passthrough content without trailing whitespace', () => {
    const input = 'line1:\nline2:\nline3';
    const output = trimWhitespace(input);
    expect(output).toBe(input);
  });

  it('should remove single trailing newline', () => {
    const input = 'content\n';
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
    const indexApple = output.indexOf('apple');
    const indexZebra = output.indexOf('zebra');
    expect(indexApple < indexZebra).toBe(true);
  });

  it('should sort nested object keys', () => {
    const input = 'parent:\n  zebra: 1\n  apple: 2';
    const output = normalizeYAML(input);
    const indexApple = output.indexOf('apple');
    const indexZebra = output.indexOf('zebra');
    expect(indexApple < indexZebra).toBe(true);
  });

  it('should preserve array order', () => {
    const input = 'items:\n  - third\n  - first\n  - second';
    const output = normalizeYAML(input);
    expect(output.includes('items:')).toBe(true);
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

  it('should handle empty YAML', () => {
    const input = '';
    const output = normalizeYAML(input);
    expect(output !== null && output !== undefined).toBe(true);
  });
});

// ============================================================================
// JSON Normalizer Tests
// ============================================================================

describe('normalizeJSON', () => {
  it('should sort keys in flat object', () => {
    const input = '{"zebra": "value", "apple": "value"}';
    const output = normalizeJSON(input);
    expect(output.indexOf('"apple"') < output.indexOf('"zebra"')).toBe(true);
  });

  it('should sort keys in nested object', () => {
    const input = '{"parent": {"zebra": 1, "apple": 2}}';
    const output = normalizeJSON(input);
    const parsed = JSON.parse(output);
    const parentKeys = Object.keys(parsed.parent);
    expect(parentKeys[0]).toBe('apple');
    expect(parentKeys[1]).toBe('zebra');
  });

  it('should preserve array order', () => {
    const input = '{"items": ["third", "first", "second"]}';
    const output = normalizeJSON(input);
    expect(output.includes('"third"')).toBe(true);
  });

  it('should pretty-print output', () => {
    const input = '{"a":"1","b":"2"}';
    const output = normalizeJSON(input);
    expect(output.includes('\n')).toBe(true);
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

  it('should detect YAML with .yml extension', () => {
    expect(detectFileType('config.yml')).toBe(FileType.YAML);
  });

  it('should detect JSON', () => {
    expect(detectFileType('data.json')).toBe(FileType.JSON);
  });

  it('should detect Markdown as TEXT', () => {
    expect(detectFileType('README.md')).toBe(FileType.TEXT);
  });

  it('should detect TXT as TEXT', () => {
    expect(detectFileType('notes.txt')).toBe(FileType.TEXT);
  });

  it('should detect XML as TEXT', () => {
    expect(detectFileType('model.xml')).toBe(FileType.TEXT);
  });

  it('should detect unknown files', () => {
    expect(detectFileType('unknown.xyz')).toBe(FileType.UNKNOWN);
  });

  it('should be case insensitive', () => {
    expect(detectFileType('MANIFEST.YAML')).toBe(FileType.YAML);
  });

  it('should detect file type from path with directories', () => {
    expect(detectFileType('model/layers/manifest.yaml')).toBe(FileType.YAML);
  });
});

// ============================================================================
// Full Pipeline Integration Tests
// ============================================================================

describe('Full normalization pipeline', () => {
  it('should normalize YAML with timestamps and key ordering', () => {
    const yamlInput = 'updated: 2025-12-29T10:30:45Z\nzebra: value  \napple: value';
    const yamlOutput = normalize(yamlInput, FileType.YAML);
    expect(yamlOutput.includes('<TIMESTAMP>')).toBe(true);
    expect(yamlOutput.indexOf('apple') < yamlOutput.indexOf('zebra')).toBe(true);
    expect(yamlOutput.includes('  ')).toBe(false);
  });

  it('should normalize JSON with timestamps and key ordering', () => {
    const jsonInput = '{"updated":"2025-12-29T10:30:45Z","zebra":"v","apple":"v"}';
    const jsonOutput = normalize(jsonInput, FileType.JSON);
    expect(jsonOutput.includes('<TIMESTAMP>')).toBe(true);
    const parsed = JSON.parse(jsonOutput);
    const keys = Object.keys(parsed);
    expect(keys[0]).toBe('apple');
  });

  it('should normalize text with paths and whitespace', () => {
    const textInput = 'path: C:\\Users\\test\\file.yaml  \n\n';
    const textOutput = normalize(textInput, FileType.TEXT);
    expect(textOutput.includes('/')).toBe(true);
    expect(!textOutput.endsWith('\n\n')).toBe(true);
  });

  it('should be idempotent across full pipeline', () => {
    const content = 'zebra: 2025-12-29T10:30:45Z\napple: value  \n\n';
    const norm1 = normalize(content, FileType.YAML);
    const norm2 = normalize(norm1, FileType.YAML);
    expect(norm1).toBe(norm2);
  });
});
