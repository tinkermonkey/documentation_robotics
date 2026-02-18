# ERROR HANDLING AUDIT REPORT

## Summary

The git diff introduces significant changes to error handling and validation across the visualization server codebase. While many improvements are present (schema validation, better error logging), there are **2 CRITICAL ISSUES** that create silent failure vulnerabilities and 3 MEDIUM severity issues that require attention.

---

## CRITICAL ISSUES

### 1. CRITICAL: Unhandled JSON.parse() Errors in WebSocket Message Handler

**Location:** `/workspace/cli/src/server/server.ts`, line 1208

**Severity:** CRITICAL - Silent failure in production message handling

**Issue Description:**

The WebSocket message handler has a JSON.parse() call that can throw exceptions, but the error is caught and handled at a higher level in a way that **obscures the root cause**:

```typescript
// Line 1208 - NO ERROR HANDLING FOR JSON.parse()
const rawMessage = JSON.parse(msgStr);

// Only then is validation applied (line 1211-1218)
const validationResult = WSMessageSchema.safeParse(rawMessage);
if (!validationResult.success) {
  const errorMsg = validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
  console.error("Invalid WebSocket message format:", errorMsg);
  ws.send(JSON.stringify({ error: "Invalid message format", details: errorMsg }));
  return;
}
```

**Why This Is Problematic:**

- If `JSON.parse()` fails (e.g., malformed JSON: `{invalid}`), it throws a `SyntaxError`
- This error is caught by the outer try-catch at line 1256, which logs it as a generic "Error handling message"
- Users and operators cannot distinguish between:
  - Invalid JSON (network corruption, client bug)
  - Invalid message schema (client implementation error)
  - Actual application errors in message handling
- The error details are lost in the generic outer catch block
- Operators cannot quickly diagnose whether the issue is client-side or server-side

**Hidden Errors:**

This catch block at line 1256 could hide:
- `SyntaxError` from JSON.parse() - malformed JSON
- `TypeError` if msgStr is not a string (type coercion failure)
- Any validation error that occurs before validation result is checked
- Any error in telemetry recording (line 1261-1266)

**User Impact:**

Users see a generic error message. Server logs only show "Error handling message" without distinguishing between parsing failures and validation failures. Makes troubleshooting network issues difficult.

**Recommendation:**

Add explicit JSON parsing error handling BEFORE validation:

```typescript
let rawMessage: any;
try {
  rawMessage = JSON.parse(msgStr);
} catch (parseError) {
  const parseErrorMsg = parseError instanceof Error ? parseError.message : String(parseError);
  console.error("Failed to parse WebSocket message JSON:", parseErrorMsg, {
    msgStr: msgStr.substring(0, 200), // First 200 chars for debugging
    messageSize: msgStr.length,
  });
  ws.send(JSON.stringify({
    error: "Invalid JSON format",
    details: "Message could not be parsed as JSON"
  }));
  return;
}

const validationResult = WSMessageSchema.safeParse(rawMessage);
if (!validationResult.success) {
  const errorMsg = validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
  console.error("Invalid WebSocket message format:", errorMsg);
  ws.send(JSON.stringify({ error: "Invalid message format", details: errorMsg }));
  return;
}
```

---

### 2. CRITICAL: JSON.parse() Without Error Handling in Schema Loading

**Location:** `/workspace/cli/src/server/server.ts`, line 2103

**Severity:** CRITICAL - Silent failure during startup/schema loading

**Issue Description:**

The recursive schema loading function performs JSON.parse() on schema files without explicit error handling:

