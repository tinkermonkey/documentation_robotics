/**
 * A file is where an element was found, recorded as its source reference, and never a candidate
 * element itself (motivation.principle.a-file-is-a-source-link-not-an-element). So:
 *
 * - no card label is a file's (CBM's Module is one node per source file);
 * - an edge whose ends are files (an import, a test-file link) attaches to the one element each
 *   file declares, and is dropped when a file declares none or several;
 * - an element an existing model sourced at a whole file stays valid.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_CALL_GATE } from "../../../src/analyzers/call-evidence.js";
import { CARD_FIELDS, CARD_LABELS, FILE_LABELS } from "../../../src/analyzers/cards/build.js";
import { defaultLabels } from "../../../src/analyzers/cards/classify.js";
import { extractionConfigFrom, type ExtractionGraph } from "../../../src/analyzers/cards/extract.js";
import { planElements, planRelationships } from "../../../src/analyzers/extraction-plan.js";
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

describe("a file is never a card", () => {
  it("no card label, card field set, rule or mapping names a file's label", () => {
    expect([...FILE_LABELS]).toEqual(["Module"]);
    expect(CARD_LABELS).not.toContain("Module");
    expect(Object.keys(CARD_FIELDS)).not.toContain("Module");
    expect(defaultLabels(RULES)).not.toContain("Module");
    expect(Object.keys(CBM.nodes_by_label)).not.toContain("Module");
    const mapping = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/analyzers/cbm/node-mapping.json"), "utf-8"));
    expect(mapping.mappings.map((m: { cbm_label: string }) => m.cbm_label)).not.toContain("Module");
    expect(mapping.unmapped_labels.labels).toContain("Module");
  });

  it("a rule that names a file's label still classifies no file", () => {
    const rules = tier0RulesFrom([
      { name: "names_a_file", description: "", applies_to: [], rule: "", parameters: { tier0: { labels: ["Module", "Class"], narrow: ["application.applicationcomponent"] } } } as unknown as AnalyzerHeuristic,
    ]);
    expect(defaultLabels(rules)).toContain("Class");
    expect(defaultLabels(rules)).not.toContain("Module");
  });
});

describe("an edge between files joins the one element each file declares", () => {
  const A = "application.applicationcomponent.order-service";
  const B = "application.applicationcomponent.order-repository";
  const B2 = "application.applicationcomponent.order-cache";
  const symbol = (qualifiedName: string, name: string, file: string, label = "Class", parent: string | null = null) =>
    ({ qualifiedName, card: { label, name, file_path: file, parent_class: parent }, tier0: null }) as any;
  const importEdge = { type: "IMPORTS", from: { qualifiedName: "p.src.service", name: "src/service.ts", file: "src/service.ts" }, to: { qualifiedName: "p.src.repo", name: "repo", file: "src/repo.ts" } };
  const extraction = (symbols: any[]) =>
    ({
      analyzer: "cbm",
      project: "p",
      config: CONFIG,
      symbols,
      edges: [importEdge],
      fileSymbols: {},
      routes: [],
      summary: { cards: 0, decided: 0, rejected: 0, narrowed: 0, undecided: 0, no_source: 0 },
    }) as ExtractionGraph;
  const elements = new Map([
    [A, { layer: "application", type: "applicationcomponent" }],
    [B, { layer: "application", type: "applicationcomponent" }],
    [B2, { layer: "application", type: "applicationcomponent" }],
  ]);
  const EMPTY = { elements: new Map(), getRelationship: () => undefined } as any;
  const service = symbol("p.src.service.OrderService", "OrderService", "src/service.ts");
  const repo = symbol("p.src.repo.OrderRepository", "OrderRepository", "src/repo.ts");
  const cache = symbol("p.src.repo.OrderCache", "OrderCache", "src/repo.ts");

  it("an import between two files that each declare one element is a relationship between those elements", () => {
    const elementOf = new Map([
      ["p.src.service.OrderService", A],
      ["p.src.repo.OrderRepository", B],
    ]);
    const plan = planRelationships(extraction([service, repo]), EMPTY, elementOf, elements, hasTriple);
    expect(plan.relationships).toEqual([expect.objectContaining({ source: A, predicate: "uses", target: B })]);
  });

  it("a method of the one class does not make the file hold two elements", () => {
    const method = symbol("p.src.repo.OrderRepository.find", "find", "src/repo.ts", "Method", "p.src.repo.OrderRepository");
    const elementOf = new Map([
      ["p.src.service.OrderService", A],
      ["p.src.repo.OrderRepository", B],
      ["p.src.repo.OrderRepository.find", "application.applicationfunction.order-repository-find"],
    ]);
    const all = new Map([...elements, ["application.applicationfunction.order-repository-find", { layer: "application", type: "applicationfunction" }]]);
    const plan = planRelationships(extraction([service, repo, method]), EMPTY, elementOf, all, hasTriple);
    expect(plan.relationships).toEqual([expect.objectContaining({ source: A, predicate: "uses", target: B })]);
  });

  it("the import is dropped when the imported file declares several elements, or none", () => {
    const several = new Map([
      ["p.src.service.OrderService", A],
      ["p.src.repo.OrderRepository", B],
      ["p.src.repo.OrderCache", B2],
    ]);
    expect(planRelationships(extraction([service, repo, cache]), EMPTY, several, elements, hasTriple).relationships).toEqual([]);
    const none = new Map([["p.src.service.OrderService", A]]);
    expect(planRelationships(extraction([service]), EMPTY, none, elements, hasTriple).relationships).toEqual([]);
  });

  it("a file outside the run takes the import on the one element the model sources there, whatever its symbol", () => {
    const model = {
      elements: new Map([
        [
          B,
          {
            id: B,
            layer: "application",
            type: "applicationcomponent",
            name: "Order repository",
            status: "active",
            attributes: {},
            // Sourced at the whole file by an earlier extraction: the file's module name as its symbol.
            sourceReference: { provenance: "extracted", locations: [{ file: "src/repo.ts", symbol: "src.repo" }] },
          },
        ],
      ]),
      getRelationship: () => undefined,
    } as any;
    const elementOf = new Map([["p.src.service.OrderService", A]]);
    const plan = planRelationships(extraction([service]), model, elementOf, elements, hasTriple);
    expect(plan.relationships).toEqual([expect.objectContaining({ source: A, predicate: "uses", target: B })]);
  });
});

describe("an element sourced at a whole file stays valid", () => {
  const element = (id: string, location: { file: string; symbol?: string }) => ({
    id,
    layer: "application",
    type: "applicationcomponent",
    name: id,
    status: "active",
    attributes: { type: "internal" },
    sourceReference: { provenance: "extracted", locations: [location] },
  });
  const extraction = {
    analyzer: "cbm",
    project: "p",
    config: CONFIG,
    symbols: [],
    edges: [],
    // What the graph lists for the file: its module node and one function. No card is built from the module.
    fileSymbols: { "src/utils/graphDegree.ts": ["src.utils.graphDegree", "graphDegree", "degree"] },
    routes: [],
    summary: { cards: 0, decided: 0, rejected: 0, narrowed: 0, undecided: 0, no_source: 0 },
  } as unknown as ExtractionGraph;

  it("is not a candidate delete: with the file's module name as its symbol, or with no symbol", () => {
    const existing = {
      elements: new Map([
        ["application.applicationcomponent.graph-degree", element("application.applicationcomponent.graph-degree", { file: "src/utils/graphDegree.ts", symbol: "src.utils.graphDegree" })],
        ["application.applicationcomponent.whole-file", element("application.applicationcomponent.whole-file", { file: "src/utils/graphDegree.ts" })],
      ]),
      getRelationship: () => undefined,
    } as any;
    const plan = planElements(extraction, existing, { fileExists: () => true, fileText: () => "export function degree() {}" });
    expect(plan.candidateDeletes).toEqual([]);
    expect(plan.adds).toEqual([]);
  });

  it("is still a candidate delete when its file is gone", () => {
    const existing = {
      elements: new Map([["application.applicationcomponent.graph-degree", element("application.applicationcomponent.graph-degree", { file: "src/utils/graphDegree.ts", symbol: "src.utils.graphDegree" })]]),
      getRelationship: () => undefined,
    } as any;
    const plan = planElements(extraction, existing, { fileExists: () => false });
    expect(plan.candidateDeletes).toEqual([expect.objectContaining({ id: "application.applicationcomponent.graph-degree", evidence: "file-missing" })]);
  });
});
