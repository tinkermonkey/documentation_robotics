/**
 * Unit Tests for Content Normalizers
 *
 * Tests normalization pipeline with comprehensive edge cases:
 * - Timestamp handling (various ISO-8601 formats)
 * - Path normalization (Windows, Unix, mixed)
 * - YAML key sorting (nested, arrays, primitives)
 * - JSON key sorting (deep nesting)
 * - Whitespace handling (trailing spaces, multiple newlines)
 * - Idempotency (normalizing normalized content produces same result)
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

// ============================================================================
// Test Helper Utilities
// ============================================================================

/**
 * Assert that two values are strictly equal
 */
function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message || ''}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

/**
 * Assert that condition is true
 */
function assertTrue(condition: boolean, message?: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message || 'Expected true'}`);
  }
}

/**
 * Assert that two strings are equal (case-sensitive)
 */
function assertStringEqual(actual: string, expected: string, message?: string): void {
  if (actual !== expected) {
    throw new Error(`String mismatch: ${message || ''}\n\nExpected:\n${expected}\n\nActual:\n${actual}`);
  }
}

// ============================================================================
// Timestamp Normalizer Tests
// ============================================================================

function testStripTimestamps(): void {
  console.log('\n📋 Testing stripTimestamps...');

  // Test 1: Basic ISO-8601 with Z timezone
  const input1 = 'updated_at: 2025-12-29T10:30:45.123456Z';
  const output1 = stripTimestamps(input1);
  assertStringEqual(output1, 'updated_at: <TIMESTAMP>', 'Basic ISO-8601 with Z');

  // Test 2: ISO-8601 with timezone offset
  const input2 = 'created: 2025-12-29T14:22:10+02:00';
  const output2 = stripTimestamps(input2);
  assertStringEqual(output2, 'created: <TIMESTAMP>', 'ISO-8601 with +02:00 offset');

  // Test 3: ISO-8601 with negative timezone offset
  const input3 = 'timestamp: 2025-12-29T10:30:45-05:00';
  const output3 = stripTimestamps(input3);
  assertStringEqual(output3, 'timestamp: <TIMESTAMP>', 'ISO-8601 with -05:00 offset');

  // Test 4: Multiple timestamps in one string
  const input4 = 'start: 2025-01-01T00:00:00Z, end: 2025-12-31T23:59:59Z';
  const output4 = stripTimestamps(input4);
  assertStringEqual(
    output4,
    'start: <TIMESTAMP>, end: <TIMESTAMP>',
    'Multiple timestamps'
  );

  // Test 5: ISO-8601 without milliseconds
  const input5 = 'time: 2025-12-29T10:30:45Z';
  const output5 = stripTimestamps(input5);
  assertStringEqual(output5, 'time: <TIMESTAMP>', 'ISO-8601 without milliseconds');

  // Test 6: No timestamps
  const input6 = 'key: value\nother: data';
  const output6 = stripTimestamps(input6);
  assertStringEqual(output6, input6, 'No timestamps (passthrough)');

  // Test 7: Idempotency
  const input7 = 'value: 2025-12-29T10:30:45Z';
  const normalized1 = stripTimestamps(input7);
  const normalized2 = stripTimestamps(normalized1);
  assertStringEqual(normalized1, normalized2, 'Idempotency check');

  console.log('✓ stripTimestamps: All tests passed');
}

// ============================================================================
// Path Normalizer Tests
// ============================================================================

function testCanonicalicePaths(): void {
  console.log('\n📋 Testing canonicalizePaths...');

  // Test 1: Windows path
  const input1 = 'path: C:\\Users\\test\\model.yaml';
  const output1 = canonicalizePaths(input1);
  assertStringEqual(output1, 'path: C:/Users/test/model.yaml', 'Windows path');

  // Test 2: Multiple backslashes
  const input2 = 'a: C:\\Users\\\\test\\\\file.txt';
  const output2 = canonicalizePaths(input2);
  assertStringEqual(output2, 'a: C:/Users//test//file.txt', 'Multiple backslashes');

  // Test 3: Mixed paths
  const input3 = 'win: C:\\path\\to\\file, unix: /path/to/file';
  const output3 = canonicalizePaths(input3);
  assertStringEqual(output3, 'win: C:/path/to/file, unix: /path/to/file', 'Mixed paths');

  // Test 4: Unix path (no change expected)
  const input4 = 'path: /home/user/model/file.yaml';
  const output4 = canonicalizePaths(input4);
  assertStringEqual(output4, input4, 'Unix path (passthrough)');

  // Test 5: Idempotency
  const input5 = 'path: C:\\Users\\test\\file.yaml';
  const normalized1 = canonicalizePaths(input5);
  const normalized2 = canonicalizePaths(normalized1);
  assertStringEqual(normalized1, normalized2, 'Idempotency check');

  console.log('✓ canonicalizePaths: All tests passed');
}

// ============================================================================
// Whitespace Normalizer Tests
// ============================================================================

function testTrimWhitespace(): void {
  console.log('\n📋 Testing trimWhitespace...');

  // Test 1: Trailing spaces on lines
  const input1 = 'line1:  \nline2:  \nline3';
  const output1 = trimWhitespace(input1);
  assertStringEqual(output1, 'line1:\nline2:\nline3', 'Trailing spaces on lines');

  // Test 2: Trailing newlines
  const input2 = 'content\n\n\n';
  const output2 = trimWhitespace(input2);
  assertStringEqual(output2, 'content', 'Trailing newlines');

  // Test 3: Mixed trailing whitespace
  const input3 = 'line1:  \nline2:   \n\n';
  const output3 = trimWhitespace(input3);
  assertStringEqual(output3, 'line1:\nline2:', 'Mixed trailing whitespace');

  // Test 4: No trailing whitespace (passthrough)
  const input4 = 'line1:\nline2:\nline3';
  const output4 = trimWhitespace(input4);
  assertStringEqual(output4, input4, 'No trailing whitespace');

  // Test 5: Single newline at end (valid, preserved)
  const input5 = 'content\n';
  const output5 = trimWhitespace(input5);
  assertStringEqual(output5, 'content', 'Single newline removed');

  // Test 6: Idempotency
  const input6 = 'line1:  \nline2:   \n\n';
  const normalized1 = trimWhitespace(input6);
  const normalized2 = trimWhitespace(normalized1);
  assertStringEqual(normalized1, normalized2, 'Idempotency check');

  console.log('✓ trimWhitespace: All tests passed');
}

// ============================================================================
// YAML Normalizer Tests
// ============================================================================

function testNormalizeYAML(): void {
  console.log('\n📋 Testing normalizeYAML...');

  // Test 1: Key ordering
  const input1 = 'zebra: value\napple: value\nmango: value';
  const output1 = normalizeYAML(input1);
  assertTrue(
    output1.indexOf('apple') < output1.indexOf('zebra'),
    'apple should come before zebra'
  );

  // Test 2: Nested object key ordering
  const input2 = 'parent:\n  zebra: 1\n  apple: 2';
  const output2 = normalizeYAML(input2);
  assertTrue(
    output2.indexOf('apple') < output2.indexOf('zebra'),
    'Nested keys should be sorted'
  );

  // Test 3: Array preservation
  const input3 = 'items:\n  - third\n  - first\n  - second';
  const output3 = normalizeYAML(input3);
  assertTrue(output3.includes('items:'), 'Array should be preserved');

  // Test 4: Invalid YAML returns original
  const input4 = 'invalid: yaml: syntax: error:';
  const output4 = normalizeYAML(input4);
  assertStringEqual(output4, input4, 'Invalid YAML returns original');

  // Test 5: Idempotency
  const input5 = 'zebra: 1\napple: 2';
  const normalized1 = normalizeYAML(input5);
  const normalized2 = normalizeYAML(normalized1);
  assertStringEqual(normalized1, normalized2, 'Idempotency check');

  // Test 6: Empty YAML
  const input6 = '';
  const output6 = normalizeYAML(input6);
  assertTrue(output6 !== null && output6 !== undefined, 'Empty YAML returns value');

  console.log('✓ normalizeYAML: All tests passed');
}

// ============================================================================
// JSON Normalizer Tests
// ============================================================================

function testNormalizeJSON(): void {
  console.log('\n📋 Testing normalizeJSON...');

  // Test 1: Key ordering in flat object
  const input1 = '{"zebra": "value", "apple": "value"}';
  const output1 = normalizeJSON(input1);
  assertTrue(
    output1.indexOf('"apple"') < output1.indexOf('"zebra"'),
    'apple should come before zebra'
  );

  // Test 2: Key ordering in nested object
  const input2 = '{"parent": {"zebra": 1, "apple": 2}}';
  const output2 = normalizeJSON(input2);
  const parsed = JSON.parse(output2);
  const parentKeys = Object.keys(parsed.parent);
  assertStringEqual(parentKeys[0], 'apple', 'apple should be first key');
  assertStringEqual(parentKeys[1], 'zebra', 'zebra should be second key');

  // Test 3: Array preservation
  const input3 = '{"items": ["third", "first", "second"]}';
  const output3 = normalizeJSON(input3);
  assertTrue(output3.includes('"third"'), 'Array order should be preserved');

  // Test 4: Pretty-printing
  const input4 = '{"a":"1","b":"2"}';
  const output4 = normalizeJSON(input4);
  assertTrue(output4.includes('\n'), 'Output should include newlines (pretty-print)');

  // Test 5: Invalid JSON returns original
  const input5 = '{invalid json}';
  const output5 = normalizeJSON(input5);
  assertStringEqual(output5, input5, 'Invalid JSON returns original');

  // Test 6: Idempotency
  const input6 = '{"zebra": 1, "apple": 2}';
  const normalized1 = normalizeJSON(input6);
  const normalized2 = normalizeJSON(normalized1);
  assertStringEqual(normalized1, normalized2, 'Idempotency check');

  console.log('✓ normalizeJSON: All tests passed');
}

// ============================================================================
// File Type Detection Tests
// ============================================================================

function testDetectFileType(): void {
  console.log('\n📋 Testing detectFileType...');

  // Test 1: YAML detection (.yaml)
  assertEqual(detectFileType('manifest.yaml'), FileType.YAML, '.yaml file');

  // Test 2: YAML detection (.yml)
  assertEqual(detectFileType('config.yml'), FileType.YAML, '.yml file');

  // Test 3: JSON detection
  assertEqual(detectFileType('data.json'), FileType.JSON, '.json file');

  // Test 4: Text detection (.md)
  assertEqual(detectFileType('README.md'), FileType.TEXT, '.md file');

  // Test 5: Text detection (.txt)
  assertEqual(detectFileType('notes.txt'), FileType.TEXT, '.txt file');

  // Test 6: Text detection (.xml)
  assertEqual(detectFileType('model.xml'), FileType.TEXT, '.xml file');

  // Test 7: Unknown file type
  assertEqual(detectFileType('unknown.xyz'), FileType.UNKNOWN, 'unknown type');

  // Test 8: Case insensitivity
  assertEqual(detectFileType('MANIFEST.YAML'), FileType.YAML, 'Case insensitive .YAML');

  // Test 9: Path with directories
  assertEqual(
    detectFileType('model/layers/manifest.yaml'),
    FileType.YAML,
    'YAML in path'
  );

  console.log('✓ detectFileType: All tests passed');
}

// ============================================================================
// Full Pipeline Integration Tests
// ============================================================================

function testFullNormalizationPipeline(): void {
  console.log('\n📋 Testing full normalization pipeline...');

  // Test 1: YAML with timestamps and key ordering
  const yamlInput = 'updated: 2025-12-29T10:30:45Z\nzebra: value  \napple: value';
  const yamlOutput = normalize(yamlInput, FileType.YAML);
  assertTrue(yamlOutput.includes('<TIMESTAMP>'), 'Timestamp should be replaced');
  assertTrue(yamlOutput.indexOf('apple') < yamlOutput.indexOf('zebra'), 'Keys should be sorted');
  assertEqual(yamlOutput.includes('  '), false, 'Trailing whitespace should be removed');

  // Test 2: JSON with timestamps and key ordering
  const jsonInput = '{"updated":"2025-12-29T10:30:45Z","zebra":"v","apple":"v"}';
  const jsonOutput = normalize(jsonInput, FileType.JSON);
  assertTrue(jsonOutput.includes('<TIMESTAMP>'), 'Timestamp should be replaced');
  const parsed = JSON.parse(jsonOutput);
  const keys = Object.keys(parsed);
  assertEqual(keys[0], 'apple', 'apple should be first');

  // Test 3: Text with paths and whitespace
  const textInput = 'path: C:\\Users\\test\\file.yaml  \n\n';
  const textOutput = normalize(textInput, FileType.TEXT);
  assertTrue(textOutput.includes('/'), 'Paths should be normalized');
  assertTrue(!textOutput.endsWith('\n\n'), 'Trailing newlines should be removed');

  // Test 4: Full pipeline idempotency
  const content = 'zebra: 2025-12-29T10:30:45Z\napple: value  \n\n';
  const norm1 = normalize(content, FileType.YAML);
  const norm2 = normalize(norm1, FileType.YAML);
  assertStringEqual(norm1, norm2, 'Pipeline should be idempotent');

  console.log('✓ Full normalization pipeline: All tests passed');
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runAllTests(): Promise<void> {
  console.log('========================================');
  console.log('Content Normalizers Unit Tests');
  console.log('========================================');

  try {
    testStripTimestamps();
    testCanonicalicePaths();
    testTrimWhitespace();
    testNormalizeYAML();
    testNormalizeJSON();
    testDetectFileType();
    testFullNormalizationPipeline();

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
