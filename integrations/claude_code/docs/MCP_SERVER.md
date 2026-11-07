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
| Change the model         | `model_add`, `model_update`, `model_delete`, `relationship_add`, `relationship_delete`                                                                             |
| Look up the spec         | `spec_type`                                                                                                                                                        |
| Changesets               | `changeset_list`, `changeset_show`, `changeset_create`, `changeset_activate`, `changeset_deactivate`, `changeset_update`, `changeset_unstage`, `changeset_discard` |
| Pressure-test and verify | `changeset_brief`, `changeset_impact`, `changeset_verify`                                                                                                          |
| Annotations              | `annotation_list`, `annotation_get`, `annotation_create`, `annotation_update`, `annotation_delete`, `annotation_reply`                                             |
| Chat                     | `chat_launch`, `chat_status`                                                                                                                                       |

With a changeset active, the "change the model" tools stage into it, and the read tools show the model as the changeset leaves it. Committing or applying a changeset is not a tool: the human does that in the viewer or with `dr changeset commit`. `changeset_discard` deletes staged changes for good, so it needs the changeset named explicitly (id or name) and `confirm: true`.

To plan a change with these tools, use `/dr-plan` (or the `dr_change_planning` skill). The design is in [`docs/CHANGE_MODELING.md`](../../../docs/CHANGE_MODELING.md).

## Environment

| Variable            | Effect                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DR_MCP_API_KEY`    | Required. The key `dr mcp` prints on start.                                                                                                                                                   |
| `DR_MCP_ROOT_PATH`  | Serve the model at this path instead of the working directory. An unusable path is reported on stderr and the server keeps its own directory.                                                 |
| `DR_CHANGESET_ONLY` | `true`/`1`/`yes`/`on` refuses model writes unless a staged changeset is active (an unrecognised value also turns it on, with a warning). DrBot sets it with `dr visualize --with-changesets`. |

## Configuring Claude Code

Add an entry to your project's `.mcp.json` (or the equivalent global MCP config). Name the server `dr`: the DR agents and DrBot refer to its tools as `mcp__dr__<tool>`.

```json
{
  "mcpServers": {
    "dr": {
      "command": "dr",
      "args": ["mcp"],
      "env": {
        "DR_MCP_API_KEY": "<key printed by dr mcp>"
      }
    }
  }
}
```

Other MCP clients follow the same shape: a `command`/`args` pair that launches `dr mcp`, plus `DR_MCP_API_KEY` in `env`.

## Getting the API key

Run `dr mcp` once from a terminal — it generates an API key on first launch (prompting for a storage path interactively, defaulting to `~/.dr-mcp-key` otherwise) and prints it to stderr on every launch:

```
$ dr mcp
Generated new MCP API key, stored at /home/you/.dr-mcp-key
MCP API key: dr-mcp-<random>
Documentation Robotics MCP server ready (stdio)
```

Copy that key into the client config's `DR_MCP_API_KEY`. The server rejects the connection if the key is missing or doesn't match.

## Rotating the key

If a key leaks or you just want a fresh one, run:

```bash
dr mcp --regenerate-key
```

This overwrites the key at its existing storage path, updates `~/.dr-config.yaml`, and prints the new key — no manual deletion of files required. Update `DR_MCP_API_KEY` in every client config after rotating.

See [cli/README.md](../../../cli/README.md#mcp-server) for the full command reference.
