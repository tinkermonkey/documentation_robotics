/**
 * Integration tests for the project_init and project_upgrade MCP tools: spawns the built CLI as
 * `dr mcp` and drives it over stdio. The server is started outside the project and learns which
 * folder to serve from the client's MCP roots, as a server registered once per user does.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "yaml";
import { runDr } from "../helpers/cli-runner.js";
import { getCliBundledSpecVersion } from "../../src/utils/spec-version.js";

const CLI_PATH = path.join(process.cwd(), "dist", "cli.js");
const PROTOCOL_VERSION = "2025-06-18";

interface McpProcess {
  proc: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
}

let testDir: string;
let configPath: string;
let elsewhere: string;
const spawned: ChildProcessWithoutNullStreams[] = [];
let nextId = 1;

function send(state: McpProcess, message: object): void {
  state.proc.stdin.write(`${JSON.stringify(message)}\n`);
}

async function waitForMessage(state: McpProcess, matches: (message: any) => boolean, timeoutMs = 20000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const line of state.stdout.split("\n")) {
      if (!line.trim()) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Every stdout line must be a protocol message; a partial line is still arriving.
        continue;
      }
      if (matches(parsed)) return parsed;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for a message. stdout: ${state.stdout}\nstderr: ${state.stderr}`);
}

/**
 * Start `dr mcp` in a folder that is not the project, initialize it as a client with roots and
 * answer its roots/list request with the given folders.
 */
async function startServer(roots: string[], globalArgs: string[] = []): Promise<McpProcess> {
  const env: NodeJS.ProcessEnv = { ...process.env, DR_CONFIG_PATH: configPath };
  delete env.DR_MCP_API_KEY;
  delete env.DR_MCP_ROOT_PATH;
  delete env.DR_CHANGESET_ONLY;
  const proc = spawn("node", [CLI_PATH, ...globalArgs, "mcp"], { env, cwd: elsewhere, stdio: ["pipe", "pipe", "pipe"] });
  spawned.push(proc);
  const state: McpProcess = { proc, stdout: "", stderr: "" };
  proc.stdout.on("data", (chunk) => (state.stdout += chunk.toString()));
  proc.stderr.on("data", (chunk) => (state.stderr += chunk.toString()));

  const id = nextId++;
  send(state, {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: true } },
      clientInfo: { name: "project-tools-test", version: "1.0.0" },
    },
  });
  await waitForMessage(state, (m) => m.id === id);
  send(state, { jsonrpc: "2.0", method: "notifications/initialized" });

  const rootsRequest = await waitForMessage(state, (m) => m.method === "roots/list");
  send(state, {
    jsonrpc: "2.0",
    id: rootsRequest.id,
    result: { roots: roots.map((root) => ({ uri: pathToFileURL(root).href, name: path.basename(root) })) },
  });
  return state;
}