```typescript
private async loadSchemas(): Promise<Record<string, any>> {
  const schemasPath = new URL("../schemas/bundled/", import.meta.url).pathname;
  const schemas: Record<string, any> = {};

  try {
    const fs = await import("fs/promises");
    const path = await import("path");

    const walkDirectory = async (dir: string, prefix: string = ""): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const schemaKey = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await walkDirectory(fullPath, schemaKey);
        } else if (entry.isFile() && (entry.name.endsWith(".schema.json") || entry.name.endsWith(".json"))) {
          const content = await fs.readFile(fullPath, "utf-8");
          // LINE 2103: JSON.parse() WITHOUT EXPLICIT ERROR HANDLING
          schemas[schemaKey] = JSON.parse(content);
        }
      }
    };

    await walkDirectory(schemasPath);
    return schemas;
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    console.error("Failed to load schemas:", error);
    throw new Error(`Failed to load schema files: ${errorMsg}`);
  }
}
```

**Why This Is Problematic:**

- If ANY schema file contains invalid JSON, `JSON.parse()` throws a `SyntaxError`
- The outer try-catch catches it, but users cannot tell which schema file is broken
- Error message "Failed to load schema files" is vague - doesn't identify the problematic file
- In a directory with 606 schema files (per CLAUDE.md), finding the broken one is like finding a needle in a haystack
- During development/maintenance, schema files might be partially written or corrupted
- No way to continue loading other schemas - all-or-nothing failure

**Hidden Errors:**

This catch block could hide:
- `SyntaxError` from specific schema file JSON parsing
- Which file caused the parse error (file path is lost)
- Whether it's a file I/O issue vs. JSON parsing issue
- Partial data load state (some schemas loaded, then failure)

**User Impact:**

- Entire `/api/spec` endpoint fails
- Server starts successfully but endpoints that rely on schemas fail silently
- Developers cannot identify which schema file is broken
- Zero visibility into which of 606 schema files caused the failure

**Recommendation:**

Add explicit error handling per-file with detailed context:

```typescript
const walkDirectory = async (dir: string, prefix: string = ""): Promise<void> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const schemaKey = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      await walkDirectory(fullPath, schemaKey);
    } else if (entry.isFile() && (entry.name.endsWith(".schema.json") || entry.name.endsWith(".json"))) {
      const content = await fs.readFile(fullPath, "utf-8");

      try {
        schemas[schemaKey] = JSON.parse(content);
      } catch (parseError) {
        const parseErrorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        throw new Error(
          `Failed to parse schema file ${schemaKey}: ${parseErrorMsg}`
        );
      }
    }
  }
};
```

---

## HIGH SEVERITY ISSUES

### 3. HIGH: Missing Error Details in "Start Streaming in Background" Contexts

**Location:** `/workspace/cli/src/server/server.ts`, lines 1714, 1867, 1940, 2012

**Severity:** HIGH - Stream processing errors could be silently lost

**Issue Description:**

Multiple chat client implementations (Claude Code, Copilot) start async stream processing in the background with inadequate error recovery:

```typescript
// Line 1714-1867 (Claude Code)
// Line 1940-2012 (Copilot)
const streamOutput = async () => {
  // ...stream processing logic...
};

// Start streaming in background
streamOutput();  // ❌ NO ERROR HANDLING - fire-and-forget promise
```

The function `streamOutput()` is called without awaiting it, and if it rejects, the error is lost:

```typescript
const streamOutput = async () => {
  let accumulatedText = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await stdoutReader.read();
      if (done) break;
      // ... processing ...
    }
  } catch (error) {
    // ... error handling ...
  }
};

// BUG: Promise rejection could occur here and be completely ignored
streamOutput();
```

**Why This Is Problematic:**

- Promise returned by `streamOutput()` is not awaited
- If an error occurs in the async function after the outer try-catch exits, it's lost
- No `.catch()` handler is attached to the promise
- Users see incomplete responses with no error indication
- Server logs have no trace of what happened

**Hidden Errors:**

Unhandled promise rejections could occur from:
- `stdoutReader.read()` failures
- `ws.send()` failures (WebSocket already closed)
- Stream processing errors after outer try-catch
- Race conditions in stream cleanup

**User Impact:**

- Chat responses appear incomplete without error feedback
- Users don't know if their request failed or just didn't send
- Developers see no logs when debugging stream issues

