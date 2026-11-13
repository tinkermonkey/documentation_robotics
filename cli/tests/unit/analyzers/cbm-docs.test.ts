/**
 * Documentation evidence from CBM: decision records (ADR nodes, SUPERSEDES) and doc sections
 * (Section nodes, MENTIONS, REFERENCES_FILE), read by extraction and planned into cards.
 *
 * The graph is CBM 0.12.1's own answers for tests/fixtures/cbm-docs-repo (four decision records,
 * the second superseded by the third, the fourth only proposed; a README whose sections name the
 * code), recorded by tests/fixtures/cbm-0.12.1/record-cbm-docs-repo.ts and replayed here through
 * the analyzer's real CbmTools and card graph.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, realpath, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CbmToolError, CbmTools } from "../../../src/analyzers/cbm-responses.js";
import { cbmCardGraph } from "../../../src/analyzers/cards/graph.js";
import { collectExtraction, extractionConfigFrom, type ExtractionGraph } from "../../../src/analyzers/cards/extract.js";
import { buildDocIndex, collectDecisionRecords, docsFor } from "../../../src/analyzers/cards/docs.js";
import type { CardGraph } from "../../../src/analyzers/cards/types.js";
import { decisionKey, planElements, type PlanOptions } from "../../../src/analyzers/extraction-plan.js";
import { tier0RulesFrom } from "../../../src/analyzers/tier0-rules.js";
import type { AnalyzerHeuristic } from "../../../src/analyzers/types.js";
import type { ChangesetGraph, GraphElement } from "../../../src/core/changeset-graph.js";
import { Model } from "../../../src/core/model.js";
import { writeIndexMeta, writeSession } from "../../../src/analyzers/session-state.js";
import type { AnalyzerBackend } from "../../../src/analyzers/base-analyzer.js";
import { createCodebaseExtractHandler } from "../../../src/mcp/tools/codebase-extract.js";
import type { CodebaseToolDeps } from "../../../src/mcp/tools/codebase-shared.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";

const FIXTURE = resolve(import.meta.dir, "../../fixtures/cbm-0.12.1/cbm-docs-repo.responses.json");
const RECORDING = JSON.parse(readFileSync(FIXTURE, "utf-8")) as {
  project: string;
  calls: Array<{ tool: string; args: Record<string, unknown>; response: unknown }>;
};
const P = RECORDING.project;
/** The fixture repository: extraction reads source from disk, as it does in production. */
const REPO = resolve(import.meta.dir, "../../fixtures/cbm-docs-repo");
const SPEC = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/dist/analyzers/cbm.json"), "utf-8"));
const CONFIG = extractionConfigFrom(
  tier0RulesFrom(SPEC.heuristics.heuristics as AnalyzerHeuristic[]),
  Object.values(SPEC.edges_by_type),
  Object.values(SPEC.nodes_by_label)
);

const ADR1 = "docs/adr/0001-record-architecture-decisions.md";
const ADR2 = "docs/adr/0002-store-orders-in-sqlite.md";
const ADR3 = "docs/adr/0003-store-orders-in-postgresql.md";
const ADR4 = "docs/adr/0004-order-totals-must-be-positive.md";

/** The recorded responses, by tool and arguments; a call that wasn't recorded fails the test. */
function replayGraph(): CardGraph {
  const byCall = new Map(RECORDING.calls.map((c) => [`${c.tool} ${JSON.stringify(c.args)}`, c.response]));
  const invoker = {
    async invokeTool(tool: string, args?: unknown) {
      const key = `${tool} ${JSON.stringify(args ?? {})}`;
      if (!byCall.has(key)) throw new Error(`not recorded: ${key}`);
      return structuredClone(byCall.get(key));
    },
  };
  return cbmCardGraph(new CbmTools(invoker), P);
}

/** A changeset graph with these live elements, enough for planning. */
function existing(elements: Array<Partial<GraphElement> & { id: string; file?: string; symbol?: string }> = []): ChangesetGraph {
  const map = new Map<string, GraphElement>();
  for (const e of elements) {
    const [layer, type] = e.id.split(".");
    map.set(e.id, {
      id: e.id,
      layer,
      type,
      name: e.name ?? e.id,
      attributes: {},
      status: "unchanged",
      ...(e.file ? { sourceReference: { provenance: "extracted", locations: [{ file: e.file, ...(e.symbol ? { symbol: e.symbol } : {}) }] } } : {}),
    });
  }
  return { elements: map, getRelationship: () => undefined } as unknown as ChangesetGraph;
}

const PLAN: PlanOptions = { fileExists: () => true };

