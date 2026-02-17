# Error Handling Audit Report
## PR: feature/issue-307-implement-openapi-auto-generat

**Audit Date:** 2026-02-17
**Severity Level:** CRITICAL - Multiple silent failures and unhandled promise rejections
**Overall Assessment:** Significant error handling deficiencies that could lead to obscure bugs in production

---

## Executive Summary

This PR introduces new OpenAPI schema generation and WebSocket messaging features with **critical error handling deficiencies**. The primary issues are:

1. **Unhandled Promise Rejection in Background Task** - Streaming errors are silently lost
2. **Broad Exception Catching Masks Unrelated Errors** - JSON parsing and stream handling catch blocks are too wide
3. **Silent Telemetry Failures** - Fallback silently suppresses telemetry errors without proper logging
4. **Inadequate Error Context in User-Facing Messages** - Generic "Chat failed" errors don't help users debug
5. **Missing Validation Before Operations** - File writes and schema operations don't validate prerequisites
6. **Inconsistent Error Handling Patterns** - Some routes log errors, others don't

---

## Critical Issues

### CRITICAL #1: Unhandled Promise Rejections in Background Streaming Tasks

**Location:** `/workspace/cli/src/server/server.ts`
- Line 1838: `streamOutput();` (launchChat method)
- Line 1983: `streamOutput();` (launchCopilot method)

**Severity:** CRITICAL

**Issue Description:**
The `streamOutput()` async function is called without `await` and without error handling. Any errors that occur during streaming (file read errors, JSON parse errors, WebSocket send failures, or process exit errors) are **completely silent**. This is a classic JavaScript pitfall where promise rejections go to the void.

**Hidden Errors That Are Currently Silent:**
1. Unhandled rejection when `proc.stdout.getReader()` fails
2. Unhandled rejection when `stdoutReader.read()` throws
3. Unhandled rejection when `proc.exited` promise rejects
4. Any uncaught exceptions within the try block of `streamOutput()`
5. WebSocket send failures in the catch block that itself throws

**User Impact:**
- Chat streaming silently stops without any notification to the user
- WebSocket connection reports no error status
- Conversation appears to hang indefinitely
- No logs of what actually went wrong
- Debugging nightmare - no error information is captured

**Recommendation:**
Wrap `streamOutput()` in error handling:

```typescript
// Start streaming in background with error handling
streamOutput().catch((error) => {
  const errorMsg = getErrorMessage(error);
  console.error(`[Claude Code] Stream error for conversation ${conversationId}: ${errorMsg}`);

  // Send error notification to client
  try {
    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: JSONRPC_ERRORS.INTERNAL_ERROR,
        message: `Chat streaming failed: ${errorMsg}`,
      },
      id: requestId,
    }));
  } catch (wsError) {
    console.warn(`[Claude Code] Failed to send error notification: ${getErrorMessage(wsError)}`);
  }

  // Clean up
  this.activeChatProcesses.delete(conversationId);
  try {
    proc.kill();
  } catch (error) {
    console.warn(`[Claude Code] Failed to kill process: ${getErrorMessage(error)}`);
  }
});
```

---

### CRITICAL #2: Overly Broad Exception Catching in JSON Parsing

**Location:** `/workspace/cli/src/server/server.ts`
- Lines 1704-1773 (launchChat JSON parsing)
- Lines 1756-1773 (fallback to raw text)

**Severity:** CRITICAL

**Issue Description:**
The catch block at line 1756 is **dangerously broad**. It catches `parseError` from `JSON.parse(line)` but then silently treats the non-JSON line as a "raw text chunk". This masks multiple categories of errors:

**Hidden Errors Caught and Hidden:**
1. `JSON.parse()` failures (legitimate - handles this correctly)
2. `JSON.stringify()` errors when sending response
3. `ws.send()` failures
4. TextDecoder errors
5. Any unexpected error in the try block above

When any of errors 2-5 occur, the code silently treats them as "non-JSON lines" and sends the original unparsed line as a text chunk, compounding the error.

**User Impact:**
- Errors during response serialization are silently swallowed
- WebSocket failures are treated as non-JSON data
- Real errors are masked and logged as debug messages only
- Production errors only visible if DEBUG env var is set

**Recommendation:**
Separate the error handling by type:

