/**
 * changeset_commit over MCP: it lands a changeset only after a person confirms it in an
 * elicitation dialog. Driven through a real MCP client over an in-memory transport, with and
 * without the elicitation capability.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ElicitRequestSchema, type ElicitRequest, type ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { Model } from "../../../src/core/model.js";
import { CHANGESET_ONLY_ENV } from "../../../src/core/changeset-only-guard.js";
import { McpToolRegistry } from "../../../src/mcp/tool-registry.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import {
  changesetActivateHandler,
  changesetCreateHandler,
  changesetDeactivateHandler,
} from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetShowHandler } from "../../../src/mcp/tools/changeset-show.js";
import { changesetUnstageHandler } from "../../../src/mcp/tools/changeset-editing.js";

const GOAL = "motivation.goal.faster-checkout";
const FUNCTION = "application.applicationfunction.export-orders";
const ACCEPT: ElicitResult = { action: "accept", content: { confirm: true } };

let rootPath: string;
let savedEnv: string | undefined;
let client: Client | undefined;
let elicitations: ElicitRequest["params"][];

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

function text(result: any): string {
  return result.content[0].text;
}

/** Connects an in-memory client to a server carrying the real tool surface. */
async function connect(options: {
  elicitation: boolean;
  answer?: ElicitResult;
  /** Runs while the dialog is open, before the answer is sent. */
  whileAsking?: () => Promise<void>;
}): Promise<Client> {
  const server = new McpServer({ name: "dr-test", version: "0.0.0" });
  new McpToolRegistry().registerAll(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const created = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: options.elicitation ? { elicitation: {} } : {} }
  );
  if (options.elicitation) {
    created.setRequestHandler(ElicitRequestSchema, async (request) => {
      elicitations.push(request.params);
      await options.whileAsking?.();
      return options.answer ?? { action: "cancel" };
    });
  }
  await created.connect(clientTransport);
  client = created;
  return created;
}

async function commit(c: Client, args: Record<string, unknown> = {}): Promise<any> {
  return c.callTool({ name: "changeset_commit", arguments: { changeset: "export-orders", rootPath, ...args } });
}

/** Every file under the base model directory, concatenated: what a commit writes. */
async function baseModelText(): Promise<string> {
  const dir = join(rootPath, "documentation-robotics", "model");
  // readdir's recursive order isn't stable, so sort the paths before comparing the contents.
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((f) => join(f.parentPath, f.name))
    .sort();
  const texts = await Promise.all(files.map((f) => readFile(f, "utf-8")));
  return texts.join("\n");
}

async function changesetStatus(): Promise<string> {
  return parse(await changesetShowHandler({ changesetId: "export-orders", rootPath })).status;
}

/** A goal in the base, and a changeset staging a function that realizes... a service realizing it. */
async function planExportOrders(): Promise<void> {
  await changesetCreateHandler({ name: "export-orders", description: "Admins export orders as CSV", rootPath });
  await modelAddHandler({ layer: "application", type: "applicationfunction", name: "export-orders", rootPath });
  await modelAddHandler({
    layer: "application",
    type: "applicationservice",
    name: "order-export",
    attributes: { serviceType: "synchronous" },
    rootPath,
  });
  const staged = await relationshipAddHandler({
    source: "application.applicationservice.order-export",
    predicate: "realizes",
    target: GOAL,
    rootPath,
  });
  expect(parse(staged).status).toBe("staged");
}

