/**
 * The subject of a test case (#1412, #1443): the test file's own package first, a helper many test
 * files call is no one's subject, a call that only reaches a rejected symbol follows to the element
 * that owns its file, and what is still unwired lists its candidates.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_CALL_GATE } from "../../../src/analyzers/call-evidence.js";
import { extractionConfigFrom, type ExtractionGraph } from "../../../src/analyzers/cards/extract.js";
import { INFERRED_TEST_CALL_EDGE, packageOf, planRelationships } from "../../../src/analyzers/extraction-plan.js";
import { tier0RulesFrom } from "../../../src/analyzers/tier0-rules.js";
import type { AnalyzerHeuristic } from "../../../src/analyzers/types.js";
import { getValidRelationships } from "../../../src/generated/relationship-index.js";

const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/dist/analyzers/cbm.json"), "utf-8"));
const RULES = tier0RulesFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]);
const CONFIG = extractionConfigFrom(RULES, Object.values(CBM.edges_by_type), Object.values(CBM.nodes_by_label), DEFAULT_CALL_GATE);
const hasTriple = (id: string) => {
  const p = id.split(".");
  return p.length === 5 && getValidRelationships(`${p[0]}.${p[1]}`, p[2], `${p[3]}.${p[4]}`).length > 0;
};

const APP = { layer: "application", type: "applicationcomponent" };
const CASE = { layer: "testing", type: "testcasesketch" };
const EMPTY = { elements: new Map(), getRelationship: () => undefined } as any;

const symbol = (qn: string, name: string, file: string, label = "Function") => ({ qualifiedName: qn, card: { label, name, file_path: file, parent_class: null }, tier0: null }) as any;
const call = (from: any, to: any) => ({ type: "CALLS", from: { qualifiedName: from.qualifiedName, name: from.card.name, file: from.card.file_path }, to: { qualifiedName: to.qualifiedName, name: to.card.name, file: to.card.file_path } });
const graph = (symbols: any[], edges: any[]) =>
  ({ analyzer: "cbm", project: "p", config: CONFIG, symbols, edges, fileSymbols: {}, routes: [], summary: { cards: 0, decided: 0, rejected: 0, narrowed: 0, undecided: 0, no_source: 0 } }) as ExtractionGraph;

describe("packageOf", () => {
  it("is the package or app folder, or the folder above a test folder", () => {
    expect(packageOf("packages/render/test/render.test.ts")).toBe("packages/render");
    expect(packageOf("apps/gateway/test/archive.test.ts")).toBe("apps/gateway");
    expect(packageOf("lib/foo/tests/a.test.ts")).toBe("lib/foo");
    expect(packageOf("tests/a.test.ts")).toBeNull();
    expect(packageOf("src/a.test.ts")).toBeNull();
  });
});

describe("tests links from calls", () => {
  const testFile = (n: number) => `tests/e2e/ex${n}.test.ts`;
  const helper = symbol("p.photos.jobToken", "jobToken", "photos/cycles.ts");
  const own = symbol("p.render.draw", "draw", "packages/render/src/draw.ts");
  const other = symbol("p.gpu.run", "run", "apps/render-gpu/run.ts");

  it("a helper called from several test files none of which is named after it is no subject", () => {
    const cases = [1, 2, 3].map((n) => symbol(`p.t${n}.case`, "case", testFile(n)));
    const ids = new Map<string, string>([["p.photos.jobToken", "application.applicationcomponent.job-token"]]);
    const els = new Map<string, any>([["application.applicationcomponent.job-token", APP]]);
    cases.forEach((c, i) => {
      ids.set(c.qualifiedName, `testing.testcasesketch.case-${i}`);
      els.set(`testing.testcasesketch.case-${i}`, CASE);
    });
    const plan = planRelationships(graph([helper, ...cases], cases.map((c) => call(c, helper))), EMPTY, ids, els, hasTriple);
    expect(plan.relationships).toEqual([]);
    expect(plan.sharedTestHelpers).toEqual([{ id: "application.applicationcomponent.job-token", files: 3 }]);
    expect(plan.unwiredTests.map((u) => u.candidates)).toEqual([["application.applicationcomponent.job-token"], ["application.applicationcomponent.job-token"], ["application.applicationcomponent.job-token"]]);
  });

  it("a test file named after the helper keeps its link", () => {
    const named = symbol("p.photos.jobToken", "jobToken", "photos/jobToken.ts");
    const names = ["jobToken", "x", "y"];
    const cases = names.map((n, i) => symbol(`p.t${i}.case`, "case", `tests/${n}.test.ts`));
    const ids = new Map<string, string>([["p.photos.jobToken", "application.applicationcomponent.job-token"]]);
    const els = new Map<string, any>([["application.applicationcomponent.job-token", APP]]);
    cases.forEach((c, i) => {
      ids.set(c.qualifiedName, `testing.testcasesketch.case-${i}`);
      els.set(`testing.testcasesketch.case-${i}`, CASE);
    });
    const plan = planRelationships(graph([named, ...cases], cases.map((c) => call(c, named))), EMPTY, ids, els, hasTriple);
    expect(plan.relationships.map((r) => r.source)).toEqual(["testing.testcasesketch.case-0"]);
  });

  it("a test that calls into its own package and another keeps the own package's", () => {
    const c = symbol("p.t.case", "case", "packages/render/test/draw.test.ts");
    const ids = new Map([
      ["p.t.case", "testing.testcasesketch.draws"],
      ["p.render.draw", "application.applicationcomponent.draw"],
      ["p.gpu.run", "application.applicationcomponent.run"],
    ]);
    const els = new Map<string, any>([
      ["testing.testcasesketch.draws", CASE],
      ["application.applicationcomponent.draw", APP],
      ["application.applicationcomponent.run", APP],
    ]);
    const plan = planRelationships(graph([c, own, other], [call(c, own), call(c, other)]), EMPTY, ids, els, hasTriple);
    expect(plan.relationships.map((r) => r.target)).toEqual(["application.applicationcomponent.draw"]);
  });
});

describe("tests links from a test file's name", () => {
  const els = new Map<string, any>([
    ["testing.testcasesketch.renders", CASE],
    ["application.applicationcomponent.render-py", APP],
    ["application.applicationcomponent.render-ts", APP],
  ]);
  const c = symbol("p.t.case", "case", "packages/render/test/render.test.ts");

  it("prefers the file in the test's own package", () => {
    const py = symbol("p.gpu.render", "render", "apps/render-gpu/render.ts", "Class");
    const ts = symbol("p.render.render", "render", "packages/render/src/render.ts", "Class");
    const ids = new Map([
      ["p.t.case", "testing.testcasesketch.renders"],
      ["p.gpu.render", "application.applicationcomponent.render-py"],
      ["p.render.render", "application.applicationcomponent.render-ts"],
    ]);
    const plan = planRelationships(graph([c, py, ts], []), EMPTY, ids, els, hasTriple);
    expect(plan.relationships).toEqual([expect.objectContaining({ target: "application.applicationcomponent.render-ts", edge: "TEST_FILE_NAME" })]);
  });

  it("a name match in another package alone is a candidate, not a link", () => {
    const py = symbol("p.gpu.render", "render", "apps/render-gpu/render.ts", "Class");
    const ids = new Map([
      ["p.t.case", "testing.testcasesketch.renders"],
      ["p.gpu.render", "application.applicationcomponent.render-py"],
    ]);
    const plan = planRelationships(graph([c, py], []), EMPTY, ids, els, hasTriple);
    expect(plan.relationships).toEqual([]);
    expect(plan.unwiredTests).toEqual([{ file: "packages/render/test/render.test.ts", cases: 1, candidates: ["application.applicationcomponent.render-py"] }]);
  });
});

describe("a test whose calls reach only a rejected symbol (#1443)", () => {
  const c = symbol("p.t.case", "case", "tests/structure.test.ts");
  const entry = symbol("p.graph.GroupGraph.update", "update", "src/GroupGraph.ts", "Method"); // rejected: no element
  const structure = symbol("p.src.structure.build", "build", "src/structure.ts");
  const ids = new Map([
    ["p.t.case", "testing.testcasesketch.structure"],
    ["p.src.structure.build", "application.applicationcomponent.project-structure"],
  ]);
  const els = new Map<string, any>([
    ["testing.testcasesketch.structure", CASE],
    ["application.applicationcomponent.project-structure", APP],
  ]);

  it("follows the rejected symbol's own calls to the element that owns the code, marked as inferred", () => {
    const plan = planRelationships(graph([c, entry, structure], [call(c, entry), call(entry, structure)]), EMPTY, ids, els, hasTriple);
    expect(plan.relationships).toEqual([
      expect.objectContaining({ source: "testing.testcasesketch.structure", predicate: "tests", target: "application.applicationcomponent.project-structure", edge: INFERRED_TEST_CALL_EDGE }),
    ]);
  });

  it("goes to the element owning the rejected symbol's own file when it has one", () => {
    const owner = symbol("p.src.GroupGraph", "GroupGraph", "src/GroupGraph.ts", "Class");
    const rejected = symbol("p.src.update", "update", "src/GroupGraph.ts");
    const plan = planRelationships(
      graph([c, rejected, owner], [call(c, rejected)]),
      EMPTY,
      new Map([...ids, ["p.src.GroupGraph", "application.applicationcomponent.group-graph"]]),
      new Map([...els, ["application.applicationcomponent.group-graph", APP]]),
      hasTriple
    );
    expect(plan.relationships.map((r) => [r.target, r.edge])).toEqual([["application.applicationcomponent.group-graph", INFERRED_TEST_CALL_EDGE]]);
  });

  it("lists the case unwired when the rejected symbol reaches too many elements", () => {
    const many = [1, 2, 3, 4].map((n) => symbol(`p.m.f${n}`, `f${n}`, `src/m${n}.ts`));
    const map = new Map(ids);
    const all = new Map(els);
    many.forEach((m, i) => {
      map.set(m.qualifiedName, `application.applicationcomponent.m${i}`);
      all.set(`application.applicationcomponent.m${i}`, APP);
    });
    const plan = planRelationships(graph([c, entry, ...many], [call(c, entry), ...many.map((m) => call(entry, m))]), EMPTY, map, all, hasTriple);
    expect(plan.relationships).toEqual([]);
    expect(plan.unwiredTests[0].candidates).toHaveLength(4);
  });
});
