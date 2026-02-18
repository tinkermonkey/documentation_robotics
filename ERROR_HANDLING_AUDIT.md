# Error Handling Audit Report
**Date:** 2026-02-18
**Branch:** feature/issue-307-implement-openapi-auto-generat
**Auditor:** Error Handling Audit System

## Executive Summary

This audit examines error handling in git changes on the feature branch. The codebase demonstrates **STRONG error handling practices overall**, with comprehensive logging of errors and appropriate error propagation. However, **several critical patterns present production debugging challenges** that should be addressed.

**Overall Grade:** GOOD with MEDIUM-priority issues requiring attention

---

## Critical Issues Found

### CATEGORY: Unprotected WebSocket Message Sending

**Severity:** HIGH
**Impact:** Silent failures, degraded user experience, lost data

#### Issue 1: Unprotected ws.send() in Message Handler
**Location:** `/workspace/cli/src/server/server.ts`, lines 1601-1607, 1611-1617, 1622-1627, 1640-1644
**Problem:** Multiple `ws.send()` calls in `handleWSMessage()` method execute without try-catch protection. If WebSocket connection is closed or broken between checks, messages are lost silently.

```typescript
// PROBLEMATIC: No error handling for ws.send()
case "subscribe":
  const topics = simpleMsg.topics || ["model", "annotations"];
  ws.send(JSON.stringify({
    type: "subscribed",
    topics,
    timestamp: new Date().toISOString(),
  }));  // <-- Could throw, no error handling

  const modelData = await this.serializeModel();
  ws.send(JSON.stringify({
    type: "model",
    data: modelData,
    timestamp: new Date().toISOString(),
  }));  // <-- Could throw, no error handling
  break;
```

**Hidden Errors:** This code could hide:
- WebSocket closed errors when client disconnects
- ENOMEM errors under memory pressure
- EMSGSIZE errors when message exceeds size limits
- Network write errors
- Protocol violations

**User Impact:** Clients subscribe to real-time updates but silently receive no model data. Debugging is extremely difficult because:
- Server logs show successful message handling
- No indication that message delivery failed
- Client sees disconnect/reconnect loop
- Users cannot distinguish between slow networks vs. failed delivery

**Recommendation:** Wrap all `ws.send()` calls in individual try-catch blocks that log and handle failures appropriately. Consider implementing a message queue with retry logic for critical updates.

---

#### Issue 2: Unprotected ws.send() in JSON-RPC Response Helpers
**Location:** `/workspace/cli/src/server/server.ts`, lines 1669-1675, 1680-1686
**Problem:** The `sendResponse()` and `sendError()` helper functions call `ws.send()` without error handling. These are called in critical paths for chat functionality.

```typescript
// PROBLEMATIC: Helper functions have no error handling
const sendResponse = (result: any) => {
  ws.send(
    JSON.stringify({
      jsonrpc: "2.0",
      result,
      id,
    })
  );  // <-- No error handling
};

const sendError = (code: number, message: string, data?: any) => {
  ws.send(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message, data },
      id,
    })
  );  // <-- No error handling
};
```

**Hidden Errors:** Could hide:
- Chat responses never reaching client
- Error responses lost during delivery
- Client hanging waiting for response that will never arrive

**User Impact:** Users initiate chat requests, see no response, and cannot determine if:
- Server is processing their request
- Message was lost during delivery
- Server encountered an error
- Network connection is unstable

**Recommendation:** Wrap helper functions in try-catch blocks. Consider returning success/failure status and logging all delivery failures.

---

#### Issue 3: Unprotected ws.send() in Chat Message Streaming
**Location:** `/workspace/cli/src/server/server.ts`, lines 1876-1887, 1890-1901, 1906-1916, 1923-1934, 1941-1952, 1962-1973, 1978-1987
**Problem:** The `launchClaudeCodeChat()` method sends streaming responses without error handling. Each JSON-RPC notification about chat progress can fail silently.

```typescript
// PROBLEMATIC: Chat streaming sends without error handling
ws.send(
  JSON.stringify({
    jsonrpc: "2.0",
    method: "chat.response.chunk",
    params: {
      conversation_id: conversationId,
      content: block.text,
      is_final: false,
      timestamp: new Date().toISOString(),
    },
  })
);  // <-- No error handling, silent failure
```

