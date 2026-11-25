/**
 * changeset_commit over MCP: it lands a changeset only after a person confirms it in an
 * elicitation dialog. Driven through a real MCP client over an in-memory transport, with and
 * without the elicitation capability.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
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
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import {
  changesetActivateHandler,
  changesetCreateHandler,
  changesetDeactivateHandler,
} from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetShowHandler } from "../../../src/mcp/tools/changeset-show.js";
import { changesetBriefHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";
import { changesetListHandler } from "../../../src/mcp/tools/changeset-list.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import {
  sameRootPath,
  subscribeCommitProgress,
  type PublishedCommitProgress,
} from "../../../src/core/commit-progress.js";
import { extractionPurpose } from "../../../src/core/changeset-purpose.js";
import { changesetUnstageHandler, changesetUpdateHandler } from "../../../src/mcp/tools/changeset-editing.js";
import {
  CONFIRM_TOKEN_TTL_MS,
  OVERLAPS_NAMED_PER_KIND,
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

/** The id of the plan the tests stage. */
async function planId(): Promise<string> {
  return parse(await changesetShowHandler({ changesetId: "export-orders", rootPath })).id;
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

  it("publishes the commit's progress for the checkout, ending with applied == total (#1361)", async () => {
    const heard: PublishedCommitProgress[] = [];
    const stop = subscribeCommitProgress((p) => heard.push(p));
    try {
      const c = await connect({ elicitation: true, answer: ACCEPT });
      expect((await commit(c)).isError).toBeFalsy();
    } finally {
      stop();
    }
    const id = await planId();
    const mine = heard.filter((p) => p.changesetId === id);
    expect(mine[0]).toMatchObject({ phase: "validating", applied: 0, total: 3 });
    expect(mine.at(-1)).toMatchObject({ phase: "done", applied: 3, total: 3 });
    expect(mine.every((p) => sameRootPath(p.rootPath, rootPath))).toBe(true);
    // The dialog's dry run reports nothing: only the real commit does.
    expect(mine.filter((p) => p.phase === "validating")).toHaveLength(1);
  });

  it("ends a failed commit's progress with failed: true in the phase it stopped in (#1361)", async () => {
    const heard: PublishedCommitProgress[] = [];
    const stop = subscribeCommitProgress((p) => heard.push(p));
    const backup = spyOn(StagingAreaManager.prototype as any, "backupModel").mockImplementation(async () => {
      throw new Error("disk full");
    });
    try {
      const c = await connect({ elicitation: true, answer: ACCEPT });
      expect((await commit(c)).isError).toBe(true);
    } finally {
      backup.mockRestore();
      stop();
    }
    const mine = heard.filter((p) => p.changesetId === (heard[0]?.changesetId ?? ""));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.at(-1)).toMatchObject({ phase: "validating", applied: 0, total: 3, failed: true });
    expect(mine.some((p) => p.phase === "done")).toBe(false);
    expect(await changesetStatus()).toBe("staged");
  });

  it("says a plan landing doesn't reset drift once the model records an as-built landing", async () => {
    const manifestPath = join(rootPath, "documentation-robotics", "model", "manifest.yaml");
    const manifest = yaml.parse(await readFile(manifestPath, "utf-8"));
    manifest.reconciled = { changeset: "extract-bootstrap", changeset_id: "cs-bootstrap", landed_at: "2026-11-01T00:00:00.000Z" };
    await writeFile(manifestPath, yaml.stringify(manifest));
    clearModelCache();

    // Stamping the manifest after the changeset was created changes no content, so it is not drift
    // (the base hash covers content only, #1169) and nothing is said about it.
    const c = await connect({ elicitation: true, answer: ACCEPT });
    const result = parse(await commit(c));
    expect(result.status).toBe("committed");
    expect(result.drift).toBeUndefined();
    expect((elicitations[0] as any).message).toContain("Drift: none");
    expect(result.reconciled).toBeUndefined();
    expect(result.codeDrift).toContain("doesn't reconcile");
    expect(result.codeDrift).toContain('"extract-bootstrap"');
  });

  // #1207: a dialog can come back unanswered by any person (the client declined or cancelled it
  // for them), so no refusal claims more than the tool knows, and each names a route with no dialog.
  for (const [label, answer, says] of [
    ["the dialog comes back declined", { action: "decline" }, "the confirmation dialog came back declined"],
    ["no confirmation comes back (cancel)", { action: "cancel" }, "no confirmation came back"],
    ["the user answers without confirming", { action: "accept", content: { confirm: false } }, "without confirming it"],
  ] as const) {
    it(`refuses and writes nothing when ${label}`, async () => {
      const before = await baseModelText();
      const c = await connect({ elicitation: true, answer: answer as ElicitResult });
      const result = await commit(c);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain(says);
      expect(text(result)).toContain("Nothing was written");
      expect(elicitations).toHaveLength(1);
      expect(await changesetStatus()).toBe("staged");
      expect(await baseModelText()).toBe(before);
    });
  }

  it("does not say the user declined when no confirmation came back, and names the viewer's Apply (#1207)", async () => {
    const c = await connect({ elicitation: true, answer: { action: "cancel" } });
    const result = await commit(c);
    expect(text(result)).not.toContain("the user declined");
    expect(text(result)).toContain("may not have been shown");
    expect(text(result)).toContain("Remote Control");
    expect(text(result)).toContain("review_open");
    expect(text(result)).toContain("Apply");
    expect(text(result)).not.toContain("dr changeset");
  });

  it("says a decline may have been the client's, and points Claude Code at the preview and its token (#1239)", async () => {
    const c = await connect({ elicitation: true, answer: { action: "decline" }, clientInfo: CLAUDE_CODE });
    const result = await commit(c);
    expect(text(result)).toContain("If the user did not decline it themselves");
    expect(text(result)).toContain("changeset_commit_preview");
    expect(text(result)).toContain("Apply");
    expect(text(result)).not.toMatch(/\bdr changeset\b|--force|force: true/);
  });

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
  /** Changes, in the base, the goal the staged changeset links to. */
  async function driftTheBase(): Promise<void> {
    await changesetDeactivateHandler({ rootPath });
    await modelUpdateHandler({ id: GOAL, description: "Checkout in under a minute", rootPath } as any);
  }

  /** The plan rewords the goal, and so does the base afterwards: the staged update is on older content. */
  async function overlapTheGoal(): Promise<void> {
    await modelUpdateHandler({ id: GOAL, description: "Checkout in one step", rootPath } as any);
    await changesetDeactivateHandler({ rootPath });
    await modelUpdateHandler({ id: GOAL, description: "Checkout in under a minute", rootPath } as any);
  }

  // #1200: drift warns, it does not refuse. The dialog is where the person decides, so it names
  // each overlap and what landing does about it; the result repeats it.
  it("lands a drifted changeset without force: the dialog names the overlap and what landing does, and so does the result", async () => {
    await overlapTheGoal();
    const c = await connect({ elicitation: true, answer: ACCEPT });
    const result = await commit(c);
    expect(result.isError).toBeFalsy();
    const landed = parse(result);
    expect(landed).toMatchObject({ status: "committed", deactivated: false, confirmedBy: "dialog" });
    expect(landed.driftOverridden).toBeUndefined();
    expect(landed.drift.landedOver).toContain("overlapped 1 staged change(s)");
    expect(landed.drift.total).toBe(1);
    expect(landed.drift.kinds).toHaveLength(1);
    expect(landed.drift.kinds[0]).toMatchObject({ reason: "changed-in-base", of: "element", count: 1, items: [GOAL] });
    expect(landed.drift.kinds[0].consequence).toContain("landing replaces the base's edit with the plan's version");
    expect(landed.warnings).toBeUndefined();

    const message = (elicitations[0] as any).message as string;
    expect(message).toContain("Drift: the base model changed under this changeset.");
    expect(message).toContain("1 staged change(s) overlap the base. Landing goes ahead, and does this:");
    expect(message).toContain("- changed-in-base, 1 element(s): The base edited this element");
    expect(message).toContain(`      ${GOAL}`);
    // Everything is named, so nothing points elsewhere.
    expect(message).not.toContain("not named here");
    expect(message).not.toContain("force");
    expect(await baseModelText()).toContain("Checkout in one step");
  });

  // The maintainer's rule on limits: a default length never passes for completeness. With more
  // overlaps than the summary names, it gives the true count, what landing does for every kind, how
  // many it did not name and the call that names them all; the result names every one.
  describe("with more overlaps than the summary names", () => {
    const MANY = OVERLAPS_NAMED_PER_KIND + 4;
    const goals = Array.from({ length: MANY }, (_, i) => `motivation.goal.goal-${String(i).padStart(2, "0")}`);

    /** MANY goals in the base, each reworded by the plan and then by the base, plus one add the base already has. */
    async function overlapManyGoals(): Promise<void> {
      await changesetDeactivateHandler({ rootPath });
      for (const id of goals) {
        await modelAddHandler({ layer: "motivation", type: "goal", name: id.split(".")[2], attributes: { priority: "low" }, rootPath });
      }
      await changesetCreateHandler({ name: "reword-goals", description: "Reword every goal", rootPath });
      for (const id of goals) await modelUpdateHandler({ id, description: "The plan's wording", rootPath } as any);
      await modelAddHandler({ layer: "motivation", type: "goal", name: "shared-goal", attributes: { priority: "low" }, rootPath });
      await changesetDeactivateHandler({ rootPath });
      for (const id of goals) await modelUpdateHandler({ id, description: "The base's wording", rootPath } as any);
      await modelAddHandler({ layer: "motivation", type: "goal", name: "shared-goal", attributes: { priority: "high" }, rootPath });
    }

    it("the summary gives the true count and every kind, says how many it did not name, and where they all are", async () => {
      await overlapManyGoals();
      const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
      const shown = parse(await preview(c, { changeset: "reword-goals" }));

      expect(shown.overlaps).toEqual({ total: MANY + 1, named: OVERLAPS_NAMED_PER_KIND + 1 });
      expect(shown.summary).toContain(`${MANY + 1} staged change(s) overlap the base.`);
      // Every kind is there with its own count and consequence, the short one too.
      expect(shown.summary).toContain(`- changed-in-base, ${MANY} element(s): The base edited this element`);
      expect(shown.summary).toContain("- already-in-base, 1 element(s): The base already has this element");
      expect(shown.summary).toContain("      motivation.goal.shared-goal");
      expect(shown.summary).toContain(`      ${goals[OVERLAPS_NAMED_PER_KIND - 1]}`);
      expect(shown.summary).not.toContain(`      ${goals[OVERLAPS_NAMED_PER_KIND]}`);
      expect(shown.summary).toContain("      and 4 more");
      expect(shown.summary).toContain(`4 of the ${MANY + 1} are not named here.`);
      expect(shown.summary).toContain('changeset_brief with changeset: "reword-goals" and sections: ["drift"] names every one');
      expect(shown.more).toContain(`names ${OVERLAPS_NAMED_PER_KIND + 1} of the ${MANY + 1} overlaps`);
      expect(shown.more).toContain('sections: ["drift"]');

      // The call it names does list every one.
      const brief = parse(await changesetBriefHandler({ changeset: "reword-goals", sections: ["drift"], rootPath } as any));
      expect(brief.drift.overlapping.elements).toHaveLength(MANY + 1);
    });

    it("the token covers the whole set, and the result names every overlap it landed over", async () => {
      await overlapManyGoals();
      const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
      const { confirmToken } = parse(await preview(c, { changeset: "reword-goals" }));

      // A change to an overlap the summary did not name still refuses the token.
      await modelUpdateHandler({ id: goals[MANY - 1], description: "Reworded again in the base", rootPath } as any);
      const refused = await commit(c, { changeset: "reword-goals", confirmToken });
      expect(refused.isError).toBe(true);
      expect(text(refused)).toContain("changed since the preview");

      const again = parse(await preview(c, { changeset: "reword-goals" }));
      const landed = parse(await commit(c, { changeset: "reword-goals", confirmToken: again.confirmToken }));
      expect(landed.status).toBe("committed");
      expect(landed.drift.total).toBe(MANY + 1);
      const changed = landed.drift.kinds.find((kind: any) => kind.reason === "changed-in-base");
      expect(changed.count).toBe(MANY);
      expect(changed.items).toEqual(goals);
      expect(landed.drift.kinds.find((kind: any) => kind.reason === "already-in-base").items).toEqual(["motivation.goal.shared-goal"]);
    });

    it("changeset_brief pages what changed in the base to the end, by the call its more line names", async () => {
      await overlapManyGoals();
      const read = async (args: Record<string, unknown>) =>
        parse(await changesetBriefHandler({ changeset: "reword-goals", sections: ["drift"], rootPath, ...args } as any)).drift;

      const seen: string[] = [];
      let drift = await read({ driftLimit: 5 });
      expect(drift.overlapping.elements).toHaveLength(MANY + 1);
      expect(drift.baseChanges.counts.elementsChanged).toBe(MANY);
      for (;;) {
        seen.push(...drift.baseChanges.elementsChanged);
        const next = drift.baseChanges.page.nextOffset;
        if (next === undefined) break;
        expect(drift.baseChanges.page.more).toContain(`driftLimit: 5, driftOffset: ${next}`);
        drift = await read({ driftLimit: 5, driftOffset: next });
      }
      expect(seen.sort()).toEqual([...goals].sort());
    });

    it("the dialog says the same", async () => {
      await overlapManyGoals();
      const c = await connect({ elicitation: true, answer: ACCEPT });
      expect(parse(await commit(c, { changeset: "reword-goals" })).status).toBe("committed");
      const message = (elicitations[0] as any).message as string;
      expect(message).toContain(`${MANY + 1} staged change(s) overlap the base.`);
      expect(message).toContain(`4 of the ${MANY + 1} are not named here.`);
    });
  });

  it("says in the summary what could not be checked without a base index, and does not claim nothing overlaps", async () => {
    await rm(join(rootPath, "documentation-robotics", "changesets", await planId(), "base-index.json"));
    await changesetDeactivateHandler({ rootPath });
    await modelAddHandler({ layer: "motivation", type: "goal", name: "lower-costs", attributes: { priority: "low" }, rootPath });

    const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    const shown = parse(await preview(c));
    expect(shown.summary).toContain("No overlap was found in what could be checked.");
    expect(shown.summary).toContain("Not checked: 1 staged relationship change(s) were not checked");
    expect(shown.summary).toContain("rebaseline: true records a base index");
    expect(shown.summary).not.toContain("Nothing this changeset stages overlaps it");
    const landed = parse(await commit(c, { confirmToken: shown.confirmToken }));
    expect(landed.status).toBe("committed");
    expect(landed.drift.notChecked).toContain("Not checked:");
  });

  it("never says Drift: none while something could not be checked, also with the base hash matching (review 2)", async () => {
    // The plan's change to the goal with no `before`, no base index, then a re-baseline.
    await modelUpdateHandler({ id: GOAL, description: "Checkout in one step", rootPath } as any);
    const dir = join(rootPath, "documentation-robotics", "changesets", await planId());
    const changes = yaml.parse(await readFile(join(dir, "changes.yaml"), "utf-8"));
    for (const change of changes) if (change.elementId === GOAL) delete change.before;
    await writeFile(join(dir, "changes.yaml"), yaml.stringify(changes));
    await rm(join(dir, "base-index.json"));
    clearModelCache();
    await changesetUpdateHandler({ changeset: "export-orders", rebaseline: true, rootPath } as any);

    const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    const shown = parse(await preview(c));
    expect(shown.summary).not.toContain("Drift: none");
    expect(shown.summary).toContain("Not checked:");
    expect(shown.summary).toContain(GOAL);
  });

  it("accepts force, ignores it and says so", async () => {
    await overlapTheGoal();
    const c = await connect({ elicitation: true, answer: ACCEPT });
    const landed = parse(await commit(c, { force: true }));
    expect(landed.status).toBe("committed");
    expect(landed.warnings.join(" ")).toContain("force is deprecated and was ignored");
    expect((elicitations[0] as any).message).not.toContain("force");
  });

  it("writes nothing for a drifted changeset the user declines", async () => {
    await overlapTheGoal();
    const before = await baseModelText();
    const c = await connect({ elicitation: true, answer: { action: "decline" } });
    const result = await commit(c);
    expect(result.isError).toBe(true);
    expect(elicitations).toHaveLength(1);
    expect(await changesetStatus()).toBe("staged");
    expect(await baseModelText()).toBe(before);
  });

  // #1208: an edit to an element the changeset only links to is not an overlap, so it is not
  // something the person is warned about at confirmation.
  it("does not warn about an edit to an element the changeset only links to", async () => {
    await driftTheBase();
    const c = await connect({ elicitation: true, answer: ACCEPT });
    const result = await commit(c);
    expect(result.isError).toBeFalsy();
    expect(parse(result).status).toBe("committed");
    expect(parse(result).drift).toBeUndefined();
    const message = (elicitations[0] as any).message as string;
    expect(message).toContain("In the base: 1 elements changed");
    expect(message).toContain("Nothing this changeset stages overlaps it");
    expect(message).not.toContain("overlap the base");
    expect(await baseModelText()).toContain(FUNCTION);
  });

  // #1169: landing one changeset moved every other changeset's base hash, so each of them then
  // needed force although nothing it was staged against changed.
  it("lands a changeset staged before another one landed when the other touched other elements, with no warning", async () => {
    await changesetDeactivateHandler({ rootPath });
    await changesetCreateHandler({ name: "lower-costs", description: "Track costs", rootPath });
    await modelAddHandler({ layer: "motivation", type: "goal", name: "lower-costs", attributes: { priority: "low" }, rootPath });
    await changesetDeactivateHandler({ rootPath });

    const c = await connect({ elicitation: true, answer: ACCEPT });
    expect(parse(await commit(c, { changeset: "lower-costs" })).status).toBe("committed");

    const result = await commit(c);
    expect(result.isError).toBeFalsy();
    expect(parse(result).status).toBe("committed");
    expect(parse(result).drift).toBeUndefined();
    const message = (elicitations[1] as any).message as string;
    expect(message).toContain("In the base: 1 elements added");
    expect(message).toContain("Nothing this changeset stages overlaps it");
    expect(await baseModelText()).toContain(FUNCTION);
  });

  // #1239: an update restaged on the current base is current. Before, it still read
  // changed-in-base (the overlap check compared against the base index from creation), and force
  // was the only way to land it.
  it("stops warning once the overlapping update is restaged on the base as it is now", async () => {
    await overlapTheGoal();
    await changesetActivateHandler({ changesetId: "export-orders", rootPath });
    await changesetUnstageHandler({ elementId: GOAL, rootPath });
    await modelUpdateHandler({ id: GOAL, description: "Checkout in under a minute, in one step", rootPath } as any);

    const c = await connect({ elicitation: true, answer: ACCEPT });
    const result = await commit(c);
    expect(parse(result).status).toBe("committed");
    expect(parse(result).drift).toBeUndefined();
    expect((elicitations[0] as any).message).toContain("Nothing this changeset stages overlaps it");
    expect(await baseModelText()).toContain("Checkout in under a minute, in one step");
  });

  // #1169: changeset_update re-baselines, showing what moved; it never hides a true overlap.
  it("re-baselines through changeset_update: says what moved, keeps the overlap that is still true, and the summary says it was re-baselined", async () => {
    await overlapTheGoal();
    const updated = parse(await changesetUpdateHandler({ changeset: "export-orders", rebaseline: true, rootPath } as any));
    expect(updated.rebaselined.moved.counts).toMatchObject({ elementsChanged: 1 });
    expect(updated.rebaselined.moved.elementsChanged).toEqual([GOAL]);
    expect(updated.rebaselined.overlapsCleared).toEqual([]);
    expect(updated.rebaselined.overlapsRemaining).toMatchObject([{ element: GOAL, reason: "changed-in-base" }]);
    expect(updated.rebaselined.overlapsRemaining[0].resolve).toContain("stage it again");
    expect(updated.rebaselined.baseSnapshot).not.toBe(updated.rebaselined.previousBaseSnapshot);
    expect(updated.rebaselined.next).toContain("still overlaps");

    // The safety line for a re-baseline: an agent can't use it to clear what the person reads when
    // confirming. The preview after it still states the overlap, and says the changeset was
    // re-baselined; so does the dialog; and the landing reports it.
    const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    const shown = parse(await preview(c));
    expect(shown.drifted).toBe(true);
    expect(shown.summary).toContain("Re-baselined ");
    expect(shown.summary).toContain("- changed-in-base, 1 element(s)");
    expect(shown.summary).toContain(`      ${GOAL}`);
    expect(shown.overlaps).toEqual({ total: 1, named: 1 });
    await c.close();

    // A second re-baseline changes nothing about it.
    const again = parse(await changesetUpdateHandler({ changeset: "export-orders", rebaseline: true, rootPath } as any));
    expect(again.rebaselined.overlapsRemaining).toMatchObject([{ element: GOAL, reason: "changed-in-base" }]);

    const asked = await connect({ elicitation: true, answer: ACCEPT });
    const landed = parse(await commit(asked));
    const message = (elicitations[0] as any).message as string;
    expect(message).toContain("Re-baselined ");
    expect(message).toContain("(2 times)");
    expect(message).toContain("- changed-in-base, 1 element(s)");
    expect(landed.drift.kinds[0]).toMatchObject({ reason: "changed-in-base", items: [GOAL] });
  });

  it("re-baselines a changeset the base overlaps nowhere to drift none", async () => {
    await driftTheBase();
    const updated = parse(await changesetUpdateHandler({ changeset: "export-orders", rebaseline: true, rootPath } as any));
    expect(updated.rebaselined.moved.counts).toMatchObject({ elementsChanged: 1 });
    expect(updated.rebaselined.overlapsRemaining).toEqual([]);
    expect(updated.rebaselined.next).toContain("Nothing the changeset stages overlaps the base");
    expect(updated.changes).toBe(3);

    const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    const shown = parse(await preview(c));
    expect(shown.drifted).toBe(false);
    expect(shown.summary).toContain("Drift: none");
    expect(shown.summary).toContain("Re-baselined ");
    expect(shown.summary).not.toContain("In the base:");
  });

  it("previews a re-baseline without writing, and pages what moved with true totals", async () => {
    await driftTheBase();
    for (let i = 0; i < 5; i++) {
      await modelAddHandler({ layer: "motivation", type: "goal", name: `moved-${i}`, attributes: { priority: "low" }, rootPath });
    }
    const before = await readFile(join(rootPath, "documentation-robotics", "changesets", await planId(), "metadata.yaml"), "utf-8");

    const first = parse(await changesetUpdateHandler({ changeset: "export-orders", rebaseline: "preview", limit: 2, rootPath } as any));
    expect(first.rebaselined.applied).toBe(false);
    expect(first.rebaselined.moved.elementsAdded).toHaveLength(2);
    expect(first.rebaselined.moved.counts).toMatchObject({ elementsAdded: 5, elementsChanged: 1 });
    expect(first.rebaselined.moved.page).toMatchObject({ offset: 0, limit: 2, nextOffset: 2, totals: { elementsAdded: 5, elementsChanged: 1 } });
    expect(first.rebaselined.more).toContain('rebaseline: "preview", offset: 2');
    expect(first.rebaselined.next).toContain("Nothing was written");
    // Nothing moved on disk, and the drift is as it was.
    expect(await readFile(join(rootPath, "documentation-robotics", "changesets", await planId(), "metadata.yaml"), "utf-8")).toBe(before);

    // Reading on reaches the end, and the last page says so by having no more.
    const second = parse(await changesetUpdateHandler({ changeset: "export-orders", rebaseline: "preview", limit: 2, offset: 2, rootPath } as any));
    expect(second.rebaselined.moved.page.nextOffset).toBe(4);
    const last = parse(await changesetUpdateHandler({ changeset: "export-orders", rebaseline: "preview", limit: 2, offset: 4, rootPath } as any));
    expect(last.rebaselined.moved.elementsAdded).toHaveLength(1);
    expect(last.rebaselined.moved.page.nextOffset).toBeUndefined();
    expect(last.rebaselined.more).toBeUndefined();

    // Applying from an offset would lose the first entries for good, so it is refused.
    const refused = await changesetUpdateHandler({ changeset: "export-orders", rebaseline: true, offset: 2, rootPath } as any);
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("offset pages a preview");

    // Applied with a short page, it says the rest can no longer be read rather than pass for whole.
    const applied = parse(await changesetUpdateHandler({ changeset: "export-orders", rebaseline: true, limit: 2, rootPath } as any));
    expect(applied.rebaselined.applied).toBe(true);
    expect(applied.rebaselined.moved.page.totals).toMatchObject({ elementsAdded: 5 });
    expect(applied.rebaselined.more).toContain("can no longer be read");
    const after = parse(await changesetUpdateHandler({ changeset: "export-orders", rebaseline: "preview", rootPath } as any));
    expect(after.rebaselined.moved.counts).toMatchObject({ elementsAdded: 0, elementsChanged: 0 });
  });

  it("refuses to re-baseline a changeset that is not staged, and changeset_update with nothing to do", async () => {
    const c = await connect({ elicitation: true, answer: ACCEPT });
    expect(parse(await commit(c)).status).toBe("committed");
    const refused = await changesetUpdateHandler({ changeset: "export-orders", rebaseline: true, rootPath } as any);
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("is committed");
    const nothing = await changesetUpdateHandler({ changeset: "export-orders", rootPath } as any);
    expect(text(nothing)).toContain("rebaseline: true");
  });

  it("reports an empty changeset as nothing to commit, without asking", async () => {
    await changesetCreateHandler({ name: "empty", rootPath });
    const c = await connect({ elicitation: true, answer: { action: "accept", content: { confirm: true } } });
    const result = await commit(c, { changeset: "empty" });
    expect(parse(result)).toMatchObject({ status: "nothing-to-commit", stagedChanges: 0 });
    expect(elicitations).toHaveLength(0);
  });

  it("answers that a changeset already landed is landed, without asking again (#1441)", async () => {
    const c = await connect({ elicitation: true, answer: { action: "accept", content: { confirm: true } } });
    expect((await commit(c)).isError).toBeFalsy();
    const again = await commit(c);
    expect(again.isError).toBeFalsy();
    expect(parse(again)).toMatchObject({ status: "already-landed" });
    expect(parse(again).nothingToDo).toContain("is already landed");
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

  it("refuses when the base model changed while the dialog was open", async () => {
    const c = await connect({
      elicitation: true,
      answer: ACCEPT,
      whileAsking: async () => {
        await changesetDeactivateHandler({ rootPath });
        await modelAddHandler({ layer: "motivation", type: "goal", name: "lower-costs", attributes: { priority: "low" }, rootPath });
      },
    });
    const result = await commit(c);
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

// Round-2 friction: landing the as-built changeset first drifted the plan's base, and the plan's
// descriptions then didn't apply. The dialog says the plan should land instead.
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

// #1172: a plan's verification record (codebase_extract with since while the plan was active) is
// never landed: changeset_commit and its preview refuse it, force or not, as a user error.
describe("changeset_commit of a plan's verification record", () => {
  async function stageVerificationRecord(): Promise<string> {
    const model = await Model.load(rootPath, { lazyLoad: false });
    const manager = new StagingAreaManager(model.rootPath, model);
    const plan = (await manager.load("export-orders"))!;
    const record = await manager.create(
      "export-orders-as-built",
      "As-built extraction of the code at abc1234, files changed since main. Staged by codebase_extract.",
      { kind: "extract" },
      extractionPurpose({ since: "main", gitHead: "abc1234", previousActive: { id: plan.id } })
    );
    await manager.setActive(record.id);
    clearModelCache();
    await modelAddHandler({
      layer: "application",
      type: "applicationfunction",
      name: "export-orders-csv",
      sourceFile: "src/export.ts",
      sourceSymbol: "exportOrdersCsv",
      sourceProvenance: "extracted",
      rootPath,
    } as any);
    return record.id;
  }

  for (const force of [false, true]) {
    it(`refuses it${force ? " with force" : ""} without asking, naming the plan and what to do, never the CLI`, async () => {
      await stageVerificationRecord();
      const before = await baseModelText();
      const c = await connect({ elicitation: true, answer: ACCEPT });
      const result = await commit(c, { changeset: "export-orders-as-built", ...(force ? { force: true } : {}) });
      expect(result.isError).toBe(true);
      const error = parse(result);
      expect(error.category).toBe("user");
      expect(error.error).toContain("'export-orders-as-built' is a verification record");
      expect(error.error).toContain("compared with plan 'export-orders'");
      expect(error.suggestions.join("\n")).toContain("Land the plan 'export-orders' instead");
      expect(error.suggestions.join("\n")).toContain("Keep this record");
      expect(error.suggestions.join("\n")).toContain("extract without a plan active");
      expect(text(result)).not.toMatch(/\bdr (changeset|visualize)\b|--force/);
      expect(elicitations).toHaveLength(0);
      expect(await baseModelText()).toBe(before);
    });
  }

  it("refuses it in changeset_commit_preview too, and the plan still lands", async () => {
    await stageVerificationRecord();
    const c = await connect({ elicitation: true, answer: ACCEPT, clientInfo: CLAUDE_CODE });
    const shown = await preview(c, { changeset: "export-orders-as-built", force: true });
    expect(shown.isError).toBe(true);
    expect(parse(shown).category).toBe("user");
    expect(parse(shown).error).toContain("is a verification record");
    await c.close();

    const c2 = await connect({ elicitation: true, answer: ACCEPT });
    const landed = await commit(c2, { changeset: "export-orders" });
    expect(parse(landed).status).toBe("committed");
  });

  it("is reported by changeset_show and changeset_list with discard as its only action", async () => {
    const id = await stageVerificationRecord();
    const plan = (await new StagingAreaManager(rootPath, await Model.load(rootPath, { lazyLoad: true })).load("export-orders"))!;
    const shown = parse(await changesetShowHandler({ changesetId: id, rootPath, detail: "summary" }));
    expect(shown).toMatchObject({
      purpose: "verification",
      verifies: plan.id,
      scope: { since: "main", codeCommit: "abc1234" },
      actions: ["discard"],
    });
    const listed = parse(await changesetListHandler({ rootPath }));
    expect(listed.changesets[id]).toMatchObject({ purpose: "verification", verifies: plan.id, actions: ["discard"] });
    expect(listed.changesets[plan.id]).toMatchObject({ purpose: "plan", actions: ["commit", "discard"] });
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

  it("ignores force with a token: the token binds the changeset and the base, not a flag", async () => {
    const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    const { confirmToken } = parse(await preview(c));
    const landed = parse(await commit(c, { confirmToken, force: true }));
    expect(landed.status).toBe("committed");
    expect(landed.warnings.join(" ")).toContain("force is deprecated and was ignored");
  });

  it("refuses the token when the base model changed after the preview", async () => {
    const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    const { confirmToken } = parse(await preview(c));
    await changesetDeactivateHandler({ rootPath });
    await modelAddHandler({ layer: "motivation", type: "goal", name: "lower-costs", attributes: { priority: "low" }, rootPath });
    const before = await baseModelText();
    const result = await commit(c, { confirmToken });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("changed since the preview");
    expect(await changesetStatus()).toBe("staged");
    expect(await baseModelText()).toBe(before);
  });

  // #1239, the keystone: a changeset the base overlaps lands from a session where no dialog can be
  // shown (the desktop app, Remote Control), with no force and no CLI. The person reads the overlap
  // in the preview's summary and approves the commit call in the permission prompt.
  it("lands a drifted changeset with the preview's token and no dialog, the summary naming the overlap", async () => {
    await modelUpdateHandler({ id: GOAL, description: "Checkout in one step", rootPath } as any);
    await changesetDeactivateHandler({ rootPath });
    await modelUpdateHandler({ id: GOAL, description: "Checkout in under a minute", rootPath } as any);

    // The client declines every dialog, as print mode does; the token path never asks.
    const c = await connect({ elicitation: true, answer: { action: "decline" }, clientInfo: CLAUDE_CODE });
    const shown = parse(await preview(c));
    expect(shown.status).toBe("ready-to-commit");
    expect(shown.drifted).toBe(true);
    expect(shown.force).toBeUndefined();
    expect(shown.summary).toContain("1 staged change(s) overlap the base. Landing goes ahead, and does this:");
    expect(shown.summary).toContain("- changed-in-base, 1 element(s)");
    expect(shown.summary).toContain(`      ${GOAL}`);
    expect(shown.overlaps).toEqual({ total: 1, named: 1 });
    expect(shown.more).toBeUndefined();
    expect(shown.next).toContain("its drift lines included");
    expect(shown.next).not.toContain("force");

    const result = await commit(c, { confirmToken: shown.confirmToken });
    expect(result.isError).toBeFalsy();
    const landed = parse(result);
    expect(landed).toMatchObject({ status: "committed", confirmedBy: "permission-prompt" });
    expect(landed.drift.kinds[0]).toMatchObject({ reason: "changed-in-base", items: [GOAL] });
    expect(elicitations).toHaveLength(0);
    expect(await baseModelText()).toContain("Checkout in one step");
  });

  it("gives a token good for an hour: long enough for a relayed answer, too short for yesterday's preview", async () => {
    const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
    const shown = parse(await preview(c));
    const lifetime = new Date(shown.expiresAt).getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(59 * 60_000);
    expect(lifetime).toBeLessThanOrEqual(60 * 60_000);
    expect(CONFIRM_TOKEN_TTL_MS).toBe(60 * 60_000);
    expect(confirmationTiming.tokenTtlMs).toBe(CONFIRM_TOKEN_TTL_MS);
    expect(shown.next).toContain("good for an hour");
    const { tools } = await c.listTools();
    expect(tools.find((t) => t.name === "changeset_commit_preview")!.description).toContain("good for an hour");
  });

  it("says an expired token expired and that a new preview is needed, not that the user declined", async () => {
    const saved = confirmationTiming.tokenTtlMs;
    try {
      const c = await connect({ elicitation: false, clientInfo: CLAUDE_CODE });
      // The lifetime is one setting: a token issued under it has passed it by the time it is used.
      confirmationTiming.tokenTtlMs = -1;
      const { confirmToken } = parse(await preview(c));
      const before = await baseModelText();
      const result = await commit(c, { confirmToken });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("the confirmToken expired");
      expect(text(result)).toContain("the user did not decline");
      expect(text(result)).toContain("changeset_commit_preview again");
      expect(await changesetStatus()).toBe("staged");
      expect(await baseModelText()).toBe(before);
    } finally {
      confirmationTiming.tokenTtlMs = saved;
    }
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
    const { token } = issueConfirmToken("x", "state");
    const result = await commit(c, { confirmToken: token });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("changeset-only mode");
    expect(await changesetStatus()).toBe("staged");
  });
});

describe("confirmation tokens", () => {
  it("are good once, for the state and changeset they were issued for, until they expire", () => {
    const now = Date.now();
    const { token } = issueConfirmToken("cs-1", "state-a", now);
    expect(checkConfirmToken(token, "cs-1", "state-b", now)).toBe("mismatch");
    expect(checkConfirmToken(token, "cs-2", "state-a", now)).toBe("mismatch");
    expect(checkConfirmToken(token, "cs-1", "state-a", now + confirmationTiming.tokenTtlMs + 1)).toBe("expired");
    // Still good most of an hour on: the answer may be relayed through another session.
    expect(checkConfirmToken(token, "cs-1", "state-b", now + 55 * 60_000)).toBe("mismatch");
    expect(checkConfirmToken(token, "cs-1", "state-a", now + 55 * 60_000)).toBe("ok");
    expect(checkConfirmToken(token, "cs-1", "state-a", now)).toBe("used");
    expect(checkConfirmToken("abc", "cs-1", "state-a", now)).toBe("malformed");
  });

  it("can't be reused by spelling the expiry another way", () => {
    const now = Date.now();
    const { token } = issueConfirmToken("cs-1", "state-a", now);
    const [expiry, digest] = token.split(".");
    expect(checkConfirmToken(token, "cs-1", "state-a", now)).toBe("ok");
    for (const respelled of [`${expiry.toUpperCase()}.${digest}`, `0${expiry}.${digest}`, `${expiry}~.${digest}`]) {
      expect(["malformed", "used"]).toContain(checkConfirmToken(respelled, "cs-1", "state-a", now));
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

  it("reports a decline that took time as declined, without claiming who declined it", async () => {
    confirmationTiming.instantDeclineMs = 20;
    const c = await connect({
      elicitation: true,
      answer: { action: "decline" },
      whileAsking: () => new Promise((resolve) => setTimeout(resolve, 60)),
      clientInfo: CLAUDE_CODE,
    });
    const result = await commit(c);
    expect(text(result)).toContain("the confirmation dialog came back declined");
    expect(text(result)).not.toContain("could not be shown. The client");
  });
});
