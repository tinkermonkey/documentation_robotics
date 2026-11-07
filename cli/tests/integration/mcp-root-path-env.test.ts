/**
 * `dr mcp` with DR_MCP_ROOT_PATH (how DrBot under `dr visualize` points its MCP server at the
 * served model): the server serves that model even when spawned in another directory, and a
 * bad path is reported on stderr while the server keeps running from its own cwd.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Model } from "../../src/core/model.js";

const CLI_PATH = join(process.cwd(), "dist", "cli.js");
const PROTOCOL_VERSION = "2025-06-18";

interface McpProcess {
  proc: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
}

let base: string;
let modelRoot: string;
let elsewhere: string;
let configPath: string;
let apiKey: string;
const spawned: ChildProcessWithoutNullStreams[] = [];

beforeAll(async () => {
  base = join(tmpdir(), `dr-mcp-root-path-${randomUUID()}`);
  modelRoot = join(base, "project");
  elsewhere = join(base, "elsewhere");
  await mkdir(modelRoot, { recursive: true });
  await mkdir(elsewhere, { recursive: true });
  await Model.init(modelRoot, { name: "Root Path Env Model", version: "0.1.0" }, { lazyLoad: false });

  const keyPath = join(base, "mcp-key");
  apiKey = `dr-mcp-test-${randomUUID()}`;
  await writeFile(keyPath, `${apiKey}\n`, { mode: 0o600 });
  configPath = join(base, ".dr-config.yaml");
  await writeFile(configPath, `mcp:\n  api_key_path: '${keyPath}'\n`);
});

afterEach(() => {
  for (const proc of spawned) if (!proc.killed) proc.kill("SIGKILL");
  spawned.length = 0;
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

function spawnMcp(rootPathEnv: string): McpProcess {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DR_CONFIG_PATH: configPath,
    DR_MCP_API_KEY: apiKey,
    DR_MCP_ROOT_PATH: rootPathEnv,
  };
  const proc = spawn("node", [CLI_PATH, "mcp"], {
    cwd: elsewhere,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  spawned.push(proc);
  const state: McpProcess = { proc, stdout: "", stderr: "" };
  proc.stdout.on("data", (chunk) => (state.stdout += chunk.toString()));
  proc.stderr.on("data", (chunk) => (state.stderr += chunk.toString()));
  return state;
}

function send(state: McpProcess, message: object): void {
  state.proc.stdin.write(`${JSON.stringify(message)}\n`);
}

async function waitForResponse(state: McpProcess, id: number, timeoutMs = 10000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const line of state.stdout.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.id === id) return parsed;
      } catch {
        // partial line
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for id=${id}. stdout: ${state.stdout} stderr: ${state.stderr}`);
}

async function modelInfo(state: McpProcess): Promise<any> {
  send(state, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "t", version: "1" },
    },
  });
  await waitForResponse(state, 1);
  send(state, { jsonrpc: "2.0", method: "notifications/initialized" });
  send(state, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "model_info", arguments: {} },
  });
  return waitForResponse(state, 2);
}

describe("dr mcp DR_MCP_ROOT_PATH", () => {
  it("serves the model at DR_MCP_ROOT_PATH when spawned in another directory", async () => {
    const response = await modelInfo(spawnMcp(modelRoot));
    expect(response.error).toBeUndefined();
    expect(response.result.isError).toBeFalsy();
    expect(JSON.parse(response.result.content[0].text).model.name).toBe("Root Path Env Model");
  }, 20000);

  it("reports an unusable path and keeps serving from its own cwd", async () => {
    const missing = join(base, "does-not-exist");
    const state = spawnMcp(missing);
    const response = await modelInfo(state);
    expect(state.stderr).toContain(`DR_MCP_ROOT_PATH=${missing} is not usable`);
    // The server stayed up; its cwd has no model, so the tool reports that rather than crashing.
    expect(response.error).toBeUndefined();
    expect(response.result.isError).toBe(true);
  }, 20000);
});
