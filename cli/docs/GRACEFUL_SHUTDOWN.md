# Graceful Shutdown for Visualization Server

## Overview

The visualization server (`dr visualize`) now implements graceful shutdown to ensure:

- All WebSocket connections are closed properly
- OpenTelemetry spans are flushed before exit
- Server resources are cleaned up correctly
- No data loss on Ctrl-C termination

## Signal Handling

### Parent Process (CLI)

The `dr visualize` command registers handlers for:

- **SIGINT** (Ctrl-C) - User interruption
- **SIGTERM** - Process termination signal

**Shutdown Flow:**

1. Receives signal (SIGINT or SIGTERM)
2. Forwards signal to server subprocess
3. Waits up to 3 seconds for graceful shutdown
4. Forces termination if timeout exceeded
5. Exits cleanly

### Server Subprocess

The visualization server process (`server-entry.ts`) registers handlers for:

- **SIGINT** (Ctrl-C)
- **SIGTERM** (Process termination)
- **uncaughtException** (Unhandled errors)
- **unhandledRejection** (Unhandled promise rejections)

**Shutdown Flow:**

1. Receives termination signal
2. Stops HTTP server and WebSocket connections
3. Flushes OpenTelemetry spans via `shutdownTelemetry()`
4. Exits cleanly with appropriate code

## Telemetry Integration

### Server Startup Span

The visualize command creates a `visualize.server.startup` span that tracks:

**Span Name:** `visualize.server.startup`

**Attributes:**

- `server.port` - Server port number
- `server.auth_enabled` - Whether authentication is enabled
- `server.with_danger` - Whether danger mode is enabled

**Lifecycle:**

- **Start:** When server subprocess is spawned
- **End:** When server outputs "running at http://localhost"
- **Error:** If server fails to start or exits with non-zero code

### Telemetry Flush on Shutdown

When the server receives a termination signal:

1. **Server stops** - All connections closed
2. **Telemetry shutdown** - `shutdownTelemetry()` called
   - Forces span processor flush (ensures pending exports complete)
   - Shuts down OpenTelemetry SDK
   - Shuts down logger provider
3. **Process exits** - Clean termination

This ensures all spans (HTTP requests, WebSocket events, etc.) are exported before the process terminates.

## Usage Examples

### Normal Shutdown (Ctrl-C)

```bash
$ dr visualize
✓ Visualization server started
   Access URL: http://localhost:8080?token=dr-1707...
   Auth token: dr-1707...

^C
[SIGINT] Shutting down visualization server gracefully...
Sending termination signal to server process...

[SIGINT] Shutting down visualization server...
Visualization server stopped
```

### Shutdown with Debug Logging

```bash
$ DEBUG=true dr visualize
✓ Visualization server started
   Access URL: http://localhost:8080?token=dr-1707...

^C
[SIGINT] Shutting down visualization server gracefully...
[debug] Sending termination signal to server process...
[debug] Server exited with code 0
[debug] Visualization server stopped
```

### Server Crash Handling

If the server crashes, the parent process detects it:

```bash
$ dr visualize
✓ Visualization server started
   Access URL: http://localhost:8080?token=dr-1707...

Server exited with code 1
Server output:
Error: Failed to load model
```

## Telemetry Behavior

### When Telemetry is Enabled

With `DR_TELEMETRY=true` during build:

**On Normal Shutdown (Ctrl-C):**

1. Server startup span is already ended (when server started)
2. Any active HTTP/WebSocket spans are ended
3. All spans are flushed to OTLP collector
4. Process exits after successful flush

**On Server Crash:**

1. Server startup span is ended with error status
2. Exception is recorded in span
3. Spans are flushed to OTLP collector
4. Process exits with error code

### When Telemetry is Disabled

With default build (no `DR_TELEMETRY`):

- No telemetry overhead
- Shutdown is immediate (no flush needed)
- Code is eliminated at compile time

## Implementation Details

### Parent Process (visualize.ts)

```typescript
// Register signal handlers
process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

const handleShutdown = async (signal: string) => {
  // Forward signal to server process
  serverProcess.kill(signal);

  // Wait for graceful shutdown (3s timeout)
  await waitForExit(serverProcess, 3000);

  process.exit(0);
};
```

### Server Subprocess (server-entry.ts)

