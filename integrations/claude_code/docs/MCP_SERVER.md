---
title: DR MCP Server
description: Configure an MCP client to connect to the Documentation Robotics MCP server
---

# Documentation Robotics MCP Server

`dr mcp` runs the CLI as a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio, exposing model tools (list/show/search/add/update/delete/validate/export/trace elements, changesets, chat, annotations) to any MCP-aware AI client — Claude Code included.

Annotation tools (`annotation_list`, `annotation_get`, `annotation_create`, `annotation_update`, `annotation_delete`, `annotation_reply`) mirror the capabilities of the REST server's `/api/annotations/*` endpoints. Unlike the REST server's in-memory, per-process annotation store, the MCP tools persist annotations to `documentation-robotics/annotations/` on disk, so they survive across MCP sessions.

## Configuring Claude Code

Add an entry to your project's `.mcp.json` (or the equivalent global MCP config):

```json
{
  "mcpServers": {
    "documentation-robotics": {
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
