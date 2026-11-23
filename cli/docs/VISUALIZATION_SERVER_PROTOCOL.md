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

| `type`                   | Fields                      | Sent when                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.updated`          | `data` (the model)          | A file under `documentation-robotics/model/` changed, or a changeset was committed or discarded through the API                                                                                                                                                                                                                             |
| `changesets.updated`     | `ids`, `active`             | A file under `documentation-robotics/changesets/` changed (including the `.active` marker), a changeset was committed, discarded or reviewed (`PUT /api/changesets/:id/review`) through the API, or the model was reloaded after a file under `documentation-robotics/model/` changed (a base change moves each staged changeset's `drift`) |
| `annotation.added`       | `annotationId`, `elementId` | An annotation was created, through the API or by another process (the MCP annotation tools)                                                                                                                                                                                                                                                 |
| `annotation.updated`     | `annotationId`              | An annotation was changed (content, tags, resolved), through the API or by another process                                                                                                                                                                                                                                                  |
| `annotation.deleted`     | `annotationId`              | An annotation was deleted, through the API or by another process                                                                                                                                                                                                                                                                            |
| `annotation.reply.added` | `annotationId`, `replyId`   | A reply was added, through the API or by another process                                                                                                                                                                                                                                                                                    |

`changesets.updated` carries only what changed: `ids` is every changeset on disk and `active` is
the active changeset's id, or `null`. Fetch `GET /api/changesets` or `GET /api/changesets/:id` for
the details. File-watcher broadcasts are debounced, so a command that writes several files sends
one message. A base model write reloads the model once per file event and then sends one
`changesets.updated` when the reloads settle: read a changeset's `drift` after that message, not
between it and the `model.updated` before it. A `dr changeset create`, a `dr add` into an active changeset, or a DrBot stage, run
anywhere, reaches an open viewer this way.

### Changeset review

The viewer reviews a staged changeset change by change. `GET /api/changesets/:id` carries
`revision` (the changeset's `nextSequenceNumber`), `origin` (`chat`, `plan`, `extract` or `cli`;
absent on older changesets), `unstaged` (the unstage and rewrite tombstones) and `review` (the
verdicts, keyed by sequence number); each staged `delete` lists its `blockers`, the relationships
that still name the element. Both `GET /api/changesets` and `GET /api/changesets/:id` carry `drift`,
checked on the read with no commit attempt: a `state` (`none`, `content-free`, `drifted`,
`not-applicable`, `unknown`), `blocksCommit` (true exactly when the commit below would answer 409
for drift) and a `message`; the changeset's own endpoint adds what changed (`overlapping`,
`baseChanges`) when the base's hash did. `PUT /api/changesets/:id/review` sets or clears verdicts (`keep`,
`drop`, `ask`, or `null`), stored in the changeset's `review.yaml`. `POST /api/changesets/:id/commit`
takes an optional `{ drop, deleteBlockedLinks }`: the dropped changes, and the changes that depend on
an element a dropped add creates, are unstaged and left out; a delete with blockers is refused (422,
with `blockers`) unless it is in `deleteBlockedLinks`. Without either field the commit is unchanged.
See `docs/api-spec.yaml` for the shapes.

Annotations are files under `documentation-robotics/annotations/`, shared with the MCP
`annotation_*` tools. The server watches them and sends the `annotation.*` broadcast for each
change another process makes, the same message its own API sends, once. Fetch
`GET /api/annotations` (or `?elementId=`) and `GET /api/annotations/:id/replies` for the content.

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

| Method        | Params                                  | Result                                                           |
| ------------- | --------------------------------------- | ---------------------------------------------------------------- |
| `chat.status` |                                         | `{ sdk_available, sdk_version, error_message, permission_mode }` |
| `chat.send`   | `message`, `conversation_id` (optional) | Sent when the reply ends (below)                                 |
| `chat.cancel` | `conversation_id` (optional)            | `{ cancelled, conversation_id }`                                 |

**`conversation_id`** ties sends into one conversation. On Claude Code, the first send with a new
id starts a Claude Code session (`--session-id`), and each later send with that id resumes it
(`--resume`), so DrBot remembers the conversation. A new id starts a new conversation. A send
without one runs in a fresh session, as before. Ids are strings of 1 to 200 characters. A
conversation runs one reply at a time: until the agent process for the current reply has exited,
including after a cancel, another send with the same id is refused (`-32602`). If Claude Code
already has the session (an earlier send died before the server saw it start), the server resumes
it instead of failing. GitHub Copilot can't resume: the server can't give it a session id or learn
the one it makes, so each Copilot send starts fresh.

`chat.cancel` stops the named conversation's reply, or the first running reply when no id is given.
After the cancel response, the server sends no more notifications for that reply (no text and no
`failed` tool updates), so none can land on the client's next turn. The cancelled `chat.send`
still gets its response, with `status: "error"`.

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

At most `DR_DRBOT_MAX_TURNS` replies (default 3) run at once in one server process, across every
checkout it serves. A send over the cap waits: the server sends `chat.turn.queued` and a quoted line
of reply text saying so, then `chat.turn.started` and another quoted line when the reply starts. A
queued send can be cancelled like a running one; its `chat.send` then gets an error. A send whose
checkout is removed while it waits gets an error too.

### Notifications during a reply

All carry `conversation_id` and `timestamp`.

| Method                   | Params                                                                                                                                                               | Meaning                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `chat.response.chunk`    | `content`, `is_final`                                                                                                                                                | Reply text                            |
| `chat.tool.invoke`       | `tool_use_id`, `tool_name`, `tool_input`, `status`, and on completion `is_error`, `result`, `error`; on a refusal also `permission_denied`, `permission_explanation` | A tool call started, or finished      |
| `chat.response.complete` | `result`, `is_error`                                                                                                                                                 | The agent's turn ended (one per send) |
| `chat.turn.queued`       | `position`, `running`, `max_turns`, `message`                                                                                                                        | The send waits for a running reply    |
| `chat.turn.started`      | `waited_ms`                                                                                                                                                          | A queued send's reply starts          |

Each tool call sends `chat.tool.invoke` twice, matched by `tool_use_id` (Claude Code's `tool_use`
id):

1. `status: "executing"` when the agent calls the tool.
2. `status: "completed"` or `"failed"` when its result arrives, with `is_error` and `result` (the
   tool's output). A failed call also has `error`, the output as text. A call denied at the
   permission prompt is `failed`; under `--print` nothing can approve one. A call with no result
   when the reply ends is reported `failed` then, unless the reply was cancelled.

A call the chat agent's permissions refused also has `permission_denied: true` and
`permission_explanation`: which rule refused it, that nobody was asked to approve it, how the
person allows it, and that the allowlist comes from how `dr visualize` was started. `error` is
Claude Code's own text, a blank line, then that explanation; `result` is left as Claude Code sent
it. If the refusal's wording isn't recognised when the result arrives, the call is reported
`failed` without these fields, then once more with them when the turn's `result` event lists it.

`chat.status`'s `permission_mode` is `"changesets"` (the default: the agent stages changes in a
changeset), `"read-safe"` (`--read-only`) or `"danger"` (`--with-danger`). It is fixed when the
viewer starts. GitHub Copilot has no changeset staging, so it reports `"read-safe"` unless the
viewer runs with `--with-danger`.

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
    "error": "Claude requested permissions to use Bash, but you haven't granted it yet.\n\nBlocked by DrBot's permissions (changeset staging mode): ...",
    "permission_denied": true,
    "permission_explanation": "Blocked by DrBot's permissions (changeset staging mode): ...",
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
  `chat.response.complete`; new `changesets.updated` broadcast; annotations are stored on disk,
  and changes other processes make are broadcast.
- CLI 0.7.0: `permission_mode` on `chat.status`; `permission_denied` and `permission_explanation`
  on a refused `chat.tool.invoke`, whose `error` now ends with the explanation.
- CLI 0.8.0 (Unreleased): `chat.turn.queued` and `chat.turn.started` for a send over the running-reply
  cap (`DR_DRBOT_MAX_TURNS`); each reply runs in the checkout it belongs to.