```typescript
try {
  const event = JSON.parse(line);
  // ... handle parsed event
} catch (parseError) {
  // Only catch JSON parse errors - expected for non-JSON lines
  if (parseError instanceof SyntaxError) {
    // Non-JSON line, send as raw text chunk
    if (process.env.DEBUG) {
      console.debug(`[Chat] Failed to parse JSON chunk: ${getErrorMessage(parseError)}`);
    }
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "chat.response.chunk",
        params: {
          conversation_id: conversationId,
          content: line + "\n",
          is_final: false,
          timestamp: new Date().toISOString(),
        },
      })
    );
  } else {
    // Unexpected error type - don't suppress
    throw parseError;
  }
}
```

---

### CRITICAL #3: Silent Fallback Masking Real Problems in Telemetry

**Location:** `/workspace/cli/src/server/server.ts`
- Lines 1414-1419 (recordWebSocketEvent error handling)

**Severity:** CRITICAL (Production Impact)

**Issue Description:**
The telemetry error handler silently catches and suppresses telemetry failures:

```typescript
catch (error) {
  // Log telemetry failures to enable production debugging
  if (process.env.DEBUG) {
    console.warn(`[Telemetry] Failed to record WebSocket event: ${getErrorMessage(error)}`);
  }
}
```

This **only logs in DEBUG mode**, meaning production failures are completely silent. However, the comment says "enable production debugging" - a contradiction. The code silently falls back to doing nothing, which could mask:

**Hidden Errors:**
1. Dynamic import failures (`await import("../telemetry/index.js")`)
2. `startSpan()` failures
3. `endSpan()` failures
4. Module not found errors
5. Permission/access issues in production

**User Impact:**
- Production telemetry silently fails without any visibility
- Critical observability data is lost
- No indication that monitoring is broken
- Debugging failures requires enabling DEBUG mode in production

**Recommendation:**
Log telemetry failures appropriately:

```typescript
catch (error) {
  // Always log telemetry errors - this indicates monitoring is broken
  console.error(`[Telemetry] Failed to record WebSocket event: ${getErrorMessage(error)}`);
  if (process.env.DEBUG) {
    console.error(`[Telemetry] Stack:`, error instanceof Error ? error.stack : "N/A");
  }
}
```

---

### CRITICAL #4: Missing Error Context in User-Facing Chat Error Messages

**Location:** `/workspace/cli/src/server/server.ts`
- Lines 1813-1825 (launchChat error response)
- Lines 1958-1970 (launchCopilot error response)
- Line 1821: `message: 'Chat failed: ${errorMsg}'`
- Line 1966: `message: 'Chat failed: ${errorMsg}'`

**Severity:** HIGH

**Issue Description:**
When chat streaming fails, users receive the generic error message `"Chat failed: {errorMsg}"`. While `getErrorMessage(error)` is used, the context is insufficient:

**What Users DON'T Know:**
1. Which conversation failed (no `conversation_id` in error)
2. Whether it's a process spawn failure or stream read failure
3. Whether the Claude Code binary is missing or crashed
4. How much of the response was already received before failure
5. Whether they should retry or check their installation

**User Impact:**
- Users don't know what caused the failure
- Can't distinguish between "Claude Code not installed" vs "stream interrupted"
- No guidance on remediation
- Debugging requires logs and error message parsing

**Recommendation:**
Enhance error messages with context:

```typescript
catch (error) {
  const errorMsg = getErrorMessage(error);
  const contextMsg = error instanceof Error && error.message.includes('ENOENT')
    ? 'Claude Code is not installed or not in PATH'
    : error instanceof Error && error.message.includes('spawn')
    ? 'Failed to launch Claude Code process'
    : 'Chat streaming interrupted';

  ws.send(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: JSONRPC_ERRORS.INTERNAL_ERROR,
        message: `Chat failed: ${contextMsg}`,
        data: {
          conversation_id: conversationId,
          technical_details: errorMsg,
        },
      },
      id: requestId,
    })
  );
```

---

## High-Severity Issues

### HIGH #1: Inadequate Validation Before Schema File Writes

**Location:** `/workspace/cli/scripts/generate-openapi.ts`
- Lines 19-82 (generateOpenAPISpec function)

**Severity:** HIGH

