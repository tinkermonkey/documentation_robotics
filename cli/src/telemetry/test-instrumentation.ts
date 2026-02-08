/**
 * Test instrumentation utilities for OpenTelemetry.
 *
 * Provides utilities for creating spans with test-specific attributes to enable
 * filtering test telemetry in observability platforms like SigNoz.
 *
 * Each test file execution creates a parent span with `test.file` and
 * `test.framework=bun` attributes. Each test case execution creates a child span
 * with `test.name` (test case name) and `test.suite` (describe block name) attributes.
 *
 * Failed test spans include `test.error.message` and `test.error.stack` attributes.
 * All test spans inherit `dr.project.name` from resource attributes.
 *
 * Pattern: All telemetry function calls must be directly guarded by
 * `if (TELEMETRY_ENABLED)` checks in calling code to enable tree-shaking
 * and zero-cost abstractions in production builds.
 */

import type { Span } from "@opentelemetry/api";

// Fallback for runtime environments where TELEMETRY_ENABLED is not defined by esbuild
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

interface TestSpanContext {
  fileSpan: Span | null;
  currentTestFile: string;
}

const testContext: TestSpanContext = {
  fileSpan: null,
  currentTestFile: "unknown",
};

/**
 * Start a file-level span for test suite execution.
 * Call this at the beginning of each test file (e.g., in beforeAll hook).
 *
 * Returns the span object for later cleanup, or null when telemetry is disabled.
 *
 * @param filePath - The path to the test file
 * @returns The started span, or null if telemetry is disabled
 *
 * @example
 * ```typescript
 * import { beforeAll, afterAll } from 'bun:test';
 * import { startTestFileSpan, endTestFileSpan } from '../../src/telemetry/test-instrumentation.js';
 *
 * beforeAll(() => {
 *   startTestFileSpan('tests/unit/example.test.ts');
 * });
 *
 * afterAll(() => {
 *   endTestFileSpan();
 * });
 * ```
 */
export function startTestFileSpan(filePath: string): Span | null {
  if (!isTelemetryEnabled) return null;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { startSpan } = require("./index.js");

  testContext.currentTestFile = filePath;
  testContext.fileSpan = startSpan("test.file", {
    "test.file": filePath,
    "test.framework": "bun",
  });
  return testContext.fileSpan;
}

/**
 * End the file-level span.
 * Call this at the end of each test file (e.g., in afterAll hook).
 *
 * No-op when telemetry is disabled.
 */
export function endTestFileSpan(): void {
  if (!isTelemetryEnabled) return;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { endSpan } = require("./index.js");

  if (testContext.fileSpan) {
    endSpan(testContext.fileSpan);
    testContext.fileSpan = null;
  }
}

/**
 * Create a span for a test case execution.
 *
 * Should be called at the start of each test case. The returned span should be
 * passed to recordTestResult() after the test completes to record the result
 * and end the span.
 *
 * @param testName - The name of the test case
 * @param suiteName - Optional describe block name (suite name)
 * @returns The started span, or null if telemetry is disabled
 *
 * @example
 * ```typescript
 * const span = createTestCaseSpan('should validate input', 'ValidationTests');
 * try {
 *   // test code here
 *   recordTestResult(span, 'pass');
 * } catch (error) {
 *   recordTestResult(span, 'fail', error);
 *   throw error;
 * }
 * ```
 */
export function createTestCaseSpan(testName: string, suiteName?: string): Span | null {
  if (!isTelemetryEnabled) return null;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { startSpan } = require("./index.js");

  return startSpan("test.case", {
    "test.name": testName,
    "test.suite": suiteName || "",
    "test.file": testContext.currentTestFile,
  });
}

/**
 * Record test result and end the test case span.
 *
 * Sets the `test.status` attribute and, for failed tests, records the error
 * message and stack trace. The span is ended after recording the result.
 *
 * Safe to call with null span (no-op).
 *
 * @param span - The test case span (from createTestCaseSpan)
 * @param status - Test result status: 'pass', 'fail', or 'skip'
 * @param error - Optional Error object for failed tests
 *
 * @example
 * ```typescript
 * const span = createTestCaseSpan('my test');
 * try {
 *   // test logic
 *   recordTestResult(span, 'pass');
 * } catch (error) {
 *   recordTestResult(span, 'fail', error as Error);
 *   throw error;  // Re-throw to fail the test
 * }
 * ```
 */
export function recordTestResult(
  span: Span | null,
  status: "pass" | "fail" | "skip",
  error?: Error
): void {
  if (!isTelemetryEnabled || !span) return;

  span.setAttribute("test.status", status);

  if (error) {
    span.setAttribute("test.error.message", error.message);
    span.setAttribute("test.error.stack", error.stack || "");
    span.recordException(error);
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { endSpan } = require("./index.js");
  endSpan(span);
}

/**
 * Helper for wrapping Bun test cases with instrumentation.
 *
 * This helper wraps a test function to automatically create a test case span,
 * execute the test, record the result, and end the span. Failures are recorded
 * and re-thrown to properly fail the test.
 *
 * @param testName - The name of the test case
 * @param testFn - The test function (async or sync)
 * @param suiteName - Optional describe block name for organization
 * @returns A wrapped test function that handles instrumentation
 *
 * @example
 * ```typescript
 * import { test, describe } from 'bun:test';
 * import { instrumentTest } from '../../src/telemetry/test-instrumentation.js';
 *
 * describe('MyComponent', () => {
 *   test('should work', instrumentTest('should work', async () => {
 *     // Test logic here
 *   }, 'MyComponent'));
 *
 *   test('should handle errors', instrumentTest('should handle errors', async () => {
 *     // More test logic
 *   }, 'MyComponent'));
 * });
 * ```
 */
export function instrumentTest(
  testName: string,
  testFn: () => void | Promise<void>,
  suiteName?: string
): () => Promise<void> {
  return async () => {
    const span = createTestCaseSpan(testName, suiteName);
    try {
      await testFn();
      recordTestResult(span, "pass");
    } catch (error) {
      recordTestResult(span, "fail", error as Error);
      throw error; // Re-throw to fail the test
    }
  };
}