**Hidden Errors:** Could hide:
- Chat responses lost mid-stream
- Tool invocation notifications not delivered
- Chat completion not signaled to client
- Client left in "waiting" state indefinitely

**User Impact:** Users receive partial chat responses and don't know if more is coming. Extremely difficult to debug because the server shows successful processing but client never receives the data.

**Recommendation:** Collect messages in a buffer with confirmation feedback. Consider async message queue with delivery guarantees for chat streams.

---

#### Issue 4: Unprotected ws.send() in Copilot Chat Streaming
**Location:** `/workspace/cli/src/server/server.ts`, lines 2088-2099, 2109-2121, 2125-2134
**Problem:** Similar to Claude Code chat, Copilot chat streaming has unprotected `ws.send()` calls.

**Hidden Errors:** Same as Issue 3 - streaming responses can fail silently

**Recommendation:** Apply same fix as Issue 3 - implement error-aware message delivery.

---

### CATEGORY: Missing Error Context

**Severity:** MEDIUM
**Impact:** Difficult production debugging, incomplete error logs

#### Issue 5: Errors Without Request Context in HTTP Routes
**Location:** `/workspace/cli/src/server/server.ts`, lines 373-376, 435-437, 498-500, 543-545, 681-683, 736-738, 820-822, 904-906, 968-970
**Problem:** HTTP route error handlers log generic error messages without request-specific context. When multiple requests fail, logs become ambiguous.

```typescript
// PROBLEMATIC: No context about what operation failed
try {
  const modelData = await this.serializeModel();
  return c.json(modelData);
} catch (error) {
  const message = getErrorMessage(error);
  console.error(`[ROUTE] /api/model error: ${message}`);  // <-- Missing context
  return c.json({ error: message }, 500);
}
```

**Missing Context:**
- Request ID for correlation
- Which specific layer/element was being accessed
- User/client information
- Full stack trace (only message is logged)
- Timestamp of error (not always in logs)

**Example Ambiguous Log:**
```
[ROUTE] /api/elements/:id error: Cannot read property 'name' of undefined
[ROUTE] /api/elements/:id error: Cannot read property 'name' of undefined
[ROUTE] /api/elements/:id error: Cannot read property 'name' of undefined
```

Without context, impossible to determine:
- Which element ID caused the error
- If same element failed 3 times or 3 different elements
- If issue is reproducible or intermittent

**User Impact:** When users report API failures, support cannot debug the issue from logs alone.

**Recommendation:** Add contextual information to error logs:
```typescript
catch (error) {
  const message = getErrorMessage(error);
  const { id } = c.req.valid("param");
  console.error(`[ROUTE] /api/elements/:id error - elementId: ${id}, message: ${message}`);
  if (error instanceof Error && error.stack) {
    console.debug(`[ROUTE] Stack trace:`, error.stack);
  }
  return c.json({ error: message }, 500);
}
```

---

#### Issue 6: Incomplete Error Context in Layer Retrieval
**Location:** `/workspace/cli/src/server/server.ts`, lines 435-437
**Problem:** Layer retrieval errors don't log which layer was requested.

```typescript
// PROBLEMATIC: No indication of which layer failed
const { layerName } = c.req.valid("param");
const layer = await this.model.getLayer(layerName);
// ...
catch (error) {
  const message = getErrorMessage(error);
  return c.json({ error: message }, 500);  // <-- Which layer?
}
```

**Recommendation:** Log the layer name in error context:
```typescript
catch (error) {
  const message = getErrorMessage(error);
  console.error(`[ROUTE] /api/layers/:layerName error - layer: ${layerName}, message: ${message}`);
  return c.json({ error: message }, 500);
}
```

---

### CATEGORY: Unprotected Background Tasks

**Severity:** MEDIUM
**Impact:** Unhandled promise rejections, process crashes

#### Issue 7: Chat Stream Processing Without Central Error Handling
**Location:** `/workspace/cli/src/server/server.ts`, lines 1847-1997 (launchClaudeCodeChat)
**Problem:** The `streamOutput()` async function processes streaming data from Claude Code process. While `.catch()` handler is added at line 2000, errors within the streaming loop could accumulate or cause resource leaks.

