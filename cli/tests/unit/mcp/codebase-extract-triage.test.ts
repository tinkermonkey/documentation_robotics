/**
 * Unit tests for codebase_extract's triage: groups before cards, decide by rule, the project's
 * rules file, the since pile, views and lists, shared helpers, plan coverage, the batch file and
 * intent. The analyzer's graph is faked (a small TypeScript project); everything else is the real code.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { createCodebaseExtractHandler } from "../../../src/mcp/tools/codebase-extract.js";
import type { CodebaseToolDeps } from "../../../src/mcp/tools/codebase-shared.js";
import { writeIndexMeta, writeSession } from "../../../src/analyzers/session-state.js";
import type { SpawnFn } from "../../../src/analyzers/index-job.js";
import type { AnalyzerBackend } from "../../../src/analyzers/base-analyzer.js";
import { collectExtraction } from "../../../src/analyzers/cards/extract.js";
import type { CodeChangesResult } from "../../../src/analyzers/code-changes.js";
import { projectRulesPath } from "../../../src/analyzers/project-rules.js";
import { CONFIG, P, fakeGraph, type FakeNode, type FakeProject } from "../../helpers/fake-cbm-graph.js";

const HEAD = "1111111111111111111111111111111111111111";
const META = { git_head: HEAD, timestamp: "2026-11-20T12:00:00.000Z", node_count: 120, edge_count: 340 };
const SLOW = 120_000;

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}
function ok(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return parse(result);
}
function fail(result: any): any {
  expect(result.isError).toBe(true);
  return parse(result);
}

const qn = (file: string, ...names: string[]) => `${P}.${file.replace(/\.\w+$/, "").replace(/\//g, ".")}.${names.join(".")}`;

function fn(file: string, name: string, line: number, source?: string): FakeNode {
  return { label: "Function", name, qualified_name: qn(file, name), file_path: file, start_line: line, end_line: line + 4, source: source ?? `export function ${name}() {}` };
}
function local(file: string, name: string, line: number): FakeNode {
  return fn(file, name, line, `function ${name}() {}`);
}
function iface(file: string, name: string, line: number): FakeNode {
  return { label: "Interface", name, qualified_name: qn(file, name), file_path: file, start_line: line, end_line: line + 3, source: `export interface ${name} {\n  id: string;\n}` };
}

/**
 * A small TypeScript project: two product files with exported and local functions and interfaces,
 * and a prototype folder with 30 functions that is not product code.
 */
function project(): FakeProject {
  const nodes: FakeNode[] = [
    fn("src/app/plan.ts", "buildPlan", 1),
    fn("src/app/plan.ts", "applyPlan", 10),
    local("src/app/plan.ts", "tally", 20),
    local("src/app/plan.ts", "pluralize", 30),
    iface("src/app/plan.ts", "PlanOptions", 40),
    fn("src/app/report.ts", "renderReport", 1),
    local("src/app/report.ts", "pad", 10),
    iface("src/app/report.ts", "ReportRow", 20),
  ];
  for (let i = 0; i < 30; i++) nodes.push(local(`design/proto/canvas${i % 3}.js`, `draw${i}`, 1 + i * 10));
  return { nodes, edges: [] };
}

interface Harness {
  deps: CodebaseToolDeps;
  project: FakeProject;
  changes: { value: CodeChangesResult | null };
}

function harness(p: FakeProject = project()): Harness {
  const h: Harness = { project: p, changes: { value: null }, deps: undefined as unknown as CodebaseToolDeps };
  const backend = {
    name: "cbm",
    detect: async () => ({ installed: true, binary_path: "/bin/cbm" }),
    extract: async (_root: string, options: any) => collectExtraction(fakeGraph(h.project), CONFIG, "cbm", options),
  } as unknown as AnalyzerBackend;
  const spawn: SpawnFn = () => Object.assign(new EventEmitter(), { pid: 60000, unref() {} }) as any;
  h.deps = {
    getAnalyzer: async (name) => (name === "cbm" ? backend : undefined),
    discover: async () => ({ found: [], selected: "cbm" }),
    spawn,
    drCommand: { command: "/usr/bin/node", args: ["/opt/dr/dist/cli.js"] },
    isAlive: () => true,
    gitHead: () => HEAD,
    codeChanges: async () => {
      if (!h.changes.value) throw new Error("no changes configured");
      return h.changes.value;
    },
  };
  return h;
}

let rootPath: string;