let extraction: ExtractionGraph;

beforeEach(async () => {
  extraction = await collectExtraction(replayGraph(), CONFIG, "cbm", { sourceRoot: REPO });
});

describe("decision records (CBM ADR nodes)", () => {
  it("reads each record with its status, decision, context and supersessions", async () => {
    const records = await collectDecisionRecords(replayGraph());
    expect(records.map((r) => r.id)).toEqual(["ADR-1", "ADR-2", "ADR-3", "ADR-4"]);
    const [adr1, adr2, adr3, adr4] = records;

    expect(adr3).toMatchObject({
      title: "3. Store orders in PostgreSQL",
      status: "accepted",
      date: "2024-06-15",
      deciders: "Ana Lima, Ben Okafor",
      decision: "We will store orders in a managed PostgreSQL database, accessed only through OrderStore.",
      file: ADR3,
      lines: "1-24",
      retired: false,
      supersedes: [{ id: "ADR-2", title: "2. Store orders in SQLite", file: ADR2 }],
      supersededBy: [],
    });
    expect(adr3.context).toContain("several hosts behind a load balancer");
    expect(adr3.consequences).toContain("operate a database server");
    // The link to ADR-2 in its Status section is the supersession, not code it mentions.
    expect(adr3.mentions).toEqual([]);

    expect(adr2).toMatchObject({ status: "superseded", retired: true, supersededBy: [{ id: "ADR-3", file: ADR3 }] });
    expect(adr2.statusText).toBe("Superseded by 3. Store orders in PostgreSQL");
    expect(adr1).toMatchObject({ status: "accepted", retired: false });
    expect(adr4).toMatchObject({ status: "proposed", retired: false, mentions: ["src.orders.OrderService.placeOrder"] });
  });

  it("are in the extraction whatever the file scope", async () => {
    const scoped = await collectExtraction(replayGraph(), CONFIG, "cbm", { sourceRoot: REPO, files: new Set(["src/store.ts"]) });
    expect(scoped.decisions?.map((r) => r.id)).toEqual(["ADR-1", "ADR-2", "ADR-3", "ADR-4"]);
  });
});

describe("doc sections (CBM Section, MENTIONS, REFERENCES_FILE)", () => {
  it("attach to the cards of the code they mention, bounded, never from a decision record", async () => {
    const bySymbol = new Map(extraction.symbols.map((s) => [s.card.qualified_name, s]));
    // Named with its class in backticks: a mention of the method itself.
    expect(bySymbol.get("src.orders.OrderService.placeOrder")?.docs).toEqual([
      {
        doc: "README.md",
        section: "Placing orders",
        lines: "6-7",
        excerpt: "`OrderService.placeOrder` validates the total and hands the order to `OrderStore`. Totals must be positive. See [the service](src/orders.ts).",
        via: "mentions",
      },
    ]);
    // A class takes the sections that link its file.
    expect(bySymbol.get("src.orders.OrderService")?.docs).toEqual([
      expect.objectContaining({ doc: "README.md", section: "Placing orders", via: "mentions-file" }),
    ]);
    expect(bySymbol.get("src.store.OrderStore")?.docs).toEqual([expect.objectContaining({ doc: "README.md", section: "Storage", via: "mentions-file" })]);
    // A method takes only its own mentions, not its file's.
    expect(bySymbol.get("src.orders.OrderService.listOrders")?.docs).toBeUndefined();
    expect(bySymbol.get("src.store.OrderStore.insert")?.docs).toBeUndefined();
  });

  it("index REFERENCES_FILE by its doc file and leave out changelogs", async () => {
    const rows = (cypher: string): unknown[][] => {
      if (cypher.startsWith("MATCH (a:File)-[r:REFERENCES_FILE]")) {
        return [
          ["docs/guide.md", "src/store.ts"],
          ["CHANGELOG.md", "src/orders.ts"],
        ];
      }
      if (cypher.startsWith("MATCH (s:Section) WHERE s.file_path IN")) {
        return [
          ["docs/guide.md", "Intro", "1", "2", "Read me first."],
          ["docs/guide.md", "Persistence", "4", "9", "Orders live in `store.ts`, behind one class."],
        ];
      }
      return [];
    };
    const index = await buildDocIndex({ project: P, search: async () => [], rows: async (c) => rows(c), snippet: async () => null });
    expect(docsFor(index, `${P}.src.store.OrderStore`, "src/store.ts", "Class")).toEqual([
      { doc: "docs/guide.md", section: "Persistence", lines: "4-9", excerpt: "Orders live in `store.ts`, behind one class.", via: "references-file" },
    ]);
    expect(docsFor(index, `${P}.src.orders.OrderService`, "src/orders.ts", "Class")).toEqual([]);
  });

  it("leave the extraction alone when the analyzer can't answer, and say why", async () => {
    const real = replayGraph();
    const failing: CardGraph = {
      ...real,
      project: real.project,
      rows: async (cypher) => {
        if (/:ADR|:Section|REFERENCES_FILE/.test(cypher)) throw new CbmToolError("query_graph", "unknown label");
        return real.rows(cypher);
      },
    };
    const result = await collectExtraction(failing, CONFIG, "cbm", { sourceRoot: REPO });
    expect(result.docsError).toContain("unknown label");
    expect(result.decisions).toBeUndefined();
    expect(result.symbols.length).toBe(extraction.symbols.length);
    expect(result.symbols.some((s) => s.docs)).toBe(false);
  });
});