Inside the streaming loop:
```typescript
try {
  const event = JSON.parse(line);
  // ... process event ...
} catch (parseError) {
  // Line 1920: Logs only to DEBUG, but continues processing
  if (process.env.DEBUG) {
    console.debug(`[Chat] Failed to parse JSON chunk: ${getErrorMessage(parseError)}`);
  }
  // Sends raw text - masks the parse error
  ws.send(JSON.stringify({
    // ...
  }));
}
```

**Issues:**
- JSON parse errors logged only to DEBUG, hidden in production
- Inner try-catch masks parse errors (sends as raw text instead of reporting)
- Reader errors could accumulate if not properly closed
- No resource cleanup if streaming is abandoned

**Hidden Errors:**
- Malformed responses from Claude Code
- Streaming protocol violations
- Reader exhaustion
- Memory leaks from accumulated buffers

**User Impact:** Chat functionality degradation without clear error reporting. Users see garbled responses instead of error message.

**Recommendation:** Log JSON parse errors to WARN level for production visibility. Consider stopping stream on parse errors that can't be recovered.

---

#### Issue 8: File Watcher Model Reload Errors Without Logging
**Location:** `/workspace/cli/src/server/server.ts`, lines 2169-2212
**Problem:** The file watcher's onChange handler catches model reload errors (line 2206-2209) and logs them, but doesn't continue operating the watcher. If model reload fails, subsequent file changes are silently ignored.

```typescript
// Lines 2181-2210
onChange: async (_event: string, path: string) => {
  if (process.env.VERBOSE) {
    console.log(`[Watcher] File changed: ${path}`);
  }

  try {
    // Reload model
    this.model = await Model.load(this.model.rootPath, { lazyLoad: false });

    // Broadcast update to all clients
    const modelData = await this.serializeModel();
    const message = JSON.stringify({
      type: "model.updated",
      data: modelData,
      timestamp: new Date().toISOString(),
    });

    for (const client of this.clients) {
      try {
        client.send(message);
      } catch (error) {
        const msg = getErrorMessage(error);
        console.warn(`[Watcher] Failed to send update: ${msg}`);
      }
    }
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(`[Watcher] Failed to reload model: ${message}`);
    // <-- What happens next? Watcher continues watching but model is stale
  }
},
```

**Hidden Errors:**
- Model reload failures
- Which file caused the reload to fail
- Whether all clients were updated
- Which clients failed to receive update

**User Impact:** Users work with stale model after file changes. No indication that synchronization failed. Changes they make don't reflect reality.

**Recommendation:**
- Log context about which file changed and why reload failed
- Store previous model state to detect stale state
- Consider warning clients when model is out of sync

---

### CATEGORY: Conditional Debug-Only Logging

**Severity:** MEDIUM
**Impact:** Production visibility loss, hidden debugging information

#### Issue 9: JSON Parse Error Logged Only in DEBUG Mode
**Location:** `/workspace/cli/src/server/server.ts`, lines 1918-1922
**Problem:** JSON parsing errors in chat response handling are logged only when DEBUG flag is set. In production, parse errors are silently masked by fallback behavior.

```typescript
try {
  const event = JSON.parse(line);
  // ... process event ...
} catch (parseError) {
  // PROBLEMATIC: Production-invisible error handling
  if (process.env.DEBUG) {
    console.debug(`[Chat] Failed to parse JSON chunk: ${getErrorMessage(parseError)}`);
  }
  // Fallback: treat as raw text (masks the real problem)
  ws.send(JSON.stringify({
    jsonrpc: "2.0",
    method: "chat.response.chunk",
    params: {
      conversation_id: conversationId,
      content: line + "\n",
      is_final: false,
      timestamp: new Date().toISOString(),
    },
  }));
}
```

**Why This Is a Problem:**
- Production errors are invisible without manual DEBUG flag
- Fallback behavior (treating as raw text) masks protocol violations
- Users see garbled chat responses instead of error
- Cannot investigate production chat issues from logs

**Hidden Errors:**
- Claude Code process protocol changes
- Memory issues causing truncated messages
- Encoding problems
- Version mismatches

**User Impact:** Production users with malformed chat responses, support cannot debug from logs.

**Recommendation:** Elevate to WARN level for production visibility:
```typescript
catch (parseError) {
  // Always log for production debugging
  console.warn(`[Chat] Failed to parse JSON chunk: ${getErrorMessage(parseError)}`);
  if (process.env.DEBUG && parseError instanceof Error) {
    console.debug(`[Chat] Parse error details:`, parseError.stack);
  }
  // ... send as raw text ...
}
```

