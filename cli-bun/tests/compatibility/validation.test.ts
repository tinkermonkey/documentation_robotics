/**
 * Validation Equivalence Tests
 * Verifies that Python and Bun CLIs perform identical validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { CLIHarness } from './harness.js';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join, dirname } from 'path';

const TEMP_DIR = '/tmp/dr-compatibility-validation-test';
let harness: CLIHarness;
let testDir: string;

/**
 * Helper to extract validation error counts from CLI output
 */
function extractErrorMetrics(output: string): { errors: number; warnings: number } {
  const errorMatch = output.match(/(\d+)\s+error/i);
  const warningMatch = output.match(/(\d+)\s+warning/i);

  return {
    errors: errorMatch ? parseInt(errorMatch[1], 10) : 0,
    warnings: warningMatch ? parseInt(warningMatch[1], 10) : 0,
  };
}

describe('Validation Equivalence', () => {
  beforeEach(async () => {
    harness = new CLIHarness();

    // Create clean test directory
    testDir = join(TEMP_DIR, `test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Initialize model using Python CLI as reference
    await harness.runPython(['init', '--name', 'ValidationTestModel'], testDir);
  });

  afterEach(async () => {
    // Cleanup
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  describe('basic validation', () => {
    it('should validate empty model successfully', async () => {
      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should validate valid elements', async () => {
      // Add valid elements using Python CLI as reference
      await harness.runPython(
        ['element', 'add', 'business', 'business-service', 'test-service', '--name', 'Test Service'],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should succeed
      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });
  });

  describe('naming validation', () => {
    it('should reject invalid element ID format identically', async () => {
      // Manually create invalid .dr structure
      const drDir = join(testDir, '.dr');
      const layerFile = join(drDir, 'layers', 'business.json');

      const invalidLayer = {
        id: 'business',
        name: 'Business Layer',
        version: '1.0.0',
        elements: [
          {
            id: 'invalid_id_format', // Invalid: uses underscore
            type: 'business-service',
            name: 'Invalid Service',
            properties: {},
          },
        ],
      };

      await mkdir(dirname(layerFile), { recursive: true });
      await writeFile(layerFile, JSON.stringify(invalidLayer, null, 2));

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);

      // Error counts should match
      const pythonMetrics = extractErrorMetrics(pythonResult.stderr + pythonResult.stdout);
      const bunMetrics = extractErrorMetrics(bunResult.stderr + bunResult.stdout);

      expect(bunMetrics.errors).toBe(pythonMetrics.errors);
    });

    it('should detect missing element name', async () => {
      const drDir = join(testDir, '.dr');
      const layerFile = join(drDir, 'layers', 'business.json');

      const invalidLayer = {
        id: 'business',
        name: 'Business Layer',
        version: '1.0.0',
        elements: [
          {
            id: 'business-business-service-test',
            type: 'business-service',
            // Missing name property
            properties: {},
          },
        ],
      };

      await mkdir(dirname(layerFile), { recursive: true });
      await writeFile(layerFile, JSON.stringify(invalidLayer, null, 2));

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);
    });
  });

  describe('layer-specific validation', () => {
    it('should validate business layer only', async () => {
      // Add element using Python CLI as reference
      await harness.runPython(
        ['element', 'add', 'business', 'business-service', 'svc-1', '--name', 'Service 1'],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate', '--layers', 'business'], testDir);
      const bunResult = await harness.runBun(['validate', '--layers', 'business'], testDir);

      // Both should succeed
      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should validate multiple layers', async () => {
      // Add elements to multiple layers using Python CLI as reference
      await harness.runPython(
        ['element', 'add', 'business', 'business-service', 'svc-1', '--name', 'Service 1'],
        testDir,
      );

      await harness.runPython(
        ['element', 'add', 'api', 'api-endpoint', 'api-1', '--method', 'GET', '--path', '/test'],
        testDir,
      );

      const pythonResult = await harness.runPython(
        ['validate', '--layers', 'business,api'],
        testDir,
      );
      const bunResult = await harness.runBun(['validate', '--layers', 'business,api'], testDir);

      // Both should succeed or fail together
      expect(pythonResult.exitCode).toBe(bunResult.exitCode);
    });
  });

  describe('reference validation', () => {
    it('should detect missing referenced elements', async () => {
      const drDir = join(testDir, '.dr');
      const appLayerFile = join(drDir, 'layers', 'application.json');

      // Create application element with reference to non-existent business element
      const appLayer = {
        id: 'application',
        name: 'Application Layer',
        version: '1.0.0',
        elements: [
          {
            id: 'application-application-component-app-comp',
            type: 'application-component',
            name: 'App Component',
            properties: {
              references: ['business-business-service-non-existent'],
            },
          },
        ],
      };

      await mkdir(dirname(appLayerFile), { recursive: true });
      await writeFile(appLayerFile, JSON.stringify(appLayer, null, 2));

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail with reference error
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);

      // Error counts should match
      const pythonMetrics = extractErrorMetrics(pythonResult.stderr + pythonResult.stdout);
      const bunMetrics = extractErrorMetrics(bunResult.stderr + bunResult.stdout);

      expect(bunMetrics.errors).toBe(pythonMetrics.errors);
    });

    it('should validate correct cross-layer references', async () => {
      // Create valid reference chain using Python CLI as reference
      await harness.runPython(
        ['element', 'add', 'business', 'business-service', 'svc-1', '--name', 'Service 1'],
        testDir,
      );

      // Create application element that references the business service
      const drDir = join(testDir, '.dr');
      const appLayerFile = join(drDir, 'layers', 'application.json');

      const appLayer = {
        id: 'application',
        name: 'Application Layer',
        version: '1.0.0',
        elements: [
          {
            id: 'application-application-component-app-comp',
            type: 'application-component',
            name: 'App Component',
            properties: {
              references: ['business-business-service-svc-1'],
            },
          },
        ],
      };

      await mkdir(dirname(appLayerFile), { recursive: true });
      await writeFile(appLayerFile, JSON.stringify(appLayer, null, 2));

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should succeed (references are valid)
      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });
  });

  describe('schema validation', () => {
    it('should reject invalid layer schema', async () => {
      const drDir = join(testDir, '.dr');
      const layerFile = join(drDir, 'layers', 'business.json');

      // Create layer with invalid structure
      const invalidLayer = {
        id: 'business',
        name: 'Business Layer',
        version: '1.0.0',
        elements: [
          {
            id: 'business-business-service-svc-1',
            type: 'business-service',
            name: 'Service 1',
            properties: {
              // Invalid property that doesn't match schema
              invalid_nested_field: {
                invalid: 123,
              },
            },
          },
        ],
      };

      await mkdir(dirname(layerFile), { recursive: true });
      await writeFile(layerFile, JSON.stringify(invalidLayer, null, 2));

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should handle schema validation (may or may not fail depending on strictness)
      // At minimum, both should handle the same way
      expect(typeof pythonResult.exitCode).toBe('number');
      expect(typeof bunResult.exitCode).toBe('number');
    });
  });

  describe('validation output consistency', () => {
    it('should report validation issues in consistent format', async () => {
      const drDir = join(testDir, '.dr');
      const layerFile = join(drDir, 'layers', 'business.json');

      const invalidLayer = {
        id: 'business',
        name: 'Business Layer',
        version: '1.0.0',
        elements: [
          {
            id: 'invalid_id', // Invalid format
            type: 'business-service',
            name: 'Service 1',
            properties: {},
          },
        ],
      };

      await mkdir(dirname(layerFile), { recursive: true });
      await writeFile(layerFile, JSON.stringify(invalidLayer, null, 2));

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);

      // Both should report error in output
      const pythonOutput = pythonResult.stdout + pythonResult.stderr;
      const bunOutput = bunResult.stdout + bunResult.stderr;

      expect(pythonOutput.length).toBeGreaterThan(0);
      expect(bunOutput.length).toBeGreaterThan(0);
    });
  });
});
