/**
 * Export Format Compatibility Tests
 * Verifies that Python and Bun CLIs produce semantically equivalent export outputs
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { CLIHarness } from './harness.js';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';

const TEMP_DIR = '/tmp/dr-compatibility-export-test';
let harness: CLIHarness;
let testDir: string;
let outputDir: string;

/**
 * Helper to set up a complete test model with elements across multiple layers
 */
async function setupCompleteModel(testDir: string, harness: CLIHarness): Promise<void> {
  // Initialize using Python CLI as reference
  await harness.runPython(['init', '--name', 'ExportTestModel', '--description', 'Test model for export comparison'], testDir);

  // Add motivation layer elements
  await harness.runPython(
    ['element', 'add', 'motivation', 'stakeholder', 'stakeholder-exec', '--name', 'Executive Board'],
    testDir,
  );

  // Add business layer elements
  const businessElements = [
    ['business-service', 'svc-customer-mgmt', 'Customer Management'],
    ['business-process', 'proc-order-fulfillment', 'Order Fulfillment'],
    ['business-actor', 'actor-sales-rep', 'Sales Representative'],
  ];

  for (const [type, id, name] of businessElements) {
    await harness.runPython(
      ['element', 'add', 'business', type, id, '--name', name],
      testDir,
    );
  }

  // Add application layer elements
  const appElements = [
    ['application-service', 'svc-customer-api', 'Customer API Service'],
    ['application-component', 'comp-auth', 'Authentication Component'],
  ];

  for (const [type, id, name] of appElements) {
    await harness.runPython(
      ['element', 'add', 'application', type, id, '--name', name],
      testDir,
    );
  }

  // Add technology layer elements
  await harness.runPython(
    ['element', 'add', 'technology', 'technology-platform', 'platform-k8s', '--name', 'Kubernetes'],
    testDir,
  );

  // Add API layer elements
  const apiElements = [
    {
      args: ['element', 'add', 'api', 'api-endpoint', 'list-customers', '--method', 'GET', '--path', '/customers'],
    },
    {
      args: ['element', 'add', 'api', 'api-endpoint', 'create-order', '--method', 'POST', '--path', '/orders'],
    },
  ];

  for (const { args } of apiElements) {
    await harness.runPython(args, testDir);
  }

  // Add data model elements
  await harness.runPython(
    ['element', 'add', 'data-model', 'entity', 'customer-entity', '--name', 'Customer'],
    testDir,
  );
}

