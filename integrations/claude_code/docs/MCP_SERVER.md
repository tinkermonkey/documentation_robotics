---
title: DR MCP Server
description: Configure an MCP client to connect to the Documentation Robotics MCP server
---

# Documentation Robotics MCP Server

`dr mcp` runs the CLI as a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio, exposing model tools (list/show/search/add/update/delete/validate/export/trace elements, changesets, chat, annotations) to any MCP-aware AI client — Claude Code included.

Annotation tools (`annotation_list`, `annotation_get`, `annotation_create`, `annotation_update`, `annotation_delete`, `annotation_reply`) mirror the capabilities of the REST server's `/api/annotations/*` endpoints. Unlike the REST server's in-memory, per-process annotation store, the MCP tools persist annotations to `documentation-robotics/annotations/` on disk, so they survive across MCP sessions.

## Tools

| Group                    | Tools                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read the model           | `model_list`, `model_show`, `model_search`, `model_trace`, `model_stats`, `model_info`, `model_validate`, `model_export`, `model_reload`                           |
| Change the model         | `model_add`, `model_update`, `model_delete`, `relationship_add`, `relationship_delete`, `gap_accept`, `gap_reopen` (accepted gaps stage only into a changeset)     |
| Look up the spec         | `spec_type`                                                                                                                                                        |
| Changesets               | `changeset_list`, `changeset_show`, `changeset_create`, `changeset_activate`, `changeset_deactivate`, `changeset_update`, `changeset_unstage`, `changeset_discard` |
| Pressure-test and verify | `changeset_brief`, `changeset_impact`, `changeset_verify`, `changeset_adopt_source_references` (copies verify's source references into the plan)                   |
| Annotations              | `annotation_list`, `annotation_get`, `annotation_create`, `annotation_update`, `annotation_delete`, `annotation_reply`                                             |
| Review                   | `review_open` (a link that opens a changeset in the viewer; reuses or starts `dr visualize`)                                                                       |
| Chat                     | `chat_launch`, `chat_status`                                                                                                                                       |

With a changeset active, the "change the model" tools stage into it, and the read tools show the model as the changeset leaves it. Committing or applying a changeset is not a tool: the human does that in the viewer or with `dr changeset commit`. `changeset_discard` deletes staged changes for good, so it needs the changeset named explicitly (id or name) and `confirm: true`.

To plan a change with these tools, use `/dr-plan` (or the `dr_change_planning` skill). The design is in [`docs/CHANGE_MODELING.md`](../../../docs/CHANGE_MODELING.md).

## Installing in Claude Code

Install the `dr` plugin once per machine. It registers the MCP server for every project and adds `/dr-plan` and the DR skills. It needs the `dr` CLI on `PATH`:

```bash
npm install -g @documentation-robotics/cli
claude plugin marketplace add tinkermonkey/documentation_robotics
claude plugin install dr@documentation-robotics
```

Inside a session, `/plugin marketplace add tinkermonkey/documentation_robotics` and `/plugin install dr@documentation-robotics` do the same.

The server serves the project the session has open: it asks Claude Code for its MCP roots (the folder the session started in) and moves there, so one registration covers every project. Tool calls can still pass `rootPath` to work on another project. From the plugin, the tools are named `mcp__plugin_dr_dr__<tool>`.

The plugin also ships the `dr:dr-architect` and `dr:dr-advisor` agents, with tool lists that use those names. See [Agents in the plugin](README.md#agents-in-the-plugin).

### Registering the server by hand

Without the plugin, add the server to a project's `.mcp.json` (or your user-scope MCP config). Name it `dr`, so its tools are `mcp__dr__<tool>`, which the `dr-architect` agent and DrBot expect:

```json
{
  "mcpServers": {
    "dr": {
      "command": "dr",
      "args": ["mcp"]
    }
  }
}
```

Other MCP clients follow the same shape: a `command`/`args` pair that launches `dr mcp`. Over stdio there is no API key: the client starts the server as your own user, and that user can already read the model files. An older config that still sets `DR_MCP_API_KEY` keeps working; the server ignores it.

## Environment

| Variable            | Effect                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DR_MCP_ROOT_PATH`  | Serve the model at this path instead of the client's roots or the working directory. An unusable path is reported on stderr and the server keeps its own directory.                           |
| `DR_CHANGESET_ONLY` | `true`/`1`/`yes`/`on` refuses model writes unless a staged changeset is active (an unrecognised value also turns it on, with a warning). DrBot sets it with `dr visualize --with-changesets`. |
| `DR_MCP_QUIET_KEY`  | HTTP transport only: don't print the API key to stderr on start.                                                                                                                              |

## HTTP transport and the API key

`dr mcp --transport http` serves MCP at `http://127.0.0.1:3100/mcp` for clients that connect over the network. HTTP clients authenticate with the API key as a bearer token (`Authorization: Bearer <key>`). The server generates the key on first launch (prompting for a storage path interactively, defaulting to `~/.dr-mcp-key` otherwise) and prints it to stderr on every launch.

To rotate the key, run `dr mcp --regenerate-key`. It overwrites the key at its existing storage path, updates `~/.dr-config.yaml` and prints the new key. Update every HTTP client afterwards.

See [cli/README.md](../../../cli/README.md#mcp-server) for the full command reference.
