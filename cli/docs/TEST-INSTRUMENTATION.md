# Test Instrumentation Guide

This guide explains how to use the test instrumentation utilities to enable filtering and debugging test telemetry in observability platforms like SigNoz.

## Overview

Test instrumentation creates OpenTelemetry spans with test-specific attributes, allowing you to:

- **Filter test spans** in SigNoz by test name, suite, file, or project
- **View test results** (pass/fail/skip) as span attributes
- **Debug test failures** with error messages and stack traces in spans
- **Correlate tests with CLI commands** by tracing context propagation

## Architecture

### Span Hierarchy

```
test.file span (parent)
├── attributes:
│   ├── test.file: "tests/unit/example.test.ts"
│   ├── test.framework: "bun"
│   ├── dr.project.name: "my-project"
│
├── test.case span (child 1)
│   ├── attributes:
│   │   ├── test.name: "should validate input"
│   │   ├── test.suite: "ValidationTests"
│   │   ├── test.status: "pass"
│   │   ├── dr.project.name: "my-project"
│
└── test.case span (child 2)
    ├── attributes:
        ├── test.name: "should handle errors"
        ├── test.suite: "ValidationTests"
        ├── test.status: "fail"
        ├── test.error.message: "Expected string, got number"
        ├── test.error.stack: "Error: Expected string...\n    at..."
        ├── dr.project.name: "my-project"
```

### Span Attributes

#### File-Level Span (`test.file`)

| Attribute         | Type   | Example                      | Description                            |
| ----------------- | ------ | ---------------------------- | -------------------------------------- |
| `test.file`       | string | `tests/unit/example.test.ts` | Path to the test file                  |
| `test.framework`  | string | `bun`                        | Test framework being used              |
| `dr.project.name` | string | `my-project`                 | Project name (inherited from resource) |

#### Test Case Span (`test.case`)

| Attribute         | Type   | Example                      | Description                            |
| ----------------- | ------ | ---------------------------- | -------------------------------------- |
| `test.name`       | string | `should validate input`      | Test case name                         |
| `test.suite`      | string | `ValidationTests`            | Describe block name (optional)         |
| `test.file`       | string | `tests/unit/example.test.ts` | Parent test file                       |
| `test.status`     | string | `pass`, `fail`, `skip`       | Test result status                     |
| `dr.project.name` | string | `my-project`                 | Project name (inherited from resource) |

#### Error Attributes (on failed tests)

| Attribute            | Type   | Example                          |
| -------------------- | ------ | -------------------------------- |
| `test.error.message` | string | `Expected string, got number`    |
| `test.error.stack`   | string | `Error: Expected...\n    at ...` |

## Basic Usage

### Setup: File-Level Span

Add this to the top of your test file to create a file-level span:

```typescript
import { describe, test, beforeAll, afterAll } from "bun:test";
import {
  startTestFileSpan,
  endTestFileSpan,
  instrumentTest,
} from "../../src/telemetry/test-instrumentation.js";

// Create file-level span at the beginning of tests
beforeAll(() => {
  startTestFileSpan("tests/unit/my.test.ts");
});

// Clean up at the end of tests
afterAll(() => {
  endTestFileSpan();
});
```

### Simple Tests with Helper

Use `instrumentTest()` to wrap test functions:

```typescript
describe("ValidationTests", () => {
  test(
    "should validate positive numbers",
    instrumentTest(
      "should validate positive numbers",
      async () => {
        const isValid = (n: number) => n > 0;
        expect(isValid(42)).toBe(true);
      },
      "ValidationTests"
    )
  );
});
```

### Advanced: Manual Span Management

For complex tests, manage spans manually:

```typescript
import { createTestCaseSpan, recordTestResult } from "../../src/telemetry/test-instrumentation.js";

test("complex test", async () => {
  const span = createTestCaseSpan("complex test", "ComplexTests");
  try {
    // test code
    recordTestResult(span, "pass");
  } catch (error) {
    recordTestResult(span, "fail", error as Error);
    throw error; // Re-throw to fail the test
  }
});
```

### Using Helpers

Import the helper functions for cleaner setup:

```typescript
import { setupTestTelemetry } from "../../tests/helpers/test-instrumentation-helpers.js";
import { describe, test, beforeAll, afterAll } from "bun:test";

const { beforeAll: setupTelemetry, afterAll: teardownTelemetry } =
  setupTestTelemetry("tests/unit/my.test.ts");

beforeAll(setupTelemetry);
afterAll(teardownTelemetry);

describe("MyTests", () => {
  test("my test", () => {
    // test code
  });
});
```

## Complete Example

```typescript
// tests/unit/example.test.ts
import { describe, test, beforeAll, afterAll, expect } from "bun:test";
import {
  startTestFileSpan,
  endTestFileSpan,
  instrumentTest,
} from "../../src/telemetry/test-instrumentation.js";

// File-level setup
beforeAll(() => {
  startTestFileSpan("tests/unit/example.test.ts");
});

afterAll(() => {
  endTestFileSpan();
});

describe("ValidationTests", () => {
  test(
    "should validate email",
    instrumentTest(
      "should validate email",
      async () => {
        const validateEmail = (email: string) => {
          if (!email.includes("@")) throw new Error("Invalid email");
          return true;
        };

        expect(validateEmail("user@example.com")).toBe(true);
        expect(() => validateEmail("invalid")).toThrow("Invalid email");
      },
      "ValidationTests"
    )
  );

  test(
    "should handle edge cases",
    instrumentTest(
      "should handle edge cases",
      async () => {
        const isEmpty = (s: string) => s.length === 0;
        expect(isEmpty("")).toBe(true);
        expect(isEmpty("a")).toBe(false);
      },
      "ValidationTests"
    )
  );
});
```

