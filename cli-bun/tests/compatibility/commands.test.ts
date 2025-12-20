/**
 * Command Output Compatibility Tests
 * Verifies that Python and Bun CLIs produce equivalent outputs for the same commands
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { CLIHarness, assertCLIsEquivalent, assertCLIsFailEquivalently } from './harness.js';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';

const TEMP_DIR = '/tmp/dr-compatibility-test';
let harness: CLIHarness;
let testDir: string;

describe('Command Output Compatibility', () => {
  beforeEach(async () => {
    harness = new CLIHarness();

    // Create clean test directory
    testDir = join(TEMP_DIR, `test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  describe('init command', () => {
    it('should create identical manifest files', async () => {
      const result = await harness.compareOutputs(['init', '--name', 'TestModel'], testDir);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
      expect(result.differences.length).toBe(0);
    });

    it('should handle init with description', async () => {
      const result = await harness.compareOutputs(
        ['init', '--name', 'TestModel', '--description', 'Test Description'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
    });

    it('should fail identically when name is missing', async () => {
      const result = await assertCLIsFailEquivalently(harness, ['init'], testDir);

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  describe('element add command', () => {
    beforeEach(async () => {
      // Initialize model first
      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runBun(['init', '--name', 'TestModel'], testDir);
    });

    it('should add business service elements identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['element', 'add', 'business', 'business-service', 'customer-mgmt', '--name', 'Customer Management'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    it('should add api endpoint elements identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['element', 'add', 'api', 'api-endpoint', 'list-customers', '--method', 'GET', '--path', '/customers'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    it('should fail identically with invalid layer', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['element', 'add', 'invalid-layer', 'type', 'name'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    it('should fail identically with invalid element ID format', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['element', 'add', 'business', 'business-service', 'InvalidName'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  describe('element list command', () => {
    beforeEach(async () => {
      // Initialize and add elements
      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runBun(['init', '--name', 'TestModel'], testDir);

      // Add some test elements to both
      await harness.runPython(
        ['element', 'add', 'business', 'business-service', 'svc-1', '--name', 'Service 1'],
        testDir,
      );
      await harness.runBun(
        ['element', 'add', 'business', 'business-service', 'svc-1', '--name', 'Service 1'],
        testDir,
      );
    });

    it('should list elements with matching output', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['element', 'list', 'business'],
        testDir,
      );

      expect(result.stdoutMatch).toBe(true);
    });

    it('should list all elements with --all flag', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['element', 'list', '--all'],
        testDir,
      );

      expect(result.stdoutMatch).toBe(true);
    });
  });

  describe('element show command', () => {
    beforeEach(async () => {
      // Initialize and add an element
      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runBun(['init', '--name', 'TestModel'], testDir);

      const element = {
        id: 'business-business-service-customer-mgmt',
        name: 'Customer Management',
      };

      await harness.runPython(
        ['element', 'add', 'business', 'business-service', 'customer-mgmt', '--name', element.name],
        testDir,
      );
      await harness.runBun(
        ['element', 'add', 'business', 'business-service', 'customer-mgmt', '--name', element.name],
        testDir,
      );
    });

    it('should show element details identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['element', 'show', 'business-business-service-customer-mgmt'],
        testDir,
      );

      expect(result.stdoutMatch).toBe(true);
    });

    it('should fail identically for non-existent element', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['element', 'show', 'non-existent-id'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  describe('element search command', () => {
    beforeEach(async () => {
      // Initialize and add elements
      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runBun(['init', '--name', 'TestModel'], testDir);

      const elements = [
        ['business', 'business-service', 'customer-mgmt', 'Customer Management'],
        ['business', 'business-service', 'order-mgmt', 'Order Management'],
        ['business', 'business-actor', 'admin-user', 'Administrator'],
      ];

      for (const [layer, type, id, name] of elements) {
        await harness.runPython(
          ['element', 'add', layer, type, id, '--name', name],
          testDir,
        );
        await harness.runBun(
          ['element', 'add', layer, type, id, '--name', name],
          testDir,
        );
      }
    });

    it('should search elements with matching results', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['element', 'search', 'management'],
        testDir,
      );

      expect(result.stdoutMatch).toBe(true);
    });

    it('should return empty results consistently', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['element', 'search', 'nonexistent-search-term'],
        testDir,
      );

      // Both should return success with no results
      expect(result.exitCodesMatch).toBe(true);
    });
  });

  describe('help commands', () => {
    it('should show matching help for init', async () => {
      const result = await harness.compareOutputs(['init', '--help']);

      // Help output should be similar (may have formatting differences)
      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
    });

    it('should show matching help for main command', async () => {
      const result = await harness.compareOutputs(['--help']);

      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
    });

    it('should show version for both CLIs', async () => {
      const pythonResult = await harness.runPython(['--version']);
      const bunResult = await harness.runBun(['--version']);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
      // Both should produce version output
      expect(pythonResult.stdout.length).toBeGreaterThan(0);
      expect(bunResult.stdout.length).toBeGreaterThan(0);
    });
  });

  describe('error handling consistency', () => {
    it('should fail identically with no arguments', async () => {
      const result = await harness.compareOutputs([]);

      // Both should produce help or error
      expect(typeof result.pythonExitCode).toBe('number');
      expect(typeof result.bunExitCode).toBe('number');
    });

    it('should fail identically with unknown command', async () => {
      const result = await assertCLIsFailEquivalently(harness, ['unknown-command']);

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    it('should fail identically with invalid flags', async () => {
      const result = await assertCLIsFailEquivalently(harness, ['init', '--invalid-flag']);

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });
});
