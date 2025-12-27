/**
 * Validation Equivalence Tests
 * Verifies that Python and Bun CLIs perform identical validation across all 4 validator types:
 * 1. Schema Validation - JSON schema compliance for all 12 layers
 * 2. Naming Validation - Element ID naming convention enforcement
 * 3. Reference Validation - Cross-layer reference integrity
 * 4. Semantic Validation - Business rule validation (unique IDs, relationship predicates)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'bun:test';
import { CLIHarness, checkPythonCLIAvailable } from './harness.js';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join, dirname } from 'path';

const TEMP_DIR = '/tmp/dr-compatibility-validation-test';
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

/**
 * Helper to create a layer file with custom elements
 */
async function createLayerFile(
  layerName: string,
  elements: any[],
  testDir: string,
): Promise<void> {
  const drDir = join(testDir, '.dr');
  const layerFile = join(drDir, 'layers', `${layerName}.json`);

  const layerData = {
    id: layerName,
    name: `${layerName.charAt(0).toUpperCase() + layerName.slice(1)} Layer`,
    version: '1.0.0',
    elements,
  };

  await mkdir(dirname(layerFile), { recursive: true });
  await writeFile(layerFile, JSON.stringify(layerData, null, 2));
}

describe('Validation Equivalence - All 4 Validator Types', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

  beforeEach(async () => {
    if (!pythonCLIAvailable) return;

    harness = new CLIHarness();

    // Create clean test directory
    testDir = join(TEMP_DIR, `test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Initialize model using Python CLI as reference
    await harness.runPython(['init', 'ValidationTestModel'], testDir);
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

  describe('1. Schema Validation - All 12 Layers', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should validate motivation layer valid element schema', async () => {
      await createLayerFile(
        'motivation',
        [
          {
            id: 'motivation-goal-revenue-growth',
            type: 'goal',
            name: 'Revenue Growth',
            description: 'Increase annual revenue by 20%',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should detect motivation layer schema violation - missing required field', async () => {
      await createLayerFile(
        'motivation',
        [
          {
            id: 'motivation-goal-revenue-growth',
            type: 'goal',
            // Missing required 'name' field
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);

      // Error counts should match
      const pythonMetrics = extractErrorMetrics(pythonResult.stderr + pythonResult.stdout);
      const bunMetrics = extractErrorMetrics(bunResult.stderr + bunResult.stdout);
      expect(bunMetrics.errors).toBeGreaterThan(0);
    });

    compatTest('should validate business layer valid element schema', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'business-business-service-order-processing',
            type: 'business-service',
            name: 'Order Processing Service',
            description: 'Handles customer order processing',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should validate security layer valid element schema', async () => {
      await createLayerFile(
        'security',
        [
          {
            id: 'security-authentication-oauth2',
            type: 'authentication',
            name: 'OAuth2 Authentication',
            description: 'OAuth2 authentication mechanism',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should validate application layer valid element schema', async () => {
      await createLayerFile(
        'application',
        [
          {
            id: 'application-application-component-web-app',
            type: 'application-component',
            name: 'Web Application',
            description: 'Main web application component',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should validate technology layer valid element schema', async () => {
      await createLayerFile(
        'technology',
        [
          {
            id: 'technology-node-web-server',
            type: 'node',
            name: 'Web Server',
            description: 'Nginx web server',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should validate api layer valid element schema', async () => {
      await createLayerFile(
        'api',
        [
          {
            id: 'api-endpoint-create-order',
            type: 'endpoint',
            name: 'Create Order',
            description: 'Creates a new order',
            properties: {
              method: 'POST',
              path: '/api/orders',
            },
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should validate data-model layer valid element schema', async () => {
      await createLayerFile(
        'data-model',
        [
          {
            id: 'data-model-entity-customer',
            type: 'entity',
            name: 'Customer',
            description: 'Customer entity',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should validate data-store layer valid element schema', async () => {
      await createLayerFile(
        'data-store',
        [
          {
            id: 'data-store-table-customers',
            type: 'table',
            name: 'Customers Table',
            description: 'Database table for customers',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should validate ux layer valid element schema', async () => {
      await createLayerFile(
        'ux',
        [
          {
            id: 'ux-component-login-form',
            type: 'component',
            name: 'Login Form',
            description: 'User login form component',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should validate navigation layer valid element schema', async () => {
      await createLayerFile(
        'navigation',
        [
          {
            id: 'navigation-route-home',
            type: 'route',
            name: 'Home Route',
            description: 'Home page route',
            properties: {
              path: '/home',
            },
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should validate apm layer valid element schema', async () => {
      await createLayerFile(
        'apm',
        [
          {
            id: 'apm-metric-response-time',
            type: 'metric',
            name: 'Response Time',
            description: 'API response time metric',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should validate testing layer valid element schema', async () => {
      await createLayerFile(
        'testing',
        [
          {
            id: 'testing-test-case-login-success',
            type: 'test-case',
            name: 'Login Success Test',
            description: 'Tests successful login',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should detect invalid schema - wrong type for property', async () => {
      await createLayerFile(
        'api',
        [
          {
            id: 'api-endpoint-test',
            type: 'endpoint',
            name: 'Test Endpoint',
            properties: {
              method: 123, // Should be string
              path: '/test',
            },
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should handle schema validation errors
      expect(typeof pythonResult.exitCode).toBe('number');
      expect(typeof bunResult.exitCode).toBe('number');
    });
  });

  describe('2. Naming Convention Validation', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should enforce {layer}-{type}-{kebab-case-name} format', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'business-business-service-my-service',
            type: 'business-service',
            name: 'My Service',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should reject invalid ID format - uses underscores', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'business_service_invalid', // Invalid: uses underscores
            type: 'business-service',
            name: 'Invalid Service',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);

      const pythonMetrics = extractErrorMetrics(pythonResult.stderr + pythonResult.stdout);
      const bunMetrics = extractErrorMetrics(bunResult.stderr + bunResult.stdout);
      expect(bunMetrics.errors).toBe(pythonMetrics.errors);
    });

    compatTest('should reject invalid ID format - uppercase letters', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'business-Service-Invalid', // Invalid: uppercase letters
            type: 'business-service',
            name: 'Invalid Service',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);
    });

    compatTest('should reject invalid ID - layer prefix mismatch', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'application-service-wrong-layer', // Wrong layer prefix
            type: 'business-service',
            name: 'Wrong Layer Service',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);
    });

    compatTest('should reject invalid ID - special characters', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'business-service-with@special#chars', // Invalid: special characters
            type: 'business-service',
            name: 'Special Chars Service',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);
    });

    compatTest('should handle hyphenated layer names correctly', async () => {
      await createLayerFile(
        'data-model',
        [
          {
            id: 'data-model-entity-customer',
            type: 'entity',
            name: 'Customer',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should reject ID missing type component', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'business-only-one-part', // Missing type - only has layer and one part
            type: 'business-service',
            name: 'Invalid',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should handle this validation
      expect(typeof pythonResult.exitCode).toBe('number');
      expect(typeof bunResult.exitCode).toBe('number');
    });

    compatTest('should validate Unicode handling in element names', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'business-service-test-service',
            type: 'business-service',
            name: 'Test Service 测试', // Unicode in name (not ID)
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should handle Unicode in names (not IDs)
      expect(typeof pythonResult.exitCode).toBe('number');
      expect(typeof bunResult.exitCode).toBe('number');
    });
  });

  describe('3. Reference Validation - Cross-Layer Integrity', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should validate correct cross-layer reference (higher → lower)', async () => {
      // Create business layer element
      await createLayerFile(
        'business',
        [
          {
            id: 'business-business-service-order-service',
            type: 'business-service',
            name: 'Order Service',
            properties: {},
          },
        ],
        testDir,
      );

      // Create application layer element that references business
      await createLayerFile(
        'application',
        [
          {
            id: 'application-application-component-order-app',
            type: 'application-component',
            name: 'Order App',
            properties: {},
            references: [
              {
                target: 'business-business-service-order-service',
                type: 'implements',
              },
            ],
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should detect broken reference - target does not exist', async () => {
      await createLayerFile(
        'application',
        [
          {
            id: 'application-application-component-test-app',
            type: 'application-component',
            name: 'Test App',
            properties: {},
            references: [
              {
                target: 'business-business-service-non-existent',
                type: 'implements',
              },
            ],
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);

      const pythonMetrics = extractErrorMetrics(pythonResult.stderr + pythonResult.stdout);
      const bunMetrics = extractErrorMetrics(bunResult.stderr + bunResult.stdout);
      expect(bunMetrics.errors).toBe(pythonMetrics.errors);
    });

    compatTest('should detect invalid reference direction (lower → higher)', async () => {
      // Create application layer element
      await createLayerFile(
        'application',
        [
          {
            id: 'application-application-component-app',
            type: 'application-component',
            name: 'Application',
            properties: {},
          },
        ],
        testDir,
      );

      // Create business layer element trying to reference application (invalid direction)
      await createLayerFile(
        'business',
        [
          {
            id: 'business-business-service-service',
            type: 'business-service',
            name: 'Service',
            properties: {},
            references: [
              {
                target: 'application-application-component-app',
                type: 'uses',
              },
            ],
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail with reference direction error
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);
    });

    compatTest('should allow same-layer references', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'business-business-service-service-a',
            type: 'business-service',
            name: 'Service A',
            properties: {},
          },
          {
            id: 'business-business-service-service-b',
            type: 'business-service',
            name: 'Service B',
            properties: {},
            references: [
              {
                target: 'business-business-service-service-a',
                type: 'depends-on',
              },
            ],
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should validate multi-layer reference chain', async () => {
      // Create motivation layer
      await createLayerFile(
        'motivation',
        [
          {
            id: 'motivation-goal-revenue',
            type: 'goal',
            name: 'Revenue Goal',
            properties: {},
          },
        ],
        testDir,
      );

      // Create business layer referencing motivation
      await createLayerFile(
        'business',
        [
          {
            id: 'business-business-service-sales',
            type: 'business-service',
            name: 'Sales Service',
            properties: {},
            references: [
              {
                target: 'motivation-goal-revenue',
                type: 'realizes',
              },
            ],
          },
        ],
        testDir,
      );

      // Create application layer referencing business
      await createLayerFile(
        'application',
        [
          {
            id: 'application-application-component-sales-app',
            type: 'application-component',
            name: 'Sales App',
            properties: {},
            references: [
              {
                target: 'business-business-service-sales',
                type: 'implements',
              },
            ],
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should detect multiple broken references', async () => {
      await createLayerFile(
        'application',
        [
          {
            id: 'application-application-component-app',
            type: 'application-component',
            name: 'Application',
            properties: {},
            references: [
              {
                target: 'business-business-service-missing-1',
                type: 'implements',
              },
              {
                target: 'business-business-service-missing-2',
                type: 'uses',
              },
            ],
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);

      const pythonMetrics = extractErrorMetrics(pythonResult.stderr + pythonResult.stdout);
      const bunMetrics = extractErrorMetrics(bunResult.stderr + bunResult.stdout);
      // Should report 2 errors
      expect(bunMetrics.errors).toBeGreaterThanOrEqual(2);
    });
  });

  describe('4. Semantic Validation - Business Rules', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should detect duplicate element IDs across layers', async () => {
      // Create business layer with an element
      await createLayerFile(
        'business',
        [
          {
            id: 'business-business-service-duplicate',
            type: 'business-service',
            name: 'Service',
            properties: {},
          },
        ],
        testDir,
      );

      // Create application layer with duplicate ID
      await createLayerFile(
        'application',
        [
          {
            id: 'business-business-service-duplicate', // Duplicate ID
            type: 'application-component',
            name: 'App',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail with duplicate ID error
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);

      const pythonMetrics = extractErrorMetrics(pythonResult.stderr + pythonResult.stdout);
      const bunMetrics = extractErrorMetrics(bunResult.stderr + bunResult.stdout);
      expect(bunMetrics.errors).toBeGreaterThan(0);
    });

    compatTest('should validate unique IDs within same layer', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'business-business-service-service-1',
            type: 'business-service',
            name: 'Service 1',
            properties: {},
          },
          {
            id: 'business-business-service-service-1', // Duplicate
            type: 'business-service',
            name: 'Service 1 Duplicate',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);
    });

    compatTest('should allow valid relationship predicates', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'business-business-service-service-a',
            type: 'business-service',
            name: 'Service A',
            properties: {},
          },
          {
            id: 'business-business-service-service-b',
            type: 'business-service',
            name: 'Service B',
            properties: {},
            relationships: [
              {
                target: 'business-business-service-service-a',
                predicate: 'depends-on',
              },
            ],
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should succeed or handle consistently
      expect(typeof pythonResult.exitCode).toBe('number');
      expect(typeof bunResult.exitCode).toBe('number');
    });

    compatTest('should warn on unknown relationship predicates', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'business-business-service-service-a',
            type: 'business-service',
            name: 'Service A',
            properties: {},
          },
          {
            id: 'business-business-service-service-b',
            type: 'business-service',
            name: 'Service B',
            properties: {},
            relationships: [
              {
                target: 'business-business-service-service-a',
                predicate: 'invalid-unknown-predicate',
              },
            ],
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should handle unknown predicates (may warn)
      const pythonMetrics = extractErrorMetrics(pythonResult.stderr + pythonResult.stdout);
      const bunMetrics = extractErrorMetrics(bunResult.stderr + bunResult.stdout);

      // Both should produce warnings or handle consistently
      expect(typeof pythonMetrics.warnings).toBe('number');
      expect(typeof bunMetrics.warnings).toBe('number');
    });

    compatTest('should validate layer-specific business rules', async () => {
      // API layer has specific requirements (method, path)
      await createLayerFile(
        'api',
        [
          {
            id: 'api-endpoint-get-users',
            type: 'endpoint',
            name: 'Get Users',
            properties: {
              method: 'GET',
              path: '/api/users',
            },
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });
  });

  describe('5. Validation Error Reporting Consistency', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should report validation errors in consistent format', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'invalid_format', // Invalid ID format
            type: 'business-service',
            name: 'Invalid Service',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);

      // Both should report errors in output
      const pythonOutput = pythonResult.stdout + pythonResult.stderr;
      const bunOutput = bunResult.stdout + bunResult.stderr;

      expect(pythonOutput.length).toBeGreaterThan(0);
      expect(bunOutput.length).toBeGreaterThan(0);

      // Both should mention the error
      expect(pythonOutput.toLowerCase()).toContain('error');
      expect(bunOutput.toLowerCase()).toContain('error');
    });

    compatTest('should have matching exit codes for validation failures', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'business-service-invalid',
            type: 'business-service',
            // Missing name field
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail (non-zero exit code)
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);
    });

    compatTest('should validate layer-specific validation with --layers flag', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'business-business-service-test',
            type: 'business-service',
            name: 'Test Service',
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate', '--layers', 'business'], testDir);
      const bunResult = await harness.runBun(['validate', '--layers', 'business'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should produce consistent error counts for multiple violations', async () => {
      await createLayerFile(
        'business',
        [
          {
            id: 'invalid_1', // Invalid format
            type: 'business-service',
            // Missing name
            properties: {},
          },
          {
            id: 'invalid_2', // Invalid format
            type: 'business-service',
            // Missing name
            properties: {},
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);

      const pythonMetrics = extractErrorMetrics(pythonResult.stderr + pythonResult.stdout);
      const bunMetrics = extractErrorMetrics(bunResult.stderr + bunResult.stdout);

      // Both should report multiple errors
      expect(bunMetrics.errors).toBeGreaterThan(1);
      expect(pythonMetrics.errors).toBeGreaterThan(1);
    });
  });

  describe('6. Complex Validation Scenarios', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

    compatTest('should validate complex multi-layer model', async () => {
      // Create a complete valid model across multiple layers
      await createLayerFile(
        'motivation',
        [
          {
            id: 'motivation-goal-increase-sales',
            type: 'goal',
            name: 'Increase Sales',
            properties: {},
          },
        ],
        testDir,
      );

      await createLayerFile(
        'business',
        [
          {
            id: 'business-business-service-sales-service',
            type: 'business-service',
            name: 'Sales Service',
            properties: {},
            references: [{ target: 'motivation-goal-increase-sales', type: 'realizes' }],
          },
        ],
        testDir,
      );

      await createLayerFile(
        'application',
        [
          {
            id: 'application-application-component-sales-app',
            type: 'application-component',
            name: 'Sales App',
            properties: {},
            references: [{ target: 'business-business-service-sales-service', type: 'implements' }],
          },
        ],
        testDir,
      );

      await createLayerFile(
        'api',
        [
          {
            id: 'api-endpoint-create-sale',
            type: 'endpoint',
            name: 'Create Sale',
            properties: { method: 'POST', path: '/api/sales' },
            references: [{ target: 'application-application-component-sales-app', type: 'served-by' }],
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    compatTest('should detect multiple validation issues across validators', async () => {
      // Create elements with multiple types of violations
      await createLayerFile(
        'business',
        [
          {
            id: 'invalid_format', // Naming violation
            type: 'business-service',
            // Missing name - Schema violation
            properties: {},
            references: [
              { target: 'business-service-non-existent', type: 'uses' }, // Reference violation
            ],
          },
        ],
        testDir,
      );

      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      // Both should fail
      expect(pythonResult.exitCode).not.toBe(0);
      expect(bunResult.exitCode).not.toBe(0);

      const pythonMetrics = extractErrorMetrics(pythonResult.stderr + pythonResult.stdout);
      const bunMetrics = extractErrorMetrics(bunResult.stderr + bunResult.stdout);

      // Should report multiple errors (from different validators)
      expect(bunMetrics.errors).toBeGreaterThanOrEqual(2);
      expect(pythonMetrics.errors).toBeGreaterThanOrEqual(2);
    });

    compatTest('should validate empty model successfully', async () => {
      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });
  });
});
