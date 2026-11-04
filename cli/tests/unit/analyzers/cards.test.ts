/**
 * Symbol cards (src/analyzers/cards): graph adapter, candidate filter, edge and facts indexes,
 * card building and project-wide Tier-0 classification, over an in-memory graph.
 */
import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  CardBuilder,
  SAMPLE_EXCLUDE,
  VENDOR_EXCLUDE,
  buildEdgeIndex,
  buildFactsIndex,
  cardId,
  cbmCardGraph,
  classifyTier0,
  decoratorName,
  defaultLabels,
  factsFor,
  graphNodeOf,
  isCandidate,
  type CardGraph,
  type GraphNode,
} from "@/analyzers/cards/index";
import { CbmToolError, type CbmTools } from "@/analyzers/cbm-responses";
import { tier0RulesFrom } from "@/analyzers/tier0-rules";
import type { AnalyzerHeuristic } from "@/analyzers/types";

const P = "proj";
const OWNER = `${P}.src.main.java.owner.OwnerController`;
const FILE = "src/main/java/owner/OwnerController.java";

/** A small Spring-style graph: a controller, its handler method, the route, an entity and a test. */
function fakeGraph(overrides: Partial<{ handles: boolean }> = {}): CardGraph & { snippets: string[] } {
  const handles = overrides.handles ?? true;
  const nodes: Record<string, GraphNode[]> = {
    Class: [
      { label: "Class", name: "OwnerController", qualified_name: OWNER, file_path: FILE, start_line: 10, end_line: 80 },
      { label: "Class", name: "Owner", qualified_name: `${P}.src.main.java.owner.Owner`, file_path: "src/main/java/owner/Owner.java", base_classes: "Person, Auditable" },
      { label: "Class", name: "OwnerTests", qualified_name: `${P}.src.test.java.owner.OwnerTests`, file_path: "src/test/java/owner/OwnerTests.java" },
      { label: "Class", name: "Bundled", qualified_name: `${P}.node_modules.x.Bundled`, file_path: "node_modules/x/Bundled.js" },
    ],
    Method: [
      { label: "Method", name: "showOwner", qualified_name: `${OWNER}.showOwner`, file_path: FILE, signature: "(int id)", parent_class: OWNER, lines: "40-52" },
      { label: "Method", name: "__init__", qualified_name: `${OWNER}.__init__`, file_path: FILE },
    ],
    Route: [
      { label: "Route", name: "__route__GET__/owners/{}", qualified_name: "__route__GET__/owners/{}", file_path: FILE, method: "GET" },
      { label: "Route", name: "__route__GET__/static.js", qualified_name: "__route__GET__/static.js", file_path: "" },
    ],
  };
  const source: Record<string, string> = {
    [OWNER]: '@Controller\nclass OwnerController {\n  private final OwnerRepository owners;\n}',
    [`${OWNER}.showOwner`]: '@GetMapping("/owners/{ownerId}")\npublic ModelAndView showOwner(int id) {\n  return mav;\n}',
    [`${P}.src.main.java.owner.Owner`]: "@Entity\n@Table(name = \"owners\")\npublic class Owner extends Person {",
    [`${P}.src.test.java.owner.OwnerTests`]: "class OwnerTests {",
  };
  const rows: Array<[RegExp, unknown[][]]> = [
    [/CALLS\]->/, [[`${OWNER}.showOwner`, `${P}.src.main.java.owner.OwnerRepository.findById`]]],
    [/IMPORTS\]->\(b\) RETURN a\.file_path, b\.qualified_name/, [[FILE, `${P}.src.main.java.owner.Owner`, "src/main/java/owner/Owner.java"]]],
    [/IMPORTS\]->\(b\) RETURN a\.file_path, b\.file_path/, [["src/main/java/other/A.java", FILE], ["src/main/java/other/B.java", FILE], [FILE, FILE]]],
    [/HANDLES\]->/, handles ? [[`${OWNER}.showOwner`, "__route__GET__/owners/{}"]] : []],
    [/-\[r\]->\(x:Route\)/, [[`${OWNER}.showOwner`, FILE, "__route__GET__/owners/{}"]]],
    [/MATCH \(a:Function\)/, []],
    [/decorators IS NOT NULL/, [
      [OWNER, '["@Controller"]'],
      [`${OWNER}.showOwner`, '["@GetMapping(\\"/owners/{ownerId}\\")"]'],
      [`${P}.src.main.java.owner.Owner`, ["@Entity", '@Table(name = "owners")']],
    ]],
    [/DEFINES_METHOD/, [[OWNER, `${OWNER}.showOwner`], [OWNER, `${OWNER}.__init__`]]],
    [/USAGE/, [["src/main/java/other/A.java", `${P}.src.main.java.owner.Owner`, "src/main/java/owner/Owner.java"]]],
  ];
  const snippets: string[] = [];
  return {
    project: P,
    snippets,
    async search(label, filePattern) {
      const all = nodes[label] ?? [];
      return filePattern ? all.filter((n) => n.file_path === filePattern) : all;
    },
    async rows(cypher) {
      return rows.find(([re]) => re.test(cypher))?.[1] ?? [];
    },
    async snippet(qn) {
      snippets.push(qn);
      return source[qn] ? { source: source[qn] } : null;
    },
  };
}