---

## Well-Handled Error Cases

The following error handling patterns are exemplary:

### POSITIVE: Comprehensive Telemetry Error Handling
**Location:** `/workspace/cli/src/server/server.ts`, lines 1565-1579
**Status:** GOOD

```typescript
try {
  const { startSpan, endSpan } = await import("../telemetry/index.js");
  const span = startSpan(eventName, attributes);
  endSpan(span);
} catch (error) {
  // Always log errors (not just in DEBUG) to catch silent failures
  console.warn(`[Telemetry] Failed to record WebSocket event: ${getErrorMessage(error)}`);
}
```

**Why This Is Good:**
- Catches all telemetry failures
- Always logs (not just DEBUG)
- Clear error message
- Gracefully degrades - doesn't crash server

---

### POSITIVE: Broadcast Failure Tracking
**Location:** `/workspace/cli/src/server/server.ts`, lines 1519-1546
**Status:** GOOD

```typescript
let failureCount = 0;
for (const client of this.clients) {
  try {
    client.send(messageStr);
  } catch (error) {
    failureCount++;
    const msg = getErrorMessage(error);
    console.warn(`[WebSocket] Failed to send message to client: ${msg}`);
  }
}

// Always warn about significant broadcast failures (>10% failure rate)
if (failureCount > 0) {
  const failureRate = this.clients.size > 0 ? (failureCount / this.clients.size) * 100 : 0;
  if (failureRate >= 10 || failureCount > 5) {
    console.warn(
      `[WebSocket] Broadcast completed with ${failureCount}/${this.clients.size} client failures (${failureRate.toFixed(1)}% failure rate)`
    );
  }
}
```

**Why This Is Good:**
- Counts failures accurately
- Calculates failure rate
- Alerts on significant failures
- Non-critical failures don't crash
- Full visibility into broadcast health

---

### POSITIVE: Process Cleanup on Error
**Location:** `/workspace/cli/src/server/server.ts`, lines 1975-1996
**Status:** GOOD

```typescript
} catch (error) {
  const errorMsg = getErrorMessage(error);

  ws.send(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: JSONRPC_ERRORS.INTERNAL_ERROR,
      message: `Chat failed: ${errorMsg}`,
    },
    id: requestId,
  }));

  this.activeChatProcesses.delete(conversationId);

  try {
    proc.kill();
  } catch (error) {
    console.warn(`[Claude Code] Failed to kill process for conversation ${conversationId}: ${getErrorMessage(error)}`);
  }
}
```

**Why This Is Good:**
- Sends error response to client
- Cleans up process tracking
- Handles kill() failures gracefully
- Logs kill failures for debugging
- No resource leaks

---

### POSITIVE: WebSocket Validation with Detailed Error Messages
**Location:** `/workspace/cli/src/server/server.ts`, lines 1329-1336
**Status:** GOOD

```typescript
const validationResult = WSMessageSchema.safeParse(rawMessage);
if (!validationResult.success) {
  const errorMsg = validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
  // Always log validation errors for production debugging
  console.error("Invalid WebSocket message format:", errorMsg);
  ws.send(JSON.stringify({ error: "Invalid message format", details: errorMsg }));
  return;
}
```

**Why This Is Good:**
- Runtime validation on user input
- Detailed error message to client
- Always logs (not conditional)
- Clear error path indication
- Early rejection prevents downstream errors

---

### POSITIVE: Initialization Error Storage
**Location:** `/workspace/cli/src/server/server.ts`, lines 204-207
**Status:** GOOD

```typescript
this.initializeChatClients().catch((error) => {
  this.chatInitializationError = error instanceof Error ? error : new Error(String(error));
  console.error("[Chat] Failed to initialize chat clients:", error);
});
```

**Why This Is Good:**
- Captures initialization errors
- Stores for later status reporting
- Logs with full error
- Doesn't crash on initialization failure
- Health endpoint reports this status

---

## Summary by Category