## Telemetry Flow

When telemetry is enabled (`TELEMETRY_ENABLED=true`):

1. **Test file starts** → `startTestFileSpan()` creates parent span
2. **Each test runs** → `instrumentTest()` wraps test function
3. **Test span created** → Child span with `test.name`, `test.suite`
4. **Test completes** → `recordTestResult()` sets `test.status`
5. **On failure** → Error attributes (`test.error.message`, `test.error.stack`) added
6. **Span exported** → SimpleSpanProcessor sends to OTLP collector
7. **Test file ends** → `endTestFileSpan()` closes parent span

### Export Endpoint

By default, spans are sent to:

```
http://localhost:4318/v1/traces
```

Configure via environment variables:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://your-collector:4318
```

## SigNoz Integration

### Viewing Test Spans

1. Open SigNoz dashboard
2. Go to **Traces** section
3. Filter by attributes:

   ```
   dr.project.name = "my-project"
   test.framework = "bun"
   ```

### Query Examples

**Find all failed tests:**

```
test.status = "fail"
```

**Find tests in a specific file:**

```
test.file = "tests/unit/example.test.ts"
```

**Find tests in a suite:**

```
test.suite = "ValidationTests"
```

**Find tests with errors matching pattern:**

```
test.error.message LIKE "%assertion%"
```

### Viewing Error Details

Click a failed test span to see:

- `test.error.message` - Error message
- `test.error.stack` - Full stack trace
- Exception record with full error context

## Performance Considerations

### Production Mode

In production builds, `TELEMETRY_ENABLED=false` and all instrumentation becomes zero-cost:

```typescript
// Compiled out in production
if (TELEMETRY_ENABLED) {
  const span = startTestFileSpan("..."); // → Eliminated
}
```

### Debug Mode

In debug mode, overhead is minimal:

- File span: ~1ms overhead per test file
- Test span: ~0.1ms overhead per test case
- Exporter timeout: 500ms (non-blocking, happens in background)

### Circuit-Breaker Protection

If the OTLP collector is unreachable:

1. First export attempt fails with 500ms timeout
2. Circuit-breaker activates for 30 seconds
3. Spans discarded silently (no CLI impact)
4. After 30s, collector connection retried

## Troubleshooting

### Spans Not Appearing in SigNoz

1. **Check collector is running:**

   ```bash
   curl http://localhost:4318/v1/traces
   ```

2. **Verify telemetry is enabled:**
   - Debug build should have `TELEMETRY_ENABLED=true`
   - Check CLI log output for telemetry initialization

3. **Check resource attributes:**
   - In SigNoz, look for spans with `service.name=dr-cli`
   - Filter by `dr.project.name` to verify project context

### Empty `test.suite` Attribute

If `test.suite` is empty string:

- Means the optional `suiteName` parameter wasn't provided
- This is fine - tests are still tracked by `test.name`

### Stack Traces Not Visible

- Verify error has `stack` property
- Check `test.error.stack` attribute in span
- Very old Error objects may not have stack traces

## Integration with Manifest

Test spans automatically include the project name from your model manifest:

```json
// .dr/manifest.json
{
  "name": "my-project",
  "version": "1.0.0"
}
```

This becomes the `dr.project.name` attribute on all test spans, enabling filtering by project.

## Best Practices

1. **Always set up file span** - Use `beforeAll`/`afterAll` hooks
2. **Use suite names** - Help organize tests in SigNoz
3. **Let errors bubble** - Re-throw after `recordTestResult(span, 'fail', error)`
4. **Consistent naming** - Use readable test names for better filtering
5. **Group related tests** - Use describe blocks with suite names

## API Reference

### `startTestFileSpan(filePath: string): Span | null`

Creates a file-level span for the test file.

- **Returns:** Span object (or null if telemetry disabled)
- **Call:** In `beforeAll()` hook

### `endTestFileSpan(): void`

Ends the file-level span and cleans up context.

- **Call:** In `afterAll()` hook

### `createTestCaseSpan(testName: string, suiteName?: string): Span | null`

Creates a span for a test case.

- **Parameters:**
  - `testName`: Name of the test case
  - `suiteName`: Optional describe block name
- **Returns:** Span object (or null if telemetry disabled)

### `recordTestResult(span: Span | null, status: 'pass' | 'fail' | 'skip', error?: Error): void`

Records test result and ends the span.

- **Parameters:**
  - `span`: Test case span (from `createTestCaseSpan`)
  - `status`: Test result
  - `error`: Optional Error object for failed tests
- **Effect:** Sets attributes and ends span

### `instrumentTest(testName: string, testFn: () => void | Promise<void>, suiteName?: string): () => Promise<void>`

Wraps a test function with automatic instrumentation.

- **Parameters:**
  - `testName`: Name of the test
  - `testFn`: Test function (sync or async)
  - `suiteName`: Optional describe block name
- **Returns:** Wrapped async function for use with `test()`
- **Behavior:** Automatically creates span, executes test, records result

## Examples

See the following files for complete examples:

- `tests/unit/test-instrumentation.example.test.ts` - Basic usage examples
- `tests/unit/test-instrumentation.test.ts` - Unit tests for instrumentation
- `tests/unit/test-instrumentation-integration.test.ts` - Integration examples
