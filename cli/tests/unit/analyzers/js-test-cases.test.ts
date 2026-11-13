/**
 * JavaScript and TypeScript test cases read from test files' text (src/analyzers/cards/js-tests.ts
 * and test-cases.ts): the parser, the cards, the attribution of the file's calls to its cases, and
 * the `tests` relationships the plan makes from them.
 */
import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { loadTypeScript, parseJsTestCalls } from "@/analyzers/cards/js-tests";
import { TEST_CASE_RULE, TEST_SUITE_RULE, collectJsTestCases, isJsTestFile, quotesUrl } from "@/analyzers/cards/test-cases";
import { classifyTier0 } from "@/analyzers/cards/classify";
import { collectExtraction, extractionConfigFrom, type ExtractionGraph } from "@/analyzers/cards/extract";
import type { CardGraph } from "@/analyzers/cards/types";
import { MAX_ID_SLUG, extractedElementId, needsAttributesCard, planElements, planRelationships } from "@/analyzers/extraction-plan";
import { tier0RulesFrom } from "@/analyzers/tier0-rules";
import type { AnalyzerHeuristic } from "@/analyzers/types";
import { getValidRelationships } from "@/generated/relationship-index";

const FIXTURE = readFileSync(resolve(import.meta.dir, "../../fixtures/js-test-cases/panel.test.tsx.txt"), "utf-8");
const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/dist/analyzers/cbm.json"), "utf-8"));
const CONFIG = extractionConfigFrom(
  tier0RulesFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]),
  Object.values(CBM.edges_by_type),
  Object.values(CBM.nodes_by_label)
);

const P = "proj";
const TEST_FILE = "src/ui/panel.test.tsx";
const MODULE = `${P}.src.ui.panel.test`;
const LOADER = `${P}.src.core.loader`;

describe("parseJsTestCalls", () => {
  it("reads suites and cases with their titles, nesting, modifiers and lines", async () => {
    const ts = await loadTypeScript();
    const calls = parseJsTestCalls(ts, TEST_FILE, FIXTURE);
    expect(calls.map((c) => [c.kind, [...c.suites, c.title].join(" > "), c.startLine, c.endLine])).toEqual([
      ["suite", "ModelLoader", 18, 46],
      ["case", "ModelLoader > loads every layer", 25, 28],
      ["case", 'ModelLoader > skips the ${"slow"} path', 30, 32],
      ["suite", "ModelLoader > when the cache is warm", 34, 45],
      ["case", "ModelLoader > when the cache is warm > reuses the cache", 35, 37],
      ["case", "ModelLoader > when the cache is warm > maps %s to %d", 39, 44],
      ["suite", "table %i", 48, 55],
      ["case", "table %i > adds $a and $b", 49, 54],
      ["case", "renders the panel", 57, 60],
      ["case", "NAME", 63, 63],
      ["case", "loads every layer", 65, 67],
      ["suite", "Playwright suite", 72, 76],
      ["case", "Playwright suite > logs in", 73, 75],
    ]);
  });

  it("records the callee, parameterized and skipped calls, and the names each callback calls", async () => {
    const ts = await loadTypeScript();
    const byTitle = new Map(parseJsTestCalls(ts, TEST_FILE, FIXTURE).map((c) => [c.title, c]));
    expect(byTitle.get('skips the ${"slow"} path')).toMatchObject({ callee: "it.skip", skipped: true, calls: ["loader.reload"] });
    expect(byTitle.get("reuses the cache")).toMatchObject({ callee: "test.only", skipped: false });
    expect(byTitle.get("maps %s to %d")).toMatchObject({ callee: "it.each", parameterized: true });
    expect(byTitle.get("table %i")).toMatchObject({ kind: "suite", callee: "describe.each", parameterized: true });
    expect(byTitle.get("adds $a and $b")).toMatchObject({ callee: "test.each", parameterized: true });
    expect(byTitle.get("Playwright suite")).toMatchObject({ kind: "suite", callee: "test.describe" });
    // The top-level case of that title (the nested one calls loader.load()).
    expect(byTitle.get("loads every layer")!.calls.sort()).toEqual(["expect", "loadLayers", "toBeTruthy"]);
    // An options object before the callback; a JSX component counts as a call.
    expect(byTitle.get("renders the panel")!.calls).toContain("renderPanel");
    expect(byTitle.get("NAME")!.calls).toContain("test2");
  });

  it("leaves out hooks, to-dos, calls without a callback and helpers that aren't test functions", async () => {
    const ts = await loadTypeScript();
    const titles = parseJsTestCalls(ts, TEST_FILE, FIXTURE).map((c) => c.title);
    expect(titles).not.toContain("handles a corrupt manifest");
    expect(titles).not.toContain("no callback");
    expect(parseJsTestCalls(ts, "a.test.ts", "beforeAll(() => setup());\nafterEach(() => {});\nfunction testThing() { test2(1); }\n")).toEqual([]);
  });

  it("reads JSX components rendered in a case, and JavaScript files", async () => {
    const ts = await loadTypeScript();
    const [jsx] = parseJsTestCalls(ts, "x.test.jsx", 'it("renders", () => { render(<Toolbar mode="x" />); });\n');
    expect(jsx.calls.sort()).toEqual(["Toolbar", "render"]);
    const [js] = parseJsTestCalls(ts, "x.spec.js", "describe('api', function () { it('works', function () { client.get('/x'); }); });\n");
    expect(js.kind).toBe("suite");
  });

  it("spells calls as CBM spells callees: bare names, receiver.name, and the name on any other receiver", async () => {
    const ts = await loadTypeScript();
    const [c] = parseJsTestCalls(
      ts,
      "x.test.ts",
      'it("x", async () => { writeFile(p); await fs.writeFile(p); this.loader.load(); new Model(); new ns.Store(); expect(a).toBe(b); });\n'
    );
    expect(c.calls.sort()).toEqual(["Model", "expect", "fs.writeFile", "loader.load", "ns.Store", "toBe", "writeFile"]);
  });

  it("review: takes a referenced callback only after a written title, not Playwright's test.skip(condition, reason)", async () => {
    const ts = await loadTypeScript();
    const calls = parseJsTestCalls(ts, "x.spec.ts", 'test.skip(isMobile, reason);\ntest("named", runIt);\ntest(TITLE, runIt);\n');
    expect(calls.map((c) => c.title)).toEqual(["named"]);
  });

  it("recovers from a syntax error and still reads the calls before it", async () => {
    const ts = await loadTypeScript();
    const calls = parseJsTestCalls(ts, "x.test.ts", 'it("first", () => { run(); });\nit("broken", () => { if ( });\n');
    expect(calls[0]).toMatchObject({ title: "first", calls: ["run"] });
  });
});