```typescript
async function gracefulShutdown(exitCode: number = 0) {
  // Stop visualization server
  if (serverInstance) {
    serverInstance.stop();
  }

  // Flush telemetry
  if (isTelemetryEnabled) {
    await shutdownTelemetry();
  }

  process.exit(exitCode);
}

// Register handlers
process.on("SIGINT", () => gracefulShutdown(0));
process.on("SIGTERM", () => gracefulShutdown(0));
process.on("uncaughtException", (error) => gracefulShutdown(1));
process.on("unhandledRejection", (reason) => gracefulShutdown(1));
```

## Timeout Behavior

### Parent Process Timeout (3 seconds)

If the server subprocess doesn't exit within 3 seconds:

- Parent sends `SIGKILL` to force termination
- Parent exits after forced kill
- This prevents hanging on shutdown

**Why 3 seconds?**

- Typical telemetry flush takes < 500ms
- Server stop() is nearly instantaneous
- 3s provides comfortable margin for slow systems

### No Subprocess Timeout

The server subprocess does NOT have an internal timeout because:

- Telemetry flush must complete to avoid data loss
- In practice, shutdown completes in < 1 second
- Parent process enforces timeout via SIGKILL if needed

## Testing Graceful Shutdown

### Manual Test

```bash
# Terminal 1: Start collector (if using telemetry)
docker run -p 4318:4318 otel/opentelemetry-collector

# Terminal 2: Build with telemetry and start server
cd cli
DR_TELEMETRY=true npm run build
dr visualize

# Press Ctrl-C
^C

# Verify:
# 1. Server stops cleanly
# 2. No error messages
# 3. Spans appear in collector (if telemetry enabled)
```

### Verify Telemetry Flush

```bash
# Start server with telemetry
DR_TELEMETRY=true npm run build
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
dr visualize

# Make some requests to generate spans
curl http://localhost:8080/health
curl http://localhost:8080/api/model?token=YOUR_TOKEN

# Press Ctrl-C
^C

# Check collector for spans:
# - visualize.server.startup (ended when server started)
# - http.server.request (for /health)
# - http.server.request (for /api/model)
```

## Troubleshooting

### "Server doesn't stop on Ctrl-C"

**Cause:** Parent process killed before forwarding signal to child

**Solution:** This should not happen with the new signal handlers. If it does:

1. Check if process.on('SIGINT') handler is registered
2. Verify serverProcess.kill() is being called
3. Check server logs for shutdown messages

### "Spans are missing after Ctrl-C"

**Cause:** Telemetry not flushed before process exit

**Solution:**

1. Verify `DR_TELEMETRY=true` was set during build
2. Check that `shutdownTelemetry()` is called in server-entry.ts
3. Enable DEBUG=true to see telemetry flush logs
4. Check OTLP collector is reachable (http://localhost:4318)

### "Server hangs on shutdown"

**Cause:** Telemetry flush or server stop is blocking

**Solution:**

1. Wait up to 3 seconds - parent will force kill
2. Check server logs for errors during shutdown
3. Verify OTLP endpoint is not timing out
4. Consider increasing parent timeout if on slow system

### "Process exits with code 1 on Ctrl-C"

**Cause:** Signal handler is calling gracefulShutdown(1) instead of gracefulShutdown(0)

**Solution:** Verify SIGINT/SIGTERM handlers use exit code 0:

```typescript
process.on("SIGINT", () => gracefulShutdown(0)); // Not 1
```

## Exit Codes

| Code | Meaning        | Trigger                               |
| ---- | -------------- | ------------------------------------- |
| 0    | Clean shutdown | Ctrl-C (SIGINT), SIGTERM              |
| 1    | Server error   | Server crash, startup failure         |
| 1    | Uncaught error | uncaughtException, unhandledRejection |

## Performance Impact

**Shutdown Duration:**

- **Without telemetry:** < 50ms (immediate)
- **With telemetry:** 100-500ms (span flush)
- **Timeout limit:** 3000ms (parent enforced)

**Resource Cleanup:**

- WebSocket connections: Closed immediately
- HTTP server: Stops accepting new connections immediately
- File watchers: Cleaned up automatically
- Memory: Released on process exit

## Best Practices

1. **Always use Ctrl-C** to stop the server (not kill -9)
2. **Wait for shutdown message** before restarting
3. **Enable DEBUG** if troubleshooting shutdown issues
4. **Check collector** if spans are missing
5. **Monitor exit codes** to detect failures

## Future Enhancements

Potential improvements for graceful shutdown:

- [ ] Configurable shutdown timeout (via env var)
- [ ] Graceful WebSocket connection closure (send close frame)
- [ ] Persist in-flight spans to disk on forced shutdown
- [ ] Health check endpoint returns "shutting down" status
- [ ] Metrics for shutdown duration and success rate