const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/dist/analyzers/cbm.json"), "utf-8"));
const RULES = tier0RulesFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]);

describe("graphNodeOf", () => {
  it("flattens properties and keeps a route's full qualified name as its name", () => {
    expect(graphNodeOf({ name: "/owners", qualified_name: "__route__GET__/owners", label: "Route", file_path: FILE, properties: { method: "GET", name: "/owners" } })).toEqual({
      method: "GET", label: "Route", name: "__route__GET__/owners", qualified_name: "__route__GET__/owners", file_path: FILE,
    });
    expect(graphNodeOf({ name: "show", qualified_name: `${OWNER}.show`, label: "Method", properties: { start_line: 4 } })).toEqual({
      start_line: 4, label: "Method", name: "show", qualified_name: `${OWNER}.show`, file_path: "",
    });
  });
});

describe("cbmCardGraph", () => {
  const tools = (call: (tool: string, args: Record<string, unknown>) => unknown) =>
    ({ call: async (t: string, a: Record<string, unknown>) => call(t, a), searchGraph: async () => [], queryGraph: async () => ({ columns: [], rows: [[1]] }) }) as unknown as CbmTools;

  it("returns null for a symbol CBM reports as an error, and rethrows anything else", async () => {
    const missing = cbmCardGraph(tools(() => { throw new CbmToolError("get_code_snippet", "function not found"); }), P);
    expect(await missing.snippet("x")).toBeNull();
    const broken = cbmCardGraph(tools(() => { throw new Error("pipe closed"); }), P);
    await expect(broken.snippet("x")).rejects.toThrow("pipe closed");
  });

  it("asks get_code_snippet for the full source of the project's symbol", async () => {
    let seen: Record<string, unknown> = {};
    const g = cbmCardGraph(tools((_t, a) => { seen = a; return { source: "class A {}" }; }), P);
    expect(await g.snippet("proj.A")).toEqual({ source: "class A {}" });
    expect(seen).toEqual({ project: P, qualified_name: "proj.A", source_mode: "full" });
  });
});

describe("isCandidate", () => {
  const n = (label: string, name: string, file_path: string): GraphNode => ({ label, name, qualified_name: name, file_path });
  it("keeps routes with a path and drops asset routes", () => {
    expect(isCandidate(n("Route", "__route__GET__/owners", ""), "Route")).toBe(true);
    expect(isCandidate(n("Route", "__route__GET__/app.js", ""), "Route")).toBe(false);
  });
  it("drops non-source files, vendored paths, constructors and anonymous functions", () => {
    expect(isCandidate(n("Class", "A", "README.md"), "Class")).toBe(false);
    expect(isCandidate(n("Class", "A", "node_modules/x/a.js"), "Class")).toBe(false);
    expect(isCandidate(n("Method", "constructor", "src/a.ts"), "Method")).toBe(false);
    expect(isCandidate(n("Function", "<anonymous>", "src/a.ts"), "Function")).toBe(false);
  });
  it("applies the exclusion to routes that have a file", () => {
    expect(isCandidate(n("Route", "__route__GET__/x", "node_modules/pkg/server.js"), "Route")).toBe(false);
    expect(isCandidate(n("Route", "__route__GET__/x", "src/server.js"), "Route")).toBe(true);
  });
  it("keeps tests by default; the harness's sampling exclusion drops them", () => {
    const t = n("Class", "OwnerTests", "src/test/java/OwnerTests.java");
    expect(isCandidate(t, "Class", VENDOR_EXCLUDE)).toBe(true);
    expect(isCandidate(t, "Class", SAMPLE_EXCLUDE)).toBe(false);
  });
});

