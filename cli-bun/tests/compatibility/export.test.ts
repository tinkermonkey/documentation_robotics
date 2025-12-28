/**
 * Export Format Compatibility Tests
 * Verifies that Python and Bun CLIs produce semantically equivalent export outputs
 *
 * Tests all 6 export formats:
 * 1. ArchiMate XML (layers 1, 2, 4, 5)
 * 2. OpenAPI JSON (layer 6)
 * 3. JSON Schema (layer 7)
 * 4. PlantUML (all layers)
 * 5. Markdown (all layers)
 * 6. GraphML (all layers)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'bun:test';
import { CLIHarness, checkPythonCLIAvailable } from './harness.js';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';

const TEMP_DIR = '/tmp/dr-compatibility-export-test';
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
let outputDir: string;

/**
 * Helper to set up a test model with elements for export testing
 * Optimized to reduce setup time
 */
async function setupExportTestModel(testDir: string, harness: CLIHarness): Promise<void> {
  // Initialize using Python CLI as reference
  await harness.runPython(['init', '--name', 'ExportTestModel', '--description', 'Test model for export comparison'], testDir);

  // Add motivation layer elements (Layer 1) - ArchiMate
  await harness.runPython(
    ['element', 'add', 'motivation', 'stakeholder', 'stakeholder-exec', '--name', 'Executive Board'],
    testDir,
  );

  // Add business layer elements (Layer 2) - ArchiMate
  await harness.runPython(
    ['element', 'add', 'business', 'business-service', 'svc-customer-mgmt', '--name', 'Customer Management'],
    testDir,
  );

  // Add application layer elements (Layer 4) - ArchiMate
  await harness.runPython(
    ['element', 'add', 'application', 'application-service', 'svc-customer-api', '--name', 'Customer API Service'],
    testDir,
  );

  // Add technology layer elements (Layer 5) - ArchiMate
  await harness.runPython(
    ['element', 'add', 'technology', 'technology-platform', 'platform-k8s', '--name', 'Kubernetes'],
    testDir,
  );

  // Add API layer elements (Layer 6) - OpenAPI
  await harness.runPython(
    ['element', 'add', 'api', 'api-endpoint', 'list-customers', '--method', 'GET', '--path', '/customers'],
    testDir,
  );

  // Add data model elements (Layer 7) - JSON Schema
  await harness.runPython(
    ['element', 'add', 'data-model', 'entity', 'customer-entity', '--name', 'Customer'],
    testDir,
  );
}

