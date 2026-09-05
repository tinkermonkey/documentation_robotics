/**
 * Example instrumented test file demonstrating test span creation.
 *
 * This test file shows how to use the test instrumentation utilities
 * to enable filtering test telemetry in observability platforms like SigNoz.
 *
 * Features demonstrated:
 * - File-level span with test.file and test.framework attributes
 * - Test case spans with test.name and test.suite attributes
 * - Automatic result recording with test.status and error attributes
 * - Project name propagation from resource attributes
 *
 * Run with: `bun test tests/unit/test-instrumentation.example.test.ts`
 * Telemetry will be sent to http://localhost:4318/v1/traces by default.
 */

import { describe, test, beforeAll, afterAll } from "bun:test";
import { expect } from "bun:test";

// Note: In production builds, TELEMETRY_ENABLED is set to false by esbuild,
// so all telemetry calls become no-ops with zero overhead.
// For testing, telemetry can be enabled via environment variables.
(globalThis as any).TELEMETRY_ENABLED = false;

import {
  startTestFileSpan,
  endTestFileSpan,
  instrumentTest,
} from "../../src/telemetry/test-instrumentation.js";

// Setup: Create file-level span at test suite start
beforeAll(() => {
  startTestFileSpan("tests/unit/test-instrumentation.example.test.ts");
});

// Teardown: End file-level span at test suite end
afterAll(() => {
  endTestFileSpan();
});

describe("ValidationExample", () => {
  // Example 1: Simple passing test using instrumentTest helper
  test(
    "should validate positive numbers",
    instrumentTest(
      "should validate positive numbers",
      async () => {
        const isValid = (n: number) => n > 0;
        expect(isValid(42)).toBe(true);
        expect(isValid(0)).toBe(false);
        expect(isValid(-1)).toBe(false);
      },
      "ValidationExample"
    )
  );

  // Example 2: Test demonstrating error handling
  test(
    "should handle validation errors",
    instrumentTest(
      "should handle validation errors",
      async () => {
        const validate = (value: unknown): string => {
          if (typeof value !== "string") {
            throw new Error("Expected string, got " + typeof value);
          }
          if (value.length === 0) {
            throw new Error("String cannot be empty");
          }
          return value;
        };

        // Should pass
        expect(validate("hello")).toBe("hello");

        // Should fail
        expect(() => validate(123 as any)).toThrow("Expected string");
      },
      "ValidationExample"
    )
  );
});

describe("CalculationExample", () => {
  // Example 3: Test with different suite name
  test(
    "should add numbers correctly",
    instrumentTest(
      "should add numbers correctly",
      async () => {
        const add = (a: number, b: number) => a + b;
        expect(add(2, 3)).toBe(5);
        expect(add(-1, 1)).toBe(0);
        expect(add(0, 0)).toBe(0);
      },
      "CalculationExample"
    )
  );

  // Example 4: Async test
  test(
    "should handle async operations",
    instrumentTest(
      "should handle async operations",
      async () => {
        // Simulate an async operation
        const asyncTask = () =>
          new Promise<string>((resolve) => {
            setTimeout(() => resolve("done"), 10);
          });

        const result = await asyncTask();
        expect(result).toBe("done");
      },
      "CalculationExample"
    )
  );
});

describe("EdgeCaseExample", () => {
  // Example 5: Test with empty suite name
  test(
    "should handle edge cases",
    instrumentTest("should handle edge cases", async () => {
      const clamp = (min: number, max: number, value: number) => {
        return Math.min(max, Math.max(min, value));
      };

      expect(clamp(0, 10, -5)).toBe(0);
      expect(clamp(0, 10, 15)).toBe(10);
      expect(clamp(0, 10, 5)).toBe(5);
    })
  );
});

// Telemetry Output in SigNoz:
//
// When run with TELEMETRY_ENABLED=true and a local SigNoz instance,
// this test file will produce spans with the following structure:
//
// test.file span (parent)
// ├── test.file: "tests/unit/test-instrumentation.example.test.ts"
// ├── test.framework: "bun"
// ├── dr.project.name: <from manifest or "unknown">
// │
// └── test.case spans (children)
//     ├── test.name: "should validate positive numbers"
//     ├── test.suite: "ValidationExample"
//     ├── test.file: "tests/unit/test-instrumentation.example.test.ts"
//     ├── test.status: "pass"
//     ├── dr.project.name: <inherited from resource>
//     │
//     ├── test.name: "should handle validation errors"
//     ├── test.status: "pass"
//     │
//     └── ... (more test.case spans for each test)
//
// For failed tests, the span includes:
// ├── test.status: "fail"
// ├── test.error.message: "error message text"
// ├── test.error.stack: "error stack trace"
