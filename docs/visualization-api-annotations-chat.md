# Visualization Server API Documentation - Annotations & Chat

This document provides comprehensive API documentation for the **Annotations** and **Chat** functionalities in the Documentation Robotics CLI visualization server.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Annotations API](#annotations-api)
  - [REST Endpoints](#annotations-rest-endpoints)
  - [WebSocket Messages](#annotations-websocket-messages)
- [Chat API](#chat-api)
  - [JSON-RPC 2.0 Protocol](#json-rpc-20-protocol)
  - [Chat Methods](#chat-methods)
- [Error Handling](#error-handling)
- [Examples](#examples)

---

## Overview

The visualization server provides two main interactive features:

1. **Annotations**: Comment and feedback system for model elements
2. **Chat**: AI-powered chat interface using Claude via JSON-RPC 2.0 over WebSocket

Both features use a combination of REST APIs and WebSocket messaging for real-time updates.

---

## Authentication

All API endpoints (except `/health`) require authentication using one of these methods:

1. **httpOnly Cookie** (primary, automatic)
2. **Query Parameter**: `?token=YOUR_TOKEN`
3. **Authorization Header**: `Authorization: Bearer YOUR_TOKEN`

The server automatically upgrades token-based auth to cookie-based sessions.

---

## Annotations API

The Annotations API allows users to add, view, update, and delete comments on model elements. Changes are broadcast in real-time to all connected WebSocket clients.

### Annotations REST Endpoints

#### 1. Get All Annotations

Retrieve all annotations or filter by element.

**Endpoint**: `GET /api/annotations`

**Query Parameters**:

- `elementId` (optional): Filter annotations for a specific element (e.g., `motivation.goal.deliver-value`)

**Request**:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8080/api/annotations?elementId=motivation.goal.example"
```

**Response** (`200 OK`):

```json
{
  "annotations": [
    {
      "id": "ann-abc123",
      "elementId": "motivation.goal.example",
      "author": "john.doe",
      "content": "This goal needs more clarification",
      "createdAt": "2025-12-22T10:30:00Z",
      "resolved": false,
      "parentId": null
    },
    {
      "id": "ann-def456",
      "elementId": "motivation.goal.example",
      "author": "jane.smith",
      "content": "Agreed, let's discuss in the next meeting",
      "createdAt": "2025-12-22T11:15:00Z",
      "resolved": false,
      "parentId": "ann-abc123"
    }
  ]
}
```

---

#### 2. Create Annotation

Add a new annotation to a model element.

**Endpoint**: `POST /api/annotations`

**Request Body**:

```json
{
  "elementId": "motivation.goal.deliver-value",
  "content": "This goal aligns well with our business strategy",
  "author": "john.doe"
}
```

**Request**:

```bash
curl -X POST "http://localhost:8080/api/annotations" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "elementId": "motivation.goal.deliver-value",
    "content": "This goal aligns well with our business strategy",
    "author": "john.doe"
  }'
```

**Response** (`201 Created`):

```json
{
  "id": "ann-xyz789",
  "elementId": "motivation.goal.deliver-value",
  "author": "john.doe",
  "content": "This goal aligns well with our business strategy",
  "createdAt": "2025-12-22T12:00:00Z",
  "resolved": false
}
```

**WebSocket Broadcast**: All connected clients receive:

```json
{
  "type": "annotation.added",
  "annotationId": "ann-xyz789",
  "elementId": "motivation.goal.deliver-value",
  "timestamp": "2025-12-22T12:00:00Z"
}
```

**Error Responses**:

- `400 Bad Request`: Missing required fields (`elementId`, `content`, or `author`)
- `500 Internal Server Error`: Annotation system not initialized

---

#### 3. Update Annotation

Modify an existing annotation.

**Endpoint**: `PUT /api/annotations/{annotationId}`

**Request Body**:

```json
{
  "content": "Updated annotation text",
  "tags": ["important", "review"]
}
```

**Request**:

```bash
curl -X PUT "http://localhost:8080/api/annotations/ann-xyz789" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Updated annotation text with more details",
    "tags": ["important", "review"]
  }'
```

**Response** (`200 OK`):

```json
{
  "id": "ann-xyz789",
  "elementId": "motivation.goal.deliver-value",
  "author": "john.doe",
  "content": "Updated annotation text with more details",
  "createdAt": "2025-12-22T12:00:00Z",
  "updatedAt": "2025-12-22T14:30:00Z",
  "tags": ["important", "review"]
}
```

**WebSocket Broadcast**: All connected clients receive:

```json
{
  "type": "annotation.updated",
  "annotationId": "ann-xyz789",
  "timestamp": "2025-12-22T14:30:00Z"
}
```

**Error Responses**:

- `400 Bad Request`: Missing annotation ID
- `404 Not Found`: Annotation not found
- `500 Internal Server Error`: Update failed

---

#### 4. Delete Annotation

Remove an annotation.

**Endpoint**: `DELETE /api/annotations/{annotationId}`

**Request**:

```bash
curl -X DELETE "http://localhost:8080/api/annotations/ann-xyz789" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response** (`204 No Content`):
No response body on success.

**WebSocket Broadcast**: All connected clients receive:

```json
{
  "type": "annotation.deleted",
  "annotationId": "ann-xyz789",
  "timestamp": "2025-12-22T15:00:00Z"
}
```

**Error Responses**:

- `400 Bad Request`: Missing annotation ID
- `404 Not Found`: Annotation not found
- `500 Internal Server Error`: Delete failed

---

### Annotations WebSocket Messages

The WebSocket interface (`ws://localhost:8080/ws`) allows real-time annotation interactions.

#### Subscribe to Annotation Updates

**Client → Server**:

```json
{
  "type": "subscribe",
  "topics": ["annotations"]
}
```

**Server → Client**:

```json
{
  "type": "subscribed",
  "topics": ["annotations"]
}
```

---

#### Add Annotation (WebSocket)

**Client → Server**:

```json
{
  "type": "annotation_add",
  "data": {
    "entity_uri": "motivation.goal.deliver-value",
    "message": "Great goal!",
    "user": "john.doe"
  }
}
```

**Server → All Clients**:

```json
{
  "type": "annotation_added",
  "timestamp": "2025-12-22T12:00:00Z",
  "data": {
    "id": "ann-abc123",
    "entity_uri": "motivation.goal.deliver-value",
    "user": "john.doe",
    "message": "Great goal!",
    "parent_id": null
  }
}
```

---

#### Reply to Annotation (WebSocket)

**Client → Server**:

```json
{
  "type": "annotation_reply",
  "data": {
    "parent_id": "ann-abc123",
    "message": "I agree completely",
    "user": "jane.smith"
  }
}
```

**Server → All Clients**:

```json
{
  "type": "annotation_reply_added",
  "timestamp": "2025-12-22T12:05:00Z",
  "data": {
    "id": "ann-def456",
    "entity_uri": "motivation.goal.deliver-value",
    "user": "jane.smith",
    "message": "I agree completely",
    "parent_id": "ann-abc123"
  }
}
```

---

## Chat API

The Chat API enables conversational interactions with DrBot (Claude-powered AI assistant) via JSON-RPC 2.0 over WebSocket.

### JSON-RPC 2.0 Protocol

All chat messages follow the JSON-RPC 2.0 specification:

- **Request**: Client sends method call with `id`
- **Notification**: Server sends updates without `id` (no response expected)
- **Response**: Server replies with `result` or `error`, matching request `id`

**Required**: All chat messages must include `"jsonrpc": "2.0"`

---

### Chat Methods

#### 1. Check Chat Status

Query the availability of the Anthropic SDK and DrBot.

**Method**: `chat.status`

**Client → Server**:

```json
{
  "jsonrpc": "2.0",
  "method": "chat.status",
  "id": "status-1"
}
```

**Server → Client**:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "sdk_available": true,
    "sdk_version": "0.8.1",
    "error_message": null
  },
  "id": "status-1"
}
```

**Error Response** (SDK not installed):

```json
{
  "jsonrpc": "2.0",
  "result": {
    "sdk_available": false,
    "sdk_version": null,
    "error_message": "Anthropic SDK not installed"
  },
  "id": "status-1"
}
```

---

#### 2. Send Chat Message

Send a message to DrBot and receive a streaming response.

**Method**: `chat.send`

**Client → Server**:

```json
{
  "jsonrpc": "2.0",
  "method": "chat.send",
  "params": {
    "message": "What are the goals in the motivation layer?"
  },
  "id": "msg-1"
}
```

**Server → Client** (Streaming Response):

1. **Text Chunks** (as response is generated):

```json
{
  "jsonrpc": "2.0",
  "method": "chat.response.chunk",
  "params": {
    "conversation_id": "conv-abc123",
    "content": "The motivation layer contains ",
    "is_final": false,
    "timestamp": "2025-12-22T12:00:00Z"
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "method": "chat.response.chunk",
  "params": {
    "conversation_id": "conv-abc123",
    "content": "three main goals: deliver-value, improve-quality, and enhance-performance.",
    "is_final": false,
    "timestamp": "2025-12-22T12:00:01Z"
  }
}
```

2. **Tool Invocation** (if DrBot uses a tool):

```json
{
  "jsonrpc": "2.0",
  "method": "chat.tool.invoke",
  "params": {
    "conversation_id": "conv-abc123",
    "tool_name": "search_model",
    "tool_input": {
      "query": "motivation layer goals"
    },
    "status": "executing",
    "timestamp": "2025-12-22T12:00:02Z"
  }
}
```

3. **Completion** (final response):

```json
{
  "jsonrpc": "2.0",
  "result": {
    "conversation_id": "conv-abc123",
    "status": "complete",
    "total_cost_usd": 0.0024,
    "timestamp": "2025-12-22T12:00:05Z"
  },
  "id": "msg-1"
}
```

**Error Responses**:

- **SDK Not Available**:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32001,
    "message": "Anthropic SDK not available. Install with: pip install anthropic"
  },
  "id": "msg-1"
}
```

- **Empty Message**:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Message cannot be empty"
  },
  "id": "msg-1"
}
```

- **Timeout**:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Request timed out"
  },
  "id": "msg-1"
}
```

---

#### 3. Cancel Chat Operation

Cancel an ongoing chat request.

**Method**: `chat.cancel`

**Client → Server**:

```json
{
  "jsonrpc": "2.0",
  "method": "chat.cancel",
  "params": {},
  "id": "cancel-1"
}
```

**Server → Client**:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "cancelled": true,
    "conversation_id": "conv-abc123"
  },
  "id": "cancel-1"
}
```

If no active operation:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "cancelled": false,
    "conversation_id": "conv-abc123"
  },
  "id": "cancel-1"
}
```

---

## Error Handling

### HTTP Status Codes

- `200 OK`: Successful request
- `201 Created`: Resource created successfully
- `204 No Content`: Successful deletion
- `400 Bad Request`: Invalid request (missing fields, invalid JSON)
- `401 Unauthorized`: No authentication token provided
- `403 Forbidden`: Invalid authentication token
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

### JSON-RPC Error Codes

| Code     | Meaning             | Description                  |
| -------- | ------------------- | ---------------------------- |
| `-32700` | Parse Error         | Invalid JSON received        |
| `-32600` | Invalid Request     | Invalid JSON-RPC format      |
| `-32601` | Method Not Found    | Method does not exist        |
| `-32602` | Invalid Params      | Invalid method parameters    |
| `-32603` | Internal Error      | Server internal error        |
| `-32001` | SDK Unavailable     | Anthropic SDK not installed  |
| `-32002` | Operation Cancelled | User cancelled the operation |

---

## Examples

### Complete Annotation Workflow

```javascript
// 1. Connect to WebSocket
const ws = new WebSocket("ws://localhost:8080/ws?token=YOUR_TOKEN");

// 2. Subscribe to annotations
ws.send(
  JSON.stringify({
    type: "subscribe",
    topics: ["annotations"],
  })
);

// 3. Add annotation via REST
fetch("http://localhost:8080/api/annotations", {
  method: "POST",
  headers: {
    Authorization: "Bearer YOUR_TOKEN",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    elementId: "business.capability.payment-processing",
    content: "Need to add fraud detection capability",
    author: "product.manager",
  }),
})
  .then((res) => res.json())
  .then((annotation) => {
    console.log("Created:", annotation);
    // All connected clients receive real-time update via WebSocket
  });

// 4. Listen for broadcasts
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "annotation.added") {
    console.log("New annotation:", message.annotationId);
    // Fetch full annotation details if needed
  }
};
```

---

### Complete Chat Workflow

```javascript
// 1. Connect to WebSocket
const ws = new WebSocket("ws://localhost:8080/ws?token=YOUR_TOKEN");

let requestId = 1;
let conversationId = null;

// 2. Check chat status
ws.send(
  JSON.stringify({
    jsonrpc: "2.0",
    method: "chat.status",
    id: `status-${requestId++}`,
  })
);

// 3. Send chat message
ws.send(
  JSON.stringify({
    jsonrpc: "2.0",
    method: "chat.send",
    params: {
      message: "What capabilities are in the business layer?",
    },
    id: `msg-${requestId++}`,
  })
);

// 4. Handle responses
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  // Status response
  if (message.id?.startsWith("status")) {
    console.log("SDK Available:", message.result.sdk_available);
  }

  // Streaming text chunks
  if (message.method === "chat.response.chunk") {
    conversationId = message.params.conversation_id;
    process.stdout.write(message.params.content);
  }

  // Tool invocation
  if (message.method === "chat.tool.invoke") {
    console.log("\n[Tool]:", message.params.tool_name);
  }

  // Completion
  if (message.id?.startsWith("msg") && message.result) {
    console.log("\n[Done] Cost:", message.result.total_cost_usd);
  }

  // Error
  if (message.error) {
    console.error("Error:", message.error.message);
  }
};

// 5. Cancel if needed
setTimeout(() => {
  ws.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "chat.cancel",
      params: {},
      id: `cancel-${requestId++}`,
    })
  );
}, 5000);
```

---

### Python Example: Annotations

```python
import requests
import json

BASE_URL = 'http://localhost:8080'
TOKEN = 'YOUR_TOKEN'

headers = {
    'Authorization': f'Bearer {TOKEN}',
    'Content-Type': 'application/json'
}

# Create annotation
response = requests.post(
    f'{BASE_URL}/api/annotations',
    headers=headers,
    json={
        'elementId': 'application.service.auth-service',
        'content': 'Consider using OAuth 2.0',
        'author': 'security.team'
    }
)

annotation = response.json()
print(f"Created annotation: {annotation['id']}")

# Get all annotations for an element
response = requests.get(
    f'{BASE_URL}/api/annotations',
    headers=headers,
    params={'elementId': 'application.service.auth-service'}
)

annotations = response.json()['annotations']
print(f"Found {len(annotations)} annotations")

# Update annotation
response = requests.put(
    f'{BASE_URL}/api/annotations/{annotation["id"]}',
    headers=headers,
    json={
        'content': 'Consider using OAuth 2.0 with PKCE for mobile clients'
    }
)

updated = response.json()
print(f"Updated: {updated['content']}")

# Delete annotation
response = requests.delete(
    f'{BASE_URL}/api/annotations/{annotation["id"]}',
    headers=headers
)

print(f"Deleted: {response.status_code == 204}")
```

---

### Python Example: Chat with WebSocket

```python
import asyncio
import websockets
import json

async def chat_with_drbot():
    uri = "ws://localhost:8080/ws?token=YOUR_TOKEN"

    async with websockets.connect(uri) as websocket:
        # Check status
        await websocket.send(json.dumps({
            "jsonrpc": "2.0",
            "method": "chat.status",
            "id": "status-1"
        }))

        status = json.loads(await websocket.recv())
        if not status['result']['sdk_available']:
            print("Chat not available:", status['result']['error_message'])
            return

        # Send message
        await websocket.send(json.dumps({
            "jsonrpc": "2.0",
            "method": "chat.send",
            "params": {
                "message": "List all elements in the technology layer"
            },
            "id": "msg-1"
        }))

        # Receive streaming response
        full_response = ""
        async for message in websocket:
            data = json.loads(message)

            # Handle text chunks
            if data.get('method') == 'chat.response.chunk':
                content = data['params']['content']
                print(content, end='', flush=True)
                full_response += content

            # Handle completion
            elif 'result' in data and data.get('id') == 'msg-1':
                print(f"\n\nCost: ${data['result']['total_cost_usd']:.4f}")
                break

            # Handle errors
            elif 'error' in data:
                print(f"Error: {data['error']['message']}")
                break

asyncio.run(chat_with_drbot())
```

---

## WebSocket Connection Lifecycle

```
Client                                    Server
  |                                         |
  |--- Connect: ws://localhost:8080/ws ---->|
  |<------ connected (with version) --------|
  |                                         |
  |--- subscribe (topics) ------------------>|
  |<------ subscribed ----------------------|
  |                                         |
  |--- annotation_add / chat.send --------->|
  |<------ updates/chunks ------------------|
  |<------ broadcast to all clients --------|
  |                                         |
  |--- ping ------------------------------- >|
  |<------ pong ----------------------------|
  |                                         |
  |--- Close connection ------------------->|
  |<------ Connection closed ---------------|
```

---

## Notes for UX Team

### Annotations UI Considerations

1. **Real-time Updates**: All annotation changes broadcast immediately
2. **Threading**: Replies have `parent_id` for conversation threads
3. **Author Display**: Use `author` field for user attribution
4. **Timestamps**: All timestamps in ISO 8601 format (UTC)
5. **Element Context**: Link annotations to specific model elements via `elementId`

### Chat UI Considerations

1. **Streaming**: Display text chunks as they arrive for responsive UX
2. **Tool Visibility**: Show tool invocations to indicate AI is "working"
3. **Cost Display**: Optionally show API cost to users
4. **Cancellation**: Provide cancel button for long-running requests
5. **Error Handling**: Display friendly error messages from error codes
6. **Conversation History**: Maintain client-side history for context
7. **SDK Status**: Check availability before enabling chat features

### Performance Notes

- **Annotation Caching**: Server caches initial state for fast reconnections
- **Broadcast Filtering**: Clients only receive updates for subscribed topics
- **Debounced Updates**: Model file changes debounced to prevent spam
- **Session Management**: Each WebSocket maintains separate chat session

---

## Support

For implementation questions or issues:

- Check server logs for detailed error messages
- Verify authentication tokens are valid
- Ensure Anthropic SDK installed for chat: `pip install anthropic`
- Test endpoints with `curl` or Postman before integrating

**Server Version**: Check `/health` endpoint for version info
**API Version**: Included in WebSocket `connected` message
