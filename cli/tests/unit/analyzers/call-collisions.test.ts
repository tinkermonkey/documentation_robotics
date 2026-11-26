/**
 * Name collisions in the call graph (#1326): the index resolves a field write, a usage or a call
 * by name, so a dict key `"pts"` or a local `P()` lands on `Xform.pts` in a file that never
 * touches `Xform`. The shapes are cabinet-sheets' (Python) and the same in TypeScript.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { DEFAULT_CALL_GATE } from "../../../src/analyzers/call-evidence.js";
import { extractionConfigFrom, type ExtractedEdge, type ExtractionGraph } from "../../../src/analyzers/cards/extract.js";
import { planRelationships } from "../../../src/analyzers/extraction-plan.js";
import { tier0RulesFrom } from "../../../src/analyzers/tier0-rules.js";
import type { AnalyzerHeuristic } from "../../../src/analyzers/types.js";
import { getValidRelationships } from "../../../src/generated/relationship-index.js";

const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/dist/analyzers/cbm.json"), "utf-8"));
const CONFIG = extractionConfigFrom(
  tier0RulesFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]),
  Object.values(CBM.edges_by_type),
  Object.values(CBM.nodes_by_label),
  DEFAULT_CALL_GATE
);
const hasTriple = (id: string) => {
  const p = id.split(".");
  return p.length === 5 && getValidRelationships(`${p[0]}.${p[1]}`, p[2], `${p[3]}.${p[4]}`).length > 0;
};
const model = { elements: new Map(), getRelationship: () => undefined } as any;

const end = (qualifiedName: string, file: string) => ({ qualifiedName, name: qualifiedName.slice(qualifiedName.lastIndexOf(".") + 1), file });
function plan(edges: ExtractedEdge[], elementOf: Map<string, string>, elements: Map<string, { layer: string; type: string }>) {
  const extraction = { analyzer: "cbm", project: "p", config: CONFIG, symbols: [], edges, fileSymbols: {}, routes: [], summary: {} } as unknown as ExtractionGraph;
  return planRelationships(extraction, model, elementOf, elements, hasTriple);
}
const triples = (r: { relationships: Array<{ source: string; predicate: string; target: string }> }) => r.relationships.map((x) => `${x.source} ${x.predicate} ${x.target}`);

describe("a member of a class the caller's file never refers to (Python, cabinet-sheets)", () => {
  const PANEL = "application.applicationfunction.normalize-panel";
  const XFORM = "application.dataobject.occurrence-transform";
  const elementOf = new Map([
    ["p.sheets.normalize.panel", PANEL],
    ["p.sheets.assembly.Xform", XFORM],
  ]);
  const elements = new Map([
    [PANEL, { layer: "application", type: "applicationfunction" }],
    [XFORM, { layer: "application", type: "dataobject" }],
  ]);
  const writes = (file = "sheets/normalize.py", evidence?: ExtractedEdge["evidence"]): ExtractedEdge => ({
    type: "WRITES",
    from: end("p.sheets.normalize.panel", file),
    to: end("p.sheets.assembly.Xform.pts", "sheets/assembly.py"),
    ...(evidence ? { evidence } : {}),
  });

  it("stages nothing for a WRITES onto Xform.pts from a module that never imports Xform, and lists it", () => {
    const r = plan([writes()], elementOf, elements);
    expect(r.relationships).toEqual([]);
    expect(r.weakCalls).toBe(1);
    expect(r.weakCallPairs).toEqual([expect.objectContaining({ source: PANEL, predicate: "accesses", target: XFORM, edge: "WRITES", reason: "member-of-unreferenced-class" })]);
  });

  it("stages the link when the caller's file imports the class", () => {
    const imports: ExtractedEdge = { type: "IMPORTS", from: end("p.sheets.normalize.py", "sheets/normalize.py"), to: end("p.sheets.assembly.Xform", "sheets/assembly.py") };
    const r = plan([imports, writes()], elementOf, elements);
    expect(triples(r)).toContain(`${PANEL} accesses ${XFORM}`);
    expect(r.weakCalls).toBe(0);
  });

  it("stages the link when the caller is in the class's own file", () => {
    const r = plan([writes("sheets/assembly.py")], elementOf, elements);
    expect(triples(r)).toContain(`${PANEL} accesses ${XFORM}`);
  });

  it("believes a call the analyzer resolved through types, even from a file that never names the class", () => {
    const call: ExtractedEdge = {
      type: "CALLS",
      from: end("p.sheets.normalize.panel", "sheets/normalize.py"),
      to: end("p.sheets.assembly.Xform.pts", "sheets/assembly.py"),
      evidence: { strategy: "lsp_method", confidence: 0.9, candidates: 1, callee: "xf.pts", calleeImportance: 3 },
    };
    expect(triples(plan([call], elementOf, elements))).toContain(`${PANEL} accesses ${XFORM}`);
  });

  it("lists a confident but name-only call (unique_name 0.75) to a member of an unreferenced class", () => {
    const call: ExtractedEdge = {
      type: "CALLS",
      from: end("p.sheets.normalize.panel", "sheets/normalize.py"),
      to: end("p.sheets.assembly.Xform.pts", "sheets/assembly.py"),
      evidence: { strategy: "unique_name", confidence: 0.75, candidates: 1, callee: "P", calleeImportance: 3 },
    };
    const r = plan([call], elementOf, elements);
    expect(r.relationships).toEqual([]);
    expect(r.weakCallPairs.map((w) => w.reason)).toEqual(["member-of-unreferenced-class"]);
  });
});

describe("the same shape in TypeScript", () => {
  const RENDER = "application.applicationfunction.render-panel";
  const CAMERA = "application.dataobject.iso-camera";
  const elementOf = new Map([
    ["p.src.render.renderPanel", RENDER],
    ["p.src.camera.Camera", CAMERA],
  ]);
  const elements = new Map([
    [RENDER, { layer: "application", type: "applicationfunction" }],
    [CAMERA, { layer: "application", type: "dataobject" }],
  ]);
  const usage: ExtractedEdge = { type: "USAGE", from: end("p.src.render.renderPanel", "src/render.ts"), to: end("p.src.camera.Camera.pts", "src/camera.ts") };

  it("leaves out a usage of Camera.pts from a file that never imports Camera, then stages it once the file does", () => {
    const without = plan([usage], elementOf, elements);
    expect(without.relationships).toEqual([]);
    expect(without.weakCallPairs).toHaveLength(1);
    const withImport = plan([{ type: "IMPORTS", from: end("p.src.render", "src/render.ts"), to: end("p.src.camera.Camera", "src/camera.ts") }, usage], elementOf, elements);
    expect(triples(withImport)).toContain(`${RENDER} accesses ${CAMERA}`);
  });
});

describe("the direction of serves from a call", () => {
  const CLI = "application.applicationcomponent.sheets-cli";
  const INSPECT = "application.applicationservice.inspect";
  const elementOf = new Map([
    ["p.sheets.cli.main", CLI],
    ["p.sheets.inspect.run", INSPECT],
  ]);
  const elements = new Map([
    [CLI, { layer: "application", type: "applicationcomponent" }],
    [INSPECT, { layer: "application", type: "applicationservice" }],
  ]);

  it("runs from the called service to its caller (provider to consumer), never from the caller", () => {
    const call: ExtractedEdge = {
      type: "CALLS",
      from: end("p.sheets.cli.main", "sheets/cli.py"),
      to: end("p.sheets.inspect.run", "sheets/inspect.py"),
      evidence: { strategy: "import_map", confidence: 0.9, candidates: 1, callee: "run", calleeImportance: 3 },
    };
    const r = plan([call], elementOf, elements);
    expect(triples(r)).toEqual([`${INSPECT} serves ${CLI}`]);
  });
});