beforeEach(async () => {
  savedEnv = process.env[CHANGESET_ONLY_ENV];
  delete process.env[CHANGESET_ONLY_ENV];
  clearModelCache();
  elicitations = [];
  rootPath = join(tmpdir(), `dr-mcp-changeset-commit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Changeset Commit Test Model", version: "0.1.0" });
  await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" }, rootPath });
  await planExportOrders();
});

afterEach(async () => {
  await client?.close();
  client = undefined;
  if (savedEnv === undefined) delete process.env[CHANGESET_ONLY_ENV];
  else process.env[CHANGESET_ONLY_ENV] = savedEnv;
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("changeset_commit listing", () => {
  it("is listed with anthropic/requiresUserInteraction in tools/list, and no other tool is", async () => {
    const c = await connect({ elicitation: true });
    const { tools } = await c.listTools();
    const commitTool = tools.find((t) => t.name === "changeset_commit");
    expect(commitTool?._meta).toEqual({ "anthropic/requiresUserInteraction": true });
    expect(commitTool?.inputSchema.required).toContain("changeset");
    expect(tools.filter((t) => t._meta?.["anthropic/requiresUserInteraction"]).map((t) => t.name)).toEqual([
      "changeset_commit",
    ]);
  });
});

describe("changeset_commit confirmation", () => {
  it("commits on accept with confirm: true, after showing the name, intent, counts and layers", async () => {
    const c = await connect({ elicitation: true, answer: { action: "accept", content: { confirm: true } } });
    const result = await commit(c);
    expect(result.isError).toBeFalsy();
    expect(parse(result)).toMatchObject({
      name: "export-orders",
      status: "committed",
      committed: 3,
      failed: 0,
      deactivated: true,
    });

    expect(elicitations).toHaveLength(1);
    const asked = elicitations[0] as any;
    expect(asked.message).toContain('Commit changeset "export-orders"');
    expect(asked.message).toContain("Intent: Admins export orders as CSV");
    expect(asked.message).toContain("Changes: 3 (2 adds, 1 relationship adds)");
    expect(asked.message).toContain("Layers: application");
    expect(asked.message).toContain("Drift: none");
    expect(asked.requestedSchema).toEqual({
      type: "object",
      properties: { confirm: expect.objectContaining({ type: "boolean" }) },
      required: ["confirm"],
    });

    expect(await changesetStatus()).toBe("committed");
    const base = await baseModelText();
    expect(base).toContain(FUNCTION);
    expect(base).toContain("application.applicationservice.order-export");

    // No as-built landing is recorded, so the earlier drift rule applies: committing this resets it.
    expect(parse(result).reconciled).toBeUndefined();
    expect(parse(result).codeDrift).toContain("no as-built landing recorded");
    expect(parse(result).codeDrift).not.toContain("doesn't reconcile");
  });

  it("says a plan landing doesn't reset drift once the model records an as-built landing", async () => {
    const manifestPath = join(rootPath, "documentation-robotics", "model", "manifest.yaml");
    const manifest = yaml.parse(await readFile(manifestPath, "utf-8"));
    manifest.reconciled = { changeset: "extract-bootstrap", changeset_id: "cs-bootstrap", landed_at: "2026-11-01T00:00:00.000Z" };
    await writeFile(manifestPath, yaml.stringify(manifest));
    clearModelCache();

    // Stamping the manifest after the changeset was created reads as base drift: land it anyway.
    const c = await connect({ elicitation: true, answer: ACCEPT });
    const result = parse(await commit(c, { force: true }));
    expect(result.status).toBe("committed");
    expect(result.reconciled).toBeUndefined();
    expect(result.codeDrift).toContain("doesn't reconcile");
    expect(result.codeDrift).toContain('"extract-bootstrap"');
  });

  for (const [label, answer] of [
    ["declined", { action: "decline" }],
    ["cancelled", { action: "cancel" }],
    ["did not confirm it", { action: "accept", content: { confirm: false } }],
  ] as const) {
    it(`refuses and writes nothing when the user ${label}`, async () => {
      const before = await baseModelText();
      const c = await connect({ elicitation: true, answer: answer as ElicitResult });
      const result = await commit(c);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain(`the user ${label}`);
      expect(elicitations).toHaveLength(1);
      expect(await changesetStatus()).toBe("staged");
      expect(await baseModelText()).toBe(before);
    });
  }

  it("refuses a client without the elicitation capability, pointing at the viewer and an interactive session, never the CLI", async () => {
    const before = await baseModelText();
    const c = await connect({ elicitation: false });
    const result = await commit(c);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("does not support MCP elicitation");
    expect(text(result)).toContain("Apply");
    expect(text(result)).toContain("interactive Claude Code session");
    // Round 3: agents passed the CLI fallback on to the developer, who types no dr command.
    expect(text(result)).not.toContain("dr changeset");
    expect(await changesetStatus()).toBe("staged");
    expect(await baseModelText()).toBe(before);
  });

  it("refuses in changeset-only mode without asking", async () => {
    process.env[CHANGESET_ONLY_ENV] = "true";
    const c = await connect({ elicitation: true, answer: { action: "accept", content: { confirm: true } } });
    const result = await commit(c);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("changeset-only mode");
    expect(elicitations).toHaveLength(0);
    expect(await changesetStatus()).toBe("staged");
  });
});

describe("changeset_commit drift and edge cases", () => {
  /** Changes the base under the staged changeset. */
  async function driftTheBase(): Promise<void> {
    await changesetDeactivateHandler({ rootPath });
    await modelAddHandler({ layer: "motivation", type: "goal", name: "lower-costs", attributes: { priority: "low" }, rootPath });
  }

  it("refuses a drifted changeset without force, naming the drift, and does not ask", async () => {
    await driftTheBase();
    const c = await connect({ elicitation: true, answer: { action: "accept", content: { confirm: true } } });
    const result = await commit(c);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("the base model changed");
    expect(text(result)).toContain("force: true");
    expect(elicitations).toHaveLength(0);
    expect(await changesetStatus()).toBe("staged");
  });

  it("with force, shows the drift in the dialog and commits a changeset that is not active", async () => {
    await driftTheBase();
    const c = await connect({ elicitation: true, answer: { action: "accept", content: { confirm: true } } });
    const result = await commit(c, { force: true });
    expect(result.isError).toBeFalsy();
    expect(parse(result)).toMatchObject({ status: "committed", deactivated: false, driftOverridden: true });
    const message = (elicitations[0] as any).message as string;
    expect(message).toContain("Drift: the base model changed");
    expect(message).toContain("Committing anyway: force was passed");
    expect(await baseModelText()).toContain(FUNCTION);
  });

  it("reports an empty changeset as nothing to commit, without asking", async () => {
    await changesetCreateHandler({ name: "empty", rootPath });
    const c = await connect({ elicitation: true, answer: { action: "accept", content: { confirm: true } } });
    const result = await commit(c, { changeset: "empty" });
    expect(parse(result)).toMatchObject({ status: "nothing-to-commit", stagedChanges: 0 });
    expect(elicitations).toHaveLength(0);
  });

  it("refuses a changeset that is not staged", async () => {
    const c = await connect({ elicitation: true, answer: { action: "accept", content: { confirm: true } } });
    expect((await commit(c)).isError).toBeFalsy();
    const again = await commit(c);
    expect(again.isError).toBe(true);
    expect(text(again)).toContain("is committed");
    expect(elicitations).toHaveLength(1);
  });
});

describe("changeset_commit checks what was confirmed", () => {
  it("refuses when the changeset changed while the dialog was open", async () => {
    const before = await baseModelText();
    const c = await connect({
      elicitation: true,
      answer: ACCEPT,
      whileAsking: async () => {
        await modelAddHandler({ layer: "application", type: "applicationfunction", name: "late-addition", rootPath });
      },
    });
    const result = await commit(c);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("changed while the user was confirming");
    expect(await changesetStatus()).toBe("staged");
    expect(await baseModelText()).toBe(before);
  });

  it("refuses when the base model changed while the dialog was open, even with force", async () => {
    const c = await connect({
      elicitation: true,
      answer: ACCEPT,
      whileAsking: async () => {
        await changesetDeactivateHandler({ rootPath });
        await modelAddHandler({ layer: "motivation", type: "goal", name: "lower-costs", attributes: { priority: "low" }, rootPath });
      },
    });
    const result = await commit(c, { force: true });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("changed while the user was confirming");
    expect(await changesetStatus()).toBe("staged");
    expect(await baseModelText()).not.toContain(FUNCTION);
  });
});

describe("changeset_commit with another changeset active", () => {
  it("lands only the named changeset's relationships, not the active one's", async () => {
    // "export-orders" (from beforeEach) stages order-export realizes the goal. "bbb" stages s1
    // realizes the goal; "export-orders" is active again when "bbb" is committed.
    await changesetCreateHandler({ name: "bbb", rootPath });
    await modelAddHandler({
      layer: "application",
      type: "applicationservice",
      name: "s1",
      attributes: { serviceType: "synchronous" },
      rootPath,
    });
    await relationshipAddHandler({ source: "application.applicationservice.s1", predicate: "realizes", target: GOAL, rootPath });
    await changesetActivateHandler({ changesetId: "export-orders", rootPath });

    const c = await connect({ elicitation: true, answer: ACCEPT });
    const result = await commit(c, { changeset: "bbb" });
    expect(parse(result)).toMatchObject({ name: "bbb", status: "committed", committed: 2, deactivated: false });

    const relationships = await readFile(join(rootPath, "documentation-robotics", "model", "relationships.yaml"), "utf-8");
    const base = await Model.load(rootPath, { lazyLoad: false });
    expect(relationships).toContain("source: application.applicationservice.s1");
    // The active changeset's staged service and relationship stay staged, out of the base.
    expect(await baseModelText()).not.toContain("application.applicationservice.order-export");
    expect(base.getBaseRelationships()).toHaveLength(1);
    expect(await changesetStatus()).toBe("staged");
  });
});

// Round-2 friction: landing the as-built changeset first drifted the plan's base, so the plan then
// needed force and its descriptions didn't apply. The dialog now says the plan should land instead.
describe("changeset_commit of an as-built changeset while a plan is staged", () => {
  async function stageAsBuilt(): Promise<void> {
    await changesetCreateHandler({
      name: "export-orders-as-built",
      description: "As-built extraction of the code at abc1234, files changed since main. Staged by codebase_extract.",
      rootPath,
    });
    await modelAddHandler({
      layer: "application",
      type: "applicationfunction",
      name: "export-orders-csv",
      sourceFile: "src/export.ts",
      sourceSymbol: "exportOrdersCsv",
      sourceProvenance: "extracted",
      rootPath,
    } as any);
  }

  it("warns in the dialog that the plan should land instead, and still commits on accept", async () => {
    await stageAsBuilt();
    const c = await connect({ elicitation: true, answer: ACCEPT });
    const result = await commit(c, { changeset: "export-orders-as-built" });
    expect(parse(result).status).toBe("committed");
    expect(parse(result).warnings[0]).toContain('the plan "export-orders" is still staged');

    const message = (elicitations[0] as any).message as string;
    expect(message).toContain('"export-orders-as-built" is an as-built changeset from codebase_extract');
    expect(message).toContain('the plan "export-orders" is still staged');
    expect(message).toContain("land the plan instead");
  });

  it("does not warn when the plan itself lands", async () => {
    await stageAsBuilt();
    const c = await connect({ elicitation: true, answer: ACCEPT });
    const result = await commit(c, { changeset: "export-orders" });
    expect(parse(result).status).toBe("committed");
    expect(parse(result).warnings).toBeUndefined();
    expect((elicitations[0] as any).message).not.toContain("as-built changeset");
  });
});

describe("changeset_commit validates against the base and the named changeset only", () => {
  it("refuses, without asking, a reference only the active changeset satisfies", async () => {
    const y = "application.applicationservice.y";
    const addY = () =>
      modelAddHandler({ layer: "application", type: "applicationservice", name: "y", attributes: { serviceType: "synchronous" }, rootPath });
    // "bbb" stages x and "x realizes y" but not y; the active "export-orders" stages y.
    await changesetCreateHandler({ name: "bbb", rootPath });
    await modelAddHandler({ layer: "application", type: "applicationfunction", name: "x", rootPath });
    await addY();
    await relationshipAddHandler({ source: "application.applicationfunction.x", predicate: "realizes", target: y, rootPath });
    await changesetUnstageHandler({ elementId: y, keepRelationships: true, rootPath });
    await changesetActivateHandler({ changesetId: "export-orders", rootPath });
    await addY();

    const before = await baseModelText();
    const c = await connect({ elicitation: true, answer: ACCEPT });
    const result = await commit(c, { changeset: "bbb" });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(`Relationship target element '${y}' not found`);
    expect(elicitations).toHaveLength(0);
    expect(await baseModelText()).toBe(before);
  });
});
