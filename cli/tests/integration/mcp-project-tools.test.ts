/**
 * Integration tests for the project_init, project_upgrade and project_status MCP tools: spawns the built CLI as
 * `dr mcp` and drives it over stdio. The server is started outside the project and learns which
 * folder to serve from the client's MCP roots, as a server registered once per user does.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "yaml";
import { runDr } from "../helpers/cli-runner.js";
import { getCliBundledSpecVersion, getCliVersion } from "../../src/utils/spec-version.js";
import { MigrationRegistry } from "../../src/core/migration-registry.js";
import { LANDING_WHEN_DRIFT_BLOCKS } from "../../src/mcp/tools/project-status-collectors.js";

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
    // The chain comes from the registry, so the next spec bump doesn't need this line edited
    // (it broke the 0.5.0 and 0.6.0 release preflights).
    const chain = new MigrationRegistry().getMigrationPath("0.10.0").map((m) => `${m.fromVersion}->${m.toVersion}`);
    expect(chain[0]).toBe("0.10.0->0.11.0");
    expect(chain.at(-1)!.endsWith(`->${target}`)).toBe(true);
    expect(preview.body.steps.map((s: any) => `${s.from}->${s.to}`)).toEqual(chain);
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
    expect(result.body.prettierignore).toBeUndefined();
  }, 60000);

  it("gives a model already at the current spec the .prettierignore entry: the preview says so, apply adds it (#1155)", async () => {
    const project = join(testDir, "current-pretty");
    await mkdir(project, { recursive: true });
    await runDr(["init", "--name", "Current Pretty"], { cwd: project });
    // prettier arrives after init, so init didn't add the entry
    await writeFile(join(project, ".prettierrc.json"), "{}", "utf8");
    const state = await startServer([project]);

    const preview = await callTool(state, "project_upgrade");
    expect(preview.body.status).toBe("up-to-date");
    expect(preview.body.prettierignore).toEqual({
      path: expect.stringMatching(/current-pretty\/\.prettierignore$/),
      missing: ["documentation-robotics/changesets/"],
    });
    expect(preview.body.next).toContain("apply: true");
    expect(await readFile(join(project, ".prettierignore"), "utf8").catch(() => null)).toBeNull();

    const applied = await callTool(state, "project_upgrade", { apply: true });
    expect(applied.body.status).toBe("up-to-date");
    expect(applied.body.prettierignore).toEqual({
      path: expect.stringMatching(/current-pretty\/\.prettierignore$/),
      added: ["documentation-robotics/changesets/"],
    });
    expect(await readFile(join(project, ".prettierignore"), "utf8")).toContain("documentation-robotics/changesets/\n");
  }, 60000);

  it("removes attributes the spec retired from a model at the current spec version (#1091)", async () => {
    const project = join(testDir, "retired-attributes");
    await mkdir(project, { recursive: true });
    await runDr(["init", "--name", "Retired Attributes"], { cwd: project });
    const testingDir = join(project, "documentation-robotics/model/13_testing");
    await mkdir(testingDir, { recursive: true });
    const sketch = "testing.testcasesketch.signup";
    await writeFile(
      join(testingDir, "elements.yaml"),
      yaml.stringify({
        [sketch]: {
          id: crypto.randomUUID(),
          path: sketch,
          spec_node_id: "testing.testcasesketch",
          type: "testcasesketch",
          layer_id: "testing",
          name: "signup",
          attributes: { status: "draft", inputSelections: ["testing.inputpartitionselection.valid-email"] },
        },
      })
    );
    const state = await startServer([project]);

    const preview = await callTool(state, "project_upgrade");
    expect(preview.isError).toBe(false);
    expect(preview.body.status).toBe("preview");
    expect(preview.body.retiredAttributes).toMatchObject({
      count: 1,
      changes: [{ element: sketch, type: "testing.testcasesketch", attributes: ["inputSelections"] }],
    });

    const applied = await callTool(state, "project_upgrade", { apply: true });
    expect(applied.isError).toBe(false);
    expect(applied.body.status).toBe("applied");
    expect(applied.body.retiredAttributes.count).toBe(1);
    const shown = await callTool(state, "model_show", { id: sketch });
    expect(shown.isError).toBe(false);
    expect(JSON.stringify(shown.body)).toContain('"status":"draft"');
    expect(JSON.stringify(shown.body)).not.toContain("inputSelections");

    const again = await callTool(state, "project_upgrade");
    expect(again.body.status).toBe("up-to-date");
  }, 90000);

  it("points at project_init when the folder has no model", async () => {
    const project = join(testDir, "empty");
    await mkdir(project, { recursive: true });
    const state = await startServer([project]);

    const result = await callTool(state, "project_upgrade");
    expect(result.isError).toBe(true);
    expect(result.body.suggestions.join(" ")).toContain("project_init");
  }, 60000);
});

// Follows tranche 2 (#1200, drift warns and never refuses): today a drifted changeset's landing is
// refused without force, and the status says so. When that lands, these three lines are the edit.
const DRIFTED_LANDING = LANDING_WHEN_DRIFT_BLOCKS;
const DRIFTED_LANDING_WORDS = "force: true";
const DRIFT_REFUSES_LANDING = true;

describe("project_status over MCP", () => {
  function git(cwd: string, ...args: string[]): string {
    const result = spawnSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
      { cwd, encoding: "utf-8" }
    );
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout.trim();
  }

  // #1227, #1228, #1195: one call says what drifted under a staged plan and in the code, whether a
  // landing is refused, and which tool comes next.
  it("says what drifted, what a landing does and what to call, in one small answer", async () => {
    const project = await realpath(await mkdir(join(testDir, "drifting"), { recursive: true }).then(() => join(testDir, "drifting")));
    git(project, "init", "-q");
    await writeFile(join(project, ".gitignore"), ".dr/\n");
    const state = await startServer([project]);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await callTool(state, name, args);
      if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.body)}`);
      return result.body;
    };

    // A model whose two elements reference src/checkout.ts and nothing else.
    await call("project_init", { name: "Drifting Project" });
    await call("model_add", {
      layer: "application",
      type: "applicationservice",
      name: "checkout",
      attributes: { serviceType: "synchronous" },
      sourceFile: "src/checkout.ts",
      sourceProvenance: "extracted",
    });
    await call("model_add", { layer: "application", type: "applicationfunction", name: "audit", sourceFile: "src/checkout.ts", sourceProvenance: "extracted" });
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, "src", "checkout.ts"), "export const checkout = 1;\n");
    git(project, "add", "-A");
    git(project, "commit", "-q", "-m", "code and an empty model");
    const extracted = git(project, "rev-parse", "HEAD");

    // While the bootstrap is reviewed, other work merges: a change to modelled code and a new file.
    await writeFile(join(project, "src", "checkout.ts"), "export const checkout = 2;\n");
    await writeFile(join(project, "src", "lighting.ts"), "export const lighting = 1;\n");
    git(project, "add", "-A");
    git(project, "commit", "-q", "-m", "merge other work");
    // The bootstrap lands (its stamp names the commit the extraction read) and is committed after.
    const manifestPath = join(project, "documentation-robotics/model/manifest.yaml");
    const manifest = await manifestOf(project);
    manifest.reconciled = { changeset: "extract-bootstrap", changeset_id: "changeset-bootstrap", landed_at: "2020-01-01T00:00:00.000Z", code_commit: extracted };
    await writeFile(manifestPath, yaml.stringify(manifest));
    git(project, "add", "-A");
    git(project, "commit", "-q", "-m", "bootstrap the model");
    const landed = git(project, "rev-parse", "HEAD");

    // A plan rewords an element; the base then changes that element under it.
    const plan = await call("changeset_create", { name: "reword-audit", description: "Reword the audit function." });
    await call("model_update", { id: "application.applicationfunction.audit", description: "Audit log" });
    await call("changeset_deactivate");
    await call("model_update", { id: "application.applicationfunction.audit", description: "Audit trail" });

    const result = await callTool(state, "project_status");
    expect(result.isError).toBe(false);
    const status = result.body;

    // This server is the CLI on disk.
    expect(status.server).toEqual({ status: "current", version: getCliVersion(), comparedWith: process.cwd() });

    // The plan, set aside: that it drifted, what a landing does about it and the call for the detail.
    expect(status.changesets.staged).toHaveLength(1);
    expect(status.changesets.staged[0]).toMatchObject({
      name: "reword-audit",
      baseDrifted: true,
      drift: {
        state: "drifted",
        landing: DRIFTED_LANDING,
        next: { tool: "changeset_brief", args: { changeset: plan.id, sections: ["drift"] } },
      },
    });
    // The staged list in full says what moved under it and what overlaps.
    const staged = await call("project_status", { list: "stagedChangesets" });
    expect(staged.items[0].drift).toMatchObject({
      baseChanges: { elementsChanged: 1 },
      overlapping: { elements: 1, relationships: 0, first: ["application.applicationfunction.audit (changed-in-base)"] },
    });
    // The landing is refused as the status said it would be (follows tranche 2: see DRIFTED_LANDING).
    const preview = await callTool(state, "changeset_commit_preview", { changeset: "reword-audit" });
    expect(preview.isError).toBe(DRIFT_REFUSES_LANDING);
    expect(JSON.stringify(preview.body)).toContain(DRIFTED_LANDING_WORDS);
    // The call the status names answers with the drift.
    const brief = await call("changeset_brief", status.changesets.staged[0].drift.next.args);
    expect(JSON.stringify(brief)).toContain("application.applicationfunction.audit");

    // The code: counted from the commit the extraction read, not the later commit that landed the model.
    expect(status.codeDrift).toMatchObject({
      status: "drift",
      basis: "last-reconciling-commit",
      modelCommit: { sha: landed },
      countedFrom: { sha: extracted },
      commitsSince: 1,
      referencedFilesChanged: 1,
      changedSourceFiles: [{ file: "src/checkout.ts", elementCount: 2 }],
      unreferenced: { files: 1, sourceFiles: 1, newSourceFiles: 1, first: ["src/lighting.ts"] },
    });
    expect(status.codeDrift.rule).toContain(`Counted from ${extracted.slice(0, 7)}, the code the as-built landing "extract-bootstrap" read`);

    // The next step names the tool, and the catch-up reads from the extraction's commit.
    expect(status.nextStep.tool).toBe("codebase_index");
    expect(status.nextStep.then.tool).toBe("codebase_verify");
    expect(status.nextStep.summary).toContain(`codebase_extract with since: "${extracted.slice(0, 7)}" and no plan active`);

    // A list the status shortens is returned in full by the same tool, paged.
    const unreferenced = await call("project_status", { list: "unreferencedFiles", limit: 1 });
    expect(unreferenced).toEqual({
      list: "unreferencedFiles",
      items: [{ file: "src/lighting.ts", source: true, added: true }],
      page: { total: 1, returned: 1, offset: 0 },
    });
    const refused = await callTool(state, "project_status", { offset: 3 });
    expect(refused.isError).toBe(true);

    // It opens every session: the whole answer stays small.
    expect(JSON.stringify(status).length).toBeLessThan(5000);
    expectCleanStdout(state);
  }, 120000);
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