**Recommendation:**

Attach explicit error handlers to background promises:

```typescript
// Start streaming with explicit error handling
streamOutput().catch((error) => {
  const errorMsg = getErrorMessage(error);
  console.error(
    `[Claude Code] Stream processing error for conversation ${conversationId}: ${errorMsg}`
  );
  try {
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: JSONRPC_ERRORS.INTERNAL_ERROR,
          message: "Stream processing failed",
          data: { details: errorMsg },
        },
        id: requestId,
      })
    );
  } catch (sendError) {
    console.error(
      `[Claude Code] Failed to send error response: ${getErrorMessage(sendError)}`
    );
  }
  this.activeChatProcesses.delete(conversationId);
});
```

---

### 4. HIGH: Missing Error Handling in Server Startup (Bun.serve)

**Location:** `/workspace/cli/src/server/server.ts`, lines 2784-2788

**Severity:** HIGH - Server startup errors could be silently ignored

**Issue Description:**

The server start method doesn't handle potential errors from `serve()`:

```typescript
async start(port: number = 8080): Promise<void> {
  this.setupFileWatcher();

  this._server = serve({
    port,
    fetch: this.app.fetch,
    websocket,
  });

  console.log(`✓ Visualization server running at http://localhost:${port}`);
}
```

The `serve()` function could fail silently if:
- Port is already in use
- Insufficient permissions
- System resource exhaustion
- Invalid configuration

**Why This Is Problematic:**

- No error handling around `serve()` call
- If port binding fails, users see success message but server isn't actually running
- No way for callers to detect startup failure
- Promise resolves immediately, masking async failures

**Hidden Errors:**

Errors that could occur and be hidden:
- EADDRINUSE (port already in use)
- EACCES (permission denied)
- EMFILE (too many open files)
- Any Bun runtime errors during server initialization

**User Impact:**

- False positive: "Server running at port X" when it actually isn't
- Users think server started but requests fail mysteriously
- No error indication to CLI caller

**Recommendation:**

Add error handling and verify server is actually running:

```typescript
async start(port: number = 8080): Promise<void> {
  this.setupFileWatcher();

  try {
    this._server = serve({
      port,
      fetch: this.app.fetch,
      websocket,
    });

    // For Bun, serve() returns immediately, so we should verify it's actually listening
    // by checking if the server object is valid
    if (!this._server) {
      throw new Error("Failed to create server instance");
    }

    console.log(`✓ Visualization server running at http://localhost:${port}`);
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    if (errorMsg.includes("EADDRINUSE") || errorMsg.includes("port")) {
      throw new Error(
        `Failed to start server: Port ${port} is already in use. ` +
        `Try using a different port with --port option.`
      );
    }
    if (errorMsg.includes("EACCES")) {
      throw new Error(
        `Failed to start server: Permission denied to bind to port ${port}. ` +
        `Ports below 1024 require elevated privileges.`
      );
    }
    throw new Error(`Failed to start server: ${errorMsg}`);
  }
}
```

---

### 5. HIGH: Incomplete Error Details in File Serving

**Location:** `/workspace/cli/src/server/server.ts`, lines 2768-2777

**Severity:** HIGH - File serving errors don't distinguish between issue types

**Issue Description:**

The custom viewer file serving catches errors but doesn't provide sufficient context:

```typescript
try {
  // ... file reading and serving logic ...
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
    },
  });
} catch (error) {
  if ((error as any).code === "ENOENT") {
    console.error(`[VIEWER] File not found: ${filePath}`);
    return new Response("File not found", { status: 404 });
  }
  console.error(`[VIEWER] Error serving custom viewer file ${filePath}:`, error);
  return new Response("Internal server error", { status: 500 });
}
```

**Why This Is Problematic:**

- Only distinguishes between ENOENT and all other errors
- Doesn't handle permission errors, symlink attacks, or size limits
- Generic "Internal server error" response doesn't help with debugging
- No distinction between client error (bad path) vs. server error (I/O failure)
- Path traversal attacks (symlinks) could be logged as generic errors

**Hidden Errors:**

Errors being conflated in the catch-all:
- EACCES (permission denied) - security/permissions issue
- EISDIR (trying to serve directory as file) - configuration error
- EMFILE (too many open files) - system resource issue
- ENOTDIR (path component is not directory) - configuration error
- Symlink loops - security issue

**User Impact:**

- Administrators can't diagnose file serving failures
- Security issues (symlink exploits) aren't clearly logged
- Resource exhaustion issues (EMFILE) appear as generic errors

**Recommendation:**

Add explicit handling for different error types:

```typescript
try {
  // ... file reading and serving logic ...
} catch (error) {
  const errorCode = (error as any).code;

  if (errorCode === "ENOENT") {
    console.error(`[VIEWER] File not found: ${filePath}`);
    return new Response("File not found", { status: 404 });
  }

  if (errorCode === "EACCES") {
    console.error(`[VIEWER] Permission denied reading file: ${filePath}`);
    return new Response("Access denied", { status: 403 });
  }

  if (errorCode === "EISDIR") {
    console.error(`[VIEWER] Cannot serve directory as file: ${filePath}`);
    return new Response("Bad request: cannot serve directory", { status: 400 });
  }

  if (errorCode === "EMFILE") {
    console.error("[VIEWER] System file descriptor limit reached");
    return new Response("Service temporarily unavailable", { status: 503 });
  }

  const errorMsg = getErrorMessage(error);
  console.error(`[VIEWER] Error serving custom viewer file ${filePath}: ${errorMsg}`, {
    errorCode,
    errorMsg,
  });
  return new Response("Internal server error", { status: 500 });
}
```

---

## MEDIUM SEVERITY ISSUES

### 6. MEDIUM: Chat Initialization Error Not Exposed to Users

**Location:** `/workspace/cli/src/server/server.ts`, lines 182-187, 129

**Severity:** MEDIUM - Initialization errors hidden from clients

**Issue Description:**

Chat client initialization errors are stored but never exposed to clients:

```typescript
// Line 129: Stores error but never uses it
private chatInitializationError?: Error;