describe("quotesUrl", () => {
  it("matches CBM's {} parameters against a template substitution or a literal segment", () => {
    const route = "/api/changesets/{}/commit";
    expect(quotesUrl("await post(`/api/changesets/${changeset.id}/commit`)", route)).toBe(true);
    expect(quotesUrl('post("/api/changesets/cs-1/commit")', route)).toBe(true);
    expect(quotesUrl('post("/api/changesets/cs-1/discard")', route)).toBe(false);
    expect(quotesUrl('get("/aXb")', "/a.b")).toBe(false);
  });

  it("review: matches the whole path of a literal, not a prefix of a longer one, and / only itself", () => {
    expect(quotesUrl('await client.get("/api/models/abc/elements")', "/api/models")).toBe(false);
    expect(quotesUrl('await client.get("/api/models/abc/elements")', "/api/models/{id}")).toBe(false);
    expect(quotesUrl('await client.get("/api/models")', "/api/models")).toBe(true);
    expect(quotesUrl('await client.get("/api/models?page=2")', "/api/models")).toBe(true);
    expect(quotesUrl('await client.get("/api/models#top")', "/api/models")).toBe(true);
    // A host or a base substitution before the path.
    expect(quotesUrl('await fetch("http://localhost:3000/api/models")', "/api/models")).toBe(true);
    expect(quotesUrl("await fetch(`${baseUrl}/api/models/${id}`)", "/api/models/{id}")).toBe(true);
    // Not inside a longer string or a path that only starts the same.
    expect(quotesUrl('const note = "see /api/models for more"', "/api/models")).toBe(false);
    expect(quotesUrl('await client.get("/api/modelsX")', "/api/models")).toBe(false);
    // The root route matches only a literal "/", in a call whose method the code says.
    expect(quotesUrl('await client.get("/api/models"); await page.goto("/settings")', "/")).toBe(false);
    expect(quotesUrl('await client.get("/")', "/")).toBe(true);
    expect(quotesUrl('await fetch("/")', "/")).toBe(true);
    expect(quotesUrl('await page.goto("/")', "/")).toBe(false);
    expect(quotesUrl('const parts = file.split("/")', "/")).toBe(false);
  });

  it("review: compares the method when the code says it", () => {
    expect(quotesUrl('await client.post("/api/models", body)', "/api/models", "POST")).toBe(true);
    expect(quotesUrl('await client.get("/api/models")', "/api/models", "POST")).toBe(false);
    expect(quotesUrl('await fetch("/api/models")', "/api/models", "POST")).toBe(false);
    expect(quotesUrl('await fetch("/api/models", { method: "POST", body })', "/api/models", "POST")).toBe(true);
    // A URL the code doesn't call with a known method matches any.
    expect(quotesUrl('await page.goto("/api/models")', "/api/models", "DELETE")).toBe(true);
  });

  it("review: reads fetch's method past nested options, and leaves an unreadable one unknown", () => {
    // Nested objects before the method.
    const nested = 'await fetch("/api/models", { headers: { "Content-Type": "application/json" }, method: "POST", body })';
    expect(quotesUrl(nested, "/api/models", "POST")).toBe(true);
    expect(quotesUrl(nested, "/api/models", "GET")).toBe(false);
    // Options the code doesn't spell out: the method is unknown, so it is not compared.
    expect(quotesUrl('await fetch("/api/models", init)', "/api/models", "POST")).toBe(true);
    expect(quotesUrl('await fetch("/api/models", { ...init })', "/api/models", "POST")).toBe(true);
    // fetch(url) alone is a GET.
    expect(quotesUrl('await fetch( "/api/models" )', "/api/models", "POST")).toBe(false);
    expect(quotesUrl('await fetch( "/api/models" )', "/api/models", "GET")).toBe(true);
    // A later call's method isn't read as this one's.
    expect(quotesUrl('await fetch("/api/models", { headers }); await fetch("/x", { method: "POST" })', "/api/models", "DELETE")).toBe(true);
  });
});

