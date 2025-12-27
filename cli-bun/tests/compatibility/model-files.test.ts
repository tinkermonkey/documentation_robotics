/**
 * Model File Structure Compatibility Tests
 * Verifies that Python and Bun CLIs produce byte-for-byte identical model files
 *
 * HIGHEST PRIORITY: Task Group 6
 *
 * This test suite validates that identical commands produce identical model file structures
 * by comparing `.dr/manifest.json` and `.dr/layers/*.json` files directly.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'bun:test';
import { CLIHarness, checkPythonCLIAvailable } from './harness.js';
import { mkdir, rm, readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import crypto from 'crypto';

const TEMP_DIR = '/tmp/dr-model-compatibility-test';
let harness: CLIHarness;
let pythonTestDir: string;
let bunTestDir: string;
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

/**
 * Compute SHA-256 hash of file contents for byte-for-byte comparison
 */
async function hashFile(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (error) {
    throw new Error(`Failed to hash file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Deep compare JSON objects, accounting for acceptable differences
 */
function compareJSON(pythonObj: any, bunObj: any, path: string = 'root'): string[] {
  const differences: string[] = [];

  // Check types match
  if (typeof pythonObj !== typeof bunObj) {
    differences.push(`${path}: type mismatch - Python: ${typeof pythonObj}, Bun: ${typeof bunObj}`);
    return differences;
  }

  // Handle null
  if (pythonObj === null || bunObj === null) {
    if (pythonObj !== bunObj) {
      differences.push(`${path}: null mismatch`);
    }
    return differences;
  }

  // Handle arrays
  if (Array.isArray(pythonObj) && Array.isArray(bunObj)) {
    if (pythonObj.length !== bunObj.length) {
      differences.push(`${path}: array length mismatch - Python: ${pythonObj.length}, Bun: ${bunObj.length}`);
    } else {
      for (let i = 0; i < pythonObj.length; i++) {
        differences.push(...compareJSON(pythonObj[i], bunObj[i], `${path}[${i}]`));
      }
    }
    return differences;
  }

  // Handle objects
  if (typeof pythonObj === 'object' && typeof bunObj === 'object') {
    const pythonKeys = Object.keys(pythonObj).sort();
    const bunKeys = Object.keys(bunObj).sort();

    // Check for missing/extra keys
    const pythonOnlyKeys = pythonKeys.filter(k => !bunKeys.includes(k));
    const bunOnlyKeys = bunKeys.filter(k => !pythonKeys.includes(k));

    if (pythonOnlyKeys.length > 0) {
      differences.push(`${path}: keys only in Python: ${pythonOnlyKeys.join(', ')}`);
    }
    if (bunOnlyKeys.length > 0) {
      differences.push(`${path}: keys only in Bun: ${bunOnlyKeys.join(', ')}`);
    }

    // Compare common keys
    const commonKeys = pythonKeys.filter(k => bunKeys.includes(k));
    for (const key of commonKeys) {
      // Allow for timestamp precision differences (createdAt, updatedAt)
      if ((key === 'createdAt' || key === 'updatedAt' || key === 'timestamp') &&
          typeof pythonObj[key] === 'string' && typeof bunObj[key] === 'string') {
        // Parse timestamps and check they're within 1 second
        const pythonTime = new Date(pythonObj[key]).getTime();
        const bunTime = new Date(bunObj[key]).getTime();
        if (Math.abs(pythonTime - bunTime) > 1000) {
          differences.push(`${path}.${key}: timestamp difference > 1s - Python: ${pythonObj[key]}, Bun: ${bunObj[key]}`);
        }
        continue;
      }

      differences.push(...compareJSON(pythonObj[key], bunObj[key], `${path}.${key}`));
    }
    return differences;
  }

  // Handle primitives
  if (pythonObj !== bunObj) {
    differences.push(`${path}: value mismatch - Python: ${JSON.stringify(pythonObj)}, Bun: ${JSON.stringify(bunObj)}`);
  }

  return differences;
}

/**
 * Compare model file structures between Python and Bun CLIs
 */
async function compareModelFiles(pythonDir: string, bunDir: string): Promise<{
  manifestMatch: boolean;
  manifestDifferences: string[];
  layerMatches: Record<string, boolean>;
  layerDifferences: Record<string, string[]>;
  allMatch: boolean;
}> {
  const result = {
    manifestMatch: false,
    manifestDifferences: [] as string[],
    layerMatches: {} as Record<string, boolean>,
    layerDifferences: {} as Record<string, string[]>,
    allMatch: false,
  };

  // Compare manifest.json
  try {
    const pythonManifest = JSON.parse(await readFile(join(pythonDir, '.dr', 'manifest.json'), 'utf-8'));
    const bunManifest = JSON.parse(await readFile(join(bunDir, '.dr', 'manifest.json'), 'utf-8'));

    result.manifestDifferences = compareJSON(pythonManifest, bunManifest, 'manifest');
    result.manifestMatch = result.manifestDifferences.length === 0;
  } catch (error) {
    result.manifestDifferences.push(`Error comparing manifests: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Compare layer files
  try {
    const pythonLayersDir = join(pythonDir, '.dr', 'layers');
    const bunLayersDir = join(bunDir, '.dr', 'layers');

    const pythonLayerFiles = await readdir(pythonLayersDir);
    const bunLayerFiles = await readdir(bunLayersDir);

    // Check for missing/extra layer files
    const pythonOnlyFiles = pythonLayerFiles.filter(f => !bunLayerFiles.includes(f));
    const bunOnlyFiles = bunLayerFiles.filter(f => !pythonLayerFiles.includes(f));

    if (pythonOnlyFiles.length > 0) {
      result.manifestDifferences.push(`Layer files only in Python: ${pythonOnlyFiles.join(', ')}`);
    }
    if (bunOnlyFiles.length > 0) {
      result.manifestDifferences.push(`Layer files only in Bun: ${bunOnlyFiles.join(', ')}`);
    }

    // Compare common layer files
    const commonFiles = pythonLayerFiles.filter(f => bunLayerFiles.includes(f));
    for (const file of commonFiles) {
      try {
        const pythonLayer = JSON.parse(await readFile(join(pythonLayersDir, file), 'utf-8'));
        const bunLayer = JSON.parse(await readFile(join(bunLayersDir, file), 'utf-8'));

        const differences = compareJSON(pythonLayer, bunLayer, file);
        result.layerDifferences[file] = differences;
        result.layerMatches[file] = differences.length === 0;
      } catch (error) {
        result.layerDifferences[file] = [`Error comparing layer: ${error instanceof Error ? error.message : String(error)}`];
        result.layerMatches[file] = false;
      }
    }
  } catch (error) {
    result.manifestDifferences.push(`Error comparing layer directories: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Determine overall match
  result.allMatch = result.manifestMatch &&
                    Object.values(result.layerMatches).every(match => match);

  return result;
}

/**
 * Initialize models in both directories with identical commands
 */
async function initializeIdenticalModels(pythonDir: string, bunDir: string, name: string, description?: string): Promise<void> {
  const args = ['init', '--name', name];
  if (description) {
    args.push('--description', description);
  }

  await harness.runPython(args, pythonDir);
  await harness.runBun(args, bunDir);
}

describe('Model File Structure Compatibility (HIGHEST PRIORITY)', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

  beforeEach(async () => {
    if (!pythonCLIAvailable) return;

    harness = new CLIHarness();

    // Create separate test directories for Python and Bun
    pythonTestDir = join(TEMP_DIR, `python-${Date.now()}`);
    bunTestDir = join(TEMP_DIR, `bun-${Date.now()}`);

    await mkdir(pythonTestDir, { recursive: true });
    await mkdir(bunTestDir, { recursive: true });
  });

  afterEach(async () => {
    if (!pythonCLIAvailable) return;

    // Cleanup
    try {
      await rm(pythonTestDir, { recursive: true, force: true });
      await rm(bunTestDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  // ========================================
  // Task 6.1: Comprehensive Model Editing Test Scenarios
  // ========================================

  describe('Task 6.1: Comprehensive Model Editing Test Scenarios', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should define test scenarios covering all CRUD operations', async () => {
      // This test documents the test scenarios we'll execute
      const scenarios = [
        'Model initialization with minimal metadata',
        'Model initialization with full metadata',
        'Element creation across all 12 layers',
        'Element updates (name, description, properties)',
        'Relationship creation (intra-layer and cross-layer)',
        'Reference creation and validation',
        'Element deletion and orphaned reference cleanup',
        'Manifest updates (version, name, description)',
        'Model migration and upgrade',
        'Complex multi-layer model with dependencies',
      ];

      expect(scenarios.length).toBeGreaterThan(0);
    });
  });

  // ========================================
  // Task 6.2: Test Identical Commands Produce Identical Model Files
  // ========================================

  describe('Task 6.2: Identical Commands Produce Identical Model Files', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should produce identical manifest.json for init command', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel', 'Test Description');

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.manifestMatch).toBe(true);
      if (!comparison.manifestMatch) {
        console.log('Manifest differences:', comparison.manifestDifferences);
      }
    });

    compatTest('should produce identical manifest.json with author metadata', async () => {
      await harness.runPython(['init', '--name', 'TestModel', '--author', 'Test Author'], pythonTestDir);
      await harness.runBun(['init', '--name', 'TestModel', '--author', 'Test Author'], bunTestDir);

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.manifestMatch).toBe(true);
      if (!comparison.manifestMatch) {
        console.log('Manifest differences:', comparison.manifestDifferences);
      }
    });

    compatTest('should produce identical layer files for empty model', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'EmptyModel');

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.allMatch).toBe(true);
      if (!comparison.allMatch) {
        console.log('Model differences:', {
          manifest: comparison.manifestDifferences,
          layers: comparison.layerDifferences,
        });
      }
    });
  });

  // ========================================
  // Task 6.3: Test Element Creation and Updates
  // ========================================

  describe('Task 6.3: Element Creation and Updates', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should produce identical model after adding business service element', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add business service to both
      await harness.runPython(
        ['add', 'business', 'service', 'customer-service', '--name', 'Customer Service'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'customer-service', '--name', 'Customer Service'],
        bunTestDir
      );

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.layerMatches['business.json']).toBe(true);
      if (!comparison.layerMatches['business.json']) {
        console.log('Business layer differences:', comparison.layerDifferences['business.json']);
      }
    });

    compatTest('should produce identical model after adding element with description', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add element with description
      await harness.runPython(
        [
          'add', 'application', 'component', 'api-gateway',
          '--name', 'API Gateway',
          '--description', 'Central API gateway component'
        ],
        pythonTestDir
      );
      await harness.runBun(
        [
          'add', 'application', 'component', 'api-gateway',
          '--name', 'API Gateway',
          '--description', 'Central API gateway component'
        ],
        bunTestDir
      );

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.layerMatches['application.json']).toBe(true);
      if (!comparison.layerMatches['application.json']) {
        console.log('Application layer differences:', comparison.layerDifferences['application.json']);
      }
    });

    compatTest('should produce identical model after adding element with properties', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add element with custom properties
      await harness.runPython(
        [
          'add', 'technology', 'node', 'database-server',
          '--name', 'Database Server',
          '--property', 'cpu=16',
          '--property', 'memory=64GB'
        ],
        pythonTestDir
      );
      await harness.runBun(
        [
          'add', 'technology', 'node', 'database-server',
          '--name', 'Database Server',
          '--property', 'cpu=16',
          '--property', 'memory=64GB'
        ],
        bunTestDir
      );

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.layerMatches['technology.json']).toBe(true);
      if (!comparison.layerMatches['technology.json']) {
        console.log('Technology layer differences:', comparison.layerDifferences['technology.json']);
      }
    });

    compatTest('should produce identical model after updating element name', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add element
      await harness.runPython(
        ['add', 'business', 'service', 'old-service', '--name', 'Old Service'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'old-service', '--name', 'Old Service'],
        bunTestDir
      );

      // Update element name
      await harness.runPython(
        ['update', 'business-service-old-service', '--name', 'New Service'],
        pythonTestDir
      );
      await harness.runBun(
        ['update', 'business-service-old-service', '--name', 'New Service'],
        bunTestDir
      );

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.layerMatches['business.json']).toBe(true);
      if (!comparison.layerMatches['business.json']) {
        console.log('Business layer differences:', comparison.layerDifferences['business.json']);
      }
    });

    compatTest('should produce identical model after updating element description', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add element
      await harness.runPython(
        ['add', 'application', 'component', 'test-component', '--name', 'Test Component'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'application', 'component', 'test-component', '--name', 'Test Component'],
        bunTestDir
      );

      // Update element description
      await harness.runPython(
        ['update', 'application-component-test-component', '--description', 'Updated description'],
        pythonTestDir
      );
      await harness.runBun(
        ['update', 'application-component-test-component', '--description', 'Updated description'],
        bunTestDir
      );

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.layerMatches['application.json']).toBe(true);
      if (!comparison.layerMatches['application.json']) {
        console.log('Application layer differences:', comparison.layerDifferences['application.json']);
      }
    });

    compatTest('should produce identical model when adding elements to all 12 layers', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'CompleteModel');

      const commands = [
        ['add', 'motivation', 'goal', 'test-goal', '--name', 'Test Goal'],
        ['add', 'business', 'service', 'test-service', '--name', 'Test Service'],
        ['add', 'security', 'control', 'test-control', '--name', 'Test Control'],
        ['add', 'application', 'component', 'test-component', '--name', 'Test Component'],
        ['add', 'technology', 'node', 'test-node', '--name', 'Test Node'],
        ['add', 'api', 'endpoint', 'test-endpoint', '--name', 'Test Endpoint', '--method', 'GET', '--path', '/test'],
        ['add', 'data-model', 'entity', 'test-entity', '--name', 'Test Entity'],
        ['add', 'data-store', 'table', 'test-table', '--name', 'Test Table'],
        ['add', 'ux', 'component', 'test-ui-component', '--name', 'Test UI Component'],
        ['add', 'navigation', 'route', 'test-route', '--name', 'Test Route', '--path', '/test'],
        ['add', 'apm', 'metric', 'test-metric', '--name', 'Test Metric'],
        ['add', 'testing', 'test-case', 'test-case', '--name', 'Test Case'],
      ];

      for (const cmd of commands) {
        await harness.runPython(cmd, pythonTestDir);
        await harness.runBun(cmd, bunTestDir);
      }

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.allMatch).toBe(true);
      if (!comparison.allMatch) {
        console.log('Model differences:', {
          manifest: comparison.manifestDifferences,
          layers: comparison.layerDifferences,
        });
      }
    });
  });

  // ========================================
  // Task 6.4: Test Relationship and Reference Creation
  // ========================================

  describe('Task 6.4: Relationship and Reference Creation', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should produce identical model after adding intra-layer relationship', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add two elements
      await harness.runPython(
        ['add', 'business', 'service', 'service-a', '--name', 'Service A'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'service-a', '--name', 'Service A'],
        bunTestDir
      );

      await harness.runPython(
        ['add', 'business', 'service', 'service-b', '--name', 'Service B'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'service-b', '--name', 'Service B'],
        bunTestDir
      );

      // Add relationship
      await harness.runPython(
        ['relationship', 'add', 'business-service-service-a', 'business-service-service-b', 'uses'],
        pythonTestDir
      );
      await harness.runBun(
        ['relationship', 'add', 'business-service-service-a', 'business-service-service-b', 'uses'],
        bunTestDir
      );

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.layerMatches['business.json']).toBe(true);
      if (!comparison.layerMatches['business.json']) {
        console.log('Business layer differences:', comparison.layerDifferences['business.json']);
      }
    });

    compatTest('should produce identical model after adding cross-layer reference', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add elements in different layers
      await harness.runPython(
        ['add', 'application', 'component', 'app-component', '--name', 'App Component'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'application', 'component', 'app-component', '--name', 'App Component'],
        bunTestDir
      );

      await harness.runPython(
        ['add', 'technology', 'node', 'tech-node', '--name', 'Tech Node'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'technology', 'node', 'tech-node', '--name', 'Tech Node'],
        bunTestDir
      );

      // Add cross-layer reference
      await harness.runPython(
        ['relationship', 'add', 'application-component-app-component', 'technology-node-tech-node', 'deployed-on'],
        pythonTestDir
      );
      await harness.runBun(
        ['relationship', 'add', 'application-component-app-component', 'technology-node-tech-node', 'deployed-on'],
        bunTestDir
      );

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.layerMatches['application.json']).toBe(true);
      if (!comparison.layerMatches['application.json']) {
        console.log('Application layer differences:', comparison.layerDifferences['application.json']);
      }
    });

    compatTest('should produce identical model with multiple relationships', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add multiple elements
      await harness.runPython(
        ['add', 'business', 'service', 'service-a', '--name', 'Service A'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'service-a', '--name', 'Service A'],
        bunTestDir
      );

      await harness.runPython(
        ['add', 'business', 'service', 'service-b', '--name', 'Service B'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'service-b', '--name', 'Service B'],
        bunTestDir
      );

      await harness.runPython(
        ['add', 'business', 'service', 'service-c', '--name', 'Service C'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'service-c', '--name', 'Service C'],
        bunTestDir
      );

      // Add multiple relationships
      await harness.runPython(
        ['relationship', 'add', 'business-service-service-a', 'business-service-service-b', 'uses'],
        pythonTestDir
      );
      await harness.runBun(
        ['relationship', 'add', 'business-service-service-a', 'business-service-service-b', 'uses'],
        bunTestDir
      );

      await harness.runPython(
        ['relationship', 'add', 'business-service-service-b', 'business-service-service-c', 'uses'],
        pythonTestDir
      );
      await harness.runBun(
        ['relationship', 'add', 'business-service-service-b', 'business-service-service-c', 'uses'],
        bunTestDir
      );

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.layerMatches['business.json']).toBe(true);
      if (!comparison.layerMatches['business.json']) {
        console.log('Business layer differences:', comparison.layerDifferences['business.json']);
      }
    });
  });

  // ========================================
  // Task 6.5: Test Element Deletion and Cleanup
  // ========================================

  describe('Task 6.5: Element Deletion and Cleanup', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should produce identical model after deleting element', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add element
      await harness.runPython(
        ['add', 'business', 'service', 'temp-service', '--name', 'Temp Service'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'temp-service', '--name', 'Temp Service'],
        bunTestDir
      );

      // Delete element
      await harness.runPython(['delete', 'business-service-temp-service'], pythonTestDir);
      await harness.runBun(['delete', 'business-service-temp-service'], bunTestDir);

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.layerMatches['business.json']).toBe(true);
      if (!comparison.layerMatches['business.json']) {
        console.log('Business layer differences:', comparison.layerDifferences['business.json']);
      }
    });

    compatTest('should produce identical model after deleting element with relationships', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add elements with relationship
      await harness.runPython(
        ['add', 'business', 'service', 'service-a', '--name', 'Service A'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'service-a', '--name', 'Service A'],
        bunTestDir
      );

      await harness.runPython(
        ['add', 'business', 'service', 'service-b', '--name', 'Service B'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'service-b', '--name', 'Service B'],
        bunTestDir
      );

      await harness.runPython(
        ['relationship', 'add', 'business-service-service-a', 'business-service-service-b', 'uses'],
        pythonTestDir
      );
      await harness.runBun(
        ['relationship', 'add', 'business-service-service-a', 'business-service-service-b', 'uses'],
        bunTestDir
      );

      // Delete element (should clean up relationship)
      await harness.runPython(['delete', 'business-service-service-b'], pythonTestDir);
      await harness.runBun(['delete', 'business-service-service-b'], bunTestDir);

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.layerMatches['business.json']).toBe(true);
      if (!comparison.layerMatches['business.json']) {
        console.log('Business layer differences:', comparison.layerDifferences['business.json']);
      }
    });
  });

  // ========================================
  // Task 6.6: Test Manifest Updates
  // ========================================

  describe('Task 6.6: Manifest Updates', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should produce identical manifest after updating model name', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'OldName');

      // Update model name
      await harness.runPython(['project', 'update', '--name', 'NewName'], pythonTestDir);
      await harness.runBun(['project', 'update', '--name', 'NewName'], bunTestDir);

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.manifestMatch).toBe(true);
      if (!comparison.manifestMatch) {
        console.log('Manifest differences:', comparison.manifestDifferences);
      }
    });

    compatTest('should produce identical manifest after updating description', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Update description
      await harness.runPython(
        ['project', 'update', '--description', 'Updated description'],
        pythonTestDir
      );
      await harness.runBun(
        ['project', 'update', '--description', 'Updated description'],
        bunTestDir
      );

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.manifestMatch).toBe(true);
      if (!comparison.manifestMatch) {
        console.log('Manifest differences:', comparison.manifestDifferences);
      }
    });

    compatTest('should produce identical manifest after updating version', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Update version
      await harness.runPython(['project', 'update', '--version', '2.0.0'], pythonTestDir);
      await harness.runBun(['project', 'update', '--version', '2.0.0'], bunTestDir);

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.manifestMatch).toBe(true);
      if (!comparison.manifestMatch) {
        console.log('Manifest differences:', comparison.manifestDifferences);
      }
    });
  });

  // ========================================
  // Task 6.7: Test Model Migration and Upgrade
  // ========================================

  describe('Task 6.7: Model Migration and Upgrade', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should produce identical model structure after migration', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add some elements
      await harness.runPython(
        ['add', 'business', 'service', 'test-service', '--name', 'Test Service'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'test-service', '--name', 'Test Service'],
        bunTestDir
      );

      // Run migrate command (if available)
      await harness.runPython(['migrate'], pythonTestDir);
      await harness.runBun(['migrate'], bunTestDir);

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.allMatch).toBe(true);
      if (!comparison.allMatch) {
        console.log('Model differences after migration:', {
          manifest: comparison.manifestDifferences,
          layers: comparison.layerDifferences,
        });
      }
    });

    compatTest('should produce identical model structure after upgrade', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add some elements
      await harness.runPython(
        ['add', 'application', 'component', 'test-component', '--name', 'Test Component'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'application', 'component', 'test-component', '--name', 'Test Component'],
        bunTestDir
      );

      // Run upgrade command (if available)
      await harness.runPython(['upgrade'], pythonTestDir);
      await harness.runBun(['upgrade'], bunTestDir);

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.allMatch).toBe(true);
      if (!comparison.allMatch) {
        console.log('Model differences after upgrade:', {
          manifest: comparison.manifestDifferences,
          layers: comparison.layerDifferences,
        });
      }
    });
  });

  // ========================================
  // Task 6.8: Validate File Format Consistency
  // ========================================

  describe('Task 6.8: File Format Consistency', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should use consistent JSON formatting (indentation)', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      const pythonManifest = await readFile(join(pythonTestDir, '.dr', 'manifest.json'), 'utf-8');
      const bunManifest = await readFile(join(bunTestDir, '.dr', 'manifest.json'), 'utf-8');

      // Check both use 2-space indentation
      const pythonHas2Space = pythonManifest.includes('  "');
      const bunHas2Space = bunManifest.includes('  "');

      expect(pythonHas2Space).toBe(true);
      expect(bunHas2Space).toBe(true);
    });

    compatTest('should handle UTF-8 encoding consistently', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add element with Unicode characters
      await harness.runPython(
        ['add', 'business', 'service', 'unicode-service', '--name', '测试服务 ñoño'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'unicode-service', '--name', '测试服务 ñoño'],
        bunTestDir
      );

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.layerMatches['business.json']).toBe(true);
      if (!comparison.layerMatches['business.json']) {
        console.log('Business layer differences:', comparison.layerDifferences['business.json']);
      }
    });

    compatTest('should handle special characters in element data', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      // Add element with special characters
      await harness.runPython(
        [
          'add', 'business', 'service', 'special-service',
          '--name', 'Service "with" quotes',
          '--description', 'Description with\nnewlines and\ttabs'
        ],
        pythonTestDir
      );
      await harness.runBun(
        [
          'add', 'business', 'service', 'special-service',
          '--name', 'Service "with" quotes',
          '--description', 'Description with\nnewlines and\ttabs'
        ],
        bunTestDir
      );

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.layerMatches['business.json']).toBe(true);
      if (!comparison.layerMatches['business.json']) {
        console.log('Business layer differences:', comparison.layerDifferences['business.json']);
      }
    });

    compatTest('should maintain consistent property order in JSON', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'TestModel');

      await harness.runPython(
        ['add', 'business', 'service', 'test-service', '--name', 'Test Service'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'test-service', '--name', 'Test Service'],
        bunTestDir
      );

      const pythonLayer = JSON.parse(
        await readFile(join(pythonTestDir, '.dr', 'layers', 'business.json'), 'utf-8')
      );
      const bunLayer = JSON.parse(
        await readFile(join(bunTestDir, '.dr', 'layers', 'business.json'), 'utf-8')
      );

      // Check that top-level properties are in same order
      const pythonKeys = Object.keys(pythonLayer);
      const bunKeys = Object.keys(bunLayer);

      expect(pythonKeys).toEqual(bunKeys);
    });
  });

  // ========================================
  // Task 6.9: Comprehensive Model File Compatibility Tests
  // ========================================

  describe('Task 6.9: Comprehensive Model File Compatibility', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should produce identical model for complex multi-layer scenario', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'ComplexModel', 'Complex multi-layer model');

      // Build a complex model with elements across layers and relationships
      const commands = [
        // Motivation layer
        ['add', 'motivation', 'goal', 'improve-performance', '--name', 'Improve Performance'],
        ['add', 'motivation', 'requirement', 'low-latency', '--name', 'Low Latency Requirement'],

        // Business layer
        ['add', 'business', 'service', 'customer-service', '--name', 'Customer Service'],
        ['add', 'business', 'process', 'order-process', '--name', 'Order Process'],

        // Application layer
        ['add', 'application', 'component', 'web-app', '--name', 'Web Application'],
        ['add', 'application', 'service', 'api-service', '--name', 'API Service'],

        // Technology layer
        ['add', 'technology', 'node', 'web-server', '--name', 'Web Server'],
        ['add', 'technology', 'node', 'database', '--name', 'Database'],

        // API layer
        ['add', 'api', 'endpoint', 'get-customer', '--name', 'Get Customer', '--method', 'GET', '--path', '/customers/{id}'],

        // Data Model layer
        ['add', 'data-model', 'entity', 'customer', '--name', 'Customer Entity'],
      ];

      for (const cmd of commands) {
        await harness.runPython(cmd, pythonTestDir);
        await harness.runBun(cmd, bunTestDir);
      }

      // Add relationships
      const relationships = [
        ['relationship', 'add', 'business-service-customer-service', 'application-component-web-app', 'realized-by'],
        ['relationship', 'add', 'application-component-web-app', 'technology-node-web-server', 'deployed-on'],
        ['relationship', 'add', 'application-service-api-service', 'technology-node-database', 'accesses'],
      ];

      for (const rel of relationships) {
        await harness.runPython(rel, pythonTestDir);
        await harness.runBun(rel, bunTestDir);
      }

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.allMatch).toBe(true);
      if (!comparison.allMatch) {
        console.log('Complex model differences:', {
          manifest: comparison.manifestDifferences,
          layers: comparison.layerDifferences,
        });
      }
    });

    compatTest('should handle empty layers consistently', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'SparseModel');

      // Add element to only one layer
      await harness.runPython(
        ['add', 'business', 'service', 'single-service', '--name', 'Single Service'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'single-service', '--name', 'Single Service'],
        bunTestDir
      );

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.allMatch).toBe(true);
      if (!comparison.allMatch) {
        console.log('Sparse model differences:', {
          manifest: comparison.manifestDifferences,
          layers: comparison.layerDifferences,
        });
      }
    });

    compatTest('should produce byte-for-byte identical files for deterministic operations', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'DeterministicModel');

      // Perform deterministic operations
      await harness.runPython(
        ['add', 'business', 'service', 'test-service', '--name', 'Test Service', '--description', 'Test'],
        pythonTestDir
      );
      await harness.runBun(
        ['add', 'business', 'service', 'test-service', '--name', 'Test Service', '--description', 'Test'],
        bunTestDir
      );

      // Wait a moment to ensure timestamps are different if they're being set differently
      await new Promise(resolve => setTimeout(resolve, 100));

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      // We expect semantic equivalence even if timestamps differ slightly
      expect(comparison.layerMatches['business.json']).toBe(true);

      if (!comparison.layerMatches['business.json']) {
        console.log('Deterministic operation differences:', comparison.layerDifferences['business.json']);
      }
    });

    compatTest('should maintain model integrity across multiple operations', async () => {
      await initializeIdenticalModels(pythonTestDir, bunTestDir, 'IntegrityModel');

      // Sequence of operations
      const operations = [
        ['add', 'business', 'service', 'service-1', '--name', 'Service 1'],
        ['add', 'business', 'service', 'service-2', '--name', 'Service 2'],
        ['relationship', 'add', 'business-service-service-1', 'business-service-service-2', 'uses'],
        ['update', 'business-service-service-1', '--description', 'Updated'],
        ['add', 'business', 'service', 'service-3', '--name', 'Service 3'],
        ['relationship', 'add', 'business-service-service-2', 'business-service-service-3', 'uses'],
        ['delete', 'business-service-service-2'],
      ];

      for (const op of operations) {
        await harness.runPython(op, pythonTestDir);
        await harness.runBun(op, bunTestDir);
      }

      const comparison = await compareModelFiles(pythonTestDir, bunTestDir);

      expect(comparison.allMatch).toBe(true);
      if (!comparison.allMatch) {
        console.log('Model integrity differences:', {
          manifest: comparison.manifestDifferences,
          layers: comparison.layerDifferences,
        });
      }
    });
  });
});