// Lines 182-187: Catches initialization error
this.initializeChatClients().catch((error) => {
  this.chatInitializationError = error instanceof Error ? error : new Error(String(error));
  console.error("[Chat] Failed to initialize chat clients:", error);
});
```

The stored error is never returned to clients requesting chat functionality. There's no endpoint that tells clients whether chat is available or why it failed.

**Why This Is Problematic:**

- Client receives "no chat client available" but not the reason why
- Users don't know if it's a configuration issue or a bug
- Startup errors could be permanent (wrong API key) or transient (network)
- No visibility into whether to retry or reconfigure

**User Impact:**

- Users get "chat not available" without understanding why
- Can't distinguish between misconfiguration and transient failure
- Operators can't tell clients what went wrong

**Recommendation:**

Expose initialization errors in the status endpoint:

```typescript
// In chat.status handler - include initialization error details
sendResponse({
  available: hasClient,
  initialized: !this.chatInitializationError,
  error: this.chatInitializationError
    ? {
        message: this.chatInitializationError.message,
        type: "initialization_failed",
      }
    : undefined,
});
```

---

### 7. MEDIUM: Process Kill Errors in Multiple Contexts Lack Specific Logging

**Location:** `/workspace/cli/src/server/server.ts`, lines 1607-1614, 1858-1862, 2003-2007

**Severity:** MEDIUM - Process termination failures poorly distinguished

**Issue Description:**

Multiple catch blocks log process kill failures identically:

```typescript
// Line 1607
try {
  process.kill();
  // ...
} catch (error) {
  console.warn(`[Chat] Failed to cancel process for conversation ${convId}: ${getErrorMessage(error)}`);
}