describe("planning decision records", () => {
  it("cards each active record for a motivation element, first, and retires the superseded one", () => {
    const plan = planElements(extraction, existing(), PLAN);
    const records = plan.undecided.filter((c) => c.kind === "decision-record");
    expect(records.map((c) => c.symbol)).toEqual(["ADR-1", "ADR-3", "ADR-4"]);
    expect(plan.undecided.slice(0, 3)).toEqual(records);
    const adr3 = records[1];
    expect(adr3).toMatchObject({
      label: "ADR",
      file: ADR3,
      lines: "1-24",
      qualifiedName: "docs.adr.0003-store-orders-in-postgresql.__adr__",
      candidates: ["motivation.principle", "motivation.constraint", "motivation.assessment"],
      decision: {
        id: "ADR-3",
        title: "3. Store orders in PostgreSQL",
        status: "accepted",
        deciders: "Ana Lima, Ben Okafor",
        supersedes: ["ADR-2 (2. Store orders in SQLite)"],
      },
    });
    expect(adr3.reason).toContain("principle");
    expect(records[2].reason).toContain("only proposed");
    expect(plan.decisions).toEqual({
      cards: 3,
      modelled: 0,
      retired: [{ id: "ADR-2", title: "2. Store orders in SQLite", file: ADR2, status: "superseded", supersededBy: ["ADR-3"] }],
    });
    expect(plan.candidateDeletes).toEqual([]);
  });

  it("counts a record an element names as modelled, and makes an element sourced only from a retired record a candidate delete", () => {
    const plan = planElements(
      extraction,
      existing([
        { id: "motivation.constraint.store-orders-in-postgresql", file: ADR3, symbol: "ADR-3" },
        { id: "motivation.constraint.store-orders-in-sqlite", file: ADR2, symbol: "ADR-2" },
      ]),
      PLAN
    );
    expect(plan.undecided.filter((c) => c.kind === "decision-record").map((c) => c.symbol)).toEqual(["ADR-1", "ADR-4"]);
    expect(plan.decisions?.modelled).toBe(1);
    expect(plan.candidateDeletes).toEqual([
      expect.objectContaining({ id: "motivation.constraint.store-orders-in-sqlite", file: ADR2, symbol: "ADR-2", evidence: "decision-superseded" }),
    ]);
    expect(plan.candidateDeletes[0].detail).toContain("superseded by ADR-3 (3. Store orders in PostgreSQL)");
  });

  it("keeps an element a live record also sources, and leaves out records outside the layers or rejected", () => {
    const both = planElements(extraction, existing([{ id: "motivation.principle.one-database", file: ADR2 }, { id: "x.y.z", file: ADR3 }]), PLAN);
    expect(both.candidateDeletes).toEqual([expect.objectContaining({ id: "motivation.principle.one-database" })]);
    const shared = existing([{ id: "motivation.principle.one-database", file: ADR2 }]);
    const element = shared.elements.get("motivation.principle.one-database")!;
    element.sourceReference!.locations.push({ file: ADR3 });
    expect(planElements(extraction, shared, PLAN).candidateDeletes).toEqual([]);

    const apiOnly = planElements(extraction, existing(), { ...PLAN, layers: ["api"] });
    expect(apiOnly.undecided.some((c) => c.kind === "decision-record")).toBe(false);

    const rejected = planElements(extraction, existing(), { ...PLAN, notElements: new Set([decisionKey(ADR1, "ADR-1")]) });
    expect(rejected.undecided.filter((c) => c.kind === "decision-record").map((c) => c.symbol)).toEqual(["ADR-3", "ADR-4"]);
  });

  it("leaves out records under test and fixture paths: they are not the project's decisions", () => {
    const nested: ExtractionGraph = {
      ...extraction,
      decisions: extraction.decisions!.map((r) => ({ ...r, file: `cli/tests/fixtures/cbm-docs-repo/${r.file}` })),
    };
    const plan = planElements(nested, existing(), PLAN);
    expect(plan.undecided.some((c) => c.kind === "decision-record")).toBe(false);
    expect(plan.decisions).toEqual({ cards: 0, modelled: 0, retired: [] });
  });

  it("with since, cards only the records whose file the range changed", () => {
    const changes = { changed: new Set([ADR4, "src/orders.ts"]), deleted: new Map<string, string | null>(), hunks: new Map([[ADR4, "all" as const]]) };
    const plan = planElements(extraction, existing(), { ...PLAN, changes });
    const records = plan.undecided.filter((c) => c.kind === "decision-record");
    expect(records.map((c) => c.symbol)).toEqual(["ADR-4"]);
    expect(records[0].changedInRange).toBe(true);
  });

  it("review: with since, a retired record is the range's when it or the record that supersedes it changed, and only those are listed", () => {
    const element = { id: "motivation.constraint.store-orders-in-sqlite", file: ADR2, symbol: "ADR-2" };
    const range = (...files: string[]) => ({ changed: new Set(files), deleted: new Map<string, string | null>() });
    // Neither ADR-2 nor ADR-3 changed: nothing listed, nothing to delete.
    const untouched = planElements(extraction, existing([element]), { ...PLAN, changes: range("src/orders.ts") });
    expect(untouched.decisions?.retired).toEqual([]);
    expect(untouched.candidateDeletes).toEqual([]);
    // ADR-3, which supersedes ADR-2, changed: ADR-2 is the range's.
    const superseder = planElements(extraction, existing([element]), { ...PLAN, changes: range(ADR3) });
    expect(superseder.decisions?.retired.map((r) => r.id)).toEqual(["ADR-2"]);
    expect(superseder.candidateDeletes).toEqual([expect.objectContaining({ id: element.id, evidence: "decision-superseded" })]);
  });

  it("review: an element that also names code is not a candidate delete when its record retires", () => {
    const plan = planElements(extraction, existing([{ id: "motivation.principle.one-database", file: ADR2 }]), PLAN);
    expect(plan.candidateDeletes.map((d) => d.id)).toEqual(["motivation.principle.one-database"]);
    const withCode = existing([{ id: "motivation.principle.one-database", file: ADR2 }]);
    withCode.elements.get("motivation.principle.one-database")!.sourceReference!.locations.push({ file: "src/store.ts", symbol: "OrderStore" });
    expect(planElements(extraction, withCode, PLAN).candidateDeletes).toEqual([]);
  });

  it("review: a record superseded only by a proposed record is still active", async () => {
    // ADR-2 states no retiring status of its own here: only the link from ADR-3 can retire it.
    const withStatuses = (statuses: Record<string, string>): CardGraph => {
      const graph = replayGraph();
      return {
        ...graph,
        project: graph.project,
        rows: async (cypher) => {
          const rows = await graph.rows(cypher);
          if (!cypher.startsWith("MATCH (a:ADR) RETURN a.qualified_name")) return rows;
          return rows.map((row) => (statuses[String(row[1])] ? row.map((v, i) => (i === 4 ? statuses[String(row[1])] : v)) : row));
        },
      };
    };
    const accepted = await collectDecisionRecords(withStatuses({ [ADR2]: "accepted" }));
    expect(accepted.find((r) => r.id === "ADR-2")).toMatchObject({ retired: true, supersededBy: [{ id: "ADR-3" }] });
    const proposed = await collectDecisionRecords(withStatuses({ [ADR2]: "accepted", [ADR3]: "proposed" }));
    expect(proposed.find((r) => r.id === "ADR-3")!.status).toBe("proposed");
    expect(proposed.find((r) => r.id === "ADR-2")).toMatchObject({ retired: false, supersededBy: [{ id: "ADR-3" }] });
  });

  it("review: reads the sections' mentions once, and keeps a record's first mentions in doc and line order", async () => {
    const graph = replayGraph();
    const queries: string[] = [];
    const counting: CardGraph = {
      ...graph,
      project: graph.project,
      rows: async (cypher) => {
        queries.push(cypher);
        return graph.rows(cypher);
      },
    };
    await collectExtraction(counting, CONFIG, "cbm", { sourceRoot: REPO });
    expect(queries.filter((q) => q.includes("[r:MENTIONS]"))).toHaveLength(1);

    // The graph's order doesn't decide which mentions a capped list keeps.
    const reversed: CardGraph = {
      ...graph,
      project: graph.project,
      rows: async (cypher) => {
        const rows = await graph.rows(cypher);
        return cypher.includes("[r:MENTIONS]") ? [...rows].reverse() : rows;
      },
    };
    const inOrder = await collectDecisionRecords(replayGraph());
    const fromReversed = await collectDecisionRecords(reversed);
    expect(fromReversed.map((r) => r.mentions)).toEqual(inOrder.map((r) => r.mentions));
  });

  it("puts a card's doc sections on the card", () => {
    const plan = planElements(extraction, existing(), PLAN);
    const service = plan.undecided.find((c) => c.qualifiedName === "src.orders.OrderService");
    expect(service?.docs?.[0]).toMatchObject({ doc: "README.md", section: "Placing orders" });
  });
});