beforeEach(async () => {
  clearModelCache();
  const dir = join(tmpdir(), `dr-mcp-triage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  rootPath = await realpath(dir);
  await Model.init(rootPath, { name: "Triage Test Model", version: "0.1.0" });
  await writeSession({ active_analyzer: "cbm", selected_at: new Date().toISOString() }, rootPath);
  await writeIndexMeta(META, rootPath, "cbm");
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

async function changesetOf(id: string) {
  clearModelCache();
  const model = await Model.load(rootPath);
  return (await new StagingAreaManager(rootPath, model).load(id))!;
}

/** Add an element to the base model, so the model names a product file. */
async function addToBase(element: Record<string, unknown>): Promise<void> {
  ok(await modelAddHandler({ rootPath, ...(element as any) }));
  clearModelCache();
}

const decisionsFile = () => join(rootPath, ".dr", "analyzers", "extract", "decisions.json");

const NOT_PRODUCT = { where: { files: "design/**" }, as: "none", reason: "design prototypes are not product code" };
const EXPORTED_FUNCTIONS = { where: { files: "src/**", label: "Function", visibility: "exported" }, as: "application.applicationfunction", reason: "a module's public behaviour" };
const LOCAL_FUNCTIONS = { where: { label: "Function", visibility: "local" }, as: "none", reason: "module-private helpers are part of their module" };
const EXPORTED_TYPES = { where: { label: "Interface", visibility: "exported" }, as: "data-model.objectschema", reason: "an interface is a schema" };

describe("codebase_extract triage: groups before cards (#1154, #1177)", () => {
  it("answers a large run with groups and counts, and reads the cards by view and page", async () => {
    await addToBase({ layer: "application", type: "applicationcomponent", name: "Planner", attributes: { type: "internal" }, sourceFile: "src/app/plan.ts" });
    const handler = createCodebaseExtractHandler(harness().deps);
    const run = ok(await handler({ rootPath }));

    // 38 cards is more than a page: grouped, not listed.
    expect(run.undecided.total).toBe(38);
    expect(run.undecided.items).toBeUndefined();
    expect(run.undecided.cards).toContain("38 cards are more than a page");
    const groups = run.undecided.groups;
    expect(groups).toMatchObject({ total: 2, returned: 2, depth: 2 });
    expect(groups.items).toEqual([
      { path: "design/proto/", cards: 30, files: 3, labels: { Function: 30 }, visibility: { local: 30 }, elements: 0, noElement: true },
      { path: "src/app/", cards: 8, files: 2, labels: { Function: 6, Interface: 2 }, visibility: { exported: 5, local: 3 }, elements: 1 },
    ]);
    // Counts are over every card, not over a page of them.
    expect(groups.items.reduce((n: number, g: any) => n + g.cards, 0)).toBe(run.undecided.total);
    expect(run.undecided.byKind).toEqual([
      { label: "Function", visibility: "local", cards: 33 },
      { label: "Function", visibility: "exported", cards: 3 },
      { label: "Interface", visibility: "exported", cards: 2 },
    ]);
    expect(run.next.find((s: string) => s.includes("decide them by group first"))).toContain("noElement");

    // The cards of one group, a page at a time: the pages together are the group.
    const seen: string[] = [];
    let page = 1;
    for (;;) {
      const read = ok(await handler({ view: { files: "design/**" }, page, pageSize: 8, rootPath }));
      expect(read.undecided.total).toBe(30);
      expect(read.undecided.pages).toBe(4);
      seen.push(...read.undecided.items.map((c: any) => c.symbol));
      if (page === read.undecided.pages) {
        expect(read.next).toBeUndefined();
        break;
      }
      expect(read.next).toContain(`view: {"files":"design/**"}, page: ${page + 1}`);
      page++;
    }
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    // A card says what a rule can go by.
    const card = ok(await handler({ view: { label: "Interface" }, rootPath })).undecided.items[0];
    expect(card).toMatchObject({ symbol: "PlanOptions", visibility: "exported", label: "Interface" });
    // view: {} is every card.
    expect(ok(await handler({ view: {}, pageSize: 200, rootPath })).undecided.items).toHaveLength(38);
  }, SLOW);

  it("pages the groups, deeper on request, with the true total on every page", async () => {
    const handler = createCodebaseExtractHandler(harness().deps);
    const run = ok(await handler({ limit: 1, rootPath }));
    expect(run.undecided.groups).toMatchObject({ total: 2, returned: 1, nextOffset: 1 });
    expect(run.undecided.groups.more).toContain('list: "groups", limit: 1 and offset: 1');
    const rest = ok(await handler({ list: "groups", limit: 1, offset: 1, rootPath }));
    expect(rest).toMatchObject({ list: "groups", total: 2, returned: 1, offset: 1, cards: 38 });
    expect(rest.nextOffset).toBeUndefined();
    expect([...run.undecided.groups.items, ...rest.items].map((g: any) => g.path)).toEqual(["design/proto/", "src/app/"]);

    // A folder opened a level deeper: groups are then its files.
    const files = ok(await handler({ list: "groups", view: { files: "design/**" }, groupBy: "file", rootPath }));
    expect(files.items.map((g: any) => [g.path, g.cards])).toEqual([
      ["design/proto/canvas0.js", 10],
      ["design/proto/canvas1.js", 10],
      ["design/proto/canvas2.js", 10],
    ]);
    expect(fail(await handler({ list: "nope" as any, rootPath })).error).toBeDefined();
  }, SLOW);

  it("previews the groups without creating anything", async () => {
    const handler = createCodebaseExtractHandler(harness().deps);
    const preview = ok(await handler({ preview: true, rootPath }));
    expect(preview.undecided).toMatchObject({ total: 38, groups: { total: 2 } });
    expect(preview.undecided.byKind[0]).toEqual({ label: "Function", visibility: "local", cards: 33 });
    expect(existsSync(join(rootPath, ".dr", "analyzers", "extract", "pending.json"))).toBe(false);
  }, SLOW);
});

describe("codebase_extract decide: bulk decisions by a stated rule", () => {
  it("previews each item's count and a sample, and changes nothing", async () => {
    const handler = createCodebaseExtractHandler(harness().deps);
    const preview = ok(
      await handler({ preview: true, decide: [NOT_PRODUCT, EXPORTED_FUNCTIONS, { where: { label: "Trait" }, as: "none", reason: "none here" }], rootPath })
    );
    expect(preview.decide).toMatchObject({ total: 3, counts: { "would-apply": 2, "no-match": 1 }, attentionTotal: 1 });
    expect(preview.decide.attention).toEqual([
      expect.objectContaining({ index: 2, status: "no-match", reason: expect.stringContaining("covers no undecided card") }),
    ]);
    const all = ok(await handler({ preview: true, verbose: true, decide: [NOT_PRODUCT, EXPORTED_FUNCTIONS], rootPath })).decide.results;
    expect(all[0]).toMatchObject({ index: 0, status: "would-apply", as: "none", matched: 30, notElements: 30, staged: 0 });
    expect(all[0].sample).toHaveLength(5);
    expect(all[1]).toMatchObject({ index: 1, status: "would-apply", matched: 3, staged: 3, notElements: 0 });
    expect(all[1].sample.sort()).toEqual([
      "application.applicationfunction.apply-plan",
      "application.applicationfunction.build-plan",
      "application.applicationfunction.render-report",
    ]);
    // What is left once the two apply: the three local functions and the two interfaces.
    expect(preview.undecided.total).toBe(5);
    expect(preview.wouldStage.adds).toBe(3);
    // Nothing written: no rules file, no decisions, no changeset.
    expect(existsSync(projectRulesPath(rootPath))).toBe(false);
    expect(existsSync(decisionsFile())).toBe(false);
    clearModelCache();
    expect((await new StagingAreaManager(rootPath, await Model.load(rootPath)).list()).length).toBe(0);
  }, SLOW);

  it("applies items, stages by rule with the agent's origin, and keeps a rule on record for later runs", async () => {
    const h = harness();
    const handler = createCodebaseExtractHandler(h.deps);
    const run = ok(await handler({ decide: [{ ...NOT_PRODUCT, keep: true }, { ...EXPORTED_FUNCTIONS, keep: true, name: "exported-functions" }, LOCAL_FUNCTIONS], rootPath }));

    expect(run.decide).toEqual({ total: 3, counts: { kept: 2, applied: 1 } });
    expect(run.staged.adds).toBe(3);
    expect(run.undecided.items.map((c: any) => c.symbol).sort()).toEqual(["PlanOptions", "ReportRow"]);
    const staged = (await changesetOf(run.changeset.id)).changes.filter((c) => c.type === "add");
    expect(staged.map((c) => c.elementId).sort()).toEqual([
      "application.applicationfunction.apply-plan",
      "application.applicationfunction.build-plan",
      "application.applicationfunction.render-report",
    ]);
    // The decision is the agent's, applied by a named rule.
    expect(staged[0].origin).toEqual({ by: "agent", rule: "project:exported-functions" });
    expect((staged[0].after as any).source_reference).toEqual({ provenance: "extracted", locations: [{ file: "src/app/plan.ts", symbol: "applyPlan" }] });

    // The two kept rules are in the project's file, with the reason and where they were decided.
    const rulesText = await readFile(projectRulesPath(rootPath), "utf-8");
    expect(rulesText).toContain("name: exported-functions");
    expect(rulesText).toContain("reason: design prototypes are not product code");
    expect(rulesText).toContain(`changeset: ${run.changeset.name}`);
    expect(rulesText).not.toContain("module-private helpers");
    expect(run.next.some((s: string) => s.includes("commit that file"))).toBe(true);
    // The item not kept recorded each symbol it ruled out, as reject does; the kept ones did not.
    const decisions = JSON.parse(await readFile(decisionsFile(), "utf-8"));
    expect(Object.keys(decisions.notElements).sort()).toEqual(["src/app/plan.ts#pluralize", "src/app/plan.ts#tally", "src/app/report.ts#pad"]);
    expect(run.notElements.recorded).toMatchObject({ total: 3, rejected: 3, unstaged: 0 });
    expect(run.notElements.recorded.items).toBeUndefined();

    // Another checkout: no recorded decisions, only the committed rules file. New code arrives too.
    await rm(join(rootPath, ".dr", "analyzers", "extract"), { recursive: true, force: true });
    h.project.nodes.push(fn("src/app/export.ts", "exportModel", 1), local("design/proto/canvas9.js", "sketch", 1));
    const later = ok(await handler({ changeset: "later", rootPath }));
    expect(later.rules).toMatchObject({ file: "documentation-robotics/extraction-rules.yaml", inFile: 2 });
    expect(later.rules.decided.items).toEqual([
      expect.objectContaining({ rule: "not-in-design", as: "none", notElements: 31, staged: 0, sampleOf: 31 }),
      expect.objectContaining({ rule: "exported-functions", as: "application.applicationfunction", notElements: 0, staged: 4 }),
    ]);
    expect(later.staged.adds).toBe(4);
    // Only what no rule covers is asked: the local functions (their decisions were local) and the interfaces.
    expect(later.undecided.items.map((c: any) => c.symbol).sort()).toEqual(["PlanOptions", "ReportRow", "pad", "pluralize", "tally"]);
    // Everything a rule decided is reachable, a page at a time.
    const decided = ok(await handler({ list: "ruleDecided", rule: "not-in-design", limit: 20, rootPath }));
    expect(decided).toMatchObject({ total: 31, returned: 20, nextOffset: 20 });
    const rest = ok(await handler({ list: "ruleDecided", rule: "not-in-design", limit: 20, offset: 20, rootPath }));
    expect(new Set([...decided.items, ...rest.items].map((x: any) => x.notElement)).size).toBe(31);
    expect(fail(await handler({ list: "ruleDecided", rootPath })).error).toContain("needs rule");
  }, SLOW);

  it("a typed rule sent in a call never stages what a none rule kept in the file excludes", async () => {
    const h = harness();
    const handler = createCodebaseExtractHandler(h.deps);
    // The design folder is decided not product code, and kept.
    ok(await handler({ decide: [{ ...NOT_PRODUCT, keep: true, name: "not-product" }], rootPath }));
    // A later call sends a typed rule that also matches the design folder's functions.
    const run = ok(
      await handler({
        changeset: "later",
        decide: [{ where: { label: "Function" }, as: "application.applicationfunction", reason: "every function", name: "all-functions" }],
        verbose: true,
        rootPath,
      })
    );
    const staged = (await changesetOf(run.changeset.id)).changes.filter((c) => c.type === "add").map((c) => c.elementId);
    expect(staged.some((id) => id.includes("draw"))).toBe(false);
    // The 6 functions of src/ and nothing of design/.
    expect(run.decide.results[0]).toMatchObject({ status: "applied", staged: 6 });
    expect(run.rules.decided.items.find((r: any) => r.rule === "not-product")).toMatchObject({ notElements: 30 });
  }, SLOW);

  it("a decision on one card wins over every rule, and stages", async () => {
    const handler = createCodebaseExtractHandler(harness().deps);
    ok(await handler({ rootPath }));
    const card = ok(await handler({ view: { label: "Interface" }, rootPath })).undecided.items.find((c: any) => c.symbol === "PlanOptions");
    const run = ok(
      await handler({
        decide: [
          { card: card.cardId, as: "data-model.objectschema", reason: "the planner's options" },
          { where: { label: "Interface" }, as: "none", reason: "interfaces are decided one by one" },
        ],
        verbose: true,
        rootPath,
      })
    );
    expect(run.decide.results[0]).toMatchObject({ status: "applied", id: "data-model.objectschema.plan-options" });
    expect(run.decide.results[1]).toMatchObject({ status: "applied", notElements: 1 });
    const staged = (await changesetOf(run.changeset.id)).changes.filter((c) => c.type === "add").map((c) => c.elementId);
    expect(staged).toContain("data-model.objectschema.plan-options");
  }, SLOW);

  it("decides one card, and reports an item that cannot be applied without refusing the others", async () => {
    const handler = createCodebaseExtractHandler(harness().deps);
    ok(await handler({ decide: [NOT_PRODUCT, LOCAL_FUNCTIONS, EXPORTED_FUNCTIONS], rootPath }));
    const cards = ok(await handler({ view: {}, rootPath })).undecided.items;
    const planOptions = cards.find((c: any) => c.symbol === "PlanOptions");
    const run = ok(
      await handler({
        decide: [
          { card: planOptions.cardId, as: "data-model.objectschema", reason: "the planner's options" },
          { card: "ReportRow", as: "none", reason: "a view row, not a concept" },
          { card: "NoSuchCard", as: "none", reason: "x" },
          { where: { label: "Interface" }, card: "ReportRow", as: "none", reason: "two things named" },
          { where: { label: "Interface" }, as: "data-model.nothing", reason: "a type the layer does not have" },
          { card: planOptions.cardId, as: "none", reason: "x", keep: true },
        ],
        rootPath,
      })
    );
    expect(run.decide.counts).toEqual({ applied: 2, "no-match": 1, invalid: 3 });
    expect(run.decide.attention.map((a: any) => [a.index, a.status])).toEqual([
      [2, "no-match"],
      [3, "invalid"],
      [4, "invalid"],
      [5, "invalid"],
    ]);
    expect(run.decide.attention[2].reason).toContain("has no type 'nothing'");
    expect(run.undecided.total).toBe(0);
    const ids = (await changesetOf(run.changeset.id)).changes.filter((c) => c.type === "add").map((c) => c.elementId);
    expect(ids).toContain("data-model.objectschema.plan-options");
    expect(Object.keys(JSON.parse(await readFile(decisionsFile(), "utf-8")).notElements)).toContain("src/app/report.ts#ReportRow");
    // decide is a run: it cannot ride on a read.
    expect(fail(await handler({ decide: [NOT_PRODUCT], view: {}, rootPath })).error).toContain("decide is applied in a run");
  }, SLOW);

  it("takes reject and decide from a file, in the batch file format", async () => {
    const handler = createCodebaseExtractHandler(harness().deps);
    ok(await handler({ rootPath }));
    await writeFile(
      join(rootPath, "decisions.json"),
      JSON.stringify({ reject: [{ files: "design/**", reason: "prototypes" }, { files: "nope/**", reason: "x" }], decide: [EXPORTED_TYPES] }),
      "utf-8"
    );
    const run = ok(await handler({ file: "decisions.json", rootPath }));
    expect(run.reject).toMatchObject({ total: 2, counts: { recorded: 1, "no-match": 1 }, attentionTotal: 1 });
    expect(run.reject.attention[0]).toMatchObject({ index: 1, status: "no-match", item: "files: nope/**" });
    expect(run.decide).toEqual({ total: 1, counts: { applied: 1 } });
    expect(run.staged.adds).toBe(2);
    expect(run.undecided.total).toBe(6);

    expect(fail(await handler({ file: "decisions.json", reject: [{ files: "design/**", reason: "x" }], rootPath })).error).toContain("either file or the inline");
    await writeFile(join(rootPath, "bad.json"), JSON.stringify({ rejects: [] }), "utf-8");
    expect(fail(await handler({ file: "bad.json", rootPath })).error).toContain("doesn't take 'rejects'");
    expect(fail(await handler({ file: "missing.json", rootPath })).error).toContain("no file at");
  }, SLOW);
});

describe("codebase_extract since: the range's pile", () => {
  function changedPlanFile(h: Harness): void {
    // The range rewrote applyPlan (lines 10-14) and added lines to PlanOptions; the rest of the file is untouched.
    h.changes.value = { base: "abc123", changed: new Set(["src/app/plan.ts"]), deleted: new Map(), hunks: new Map([["src/app/plan.ts", [[11, 12], [41, 41]]]]) };
  }

  it("lists the symbols the range changed, counts the ones it did not touch, and lists those on request", async () => {
    const h = harness();
    changedPlanFile(h);
    const handler = createCodebaseExtractHandler(h.deps);
    const run = ok(await handler({ since: "main", rootPath }));
    expect(run.undecided.items.map((c: any) => c.symbol).sort()).toEqual(["PlanOptions", "applyPlan"]);
    expect(run.undecided.total).toBe(2);
    expect(run.undecided.untouched.total).toBe(3);
    expect(run.undecided.untouched.more).toContain("view: {changed: false}");
    expect(run.next.find((s: string) => s.startsWith("The cards are the symbols the range changed"))).toContain("3 more symbol(s)");

    // The rest is still there, on request, and still rejectable by file.
    const rest = ok(await handler({ view: { changed: false }, rootPath }));
    expect(rest.undecided.items.map((c: any) => c.symbol).sort()).toEqual(["buildPlan", "pluralize", "tally"]);
    expect(ok(await handler({ view: {}, rootPath })).undecided.items).toHaveLength(2);
    expect(ok(await handler({ view: {}, rootPath })).undecided.untouched.total).toBe(3);
  }, SLOW);

  it("a typed rule stages only what the range changed; a none rule applies to all", async () => {
    const h = harness();
    changedPlanFile(h);
    const handler = createCodebaseExtractHandler(h.deps);
    const run = ok(await handler({ since: "main", decide: [EXPORTED_FUNCTIONS, LOCAL_FUNCTIONS], verbose: true, rootPath }));
    expect(run.decide.results[0]).toMatchObject({ status: "applied", staged: 1, untouched: 1, sample: ["application.applicationfunction.apply-plan"] });
    expect(run.decide.results[1]).toMatchObject({ status: "applied", notElements: 2 });
    expect(run.staged.adds).toBe(1);
    // buildPlan was not built by the range: not staged, and not a card of this run.
    expect(run.undecided.items.map((c: any) => c.symbol)).toEqual(["PlanOptions"]);
    expect(run.undecided.untouched.total).toBe(1);
  }, SLOW);

  it("lists every card when the range's changed lines could not be read", async () => {
    const h = harness();
    h.changes.value = { base: "abc123", changed: new Set(["src/app/plan.ts"]), deleted: new Map(), hunksError: "git diff failed" };
    const run = ok(await createCodebaseExtractHandler(h.deps)({ since: "main", rootPath }));
    expect(run.undecided.total).toBe(5);
    expect(run.undecided.untouched).toBeUndefined();
    expect(run.hunksWarning).toBeDefined();
  }, SLOW);
});

describe("codebase_extract shared helpers and relationship rules", () => {
  /** Seven services that each call one helper, and one that also calls a function of its own. */
  function servicesProject(): FakeProject {
    const p: FakeProject = { nodes: [], edges: [] };
    const helper = fn("src/core/result.ts", "jsonResult", 1);
    const own = fn("src/core/plan.ts", "buildPlan", 1);
    p.nodes.push(helper, own);
    for (let i = 1; i <= 7; i++) {
      const service = fn(`src/tools/tool${i}.ts`, `tool${i}Handler`, 1);
      p.nodes.push(service);
      p.edges.push({ type: "CALLS", from: service.qualified_name, to: helper.qualified_name });
      if (i === 1) p.edges.push({ type: "CALLS", from: service.qualified_name, to: own.qualified_name });
    }
    return p;
  }
  const HELPER = "application.applicationfunction.json-result";
  const SERVICES = { where: { files: "src/tools/**" }, as: "application.applicationservice", reason: "tool handlers are services" };
  const FUNCTIONS = { where: { files: "src/core/**" }, as: "application.applicationfunction", reason: "core functions" };

  it("reports the functions many services share, and stages their links unless a rule says not to", async () => {
    const handler = createCodebaseExtractHandler(harness(servicesProject()).deps);
    // Elements a rule decides get their relationships in the same run.
    const first = ok(await handler({ decide: [SERVICES, FUNCTIONS], rootPath }));
    expect(first.staged.adds).toBe(9);
    expect(first.staged.relationships).toBe(8);
    expect(first.sharedHelpers).toMatchObject({ sharedBy: 5, links: 7, staging: 7 });
    expect(first.sharedHelpers.helpers.items).toEqual([{ id: HELPER, services: 7, staging: 7 }]);
    expect(first.sharedHelpers.note).toContain("Nothing is left out because of it");
    expect(first.next.some((s: string) => s.includes("each realize more than 5 services"))).toBe(true);
    // A rerun stages nothing more, and still reports the group, over every link the code shows.
    clearModelCache();
    const run = ok(await handler({ changeset: first.changeset.name, rootPath }));
    expect(run.staged.relationships).toBe(0);
    expect(run.sharedHelpers).toMatchObject({ sharedBy: 5, links: 7, staging: 0 });

    // The line is a default the caller can move, and the output says where it is.
    clearModelCache();
    expect(ok(await handler({ changeset: first.changeset.name, sharedBy: 7, rootPath })).sharedHelpers).toBeUndefined();
    clearModelCache();
    expect(ok(await handler({ changeset: first.changeset.name, sharedBy: 1, rootPath })).sharedHelpers).toMatchObject({ sharedBy: 1, links: 7 });

    // Deciding the helper's links none, on record: the staged ones are unstaged, and later runs don't stage them.
    clearModelCache();
    const decided = ok(
      await handler({
        changeset: first.changeset.name,
        decide: [{ relationship: { source: HELPER, predicate: "realizes" }, as: "none", reason: "a shared helper, not any one service's behaviour", keep: true, name: "json-result-is-shared" }],
        verbose: true,
        rootPath,
      })
    );
    expect(decided.decide.results[0]).toMatchObject({ status: "kept", relationships: 7 });
    expect(decided.unstagedByRule).toMatchObject({ relationships: 7 });
    const left = (await changesetOf(first.changeset.id)).changes.filter((c) => c.type === "relationship-add").map((c) => c.elementId);
    expect(left).toEqual(["application.applicationfunction.build-plan::realizes::application.applicationservice.tool1handler"]);
    clearModelCache();
    const again = ok(await handler({ changeset: first.changeset.name, rootPath }));
    expect(again.staged.relationships).toBe(0);
    expect(again.rules.decided.items).toEqual([expect.objectContaining({ rule: "json-result-is-shared", relationships: 7 })]);
  }, SLOW);
});

describe("codebase_extract intent and plan coverage", () => {
  it("creates the changeset with the confirmed intent, even when the run stages nothing", async () => {
    const handler = createCodebaseExtractHandler(harness().deps);
    const run = ok(await handler({ changeset: "bootstrap-app", intent: "Bring the application layer in from the code.", rootPath }));
    expect(run.changeset).toMatchObject({ name: "bootstrap-app", created: true, active: true, purpose: "bootstrap" });
    const changeset = await changesetOf(run.changeset.id);
    expect(changeset.description).toBe("Bring the application layer in from the code.");
    expect(changeset.changes).toHaveLength(0);
    // Without intent a run that stages nothing creates nothing, as before.
    const other = ok(await handler({ changeset: "another", rootPath }));
    expect(other.changeset).toBeNull();
  }, SLOW);

  it("in a verify run, lists the planned elements with no as-built candidate staged, with their cards", async () => {
    const h = harness();
    h.changes.value = { base: "abc123", changed: new Set(["src/app/plan.ts"]), deleted: new Map(), hunks: new Map([["src/app/plan.ts", "all"]]) };
    ok(await changesetCreateHandler({ name: "plan-the-planner", description: "Add the planner.", rootPath }));
    ok(
      await modelAddHandler({
        elements: [
          { layer: "application", type: "applicationcomponent", name: "Planner", attributes: { type: "internal" }, sourceFile: "src/app/plan.ts" },
          { layer: "application", type: "applicationfunction", name: "buildPlan" },
          { layer: "application", type: "applicationfunction", name: "undoPlan" },
          { layer: "motivation", type: "goal", name: "Plans are reviewable" },
        ],
        rootPath,
      })
    );
    clearModelCache();
    const handler = createCodebaseExtractHandler(h.deps);
    const run = ok(await handler({ since: "main", changeset: "plan-the-planner-as-built", rootPath }));
    // The goal is intent, not code: it is not in the coverage.
    expect(run.planCoverage).toMatchObject({ plan: "plan-the-planner", total: 3, staged: 0, candidates: 2, none: 1 });
    const items = run.planCoverage.items.items;
    expect(items.map((i: any) => [i.planned, i.status])).toEqual([
      ["application.applicationcomponent.planner", "candidates"],
      ["application.applicationfunction.build-plan", "candidates"],
      ["application.applicationfunction.undo-plan", "none"],
    ]);
    expect(items[0].candidates.map((c: any) => c.symbol).sort()).toEqual(["PlanOptions", "applyPlan", "buildPlan", "pluralize", "tally"]);
    expect(items[1].candidates.map((c: any) => c.symbol)).toEqual(["buildPlan"]);
    expect(run.next.find((s: string) => s.includes("planCoverage"))).toContain("2 have candidate cards and 1 have none");

    // Staging the card that is the planned function covers it.
    const card = items[1].candidates[0].cardId;
    const staged = ok(await handler({ changeset: "plan-the-planner-as-built", decide: [{ card, as: "application.applicationfunction", reason: "the planned function" }], rootPath }));
    expect(staged.planCoverage).toMatchObject({ total: 3, staged: 1, candidates: 1, none: 1 });
  }, SLOW);
});

describe("codebase_extract relationships: a file's other symbols count as its element (#1162, #1181)", () => {
  const javaQn = (file: string, ...names: string[]) => `${P}.${file.replace(/\.java$/, "").replace(/\//g, ".")}.${names.join(".")}`;
  const WS = "src/net/WebSocketClient.java";
  const ORDERS = "src/orders/Orders.java";
  const PANEL = "src/ui/Panel.java";
  const testMethod = (file: string, cls: string, name: string): FakeNode => ({
    label: "Method",
    name,
    qualified_name: javaQn(file, cls, name),
    file_path: file,
    parent_class: javaQn(file, cls),
    start_line: 10,
    end_line: 18,
    source: `@Test\nvoid ${name}() {\n}`,
    decorators: ["@Test"],
  });

  function wiredProject(): FakeProject {
    const p: FakeProject = { nodes: [], edges: [] };
    p.nodes.push(
      { label: "Class", name: "WebSocketClient", qualified_name: javaQn(WS, "WebSocketClient"), file_path: WS, start_line: 1, end_line: 80, source: "public class WebSocketClient {\n}" },
      { label: "Method", name: "connect", qualified_name: javaQn(WS, "WebSocketClient", "connect"), file_path: WS, parent_class: javaQn(WS, "WebSocketClient"), start_line: 10, end_line: 20, source: "public void connect() {\n}" },
      { label: "Class", name: "Orders", qualified_name: javaQn(ORDERS, "Orders"), file_path: ORDERS, start_line: 1, end_line: 40, source: "public class Orders {\n}" },
      { label: "Method", name: "total", qualified_name: javaQn(ORDERS, "Orders", "total"), file_path: ORDERS, parent_class: javaQn(ORDERS, "Orders"), start_line: 5, end_line: 9, source: "private int total() {\n}" },
      { label: "Class", name: "Panel", qualified_name: javaQn(PANEL, "Panel"), file_path: PANEL, start_line: 1, end_line: 40, source: "public class Panel {\n}" },
      { label: "Function", name: "tally", qualified_name: javaQn(ORDERS, "tally"), file_path: ORDERS, start_line: 50, end_line: 60, source: "static int tally() {\n}" },
      testMethod("src/test/net/WsTests.java", "WsTests", "testConnect"),
      testMethod("src/test/orders/OrdersTest.java", "OrdersTest", "testEmptyOrder"),
      testMethod("src/test/misc/MiscTests.java", "MiscTests", "testNothingInParticular")
    );
    p.edges.push(
      // The test constructs the client and calls a member of it.
      { type: "USAGE", from: javaQn("src/test/net/WsTests.java", "WsTests", "testConnect"), to: javaQn(WS, "WebSocketClient") },
      { type: "CALLS", from: javaQn("src/test/net/WsTests.java", "WsTests", "testConnect"), to: javaQn(WS, "WebSocketClient", "connect") },
      // The panel calls a helper of the orders file that has no element of its own.
      { type: "CALLS", from: javaQn(PANEL, "Panel"), to: javaQn(ORDERS, "tally") }
    );
    return p;
  }

  it("links a helper's caller to the file's element, a test to the implementing element, and a test file to the file it is named after", async () => {
    const component = (name: string, file: string, symbol: string) => ({ layer: "application", type: "applicationcomponent", name, attributes: { type: "internal" }, sourceFile: file, sourceSymbol: symbol });
    ok(
      await modelAddHandler({
        elements: [
          // The service that implements the client is named after the exported instance; a security element cites the class.
          { layer: "application", type: "applicationservice", name: "web socket client", attributes: { serviceType: "synchronous" }, sourceFile: WS, sourceSymbol: "websocketClient" },
          { layer: "security", type: "secureresource", name: "web socket channel", attributes: { resource: "websocket", type: "api" }, sourceFile: WS, sourceSymbol: "WebSocketClient" },
          component("Orders", ORDERS, "Orders"),
          component("Panel", PANEL, "Panel"),
        ],
        rootPath,
      })
    );
    clearModelCache();
    const handler = createCodebaseExtractHandler(harness(wiredProject()).deps);
    const run = ok(await handler({ pageSize: 50, rootPath }));
    const rels = (await changesetOf(run.changeset.id)).changes.filter((c) => c.type === "relationship-add");
    const keys = rels.map((c) => c.elementId);
    const T = "testing.testcasesketch";
    // The helper has no element: its caller uses the element that owns the helper's file.
    expect(keys).toContain("application.applicationcomponent.panel::uses::application.applicationcomponent.orders");
    // The test exercises the class a security element cites: it tests the service that implements it.
    expect(keys).toContain(`${T}.ws-tests-test-connect::tests::application.applicationservice.web-socket-client`);
    expect(keys.some((k) => k.includes("security.secureresource"))).toBe(false);
    // No call reaches an element, but the test file is named after Orders.java: inferred, and marked.
    const inferred = rels.find((c) => c.elementId === `${T}.orders-test-test-empty-order::tests::application.applicationcomponent.orders`);
    expect(inferred?.origin).toEqual({ by: "tier0", rule: "edge:TEST_FILE_NAME" });
    // What is still unwired is reported by file.
    expect(run.testLinks).toMatchObject({ inferredFromFileName: 1, unwired: { cases: 1 } });
    expect(run.testLinks.unwired.files.items).toEqual([{ file: "src/test/misc/MiscTests.java", cases: 1 }]);

    // A test case someone wired by hand is left alone: no second, inferred link.
    clearModelCache();
    const again = ok(await handler({ changeset: run.changeset.name, rootPath }));
    expect(again.staged.relationships).toBe(0);
  }, SLOW);
});

describe("codebase_extract lists: nothing is shortened without its total and the call for the rest", () => {
  it("pages candidate deletes past the default, and the pages together are the whole list", async () => {
    ok(
      await modelAddHandler({
        elements: Array.from({ length: 130 }, (_, i) => ({
          layer: "application",
          type: "applicationcomponent",
          name: `Removed${i}`,
          attributes: { type: "internal" },
          sourceFile: `src/removed/Removed${i}.ts`,
          sourceSymbol: `Removed${i}`,
        })),
        rootPath,
      })
    );
    clearModelCache();
    const handler = createCodebaseExtractHandler(harness({ nodes: [fn("src/app/plan.ts", "buildPlan", 1)], edges: [] }).deps);
    const run = ok(await handler({ rootPath }));
    expect(run.candidateDeletes.total).toBe(130);
    expect(run.candidateDeletes.returned).toBeLessThan(130);
    expect(run.candidateDeletes.more).toContain('list: "candidateDeletes"');
    const ids: string[] = [];
    let offset = 0;
    for (;;) {
      const read = ok(await handler({ list: "candidateDeletes", limit: 50, offset, rootPath }));
      expect(read.total).toBe(130);
      ids.push(...read.items.map((d: any) => d.id));
      if (read.nextOffset === undefined) break;
      expect(read.more).toContain(`offset: ${read.nextOffset}`);
      offset = read.nextOffset;
    }
    expect(ids).toHaveLength(130);
    expect(new Set(ids).size).toBe(130);
  }, SLOW);
});