async function callTool(state: McpProcess, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; body: any }> {
  const id = nextId++;
  send(state, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const response = await waitForMessage(state, (m) => m.id === id && !m.method, 60000);
  expect(response.error).toBeUndefined();
  return { isError: response.result.isError === true, body: JSON.parse(response.result.content[0].text) };
}

/** Every line the server wrote to stdout is a JSON-RPC message (no progress lines leaked). */
function expectCleanStdout(state: McpProcess): void {
  for (const line of state.stdout.split("\n").filter((l) => l.trim())) {
    expect(() => JSON.parse(line)).not.toThrow();
  }
}

async function manifestOf(project: string): Promise<any> {
  return yaml.parse(await readFile(join(project, "documentation-robotics/model/manifest.yaml"), "utf8"));
}

/**
 * A model stamped with spec 0.10.0 that still holds what the catalog has since retired: a
 * product.capability element (now product.softwarecapability) and a persona that "realizes" a
 * stakeholder (now "references"). The same fixture `dr upgrade` is tested with.
 */
async function writeOlderModel(project: string): Promise<void> {
  await runDr(["init", "--name", "Older Model"], { cwd: project });
  const modelDir = join(project, "documentation-robotics/model");
  const element = (elementPath: string, extra: Record<string, unknown> = {}) => {
    const [layerId, type, name] = elementPath.split(".");
    return {
      [elementPath]: { id: crypto.randomUUID(), path: elementPath, spec_node_id: `${layerId}.${type}`, type, layer_id: layerId, name, ...extra },
    };
  };
  await writeFile(join(modelDir, "01_motivation/stakeholder.yaml"), yaml.stringify(element("motivation.stakeholder.customers", { attributes: { type: "customer" } })));
  await writeFile(
    join(modelDir, "03_product/elements.yaml"),
    yaml.stringify({
      ...element("product.capability.search", { attributes: { status: "delivered" } }),
      ...element("product.feature.search-box", { attributes: { priority: "high", status: "delivered" } }),
      ...element("product.persona.shopper", { attributes: { category: "primary", proficiency: "novice" } }),
    })
  );
  await writeFile(
    join(modelDir, "relationships.yaml"),
    yaml.stringify([
      { source: "product.feature.search-box", predicate: "realizes", target: "product.capability.search", layer: "product" },
      {
        source: "product.persona.shopper",
        predicate: "realizes",
        target: "motivation.stakeholder.customers",
        layer: "product",
        targetLayer: "motivation",
      },
    ])
  );
  const manifest = await manifestOf(project);
  manifest.spec_version = "0.10.0";
  await writeFile(join(modelDir, "manifest.yaml"), yaml.stringify(manifest));
}

beforeEach(async () => {
  testDir = join(tmpdir(), `dr-mcp-project-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  elsewhere = join(testDir, "server-cwd");
  await mkdir(elsewhere, { recursive: true });
  const keyPath = join(testDir, "mcp-key");
  await writeFile(keyPath, "dr-mcp-unused-key\n", { mode: 0o600 });
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

describe("project_init over MCP", () => {
  it("creates a model in the folder the client has open, which the server then serves", async () => {
    const project = join(testDir, "new-project");
    await mkdir(project, { recursive: true });
    const state = await startServer([project]);

    // Before init there is no model; the failed lookup must not stick.
    const before = await callTool(state, "model_info");
    expect(before.isError).toBe(true);

    const created = await callTool(state, "project_init", {
      name: "Onboarded Project",
      description: "Made over MCP",
      author: "Team A",
    });
    expect(created.isError).toBe(false);
    expect(created.body.status).toBe("created");
    expect([project, await realpath(project)]).toContain(created.body.rootPath);
    expect(created.body.model.specVersion).toBe(getCliBundledSpecVersion());

    const manifest = await manifestOf(project);
    expect(manifest.project.name).toBe("Onboarded Project");
    expect(manifest.project.description).toBe("Made over MCP");
    expect(manifest.spec_version).toBe(getCliBundledSpecVersion());
    // The spec reference is installed; no integration files are.
    const entries = await readdir(project);
    expect(entries).toContain(".dr");
    expect(entries).not.toContain(".claude");
    expect(entries).not.toContain(".github");
    // Nothing was created where the server was started.
    expect(await readdir(elsewhere)).toEqual([]);

    const info = await callTool(state, "model_info");
    expect(info.isError).toBe(false);
    expect(info.body.model.name).toBe("Onboarded Project");

    expectCleanStdout(state);
  }, 90000);

  it("refuses a folder that already has a model, leaving it as it was", async () => {
    const project = join(testDir, "existing");
    await mkdir(project, { recursive: true });
    await runDr(["init", "--name", "Existing Model"], { cwd: project });
    const manifestBefore = await readFile(join(project, "documentation-robotics/model/manifest.yaml"), "utf8");
    const state = await startServer([project]);

    const result = await callTool(state, "project_init", { name: "Second Model" });
    expect(result.isError).toBe(true);
    expect(result.body.error).toContain("already exists");
    expect(result.body.suggestions.join(" ")).toContain("project_upgrade");
    expect(await readFile(join(project, "documentation-robotics/model/manifest.yaml"), "utf8")).toBe(manifestBefore);
  }, 60000);
});

describe("project_upgrade over MCP", () => {
  it("previews the migration of an older model, then applies it and validates the result", async () => {
    const project = join(testDir, "older");
    await mkdir(project, { recursive: true });
    await writeOlderModel(project);
    // An element with no relationships: `dr validate` warns that it is orphaned.
    await writeFile(
      join(project, "documentation-robotics/model/01_motivation/goal.yaml"),
      yaml.stringify({
        "motivation.goal.lonely": {
          id: crypto.randomUUID(),
          path: "motivation.goal.lonely",
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: "lonely",
          attributes: { priority: "low" },
        },
      })
    );
    const elementsBefore = await readFile(join(project, "documentation-robotics/model/03_product/elements.yaml"), "utf8");
    const state = await startServer([project]);
    const target = getCliBundledSpecVersion();

    const preview = await callTool(state, "project_upgrade");
    expect(preview.isError).toBe(false);
    expect(preview.body.status).toBe("preview");
    expect(preview.body.model).toEqual({ specVersion: "0.10.0", targetSpecVersion: target });
    expect(preview.body.steps.map((s: any) => `${s.from}->${s.to}`)).toEqual([`0.10.0->${target}`]);
    expect(preview.body.elementTypeRenames).toEqual([
      {
        fromType: "product.capability",
        toType: "product.softwarecapability",
        count: 1,
        elements: [{ from: "product.capability.search", to: "product.softwarecapability.search" }],
      },
    ]);
    const rewrites = preview.body.relationshipRewrites.changes.map((c: any) => `${c.before} => ${c.after}`);
    expect(rewrites).toContain(
      "product.persona.shopper --[realizes]--> motivation.stakeholder.customers => product.persona.shopper --[references]--> motivation.stakeholder.customers"
    );
    expect(preview.body.cannotMigrate).toEqual([]);
    // No per-project integration files, so nothing about them (and never "run dr upgrade").
    expect(preview.body.integrations).toBeUndefined();
    expect(JSON.stringify(preview.body)).not.toContain("dr upgrade");

    // The preview changed nothing.
    expect((await manifestOf(project)).spec_version).toBe("0.10.0");
    expect(await readFile(join(project, "documentation-robotics/model/03_product/elements.yaml"), "utf8")).toBe(elementsBefore);

    const applied = await callTool(state, "project_upgrade", { apply: true });
    expect(applied.isError).toBe(false);
    expect(applied.body.status).toBe("applied");
    expect(applied.body.from).toBe("0.10.0");
    expect(applied.body.to).toBe(target);
    expect(applied.body.elementTypeRenames[0].toType).toBe("product.softwarecapability");
    expect(applied.body.validation).toMatchObject({ valid: true, errorCount: 0 });
    expect(applied.body.applied.every((step: any) => step.filesModified === undefined)).toBe(true);
    // Every model file the migration wrote: the manifest, the relationships and the product layer.
    expect(applied.body.files.modified).toEqual(
      expect.arrayContaining(["documentation-robotics/model/manifest.yaml", "documentation-robotics/model/relationships.yaml"])
    );
    const { modified, added, removed } = applied.body.files;
    expect(applied.body.filesModified).toBe(modified.length + added.length + removed.length);
    expect([...modified, ...added, ...removed].some((f: string) => f.startsWith("documentation-robotics/model/03_product/"))).toBe(true);

    // The same warnings as `dr validate` (orphan and source-reference warnings included).
    const validate = await runDr(["validate"], { cwd: project });
    const cliWarnings = Number(/(\d+) warning\(s\)/.exec(validate.stdout)?.[1]);
    expect(Number.isNaN(cliWarnings)).toBe(false);
    expect(applied.body.validation.warningCount).toBe(cliWarnings);
    expect(applied.body.validation.warnings.some((w: any) => w.elementId === "motivation.goal.lonely")).toBe(true);

    expect((await manifestOf(project)).spec_version).toBe(target);
    const rels = yaml.parse(await readFile(join(project, "documentation-robotics/model/relationships.yaml"), "utf8"));
    expect(rels.map((r: any) => `${r.source} ${r.predicate} ${r.target}`)).toEqual([
      "product.feature.search-box realizes product.softwarecapability.search",
      "product.persona.shopper references motivation.stakeholder.customers",
    ]);

    // The server serves the upgraded model without a reload.
    const shown = await callTool(state, "model_show", { id: "product.softwarecapability.search" });
    expect(shown.isError).toBe(false);

    const again = await callTool(state, "project_upgrade");
    expect(again.body.status).toBe("up-to-date");

    expectCleanStdout(state);
  }, 120000);

  it("says so when the model is already at the current spec version", async () => {
    const project = join(testDir, "current");
    await mkdir(project, { recursive: true });
    await runDr(["init", "--name", "Current Model"], { cwd: project });
    const state = await startServer([project]);

    const result = await callTool(state, "project_upgrade", { apply: true });
    expect(result.isError).toBe(false);
    expect(result.body.status).toBe("up-to-date");
    expect(result.body.message).toContain(`v${getCliBundledSpecVersion()}`);
    expect(result.body.model.specVersion).toBe(getCliBundledSpecVersion());
  }, 60000);

  it("points at project_init when the folder has no model", async () => {
    const project = join(testDir, "empty");
    await mkdir(project, { recursive: true });
    const state = await startServer([project]);

    const result = await callTool(state, "project_upgrade");
    expect(result.isError).toBe(true);
    expect(result.body.suggestions.join(" ")).toContain("project_init");
  }, 60000);
});

describe("stdout under --debug and --verbose", () => {
  it("keeps stdout to JSON-RPC while init and upgrade run with debug and verbose output on", async () => {
    const project = join(testDir, "debug-project");
    await mkdir(project, { recursive: true });
    const older = join(testDir, "debug-older");
    await mkdir(older, { recursive: true });
    await writeOlderModel(older);
    const state = await startServer([project], ["--debug", "--verbose"]);

    const created = await callTool(state, "project_init", { name: "Debug Project" });
    expect(created.body.status).toBe("created");
    const preview = await callTool(state, "project_upgrade", { rootPath: older });
    expect(preview.body.status).toBe("preview");
    const applied = await callTool(state, "project_upgrade", { rootPath: older, apply: true });
    expect(applied.body.status).toBe("applied");

    expectCleanStdout(state);
    // The debug lines went somewhere: stderr.
    expect(state.stderr).toContain("[DEBUG]");
  }, 120000);
});

async function realpath(p: string): Promise<string> {
  const { realpath: rp } = await import("node:fs/promises");
  return rp(p);
}