**Issue Description:**
The script loads a model, creates a server, generates a spec, and writes it to disk, but has minimal pre-operation validation:

1. **No validation that output directory exists** (line 65-67)
   ```typescript
   const outputPath = join(projectRoot, "..", "docs", "api-spec.yaml");
   await writeFile(outputPath, specYaml, "utf-8");
   ```
   - If `docs/` directory doesn't exist, `writeFile` will fail
   - Error bubbles up as generic "Failed to generate OpenAPI specification"
   - User doesn't know if it's a model load error, schema generation error, or directory missing

2. **No validation that spec was actually generated** (line 32)
   - `server.getOpenAPIDocument()` is called without null/undefined check
   - If it returns empty/invalid, users won't know

3. **No validation that YAML.stringify works** (line 61)
   - Complex spec could fail to serialize to YAML
   - Error message would be cryptic

**Hidden Errors:**
1. `ENOENT` - output directory doesn't exist
2. `EACCES` - permission denied on directory
3. `EISDIR` - outputPath is a directory, not a file
4. `EMFILE` - too many open files
5. Invalid YAML generation from complex spec objects

**User Impact:**
- File write failures reported as "Failed to generate OpenAPI specification" (confusing)
- Users can't tell if the problem is model loading, schema generation, or filesystem
- No indication that the `docs/` directory needs to exist
- Silent file write failure if directory doesn't exist

**Recommendation:**
Add pre-validation:

```typescript
async function generateOpenAPISpec() {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");

    console.log("🔨 Generating OpenAPI specification...");

    // Validate output directory exists
    const outputPath = join(projectRoot, "..", "docs", "api-spec.yaml");
    const outputDir = path.dirname(outputPath);
    try {
      await fs.access(outputDir);
    } catch {
      throw new Error(`Output directory does not exist: ${outputDir}. Create it first with 'mkdir -p ${outputDir}'`);
    }

    // Load model
    console.log("📦 Loading model...");
    const model = await Model.load(projectRoot, { lazyLoad: true });

    // ... rest of function

    // Validate spec before writing
    if (!spec || typeof spec !== 'object') {
      throw new Error('Generated spec is invalid or empty');
    }

    // Validate YAML serialization
    const specYaml = `# HAND-MAINTAINED...
${YAML.stringify(spec, { indent: 2 })}`;

    if (!specYaml || specYaml.length === 0) {
      throw new Error('Failed to serialize spec to YAML');
    }

    console.log(`📝 Writing OpenAPI spec to ${outputPath}...`);
    await writeFile(outputPath, specYaml, "utf-8");

    console.log("✅ OpenAPI specification generated successfully!");
    console.log(`📄 Spec location: ${outputPath}`);
  } catch (error) {
    // ... error handling
  }
}
```

---

### HIGH #2: Insufficient Error Context in Route Handlers

**Location:** `/workspace/cli/src/server/server.ts`
- Multiple route error handlers (lines 303-307, 364-367, 421-424, 465-468, 603-607, 685-689, 767-771, 831-835, 957-961)

**Severity:** HIGH

**Issue Description:**
All API route error handlers use the same pattern with minimal context:

```typescript
catch (error) {
  const message = getErrorMessage(error);
  return c.json({ error: message }, 500);
}
```

