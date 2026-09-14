/**
 * Shared helpers for MCP HTTP transport integration tests
 *
 * These helpers are used by multiple test files to spawn and interact
 * with the MCP HTTP server in consistent ways.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import path from "node:path";

const CLI_PATH = path.join(process.cwd(), "dist", "cli.js");

export interface McpProcess {
  proc: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  exitCode: Promise<number | null>;
}

export function spawnMcpHttp(
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

export async function waitForServerReady(state: McpProcess, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (state.stderr.includes("MCP server ready")) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

export async function makeHttpRequest(
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
      body: body !== undefined ? JSON.stringify(body) : (method !== "GET" && method !== "DELETE" ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) : undefined),
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