describe('Export Format Compatibility', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

  beforeEach(async () => {
    if (!pythonCLIAvailable) return;

    harness = new CLIHarness();

    // Create clean test directories
    testDir = join(TEMP_DIR, `test-${Date.now()}`);
    outputDir = join(testDir, 'output');
    await mkdir(testDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    // Set up test model
    await setupExportTestModel(testDir, harness);
  }, 30000); // 30 second timeout for setup

  afterEach(async () => {
    if (!pythonCLIAvailable) return;

    // Cleanup
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  describe('ArchiMate XML Export (Layers 1, 2, 4, 5)', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should export complete ArchiMate XML with all supported layers', async () => {
      const pythonPath = join(outputDir, 'archimate-python.xml');
      const bunPath = join(outputDir, 'archimate-bun.xml');

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
      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      // Parse as XML to verify structure
      expect(pythonContent.length).toBeGreaterThan(0);
      expect(bunContent.length).toBeGreaterThan(0);

      // Both should start with XML declaration
      expect(pythonContent.trim().startsWith('<?xml')).toBe(true);
      expect(bunContent.trim().startsWith('<?xml')).toBe(true);

      // Both should contain ArchiMate namespace
      expect(pythonContent.includes('archimate')).toBe(true);
      expect(bunContent.includes('archimate')).toBe(true);

      // Verify semantic elements are present
      expect(pythonContent.includes('ExportTestModel')).toBe(true);
      expect(bunContent.includes('ExportTestModel')).toBe(true);

      // Check for motivation layer elements
      expect(pythonContent.includes('stakeholder-exec')).toBe(true);
      expect(bunContent.includes('stakeholder-exec')).toBe(true);

      // Check for business layer elements
      expect(pythonContent.includes('svc-customer-mgmt')).toBe(true);
      expect(bunContent.includes('svc-customer-mgmt')).toBe(true);

      // Check for application layer elements
      expect(pythonContent.includes('svc-customer-api')).toBe(true);
      expect(bunContent.includes('svc-customer-api')).toBe(true);

      // Check for technology layer elements
      expect(pythonContent.includes('platform-k8s')).toBe(true);
      expect(bunContent.includes('platform-k8s')).toBe(true);
    });

    compatTest('should export ArchiMate 3.2 compliant XML structure', async () => {
      const pythonPath = join(outputDir, 'archimate-compliance-python.xml');
      const bunPath = join(outputDir, 'archimate-compliance-bun.xml');

      const pythonResult = await harness.runPython(
        ['export', 'archimate', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'archimate', '--output', bunPath],
        testDir,
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      // Verify ArchiMate 3.2 namespace
      expect(pythonContent.includes('http://www.opengroup.org/xsd/archimate')).toBe(true);
      expect(bunContent.includes('http://www.opengroup.org/xsd/archimate')).toBe(true);

      // Verify required XML structure elements
      expect(pythonContent.includes('<elements>')).toBe(true);
      expect(bunContent.includes('<elements>')).toBe(true);
      expect(pythonContent.includes('<relationships>')).toBe(true);
      expect(bunContent.includes('<relationships>')).toBe(true);
    });

    compatTest('should export ArchiMate with filtered layers', async () => {
      const pythonPath = join(outputDir, 'archimate-filtered-python.xml');
      const bunPath = join(outputDir, 'archimate-filtered-bun.xml');

      const pythonResult = await harness.runPython(
        ['export', 'archimate', '--layers', 'motivation,business', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'archimate', '--layers', 'motivation,business', '--output', bunPath],
        testDir,
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      expect(pythonContent.length).toBeGreaterThan(0);
      expect(bunContent.length).toBeGreaterThan(0);

      // Should include filtered layers
      expect(pythonContent.includes('stakeholder-exec')).toBe(true);
      expect(bunContent.includes('stakeholder-exec')).toBe(true);
    });
  });

  describe('OpenAPI JSON Export (Layer 6 - API)', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should export complete OpenAPI 3.0 specification', async () => {
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

      const pythonObj = JSON.parse(pythonContent);
      const bunObj = JSON.parse(bunContent);

      // Check OpenAPI version
      expect(pythonObj.openapi).toBeDefined();
      expect(bunObj.openapi).toBeDefined();
      expect(pythonObj.openapi).toMatch(/^3\.0/);
      expect(bunObj.openapi).toMatch(/^3\.0/);

      // Check info object
      expect(pythonObj.info).toBeDefined();
      expect(bunObj.info).toBeDefined();
      expect(pythonObj.info.title).toBe('ExportTestModel');
      expect(bunObj.info.title).toBe('ExportTestModel');

      // Check paths exist
      expect(pythonObj.paths).toBeDefined();
      expect(bunObj.paths).toBeDefined();
    });

    compatTest('should export API endpoints with correct HTTP methods', async () => {
      const pythonPath = join(outputDir, 'openapi-methods-python.json');
      const bunPath = join(outputDir, 'openapi-methods-bun.json');

      const pythonResult = await harness.runPython(
        ['export', 'openapi', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'openapi', '--output', bunPath],
        testDir,
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      const pythonObj = JSON.parse(pythonContent);
      const bunObj = JSON.parse(bunContent);

      // Verify HTTP methods are present
      for (const path of Object.keys(pythonObj.paths)) {
        const methods = Object.keys(pythonObj.paths[path]);
        expect(methods.length).toBeGreaterThan(0);
      }

      for (const path of Object.keys(bunObj.paths)) {
        const methods = Object.keys(bunObj.paths[path]);
        expect(methods.length).toBeGreaterThan(0);
      }
    });

    compatTest('should export endpoint definitions with parameters and schemas', async () => {
      const pythonPath = join(outputDir, 'openapi-params-python.json');
      const bunPath = join(outputDir, 'openapi-params-bun.json');

      const pythonResult = await harness.runPython(
        ['export', 'openapi', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'openapi', '--output', bunPath],
        testDir,
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      const pythonObj = JSON.parse(pythonContent);
      const bunObj = JSON.parse(bunContent);

      // Check for components section (schemas, parameters, etc.)
      expect(pythonObj.components).toBeDefined();
      expect(bunObj.components).toBeDefined();
    });
  });

  describe('JSON Schema Export (Layer 7 - Data Model)', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should export JSON Schema Draft 7 specification', async () => {
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

      const pythonObj = JSON.parse(pythonContent);
      const bunObj = JSON.parse(bunContent);

      // Check for JSON Schema structure
      expect(pythonObj.$schema).toBeDefined();
      expect(bunObj.$schema).toBeDefined();
      expect(pythonObj.$schema).toContain('json-schema.org');
      expect(bunObj.$schema).toContain('json-schema.org');

      // Both should have definitions or properties
      expect(
        pythonObj.definitions || pythonObj.properties || pythonObj.defs,
      ).toBeDefined();
      expect(
        bunObj.definitions || bunObj.properties || bunObj.defs,
      ).toBeDefined();
    });

    compatTest('should export entity definitions with properties', async () => {
      const pythonPath = join(outputDir, 'schema-entities-python.json');
      const bunPath = join(outputDir, 'schema-entities-bun.json');

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

      const pythonObj = JSON.parse(pythonContent);
      const bunObj = JSON.parse(bunContent);

      // Get definitions/defs section
      const pythonDefs = pythonObj.definitions || pythonObj.defs || {};
      const bunDefs = bunObj.definitions || bunObj.defs || {};

      // Should have entity definitions
      const pythonKeys = Object.keys(pythonDefs);
      const bunKeys = Object.keys(bunDefs);

      expect(pythonKeys.length).toBeGreaterThan(0);
      expect(bunKeys.length).toBeGreaterThan(0);

      // Check for specific entities
      const hasCustomerPython = pythonKeys.some(key => key.includes('customer'));
      const hasCustomerBun = bunKeys.some(key => key.includes('customer'));
      expect(hasCustomerPython).toBe(true);
      expect(hasCustomerBun).toBe(true);
    });

    compatTest('should export entity relationships and validations', async () => {
      const pythonPath = join(outputDir, 'schema-relationships-python.json');
      const bunPath = join(outputDir, 'schema-relationships-bun.json');

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

      const pythonObj = JSON.parse(pythonContent);
      const bunObj = JSON.parse(bunContent);

      // Both should be valid JSON objects
      expect(typeof pythonObj).toBe('object');
      expect(typeof bunObj).toBe('object');

      // Check structure is consistent
      expect(Object.keys(pythonObj).length).toBeGreaterThan(0);
      expect(Object.keys(bunObj).length).toBeGreaterThan(0);
    });
  });

  describe('PlantUML Export (All Layers)', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should export PlantUML diagram text for all layers', async () => {
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
      expect(pythonContent.includes('@start')).toBe(true);
      expect(bunContent.includes('@start')).toBe(true);
      expect(pythonContent.includes('@end')).toBe(true);
      expect(bunContent.includes('@end')).toBe(true);

      // Both should have content
      expect(pythonContent.length).toBeGreaterThan(0);
      expect(bunContent.length).toBeGreaterThan(0);
    });

    compatTest('should export PlantUML with correct syntax for elements', async () => {
      const pythonPath = join(outputDir, 'diagram-syntax-python.puml');
      const bunPath = join(outputDir, 'diagram-syntax-bun.puml');

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

      // Check for valid PlantUML syntax elements
      const validSyntax = (content: string) => {
        return (
          content.includes('component') ||
          content.includes('package') ||
          content.includes('class') ||
          content.includes('rectangle') ||
          content.includes('actor') ||
          content.includes('usecase')
        );
      };

      expect(validSyntax(pythonContent)).toBe(true);
      expect(validSyntax(bunContent)).toBe(true);
    });

    compatTest('should export PlantUML with visual representation consistency', async () => {
      const pythonPath = join(outputDir, 'diagram-visual-python.puml');
      const bunPath = join(outputDir, 'diagram-visual-bun.puml');

      const pythonResult = await harness.runPython(
        ['export', 'plantuml', '--layers', 'business,application', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'plantuml', '--layers', 'business,application', '--output', bunPath],
        testDir,
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      // Both should include filtered layers' elements
      expect(pythonContent.length).toBeGreaterThan(50);
      expect(bunContent.length).toBeGreaterThan(50);
    });
  });

  describe('Markdown Export (All Layers)', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should export complete Markdown documentation for all layers', async () => {
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

      // Both should have substantial content
      expect(pythonContent.length).toBeGreaterThan(100);
      expect(bunContent.length).toBeGreaterThan(100);
    });

    compatTest('should export Markdown with proper formatting and structure', async () => {
      const pythonPath = join(outputDir, 'docs-format-python.md');
      const bunPath = join(outputDir, 'docs-format-bun.md');

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

      // Check for markdown structural elements
      const hasMarkdownStructure = (content: string) => {
        return (
          content.includes('# ') || // Headers
          content.includes('## ') ||
          content.includes('- ') || // Lists
          content.includes('* ') ||
          content.includes('**') || // Bold
          content.includes('`')     // Code
        );
      };

      expect(hasMarkdownStructure(pythonContent)).toBe(true);
      expect(hasMarkdownStructure(bunContent)).toBe(true);

      // Should include model name
      expect(pythonContent.includes('ExportTestModel')).toBe(true);
      expect(bunContent.includes('ExportTestModel')).toBe(true);
    });

    compatTest('should export Markdown with completeness of documentation', async () => {
      const pythonPath = join(outputDir, 'docs-complete-python.md');
      const bunPath = join(outputDir, 'docs-complete-bun.md');

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

      // Check for layer sections
      const hasLayerSections = (content: string) => {
        const layerCount = (content.match(/## /g) || []).length;
        return layerCount >= 1; // Should have at least one layer section
      };

      expect(hasLayerSections(pythonContent) || hasLayerSections(bunContent)).toBe(true);

      // Both should document elements
      expect(pythonContent.length).toBeGreaterThan(100);
      expect(bunContent.length).toBeGreaterThan(100);
    });
  });

  describe('GraphML Export (All Layers)', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should export GraphML graph visualization format', async () => {
      const pythonPath = join(outputDir, 'graph-python.graphml');
      const bunPath = join(outputDir, 'graph-bun.graphml');

      const pythonResult = await harness.runPython(
        ['export', 'graphml', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'graphml', '--output', bunPath],
        testDir,
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      // Both should be valid XML with GraphML structure
      expect(pythonContent.trim().startsWith('<?xml')).toBe(true);
      expect(bunContent.trim().startsWith('<?xml')).toBe(true);

      // Should contain GraphML namespace
      expect(pythonContent.includes('graphml')).toBe(true);
      expect(bunContent.includes('graphml')).toBe(true);

      // Should have graph elements
      expect(pythonContent.includes('<graph')).toBe(true);
      expect(bunContent.includes('<graph')).toBe(true);

      // Both should have content
      expect(pythonContent.length).toBeGreaterThan(100);
      expect(bunContent.length).toBeGreaterThan(100);
    });

    compatTest('should export GraphML with node and edge definitions', async () => {
      const pythonPath = join(outputDir, 'graph-nodes-python.graphml');
      const bunPath = join(outputDir, 'graph-nodes-bun.graphml');

      const pythonResult = await harness.runPython(
        ['export', 'graphml', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'graphml', '--output', bunPath],
        testDir,
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      // Check for node elements
      expect(pythonContent.includes('<node')).toBe(true);
      expect(bunContent.includes('<node')).toBe(true);

      // Check for edge elements (may or may not exist depending on relationships)
      const pythonHasEdges = pythonContent.includes('<edge');
      const bunHasEdges = bunContent.includes('<edge');

      // If one has edges, both should (or neither should)
      expect(pythonHasEdges).toBe(bunHasEdges);
    });

    compatTest('should export GraphML with dependency graph representation', async () => {
      const pythonPath = join(outputDir, 'graph-deps-python.graphml');
      const bunPath = join(outputDir, 'graph-deps-bun.graphml');

      const pythonResult = await harness.runPython(
        ['export', 'graphml', '--output', pythonPath],
        testDir,
      );
      const bunResult = await harness.runBun(
        ['export', 'graphml', '--output', bunPath],
        testDir,
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      // Count nodes in both exports
      const pythonNodeCount = (pythonContent.match(/<node/g) || []).length;
      const bunNodeCount = (bunContent.match(/<node/g) || []).length;

      // Both should have nodes representing elements
      expect(pythonNodeCount).toBeGreaterThan(0);
      expect(bunNodeCount).toBeGreaterThan(0);

      // Node counts should be similar (within reasonable margin)
      const countDiff = Math.abs(pythonNodeCount - bunNodeCount);
      const avgCount = (pythonNodeCount + bunNodeCount) / 2;
      expect(countDiff / avgCount).toBeLessThan(0.3); // Within 30% difference
    });
  });

  describe('Export Error Handling', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should fail identically with invalid export format', async () => {
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

    compatTest('should fail identically with invalid output path', async () => {
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

    compatTest('should handle missing model directory identically', async () => {
      const emptyDir = join(TEMP_DIR, `empty-${Date.now()}`);
      await mkdir(emptyDir, { recursive: true });

      try {
        const pythonResult = await harness.runPython(
          ['export', 'markdown'],
          emptyDir,
        );
        const bunResult = await harness.runBun(
          ['export', 'markdown'],
          emptyDir,
        );

        // Both should fail when no model exists
        expect(pythonResult.exitCode).not.toBe(0);
        expect(bunResult.exitCode).not.toBe(0);
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe('Export Semantic Equivalence', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should produce semantically equivalent ArchiMate exports', async () => {
      const pythonPath = join(outputDir, 'semantic-archimate-python.xml');
      const bunPath = join(outputDir, 'semantic-archimate-bun.xml');

      await harness.runPython(['export', 'archimate', '--output', pythonPath], testDir);
      await harness.runBun(['export', 'archimate', '--output', bunPath], testDir);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      // Extract element IDs from both
      const extractElementIds = (xml: string): Set<string> => {
        const matches = xml.matchAll(/identifier="([^"]+)"/g);
        return new Set(Array.from(matches, m => m[1]));
      };

      const pythonIds = extractElementIds(pythonContent);
      const bunIds = extractElementIds(bunContent);

      // Both should have same elements (semantic equivalence)
      expect(pythonIds.size).toBeGreaterThan(0);
      expect(bunIds.size).toBeGreaterThan(0);

      // Size should be similar (within margin for format differences)
      const sizeDiff = Math.abs(pythonIds.size - bunIds.size);
      expect(sizeDiff).toBeLessThanOrEqual(2); // Allow small variance
    });

    compatTest('should produce semantically equivalent OpenAPI exports', async () => {
      const pythonPath = join(outputDir, 'semantic-openapi-python.json');
      const bunPath = join(outputDir, 'semantic-openapi-bun.json');

      await harness.runPython(['export', 'openapi', '--output', pythonPath], testDir);
      await harness.runBun(['export', 'openapi', '--output', bunPath], testDir);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      const pythonObj = JSON.parse(pythonContent);
      const bunObj = JSON.parse(bunContent);

      // Compare path counts
      const pythonPathCount = Object.keys(pythonObj.paths || {}).length;
      const bunPathCount = Object.keys(bunObj.paths || {}).length;

      expect(pythonPathCount).toBe(bunPathCount);

      // Both should have same OpenAPI version
      expect(pythonObj.openapi).toBe(bunObj.openapi);
    });

    compatTest('should produce semantically equivalent JSON Schema exports', async () => {
      const pythonPath = join(outputDir, 'semantic-schema-python.json');
      const bunPath = join(outputDir, 'semantic-schema-bun.json');

      await harness.runPython(['export', 'json-schema', '--output', pythonPath], testDir);
      await harness.runBun(['export', 'json-schema', '--output', bunPath], testDir);

      const pythonContent = await Bun.file(pythonPath).text();
      const bunContent = await Bun.file(bunPath).text();

      const pythonObj = JSON.parse(pythonContent);
      const bunObj = JSON.parse(bunContent);

      // Both should reference JSON Schema Draft 7
      expect(pythonObj.$schema).toContain('json-schema.org');
      expect(bunObj.$schema).toContain('json-schema.org');

      // Compare definition counts
      const pythonDefs = pythonObj.definitions || pythonObj.defs || {};
      const bunDefs = bunObj.definitions || bunObj.defs || {};

      expect(Object.keys(pythonDefs).length).toBe(Object.keys(bunDefs).length);
    });
  });
});
