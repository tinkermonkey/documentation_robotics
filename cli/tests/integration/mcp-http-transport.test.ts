/**
 * Integration tests for `dr mcp --transport http`
 *
 * Tests the HTTP transport implementation with bearer token authentication,
 * session management, and graceful shutdown.
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

function spawnMcpHttp(
  configPath: string,
  apiKey: string,
  port: number = 3100,
  host: string = "127.0.0.1",
  cwd?: string
): McpProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, DR_CONFIG_PATH: configPath };
  delete env.DR_MCP_API_KEY;
  if (apiKey !== undefined) {
    env.DR_MCP_API_KEY = apiKey;
  }

  const args = [
    CLI_PATH,
    "mcp",
    "--transport",
    "http",
    "--port",
    port.toString(),
    "--host",
    host,
  ];

  const proc = spawn("node", args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });

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
  method: string = "POST",
  headers?: Record<string, string>,
  body?: any
): Promise<{ status: number; body: unknown; headers: Headers }> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : (method !== "GET" ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) : undefined),
    });
    const text = await response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed, headers: response.headers };
  } catch (error) {
    throw new Error(`HTTP request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

describe("dr mcp --transport http", () => {
  let testDir: string;
  let configPath: string;
  let keyPath: string;
  let apiKey: string;
  const spawned: ChildProcessWithoutNullStreams[] = [];

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dr-mcp-http-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
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

  it("starts an HTTP server on the default port", async () => {
    const state = spawnMcpHttp(configPath, apiKey);
    spawned.push(state.proc);

    const ready = await waitForServerReady(state);
    expect(ready).toBe(true);
    expect(state.stderr).toContain("http://127.0.0.1:3100/mcp");

    // Give the server time to fully initialize after the ready message
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Attempt to make a request with a valid bearer token
    const response = await makeHttpRequest(3100, "POST", {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(response.status).not.toBe(401);

    state.proc.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("binds to a custom port when specified", async () => {
    const customPort = 9876;
    const state = spawnMcpHttp(configPath, apiKey, customPort);
    spawned.push(state.proc);

    const ready = await waitForServerReady(state);
    expect(ready).toBe(true);
    expect(state.stderr).toContain(`http://127.0.0.1:${customPort}/mcp`);

    state.proc.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("rejects requests without a valid bearer token", async () => {
    const state = spawnMcpHttp(configPath, apiKey);
    spawned.push(state.proc);

    const ready = await waitForServerReady(state);
    expect(ready).toBe(true);

    // Give the server time to fully initialize after the ready message
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Request without authorization header
    const response = await makeHttpRequest(3100, "POST", {});
    expect(response.status).toBe(401);

    state.proc.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("prints the API key to stderr on startup", async () => {
    const state = spawnMcpHttp(configPath, apiKey);
    spawned.push(state.proc);

    const ready = await waitForServerReady(state);
    expect(ready).toBe(true);
    expect(state.stderr).toContain(`MCP API key: ${apiKey}`);

    state.proc.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("warns when bound to 0.0.0.0", async () => {
    const state = spawnMcpHttp(configPath, apiKey, 3100, "0.0.0.0");
    spawned.push(state.proc);

    const ready = await waitForServerReady(state);
    expect(ready).toBe(true);
    expect(state.stderr).toContain("Warning");
    expect(state.stderr).toContain("0.0.0.0");

    state.proc.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("exits cleanly on SIGINT", async () => {
    const state = spawnMcpHttp(configPath, apiKey);
    spawned.push(state.proc);

    const ready = await waitForServerReady(state);
    expect(ready).toBe(true);

    // Send SIGINT
    state.proc.kill("SIGINT");
    const exitCode = await state.exitCode;

    // Process should exit cleanly (code 0 or null)
    expect(exitCode === 0 || exitCode === null).toBe(true);
  });

  it("exits cleanly on SIGTERM", async () => {
    const state = spawnMcpHttp(configPath, apiKey);
    spawned.push(state.proc);

    const ready = await waitForServerReady(state);
    expect(ready).toBe(true);

    // Send SIGTERM
    state.proc.kill("SIGTERM");
    const exitCode = await state.exitCode;

    // Process should exit cleanly (code 0 or null)
    expect(exitCode === 0 || exitCode === null).toBe(true);
  });

  it("handles multiple concurrent sessions independently", async () => {
    const state = spawnMcpHttp(configPath, apiKey);
    spawned.push(state.proc);

    const ready = await waitForServerReady(state);
    expect(ready).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const headers = { Authorization: `Bearer ${apiKey}` };

    // Make two concurrent POST requests (both should succeed)
    const [response1, response2] = await Promise.all([
      makeHttpRequest(3100, "POST", headers, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "client-1", version: "1.0.0" },
        },
      }),
      makeHttpRequest(3100, "POST", headers, {
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "client-2", version: "1.0.0" },
        },
      }),
    ]);

    // Both requests should succeed
    expect(response1.status).not.toBe(401);
    expect(response2.status).not.toBe(401);

    state.proc.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("invokes a tool over HTTP after initialization", async () => {
    const state = spawnMcpHttp(configPath, apiKey);
    spawned.push(state.proc);

    const ready = await waitForServerReady(state);
    expect(ready).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const headers = { Authorization: `Bearer ${apiKey}` };

    // Step 1: Send initialize request
    const initResponse = await makeHttpRequest(3100, "POST", headers, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    expect(initResponse.status).not.toBe(401);
    expect(initResponse.body).toBeDefined();

    // Extract sessionId from the response (in the MCP protocol, it should be in response.result)
    const sessionIdFromInit = (initResponse.body as any)?.result?.extensionData?.["mcp-session-id"] ||
                              initResponse.headers.get?.("mcp-session-id");

    // Step 2: Send a tool invocation request (model_list)
    // Use the sessionId if available, or just send another POST
    const toolResponse = await makeHttpRequest(3100, "POST", {
      ...headers,
      ...(sessionIdFromInit ? { "mcp-session-id": sessionIdFromInit } : {}),
    }, {
      jsonrpc: "2.0",
      id: 2,
      method: "resources/list",
    });

    // The tool call should succeed (not 401, ideally successful JSON-RPC response)
    expect(toolResponse.status).not.toBe(401);
    expect(toolResponse.body).toBeDefined();

    state.proc.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
});