describe("codebase_extract with documentation evidence", () => {
  const HEAD = "1111111111111111111111111111111111111111";
  let rootPath: string;

  beforeEach(async () => {
    clearModelCache();
    const dir = join(tmpdir(), `dr-mcp-extract-docs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    rootPath = await realpath(dir);
    await Model.init(rootPath, { name: "Docs Test Model", version: "0.1.0" });
    await writeSession({ active_analyzer: "cbm", selected_at: new Date().toISOString() }, rootPath);
    await writeIndexMeta({ git_head: HEAD, timestamp: "2026-11-12T12:00:00.000Z", node_count: 54, edge_count: 74 }, rootPath, "cbm");
  });

  afterEach(async () => {
    clearModelCache();
    await rm(rootPath, { recursive: true, force: true });
  });

  function deps(): CodebaseToolDeps {
    const backend = {
      name: "cbm",
      detect: async () => ({ installed: true, binary_path: "/bin/cbm" }),
      extract: async (_root: string, options: any) => collectExtraction(replayGraph(), CONFIG, "cbm", { ...options, sourceRoot: REPO }),
    } as unknown as AnalyzerBackend;
    return {
      getAnalyzer: async (name) => (name === "cbm" ? backend : undefined),
      discover: async () => ({ found: [], selected: "cbm" }),
      spawn: (() => {
        throw new Error("no index job in these tests");
      }) as any,
      drCommand: { command: "/usr/bin/node", args: ["/opt/dr/dist/cli.js"] },
      isAlive: () => true,
      gitHead: () => HEAD,
      codeChanges: async () => {
        throw new Error("no since in these tests");
      },
    };
  }

  function ok(result: any): any {
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  }

  it("returns decision-record cards first, with the retired records and the notes, and a reject keeps a record out", async () => {
    const handler = createCodebaseExtractHandler(deps());
    const result = ok(await handler({ rootPath }));
    const items = result.undecided.items as any[];
    expect(items.slice(0, 3).map((c) => c.symbol)).toEqual(["ADR-1", "ADR-3", "ADR-4"]);
    expect(items[1].decision.decision).toContain("managed PostgreSQL");
    expect(result.documentation.decisionRecords).toMatchObject({ cards: 3, modelled: 0, retired: { total: 1, items: [expect.objectContaining({ id: "ADR-2" })] } });
    expect(result.documentation.note).toContain("decision-record");
    expect(items.find((c) => c.qualifiedName === "src.orders.OrderService.placeOrder")?.docs?.[0]?.section).toBe("Placing orders");

    ok(await handler({ reject: [{ card: items[0].cardId, reason: "a process record, not intent" }], rootPath }));
    const rerun = ok(await handler({ rootPath }));
    expect((rerun.undecided.items as any[]).filter((c) => c.label === "ADR").map((c) => c.symbol)).toEqual(["ADR-3", "ADR-4"]);
  });

  it("review: with since, cards a decision record the range changed though no element names its file", async () => {
    const handler = createCodebaseExtractHandler({
      ...deps(),
      codeChanges: async () => ({ base: "abc1234", changed: new Set([ADR4, "README.md", "package-lock.json"]), deleted: new Map(), hunks: new Map([[ADR4, "all" as const]]) }),
    });
    const result = ok(await handler({ since: "main", rootPath }));
    const records = (result.undecided.items as any[]).filter((c) => c.label === "ADR");
    expect(records.map((c) => c.symbol)).toEqual(["ADR-4"]);
    expect(records[0].changedInRange).toBe(true);
    // Only the record joins the code in scope, not other docs or lockfiles the range changed.
    expect(result.scope.changedFiles).toBe(1);
  });
});
