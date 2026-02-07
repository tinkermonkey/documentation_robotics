# Visualization Server Telemetry

## Overview

The visualization server sends comprehensive OpenTelemetry spans for all HTTP API requests and WebSocket operations when telemetry is enabled.

## Enabling Telemetry

Telemetry is a **compile-time feature** controlled by the `DR_TELEMETRY` environment variable:

```bash
# Build CLI with telemetry enabled
DR_TELEMETRY=true npm run build

# Then start the visualization server
dr visualize
```

## HTTP Request Telemetry

All HTTP API requests (`/api/*`) are automatically instrumented via the `telemetryMiddleware`:

### Span Name

`http.server.request`

### Attributes Captured

**Request Attributes:**

- `http.method` - HTTP method (GET, POST, PUT, PATCH, DELETE)
- `http.route` - Route pattern (e.g., `/api/annotations/:annotationId`)
- `http.url` - Full request URL
- `http.target` - Request path
- `http.user_agent` - User agent string
- `http.scheme` - Protocol (http/https)

**Response Attributes:**

- `http.status_code` - HTTP status code
- `http.duration_ms` - Request processing duration in milliseconds

**Span Status:**

- `OK` (code: 1) - Status codes 200-399
- `ERROR` (code: 2) - Status codes 400+ (includes error message)

### Log Events

**Request Start:**

- Severity: `INFO`
- Message: "Request received"
- Attributes: method, route, target

**Request Complete:**

- Severity: `INFO` (2xx-3xx) or `ERROR` (4xx-5xx)
- Message: "Request completed"
- Attributes: method, route, target, status_code, duration_ms

## WebSocket Telemetry

All WebSocket operations on `/ws` are instrumented with detailed spans:

### Connection Events

#### `ws.connection.open`

Emitted when a client connects.

**Attributes:**

- `ws.client_count` - Total number of connected clients after this connection

#### `ws.connection.close`

Emitted when a client disconnects.

**Attributes:**

- `ws.client_count` - Total number of connected clients after this disconnection

### Message Processing

#### `ws.message.received`

Emitted when a message is received from a client.

**Attributes:**

- `ws.message.type` - Message type (e.g., "subscribe", "ping", "chat.send")
- `ws.message.size_bytes` - Message size in bytes

#### `ws.message.processed`

Emitted when a message is successfully processed.

**Attributes:**

- `ws.message.type` - Message type
- `ws.message.duration_ms` - Processing duration in milliseconds
- `ws.message.status` - "success"

#### `ws.message.error`

Emitted when message processing fails.

**Attributes:**

- `ws.message.type` - Message type
- `ws.message.duration_ms` - Processing duration in milliseconds
- `ws.message.status` - "error"
- `error.message` - Error message

### Broadcast Operations

#### `ws.broadcast.start`

Emitted when starting to broadcast a message to all clients.

**Attributes:**

- `ws.broadcast.type` - Message type being broadcast
- `ws.broadcast.client_count` - Number of clients to broadcast to
- `ws.broadcast.message_size_bytes` - Message size in bytes

#### `ws.broadcast.complete`

Emitted when broadcast completes.

**Attributes:**

- `ws.broadcast.type` - Message type
- `ws.broadcast.success_count` - Number of successful sends
- `ws.broadcast.failure_count` - Number of failed sends

### Error Events

#### `ws.error`

Emitted when a WebSocket error occurs.

**Attributes:**

- `error.type` - Error type (e.g., "Error", "TypeError")
- `error.message` - Error message

## Telemetry Export

The visualization server uses the OpenTelemetry SDK configured in `cli/src/telemetry/index.ts`:

- **Protocol:** OTLP (OpenTelemetry Protocol)
- **Endpoint:** Configurable via `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable
- **Default:** `http://localhost:4318` (SigNoz/Jaeger default)

### Configuration

```bash
# Set OTLP endpoint (optional, defaults to localhost:4318)
export OTEL_EXPORTER_OTLP_ENDPOINT=http://your-collector:4318

# Build with telemetry enabled
DR_TELEMETRY=true npm run build

# Run server
dr visualize
```

## Example Telemetry Flow

### HTTP API Request

```
1. Client: GET /api/model?token=dr-123...
2. Middleware: Creates span "http.server.request"
3. Middleware: Logs "Request received"
4. Handler: Processes request
5. Middleware: Sets status_code, duration_ms
6. Middleware: Logs "Request completed"
7. Middleware: Ends span
8. OTLP: Exports span to collector
```

### WebSocket Message

```
1. Client: Sends {"type": "subscribe", "topics": ["model"]}
2. onMessage: Creates span "ws.message.received"
3. onMessage: Processes message via handleWSMessage()
4. onMessage: Creates span "ws.message.processed"
5. Server: Broadcasts model data
6. broadcastMessage: Creates span "ws.broadcast.start"
7. broadcastMessage: Sends to all clients
8. broadcastMessage: Creates span "ws.broadcast.complete"
9. OTLP: Exports all spans to collector
```

## Performance Impact

**When Telemetry is Disabled (default):**

- Zero runtime overhead
- Code is eliminated at compile time via dead branch elimination

**When Telemetry is Enabled:**

- Minimal overhead (~1-2ms per request)
- Asynchronous span export (non-blocking)
- Efficient batch exporting to collector

## Debugging

Enable verbose logging to see telemetry events:

```bash
# Build with telemetry
DR_TELEMETRY=true npm run build

# Run with debug logging
DEBUG=true dr visualize
```

This will show debug messages for span creation and export.

## Integration with Observability Platforms

### SigNoz

```bash
# SigNoz running locally
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

DR_TELEMETRY=true npm run build
dr visualize
```

### Jaeger

```bash
# Jaeger OTLP endpoint
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

DR_TELEMETRY=true npm run build
dr visualize
```

### Custom Collector

```bash
# Any OTLP-compatible collector
export OTEL_EXPORTER_OTLP_ENDPOINT=http://your-collector:4318

DR_TELEMETRY=true npm run build
dr visualize
```

## Telemetry Data Retention

The visualization server does not store telemetry data locally. All spans are:

1. Created in-memory
2. Exported to the OTLP endpoint
3. Discarded after export

Data retention is managed by your observability platform (SigNoz, Jaeger, etc.).

## Security Considerations

**Sensitive Data:**

- Auth tokens are **never** included in spans
- User agent strings are included (can be disabled if needed)
- Request URLs include paths but not query parameters with tokens

**Network:**

- OTLP export uses HTTP (can be configured for HTTPS)
- Export is one-way: server → collector only
- No data is sent to external services unless configured

## Troubleshooting

### "No spans appear in my collector"

1. Verify telemetry is enabled: `DR_TELEMETRY=true npm run build`
2. Check OTLP endpoint: `echo $OTEL_EXPORTER_OTLP_ENDPOINT`
3. Enable debug logging: `DEBUG=true dr visualize`
4. Verify collector is running and accepting OTLP on port 4318

### "Spans are missing attributes"

1. Ensure you're using the latest build: `npm run build`
2. Check that middleware is applied: Look for telemetry logs in console
3. Verify spans are ending: Check collector for partial spans

### "Performance degradation"

1. Check if telemetry is accidentally enabled in production
2. Verify collector endpoint is reachable (network latency)
3. Consider increasing export batch size in telemetry config
