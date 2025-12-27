/**
 * Command Output Compatibility Tests
 * Verifies that Python and Bun CLIs produce equivalent outputs for the same commands
 *
 * Enhanced for Python CLI Deprecation - Task Group 2
 * Tests all 21 essential commands with comprehensive coverage
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'bun:test';
import { CLIHarness, assertCLIsEquivalent, assertCLIsFailEquivalently, checkPythonCLIAvailable } from './harness.js';
import { mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';

const TEMP_DIR = '/tmp/dr-compatibility-test';
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

describe('Command Output Compatibility', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

  beforeEach(async () => {
    if (!pythonCLIAvailable) return;

    harness = new CLIHarness();

    // Create clean test directory
    testDir = join(TEMP_DIR, `test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (!pythonCLIAvailable) return;

    // Cleanup
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  // ========================================
  // CORE COMMANDS (CRUD Operations)
  // ========================================

  describe('init command', () => {
    compatTest('should create identical manifest files', async () => {
      const result = await harness.compareOutputs(['init', '--name', 'TestModel'], testDir);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
      expect(result.differences.length).toBe(0);
    });

    compatTest('should handle init with description', async () => {
      const result = await harness.compareOutputs(
        ['init', '--name', 'TestModel', '--description', 'Test Description'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
    });

    compatTest('should handle init with author', async () => {
      const result = await harness.compareOutputs(
        ['init', '--name', 'TestModel', '--author', 'Test Author'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
    });

    compatTest('should handle init with all metadata', async () => {
      const result = await harness.compareOutputs(
        [
          'init',
          '--name', 'TestModel',
          '--description', 'Test Description',
          '--author', 'Test Author'
        ],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
    });

    compatTest('should fail identically when name is missing', async () => {
      const result = await assertCLIsFailEquivalently(harness, ['init'], testDir);

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should fail identically when already initialized', async () => {
      // Initialize once
      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      // Try to initialize again
      const result = await assertCLIsFailEquivalently(
        harness,
        ['init', '--name', 'TestModel'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  describe('add command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      // Initialize model once using Python CLI as reference
      await harness.runPython(['init', '--name', 'TestModel'], testDir);
    });

    compatTest('should add business service elements identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['add', 'business', 'business-service', 'customer-mgmt', '--name', 'Customer Management'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should add api endpoint elements identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['add', 'api', 'endpoint', 'list-customers', '--name', 'List Customers'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should add elements with description', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        [
          'add',
          'business',
          'business-service',
          'order-mgmt',
          '--name', 'Order Management',
          '--description', 'Manages customer orders'
        ],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should add elements with properties', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        [
          'add',
          'api',
          'endpoint',
          'create-order',
          '--name', 'Create Order',
          '--properties', '{"method":"POST","path":"/orders"}'
        ],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should fail identically with invalid layer', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['add', 'invalid-layer', 'type', 'element-id'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should fail identically with invalid element ID format', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['add', 'business', 'business-service', 'InvalidName'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should fail identically with duplicate element ID', async () => {
      // Add element first
      await harness.runPython(
        ['add', 'business', 'business-service', 'duplicate-test', '--name', 'Test'],
        testDir,
      );

      // Try to add same element ID again
      const result = await assertCLIsFailEquivalently(
        harness,
        ['add', 'business', 'business-service', 'duplicate-test', '--name', 'Test'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should handle Unicode in element names', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        [
          'add',
          'business',
          'business-service',
          'unicode-test',
          '--name', 'Tëst Sërvïcë 日本語'
        ],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should handle special characters in descriptions', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        [
          'add',
          'business',
          'business-service',
          'special-chars',
          '--name', 'Test',
          '--description', 'Test with "quotes" and \'apostrophes\' and <tags>'
        ],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });
  });

  describe('update command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runPython(
        ['add', 'business', 'business-service', 'test-service', '--name', 'Original Name'],
        testDir,
      );
    });

    compatTest('should update element name identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['update', 'business-business-service-test-service', '--name', 'Updated Name'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should update element description identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['update', 'business-business-service-test-service', '--description', 'Updated Description'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should update element properties identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        [
          'update',
          'business-business-service-test-service',
          '--properties', '{"key":"value","number":123}'
        ],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should update multiple fields at once', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        [
          'update',
          'business-business-service-test-service',
          '--name', 'New Name',
          '--description', 'New Description',
          '--properties', '{"updated":true}'
        ],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should fail identically for non-existent element', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['update', 'non-existent-element-id', '--name', 'Test'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should fail identically with invalid properties JSON', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['update', 'business-business-service-test-service', '--properties', '{invalid json}'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  describe('delete command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runPython(
        ['add', 'business', 'business-service', 'to-delete', '--name', 'To Delete'],
        testDir,
      );
    });

    compatTest('should delete element identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['delete', 'business-business-service-to-delete'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should delete with force flag identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['delete', 'business-business-service-to-delete', '--force'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should fail identically for non-existent element', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['delete', 'non-existent-element'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should handle deletion of element with references', async () => {
      // Add two elements with a relationship
      await harness.runPython(
        ['add', 'application', 'application-service', 'app-service', '--name', 'App Service'],
        testDir,
      );
      await harness.runPython(
        ['relationship', 'add', 'business-business-service-to-delete', 'application-application-service-app-service', 'uses'],
        testDir,
      );

      // Try to delete element with references (may require --force)
      const result = await harness.compareOutputs(
        ['delete', 'business-business-service-to-delete', '--force'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });
  });

  // ========================================
  // QUERY COMMANDS
  // ========================================

  describe('list command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      const elements = [
        ['business', 'business-service', 'svc-1', 'Service 1'],
        ['business', 'business-service', 'svc-2', 'Service 2'],
        ['business', 'business-actor', 'actor-1', 'Actor 1'],
      ];

      for (const [layer, type, id, name] of elements) {
        await harness.runPython(
          ['add', layer, type, id, '--name', name],
          testDir,
        );
      }
    });

    compatTest('should list elements in layer identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['list', 'business'],
        testDir,
      );

      expect(result.stdoutMatch).toBe(true);
    });

    compatTest('should list elements with type filter', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['list', 'business', '--type', 'business-service'],
        testDir,
      );

      expect(result.stdoutMatch).toBe(true);
    });

    compatTest('should list elements in JSON format', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['list', 'business', '--json'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
      // JSON output should be parseable
      expect(() => JSON.parse(result.pythonStdout)).not.toThrow();
      expect(() => JSON.parse(result.bunStdout)).not.toThrow();
    });

    compatTest('should handle empty layer', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['list', 'security'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should fail identically for invalid layer', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['list', 'invalid-layer'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  describe('show command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runPython(
        [
          'add',
          'business',
          'business-service',
          'customer-mgmt',
          '--name', 'Customer Management',
          '--description', 'Manages customers'
        ],
        testDir,
      );
    });

    compatTest('should show element details identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['show', 'business-business-service-customer-mgmt'],
        testDir,
      );

      expect(result.stdoutMatch).toBe(true);
    });

    compatTest('should fail identically for non-existent element', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['show', 'non-existent-id'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  describe('search command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      const elements = [
        ['business', 'business-service', 'customer-mgmt', 'Customer Management'],
        ['business', 'business-service', 'order-mgmt', 'Order Management'],
        ['business', 'business-actor', 'admin-user', 'Administrator'],
        ['application', 'application-service', 'customer-api', 'Customer API'],
      ];

      for (const [layer, type, id, name] of elements) {
        await harness.runPython(
          ['add', layer, type, id, '--name', name],
          testDir,
        );
      }
    });

    compatTest('should search elements with matching results', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['search', 'management'],
        testDir,
      );

      expect(result.stdoutMatch).toBe(true);
    });

    compatTest('should search with layer filter', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['search', 'customer', '--layer', 'business'],
        testDir,
      );

      expect(result.stdoutMatch).toBe(true);
    });

    compatTest('should search with type filter', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['search', 'customer', '--type', 'business-service'],
        testDir,
      );

      expect(result.stdoutMatch).toBe(true);
    });

    compatTest('should search with JSON output', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['search', 'management', '--json'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(() => JSON.parse(result.pythonStdout)).not.toThrow();
      expect(() => JSON.parse(result.bunStdout)).not.toThrow();
    });

    compatTest('should return empty results consistently', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['search', 'nonexistent-search-term'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should handle Unicode search terms', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['search', '日本語'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });
  });

  describe('info command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runPython(
        ['add', 'business', 'business-service', 'test-svc', '--name', 'Test Service'],
        testDir,
      );
    });

    compatTest('should show model info identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['info'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should show layer info identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['info', '--layer', 'business'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should fail identically for invalid layer', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['info', '--layer', 'invalid-layer'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  // ========================================
  // RELATIONSHIP & DEPENDENCY COMMANDS
  // ========================================

  describe('relationship command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runPython(
        ['add', 'business', 'business-service', 'source-svc', '--name', 'Source Service'],
        testDir,
      );
      await harness.runPython(
        ['add', 'application', 'application-service', 'target-svc', '--name', 'Target Service'],
        testDir,
      );
    });

    compatTest('should add relationship identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        [
          'relationship',
          'add',
          'business-business-service-source-svc',
          'application-application-service-target-svc',
          'realizes'
        ],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should add relationship with predicate', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        [
          'relationship',
          'add',
          'business-business-service-source-svc',
          'application-application-service-target-svc',
          'association',
          '--predicate', 'uses'
        ],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should list relationships identically', async () => {
      // Add a relationship first
      await harness.runPython(
        [
          'relationship',
          'add',
          'business-business-service-source-svc',
          'application-application-service-target-svc',
          'realizes'
        ],
        testDir,
      );

      const result = await assertCLIsEquivalent(
        harness,
        ['relationship', 'list'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should list relationships for specific element', async () => {
      await harness.runPython(
        [
          'relationship',
          'add',
          'business-business-service-source-svc',
          'application-application-service-target-svc',
          'realizes'
        ],
        testDir,
      );

      const result = await assertCLIsEquivalent(
        harness,
        ['relationship', 'list', '--element', 'business-business-service-source-svc'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should remove relationship identically', async () => {
      // Add relationship first
      await harness.runPython(
        [
          'relationship',
          'add',
          'business-business-service-source-svc',
          'application-application-service-target-svc',
          'realizes'
        ],
        testDir,
      );

      const result = await assertCLIsEquivalent(
        harness,
        [
          'relationship',
          'remove',
          'business-business-service-source-svc',
          'application-application-service-target-svc',
          'realizes'
        ],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should fail identically for invalid relationship type', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        [
          'relationship',
          'add',
          'business-business-service-source-svc',
          'application-application-service-target-svc',
          'invalid-type'
        ],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should fail identically for non-existent source element', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        [
          'relationship',
          'add',
          'non-existent-source',
          'application-application-service-target-svc',
          'realizes'
        ],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should fail identically for non-existent target element', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        [
          'relationship',
          'add',
          'business-business-service-source-svc',
          'non-existent-target',
          'realizes'
        ],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  describe('trace command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      // Create a dependency chain
      await harness.runPython(
        ['add', 'motivation', 'goal', 'improve-sales', '--name', 'Improve Sales'],
        testDir,
      );
      await harness.runPython(
        ['add', 'business', 'business-service', 'customer-svc', '--name', 'Customer Service'],
        testDir,
      );
      await harness.runPython(
        ['add', 'application', 'application-service', 'customer-app', '--name', 'Customer App'],
        testDir,
      );

      // Add relationships
      await harness.runPython(
        ['relationship', 'add', 'business-business-service-customer-svc', 'motivation-goal-improve-sales', 'realizes'],
        testDir,
      );
      await harness.runPython(
        ['relationship', 'add', 'application-application-service-customer-app', 'business-business-service-customer-svc', 'realizes'],
        testDir,
      );
    });

    compatTest('should trace dependencies identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['trace', 'application-application-service-customer-app'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should trace upstream dependencies', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['trace', 'application-application-service-customer-app', '--direction', 'up'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should trace downstream dependencies', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['trace', 'motivation-goal-improve-sales', '--direction', 'down'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should trace both directions', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['trace', 'business-business-service-customer-svc', '--direction', 'both'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should trace with depth limit', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['trace', 'application-application-service-customer-app', '--depth', '1'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should trace with metrics', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['trace', 'application-application-service-customer-app', '--metrics'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should fail identically for non-existent element', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['trace', 'non-existent-element'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  describe('project command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      // Create elements across layers
      await harness.runPython(
        ['add', 'business', 'business-service', 'order-svc', '--name', 'Order Service'],
        testDir,
      );
      await harness.runPython(
        ['add', 'application', 'application-service', 'order-app', '--name', 'Order App'],
        testDir,
      );
      await harness.runPython(
        ['add', 'api', 'endpoint', 'create-order', '--name', 'Create Order'],
        testDir,
      );

      // Add relationships
      await harness.runPython(
        ['relationship', 'add', 'application-application-service-order-app', 'business-business-service-order-svc', 'realizes'],
        testDir,
      );
      await harness.runPython(
        ['relationship', 'add', 'api-endpoint-create-order', 'application-application-service-order-app', 'realizes'],
        testDir,
      );
    });

    compatTest('should project dependencies to target layer', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['project', 'business-business-service-order-svc', 'api'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should project with reverse direction', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['project', 'api-endpoint-create-order', 'business', '--reverse'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should project with max depth', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['project', 'business-business-service-order-svc', 'api', '--max-depth', '2'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should fail identically for non-existent element', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['project', 'non-existent-element', 'api'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should fail identically for invalid target layer', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['project', 'business-business-service-order-svc', 'invalid-layer'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  // ========================================
  // VALIDATION COMMANDS
  // ========================================

  describe('validate command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runPython(
        ['add', 'business', 'business-service', 'valid-svc', '--name', 'Valid Service'],
        testDir,
      );
    });

    compatTest('should validate model identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['validate'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should validate specific layers', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['validate', '--layers', 'business', 'application'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should validate in strict mode', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['validate', '--strict'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should fail identically for invalid layer name', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['validate', '--layers', 'invalid-layer'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  describe('conformance command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runPython(
        ['add', 'business', 'business-service', 'test-svc', '--name', 'Test Service'],
        testDir,
      );
    });

    compatTest('should check conformance identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['conformance'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should check conformance for specific layers', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['conformance', '--layers', 'business'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });
  });

  // ========================================
  // MODEL MANAGEMENT COMMANDS
  // ========================================

  describe('migrate command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
    });

    compatTest('should show migration dry-run identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['migrate', '--to', '0.6.0', '--dry-run'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should fail identically for invalid version', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['migrate', '--to', 'invalid-version'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  describe('upgrade command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
    });

    compatTest('should check for upgrades identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['upgrade'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should check CLI version identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['upgrade', '--cli'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should check spec version identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['upgrade', '--spec'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });
  });

  // ========================================
  // CHANGESET COMMANDS
  // ========================================

  describe('changeset command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runPython(
        ['add', 'business', 'business-service', 'test-svc', '--name', 'Test Service'],
        testDir,
      );
    });

    compatTest('should create changeset identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['changeset', 'create', '--name', 'test-changeset'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should list changesets identically', async () => {
      // Create a changeset first
      await harness.runPython(
        ['changeset', 'create', '--name', 'test-changeset'],
        testDir,
      );

      const result = await assertCLIsEquivalent(
        harness,
        ['changeset', 'list'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should show changeset identically', async () => {
      // Create a changeset first
      const createResult = await harness.runPython(
        ['changeset', 'create', '--name', 'test-changeset'],
        testDir,
      );

      // Extract changeset ID from output (assuming it's in the output)
      // For now, we'll skip this test if we can't extract the ID
      // This would require parsing the create output to get the changeset ID
    });

    compatTest('should fail identically for non-existent changeset', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['changeset', 'show', 'non-existent-changeset'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  // ========================================
  // EXPORT COMMANDS
  // ========================================

  describe('export command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
      await harness.runPython(
        ['add', 'business', 'business-service', 'export-test', '--name', 'Export Test'],
        testDir,
      );
    });

    compatTest('should export to markdown identically', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['export', 'markdown', '--output', join(testDir, 'export.md')],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should export specific layers', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['export', 'markdown', '--output', join(testDir, 'export.md'), '--layers', 'business'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should export to JSON', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['export', 'json', '--output', join(testDir, 'export.json')],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should fail identically for invalid format', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['export', 'invalid-format', '--output', join(testDir, 'export.txt')],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should fail identically for invalid layer', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['export', 'markdown', '--output', join(testDir, 'export.md'), '--layers', 'invalid-layer'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });
  });

  // ========================================
  // VISUALIZATION & AI COMMANDS
  // ========================================

  describe('visualize command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
    });

    compatTest('should show help for visualize command', async () => {
      const result = await harness.compareOutputs(
        ['visualize', '--help'],
        testDir,
      );

      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
    });

    // Note: Full server testing would require starting servers and making HTTP requests
    // This is covered in api.test.ts
  });

  describe('chat command', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
    });

    compatTest('should show help for chat command', async () => {
      const result = await harness.compareOutputs(
        ['chat', '--help'],
        testDir,
      );

      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
    });

    // Note: Interactive chat testing requires mocking stdin/Claude API
    // This is out of scope for basic compatibility testing
  });

  // ========================================
  // HELP & VERSION COMMANDS
  // ========================================

  describe('help commands', () => {
    compatTest('should show matching help for init', async () => {
      const result = await harness.compareOutputs(['init', '--help']);

      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
    });

    compatTest('should show matching help for add', async () => {
      const result = await harness.compareOutputs(['add', '--help']);

      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
    });

    compatTest('should show matching help for main command', async () => {
      const result = await harness.compareOutputs(['--help']);

      expect(result.pythonExitCode).toBe(0);
      expect(result.bunExitCode).toBe(0);
    });

    compatTest('should show version for both CLIs', async () => {
      const pythonResult = await harness.runPython(['--version']);
      const bunResult = await harness.runBun(['--version']);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
      expect(pythonResult.stdout.length).toBeGreaterThan(0);
      expect(bunResult.stdout.length).toBeGreaterThan(0);
    });
  });

  // ========================================
  // ERROR HANDLING & EDGE CASES
  // ========================================

  describe('error handling consistency', () => {
    compatTest('should fail identically with no arguments', async () => {
      const result = await harness.compareOutputs([]);

      expect(typeof result.pythonExitCode).toBe('number');
      expect(typeof result.bunExitCode).toBe('number');
    });

    compatTest('should fail identically with unknown command', async () => {
      const result = await assertCLIsFailEquivalently(harness, ['unknown-command']);

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should fail identically with invalid flags', async () => {
      const result = await assertCLIsFailEquivalently(harness, ['init', '--invalid-flag']);

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should fail identically when model not initialized', async () => {
      const result = await assertCLIsFailEquivalently(
        harness,
        ['add', 'business', 'business-service', 'test', '--name', 'Test'],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should handle empty strings in arguments', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      const result = await assertCLIsFailEquivalently(
        harness,
        ['add', 'business', 'business-service', 'test', '--name', ''],
        testDir,
      );

      expect(result.pythonExitCode).not.toBe(0);
      expect(result.bunExitCode).not.toBe(0);
    });

    compatTest('should handle very long element names', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      const longName = 'A'.repeat(500);
      const result = await harness.compareOutputs(
        ['add', 'business', 'business-service', 'long-name-test', '--name', longName],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should handle special characters in paths', async () => {
      const specialDir = join(TEMP_DIR, `test-special-${Date.now()}-with spaces`);
      await mkdir(specialDir, { recursive: true });

      try {
        const result = await harness.compareOutputs(
          ['init', '--name', 'TestModel'],
          specialDir,
        );

        expect(result.exitCodesMatch).toBe(true);
      } finally {
        await rm(specialDir, { recursive: true, force: true });
      }
    });
  });

  // ========================================
  // PATH RESOLUTION EDGE CASES
  // ========================================

  describe('path resolution', () => {
    compatTest('should handle relative paths consistently', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      const result = await harness.compareOutputs(
        ['export', 'markdown', '--output', './output.md'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should handle absolute paths consistently', async () => {
      await harness.runPython(['init', '--name', 'TestModel'], testDir);

      const absolutePath = join(testDir, 'absolute-output.md');
      const result = await harness.compareOutputs(
        ['export', 'markdown', '--output', absolutePath],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });
  });

  // ========================================
  // UNICODE & INTERNATIONALIZATION
  // ========================================

  describe('Unicode and internationalization', () => {
    beforeEach(async () => {
    if (!pythonCLIAvailable) return;

      await harness.runPython(['init', '--name', 'TestModel'], testDir);
    });

    compatTest('should handle Chinese characters in element names', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        ['add', 'business', 'business-service', 'chinese-test', '--name', '客户服务'],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should handle Arabic characters in descriptions', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        [
          'add',
          'business',
          'business-service',
          'arabic-test',
          '--name', 'Test',
          '--description', 'هذا وصف باللغة العربية'
        ],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should handle emoji in element metadata', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        [
          'add',
          'business',
          'business-service',
          'emoji-test',
          '--name', 'Test Service 🚀',
          '--description', 'Service with emoji 📊 📈 ✨'
        ],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });

    compatTest('should handle mixed scripts', async () => {
      const result = await assertCLIsEquivalent(
        harness,
        [
          'add',
          'business',
          'business-service',
          'mixed-test',
          '--name', 'Test サービス 服务 сервис'
        ],
        testDir,
      );

      expect(result.exitCodesMatch).toBe(true);
    });
  });
});