This catches **ANY error** during route processing and returns a generic 500. Users can't distinguish between:
- Element not found (already handled in code, shouldn't reach here)
- Model corruption (serious)
- File read failures (transient)
- Memory exhaustion (infrastructure issue)
- Programming errors (bug in implementation)

**Hidden Errors:**
All of these different errors are caught and reported identically:
1. Database/file system corruption
2. Out of memory errors
3. Timeout errors
4. Concurrent modification issues
5. Missing dependencies
6. Null reference exceptions

**User Impact:**
- Client sees generic error message
- Can't retry intelligently (some errors are transient)
- Can't report issue effectively (all errors look the same)
- Debugging requires access to server logs

**Recommendation:**
Add error categorization:

```typescript
catch (error) {
  const message = getErrorMessage(error);
  let statusCode = 500;

  if (error instanceof ElementNotFoundError) {
    statusCode = 404;
  } else if (error instanceof ValidationError) {
    statusCode = 400;
  } else if (error instanceof Error && error.message.includes('ENOENT')) {
    statusCode = 404;
    // Log file-specific error
    console.error(`[ROUTE] File not found for /api/model: ${message}`);
  } else if (error instanceof Error && error.message.includes('out of memory')) {
    statusCode = 503;
    console.error(`[ROUTE] Out of memory error: ${message}`);
  } else {
    // Unexpected error - always log
    console.error(`[ROUTE] Unexpected error in /api/model: ${message}`, error);
  }

  return c.json({ error: message }, statusCode);
}
```

---

### HIGH #3: Bun.spawnSync Result Not Validated Before Use

**Location:** `/workspace/cli/src/server/server.ts`
- Lines 1869-1894 (launchCopilot method)

**Severity:** HIGH

**Issue Description:**
The code checks `gh copilot --version` but doesn't validate the result:

```typescript
const ghResult = Bun.spawnSync({
  cmd: ["gh", "copilot", "--version"],
  stdout: "pipe",
  stderr: "pipe",
});

if (ghResult.exitCode === 0) {
  cmd = ["gh", "copilot", "explain"];
  // ...
} else {
  // Try standalone copilot - assumes gh is not available
  cmd = ["copilot", "explain"];
  // ...
}
```

**Problems:**
1. **No error if `Bun.spawnSync()` itself fails** - returns null/undefined/throws
2. **Fallback is silent** - if gh check fails, we silently try standalone copilot
3. **No logging of which command will be used** - users don't know whether they're using gh or standalone
4. **No validation that chosen command exists** - could fail at actual execution

**Hidden Errors:**
1. `Bun.spawnSync()` throws unrelated error (permission denied on /bin/gh)
2. Version check stdout is corrupted - `exitCode` is undefined
3. Neither `gh` nor `copilot` binary exists - caught later at execution
4. `gh copilot` is available but `Bun.spawnSync()` check failed due to transient issue

**User Impact:**
- Silent fallback when gh check fails (user thinks they're using what they have)
- If both commands are missing, error only appears when trying to chat
- No indication which command failed or why

**Recommendation:**
Validate and log the decision:

```typescript
let cmd: string[];

try {
  // Check if gh CLI with copilot extension is available
  const ghResult = Bun.spawnSync({
    cmd: ["gh", "copilot", "--version"],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!ghResult) {
    throw new Error('Bun.spawnSync returned null/undefined');
  }

  if (ghResult.exitCode === 0) {
    cmd = ["gh", "copilot", "explain"];
    if (this.withDanger) {
      cmd.push("--allow-all-tools");
    }
    cmd.push(message);

    if (process.env.VERBOSE) {
      console.log("[Chat] Using gh copilot for Copilot explain");
    }
  } else {
    console.warn("[Chat] gh copilot not available, trying standalone copilot");
    cmd = ["copilot", "explain"];
    if (this.withDanger) {
      cmd.push("--allow-all-tools");
    }
    cmd.push(message);
  }
} catch (error) {
  console.warn(`[Chat] Failed to detect gh copilot: ${getErrorMessage(error)}, trying standalone`);
  cmd = ["copilot", "explain"];
  if (this.withDanger) {
    cmd.push("--allow-all-tools");
  }
  cmd.push(message);
}

// Validate chosen command exists before spawning
try {
  const proc = Bun.spawn({ cmd, /* ... */ });
  // ...
}
```

---

### HIGH #4: Chat Initialization Error Stored But Not Persisted or Validated

**Location:** `/workspace/cli/src/server/server.ts`
- Lines 168-171 (initialization error handling)
- Lines 1535-1536 (error status retrieval)

**Severity:** HIGH

**Issue Description:**
The chat initialization error is stored in memory:

```typescript
this.initializeChatClients().catch((error) => {
  this.chatInitializationError = error instanceof Error ? error : new Error(String(error));
  console.error("[Chat] Failed to initialize chat clients:", error);
});
```

But this approach has issues:

1. **Error is stored but cause is not surfaced to user immediately** - stored in memory, but not accessible until client queries status
2. **No retry mechanism** - if initialization failed, it's failed forever for this server instance
3. **Error message could be stale** - if user fixes the problem (installs Claude Code), the error is still there
4. **No indication of severity** - could be a transient failure or permanent issue

**Hidden Issues:**
1. Initialization fails but console.error doesn't indicate severity
2. User tries to chat immediately - gets "No client available" message but not why
3. User can't self-diagnose the actual initialization failure
4. Retry requires restarting the entire server

**User Impact:**
- Error is surfaced but without context
- User sees "Chat initialization failed" but no details
- Can't determine if it's missing binary, permission issue, or actual error
- Requires server restart to retry

**Recommendation:**
Enhance error context and provide retry capability:

```typescript
private async initializeChatClients(): Promise<void> {
  try {
    const clients = await detectAvailableClients();
    // ... rest of initialization
  } catch (error) {
    // Capture more detailed error context
    this.chatInitializationError = error instanceof Error ? error : new Error(String(error));
    const errorMsg = getErrorMessage(error);

    console.error("[Chat] Failed to initialize chat clients:", errorMsg);
    if (process.env.VERBOSE && error instanceof Error) {
      console.error("[Chat] Initialization error details:", error.stack);
    }

    // Suggest actions to user
    console.error("[Chat] To fix:");
    if (errorMsg.includes('Claude Code')) {
      console.error("  1. Install Claude Code: https://...");
    }
    if (errorMsg.includes('permission')) {
      console.error("  2. Check file permissions on chat binaries");
    }
    console.error("  3. Restart the server after installing");
  }
}
```

---

## Medium-Severity Issues

### MEDIUM #1: Console.error in loadSchemas Logs Raw Error and Message

**Location:** `/workspace/cli/src/server/server.ts`
- Line 2084: `console.error("Failed to load schemas:", error);`

**Severity:** MEDIUM

**Issue Description:**
The error is logged both as a string message and the raw error object:

```typescript
catch (error) {
  const errorMsg = getErrorMessage(error);
  console.error("Failed to load schemas:", error);  // Logs both
  throw new Error(`Failed to load schema files: ${errorMsg}`);
}
```

This logs the error **twice** - once as the raw object and once in the rethrown error. This is redundant and doesn't provide additional context.

**Recommendation:**
```typescript
catch (error) {
  const errorMsg = getErrorMessage(error);
  console.error(`Failed to load schemas: ${errorMsg}`);
  if (process.env.DEBUG && error instanceof Error) {
    console.error(`Stack: ${error.stack}`);
  }
  throw new Error(`Failed to load schema files: ${errorMsg}`);
}
```

---

### MEDIUM #2: WebSocket Validation Error Message Not Actionable

**Location:** `/workspace/cli/src/server/server.ts`
- Lines 1187-1192 (WebSocket message validation)

**Severity:** MEDIUM

**Issue Description:**
When WebSocket message validation fails, the client receives:

```typescript
ws.send(JSON.stringify({ error: "Invalid message format" }));
```

But doesn't include validation details. The server logs the detailed error only in DEBUG mode:

```typescript
if (process.env.DEBUG) {
  console.error("Invalid WebSocket message format:", errorMsg);
}
```

Users can't see what's wrong with their message without enabling DEBUG mode.

**Recommendation:**
```typescript
const errorDetails = validationResult.error.issues
  .map((e) => `${e.path.join('.')}: ${e.message}`)
  .join('; ');

ws.send(JSON.stringify({
  type: "error",
  message: "Invalid message format",
  details: errorDetails,  // Include validation details
}));

if (process.env.DEBUG) {
  console.error(`[WebSocket] Invalid message format: ${errorDetails}`);
}
```

---

### MEDIUM #3: File Watcher Errors Continue Silently

**Location:** `/workspace/cli/src/server/server.ts`
- Lines 2020-2043 (file watcher onChange handler)

**Severity:** MEDIUM

**Issue Description:**
When the file watcher detects changes and reloads the model, errors are caught but only logged:

```typescript
catch (error) {
  const message = getErrorMessage(error);
  console.error(`[Watcher] Failed to reload model: ${message}`);
}
```

After the error, the watcher continues but users are not notified via WebSocket that reloading failed. Clients believe the model is updated when it's actually stale.

**Recommendation:**
```typescript
catch (error) {
  const message = getErrorMessage(error);
  console.error(`[Watcher] Failed to reload model: ${message}`);

  // Notify all clients of reload failure
  const errorMessage = JSON.stringify({
    type: "model.error",
    message: `Failed to reload model after file change: ${message}`,
    timestamp: new Date().toISOString(),
  });

  for (const client of this.clients) {
    try {
      client.send(errorMessage);
    } catch (sendError) {
      console.warn(`[Watcher] Failed to notify client: ${getErrorMessage(sendError)}`);
    }
  }
}
```

---

### MEDIUM #4: Custom Viewer File Error Handling Has Generic ENOENT Check

**Location:** `/workspace/cli/src/server/server.ts`
- Lines 2739-2746 (serveCustomViewer error handling)

**Severity:** MEDIUM

**Issue Description:**
File not found is handled, but other filesystem errors are grouped together:

```typescript
catch (error) {
  if ((error as any).code === "ENOENT") {
    console.error(`[VIEWER] File not found: ${filePath}`);
    return new Response("File not found", { status: 404 });
  }
  console.error(`[VIEWER] Error serving custom viewer file ${filePath}:`, error);
  return new Response("Internal server error", { status: 500 });
}
```

Other errors (EACCES, EISDIR, ENAMETOOLONG, etc.) are all logged but returned as generic 500. Users can't distinguish between permission denied, path is directory, and other filesystem errors.

**Recommendation:**
```typescript
catch (error) {
  const errorMsg = getErrorMessage(error);
  const code = (error as any).code;

  if (code === "ENOENT") {
    console.error(`[VIEWER] File not found: ${filePath}`);
    return new Response("File not found", { status: 404 });
  }

  if (code === "EACCES" || code === "EPERM") {
    console.error(`[VIEWER] Permission denied accessing: ${filePath}`);
    return new Response("Permission denied", { status: 403 });
  }

  if (code === "EISDIR") {
    console.error(`[VIEWER] Path is a directory, not a file: ${filePath}`);
    return new Response("Path is a directory", { status: 400 });
  }

  console.error(`[VIEWER] Error serving file ${filePath}: ${errorMsg}`);
  return new Response("Internal server error", { status: 500 });
}
```

---

### MEDIUM #5: Annotation Query Validation Missing

**Location:** `/workspace/cli/src/server/server.ts`
- Lines 851-876 (getAnnotationsRoute handler)

**Severity:** MEDIUM

**Issue Description:**
The annotation filtering endpoint validates the query parameters with Zod, but there's no try-catch around the validation:

```typescript
const filter = c.req.valid("query");  // Could throw if Zod validation fails
```

If validation fails in Hono's `valid()` method, the error bubbles up unhandled.

**Recommendation:**
Ensure route handlers wrap parameter validation in try-catch, or rely on Hono's global error handler. Document error handling assumptions in route definitions.

---

## Low-Severity Issues

### LOW #1: Process Kill Failures in Multiple Locations Not Escalated

**Location:** `/workspace/cli/src/server/server.ts`
- Lines 1829-1833 (launchChat process kill)
- Lines 1974-1978 (launchCopilot process kill)
- Lines 2784-2793 (stop method process kill)

**Severity:** LOW

**Issue Description:**
When a process fails to kill, the error is logged as a warning only:

```typescript
try {
  proc.kill();
} catch (error) {
  console.warn(`[Claude Code] Failed to kill process: ${getErrorMessage(error)}`);
}
```

But the process is still added to `activeChatProcesses` and later causes issues if it's referenced. The warning should indicate that cleanup may be incomplete.

**Recommendation:**
Add tracking for kill failures:

```typescript
try {
  proc.kill();
} catch (error) {
  console.warn(`[Claude Code] Failed to kill process ${conversationId}: ${getErrorMessage(error)}. Process may still be running.`);
  // Consider leaving in map for retry or tracking
}
```

---

## Summary Table

| Issue | File | Line(s) | Severity | Category | Impact |
|-------|------|---------|----------|----------|--------|
| Unhandled promise rejection in streamOutput | server.ts | 1838, 1983 | CRITICAL | Async handling | Silent failures, hangs |
| Overly broad catch in JSON parsing | server.ts | 1756-1773 | CRITICAL | Exception handling | Masks serialization errors |
| Silent telemetry failures | server.ts | 1414-1419 | CRITICAL | Error logging | Lost observability |
| Generic chat error messages | server.ts | 1821, 1966 | HIGH | User feedback | Poor debugging |
| Missing output dir validation | generate-openapi.ts | 65-67 | HIGH | Validation | Directory not found errors |
| Generic route error handling | server.ts | multiple | HIGH | Error categorization | Can't distinguish error types |
| Bun.spawnSync not validated | server.ts | 1869-1894 | HIGH | Validation | Silent fallback |
| Chat init error not revisited | server.ts | 168-171 | HIGH | Error persistence | Can't retry |
| Duplicate error logging | server.ts | 2084 | MEDIUM | Error logging | Redundant logs |
| WebSocket validation errors | server.ts | 1187-1192 | MEDIUM | User feedback | Can't debug without DEBUG mode |
| File watcher silent errors | server.ts | 2040-2043 | MEDIUM | Notification | Stale model, no alert |
| Viewer file errors generic | server.ts | 2739-2746 | MEDIUM | Error categorization | Can't distinguish EACCES vs ENOENT |
| Process kill failures | server.ts | 1829-1833 | LOW | Cleanup tracking | Resource leaks possible |

---

## Patterns to Fix Going Forward

### Pattern 1: Always Await and Handle Background Tasks
```typescript
// BAD
someAsyncFunction();

// GOOD
someAsyncFunction().catch((error) => {
  console.error('Task failed:', getErrorMessage(error));
  // Handle cleanup/notification
});
```

### Pattern 2: Specific Catch Blocks by Error Type
```typescript
// BAD
try {
  // Multiple operations
} catch (error) {
  // One generic handler
}

// GOOD
try {
  // JSON operation
} catch (parseError) {
  if (parseError instanceof SyntaxError) {
    // Handle parse error
  } else {
    throw parseError; // Re-throw unexpected errors
  }
}
```

### Pattern 3: Log All Production Errors, Not Just Debug
```typescript
// BAD
if (process.env.DEBUG) {
  console.warn('Telemetry failed...');
}

// GOOD
console.error('Telemetry failed...'); // Always log
if (process.env.DEBUG) {
  console.error('Stack:', error.stack); // Extra details in debug
}
```

### Pattern 4: Provide Error Context in User Responses
```typescript
// BAD
return c.json({ error: message }, 500);

// GOOD
return c.json({
  error: message,
  context: { operation: 'get_model', timestamp: new Date().toISOString() },
  suggestions: ['Try again', 'Check logs for details']
}, 500);
```

---

## Compliance with CLAUDE.md Standards

This PR **violates the following standards** from CLAUDE.md:

1. **"Never silently fail in production code"** - Multiple catch blocks only log in DEBUG mode
2. **"Always log errors using appropriate logging functions"** - Some errors are only logged to console.warn
3. **"Include relevant context in error messages"** - Generic "Chat failed" messages lack context
4. **"Never use empty catch blocks"** - Not present, but broad catches are nearly as bad
5. **"Handle errors explicitly, never suppress them"** - Telemetry errors and stream failures are suppressed

---

## Recommendations Priority

1. **CRITICAL (Fix Before Merge):**
   - Add error handling to `streamOutput()` background tasks
   - Fix overly broad exception catching in JSON parsing
   - Change telemetry failures to always log (not just DEBUG mode)

2. **HIGH (Fix in Follow-up PR):**
   - Add validation before file writes
   - Enhance all error messages with context
   - Validate `Bun.spawnSync()` results before use

3. **MEDIUM (Fix When Possible):**
   - Improve WebSocket validation error messages
   - Add model reload failure notifications
   - Categorize file system errors in responses

4. **LOW (Nice to Have):**
   - Track process kill failures better
   - Remove redundant error logging

---

## Testing Recommendations

Add tests for error scenarios:

```typescript
describe('Error Handling', () => {
  test('Chat streaming errors are reported to user', async () => {
    // Simulate process.stdout.getReader() failure
    // Verify error is sent via WebSocket
  });

  test('Telemetry failures do not crash server', async () => {
    // Disable telemetry module
    // Verify WebSocket still works
  });

  test('JSON parse errors in chat output', async () => {
    // Mock process that outputs mixed JSON and non-JSON
    // Verify proper handling
  });

  test('Missing output directory for OpenAPI spec', async () => {
    // Remove docs/ directory
    // Verify clear error message
  });
});
```

