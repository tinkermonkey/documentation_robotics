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
import {
  checkConfirmToken,
  confirmationTiming,
  issueConfirmToken,
} from "../../../src/mcp/tools/changeset-commit.js";

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
  /** The clientInfo the client sends in initialize (default test-client 0.0.0). */
  clientInfo?: { name: string; version: string };
}): Promise<Client> {
  const server = new McpServer({ name: "dr-test", version: "0.0.0" });
  new McpToolRegistry().registerAll(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const created = new Client(
    options.clientInfo ?? { name: "test-client", version: "0.0.0" },
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
  // Test clients answer at once; only the instant-decline tests treat that as the client's answer.
  confirmationTiming.instantDeclineMs = 0;
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

const CLAUDE_CODE = { name: "claude-code", version: "2.1.323" };

async function preview(c: Client, args: Record<string, unknown> = {}): Promise<any> {
  return c.callTool({ name: "changeset_commit_preview", arguments: { changeset: "export-orders", rootPath, ...args } });
}

describe("changeset_commit with a confirmation token from changeset_commit_preview", () => {
  it("is not listed with anthropic/requiresUserInteraction itself", async () => {
    const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    const { tools } = await c.listTools();
    const previewTool = tools.find((t) => t.name === "changeset_commit_preview");
    expect(previewTool).toBeDefined();
    expect(previewTool?._meta?.["anthropic/requiresUserInteraction"]).toBeUndefined();
  });

  it("previews without writing, then lands from Claude Code with the token and no dialog", async () => {
    const before = await baseModelText();
    // Print mode: Claude Code advertises elicitation but declines it; the token path never asks.
    const c = await connect({ elicitation: true, answer: { action: "decline" }, clientInfo: CLAUDE_CODE });
    const shown = parse(await preview(c));
    expect(shown.status).toBe("ready-to-commit");
    expect(shown.summary).toContain('Commit changeset "export-orders"');
    expect(shown.summary).toContain("Intent: Admins export orders as CSV");
    expect(typeof shown.confirmToken).toBe("string");
    expect(shown.next).toContain("permission prompt");
    expect(await baseModelText()).toBe(before);
    expect(await changesetStatus()).toBe("staged");

    const result = await commit(c, { confirmToken: shown.confirmToken });
    expect(result.isError).toBeFalsy();
    const landed = parse(result);
    expect(landed.status).toBe("committed");
    expect(landed.confirmedBy).toBe("permission-prompt");
    expect(elicitations).toHaveLength(0);
    expect(await changesetStatus()).toBe("committed");
  });

  it("gives no token to a client that doesn't ask before each call, and refuses a token from one", async () => {
    const claude = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    const { confirmToken } = parse(await preview(claude));
    await claude.close();

    const before = await baseModelText();
    const other = await connect({ elicitation: true, answer: ACCEPT });
    const shown = parse(await preview(other));
    expect(shown.confirmToken).toBeUndefined();
    expect(shown.next).toContain("dialog");
    const result = await commit(other, { confirmToken });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("only from a client that asks the person");
    expect(elicitations).toHaveLength(0);
    expect(await baseModelText()).toBe(before);
  });

  it("gives no token to a Claude Code older than the flag", async () => {
    const c = await connect({ elicitation: false, clientInfo: { name: "claude-code", version: "2.1.198" } });
    expect(parse(await preview(c)).confirmToken).toBeUndefined();
  });

  it("refuses the token when the changeset changed after the preview", async () => {
    const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    const { confirmToken } = parse(await preview(c));
    await modelAddHandler({ layer: "application", type: "applicationfunction", name: "import-orders", rootPath });
    const before = await baseModelText();
    const result = await commit(c, { confirmToken });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("changed since the preview");
    expect(text(result)).toContain("changeset_commit_preview again");
    expect(await changesetStatus()).toBe("staged");
    expect(await baseModelText()).toBe(before);
  });

  it("refuses the token when force differs from the preview's", async () => {
    const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    const { confirmToken } = parse(await preview(c));
    const result = await commit(c, { confirmToken, force: true });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("force changed since the preview");
    expect(await changesetStatus()).toBe("staged");
  });

  it("refuses the token when the base model changed after the preview", async () => {
    const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    // force: true, so the base change reaches the token check instead of the drift refusal.
    const { confirmToken } = parse(await preview(c, { force: true }));
    await changesetDeactivateHandler({ rootPath });
    await modelAddHandler({ layer: "motivation", type: "goal", name: "lower-costs", attributes: { priority: "low" }, rootPath });
    const before = await baseModelText();
    const result = await commit(c, { confirmToken, force: true });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("changed since the preview");
    expect(await changesetStatus()).toBe("staged");
    expect(await baseModelText()).toBe(before);
  });

  it("refuses a token changeset_commit_preview did not issue", async () => {
    const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    const result = await commit(c, { confirmToken: "not-a-token" });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not one changeset_commit_preview issued");
    expect(await changesetStatus()).toBe("staged");
  });

  it("refuses in changeset-only mode even with a token, and the preview says it is the user's to land", async () => {
    const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    process.env[CHANGESET_ONLY_ENV] = "true";
    const shown = parse(await preview(c));
    expect(shown.confirmToken).toBeUndefined();
    expect(shown.next).toContain("Apply");
    const { token } = issueConfirmToken("x", false, "state");
    const result = await commit(c, { confirmToken: token });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("changeset-only mode");
    expect(await changesetStatus()).toBe("staged");
  });
});

describe("confirmation tokens", () => {
  it("are good once, for the state, changeset and force they were issued for, until they expire", () => {
    const now = Date.now();
    const { token } = issueConfirmToken("cs-1", false, "state-a", now);
    expect(checkConfirmToken(token, "cs-1", false, "state-b", now)).toBe("mismatch");
    expect(checkConfirmToken(token, "cs-2", false, "state-a", now)).toBe("mismatch");
    expect(checkConfirmToken(token, "cs-1", true, "state-a", now)).toBe("mismatch");
    expect(checkConfirmToken(token, "cs-1", false, "state-a", now + confirmationTiming.tokenTtlMs + 1)).toBe("expired");
    expect(checkConfirmToken(token, "cs-1", false, "state-a", now)).toBe("ok");
    expect(checkConfirmToken(token, "cs-1", false, "state-a", now)).toBe("used");
    expect(checkConfirmToken("abc", "cs-1", false, "state-a", now)).toBe("malformed");
  });

  it("can't be reused by spelling the expiry another way", () => {
    const now = Date.now();
    const { token } = issueConfirmToken("cs-1", false, "state-a", now);
    const [expiry, digest] = token.split(".");
    expect(checkConfirmToken(token, "cs-1", false, "state-a", now)).toBe("ok");
    for (const respelled of [`${expiry.toUpperCase()}.${digest}`, `0${expiry}.${digest}`, `${expiry}~.${digest}`]) {
      expect(["malformed", "used"]).toContain(checkConfirmToken(respelled, "cs-1", false, "state-a", now));
    }
  });
});

describe("changeset_commit when the client declines the dialog at once", () => {
  for (const action of ["decline", "cancel"] as const) {
    it(`reports an instant ${action} as a dialog that could not be shown, pointing Claude Code at the preview`, async () => {
      confirmationTiming.instantDeclineMs = 60_000;
      const before = await baseModelText();
      const c = await connect({ elicitation: true, answer: { action }, clientInfo: CLAUDE_CODE });
      const result = await commit(c);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("the confirmation dialog could not be shown");
      expect(text(result)).not.toContain("the user declined");
      expect(text(result)).toContain("changeset_commit_preview");
      expect(text(result)).toContain("Apply");
      expect(text(result)).not.toContain("dr changeset");
      expect(await changesetStatus()).toBe("staged");
      expect(await baseModelText()).toBe(before);
    });
  }

  it("doesn't point other clients at the preview", async () => {
    confirmationTiming.instantDeclineMs = 60_000;
    const c = await connect({ elicitation: true, answer: { action: "decline" } });
    const result = await commit(c);
    expect(text(result)).toContain("could not be shown");
    expect(text(result)).not.toContain("changeset_commit_preview");
  });

  it("still reports a decline a person took time over as declined", async () => {
    confirmationTiming.instantDeclineMs = 20;
    const c = await connect({
      elicitation: true,
      answer: { action: "decline" },
      whileAsking: () => new Promise((resolve) => setTimeout(resolve, 60)),
      clientInfo: CLAUDE_CODE,
    });
    const result = await commit(c);
    expect(text(result)).toContain("the user declined");
  });
});