// Line 1858
try {
  proc.kill();
} catch (error) {
  console.warn(`[Claude Code] Failed to kill process for conversation ${conversationId}: ${getErrorMessage(error)}`);
}

// Line 2003
try {
  proc.kill();
} catch (error) {
  console.warn(`[Copilot] Failed to kill process for conversation ${conversationId}: ${getErrorMessage(error)}`);
}
```

**Why This Is Problematic:**

- All process termination failures logged identically
- Doesn't distinguish between:
  - Process already dead (benign)
  - Permission denied (configuration issue)
  - Signal not supported (environment issue)
- No way to distinguish "expected" failures from "unexpected" ones

**User Impact:**

- Operators can't tell if process cleanup is actually failing
- Could mask cascading resource leaks if processes aren't terminating

**Recommendation:**

Add specific handling for process kill errors:

```typescript
try {
  proc.kill();
} catch (error) {
  const errorMsg = getErrorMessage(error);

  // ESRCH = process not found (already dead, OK)
  if (errorMsg.includes("ESRCH") || errorMsg.includes("no such process")) {
    if (process.env.VERBOSE) {
      console.debug(`[Chat] Process already terminated: ${conversationId}`);
    }
  } else {
    // Unexpected error - needs investigation
    console.warn(
      `[Chat] Unexpected error terminating process for conversation ${conversationId}: ${errorMsg}`
    );
  }
}
```

---

## POSITIVE FINDINGS

The following error handling patterns are **well-implemented** and should be maintained:

### 1. Excellent: Schema Validation With User Feedback

The validation result handling properly distinguishes validation errors from processing errors:

```typescript
// Line 1211-1218
const validationResult = WSMessageSchema.safeParse(rawMessage);
if (!validationResult.success) {
  const errorMsg = validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
  console.error("Invalid WebSocket message format:", errorMsg);
  ws.send(JSON.stringify({ error: "Invalid message format", details: errorMsg }));
  return;
}
```

✅ **Why this is good:**
- Clear separation of validation errors from application logic
- Detailed error messages sent to client
- Distinguishes between format issues and other errors

### 2. Excellent: Improved Telemetry Failure Handling

Changed from silent failures to explicit logging:

```typescript
// BEFORE (lines 905-911 in main branch):
// Silently fail if telemetry is not available
if (process.env.DEBUG) {
  console.debug(`[Telemetry] Failed to record WebSocket event: ${error}`);
}

// AFTER (line 1443):
// Log telemetry failures to enable production debugging
// Always log errors (not just in DEBUG) to catch silent failures
console.warn(`[Telemetry] Failed to record WebSocket event: ${getErrorMessage(error)}`);
```

✅ **Why this is good:**
- Removes silent failures in production
- Uses consistent error message extraction
- Operational visibility for debugging telemetry issues

### 3. Excellent: Always-On Broadcast Failure Logging

Changed from conditional VERBOSE logging to unconditional warnings:

```typescript
// BEFORE (lines 862-866 in main branch):
if (process.env.VERBOSE) {
  console.warn(`[WebSocket] Failed to send message to client: ${msg}`);
}

