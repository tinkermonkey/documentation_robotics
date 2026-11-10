# Visualization Server WebSocket Protocol

`dr visualize` serves the viewer, a REST API and a WebSocket at `/ws`. The REST routes are in
`docs/api-spec.yaml`, generated from the route schemas in `cli/src/server/server.ts`. This page
covers the WebSocket messages, which that spec doesn't describe.

Connect to `/ws` with the server's token: `?token=<token>`, the `Sec-WebSocket-Protocol` pair
`token, <token>`, or `Authorization: Bearer <token>`. The server sends `{ "type": "connected" }`.

Two kinds of message share the socket:

- **Plain messages** have a `type`. The server uses them for broadcasts.
- **JSON-RPC 2.0 messages** have `"jsonrpc": "2.0"`. The chat (DrBot) uses them.

## Plain messages

### From the client

| `type`      | Fields              | Reply                                            |
| ----------- | ------------------- | ------------------------------------------------ |
| `subscribe` | `topics` (optional) | `subscribed { topics }`, then `model { data }`   |
| `ping`      |                     | `pong`                                           |
| `annotate`  | `annotation`        | Broadcasts `annotation { data }` to every client |

### Broadcasts

The server sends these to every connected client. Each has a `timestamp`.

| `type`                   | Fields             | Sent when                                                                                                                                             |
| ------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.updated`          | `data` (the model) | A file under `documentation-robotics/model/` changed, or a changeset was committed or discarded through the API                                       |
| `changesets.updated`     | `ids`, `active`    | A file under `documentation-robotics/changesets/` changed (including the `.active` marker), or a changeset was committed or discarded through the API |
| `annotation.added`       | `annotationId`     | An annotation was created                                                                                                                             |
| `annotation.updated`     | `annotationId`     | An annotation was changed                                                                                                                             |
| `annotation.deleted`     | `annotationId`     | An annotation was deleted                                                                                                                             |
| `annotation.reply.added` | `annotationId`     | A reply was added                                                                                                                                     |

`changesets.updated` carries only what changed: `ids` is every changeset on disk and `active` is
the active changeset's id, or `null`. Fetch `GET /api/changesets` or `GET /api/changesets/:id` for
the details. File-watcher broadcasts are debounced, so a command that writes several files sends
one message. A `dr changeset create`, a `dr add` into an active changeset, or a DrBot stage, run
anywhere, reaches an open viewer this way.

```json
{
  "type": "changesets.updated",
  "ids": ["changeset-1", "changeset-2"],
  "active": "changeset-2",
  "timestamp": "2026-11-09T12:00:00.000Z"
}
```

## Chat (JSON-RPC 2.0)

### Requests

| Method        | Params                                  | Result                                          |
| ------------- | --------------------------------------- | ----------------------------------------------- |
| `chat.status` |                                         | `{ sdk_available, sdk_version, error_message }` |
| `chat.send`   | `message`, `conversation_id` (optional) | Sent when the reply ends (below)                |
| `chat.cancel` | `conversation_id` (optional)            | `{ cancelled, conversation_id }`                |

**`conversation_id`** ties sends into one conversation. On Claude Code, the first send with a new
id starts a Claude Code session (`--session-id`), and each later send with that id resumes it
(`--resume`), so DrBot remembers the conversation. A new id starts a new conversation. A send
without one runs in a fresh session, as before. Ids are strings of 1 to 200 characters. While a
reply is running, another send with the same id is refused. GitHub Copilot can't resume: the
server can't give it a session id or learn the one it makes, so each Copilot send starts fresh.

`chat.cancel` stops the named conversation's reply, or the first running reply when no id is given.

The `chat.send` result:

```json
{
  "conversation_id": "conv-1",
  "status": "complete",
  "exit_code": 0,
  "full_response": "...",
  "timestamp": "..."
}
```

`status` is `error` when the agent exited non-zero. Without `conversation_id`, the server makes one
up and returns it.

### Notifications during a reply

All carry `conversation_id` and `timestamp`.

| Method                   | Params                                                                                              | Meaning                               |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `chat.response.chunk`    | `content`, `is_final`                                                                               | Reply text                            |
| `chat.tool.invoke`       | `tool_use_id`, `tool_name`, `tool_input`, `status`, and on completion `is_error`, `result`, `error` | A tool call started, or finished      |
| `chat.response.complete` | `result`, `is_error`                                                                                | The agent's turn ended (one per send) |

Each tool call sends `chat.tool.invoke` twice, matched by `tool_use_id` (Claude Code's `tool_use`
id):

1. `status: "executing"` when the agent calls the tool.
2. `status: "completed"` or `"failed"` when its result arrives, with `is_error` and `result` (the
   tool's output). A failed call also has `error`, the output as text. A call denied at the
   permission prompt is `failed`; under `--print` nothing can approve one. A call with no result
   when the reply ends is reported `failed` then.

```json
{
  "jsonrpc": "2.0",
  "method": "chat.tool.invoke",
  "params": {
    "conversation_id": "conv-1",
    "tool_use_id": "toolu_01",
    "tool_name": "Bash",
    "tool_input": { "command": "dr list api | head" },
    "status": "failed",
    "is_error": true,
    "result": "Claude requested permissions to use Bash, but you haven't granted it yet.",
    "error": "Claude requested permissions to use Bash, but you haven't granted it yet.",
    "timestamp": "..."
  }
}
```

`chat.response.complete` is Claude Code's end-of-turn `result` event: `result` is the final answer
text. It replaces `chat.tool.result`, which carried the same event under a name that suggested a
single tool. The `chat.send` response still follows it and ends the request.

The Copilot path streams plain text only: `chat.response.chunk` and the `chat.send` result.

## Changes

- CLI 0.3.x (Unreleased): `conversation_id` on `chat.send` and `chat.cancel`; `tool_use_id`,
  `status` and per-tool completion on `chat.tool.invoke`; `chat.tool.result` renamed to
  `chat.response.complete`; new `changesets.updated` broadcast.
