# Telemetry Spans Fix - Implementation Summary

## Changes Made

### 1. Periodic Telemetry Flushing (visualize.ts)

**Problem:** The `cli.execute` span never ends because the visualize command uses a keep-alive pattern that never resolves. Without periodic flushing, the span remains active but is never exported to the telemetry backend.

**Solution:** Added periodic telemetry flushing every 15 seconds using `setInterval()`.

**Location:** `cli/src/commands/visualize.ts:333-351`

**Key changes:**

- Set up `flushInterval` with 15-second periodic flush
- Clear interval on graceful shutdown
- Added comprehensive debug logging for flush events

### 2. Enhanced Telemetry Initialization Diagnostics (server-entry.ts)

**Problem:** If telemetry initialization fails in the server subprocess, it fails silently with no diagnostic output, making it impossible to debug why spans aren't being created.

**Solution:** Added try-catch error handling around `initTelemetry()` with detailed diagnostic logging.

**Location:** `cli/src/server-entry.ts:30-47`

**Key changes:**

- Wrapped `initTelemetry()` in try-catch to prevent silent failures
- Added detailed logging of OTLP endpoints (traces and logs)
- Log initialization success/failure status
- Server continues running even if telemetry fails (non-critical)

### 3. Request Span Creation Diagnostics (telemetry-middleware.ts)

**Problem:** No visibility into whether spans are being created for HTTP/WebSocket requests, making it difficult to diagnose missing spans.

**Solution:** Added comprehensive debug logging around span creation in the telemetry middleware.

**Location:** `cli/src/server/telemetry-middleware.ts:24-56`

**Key changes:**

- Log when telemetry is skipped (TELEMETRY_ENABLED=false)
- Log before and after span creation
- Report if span is null (indicating tracer not initialized)
- All logs respect DEBUG/VERBOSE environment variables

### 4. Tracer Initialization Verification (telemetry/index.ts)

**Problem:** No verification that the tracer was successfully initialized, leading to silent failures when creating spans.

**Solution:** Added diagnostic logging in both `initTelemetry()` and `startSpan()` to verify tracer state.

**Location:**

- `cli/src/telemetry/index.ts:165-169` (initTelemetry)
- `cli/src/telemetry/index.ts:218-234` (startSpan)

**Key changes:**

- Log tracer initialization status
- In `startSpan()`, log exactly why span creation was skipped:
  - `isTelemetryEnabled=false`
  - `tracer is null`
  - `cachedContext is null`
- Helps identify root cause of missing spans

## Verification Steps

### 1. Build with Telemetry Enabled

```bash
cd cli
DR_TELEMETRY=true npm run build
```

**Expected:** Build completes successfully with message `✓ Build complete (debug with telemetry)`

### 2. Run Visualize Command with Debug Flag

```bash
dr --debug visualize --viewer-path ./dist/embedded/dr-viewer-bundle --no-browser
```

**Expected console output:**

```
[DEBUG] Loading model for validation...
[DEBUG] Starting visualization server on port 8080
[DEBUG] [Telemetry] Creating visualize.server.startup span
[DEBUG] [Telemetry] Span created: success
[DEBUG] [Telemetry] Setting up periodic flush (every 15 seconds)
[DEBUG] [server] [Telemetry] SDK initialized in server subprocess
[DEBUG] [server] [Telemetry] OTLP traces endpoint: http://192.168.0.245:4318/v1/traces
[DEBUG] [server] [Telemetry] OTLP logs endpoint: http://192.168.0.245:4318/v1/logs (default)
[DEBUG] [server] [Telemetry] Enabled: true
[DEBUG] [server] ✓ Visualization server running at http://localhost:8080
✓ Visualization server started
```

### 3. Load UX and Trigger API Requests

Open `http://localhost:8080?token=...` in browser and navigate the UI.

**Expected debug output for each request:**

```
[DEBUG] [server] [HTTP] GET /api/model (full URL: http://localhost:8080/api/model)
[DEBUG] [server] [Telemetry] Creating span for http.server.request
[DEBUG] [server] [Telemetry] Span created: success
```

### 4. Wait for Periodic Flush (15+ seconds)

**Expected output:**

```
[DEBUG] [Telemetry] Periodic flush: flushing pending spans...
[DEBUG] [Telemetry] Periodic flush complete
```

### 5. Graceful Shutdown (Ctrl-C)

Press `Ctrl-C` to trigger graceful shutdown.

**Expected output:**

```
^C
[DEBUG] [SIGINT] Shutting down visualization server gracefully...
[DEBUG] [Telemetry] Stopping periodic flush
[DEBUG] Sending termination signal to server process...

[SIGINT] Shutting down visualization server...
[Telemetry] Shutting down telemetry and flushing spans...
[Telemetry] Telemetry shutdown complete
[DEBUG] Visualization server stopped
```

### 6. Verify Spans in SigNoz

Check SigNoz UI for the following spans in trace hierarchy:

```
cli.execute
├── visualize.execute
│   └── visualize.server.startup
└── (periodic flushes export this parent span)

(In subprocess - separate trace or linked via context)
http.server.request (GET /api/model)
http.server.request (GET /api/layers)
ws.connection.open
ws.message.received
...
```

## Troubleshooting

### If spans still don't appear

1. **Check DEBUG output** - Look for error messages in telemetry initialization
2. **Verify OTLP endpoint** - Ensure it matches your SigNoz collector URL
3. **Check tracer null messages** - If you see "tracer is null", initTelemetry() failed
4. **Verify build** - Ensure you built with `DR_TELEMETRY=true`
5. **Check network** - Verify OTLP collector is reachable from localhost

### Common issues

**"tracer is null" in startSpan logs:**

- Telemetry initialization failed in subprocess
- Check server-entry.ts error output
- Verify OTLP endpoint is correct

**No periodic flush messages:**

- Build was not done with `DR_TELEMETRY=true`
- Check build output for "debug with telemetry" message

**Spans appear but not linked:**

- Context propagation issue between parent and subprocess
- This is expected - subprocess may create separate trace
- Can be improved with explicit trace context propagation via environment

## Next Steps (If Still Not Working)

If spans are still missing after these fixes:

1. **Add OTLP endpoint logging** in subprocess to verify configuration
2. **Test tracer directly** with a simple test span in server-entry.ts
3. **Check OpenTelemetry SDK logs** by setting `OTEL_LOG_LEVEL=debug`
4. **Verify network connectivity** to OTLP endpoint with curl
5. **Enable circuit breaker logging** in ResilientOTLPExporter

## Build Configuration

**Environment variables for build:**

- `DR_TELEMETRY=true` - Enable telemetry code in bundle
- Without this flag, all telemetry code is eliminated as dead code

**Runtime environment variables:**

- `DEBUG=1` or `VERBOSE=1` - Enable diagnostic logging
- `DR_TELEMETRY_DEBUG=1` - Additional telemetry-specific debug logs
- `OTEL_EXPORTER_OTLP_ENDPOINT` - Override OTLP traces endpoint
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` - Override OTLP logs endpoint
- `OTEL_SERVICE_NAME` - Override service name (default: dr-cli)

## Files Modified

1. `cli/src/commands/visualize.ts` - Periodic flush
2. `cli/src/server-entry.ts` - Initialization error handling
3. `cli/src/server/telemetry-middleware.ts` - Request span diagnostics
4. `cli/src/telemetry/index.ts` - Tracer verification logging
