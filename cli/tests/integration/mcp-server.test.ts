/**
 * Integration tests for `dr mcp` — spawns the built CLI as a subprocess and
 * drives the MCP stdio transport directly with JSON-RPC messages.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";

const CLI_PATH = path.join(process.cwd(), "dist", "cli.js");
const PROTOCOL_VERSION = "2025-06-18";

interface McpProcess {
  proc: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  exitCode: Promise<number | null>;
}

function spawnMcp(configPath: string, apiKey?: string): McpProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, DR_CONFIG_PATH: configPath };
  delete env.DR_MCP_API_KEY;
  if (apiKey !== undefined) {
    env.DR_MCP_API_KEY = apiKey;
  }

  const proc = spawn("node", [CLI_PATH, "mcp"], { env, stdio: ["pipe", "pipe", "pipe"] });

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

function sendRequest(proc: ChildProcessWithoutNullStreams, message: object): void {
  proc.stdin.write(`${JSON.stringify(message)}\n`);
}

/** Poll accumulated stdout for a JSON-RPC response with the given id. */
async function waitForResponse(
  state: McpProcess,
  id: number,
  timeoutMs = 5000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const lines = state.stdout.split("\n").filter((line) => line.trim().length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.id === id) return parsed;
      } catch {
        // Not yet a complete JSON line; keep waiting.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for response id=${id}. stdout so far: ${state.stdout}`);
}

async function waitForExit(state: McpProcess, timeoutMs = 5000): Promise<number | null> {
  return Promise.race([
    state.exitCode,
    new Promise<number | null>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for process exit")), timeoutMs)
    ),
  ]);
}

describe("dr mcp", () => {
  let testDir: string;
  let configPath: string;
  let keyPath: string;
  let apiKey: string;
  const spawned: ChildProcessWithoutNullStreams[] = [];

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `dr-mcp-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

  it("completes the initialize handshake and lists zero tools when given a valid key", async () => {
    const state = spawnMcp(configPath, apiKey);
    spawned.push(state.proc);

    sendRequest(state.proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "integration-test", version: "1.0.0" },
      },
    });

    const initResponse = await waitForResponse(state, 1);
    expect(initResponse.error).toBeUndefined();
    expect(initResponse.result.serverInfo.name).toBe("documentation-robotics");

    sendRequest(state.proc, { jsonrpc: "2.0", method: "notifications/initialized" });
    sendRequest(state.proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    const toolsResponse = await waitForResponse(state, 2);
    expect(toolsResponse.error).toBeUndefined();
    expect(toolsResponse.result.tools).toEqual([]);

    expect(state.stderr).toContain("MCP API key:");
  });

  it("rejects the connection when DR_MCP_API_KEY is missing", async () => {
    const state = spawnMcp(configPath, undefined);
    spawned.push(state.proc);

    const exitCode = await waitForExit(state);
    expect(exitCode).not.toBe(0);
    expect(state.stderr).toContain("DR_MCP_API_KEY");
    expect(state.stdout.trim()).toBe("");
  });

  it("rejects the connection when DR_MCP_API_KEY does not match the stored key", async () => {
    const state = spawnMcp(configPath, "dr-mcp-wrong-key");
    spawned.push(state.proc);

    const exitCode = await waitForExit(state);
    expect(exitCode).not.toBe(0);
    expect(state.stderr).toContain("DR_MCP_API_KEY");
    expect(state.stdout.trim()).toBe("");
  });
});
