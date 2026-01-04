/**
 * Test instrumentation helpers for setting up telemetry in test files.
 *
 * Provides convenient setup/teardown patterns for test file instrumentation.
 *
 * Usage:
 * ```typescript
 * import { setupTestTelemetry } from './helpers/test-instrumentation-helpers.js';
 * import { describe, test, beforeAll, afterAll } from 'bun:test';
 *
 * const { beforeAll: setupTelemetry, afterAll: teardownTelemetry } =
 *   setupTestTelemetry('tests/unit/my.test.ts');
 *
 * beforeAll(setupTelemetry);
 * afterAll(teardownTelemetry);
 * ```
 */

import {
  startTestFileSpan,
  endTestFileSpan,
  createTestCaseSpan,
  recordTestResult,
} from '../../src/telemetry/test-instrumentation.js';

/**
 * Setup hooks for test file telemetry.
 *
 * Returns beforeAll and afterAll hook functions that manage the file-level
 * span lifecycle. Use with Bun's describe/test hooks:
 *
 * ```typescript
 * const { beforeAll: setupTelemetry, afterAll: teardownTelemetry } =
 *   setupTestTelemetry(__filename);
 *
 * beforeAll(setupTelemetry);
 * afterAll(teardownTelemetry);
 * ```
 *
 * @param filePath - The path to the test file
 * @returns Object with beforeAll and afterAll hook functions
 */
export function setupTestTelemetry(filePath: string) {
  return {
    beforeAll: () => startTestFileSpan(filePath),
    afterAll: () => endTestFileSpan(),
  };
}

/**
 * Manual span management helpers for advanced use cases.
 *
 * Use this when you need fine-grained control over span lifecycle
 * (e.g., custom error handling, conditional recording).
 *
 * ```typescript
 * test('complex test', async () => {
 *   const span = createTestCaseSpan('complex test', 'MySuite');
 *   try {
 *     // test code
 *     recordTestResult(span, 'pass');
 *   } catch (error) {
 *     recordTestResult(span, 'fail', error as Error);
 *     // Custom handling...
 *     throw error;
 *   }
 * });
 * ```
 */
export const manualSpanManagement = {
  createTestCaseSpan,
  recordTestResult,
};