// AFTER (line 1393):
// Always log broadcast failures for operational visibility in production
console.warn(`[WebSocket] Failed to send message to client: ${msg}`);
```

✅ **Why this is good:**
- Production visibility for network failures
- Doesn't require DEBUG/VERBOSE flags to see operational issues
- Essential for debugging client disconnection issues

### 4. Excellent: Explicit Error Handling for File Closing

Properly handles expected "already closed" errors:

```typescript
// Lines 2813-2821
try {
  client.close();
} catch (error) {
  // Only suppress expected "already closed" errors
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (!errorMessage.includes('already closed') && process.env.VERBOSE) {
    console.error(`[SERVER] Unexpected error closing WebSocket client: ${errorMessage}`);
  }
}
```

✅ **Why this is good:**
- Distinguishes expected errors from unexpected ones
- Suppresses benign errors (already closed)
- Logs unexpected errors for investigation

### 5. Excellent: OpenAPI Script Error Handling

Comprehensive error handling with stack traces:

```typescript
// Lines 80-87
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("❌ Failed to generate OpenAPI specification:", message);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}
```

✅ **Why this is good:**
- Extracts error message safely
- Includes stack trace for debugging
- Non-zero exit code signals failure to CI/build systems

### 6. Excellent: Telemetry Config Error Classification

Different error types receive tailored messages:

```typescript
// Lines 86-122 in cli/src/telemetry/config.ts
if (errorMsg.includes("EACCES") || errorMsg.includes("permission denied")) {
  // File permission errors
  process.stderr.write(`Error: Cannot read config file ${configPath} - permission denied\n`);
  // ...
} else if (
  errorMsg.includes("YAMLException") ||
  error.name === "YAMLException" ||
  // ...
) {
  // YAML parse errors
  process.stderr.write(`Error: Invalid YAML syntax in ${configPath}\n`);
  // ...
} else {
  // File encoding or other I/O errors
  process.stderr.write(`Error: Failed to load config file ${configPath}\n`);
  // ...
}
```

✅ **Why this is good:**
- Different error types get appropriate guidance
- Users understand what went wrong and how to fix it
- Actionable error messages with suggestions

---

## SUMMARY TABLE

| Issue | Location | Severity | Type | Status |
|-------|----------|----------|------|--------|
| JSON.parse() in WebSocket handler without explicit error handling | server.ts:1208 | CRITICAL | Silent failure | Needs fix |
| JSON.parse() in schema loading without file-level error handling | server.ts:2103 | CRITICAL | Silent failure | Needs fix |
| Unhandled promise in background stream processing | server.ts:1714, 1867, 1940, 2012 | HIGH | Silent failure | Needs fix |
| Missing error handling in Bun.serve() startup | server.ts:2784-2788 | HIGH | Silent failure | Needs fix |
| Incomplete file serving error categorization | server.ts:2768-2777 | HIGH | Poor diagnostics | Needs fix |
| Chat initialization errors not exposed to clients | server.ts:129, 182-187 | MEDIUM | Hidden state | Needs fix |
| Process kill errors poorly distinguished | server.ts:1607, 1858, 2003 | MEDIUM | Vague logging | Needs fix |

---

## RECOMMENDATIONS PRIORITY

1. **IMMEDIATE:** Fix critical JSON.parse() errors (Issues 1-2)
   - These are production silent failures
   - Could cause data loss or hard-to-debug issues
   - Estimated effort: 30 minutes per issue

2. **HIGH:** Add background promise error handling (Issue 3)
   - Users see incomplete responses without feedback
   - Estimated effort: 45 minutes per location

3. **HIGH:** Add server startup error handling (Issue 4)
   - Silent startup failures are difficult to debug
   - Estimated effort: 20 minutes

4. **MEDIUM:** Improve error categorization (Issues 5-7)
   - Better operational visibility
   - Estimated effort: 30 minutes each

---

## NOTES ON PROJECT STANDARDS

Per CLAUDE.md, the project explicitly forbids:
- Silent failures in production code (Issues 1-4 violate this)
- Empty catch blocks (none found, good)
- Inadequate error logging (Issues 1-2, 4 violate this)

The project uses:
- `getErrorMessage()` utility for safe error extraction (consistently used)
- `logError()` for Sentry-tracked errors (not used in new code, consider adding)
- Error IDs from `constants/errorIds.ts` (not used, consider for structured logging)

---

## FILE PATHS (ABSOLUTE)

All file paths are absolute and verified:
- `/workspace/cli/src/server/server.ts` - Main server implementation
- `/workspace/cli/src/server/schemas.ts` - Schema definitions (reviewed, appears sound)
- `/workspace/cli/scripts/generate-openapi.ts` - OpenAPI generation (reviewed, good error handling)
- `/workspace/cli/src/telemetry/config.ts` - Telemetry config (reviewed, excellent error handling)
