# CLI OpenTelemetry Error Handling Guide

This document explains how error handling integrates with OpenTelemetry telemetry in the Documentation Robotics CLI.

## Overview

The CLI implements a comprehensive error handling strategy that ensures:

1. **Full exception capture** - All errors are recorded in OTLP traces with stack traces
2. **Proper span export** - Spans are always exported, even when commands fail
3. **Correct exit codes** - Exit codes are preserved from error types
4. **No data loss** - Async span exports complete before process exit

## Architecture

### Key Components

```
┌─────────────────────────────────────────────────────────────┐
│ CLI Entry Point (cli/src/cli.ts)                           │
│                                                             │
│  1. program.exitOverride() - prevents early exit           │
│  2. startActiveSpan('cli.execute') - wraps execution       │
│  3. try/catch - captures all errors                        │
│  4. span.recordException() - records error details         │
│  5. shutdownTelemetry() - flushes before exit              │
│  6. process.exit(exitCode) - exits with correct code       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Telemetry System (cli/src/telemetry/index.ts)              │
│                                                             │
│  - SimpleSpanProcessor with OTLP exporter                  │
│  - Async export via _doExport() (timing critical!)         │
│  - forceFlush() waits for pending exports                  │
│  - Proper shutdown sequence prevents data loss             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Error Handling (cli/src/utils/errors.ts)                   │
│                                                             │
│  - CLIError class with exitCode property                   │
│  - handleError() throws instead of process.exit()          │
│  - Allows CLI wrapper to control exit timing               │
└─────────────────────────────────────────────────────────────┘
```

## Error Flow

### Success Case

```typescript
// Command executes successfully
dr version

// Telemetry flow:
1. cli.execute span starts
2. version.execute span starts (Commander hook)
3. version.execute span ends with status OK
4. cli.execute span ends with status OK
5. shutdownTelemetry():
   - spanProcessor.forceFlush() waits for async exports
   - sdk.shutdown() completes cleanup
6. process.exit(0)

// OTLP collector receives:
- 2 spans with status OK
- Parent-child relationship preserved
- All attributes and events included
```

### Error Case

```typescript
// Command fails with error
dr add invalid-layer invalid-type test

// Telemetry flow:
1. cli.execute span starts
2. Command throws error
3. CLI wrapper catches error:
   - span.recordException(error) - captures exception details
   - span.setStatus({ code: 2, message: error.message }) - ERROR status
   - Extract exitCode from CLIError (or default to 1)
4. cli.execute span ends with status ERROR
5. shutdownTelemetry():
   - spanProcessor.forceFlush() waits for async exports  ⚠️ CRITICAL
   - sdk.shutdown() completes cleanup
6. process.exit(exitCode)

// OTLP collector receives:
- 1 span with status ERROR (code: 2)
- Exception event with:
  * exception.type: "Error" or "CLIError"
  * exception.message: "Unknown layer 'invalid-layer'"
  * exception.stacktrace: Full stack trace
- All parent spans and context
```

## Critical Implementation Details

### 1. Commander.js Integration

**Problem**: Commander.js calls `process.exit()` by default, bypassing telemetry flush.

**Solution**: Use `exitOverride()` to prevent early exit.

```typescript
// cli/src/cli.ts
program.exitOverride(); // Prevents Commander from calling process.exit()

try {
  await program.parseAsync(process.argv);
} catch (error) {
  // We control when exit happens
  span.recordException(error as Error);
  exitCode = error instanceof CLIError ? error.exitCode : 1;
}
```

### 2. Async Export Timing (CRITICAL!)

**Problem**: SimpleSpanProcessor exports spans asynchronously via `_doExport()`. CLI applications exit immediately after command completion, cutting off pending async exports.

**The Bug We Fixed**:

```typescript
// ❌ WRONG - Spans lost in error case
export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown(); // Doesn't wait for pending async exports!
}
```

**Root Cause**:

- `span.end()` triggers async export: `this._doExport(span).catch(...)`
- Export added to `_pendingExports` Set
- `shutdown()` completes before async export finishes
- `process.exit()` terminates Node.js
- Async export callback never runs

**Solution**: Explicit `forceFlush()` before shutdown.

```typescript
// ✅ CORRECT - All spans exported
export async function shutdownTelemetry(): Promise<void> {
  if (spanProcessor) {
    // Wait for ALL pending async exports to complete
    await spanProcessor.forceFlush();
  }
  await sdk?.shutdown();
  await loggerProvider?.shutdown();
}
```

**What forceFlush() does**:

```typescript
// Inside SimpleSpanProcessor
async forceFlush(): Promise<void> {
  // Wait for all pending async exports
  await Promise.all(Array.from(this._pendingExports));
}
```

### 3. Error Throwing vs. process.exit()

**Problem**: Calling `process.exit()` in error handlers bypasses telemetry flush.

**Solution**: Throw errors instead, let CLI wrapper handle exit.

```typescript
// cli/src/utils/errors.ts

// ❌ WRONG - Bypasses telemetry
export function handleError(error: unknown): never {
  console.error(formatError(error));
  process.exit(1); // Telemetry shutdown never runs!
}

// ✅ CORRECT - Allows telemetry flush
export function handleError(error: unknown): never {
  console.error(formatError(error));
  throw error; // CLI wrapper catches and flushes telemetry
}
```

### 4. Exit Code Preservation

Exit codes are preserved through the error flow:

```typescript
// CLIError with custom exit codes
export enum ExitCode {
  USER_ERROR = 1, // Invalid user input
  NOT_FOUND = 2, // Resource not found
  SYSTEM_ERROR = 3, // System/IO errors
  VALIDATION_ERROR = 4, // Model validation failures
  BREAKING_CHANGE = 5, // Breaking spec changes
}

// CLI wrapper extracts and uses correct exit code
exitCode = error instanceof CLIError ? error.exitCode : 1;
```

## What Appears in OTLP Collector

### Span Status Codes

Per OpenTelemetry specification:

- `0` = OK - Command succeeded
- `1` = UNSET - Status not set (shouldn't happen)
- `2` = ERROR - Command failed

### Exception Events

When an error occurs, the span includes an exception event with:

```json
{
  "name": "exception",
  "attributes": {
    "exception.type": "CLIError",
    "exception.message": "Unknown layer 'invalid-layer'",
    "exception.stacktrace": "CLIError: Unknown layer 'invalid-layer'\n    at validateLayer (/path/to/file.ts:123:11)\n    at Command.action (/path/to/file.ts:456:5)\n    ..."
  },
  "timestamp": "2026-01-29T12:34:56.789Z"
}
```

### Span Hierarchy

Success case (2 spans):

```
cli.execute [status: OK]
└── version.execute [status: OK]
```

Error case (1 span):

```
cli.execute [status: ERROR]
└── exception event (details above)
```

## Example Telemetry Output

### Success Case

```bash
$ DR_TELEMETRY_DEBUG=1 dr --version

[TELEMETRY] Exporting 2 span(s) to http://192.168.0.245:4318/v1/traces
[TELEMETRY] Export SUCCESS - 2 span(s) sent
0.1.0
```

### Error Case

```bash
$ DR_TELEMETRY_DEBUG=1 dr add invalid-layer invalid-type test

[TELEMETRY] Exporting 1 log(s) to http://192.168.0.245:4318/v1/logs
Error: Unknown layer "invalid-layer"
[TELEMETRY] Export SUCCESS - 1 log(s) sent
[TELEMETRY] Exporting 1 span(s) to http://192.168.0.245:4318/v1/traces
[TELEMETRY] Export SUCCESS - 1 span(s) sent
```

## Best Practices for CLI Applications

Based on OpenTelemetry community patterns:

### 1. Always forceFlush() Before Exit

CLI apps have different lifecycle than servers:

```typescript
// Server (long-running)
app.listen(3000);
// Spans flush naturally over time

// CLI (short-lived)
await command.execute();
await spanProcessor.forceFlush(); // ⚠️ REQUIRED
process.exit(0);
```

### 2. Use exitOverride() with Commander

Prevent early exit to ensure telemetry completes:

```typescript
program.exitOverride();
```

### 3. Throw, Don't Exit

Let the CLI wrapper control exit timing:

```typescript
// In command handlers
if (error) {
  throw new CLIError("Error message", ExitCode.USER_ERROR);
  // Don't: process.exit(1)
}
```

### 4. Record Exceptions in Catch Blocks

Capture full context when errors occur:

```typescript
try {
  await command.execute();
} catch (error) {
  span.recordException(error as Error);
  span.setStatus({ code: 2, message: error.message });
  // Handle exit after telemetry flush
}
```

## Debugging Tips

### Enable Debug Output

```bash
export DR_TELEMETRY_DEBUG=1
dr <command>
```

### Check Span Export

Look for these messages:

- `Exporting N span(s) to http://...` - Export starting
- `Export SUCCESS - N span(s) sent` - Export completed
- If missing: spans not exported (check forceFlush)

### Verify Exception Recording

Error spans should include:

1. Span status code = 2 (ERROR)
2. Exception event with type, message, stacktrace
3. Exit code matches CLIError.exitCode

### Common Issues

**Spans not exported in error case**:

- Missing `await spanProcessor.forceFlush()`
- Early `process.exit()` before shutdown completes

**Exit code always 1**:

- Not extracting `exitCode` from CLIError
- Calling `process.exit()` directly in error handlers

**Missing exception details**:

- Not calling `span.recordException(error)`
- Not setting span status to ERROR

## Testing

Test both success and error cases:

```bash
# Success case
DR_TELEMETRY_DEBUG=1 dr --version
# Expect: 2 spans with status OK

# Error case
DR_TELEMETRY_DEBUG=1 dr add invalid-layer invalid-type test
# Expect: 1 span with status ERROR and exception event
```

## Related Documentation

- [OpenTelemetry JavaScript SDK](https://opentelemetry.io/docs/instrumentation/js/)
- [SimpleSpanProcessor Source](https://github.com/open-telemetry/opentelemetry-js/blob/main/packages/opentelemetry-sdk-trace-base/src/export/SimpleSpanProcessor.ts)
- [Commander.js Documentation](https://github.com/tj/commander.js)
- [CLI Telemetry Setup](./telemetry.md)

## Implementation Files

Key files implementing this pattern:

- `cli/src/cli.ts` - CLI wrapper with error capture
- `cli/src/telemetry/index.ts` - Telemetry initialization and shutdown
- `cli/src/utils/errors.ts` - Error handling utilities
- `cli/src/telemetry/resilient-exporter.ts` - OTLP exporter with circuit breaker

## Summary

The CLI implements a robust error handling strategy that:

1. **Captures all errors** in OTLP traces with full exception details
2. **Prevents data loss** by forcing async exports to complete before exit
3. **Preserves exit codes** for proper shell integration
4. **Follows best practices** from the OpenTelemetry community

The critical insight: CLI applications must explicitly call `spanProcessor.forceFlush()` before shutdown because `SimpleSpanProcessor` exports spans asynchronously, and process exit would otherwise cut off pending exports.
