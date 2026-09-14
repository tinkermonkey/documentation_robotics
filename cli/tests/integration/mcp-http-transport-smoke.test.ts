/**
 * CI smoke test for `dr mcp --transport http` — verifies the HTTP server starts,
 * completes the MCP initialize handshake, and enforces bearer token authentication.
 * Lightweight extract of the "dr mcp --transport http" suite.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";

const CLI_PATH = path.join(process.cwd(), "dist", "cli.js");

interface McpProcess {
  proc: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  exitCode: Promise<number | null>;
}

function spawnMcpHttp(configPath: string, apiKey: string, port: number = 3100): McpProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, DR_CONFIG_PATH: configPath };
  delete env.DR_MCP_API_KEY;
  if (apiKey !== undefined) {
    env.DR_MCP_API_KEY = apiKey;
  }

  const args = [CLI_PATH, "mcp", "--transport", "http", "--port", port.toString()];

  const proc = spawn("node", args, { env, stdio: ["pipe", "pipe", "pipe"] });

  const state: McpProcess = {
    proc,
    stdout: "",
    stderr: "",
    exitCode: new Promise((resolve) => {
      proc.on("close", (code) => resolve(code));
      proc.on("error", () => resolve(null));
    }),
  };

  proc.stdout.on("data", (chunk) => {
    state.stdout += chunk.toString();
  });
  proc.stderr.on("data", (chunk) => {
    state.stderr += chunk.toString();
  });

  return state;
}

async function waitForServerReady(state: McpProcess, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (state.stderr.includes("MCP server ready")) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function makeHttpRequest(
  port: number,
  headers?: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });
    const body = await response.json();
    return { status: response.status, body };
  } catch (error) {
    throw new Error(`HTTP request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

describe("dr mcp --transport http (smoke)", () => {
  let testDir: string;
  let configPath: string;
  let keyPath: string;
  let apiKey: string;
  const spawned: ChildProcessWithoutNullStreams[] = [];

  beforeEach(async () => {
    testDir = join(tmpdir(), `dr-mcp-http-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    keyPath = join(testDir, "mcp-key");
    apiKey = `dr-mcp-test-${Math.random().toString(36).slice(2)}`;
    await writeFile(keyPath, `${apiKey}\n`, { mode: 0o600 });

    configPath = join(testDir, ".dr-config.yaml");
    await writeFile(configPath, `mcp:\n  api_key_path: '${keyPath}'\n`);
  });

  afterEach(async () => {
    for (const proc of spawned) {
      if (!proc.killed) proc.kill("SIGKILL");
    }
    spawned.length = 0;
    await rm(testDir, { recursive: true, force: true });
  });

  it("starts HTTP server and responds to initialize request with bearer auth", async () => {
    const port = 3101;
    const state = spawnMcpHttp(configPath, apiKey, port);
    spawned.push(state.proc);

    const ready = await waitForServerReady(state);
    expect(ready).toBe(true);
    expect(state.stderr).toContain("http");
    expect(state.stderr).toContain("/mcp");

    await new Promise((resolve) => setTimeout(resolve, 500));

    const response = await makeHttpRequest(port, { Authorization: `Bearer ${apiKey}` });
    expect(response.status).not.toBe(401);

    state.proc.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("rejects initialize request without bearer token", async () => {
    const port = 3102;
    const state = spawnMcpHttp(configPath, apiKey, port);
    spawned.push(state.proc);

    const ready = await waitForServerReady(state);
    expect(ready).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const response = await makeHttpRequest(port, {});
    expect(response.status).toBe(401);

    state.proc.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("exits cleanly on SIGTERM", async () => {
    const port = 3103;
    const state = spawnMcpHttp(configPath, apiKey, port);
    spawned.push(state.proc);

    const ready = await waitForServerReady(state);
    expect(ready).toBe(true);

    state.proc.kill("SIGTERM");
    const exitCode = await state.exitCode;

    expect(exitCode === 0 || exitCode === null).toBe(true);
  });
});
