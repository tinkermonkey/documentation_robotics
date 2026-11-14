/**
 * codebase_extract with Tier 1 in suggest mode (docs/analyzers/TIER1_DESIGN.md sections 1.1, 1.3,
 * 2.4, 4.5, 4.6 and 7): off by default; opted in, hints on the narrowed and no-rule cards, the
 * accept band first, the notice and spend; acceptTier1 staging the accept band from the cache with
 * `origin`; tier1: false; provider failure, the cap and the deadline; the debug not-element option;
 * never `retyped`; tier1_status and project_status. Also `origin` in unstage tombstones and not in
 * landed elements.
 *
 * No network: the decision model is a FakeDecisionModel injected through CodebaseToolDeps, the
 * environment is empty, and every result is scanned for the fake credentials in tier1.json.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { compactChange } from "../../../src/core/changeset.js";
import { ChangesetGraph } from "../../../src/core/changeset-graph.js";
import { Changeset } from "../../../src/core/changeset.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetUnstageHandler } from "../../../src/mcp/tools/changeset-editing.js";
import { createCodebaseExtractHandler } from "../../../src/mcp/tools/codebase-extract.js";
import { createTier1StatusHandler } from "../../../src/mcp/tools/tier1-status.js";
import { projectStatus } from "../../../src/mcp/tools/project-status.js";
import type { CodebaseToolDeps } from "../../../src/mcp/tools/codebase-shared.js";
import { writeIndexMeta, writeSession } from "../../../src/analyzers/session-state.js";
import type { AnalyzerBackend } from "../../../src/analyzers/base-analyzer.js";
import { collectExtraction } from "../../../src/analyzers/cards/extract.js";
import { planElements, withTier1Decided } from "../../../src/analyzers/extraction-plan.js";
import { NOT_SHOWN_REASON, tier1DeadlineAt } from "../../../src/mcp/tools/codebase-extract-tier1.js";
import {
  classifyTier1,
  openTier1,
  DecisionModelError,
  loadSpecCriteria,
  SpendLedger,
  tier1Paths,
  type AskOptions,
  type AskResult,
  type Question,
  type SpecCriteria,
} from "../../../src/analyzers/classifier/index.js";
import { CONFIG, HELPERS_FILE, SERVICE_FILE, fakeGraph, springProject, type FakeProject } from "../../helpers/fake-cbm-graph.js";
import { choiceAnswer, FakeDecisionModel, type ScriptedAnswer } from "../../helpers/fake-decision-model.js";

const HEAD = "1111111111111111111111111111111111111111";
const META = { git_head: HEAD, timestamp: "2026-11-09T12:00:00.000Z", node_count: 120, edge_count: 340 };
const FAKE_ACCOUNT = "fake-account-0000ab12";
const FAKE_TOKEN = "fake-token-SECRET-never-returned";

/** Each card's answers by a line of its source, so each band is exercised. */
const stage1 = (layer: string, p: number) => ({
  layer: choiceAnswer(layer, p),
  significance: { score: 2 },
  concern_authentication: { noul: 0.01 },
  concern_authorization: { noul: 0.01 },
  concern_data_persistence: { noul: 0.01 },
  concern_external_integration: { noul: 0.01 },
  concern_observability: { noul: 0.01 },
  concern_user_interface: { noul: 0.01 },
});
const SCRIPT: Array<[string, Record<string, ScriptedAnswer>]> = [
  // OwnerService (narrowed to service or component): accept, as an application service.
  ["public class OwnerService", { ...stage1("application", 0.85), element_type: choiceAnswer("applicationservice", 0.7) }],
  // Helpers.format (no rule): a low layer probability, so it escalates.
  ["static String format", { ...stage1("application", 0.45), element_type: choiceAnswer("applicationfunction", 0.5) }],
  // Helpers (no rule): not an element.
  ["public class Helpers", stage1("none", 0.9)],
];

/** Answers each card by the first SCRIPT line its state contains. */
class ScriptedModel extends FakeDecisionModel {
  constructor(private readonly rules: Array<[string, Record<string, ScriptedAnswer>]> = SCRIPT) {
    super();
  }

  override async ask(state: string, questions: Record<string, Question>, options: AskOptions = {}): Promise<AskResult> {
    const rule = this.rules.find(([match]) => state.includes(match));
    if (rule) this.answer(state, rule[1]);
    return super.ask(state, questions, options);
  }
}

/** A model that answers only when the run's time is up: every request waits on the run's signal. */
class SlowModel extends FakeDecisionModel {
  override async ask(state: string, questions: Record<string, Question>, options: AskOptions = {}): Promise<AskResult> {
    this.calls.push({ state, stateHash: "", questions, options });
    await new Promise<void>((_resolve, reject) => {
      if (options.signal?.aborted) return reject(new DecisionModelError("timeout", "the run's time ran out"));
      const t = setTimeout(() => reject(new DecisionModelError("timeout", "never answered")), 30_000);
      options.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DecisionModelError("timeout", "the run's time ran out"));
      });
    });
    throw new Error("unreachable");
  }
}