describe("edge and facts indexes", () => {
  it("index callers, callees, imports and handlers by full qualified name", async () => {
    const idx = await buildEdgeIndex(fakeGraph());
    expect(idx.callees.get(`${OWNER}.showOwner`)).toEqual([`${P}.src.main.java.owner.OwnerRepository.findById`]);
    expect(idx.callers.get(`${P}.src.main.java.owner.OwnerRepository.findById`)).toEqual([`${OWNER}.showOwner`]);
    expect(idx.importsByFile.get(FILE)).toEqual(["src/main/java/owner/Owner.java"]);
    expect(idx.routeHandlers.get("__route__GET__/owners/{}")).toEqual([`${OWNER}.showOwner`]);
    expect(idx.qnFile.get(`${OWNER}.showOwner`)).toBe(FILE);
  });

  it("compute facts: decorator names from JSON strings or lists, importers other than the file itself", async () => {
    const idx = await buildFactsIndex(fakeGraph());
    expect(factsFor(idx, `${OWNER}.showOwner`, FILE)).toEqual({
      decorators: ['@GetMapping("/owners/{ownerId}")'], decorator_names: ["GetMapping"], file_importers: 2, methods: 0, usage_files: 0,
    });
    expect(factsFor(idx, OWNER, FILE).methods).toBe(2);
    expect(factsFor(idx, `${P}.src.main.java.owner.Owner`, null)).toMatchObject({ decorator_names: ["Entity", "Table"], file_importers: 0, usage_files: 1 });
  });

  it("decoratorName strips the @, arguments and comments", () => {
    expect(decoratorName('@router.get("/", response_model=X)  # list')).toBe("router.get");
    expect(decoratorName("@field_validator(\n  'x'\n)")).toBe("field_validator");
  });
});

