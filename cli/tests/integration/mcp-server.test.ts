/**
 * Integration tests for `dr mcp` — spawns the built CLI as a subprocess and
 * drives the MCP stdio transport directly with JSON-RPC messages.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";
import { createTempWorkdir, runDr } from "../helpers/cli-runner.js";

const CLI_PATH = path.join(process.cwd(), "dist", "cli.js");
const PROTOCOL_VERSION = "2025-06-18";

const MODEL_TOOL_NAMES = [
  "model_list",
  "model_show",
  "model_search",
  "model_stats",
  "model_info",
  "model_trace",
  "model_add",
  "model_update",
  "model_delete",
  "model_validate",
  "model_export",
];

interface McpProcess {
  proc: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  exitCode: Promise<number | null>;
}

function spawnMcp(configPath: string, apiKey?: string, cwd?: string): McpProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, DR_CONFIG_PATH: configPath };
  delete env.DR_MCP_API_KEY;
  if (apiKey !== undefined) {
    env.DR_MCP_API_KEY = apiKey;
  }

  const proc = spawn("node", [CLI_PATH, "mcp"], { env, cwd, stdio: ["pipe", "pipe", "pipe"] });

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

  it("completes the initialize handshake and lists the model tool surface when given a valid key", async () => {
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
    const names = toolsResponse.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual([...MODEL_TOOL_NAMES].sort());

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

describe("dr mcp model tools and resources", () => {
  let project: { path: string; cleanup: () => Promise<void> };
  let configDir: string;
  let state: McpProcess;
  let nextId = 1;

  beforeAll(async () => {
    project = await createTempWorkdir();
    await runDr(["init", "--name", "MCP Tools Test Model"], { cwd: project.path });

    configDir = join(tmpdir(), `dr-mcp-tools-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(configDir, { recursive: true });
    const keyPath = join(configDir, "mcp-key");
    const apiKey = `dr-mcp-test-${Math.random().toString(36).slice(2)}`;
    await writeFile(keyPath, `${apiKey}\n`, { mode: 0o600 });
    const configPath = join(configDir, ".dr-config.yaml");
    await writeFile(configPath, `mcp:\n  api_key_path: '${keyPath}'\n`);

    state = spawnMcp(configPath, apiKey, project.path);

    sendRequest(state.proc, {
      jsonrpc: "2.0",
      id: nextId,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "integration-test", version: "1.0.0" },
      },
    });
    await waitForResponse(state, nextId);
    nextId++;
    sendRequest(state.proc, { jsonrpc: "2.0", method: "notifications/initialized" });
  }, 20000);

  afterAll(async () => {
    if (state?.proc && !state.proc.killed) state.proc.kill("SIGKILL");
    await project?.cleanup();
    await rm(configDir, { recursive: true, force: true });
  });

  async function callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const id = nextId++;
    sendRequest(state.proc, {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const response = await waitForResponse(state, id);
    expect(response.error).toBeUndefined();
    return response.result;
  }

  function parseToolJSON(result: any): any {
    return JSON.parse(result.content[0].text);
  }

  async function readResource(uri: string): Promise<any> {
    const id = nextId++;
    sendRequest(state.proc, {
      jsonrpc: "2.0",
      id,
      method: "resources/read",
      params: { uri },
    });
    const response = await waitForResponse(state, id);
    expect(response.error).toBeUndefined();
    return response.result;
  }

  it("model_info returns model metadata when no elements exist yet", async () => {
    const result = await callTool("model_info", {});
    const data = parseToolJSON(result);
    expect(data.model.name).toBe("MCP Tools Test Model");
    expect(Array.isArray(data.layers)).toBe(true);
  });

  it("model_add creates a new element through MutationHandler", async () => {
    const result = await callTool("model_add", {
      layer: "business",
      type: "businessservice",
      name: "test-service",
      description: "A service added via MCP",
    });
    const data = parseToolJSON(result);
    expect(data.status).toBe("added");
    expect(data.id).toBe("business.businessservice.test-service");
    expect(data.layer).toBe("business");
  });

  it("model_add rejects an unknown layer with a structured, non-throwing error", async () => {
    const result = await callTool("model_add", {
      layer: "not-a-real-layer",
      type: "whatever",
      name: "broken",
    });
    expect(result.isError).toBe(true);
    const data = parseToolJSON(result);
    expect(data.error).toContain("Unknown layer");
    expect(data.category).toBe("user");
  });

  it("model_list finds the added element when scoped to its layer", async () => {
    const result = await callTool("model_list", { layer: "business" });
    const data = parseToolJSON(result);
    expect(data.elements.some((e: any) => e.path === "business.businessservice.test-service")).toBe(true);
  });

  it("model_show returns the element and its relationships", async () => {
    const result = await callTool("model_show", { id: "business.businessservice.test-service" });
    const data = parseToolJSON(result);
    expect(data.element.name).toBe("test-service");
    expect(data.relationships).toEqual({ outgoing: [], incoming: [] });
  });

  it("model_show reports a structured not-found error for a missing element", async () => {
    const result = await callTool("model_show", { id: "business.businessservice.does-not-exist" });
    expect(result.isError).toBe(true);
    const data = parseToolJSON(result);
    expect(data.error).toContain("not found");
    expect(data.category).toBe("not_found");
  });

  it("model_search finds the element by name substring", async () => {
    const result = await callTool("model_search", { query: "test-service" });
    const data = parseToolJSON(result);
    expect(data.count).toBeGreaterThan(0);
    expect(data.results.some((r: any) => r.id === "business.businessservice.test-service")).toBe(true);
  });

  it("model_trace reports no dependents or dependencies for an isolated element", async () => {
    const result = await callTool("model_trace", { id: "business.businessservice.test-service" });
    const data = parseToolJSON(result);
    expect(data.dependents).toEqual({ direct: [], transitive: [] });
    expect(data.dependencies).toEqual({ direct: [], transitive: [] });
  });

  it("model_stats reports at least one element", async () => {
    const result = await callTool("model_stats", {});
    const data = parseToolJSON(result);
    expect(data.statistics.totalElements).toBeGreaterThan(0);
  });

  it("model_validate reuses the validator pipeline and reports no errors", async () => {
    const result = await callTool("model_validate", {});
    const data = parseToolJSON(result);
    expect(data.summary.errorCount).toBe(0);
  });

  it("model_export produces markdown content via the shared export handlers", async () => {
    const result = await callTool("model_export", { format: "markdown" });
    const data = parseToolJSON(result);
    expect(typeof data.content).toBe("string");
    expect(data.content.length).toBeGreaterThan(0);
  });

  it("model_update modifies the element through MutationHandler", async () => {
    const result = await callTool("model_update", {
      id: "business.businessservice.test-service",
      description: "Updated via MCP",
    });
    const data = parseToolJSON(result);
    expect(data.status).toBe("updated");

    const showResult = await callTool("model_show", { id: "business.businessservice.test-service" });
    const showData = parseToolJSON(showResult);
    expect(showData.element.description).toBe("Updated via MCP");
  });

  it("model_delete removes the element through MutationHandler", async () => {
    const result = await callTool("model_delete", { id: "business.businessservice.test-service" });
    const data = parseToolJSON(result);
    expect(data.status).toBe("deleted");

    const showResult = await callTool("model_show", { id: "business.businessservice.test-service" });
    expect(showResult.isError).toBe(true);
  });

  it("lists the spec and model manifest resources", async () => {
    const id = nextId++;
    sendRequest(state.proc, { jsonrpc: "2.0", id, method: "resources/list", params: {} });
    const response = await waitForResponse(state, id);
    expect(response.error).toBeUndefined();

    const uris = response.result.resources.map((r: any) => r.uri);
    expect(uris).toContain("dr://spec/manifest");
    expect(uris).toContain("dr://spec/base");
    expect(uris).toContain("dr://model/manifest");
    expect(uris).toContain("dr://spec/layer/api");
    expect(uris.length).toBeGreaterThanOrEqual(15);
  });

  it("reads the dr://spec/manifest resource", async () => {
    const result = await readResource("dr://spec/manifest");
    const data = JSON.parse(result.contents[0].text);
    expect(typeof data.specVersion).toBe("string");
    expect(Array.isArray(data.layers)).toBe(true);
  });

  it("reads the dr://spec/base resource", async () => {
    const result = await readResource("dr://spec/base");
    const data = JSON.parse(result.contents[0].text);
    expect(typeof data.schemas).toBe("object");
  });

  it("reads a templated dr://spec/layer/{name} resource", async () => {
    const result = await readResource("dr://spec/layer/api");
    const data = JSON.parse(result.contents[0].text);
    expect(data).toBeTruthy();
  });

  it("reads the dr://model/manifest resource", async () => {
    const result = await readResource("dr://model/manifest");
    const data = JSON.parse(result.contents[0].text);
    expect(data.name).toBe("MCP Tools Test Model");
  });
});