let spec: SpecCriteria;
let rootPath: string;

beforeAll(async () => {
  spec = await loadSpecCriteria();
});

beforeEach(async () => {
  clearModelCache();
  const dir = join(tmpdir(), `dr-mcp-extract-tier1-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  rootPath = await realpath(dir);
  await Model.init(rootPath, { name: "Tier1 Extract Test", version: "0.1.0" });
  await writeSession({ active_analyzer: "cbm", selected_at: new Date().toISOString() }, rootPath);
  await writeIndexMeta(META, rootPath, "cbm");
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

interface Built {
  deps: CodebaseToolDeps;
  /** How many times Tier 1's model was built. */
  built: { count: number };
}

function setup(model: FakeDecisionModel | null, options: { project?: FakeProject; budgetMs?: number } = {}): Built {
  const project = options.project ?? springProject();
  const backend = {
    name: "cbm",
    detect: async () => ({ installed: true, binary_path: "/bin/cbm" }),
    extract: async (_root: string, opts: any) => collectExtraction(fakeGraph(project), CONFIG, "cbm", opts),
  } as unknown as AnalyzerBackend;
  const built = { count: 0 };
  return {
    built,
    deps: {
      getAnalyzer: async (name) => (name === "cbm" ? backend : undefined),
      discover: async () => ({ found: [], selected: "cbm" }),
      spawn: () => Object.assign(new EventEmitter(), { pid: 60000, unref() {} }) as any,
      drCommand: { command: "/usr/bin/node", args: ["/opt/dr/dist/cli.js"] },
      isAlive: () => true,
      gitHead: () => HEAD,
      ...(options.budgetMs ? { budgetMs: options.budgetMs } : {}),
      tier1: {
        env: {},
        fetch: () => Promise.reject(new Error("no network in tests")),
        createModel: () => {
          built.count++;
          if (!model) throw new Error("no model expected");
          return model;
        },
      },
      tier1Spec: spec,
    },
  };
}

/** Opt this checkout in, with fake keys in the file (mode 0600). */
async function optIn(extra: Record<string, unknown> = {}): Promise<void> {
  const file = tier1Paths(rootPath, "cbm").config;
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({ version: 1, provider: "cloudflare-workers-ai", model: "clef", credentials: { accountId: FAKE_ACCOUNT, apiToken: FAKE_TOKEN }, ...extra }),
    { mode: 0o600 }
  );
}

function text(result: any): string {
  return result.content[0].text as string;
}
/** The result's body; fails on an error result, and on a result holding a fake credential. */
function ok(result: any): any {
  const t = text(result);
  if (result.isError) throw new Error(t);
  expectNoSecret(t);
  return JSON.parse(t);
}
function fail(result: any): any {
  expect(result.isError).toBe(true);
  expectNoSecret(text(result));
  return JSON.parse(text(result));
}
function expectNoSecret(t: string): void {
  expect(t).not.toContain(FAKE_TOKEN);
  expect(t).not.toContain(FAKE_ACCOUNT);
}

async function changesetOf(id: string) {
  clearModelCache();
  const model = await Model.load(rootPath);
  return (await new StagingAreaManager(rootPath, model).load(id))!;
}

async function storedRecord(changesetId: string): Promise<any> {
  return JSON.parse(await readFile(join(rootPath, ".dr", "analyzers", "extract", `${changesetId}.json`), "utf-8"));
}

const SERVICE_ID = "application.applicationservice.owner-service";

describe("codebase_extract with Tier 1", () => {
  it("is off without tier1.json: no model built, nothing sent or written, cards without hints", async () => {
    const { deps, built } = setup(null);
    const r = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(r.tier1).toMatchObject({ state: "off" });
    expect(r.tier1.notice).toContain("Tier 1 is off");
    expect(built.count).toBe(0);
    expect(r.undecided.items.every((c: any) => c.tier1 === undefined)).toBe(true);
    expect(r.undecided.items.map((c: any) => c.symbol)).toEqual(["OwnerService", "Helpers", "Helpers.format"]);
    const paths = tier1Paths(rootPath, "cbm");
    expect(existsSync(paths.ledger)).toBe(false);
    expect(existsSync(paths.cache)).toBe(false);
    // Tier-0 adds still say who decided them.
    const changeset = await changesetOf(r.changeset.id);
    for (const c of changeset.changes) {
      expect(c.origin?.by).toBe("tier0");
      if (c.type === "add") expect(c.origin?.rule).toMatch(/^(tier0_|node-mapping:)/);
    }
  });

  it("opted in: hints on the asked cards, the accept band first and the not-element band last, the notice and spend, nothing staged by Tier 1", async () => {
    await optIn();
    const model = new ScriptedModel();
    const { deps } = setup(model);
    const r = ok(await createCodebaseExtractHandler(deps)({ rootPath }));

    expect(r.tier1).toMatchObject({
      state: "on",
      provider: "cloudflare-workers-ai",
      model: "fake/clef",
      mode: "suggest",
      cards: 3,
      cached: 0,
      sent: 3,
      failed: 0,
      skipped: 0,
      bands: { accept: 1, notElement: 1, escalate: 1 },
      staged: 0,
      thresholds: { layer: 0.6, type: 0.4, none: 0.6, source: "default", fit: "in-sample" },
    });
    expect(r.tier1.month).toMatchObject({ capUsd: 20, cards: 3 });
    expect(r.tier1.notice).toContain("Sent 3 cards");
    expect(r.tier1.notice).toContain("Cloudflare Workers AI (fake/clef, account …ab12)");
    expect(r.tier1.notice).toContain(".dr/analyzers/cbm/tier1.json enables Tier 1");
    expect(r.tier1.notice).toContain("nothing is accepted without the agent");

    const [first, second, third] = r.undecided.items;
    expect(first).toMatchObject({ symbol: "OwnerService", tier1: { band: "accept", layer: "application", type: "applicationservice", p: { layer: 0.85, type: 0.7 } } });
    expect(second).toMatchObject({ symbol: "Helpers.format", tier1: { band: "escalate", layer: "application" } });
    expect(third).toMatchObject({ symbol: "Helpers", tier1: { band: "not-element", layer: "none", type: null } });
    // Tier 1 alone staged nothing: only Tier 0's five adds.
    expect(r.staged.adds).toBe(5);
    const changeset = await changesetOf(r.changeset.id);
    expect(changeset.changes.some((c) => c.origin?.by === "tier1")).toBe(false);
    // The agent is told to relay the notice and how to take the accept band.
    const next = r.next.join(" ");
    expect(next).toContain("tier1.notice");
    expect(next).toContain("acceptTier1: true");

    // Spend went to the ledger as `extract`, and the answers to the cache.
    const entries = await new SpendLedger(tier1Paths(rootPath, "cbm").ledger).entries();
    expect(entries.map((e) => e.source)).toEqual(["extract", "extract", "extract"]);
    expect(model.calls.length).toBe(5); // three stage-1 asks, two stage-2 (none has no type question)

    // A page reads the stored cards with their hints, and asks nothing.
    const page = ok(await createCodebaseExtractHandler(deps)({ rootPath, page: 1, pageSize: 1 } as any));
    expect(page.undecided.items[0].tier1.band).toBe("accept");

    // A rerun is answered from the cache: nothing more is sent.
    clearModelCache();
    const again = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(again.tier1).toMatchObject({ state: "on", cached: 3, sent: 0 });
    expect(model.calls.length).toBe(5);
    expect(again.tier1.notice).toContain("Nothing was sent");
  });

  it("acceptTier1 stages the accept band from the cache, with origin, and only after the agent's call", async () => {
    await optIn();
    const model = new ScriptedModel();
    const { deps } = setup(model);
    const handler = createCodebaseExtractHandler(deps);
    const first = ok(await handler({ rootPath }));
    const calls = model.calls.length;

    clearModelCache();
    const r = ok(await handler({ rootPath, changeset: first.changeset.name, acceptTier1: true }));
    expect(model.calls.length).toBe(calls); // cached answers only
    expect(r.tier1).toMatchObject({ state: "on", cached: 3, sent: 0, staged: 1 });
    expect(r.staged.adds).toBe(1);
    expect(r.undecided.items.map((c: any) => c.symbol)).toEqual(["Helpers.format", "Helpers"]);
    expect(r.next.join(" ")).toContain("from Tier 1's accept band were staged");

    const changeset = await changesetOf(first.changeset.id);
    const add = changeset.changes.find((c) => c.type === "add" && c.elementId === SERVICE_ID)!;
    expect(add).toBeDefined();
    expect(add.origin).toEqual({
      by: "tier1",
      rule: "tier1:dr-qset-2",
      provider: "cloudflare-workers-ai",
      model: "fake/clef",
      p: { layer: 0.85, type: 0.7 },
      confirmed: "agent",
    });
    expect((add.after as any).origin).toBeUndefined();
    expect((add.after as any).source_reference).toEqual({ provenance: "extracted", locations: [{ file: SERVICE_FILE, symbol: "OwnerService" }] });

    // In changes.yaml, beside `after`.
    const yaml = parseYaml(await readFile(join(rootPath, "documentation-robotics", "changesets", first.changeset.id, "changes.yaml"), "utf-8")) as any[];
    const onDisk = yaml.find((c) => c.elementId === SERVICE_ID);
    expect(onDisk.origin.by).toBe("tier1");
    expect(onDisk.after.origin).toBeUndefined();

    // The extraction record keeps it for verify and reject.
    const record = await storedRecord(first.changeset.id);
    expect(record.staged.find((s: any) => s.id === SERVICE_ID).origin).toMatchObject({ by: "tier1", confirmed: "agent" });
    expect(record.staged.filter((s: any) => s.origin?.by === "tier0").length).toBe(5);

    // Unstaged, the tombstone keeps its origin.
    const unstage = await changesetUnstageHandler({ elementId: SERVICE_ID, changesetId: first.changeset.id, rootPath });
    expect(unstage.isError).toBeFalsy();
    const after = await changesetOf(first.changeset.id);
    const tombstone = after.unstaged.find((t) => t.change.elementId === SERVICE_ID)!;
    expect(tombstone.change.origin).toMatchObject({ by: "tier1", rule: "tier1:dr-qset-2" });
  });

  it("relationships inherit the origin of the decision that created their end; landing never writes origin into an element", async () => {
    await optIn();
    const project = springProject();
    // Helpers defines format: once Tier 1's component and function are staged, the edge relates them.
    const helpers = project.nodes.find((n) => n.name === "Helpers")!.qualified_name;
    const format = project.nodes.find((n) => n.name === "format")!.qualified_name;
    project.edges.push({ type: "DEFINES_METHOD", from: helpers, to: format });
    const model = new ScriptedModel([
      SCRIPT[0],
      ["static String format", { ...stage1("application", 0.9), element_type: choiceAnswer("applicationfunction", 0.8) }],
      ["public class Helpers", { ...stage1("application", 0.9), element_type: choiceAnswer("applicationcomponent", 0.8) }],
    ]);
    const { deps } = setup(model, { project });
    const handler = createCodebaseExtractHandler(deps);
    const first = ok(await handler({ rootPath }));
    expect(first.tier1.bands.accept).toBe(3);
    clearModelCache();
    const r = ok(await handler({ rootPath, changeset: first.changeset.name, acceptTier1: true }));
    expect(r.tier1.staged).toBe(3);
    const changeset = await changesetOf(first.changeset.id);
    const rels = changeset.changes.filter((c) => c.type === "relationship-add");
    for (const rel of rels) expect(rel.origin).toBeDefined();
    const byTier1 = rels.filter((c) => c.elementId.includes("helpers"));
    expect(byTier1.map((c) => c.elementId)).toEqual(["application.applicationcomponent.helpers::assigned-to::application.applicationfunction.helpers-format"]);
    expect(r.staged.relationships).toBe(1);
    for (const rel of byTier1) expect(rel.origin).toMatchObject({ by: "tier1", rule: "tier1:dr-qset-2", confirmed: "agent" });
    const tier0Rels = rels.filter((c) => !byTier1.includes(c));
    expect(tier0Rels.length).toBeGreaterThan(0);
    for (const rel of tier0Rels) expect(rel.origin?.by).toBe("tier0");

    // Landing writes `after`, never `origin`.
    clearModelCache();
    const loaded = await Model.load(rootPath);
    await new StagingAreaManager(rootPath, loaded).commit(loaded, first.changeset.id, { validate: false, force: true });
    const layerDir = join(rootPath, "documentation-robotics", "model");
    const files = await Array.fromAsync(new Bun.Glob("**/*.yaml").scan({ cwd: layerDir }));
    let found = false;
    for (const f of files) {
      const content = await readFile(join(layerDir, f), "utf-8");
      expect(content).not.toContain("origin:");
      expect(content).not.toContain("tier1:dr-qset");
      if (content.includes("owner-service")) found = true;
    }
    expect(found).toBe(true);
  });

  it("tier1: false skips Tier 1: no model built, nothing sent", async () => {
    await optIn();
    const { deps, built } = setup(new ScriptedModel());
    const r = ok(await createCodebaseExtractHandler(deps)({ rootPath, tier1: false }));
    expect(built.count).toBe(0);
    expect(r.tier1).toMatchObject({ state: "off", reason: "tier1: false skipped Tier 1 for this run" });
    expect(r.undecided.items.every((c: any) => c.tier1 === undefined)).toBe(true);
    expect(existsSync(tier1Paths(rootPath, "cbm").ledger)).toBe(false);
  });

  it("acceptTier1 is refused when Tier 1 is off, with tier1: false, with a page or a preview", async () => {
    const { deps } = setup(null);
    const handler = createCodebaseExtractHandler(deps);
    expect(fail(await handler({ rootPath, acceptTier1: true })).error).toContain("acceptTier1 needs Tier 1, which is off");
    expect(fail(await handler({ rootPath, acceptTier1: true, tier1: false })).error).toContain("can't be combined");
    expect(fail(await handler({ rootPath, acceptTier1: true, preview: true })).error).toContain("can't be combined");
    expect(fail(await handler({ rootPath, acceptTier1: true, page: 2 })).error).toContain("can't be combined");
  });

  it("acceptTier1 is refused for a model without thresholds (no accept band)", async () => {
    await optIn();
    const { deps } = setup(new FakeDecisionModel({ canonicalModel: "unmeasured" }));
    expect(fail(await createCodebaseExtractHandler(deps)({ rootPath, acceptTier1: true })).error).toContain("has no thresholds");
  });

  it("a provider that fails leaves the run as Tier 0 with every card escalated and the reason on its hint", async () => {
    await optIn();
    const model = new ScriptedModel().failNext(...Array(10).fill("unavailable"));
    const { deps } = setup(model);
    const r = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(r.tier1.state).toBe("unavailable");
    expect(r.tier1.reason).toContain("provider");
    expect(r.staged.adds).toBe(5);
    for (const c of r.undecided.items) {
      expect(c.tier1.band).toBe("escalate");
      expect(c.tier1.reason).toBeTruthy();
    }
    expect(r.next.join(" ")).toContain("tier1.notice");
  });

  it("at the monthly cap nothing is sent; cards say why they have no answer", async () => {
    await optIn({ monthlyCapUsd: 0 });
    const model = new ScriptedModel();
    const { deps } = setup(model);
    const r = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(model.calls.length).toBe(0);
    expect(r.tier1.state).toBe("capped");
    expect(r.tier1.notice).toContain("monthly cap");
    for (const c of r.undecided.items) expect(c.tier1).toMatchObject({ band: "escalate", reason: "not asked: the monthly cap is reached" });
  });

  it("stops asking at its share of the run's deadline; the rest escalate and the run still stages", async () => {
    await optIn();
    const model = new SlowModel();
    const { deps } = setup(model, { budgetMs: 4000 });
    const r = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(r.tier1.state).toBe("on");
    expect(r.tier1.skipped).toBe(3);
    expect(r.tier1.notice).toContain("before the run's time ran out");
    expect(r.staged.adds).toBe(5);
    for (const c of r.undecided.items) expect(c.tier1.band).toBe("escalate");
  });

  it("debug.applyNotElement: acceptTier1 also records the not-element band as not elements", async () => {
    await optIn({ debug: { applyNotElement: true } });
    const { deps } = setup(new ScriptedModel());
    const handler = createCodebaseExtractHandler(deps);
    const first = ok(await handler({ rootPath }));
    expect(first.undecided.items.map((c: any) => c.symbol)).toContain("Helpers"); // without acceptTier1 it stays a card
    clearModelCache();
    const r = ok(await handler({ rootPath, changeset: first.changeset.name, acceptTier1: true }));
    expect(r.tier1.notElementRecorded).toBe(1);
    expect(r.undecided.items.map((c: any) => c.symbol)).toEqual(["Helpers.format"]);
    expect(r.notElements.recorded.items).toContainEqual({ symbol: "Helpers", file: HELPERS_FILE, how: "rejected" });
    const decisions = JSON.parse(await readFile(join(rootPath, ".dr", "analyzers", "extract", "decisions.json"), "utf-8"));
    expect(Object.values(decisions.notElements).map((d: any) => d.reason)[0]).toContain("debug.applyNotElement");
  });

  it("never asks about a modelled symbol, and a Tier-1 type never retypes one", async () => {
    await optIn();
    // OwnerService is modelled as a component: Tier 1 isn't asked about it, nothing is retyped.
    ok(
      await modelAddHandler({
        rootPath,
        layer: "application",
        type: "applicationcomponent",
        name: "Owner Service",
        attributes: { type: "internal" },
        sourceFile: SERVICE_FILE,
        sourceSymbol: "OwnerService",
        sourceProvenance: "extracted",
      } as any)
    );
    clearModelCache();
    const model = new ScriptedModel();
    const { deps } = setup(model);
    const r = ok(await createCodebaseExtractHandler(deps)({ rootPath, acceptTier1: undefined }));
    expect(r.tier1.cards).toBe(2);
    expect(model.calls.some((c) => c.state.includes("public class OwnerService"))).toBe(false);
    expect(r.retyped).toBeUndefined();

    // And in the planner: a Tier-1 decision for a symbol matched to an element of another type is
    // counted as modelled, never retyped.
    const model2 = await Model.load(rootPath);
    const graph = await ChangesetGraph.build(
      model2,
      new Changeset({ id: "x", name: "x", created: "", modified: "", status: "staged", baseSnapshot: "", changes: [] })
    );
    const extraction = await collectExtraction(fakeGraph(springProject()), CONFIG, "cbm", { codebaseRoot: rootPath, checkFiles: [] } as any);
    const sym = extraction.symbols.find((s) => s.card.name === "OwnerService")!;
    const decided = withTier1Decided(extraction, new Map([[sym.card.id, { layer: "application", type: "applicationservice", rule: "tier1:dr-qset-2" }]]));
    const plan = planElements(decided, graph, { fileExists: () => true });
    expect(plan.retyped).toEqual([]);
    expect(plan.adds.some((a) => a.symbol.card.name === "OwnerService")).toBe(false);
  });
});

describe("tier1_status", () => {
  it("off: says so, with no keys and no request", async () => {
    const { deps } = setup(null);
    const r = ok(await createTier1StatusHandler(deps)({ rootPath }));
    expect(r).toMatchObject({ state: "off", analyzer: "cbm", config: ".dr/analyzers/cbm/tier1.json", credentials: {} });
    expect(r.note).toContain("no tool writes tier1.json");
  });

  it("on: provider, model, where keys come from (never their values), spend by source; probe: true tests it and records the cost", async () => {
    await optIn({ monthlyCapUsd: 5 });
    const model = new ScriptedModel().answer("*", { ...stage1("application", 0.9), element_type: choiceAnswer("applicationcomponent", 0.8) });
    const { deps } = setup(model);
    const r = ok(await createTier1StatusHandler(deps)({ rootPath }));
    expect(r).toMatchObject({
      state: "on",
      provider: "cloudflare-workers-ai",
      model: "clef",
      monthlyCapUsd: 5,
      credentials: { accountId: { set: true, from: "tier1.json" }, apiToken: { set: true, from: "tier1.json" } },
      month: { spentUsd: 0, capUsd: 5 },
    });
    expect(model.calls.length).toBe(0);

    const probed = ok(await createTier1StatusHandler(deps)({ rootPath, probe: true }));
    expect(probed.probe).toMatchObject({ sent: true, provider: "fake", model: "fake/clef" });
    expect(probed.probe.notice).toContain("one synthetic card (no project code)");
    expect(model.calls.length).toBeGreaterThan(0);
    const after = ok(await createTier1StatusHandler(deps)({ rootPath }));
    expect(after.bySource.probe).toMatchObject({ cards: 1 });
    expect(after.month.spentUsd).toBeGreaterThan(0);
  });

  it("probe is not sent when Tier 1 isn't ready", async () => {
    const { deps } = setup(null);
    const r = ok(await createTier1StatusHandler(deps)({ rootPath, probe: true }));
    expect(r.probe).toMatchObject({ sent: false });
    expect(r.probe.reason).toContain("Tier 1 is off");
  });
});

describe("project_status's tier1 section", () => {
  it("off without tier1.json; on with the month's spend once opted in, never a key", async () => {
    const off = await projectStatus({ rootPath }, { tier1: { env: {} } });
    expect(off.tier1).toMatchObject({ state: "off", analyzer: "cbm" });
    expect((off.tier1 as any).month).toBeUndefined();

    await optIn({ monthlyCapUsd: 7 });
    const on = await projectStatus({ rootPath }, { tier1: { env: {} } });
    expect(on.tier1).toMatchObject({ state: "on", provider: "cloudflare-workers-ai", model: "clef", month: { spentUsd: 0, capUsd: 7, remainingUsd: 7 } });
    expectNoSecret(JSON.stringify(on));
  });
});

describe("origin on staged changes", () => {
  it("compactChange keeps origin, so an unstage tombstone says who decided the change", () => {
    const origin = { by: "tier1" as const, rule: "tier1:dr-qset-2", p: { layer: 0.8, type: 0.5 }, confirmed: "agent" as const };
    expect(compactChange({ type: "add", elementId: "a.b.c", layerName: "a", after: { id: "a.b.c" }, origin }).origin).toEqual(origin);
    expect(compactChange({ type: "add", elementId: "a.b.c", layerName: "a", after: { id: "a.b.c" } })).not.toHaveProperty("origin");
  });
});

/**
 * Fill the Tier-1 cache for the spring project's askable cards with `model`'s answers, as
 * `dr analyzer classify` (or the index job's fill) would: no codebase_extract run shows them.
 */
async function prefillCache(model: FakeDecisionModel): Promise<void> {
  const session = await openTier1(rootPath, "cbm", { env: {}, createModel: () => model });
  if (session.state !== "ready") throw new Error(`not ready: ${session.state}`);
  const extraction = await collectExtraction(fakeGraph(springProject()), CONFIG, "cbm", { codebaseRoot: rootPath, checkFiles: [] } as any);
  const items = extraction.symbols
    .filter((s) => ["OwnerService", "Helpers", "format"].includes(s.card.name))
    .map((s) => ({ id: s.card.id, card: s.card, ...(s.tier0?.kind === "narrow" ? { narrow: s.tier0.candidates } : {}) }));
  expect(items.length).toBe(3);
  await classifyTier1(items, { model, spec, host: session.host, qset: session.qset, cache: session.cache, thresholds: session.thresholds });
}

describe("codebase_extract with Tier 1: review fixes", () => {
  it("with layers, an accept answer outside them is shown as escalate with why, and never dropped by acceptTier1", async () => {
    await optIn();
    const model = new ScriptedModel([
      SCRIPT[0],
      SCRIPT[1],
      ["public class Helpers", { ...stage1("technology", 0.9), element_type: choiceAnswer("systemsoftware", 0.8) }],
    ]);
    const { deps } = setup(model);
    const handler = createCodebaseExtractHandler(deps);
    const first = ok(await handler({ rootPath, layers: ["application"] }));
    const helpers = first.undecided.items.find((c: any) => c.symbol === "Helpers");
    expect(helpers.tier1).toMatchObject({ band: "escalate", layer: "technology", type: "systemsoftware" });
    expect(helpers.tier1.reason).toContain("outside this run's layers");
    expect(first.tier1.bands).toEqual({ accept: 1, notElement: 0, escalate: 2 });

    clearModelCache();
    const r = ok(await handler({ rootPath, changeset: first.changeset.name, acceptTier1: true }));
    expect(r.tier1.staged).toBe(1);
    expect(r.staged.adds).toBe(1);
    // Nothing dropped out of both the adds and the cards.
    expect(r.undecided.items.map((c: any) => c.symbol).sort()).toEqual(["Helpers", "Helpers.format"]);
    expect(r.undecided.items.find((c: any) => c.symbol === "Helpers").tier1.band).toBe("escalate");
  });

  it("acceptTier1 with no earlier run showing the cards stages none of the cache's accept band, and says to look first", async () => {
    await optIn();
    await prefillCache(new ScriptedModel());
    const model = new ScriptedModel();
    const { deps } = setup(model);
    const r = ok(await createCodebaseExtractHandler(deps)({ rootPath, acceptTier1: true }));
    expect(model.calls.length).toBe(0);
    expect(r.tier1).toMatchObject({ cached: 3, sent: 0, staged: 0 });
    expect(r.staged.adds).toBe(5); // Tier 0's only
    const service = r.undecided.items.find((c: any) => c.symbol === "OwnerService");
    expect(service.tier1).toMatchObject({ band: "escalate", layer: "application", type: "applicationservice", reason: NOT_SHOWN_REASON });
    expect(r.next.join(" ")).toContain("1 accept-band answer(s) weren't shown that way before");
    expect(r.next.join(" ")).toContain("no acceptTier1");

    // Shown once, it can be accepted.
    clearModelCache();
    const shown = ok(await createCodebaseExtractHandler(deps)({ rootPath, changeset: r.changeset.name }));
    expect(shown.undecided.items[0].tier1.band).toBe("accept");
    clearModelCache();
    expect(ok(await createCodebaseExtractHandler(deps)({ rootPath, changeset: r.changeset.name, acceptTier1: true })).tier1.staged).toBe(1);
  });

  it("acceptTier1 doesn't stage an answer a threshold change moved into the accept band since it was shown", async () => {
    await optIn({ thresholds: { type: 0.8 } }); // OwnerService's type p 0.7 escalates
    const { deps } = setup(new ScriptedModel());
    const handler = createCodebaseExtractHandler(deps);
    const first = ok(await handler({ rootPath }));
    expect(first.undecided.items.find((c: any) => c.symbol === "OwnerService").tier1.band).toBe("escalate");
    await optIn(); // the default thresholds: now in the accept band
    clearModelCache();
    const r = ok(await handler({ rootPath, changeset: first.changeset.name, acceptTier1: true }));
    expect(r.tier1.staged).toBe(0);
    expect(r.undecided.items.find((c: any) => c.symbol === "OwnerService").tier1.reason).toBe(NOT_SHOWN_REASON);
  });

  it("acceptTier1 doesn't stage a cached answer that changed since it was shown", async () => {
    await optIn();
    const { deps } = setup(new ScriptedModel());
    const handler = createCodebaseExtractHandler(deps);
    const first = ok(await handler({ rootPath }));
    expect(first.undecided.items[0]).toMatchObject({ symbol: "OwnerService", tier1: { band: "accept", type: "applicationservice" } });
    // Another process refilled the cache with a different answer (another type, still accept).
    await rm(tier1Paths(rootPath, "cbm").cache, { recursive: true, force: true });
    await prefillCache(new ScriptedModel([["public class OwnerService", { ...stage1("application", 0.85), element_type: choiceAnswer("applicationcomponent", 0.7) }]]));
    clearModelCache();
    const r = ok(await handler({ rootPath, changeset: first.changeset.name, acceptTier1: true }));
    expect(r.tier1.staged).toBe(0);
    expect(r.undecided.items.find((c: any) => c.symbol === "OwnerService").tier1).toMatchObject({ type: "applicationcomponent", reason: NOT_SHOWN_REASON });
  });

  it("acceptTier1 with nothing cached says why nothing was staged", async () => {
    await optIn();
    const { deps } = setup(new ScriptedModel());
    const r = ok(await createCodebaseExtractHandler(deps)({ rootPath, acceptTier1: true }));
    expect(r.tier1.staged).toBe(0);
    expect(r.next.join(" ")).toContain("3 card(s) had no cached answer");
  });

  it("reserves time for planning from the measured first pass", () => {
    expect(tier1DeadlineAt(0, 100_000, 0, 0)).toBe(80_000);
    expect(tier1DeadlineAt(0, 100_000, 10_000, 0)).toBe(60_000);
    expect(tier1DeadlineAt(0, 100_000, 30_000, 50_000)).toBe(50_000); // never before now
  });

  it("Tier 1 running past the budget never stops Tier 0's decisions from being staged", async () => {
    await optIn();
    // Ignores cancellation and answers after the whole budget has gone.
    class Stubborn extends ScriptedModel {
      override async ask(state: string, questions: Record<string, Question>, options: AskOptions = {}): Promise<AskResult> {
        await new Promise((resolve) => setTimeout(resolve, 3200));
        return super.ask(state, questions, options);
      }
    }
    const { deps } = setup(new Stubborn(), { budgetMs: 2500 });
    const r = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(r.staged.adds).toBe(5);
    expect(r.durationMs).toBeGreaterThan(2500);
  }, 20_000);

  it("refuses to stage when the changeset moved while Tier 1 was answering; a rerun is answered from the cache", async () => {
    await optIn();
    const { deps } = setup(new ScriptedModel());
    const first = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    await rm(tier1Paths(rootPath, "cbm").cache, { recursive: true, force: true });
    // The agent stages into the extraction changeset while Tier 1 is asked.
    let staged = false;
    class Interleaved extends ScriptedModel {
      override async ask(state: string, questions: Record<string, Question>, options: AskOptions = {}): Promise<AskResult> {
        if (!staged) {
          staged = true;
          ok(await modelAddHandler({ rootPath, layer: "application", type: "applicationcomponent", name: "Sneaky", attributes: { type: "internal" } } as any));
        }
        return super.ask(state, questions, options);
      }
    }
    const model = new Interleaved();
    const moved = setup(model);
    clearModelCache();
    const err = fail(await createCodebaseExtractHandler(moved.deps)({ rootPath, changeset: first.changeset.name }));
    expect(err.error).toContain("changed while Tier 1 was answering");
    expect(err.suggestions.join(" ")).toContain("cached");
    const calls = model.calls.length;
    clearModelCache();
    const again = ok(await createCodebaseExtractHandler(moved.deps)({ rootPath, changeset: first.changeset.name }));
    expect(again.tier1).toMatchObject({ sent: 0, cached: 3 });
    expect(model.calls.length).toBe(calls);
  });

  it("a cancelled request stops asking and stages nothing", async () => {
    await optIn();
    const controller = new AbortController();
    class Cancelling extends SlowModel {
      override async ask(state: string, questions: Record<string, Question>, options: AskOptions = {}): Promise<AskResult> {
        controller.abort();
        return super.ask(state, questions, options);
      }
    }
    const { deps } = setup(new Cancelling());
    const err = fail(await createCodebaseExtractHandler(deps)({ rootPath }, { signal: controller.signal } as any));
    expect(err.error).toContain("cancelled before staging");
    expect(existsSync(join(rootPath, "documentation-robotics", "changesets"))).toBe(false);
  });

  it("a relationship to an element Tier 1 decided in an earlier run takes that element's origin", async () => {
    await optIn();
    const project = springProject();
    const model = new ScriptedModel([
      SCRIPT[0],
      ["static String format", { ...stage1("application", 0.9), element_type: choiceAnswer("applicationfunction", 0.8) }],
      ["public class Helpers", { ...stage1("application", 0.9), element_type: choiceAnswer("applicationcomponent", 0.8) }],
    ]);
    const { deps } = setup(model, { project });
    const handler = createCodebaseExtractHandler(deps);
    const first = ok(await handler({ rootPath }));
    clearModelCache();
    ok(await handler({ rootPath, changeset: first.changeset.name, acceptTier1: true }));
    // The code gains the edge after both ends were staged from Tier 1.
    const helpers = project.nodes.find((n) => n.name === "Helpers")!.qualified_name;
    const format = project.nodes.find((n) => n.name === "format")!.qualified_name;
    project.edges.push({ type: "DEFINES_METHOD", from: helpers, to: format });
    clearModelCache();
    const r = ok(await handler({ rootPath, changeset: first.changeset.name }));
    expect(r.staged.relationships).toBe(1);
    const changeset = await changesetOf(first.changeset.id);
    const rel = changeset.changes.find((c) => c.type === "relationship-add" && c.elementId.includes("helpers"))!;
    expect(rel.origin).toMatchObject({ by: "tier1", rule: "tier1:dr-qset-2", confirmed: "agent" });
  });
});