describe("CardBuilder", () => {
  it("builds a method card with the project prefix stripped and an id on the full name", async () => {
    const g = fakeGraph();
    const card = await new CardBuilder(g, await buildEdgeIndex(g), { scope: "corpus" }).build((await g.search("Method", undefined, []))[0]);
    expect(card).toMatchObject({
      id: cardId("corpus", `${OWNER}.showOwner`),
      qualified_name: "src.main.java.owner.OwnerController.showOwner",
      parent_class: "src.main.java.owner.OwnerController",
      start_line: 40,
      end_line: 52,
      signature: "(int id)",
      callees: ["src.main.java.owner.OwnerRepository.findById"],
      routes_handled: ["__route__GET__/owners/{}"],
      imports: ["src/main/java/owner/Owner.java"],
      source_truncated: false,
    });
  });

  it("gives a route its handler's source and puts the handler first among its callers", async () => {
    const g = fakeGraph();
    const route = (await g.search("Route", undefined, []))[0];
    const card = await new CardBuilder(g, await buildEdgeIndex(g), { scope: "c" }).build(route);
    expect(card.source).toContain("@GetMapping");
    expect(card.callers[0]).toBe("src.main.java.owner.OwnerController.showOwner");
    expect(card.routes_handled).toEqual(["/owners/{}"]);
    expect(card.route_method).toBe("GET");
  });

  it("truncates long source and records the full length", async () => {
    const g = fakeGraph();
    const card = await new CardBuilder(g, await buildEdgeIndex(g), { scope: "c", sourceLines: 2 }).build((await g.search("Class", undefined, []))[0]);
    expect(card.source).toBe("@Controller\nclass OwnerController {");
    expect(card).toMatchObject({ source_lines_total: 4, source_truncated: true });
  });

  it("reads source from disk by line range when given a root, falling back to CBM's snippet", async () => {
    const root = mkdtempSync(join(tmpdir(), "cards-src-"));
    mkdirSync(join(root, "src/main/java/owner"), { recursive: true });
    writeFileSync(join(root, FILE), Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n"));
    const g = fakeGraph();
    const builder = new CardBuilder(g, await buildEdgeIndex(g), { scope: "c", sourceRoot: root });
    const method = await builder.build((await g.search("Method", undefined, []))[0]);
    expect(method.source).toBe(Array.from({ length: 13 }, (_, i) => `line ${i + 40}`).join("\n"));
    expect(g.snippets).not.toContain(`${OWNER}.showOwner`);
    // No file on disk for Owner.java: CBM's snippet is used.
    const owner = await builder.build((await g.search("Class", undefined, []))[1]);
    expect(owner.source).toContain("@Entity");
    expect(g.snippets).toContain(`${P}.src.main.java.owner.Owner`);
  });

  it("never reads outside the root", async () => {
    const root = mkdtempSync(join(tmpdir(), "cards-root-"));
    const g = fakeGraph();
    const builder = new CardBuilder(g, await buildEdgeIndex(g), { scope: "c", sourceRoot: root });
    const escaped: GraphNode = { label: "Class", name: "Owner", qualified_name: `${P}.src.main.java.owner.Owner`, file_path: "../../../../etc/hosts", start_line: 1, end_line: 2 };
    expect((await builder.build(escaped)).source).toContain("@Entity");
  });

  it("splits comma-separated base classes", async () => {
    const g = fakeGraph();
    const card = await new CardBuilder(g, await buildEdgeIndex(g), { scope: "c" }).build((await g.search("Class", undefined, []))[1]);
    expect(card.base_classes).toEqual(["Person", "Auditable"]);
  });
});

describe("classifyTier0", () => {
  it("applies the cbm rules to every candidate and summarises the outcomes", async () => {
    const report = await classifyTier0(fakeGraph(), RULES, "cbm");
    const by = Object.fromEntries(report.results.map((r) => [r.qualified_name, r.tier0 && (r.tier0.kind === "decide" ? `${r.tier0.layer}.${r.tier0.type}` : r.tier0.kind)]));
    expect(by).toEqual({
      "src.main.java.owner.OwnerController": "application.applicationinterface",
      "src.main.java.owner.Owner": "data-model.objectschema",
      "src.test.java.owner.OwnerTests": "narrow",
      "src.main.java.owner.OwnerController.showOwner": "application.applicationfunction",
      "__route__GET__/owners/{}": null,
    });
    expect(report.summary).toMatchObject({ cards: 5, decided: 3, rejected: 0, narrowed: 1, undecided: 1, no_source: 0 });
    expect(report.summary.by_target["application.applicationfunction"]).toBe(1);
    expect(report.summary.by_rule.tier0_route_handler).toBe(1);
    expect(report).toMatchObject({ analyzer: "cbm", project: P, mode: "tier0", rules: RULES.length });
    expect(report.results[0].card).toBeUndefined();
  });

  it("filters by label and file, honours the limit and can include cards", async () => {
    const report = await classifyTier0(fakeGraph(), RULES, "cbm", { labels: ["Class", "Method"], filePattern: FILE, limit: 1, includeCards: true });
    expect(report.results.map((r) => r.qualified_name)).toEqual(["src.main.java.owner.OwnerController"]);
    expect(report.results[0].card?.source).toContain("@Controller");
  });

  it("classifies every label a rule names by default", () => {
    expect(defaultLabels(RULES)).toEqual(expect.arrayContaining(["Class", "Route", "Type", "Enum", "Trait"]));
  });

  it("deduplicates qualified names before the limit, so progress reaches the total", async () => {
    const g = fakeGraph();
    const search = g.search;
    // Java overloads: the same method qualified name twice
    g.search = async (label, f, fl) => (label === "Method" ? [...(await search(label, f, fl)), ...(await search(label, f, fl))] : search(label, f, fl));
    const progress: Array<[number, number]> = [];
    const report = await classifyTier0(g, RULES, "cbm", { labels: ["Method", "Class"], limit: 3, onProgress: (d, t) => progress.push([d, t]) });
    expect(report.results.map((r) => r.qualified_name)).toEqual([
      "src.main.java.owner.OwnerController.showOwner", "src.main.java.owner.OwnerController", "src.main.java.owner.Owner",
    ]);
    expect(progress.at(-1)).toEqual([3, 3]);
  });

  it("counts cards built without source", async () => {
    const report = await classifyTier0(fakeGraph(), RULES, "cbm", { labels: ["Class"] });
    // OwnerTests has a snippet; the vendored class is excluded; every kept class has source.
    expect(report.summary.no_source).toBe(0);
    const g = fakeGraph();
    g.snippet = async () => null;
    expect((await classifyTier0(g, RULES, "cbm", { labels: ["Class"] })).summary.no_source).toBe(3);
  });

  it("adds a custom exclusion to the vendor one", async () => {
    const report = await classifyTier0(fakeGraph(), RULES, "cbm", { labels: ["Class"], exclude: /Owner\.java$/ });
    expect(report.results.map((r) => r.name)).toEqual(["OwnerController", "OwnerTests"]);
  });

  it("uses a custom exclusion and reports progress", async () => {
    const progress: number[] = [];
    const report = await classifyTier0(fakeGraph(), RULES, "cbm", { exclude: SAMPLE_EXCLUDE, onProgress: (d) => progress.push(d) });
    expect(report.results.some((r) => r.file_path?.includes("src/test/"))).toBe(false);
    expect(progress).toEqual([1, 2, 3, 4]);
  });
});