describe("isJsTestFile", () => {
  it("takes CBM's is_test or the test-path pattern, for JS and TS files outside vendored paths", () => {
    expect(isJsTestFile("src/a.ts", "true")).toBe(true);
    expect(isJsTestFile("tests/unit/a.test.ts", "")).toBe(true);
    expect(isJsTestFile("src/a.ts", "")).toBe(false);
    expect(isJsTestFile("tests/test_a.py", "true")).toBe(false);
    expect(isJsTestFile("node_modules/x/a.test.js", "true")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cards and attribution, over a fake graph
// ---------------------------------------------------------------------------

type Row = unknown[];

interface FakeCall {
  from: string;
  fromLabel?: string;
  to: string;
  toLabel?: string;
  toName: string;
  toFile: string;
  callee: string | null;
  line: number | null;
  strategy?: string;
}

/** The graph CBM gives for the fixture: the test module's calls, a helper's call, HTTP calls and imports. */
function fixtureGraph(extra: { calls?: FakeCall[]; http?: Array<{ to: string; url: string | null; line: number | null }> } = {}): {
  graph: CardGraph;
  queries: string[];
} {
  const calls: FakeCall[] = [
    ...(extra.calls ?? []),
    { from: MODULE, to: `${LOADER}.ModelLoader.load`, toName: "load", toFile: "src/core/loader.ts", callee: "loader.load", line: 26, strategy: "unique_name" },
    { from: MODULE, to: `${LOADER}.ModelLoader.reload`, toName: "reload", toFile: "src/core/loader.ts", callee: "loader.reload", line: 31, strategy: "unique_name" },
    { from: MODULE, to: `${LOADER}.ModelLoader.cached`, toName: "cached", toFile: "src/core/loader.ts", callee: "loader.cached", line: 36, strategy: "unique_name" },
    // No callee name: placed by its line only.
    { from: MODULE, to: `${LOADER}.ModelLoader.isWarm`, toName: "isWarm", toFile: "src/core/loader.ts", callee: null, line: 36, strategy: "unique_name" },
    // First called at module scope, then by a case: CBM keeps the first line.
    { from: MODULE, to: `${LOADER}.loadLayers`, toName: "loadLayers", toFile: "src/core/loader.ts", callee: "loadLayers", line: 8, strategy: "import_map" },
    // Only in beforeEach: no case makes it.
    { from: MODULE, to: `${LOADER}.ModelLoader`, toLabel: "Class", toName: "ModelLoader", toFile: "src/core/loader.ts", callee: "ModelLoader", line: 22, strategy: "import_map" },
    // A helper in the test file, and its own call.
    { from: MODULE, to: `${MODULE}.renderPanel`, toName: "renderPanel", toFile: TEST_FILE, callee: "renderPanel", line: 58, strategy: "same_module" },
    { from: `${MODULE}.renderPanel`, fromLabel: "Function", to: `${P}.src.ui.Panel.Panel`, toName: "Panel", toFile: "src/ui/Panel.tsx", callee: "Panel", line: 11, strategy: "import_map" },
    { from: MODULE, to: `${MODULE}.test2`, toName: "test2", toFile: TEST_FILE, callee: "test2", line: 63, strategy: "same_module" },
    // Bound by a bare name into a file the test doesn't import.
    { from: MODULE, to: `${P}.src.audit.thing.index`, toName: "index", toFile: "src/audit/thing.ts", callee: "index", line: 42, strategy: "unique_name" },
    // Qualified: only a case calling `Model.load()` makes it, not one calling `loader.load()`.
    { from: MODULE, to: `${LOADER}.Model.load`, toName: "load", toFile: "src/core/loader.ts", callee: "Model.load", line: 99, strategy: "import_map_suffix" },
    // Bound to a symbol of another name: `path.join` to a function `path`.
    { from: MODULE, to: `${LOADER}.path`, toName: "path", toFile: "src/core/loader.ts", callee: "join", line: 27, strategy: "import_map" },
    // Test support outside a test file.
    { from: MODULE, to: `${P}.src.ui.testing.fakeLoader`, toName: "fakeLoader", toFile: "src/ui/testing.ts", callee: "fakeLoader", line: 26, strategy: "import_map" },
    // The runner's `it`, bound to a TOML key; and a test helper module.
    { from: MODULE, to: `${P}.bunfig.test`, toName: "test", toFile: "bunfig.toml", callee: "it", line: 25, strategy: "import_map" },
    { from: MODULE, to: `${P}.tests.helpers.h.goto`, toName: "goto", toFile: "tests/helpers/h.ts", callee: "goto", line: 74, strategy: "import_map" },
  ];
  const http = [
    ...(extra.http ?? []),
    { to: "__route__GET__/login", url: "/login", line: null },
    { to: "__route__POST__/sync", url: null, line: null },
  ];
  const queries: string[] = [];
  const graph: CardGraph = {
    project: P,
    async search() {
      return [];
    },
    async rows(cypher): Promise<Row[]> {
      queries.push(cypher);
      if (cypher.startsWith("MATCH (m:Module) RETURN m.file_path, m.qualified_name, m.is_test")) {
        return [
          [TEST_FILE, MODULE, "true"],
          ["src/core/loader.ts", LOADER, ""],
          ["tests/helpers/h.ts", `${P}.tests.helpers.h`, "true"],
          ["src/missing.test.ts", `${P}.src.missing.test`, "true"],
        ];
      }
      if (cypher.startsWith("MATCH (a)-[r:CALLS]->(b) WHERE a.file_path IN")) {
        return calls.map((c) => [c.from, c.fromLabel ?? "Module", TEST_FILE, c.to, c.toLabel ?? "Function", c.toName, c.toFile, c.callee, c.line, c.strategy ?? null]);
      }
      if (cypher.startsWith("MATCH (a)-[r:HTTP_CALLS]->(b) WHERE a.file_path IN")) {
        return http.map((h) => [MODULE, "Module", TEST_FILE, h.to, "Route", h.to, "", h.url, h.line]);
      }
      if (cypher.startsWith("MATCH (a)-[r:IMPORTS]->(b) WHERE a.file_path IN")) {
        return [
          [TEST_FILE, "src/ui/Panel.tsx"],
          [TEST_FILE, "src/core/loader.ts"],
        ];
      }
      return [];
    },
    async snippet() {
      return null;
    },
  };
  return { graph, queries };
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dr-js-tests-"));
  mkdirSync(join(root, "src/ui"), { recursive: true });
  writeFileSync(join(root, TEST_FILE), FIXTURE);
  return root;
}

const EDGE_TYPES = new Set(["CALLS", "HTTP_CALLS"]);

describe("collectJsTestCases", () => {
  it("makes a decided card per case and a rejected card per suite, named by the title path", async () => {
    const { graph } = fixtureGraph();
    const tc = await collectJsTestCases(graph, (qn) => `id:${qn}`, { sourceRoot: fixtureRoot(), edgeTypes: EDGE_TYPES });
    const cases = tc.symbols.filter((s) => s.card.label === "TestCase");
    const suites = tc.symbols.filter((s) => s.card.label === "TestSuite");
    expect(cases).toHaveLength(9);
    expect(suites).toHaveLength(4);
    expect(cases.every((s) => s.tier0?.kind === "decide" && s.tier0.layer === "testing" && s.tier0.type === "testcasesketch" && s.tier0.rule === TEST_CASE_RULE)).toBe(true);
    expect(suites.every((s) => s.tier0?.kind === "reject" && s.tier0.rule === TEST_SUITE_RULE)).toBe(true);
    const first = cases[0];
    expect(first.qualifiedName).toBe(`${MODULE}::ModelLoader > loads every layer`);
    expect(first.card).toMatchObject({
      id: `id:${MODULE}::ModelLoader > loads every layer`,
      name: "ModelLoader > loads every layer",
      qualified_name: "src.ui.panel.test::ModelLoader > loads every layer",
      file_path: TEST_FILE,
      start_line: 25,
      end_line: 28,
      signature: "it",
    });
    expect(first.card.source).toContain("loader.load()");
    // A file it couldn't read (missing on disk) is skipped.
    expect(tc.filesRead).toEqual([TEST_FILE]);
    expect(tc.fileSymbols[TEST_FILE]).toContain("Playwright suite > logs in");
  });

  it("gives a repeated title in a file a numbered name", async () => {
    const { graph } = fixtureGraph();
    const root = fixtureRoot();
    writeFileSync(join(root, TEST_FILE), 'it("works", () => {});\nit("works", () => {});\n');
    const tc = await collectJsTestCases(graph, (qn) => qn, { sourceRoot: root, edgeTypes: EDGE_TYPES });
    expect(tc.symbols.map((s) => s.card.name)).toEqual(["works", "works #2"]);
  });

  it("attributes each call to the cases that make it, through helpers, and keeps only production calls the file imports", async () => {
    const { graph } = fixtureGraph();
    const tc = await collectJsTestCases(graph, (qn) => qn, { sourceRoot: fixtureRoot(), edgeTypes: EDGE_TYPES });
    const callsOf = (name: string) =>
      tc.edges
        .filter((e) => e.from.name === name)
        .map((e) => `${e.type} ${e.to.name}`)
        .sort();
    // POST /sync has no line and no case quotes its URL: in a file of several cases it goes to none.
    expect(callsOf("ModelLoader > loads every layer")).toEqual(["CALLS load"]);
    expect(callsOf('ModelLoader > skips the ${"slow"} path')).toEqual(["CALLS reload"]);
    // By name (cached) and by line only (isWarm, which CBM gives no callee for).
    expect(callsOf("ModelLoader > when the cache is warm > reuses the cache")).toEqual(["CALLS cached", "CALLS isWarm"]);
    // `index` was bound by name into a file the test doesn't import: dropped.
    expect(callsOf("ModelLoader > when the cache is warm > maps %s to %d")).toEqual([]);
    // Through the helper renderPanel to the component it renders.
    expect(callsOf("renders the panel")).toEqual(["CALLS Panel"]);
    // CBM's line for loadLayers is the module-scope call; the case is found by the name it calls.
    expect(callsOf("loads every layer")).toEqual(["CALLS loadLayers"]);
    // A route by the URL the case's text quotes; the test helper module's goto is not production code.
    expect(callsOf("Playwright suite > logs in")).toEqual(["HTTP_CALLS __route__GET__/login"]);
    expect(tc.edges.some((e) => e.to.name === "__route__POST__/sync")).toBe(false);
    // No edge ever reaches the TOML key, a test file or a suite.
    expect(tc.edges.some((e) => ["bunfig.toml", "tests/helpers/h.ts", "src/ui/testing.ts", TEST_FILE].includes(e.to.file ?? ""))).toBe(false);
    expect(tc.edges.some((e) => e.to.name === "path" || e.to.qualifiedName === `${LOADER}.Model.load`)).toBe(false);
    expect(tc.edges.some((e) => tc.symbols.find((s) => s.qualifiedName === e.from.qualifiedName)?.card.label === "TestSuite")).toBe(false);
    expect(tc.stats).toEqual({
      files: 1,
      filesWithTests: 1,
      cases: 9,
      suites: 4,
      casesWithCalls: 6,
      calls: 12,
      byName: 6,
      byLine: 1,
      byFile: 0,
      outsideCases: 3,
      notImported: 1,
      misbound: 1,
      edges: 7,
    });
    const card = tc.symbols.find((s) => s.card.name === "renders the panel")!.card;
    expect(card.callees).toContain("src.ui.Panel.Panel");
  });

  it("review: a call goes to the cases that name it and to the case its line is in", async () => {
    // Named by "ModelLoader > loads every layer" (loader.load), first called on line 31, in the
    // case that skips the slow path.
    const { graph } = fixtureGraph({
      calls: [{ from: MODULE, to: `${LOADER}.Cache.load`, toName: "load", toFile: "src/core/loader.ts", callee: "loader.load", line: 31, strategy: "unique_name" }],
    });
    const tc = await collectJsTestCases(graph, (qn) => qn, { sourceRoot: fixtureRoot(), edgeTypes: EDGE_TYPES });
    const casesCalling = tc.edges.filter((e) => e.to.qualifiedName === `${LOADER}.Cache.load`).map((e) => e.from.name).sort();
    expect(casesCalling).toEqual(["ModelLoader > loads every layer", 'ModelLoader > skips the ${"slow"} path']);
  });

  it("review: an HTTP call no case quotes, with no line, goes to the case only in a file of one case; a plain one to every case", async () => {
    const http = [
      { to: "__route__GET__/api/models", url: "/api/models", line: null },
      { to: "__route__POST__/sync", url: null, line: null },
    ];
    const calls: FakeCall[] = [{ from: MODULE, to: `${LOADER}.warmUp`, toName: "warmUp", toFile: "src/core/loader.ts", callee: "warmUp", line: null, strategy: "import_map" }];
    const root = fixtureRoot();
    // A longer path that starts with the route's is not a call of it.
    writeFileSync(join(root, TEST_FILE), 'it("lists elements", async () => { await client.get("/api/models/abc/elements"); });\n');
    const one = await collectJsTestCases(fixtureGraph({ http, calls }).graph, (qn) => qn, { sourceRoot: root, edgeTypes: EDGE_TYPES });
    expect(one.edges.map((e) => e.to.name).sort()).toEqual(["__route__GET__/api/models", "__route__GET__/login", "__route__POST__/sync", "warmUp"]);
    expect(one.stats.byFile).toBe(4);

    writeFileSync(
      join(root, TEST_FILE),
      'it("lists elements", async () => { await client.get("/api/models/abc/elements"); });\nit("lists models", async () => { await client.get("/api/models"); });\n'
    );
    const two = await collectJsTestCases(fixtureGraph({ http, calls }).graph, (qn) => qn, { sourceRoot: root, edgeTypes: EDGE_TYPES });
    const edges = two.edges.map((e) => `${e.from.name} -> ${e.to.name}`).sort();
    expect(edges).toEqual(["lists elements -> warmUp", "lists models -> __route__GET__/api/models", "lists models -> warmUp"]);
    expect(two.stats).toMatchObject({ byName: 1, byFile: 1 });
    // GET /login and POST /sync: counted as made by no case.
    expect(two.stats.outsideCases).toBe(one.stats.outsideCases + 2);
  });

  it("reads only the test files in scope, and makes no edge of a type the mapping doesn't map", async () => {
    const { graph, queries } = fixtureGraph();
    const none = await collectJsTestCases(graph, (qn) => qn, { sourceRoot: fixtureRoot(), files: new Set(["src/core/loader.ts"]), edgeTypes: EDGE_TYPES });
    expect(none.symbols).toEqual([]);
    const callsOnly = await collectJsTestCases(graph, (qn) => qn, { sourceRoot: fixtureRoot(), edgeTypes: new Set(["CALLS"]) });
    expect(callsOnly.edges.every((e) => e.type === "CALLS")).toBe(true);
    expect(queries.some((q) => q.includes("HTTP_CALLS"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Through extraction and the plan
// ---------------------------------------------------------------------------

function hasTriple(id: string): boolean {
  const p = id.split(".");
  return p.length === 5 && getValidRelationships(`${p[0]}.${p[1]}`, p[2], `${p[3]}.${p[4]}`).length > 0;
}

const EMPTY_MODEL = { elements: new Map(), getRelationship: () => undefined } as any;

describe("test cases through extraction and the plan", () => {
  it("stages each case as an automated test case sketch with its source, and counts the cards", async () => {
    const { graph } = fixtureGraph();
    const root = fixtureRoot();
    const extraction = await collectExtraction(graph, CONFIG, "cbm", { sourceRoot: root });
    expect(extraction.summary).toMatchObject({ cards: 13, decided: 9, rejected: 4 });
    expect(extraction.testCases).toMatchObject({ cases: 9, suites: 4 });
    expect(extraction.testFiles).toEqual([TEST_FILE]);
    const plan = planElements(extraction, EMPTY_MODEL, { fileExists: () => true });
    const add = plan.adds.find((a) => a.name === "ModelLoader > when the cache is warm > reuses the cache")!;
    expect(add).toMatchObject({
      id: "testing.testcasesketch.model-loader-when-the-cache-is-warm-reuses-the-cache",
      layer: "testing",
      type: "testcasesketch",
      attributes: { status: "automated" },
      sourceReference: { provenance: "extracted", locations: [{ file: TEST_FILE, symbol: "ModelLoader > when the cache is warm > reuses the cache" }] },
      rule: TEST_CASE_RULE,
    });
    expect(plan.adds.filter((a) => a.layer === "testing")).toHaveLength(9);
    expect(plan.rejected).toBe(4);
  });

  it("classify --tier0-only counts the same test cards as extraction", async () => {
    const { graph } = fixtureGraph();
    const root = fixtureRoot();
    const report = await classifyTier0(graph, CONFIG.rules, "cbm", { sourceRoot: root });
    const extraction = await collectExtraction(graph, CONFIG, "cbm", { sourceRoot: root });
    expect(report.summary).toMatchObject({ cards: extraction.summary.cards, decided: extraction.summary.decided, rejected: extraction.summary.rejected });
    expect(report.summary).toMatchObject({ cards: 13, decided: 9, rejected: 4, by_rule: { [TEST_CASE_RULE]: 9, [TEST_SUITE_RULE]: 4 }, by_target: { "testing.testcasesketch": 9 } });
    const loads = report.results.find((r) => r.name === "ModelLoader > loads every layer")!;
    expect(loads).toMatchObject({ label: "TestCase", file_path: TEST_FILE, start_line: 25, tier0: { kind: "decide", rule: TEST_CASE_RULE } });
  });

  it("classify filters test cards by label, file pattern, exclusion and limit, and needs the source root", async () => {
    const { graph } = fixtureGraph();
    const root = fixtureRoot();
    const only = await classifyTier0(graph, CONFIG.rules, "cbm", { sourceRoot: root, labels: ["TestCase"] });
    expect(only.summary).toMatchObject({ cards: 9, decided: 9, rejected: 0 });
    expect((await classifyTier0(graph, CONFIG.rules, "cbm", { sourceRoot: root, labels: ["Class"] })).summary.cards).toBe(0);
    expect((await classifyTier0(graph, CONFIG.rules, "cbm", { sourceRoot: root, filePattern: "src/ui/**" })).summary.cards).toBe(13);
    expect((await classifyTier0(graph, CONFIG.rules, "cbm", { sourceRoot: root, filePattern: "src/core/**" })).summary.cards).toBe(0);
    expect((await classifyTier0(graph, CONFIG.rules, "cbm", { sourceRoot: root, exclude: /\.test\.tsx$/ })).summary.cards).toBe(0);
    expect((await classifyTier0(graph, CONFIG.rules, "cbm", { sourceRoot: root, limit: 5 })).summary.cards).toBe(5);
    const progress: Array<[number, number]> = [];
    await classifyTier0(graph, CONFIG.rules, "cbm", { sourceRoot: root, onProgress: (d, t) => progress.push([d, t]) });
    expect(progress.every(([, t]) => t === 13)).toBe(true);
    expect((await classifyTier0(graph, CONFIG.rules, "cbm")).summary.cards).toBe(0);
  });

  it("links a case to what it calls with tests, a class's member only when the test file refers to the class", async () => {
    const { graph } = fixtureGraph();
    const tc = await collectJsTestCases(graph, (qn) => qn, { sourceRoot: fixtureRoot(), edgeTypes: EDGE_TYPES });
    const extraction = (refersToClass: boolean): ExtractionGraph => ({
      analyzer: "cbm",
      project: P,
      config: CONFIG,
      symbols: tc.symbols,
      edges: [
        ...tc.edges,
        // The module's own `new ModelLoader(...)`: the file refers to the class.
        ...(refersToClass
          ? [{ type: "CALLS", from: { qualifiedName: MODULE, name: TEST_FILE, file: TEST_FILE }, to: { qualifiedName: `${LOADER}.ModelLoader`, name: "ModelLoader", file: "src/core/loader.ts" } }]
          : []),
      ],
      fileSymbols: {},
      routes: [],
      summary: { cards: 0, decided: 0, rejected: 0, narrowed: 0, undecided: 0, no_source: 0 },
    });
    const elementOf = new Map<string, string>();
    const elements = new Map<string, { layer: string; type: string }>();
    for (const s of tc.symbols) {
      if (s.card.label !== "TestCase") continue;
      const id = `testing.testcasesketch.case-${elementOf.size}`;
      elementOf.set(s.qualifiedName, id);
      elements.set(id, { layer: "testing", type: "testcasesketch" });
    }
    elementOf.set(`${LOADER}.ModelLoader`, "application.applicationcomponent.model-loader");
    elements.set("application.applicationcomponent.model-loader", { layer: "application", type: "applicationcomponent" });
    elementOf.set(`${LOADER}.loadLayers`, "application.applicationfunction.load-layers");
    elements.set("application.applicationfunction.load-layers", { layer: "application", type: "applicationfunction" });

    const loads = elementOf.get(`${MODULE}::ModelLoader > loads every layer`)!;
    const topLoads = elementOf.get(`${MODULE}::loads every layer`)!;
    const withClass = planRelationships(extraction(true), EMPTY_MODEL, elementOf, elements, hasTriple).relationships;
    expect(withClass).toContainEqual(
      expect.objectContaining({ source: loads, predicate: "tests", target: "application.applicationcomponent.model-loader", edge: "CALLS" })
    );
    expect(withClass).toContainEqual(
      expect.objectContaining({ source: topLoads, predicate: "tests", target: "application.applicationfunction.load-layers", edge: "CALLS" })
    );
    expect(withClass.every((r) => r.predicate === "tests" && r.sourceLayer === "testing")).toBe(true);

    // Without a reference to the class, a call to one of its members is a name match, not a test of it.
    const withoutClass = planRelationships(extraction(false), EMPTY_MODEL, elementOf, elements, hasTriple).relationships;
    expect(withoutClass.some((r) => r.target === "application.applicationcomponent.model-loader")).toBe(false);
    expect(withoutClass.some((r) => r.target === "application.applicationfunction.load-layers")).toBe(true);
  });

  it("lists a modelled test case whose title the file no longer has as a candidate delete", async () => {
    const { graph } = fixtureGraph();
    const extraction = await collectExtraction(graph, CONFIG, "cbm", { sourceRoot: fixtureRoot(), checkFiles: [TEST_FILE] });
    const element = (id: string, symbol: string, provenance = "extracted") => ({
      id,
      layer: "testing",
      type: "testcasesketch",
      name: symbol,
      status: "active",
      attributes: {},
      sourceReference: { provenance, locations: [{ file: TEST_FILE, symbol }] },
    });
    const existing = {
      elements: new Map([
        ["testing.testcasesketch.gone", element("testing.testcasesketch.gone", "ModelLoader > loads a layer that was renamed")],
        ["testing.testcasesketch.kept", element("testing.testcasesketch.kept", "renders the panel")],
        // Written by hand: its symbol may be prose that names no title, so it isn't judged by titles.
        ["testing.testcasesketch.by-hand", element("testing.testcasesketch.by-hand", "the panel's loading states", "manual")],
      ]),
      getRelationship: () => undefined,
    } as any;
    const plan = planElements(extraction, existing, { fileExists: () => true, fileText: () => FIXTURE });
    expect(plan.candidateDeletes.map((d) => [d.id, d.evidence])).toEqual([["testing.testcasesketch.gone", "symbol-missing"]]);
  });

  it("review: caps a long test title's id with a stable hash, and keeps the full title as name and symbol", async () => {
    const root = fixtureRoot();
    const long = (end: string) =>
      `exports the whole model with every layer, relationship and annotation intact when the user asks for a full backup ${end}`;
    writeFileSync(join(root, TEST_FILE), `describe("export", () => {\n  it("${long("first")}", () => {});\n  it("${long("second")}", () => {});\n});\n`);
    const { graph } = fixtureGraph();
    const extraction = await collectExtraction(graph, CONFIG, "cbm", { sourceRoot: root });
    const adds = planElements(extraction, EMPTY_MODEL, { fileExists: () => true }).adds.filter((a) => a.layer === "testing");
    expect(adds).toHaveLength(2);
    for (const [i, end] of ["first", "second"].entries()) {
      const a = adds[i];
      expect(a.name).toBe(`export > ${long(end)}`);
      expect(a.sourceReference?.locations[0].symbol).toBe(`export > ${long(end)}`);
      const slug = a.id.slice("testing.testcasesketch.".length);
      expect(slug.length).toBeLessThanOrEqual(MAX_ID_SLUG + 9);
      expect(slug).toMatch(/^export-exports-the-whole-model[a-z0-9-]*-[0-9a-f]{8}$/);
      // Stable: the same title gives the same id.
      expect(extractedElementId("testing", "testcasesketch", a.name)).toBe(a.id);
    }
    // Titles that differ only past the cut get different ids.
    expect(adds[0].id).not.toBe(adds[1].id);
    // A short name is kept whole.
    expect(extractedElementId("testing", "testcasesketch", "renders the panel")).toBe("testing.testcasesketch.renders-the-panel");
  });

  it("keeps the line rule for a test case card under detect_changes seeds, which never name DR's own cards", () => {
    const testCase = (label: string, qn: string, lines: [number, number]) =>
      ({
        id: "testing.testcasesketch.x",
        layer: "testing",
        type: "testcasesketch",
        name: "x",
        attributes: {},
        rule: TEST_CASE_RULE,
        symbol: {
          qualifiedName: qn,
          card: { id: qn, label, name: "x", qualified_name: qn, file_path: TEST_FILE, start_line: lines[0], end_line: lines[1], signature: null, docstring: null },
          facts: { decorators: [], decorator_names: [], file_importers: 0, methods: 0, usage_files: 0 },
          tier0: null,
        },
      }) as any;
    const hunks = new Map([[TEST_FILE, [[12, 12]] as Array<[number, number]>]]);
    // Seeds from the analyzer name only its own nodes: neither case is among them.
    const seeds = { seeds: new Set(["proj.src.core.loader.ModelLoader.load"]) };
    const inHunk = needsAttributesCard(testCase("TestCase", "loader.test.ts > reuses the cache", [10, 14]), "proj", ["bad"], hunks, seeds);
    const outside = needsAttributesCard(testCase("TestSuite", "loader.test.ts > ModelLoader", [20, 30]), "proj", ["bad"], hunks, seeds);
    expect(inHunk.changedInRange).toBe(true);
    expect(outside.changedInRange).toBeUndefined();
    // A CBM symbol in the same place goes by the seeds.
    const method = needsAttributesCard(testCase("Method", "proj.src.other", [10, 14]), "proj", ["bad"], hunks, seeds);
    expect(method.changedInRange).toBeUndefined();
  });
});