| Category | Count | Severity | Status |
|----------|-------|----------|--------|
| Unprotected ws.send() | 4 | HIGH | REQUIRES FIX |
| Missing Error Context | 2 | MEDIUM | REQUIRES FIX |
| Unprotected Background Tasks | 2 | MEDIUM | REQUIRES FIX |
| Conditional Debug-Only Logging | 1 | MEDIUM | REQUIRES FIX |
| Exemplary Patterns | 5 | N/A | GOOD |

---

## Recommendations by Priority

### Priority 1: Critical (Production Impact)
1. **Wrap all ws.send() calls in try-catch**
   - Affects: handleWSMessage, JSON-RPC helpers, chat streaming
   - Impact: Prevents silent message loss
   - Effort: 2-3 hours

2. **Add request context to error logs**
   - Affects: All HTTP route handlers
   - Impact: Enables production debugging
   - Effort: 1-2 hours

### Priority 2: High (Debuggability)
3. **Elevate chat parse errors to WARN level**
   - Affects: Claude Code chat streaming
   - Impact: Production visibility
   - Effort: 30 minutes

4. **Add context to file watcher errors**
   - Affects: Model reload on file changes
   - Impact: Stale model detection
   - Effort: 1 hour

### Priority 3: Medium (Error Resilience)
5. **Improve chat stream error handling**
   - Affects: Streaming loop error recovery
   - Impact: Better error isolation
   - Effort: 2 hours

6. **Add resource cleanup tracking**
   - Affects: Chat processes, reader streams
   - Impact: Leak prevention
   - Effort: 1-2 hours

---

## Code Examples for Fixes

### Fix Pattern 1: Protected WebSocket Send
```typescript
// BEFORE: Unprotected
ws.send(JSON.stringify(message));

// AFTER: Protected with logging
try {
  ws.send(JSON.stringify(message));
} catch (error) {
  const msg = getErrorMessage(error);
  console.warn(`[WebSocket] Failed to send ${message.type}: ${msg}`);
  // Consider: Close connection, notify client, queue message
}
```

### Fix Pattern 2: Contextual Error Logging
```typescript
// BEFORE: Generic error
catch (error) {
  const message = getErrorMessage(error);
  console.error(`[ROUTE] Error: ${message}`);
  return c.json({ error: message }, 500);
}

// AFTER: Contextual error
catch (error) {
  const message = getErrorMessage(error);
  const { id } = c.req.valid("param");
  console.error(`[ROUTE] /api/elements/:id error - elementId: ${id}, message: ${message}`);
  if (error instanceof Error && error.stack) {
    console.debug(`[ROUTE] Stack trace:`, error.stack);
  }
  return c.json({ error: message }, 500);
}
```

### Fix Pattern 3: Debug-to-Warn Elevation
```typescript
// BEFORE: Production invisible
if (process.env.DEBUG) {
  console.debug(`Parse error: ${msg}`);
}

// AFTER: Always visible
console.warn(`Parse error: ${msg}`);
if (process.env.DEBUG && error instanceof Error) {
  console.debug(`Parse error details:`, error.stack);
}
```

---

## Compliance Notes

**Per CLAUDE.md Project Standards:**
- Empty catch blocks: NONE FOUND (Good)
- Errors without logging: 4 ISSUES FOUND (ws.send calls)
- Silent failures: 4 ISSUES FOUND (unprotected messaging)
- Fallback without user awareness: 1 ISSUE FOUND (chat parse error)
- Missing error IDs for Sentry: Not applicable for WebSocket errors (no Sentry integration in this code)

---

## Files Affected

1. `/workspace/cli/src/server/server.ts` - 8 issues found
2. `/workspace/cli/scripts/generate-openapi.ts` - No issues found (good error handling)
3. `/workspace/cli/src/server/schemas.ts` - No issues found (validation layer)
4. Test files - Good error assertion patterns

---

## Conclusion

The codebase demonstrates a **strong understanding of error handling best practices** in most areas:
- Good use of try-catch blocks
- Comprehensive logging in most paths
- Proper process cleanup
- Error propagation where appropriate

However, **WebSocket message delivery is the Achilles heel** of error handling in this codebase. The multiple unprotected `ws.send()` calls create a class of silent failures that are extremely difficult to debug. These should be addressed before moving to production.

The **missing error context** in HTTP route handlers makes production debugging harder than necessary. Adding request-specific context to error logs is a low-effort, high-impact improvement.

**Estimated effort to fix all issues: 6-8 hours**
