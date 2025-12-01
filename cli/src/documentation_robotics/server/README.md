# Visualization Server

A secure HTTP/WebSocket server for visualizing Documentation Robotics architecture models with Jupyter-style token-based authentication.

## Features

- **Secure Authentication**: Cryptographically secure token generation using Python's `secrets` module
- **Multiple Auth Methods**: Support for token in query parameters or Authorization header
- **WebSocket Support**: Real-time updates via WebSocket with authentication
- **Health Endpoint**: Unauthenticated health check for monitoring
- **Session-based Security**: Token valid only for server process lifetime

## Usage

### Starting the Server

From within a Documentation Robotics project directory:

```bash
dr visualize
```

With custom host and port:

```bash
dr visualize --host 0.0.0.0 --port 8888
```

### Output

When started, the server displays a magic link with the embedded authentication token:

```
✓ Visualization server started

╭──────────────── Open in browser ────────────────╮
│                                                  │
│  http://localhost:8080/?token=abc123xyz...      │
│                                                  │
│  Click the link above or copy it to your browser│
╰──────────────────────────────────────────────────╯

Server: localhost:8080
Model:  /path/to/model

Press Ctrl+C to stop the server
```

## Authentication

### Token Generation

Tokens are generated using `secrets.token_urlsafe(32)`, providing cryptographically secure random values suitable for authentication.

### Token Validation

The server validates tokens on:

- All HTTP requests (except `/health`)
- WebSocket upgrade handshakes

### Providing Tokens

**Query Parameter (recommended for browser access):**

```
http://localhost:8080/?token=YOUR_TOKEN_HERE
```

**Authorization Header (recommended for API clients):**

```
Authorization: Bearer YOUR_TOKEN_HERE
```

### HTTP Status Codes

- `200 OK`: Valid authentication
- `401 Unauthorized`: No token provided
- `403 Forbidden`: Invalid token provided

## API Endpoints

### `GET /`

Main visualization interface (HTML page)

**Authentication**: Required

**Response**: HTML page with visualization UI

### `GET /health`

Health check endpoint

**Authentication**: Not required

**Response**:

```json
{
  "status": "healthy"
}
```

### `GET /api/model`

Retrieve model data

**Authentication**: Required

**Response**:

```json
{
  "model_path": "/path/to/model",
  "status": "loaded"
}
```

### `WS /ws`

WebSocket connection for real-time updates

**Authentication**: Required (during handshake)

**Messages**: See [websocket_protocol.py](./websocket_protocol.py) for full protocol documentation

## Security Considerations

### Token Security

1. **Cryptographically Secure**: Uses `secrets.token_urlsafe()` for token generation
2. **Timing-Safe Comparison**: Uses `secrets.compare_digest()` to prevent timing attacks
3. **No Persistence**: Tokens are never logged or saved to disk
4. **Session Lifetime**: New token generated on each server start
5. **URL-Safe**: Tokens are safe for use in URLs and headers

### Best Practices

1. **Localhost Only**: By default, binds to `localhost` to prevent external access
2. **Temporary Access**: Tokens expire when server stops
3. **HTTPS**: Consider using HTTPS in production environments
4. **Firewall**: Ensure proper firewall rules if binding to `0.0.0.0`

## Testing

Run the test suite:

```bash
pytest tests/commands/test_visualize.py -v
```

Test coverage includes:

- Token generation and validation
- HTTP authentication middleware
- WebSocket authentication
- Invalid token handling
- Query parameter vs Authorization header
- Health endpoint without auth
- CLI command integration

## Architecture

### Components

1. **VisualizationServer** (`visualization_server.py`): Core server implementation
   - Token generation and validation
   - HTTP request handling
   - WebSocket connection management
   - Authentication middleware

2. **Visualize Command** (`commands/visualize.py`): CLI interface
   - Command-line argument parsing
   - Server lifecycle management
   - User-friendly output

3. **WebSocket Protocol** (`websocket_protocol.py`): Protocol documentation
   - Message format specification
   - Authentication flow
   - Example client code

### Flow Diagram

```
┌─────────┐                    ┌────────────┐
│  User   │                    │   Server   │
└────┬────┘                    └─────┬──────┘
     │                               │
     │  1. dr visualize             │
     ├──────────────────────────────>│
     │                               │
     │  2. Token generated           │
     │     (secrets.token_urlsafe)   │
     │<──────────────────────────────┤
     │                               │
     │  3. Magic link displayed      │
     │<──────────────────────────────┤
     │                               │
     │  4. HTTP GET /?token=xyz      │
     ├──────────────────────────────>│
     │                               │
     │  5. Validate token            │
     │     (secrets.compare_digest)  │
     │                               │
     │  6. Return HTML/JSON          │
     │<──────────────────────────────┤
     │                               │
```

## Future Enhancements

Potential improvements for future versions:

- [ ] HTTPS/TLS support
- [ ] Token expiration/renewal
- [ ] Multiple concurrent sessions
- [ ] User authentication integration
- [ ] Rate limiting
- [ ] CORS configuration
- [ ] Static file serving for advanced visualizations
- [ ] Model data caching
- [ ] Real-time model change detection
- [ ] Export visualization to PNG/SVG

## Related Files

- `visualization_server.py`: Server implementation
- `websocket_protocol.py`: WebSocket protocol documentation
- `commands/visualize.py`: CLI command
- `tests/commands/test_visualize.py`: Test suite

## License

MIT License - See repository LICENSE file for details
