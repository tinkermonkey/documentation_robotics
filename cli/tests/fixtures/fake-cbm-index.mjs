#!/usr/bin/env node
/**
 * A stand-in for codebase-memory-mcp's index path, for integration tests of the background
 * `dr analyzer index` run: an MCP server on stdio (newline-delimited JSON-RPC) that answers
 * initialize, tools/list, and tools/call for list_projects, index_repository and index_status.
 *
 * FAKE_CBM_MODE picks how index_repository answers (the shapes codebase-memory-mcp 0.12.1 sends):
 * - "ok": `{ project, status: "indexed", nodes: 5, edges: 7 }`
 * - "indexing": `{ status: "indexing", slot, path }`, as when another process is indexing the same
 *   code; index_status then answers `indexing` twice and `ready` with the counts and an older
 *   `indexed_at` (that run read the code before this one started)
 * - "empty": `{ project, status: "indexed", nodes: 0, edges: 0 }`
 * It reads no code and keeps no state between processes beyond a counter file in FAKE_CBM_STATE.
 */

import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";

const mode = process.env.FAKE_CBM_MODE ?? "ok";
const stateDir = process.env.FAKE_CBM_STATE ?? process.cwd();
const TOOLS = ["search_graph", "index_repository", "list_projects", "trace_path", "get_code_snippet", "index_status"];

let root = null;
const projectName = () => (root ? root.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") : "none");

/** How many times index_status has been asked, across this run's processes. */
function statusTurn() {
  const file = path.join(stateDir, "fake-cbm-status-turns");
  const turn = fs.existsSync(file) ? Number(fs.readFileSync(file, "utf-8")) || 0 : 0;
  fs.writeFileSync(file, String(turn + 1));
  return turn;
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }], isError: false });

function callTool(name, args) {
  if (name === "list_projects") {
    return { projects: root ? [{ name: projectName(), root_path: root }] : [], has_more: false };
  }
  if (name === "index_repository") {
    root = args.repo_path;
    if (mode === "indexing") return { status: "indexing", slot: 1, path: root };
    if (mode === "empty") return { project: projectName(), status: "indexed", nodes: 0, edges: 0 };
    return { project: projectName(), status: "indexed", nodes: 5, edges: 7 };
  }
  if (name === "index_status") {
    return statusTurn() < 2
      ? { project: args.project, status: "indexing" }
      : { project: args.project, status: "ready", nodes: 6, edges: 8, root_path: root, indexed_at: "2026-01-01T00:00:00Z" };
  }
  return { error: `fake-cbm-index does not implement ${name}` };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  const { method, params, id } = request ?? {};
  if (id === undefined || id === null) return; // notifications
  if (method === "initialize") {
    reply(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "codebase-memory-mcp", version: "0.12.1" } });
  } else if (method === "tools/list") {
    reply(id, { tools: TOOLS.map((name) => ({ name })) });
  } else if (method === "tools/call") {
    reply(id, text(callTool(params?.name, params?.arguments ?? {})));
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${method}` } }) + "\n");
  }
});

if (process.argv.includes("--version")) {
  process.stdout.write("codebase-memory-mcp 0.12.1\n");
  process.exit(0);
}
