# DrBot Chat Test Harness

## Overview

The `dr chat` command provides a command-line interface for testing DrBot's chat capabilities without requiring a web UI. It connects to the visualization server's WebSocket endpoint and provides an interactive REPL.

## Prerequisites

1. **Start the visualization server** in one terminal:
   ```bash
   dr visualize --port 8080
   ```

2. **Note the authentication token** from the server output (if token-based auth is enabled)

## Usage

### Basic Usage

In a separate terminal, start the chat session:

```bash
dr chat --port 8080
```

### With Authentication Token

If the server requires authentication, provide the token:

```bash
dr chat --port 8080 --token <token-from-server>
```

### Custom Host/Port

```bash
dr chat --host localhost --port 3000
```

### Resume Previous Conversation

```bash
dr chat --conversation-id abc123
```

## Chat Commands

Once in the chat session, you can use these commands:

- **Type any message** - Chat with DrBot
- `help` - Show help information
- `clear` - Clear the screen
- `exit` or `quit` - End the chat session

## DrBot Capabilities

DrBot can help you explore and modify your Documentation Robotics model:

### List Elements
```
List all services in the business layer
```

### Find Elements
```
Find the element business-service-orders
```

### Search
```
Search for elements related to authentication
```

### Trace Dependencies
```
Trace dependencies for api-endpoint-create-order
```

### Model Modifications
DrBot will delegate to the `dr-architect` agent for write operations:
```
Add a new service called user-management to the business layer
```

## Example Session

```
$ dr chat --port 8080

DrBot Chat Test Harness

Connecting to localhost:8080...
Conversation ID: 550e8400-e29b-41d4-a716-446655440000

✓ Connected to DrBot

Type your message and press Enter.
Type 'exit' or 'quit' to end the session.
Type 'help' for available commands.

You: List all services in the business layer

DrBot: I'll list all services in the business layer for you.

🔧 Tool invoked: dr_list

DrBot: I found 3 services in the business layer:

1. **business-service-orders** - Order management service
2. **business-service-payments** - Payment processing service
3. **business-service-inventory** - Inventory management service

Would you like more details about any of these services?

You: Tell me more about the orders service

DrBot: Let me look up the details for the orders service.

🔧 Tool invoked: dr_find

DrBot: The **business-service-orders** service is the core order management
service. It has the following details:

- **Layer**: Business (Layer 2)
- **Type**: Service
- **Description**: Manages customer orders and order lifecycle
- **Dependencies**:
  - business-process-order-fulfillment
  - business-process-payment-processing

This service is referenced by:
- application-service-order-api (Application Layer)
- api-endpoint-create-order (API Layer)

You: exit

Ending chat session...
Chat session ended
```

## Technical Details

### WebSocket Protocol

The chat harness uses JSON-RPC 2.0 over WebSocket:

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "chat/request",
  "params": {
    "message": "List all services",
    "conversationId": "550e8400-e29b-41d4-a716-446655440000",
    "requestId": "request-123"
  },
  "id": "request-123"
}
```

**Response (streaming):**
```json
{
  "jsonrpc": "2.0",
  "method": "chat/response",
  "params": {
    "conversationId": "550e8400-e29b-41d4-a716-446655440000",
    "text": "I found 3 services...",
    "isFinal": false
  }
}
```

**Tool Invocation:**
```json
{
  "jsonrpc": "2.0",
  "method": "chat/tool_invoke",
  "params": {
    "conversationId": "550e8400-e29b-41d4-a716-446655440000",
    "toolName": "dr_list",
    "toolInput": {"layer": "business", "element_type": "service"}
  }
}
```

**Status Update:**
```json
{
  "jsonrpc": "2.0",
  "method": "chat/status",
  "params": {
    "conversationId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed",
    "message": "Request completed",
    "totalCost": 0.0123
  }
}
```

### Error Handling

The harness handles:
- Connection failures (server not running)
- Authentication errors (invalid token)
- WebSocket errors
- JSON-RPC errors
- Interrupted sessions (Ctrl+C)

## Troubleshooting

### Connection Refused

**Problem:** `Could not connect to server at localhost:8080`

**Solution:** Make sure the visualization server is running:
```bash
dr visualize --port 8080
```

### Authentication Failed

**Problem:** WebSocket connection rejected

**Solution:** Provide the correct token from the visualization server:
```bash
dr chat --port 8080 --token <token>
```

### No Response

**Problem:** Messages sent but no response from DrBot

**Possible causes:**
1. Claude Agent SDK not installed
2. Server not configured for chat
3. Network issues

**Check server logs** in the `dr visualize` terminal for errors.

## Development

To modify the chat harness, edit:
- `src/documentation_robotics/commands/chat.py` - Main chat command
- `src/documentation_robotics/server/chat_handler.py` - Server-side handler
- `src/documentation_robotics/server/chat_protocol.py` - Protocol definitions

Run tests:
```bash
pytest tests/unit/server/test_chat_handler.py -v
```

## See Also

- [DrBot README](../DRBOT_README.md) - Full DrBot documentation
- [Chat Integration Tests](./claude-integration-tests.md) - Integration test examples
- [Visualization Server](../user-guide/visualization.md) - Server documentation