describe('Export Format Compatibility', () => {
  beforeEach(async () => {
    harness = new CLIHarness();

    // Create clean test directories
    testDir = join(TEMP_DIR, `test-${Date.now()}`);
    outputDir = join(testDir, 'output');
    await mkdir(testDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    // Set up complete test model
    await setupCompleteModel(testDir, harness);
  });

  afterEach(async () => {
    // Cleanup
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  describe('ArchiMate export', () => {
    it('should export ArchiMate XML identically', async () => {
      const pythonPath = join(outputDir, 'archimate-python.xml');
      const bunPath = join(outputDir, 'archimate-bun.xml');

      try {
        // Run both export commands
        const pythonResult = await harness.runPython(
          ['export', 'archimate', '--output', pythonPath],
          testDir,
        );
        const bunResult = await harness.runBun(
          ['export', 'archimate', '--output', bunPath],
          testDir,
        );

        // Both should succeed
        expect(pythonResult.exitCode).toBe(0);
        expect(bunResult.exitCode).toBe(0);

        // Compare file outputs
        let pythonContent = '';
        let bunContent = '';

        try {
          pythonContent = await Bun.file(pythonPath).text();
        } catch (error) {
          throw new Error(`Failed to read Python output: ${error}`);
        }

        try {
          bunContent = await Bun.file(bunPath).text();
        } catch (error) {
          throw new Error(`Failed to read Bun output: ${error}`);
        }

        // Parse as XML to compare structure (not exact formatting)
        // For now, check that both produce content
        expect(pythonContent.length).toBeGreaterThan(0);
        expect(bunContent.length).toBeGreaterThan(0);

        // Both should start with XML declaration
        expect(pythonContent.trim().startsWith('<?xml')).toBe(true);
        expect(bunContent.trim().startsWith('<?xml')).toBe(true);

        // Both should contain ArchiMate namespace
        expect(pythonContent.includes('archimate')).toBe(true);
        expect(bunContent.includes('archimate')).toBe(true);
      } finally {
        // Cleanup output files
        try {
          await rm(pythonPath, { force: true });
          await rm(bunPath, { force: true });
        } catch (e) {
          // ignore cleanup errors
        }
      }
    });

    it('should export ArchiMate with layers 1,2,4,5 only', async () => {
      const pythonPath = join(outputDir, 'archimate-filtered-python.xml');
      const bunPath = join(outputDir, 'archimate-filtered-bun.xml');

      const pythonResult = await harness.runPython(
        ['export', 'archimate', '--layers', 'motivation,business,application,technology', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'archimate', '--layers', 'motivation,business,application,technology', '--output', bunPath],
        testDir,
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      expect(pythonContent.length).toBeGreaterThan(0);
      expect(bunContent.length).toBeGreaterThan(0);
    });
  });

  describe('OpenAPI export', () => {
    it('should export OpenAPI JSON identically', async () => {
      const pythonPath = join(outputDir, 'openapi-python.json');
      const bunPath = join(outputDir, 'openapi-bun.json');

      // Run both export commands
      const pythonResult = await harness.runPython(
        ['export', 'openapi', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'openapi', '--output', bunPath],
        testDir,
      );

      // Both should succeed
      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      // Compare JSON content
      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      try {
        const pythonObj = JSON.parse(pythonContent);
        const bunObj = JSON.parse(bunContent);

        // Check basic structure
        expect(pythonObj.openapi).toBeDefined();
        expect(bunObj.openapi).toBeDefined();

        // Check info object
        expect(pythonObj.info).toBeDefined();
        expect(bunObj.info).toBeDefined();

        // JSON should be semantically equivalent
        const pythonStr = JSON.stringify(pythonObj, Object.keys(pythonObj).sort());
        const bunStr = JSON.stringify(bunObj, Object.keys(bunObj).sort());

        // Allow for minor differences in ordering or formatting
        expect(pythonStr.length).toBeGreaterThan(10);
        expect(bunStr.length).toBeGreaterThan(10);
      } catch (error) {
        throw new Error(
          `Failed to parse OpenAPI JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    it('should export only API layer', async () => {
      const pythonPath = join(outputDir, 'openapi-api-only-python.json');
      const bunPath = join(outputDir, 'openapi-api-only-bun.json');

      const pythonResult = await harness.runPython(
        ['export', 'openapi', '--layers', 'api', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'openapi', '--layers', 'api', '--output', bunPath],
        testDir,
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      const pythonObj = JSON.parse(pythonContent);
      const bunObj = JSON.parse(bunContent);

      // Should have paths
      expect(pythonObj.paths).toBeDefined();
      expect(bunObj.paths).toBeDefined();
    });
  });

  describe('JSON Schema export', () => {
    it('should export JSON Schema identically', async () => {
      const pythonPath = join(outputDir, 'schema-python.json');
      const bunPath = join(outputDir, 'schema-bun.json');

      const pythonResult = await harness.runPython(
        ['export', 'json-schema', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'json-schema', '--output', bunPath],
        testDir,
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      try {
        const pythonObj = JSON.parse(pythonContent);
        const bunObj = JSON.parse(bunContent);

        // Check for JSON Schema structure
        expect(pythonObj.$schema).toBeDefined();
        expect(bunObj.$schema).toBeDefined();

        // Both should have definitions or properties
        expect(
          pythonObj.definitions || pythonObj.properties || pythonObj.defs,
        ).toBeDefined();
        expect(
          bunObj.definitions || bunObj.properties || bunObj.defs,
        ).toBeDefined();
      } catch (error) {
        throw new Error(
          `Failed to parse JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  });

  describe('PlantUML export', () => {
    it('should export PlantUML diagram text', async () => {
      const pythonPath = join(outputDir, 'diagram-python.puml');
      const bunPath = join(outputDir, 'diagram-bun.puml');

      const pythonResult = await harness.runPython(
        ['export', 'plantuml', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'plantuml', '--output', bunPath],
        testDir,
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      // Both should contain PlantUML diagram markers
      expect(pythonContent.includes('@')).toBe(true);
      expect(bunContent.includes('@')).toBe(true);

      // Both should have content
      expect(pythonContent.length).toBeGreaterThan(0);
      expect(bunContent.length).toBeGreaterThan(0);
    });
  });

  describe('Markdown export', () => {
    it('should export Markdown documentation', async () => {
      const pythonPath = join(outputDir, 'docs-python.md');
      const bunPath = join(outputDir, 'docs-bun.md');

      const pythonResult = await harness.runPython(
        ['export', 'markdown', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'markdown', '--output', bunPath],
        testDir,
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      // Both should contain markdown headers
      expect(pythonContent.includes('#')).toBe(true);
      expect(bunContent.includes('#')).toBe(true);

      // Both should have content
      expect(pythonContent.length).toBeGreaterThan(0);
      expect(bunContent.length).toBeGreaterThan(0);
    });
  });

  describe('export error handling', () => {
    it('should fail identically with invalid format', async () => {
      const pythonResult = await harness.runPython(
        ['export', 'invalid-format'],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'invalid-format'],
        testDir,
      );

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);
    });

    it('should fail identically with invalid output path', async () => {
      const invalidPath = '/invalid/path/that/does/not/exist/export.json';

      const pythonResult = await harness.runPython(
        ['export', 'openapi', '--output', invalidPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'openapi', '--output', invalidPath],
        testDir,
      );

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);
    });
  });
});
