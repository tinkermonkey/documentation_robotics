/**
 * Edge Case and Error Message Consistency Tests
 * Verifies that both CLIs handle edge cases and errors consistently
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'bun:test';
import { CLIHarness, checkPythonCLIAvailable, assertCLIsFailEquivalently } from './harness.js';
import { mkdir, rm } from 'fs/promises';
import { join, resolve } from 'path';

const TEMP_DIR = '/tmp/dr-compatibility-edge-cases';
let harness: CLIHarness;
let testDir: string;
let pythonCLIAvailable = false;

// Helper to conditionally run tests based on Python CLI availability
function compatTest(name: string, fn: () => Promise<void>) {
  it(name, async () => {
    if (!pythonCLIAvailable) {
      console.log(`⏭️  Skipping: ${name}`);
      return;
    }
    await fn();
  });
}

describe('Edge Cases and Error Consistency', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

  beforeEach(async () => {
    if (!pythonCLIAvailable) return;

    harness = new CLIHarness();

    testDir = join(TEMP_DIR, `test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (!pythonCLIAvailable) return;

    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  describe('missing required arguments', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should fail with missing model name in init', async () => {
      await assertCLIsFailEquivalently(harness, ['init'], testDir);
    });

    compatTest('should fail with missing element properties', async () => {
      // Initialize first using Python CLI as reference
      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      // Try to add without required arguments
      const result = await assertCLIsFailEquivalently(
        harness,
        ['element', 'add', 'business', 'business-service', 'test-id'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  describe('invalid argument values', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should fail with invalid layer name', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      await assertCLIsFailEquivalently(
        harness,
        ['element', 'add', 'invalid-layer', 'type', 'id'],
        testDir,
      );
    });

    compatTest('should fail with malformed element ID', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      await assertCLIsFailEquivalently(
        harness,
        ['element', 'add', 'business', 'business-service', 'INVALID_ID'],
        testDir,
      );
    });

    compatTest('should fail with special characters in element ID', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      await assertCLIsFailEquivalently(
        harness,
        ['element', 'add', 'business', 'business-service', 'test@id!'],
        testDir,
      );
    });
  });

  describe('state consistency', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should handle operations on non-existent models', async () => {
      // Try to list elements without initializing model
      const result = await harness.compareOutputs(['element', 'list', 'business'], testDir);

      // Both should fail or produce same result
      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should handle duplicate element additions consistently', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      // Add element once using Python CLI
      await harness.runPython(
        ['element', 'add', 'business', 'business-service', 'test-service', '--name', 'Test'],
        testDir,
      );

      // Try to add same element again using both CLIs
      const pythonResult = await harness.runPython(
        ['element', 'add', 'business', 'business-service', 'test-service', '--name', 'Test'],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['element', 'add', 'business', 'business-service', 'test-service', '--name', 'Test'],
        testDir,
      );

      // Both should handle duplicate the same way
      expect(pythonResult.exitCode).toBe(bunResult.exitCode);
    });
  });

  describe('whitespace and special characters', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should handle names with spaces consistently', async () => {
      await harness.runPython(['init', '--name', 'Test Model'], testDir);

      const result = await harness.compareOutputs([], testDir);

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should handle names with unicode characters', async () => {
      const pythonDir = join(testDir, 'unicode-python');
      const bunDir = join(testDir, 'unicode-bun');

      await mkdir(pythonDir, { recursive: true });
      await mkdir(bunDir, { recursive: true });

      const pythonResult = await harness.runPython(
        ['init', '--name', 'Test Model Ñ'],
        pythonDir,
      );
      const bunResult = await harness.runBun(
        ['init', '--name', 'Test Model Ñ'],
        bunDir,
      );

      expect(pythonResult.exitCode).toBe(bunResult.exitCode);
    });

    compatTest('should handle special characters in element names', async () => {
      const pythonDir = join(testDir, 'special-python');
      const bunDir = join(testDir, 'special-bun');

      await mkdir(pythonDir, { recursive: true });
      await mkdir(bunDir, { recursive: true });

      // Initialize using Python CLI for both
      await harness.runPython(['init', '--name', 'TestModel'], pythonDir);
      await harness.runPython(['init', '--name', 'TestModel'], bunDir);

      // Add element with special characters
      const pythonResult = await harness.runPython(
        ['element', 'add', 'business', 'business-service', 'test-svc', '--name', 'Service & Co.'],
        pythonDir,
      );
      const bunResult = await harness.runBun(
        ['element', 'add', 'business', 'business-service', 'test-svc', '--name', 'Service & Co.'],
        bunDir,
      );

      expect(pythonResult.exitCode).toBe(bunResult.exitCode);
    });
  });

  describe('command case sensitivity', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should fail consistently with wrong case commands', async () => {
      const result = await harness.compareOutputs(['INIT', '--name', 'Test']);

      // Both should fail with unknown command
      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should fail consistently with wrong case flags', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      const result = await assertCLIsFailEquivalently(
        harness,
        ['element', 'list', '--NAME', 'business'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  describe('path handling', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should handle absolute paths consistently', async () => {
      const absolutePath = resolve(testDir);

      const pythonResult = await harness.runPython(
        ['init', '--name', 'TestModel'],
        absolutePath,
      );
      const bunResult = await harness.runBun(
        ['init', '--name', 'TestModel'],
        absolutePath,
      );

      expect(pythonResult.exitCode).toBe(bunResult.exitCode);
    });

    compatTest('should handle relative paths consistently', async () => {
      // Both should work with current directory
      const result = await harness.compareOutputs(['init', '--name', 'TestModel'], testDir);

      expect(result.exitCodesMatch).toBe(true);
    });
  });

  describe('output format options', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should handle --format json consistently', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runBun(['init', '--name', 'TestModel'], testDir);

      await harness.runPython(
        ['element', 'add', 'business', 'business-service', 'test-svc', '--name', 'Test'],
        testDir,
      );
      await harness.runBun(
        ['element', 'add', 'business', 'business-service', 'test-svc', '--name', 'Test'],
        testDir,
      );

      const pythonResult = await harness.runPython(
        ['element', 'list', 'business', '--format', 'json'],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['element', 'list', 'business', '--format', 'json'],
        testDir,
      );

      // Both should produce valid JSON or fail the same way
      try {
        JSON.parse(pythonResult.stdout);
        JSON.parse(bunResult.stdout);
        expect(true).toBe(true);
      } catch {
        // If not JSON, both should fail the same way
        expect(pythonResult.exitCode).toBe(bunResult.exitCode);
      }
    });

    compatTest('should handle unknown format options consistently', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runBun(['init', '--name', 'TestModel'], testDir);

      const pythonResult = await harness.runPython(
        ['element', 'list', 'business', '--format', 'invalid-format'],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['element', 'list', 'business', '--format', 'invalid-format'],
        testDir,
      );

      // Both should fail or succeed the same way
      expect(pythonResult.exitCode === 0).toBe(bunResult.exitCode === 0);
    });
  });

  describe('empty and null values', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should handle empty element lists consistently', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runBun(['init', '--name', 'TestModel'], testDir);

      const result = await harness.compareOutputs(['element', 'list', 'business'], testDir);

      // Both should succeed
      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
    });

    compatTest('should handle empty search results consistently', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runBun(['init', '--name', 'TestModel'], testDir);

      const result = await harness.compareOutputs(
        ['element', 'search', 'nonexistent-term'],
        testDir,
      );

      // Both should succeed with empty results
      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
    });
  });

  describe('concurrent operations simulation', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should handle sequential operations consistently', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runBun(['init', '--name', 'TestModel'], testDir);

      // Sequence of operations
      const operations = [
        ['element', 'add', 'business', 'business-service', 'svc-1', '--name', 'Service 1'],
        ['element', 'add', 'business', 'business-service', 'svc-2', '--name', 'Service 2'],
        ['element', 'list', 'business'],
        ['element', 'search', 'Service'],
      ];

      for (const op of operations) {
        const pythonResult = await harness.runPython(op, testDir);
        const bunResult = await harness.runBun(op, testDir);

        expect(pythonResult.exitCode).toBe(bunResult.exitCode);
      }
    });
  });

  describe('error message structure consistency', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should include helpful context in error messages', async () => {
      const pythonResult = await harness.runPython(
        ['element', 'add', 'invalid-layer', 'type', 'id'],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['element', 'add', 'invalid-layer', 'type', 'id'],
        testDir,
      );

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);

      // Both should produce error output
      const pythonError = pythonResult.stdout + pythonResult.stderr;
      const bunError = bunResult.stdout + bunResult.stderr;

      expect(pythonError.length).toBeGreaterThan(0);
      expect(bunError.length).toBeGreaterThan(0);
    });
  });
});
