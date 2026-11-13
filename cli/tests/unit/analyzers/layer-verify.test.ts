/**
 * codebase_verify beyond the API layer (#1082): layer-verify.ts over a faked analyzer graph and a
 * real model. Cards, Tier 0, the element plan and the edge mapping are the real code and the real
 * cbm mapping (spec/dist/analyzers/cbm.json).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Model } from "../../../src/core/model.js";
import { Changeset } from "../../../src/core/changeset.js";
import { ChangesetGraph } from "../../../src/core/changeset-graph.js";
import { loadExtractionCoverage } from "../../../src/core/extraction-observability.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { extractionConfigFrom } from "../../../src/analyzers/cards/extract.js";
import type { CardGraph, GraphNode } from "../../../src/analyzers/cards/types.js";
import { tier0RulesFrom } from "../../../src/analyzers/tier0-rules.js";
import type { AnalyzerHeuristic } from "../../../src/analyzers/types.js";
import { LAYER_CHECKS, readRecordedDecisions, verifyLayers, type LayerVerifyInput } from "../../../src/analyzers/layer-verify.js";
import { getValidRelationships } from "../../../src/generated/relationship-index.js";
import { normalizeIndexCoverage } from "../../../src/analyzers/cbm-responses.js";
import { VERIFIABLE_LAYERS } from "../../../src/analyzers/active-analyzer.js";

const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/dist/analyzers/cbm.json"), "utf-8"));
const CONFIG = extractionConfigFrom(
  tier0RulesFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]),
  Object.values(CBM.edges_by_type),
  Object.values(CBM.nodes_by_label)
);
const P = "proj";
const TEST_FILE = "src/test/OwnerTests.java";
const CONTROLLER_FILE = "src/owner/OwnerController.java";

interface FakeNode extends GraphNode {
  cbm_name?: string;
  decorators?: string[];
  source?: string;
}

/** The graph: a SQL table, compose and Kubernetes objects, an image, and a JUnit test class. */
function fakeGraph(): CardGraph {
  const testQn = (m: string) => `${P}.src.test.OwnerTests.OwnerTests.${m}`;
  const nodes: FakeNode[] = [
    { label: "Table", name: "owners", qualified_name: `${P}.db.h2.schema.owners`, file_path: "db/h2/schema.sql", start_line: 1, end_line: 5 },
    { label: "Resource", name: "compose::compose/Service/-/db", cbm_name: "Service/db", qualified_name: `${P}.compose::compose/Service/-/db`, file_path: "compose.yml" },
    { label: "Resource", name: "yml::core/Service/-/web", cbm_name: "Service/web", qualified_name: `${P}.k8s.web.yml::core/Service/-/web`, file_path: "k8s/web.yml" },
    { label: "Resource", name: "yml::core/Secret/-/creds", cbm_name: "Secret/creds", qualified_name: `${P}.k8s.web.yml::core/Secret/-/creds`, file_path: "k8s/web.yml" },
    { label: "Image", name: "__image__postgres", cbm_name: "postgres", qualified_name: "__image__postgres", file_path: "" },
    {
      label: "Method",
      name: "testShowOwner",
      qualified_name: testQn("testShowOwner"),
      file_path: TEST_FILE,
      parent_class: `${P}.src.test.OwnerTests.OwnerTests`,
      start_line: 10,
      end_line: 14,
      decorators: ["@Test"],
      source: "@Test\nvoid testShowOwner() {\n}",
    },
    {
      label: "Method",
      name: "testCreate",
      qualified_name: testQn("testCreate"),
      file_path: TEST_FILE,
      parent_class: `${P}.src.test.OwnerTests.OwnerTests`,
      start_line: 20,
      end_line: 24,
      decorators: ["@Test"],
      source: "@Test\nvoid testCreate() {\n}",
    },
    {
      label: "Method",
      name: "showOwner",
      qualified_name: `${P}.src.owner.OwnerController.OwnerController.showOwner`,
      file_path: CONTROLLER_FILE,
      parent_class: `${P}.src.owner.OwnerController.OwnerController`,
      start_line: 30,
      end_line: 40,
    },
  ];
  const edges = [{ type: "TESTS", from: testQn("testShowOwner"), to: `${P}.src.owner.OwnerController.OwnerController.showOwner` }];
  const byQn = new Map(nodes.map((n) => [n.qualified_name, n]));
  return {
    project: P,
    async search(label, filePattern) {
      return nodes.filter((n) => n.label === label && (!filePattern || n.file_path === filePattern));
    },
    async rows(cypher) {
      const edgeRead = /^MATCH \(a\)-\[r:(\w+)\]->\(b\) RETURN a\.qualified_name, a\.file_path, a\.name/.exec(cypher);
      if (edgeRead) {
        return edges
          .filter((e) => e.type === edgeRead[1])
          .map((e) => {
            const a = byQn.get(e.from)!;
            const b = byQn.get(e.to)!;
            return [e.from, a.file_path, a.name, e.to, b.file_path, b.name];
          });
      }
      const stored = /^MATCH \(n:(\w+)\) RETURN n\.qualified_name, n\.name$/.exec(cypher);
      if (stored) return nodes.filter((n) => n.label === stored[1]).map((n) => [n.qualified_name, n.cbm_name ?? n.name]);
      if (/^MATCH \(f:File\) RETURN f\.file_path$/.test(cypher)) return [...new Set(nodes.map((n) => n.file_path).filter(Boolean))].map((f) => [f]);
      if (/decorators IS NOT NULL/.test(cypher)) return nodes.filter((n) => n.decorators).map((n) => [n.qualified_name, JSON.stringify(n.decorators)]);
      return [];
    },
    async snippet(qn) {
      const n = byQn.get(qn);
      return n?.source ? { source: n.source } : null;
    },
  };
}

let rootPath: string;

beforeEach(async () => {
  clearModelCache();
  rootPath = await realpath(
    await (async () => {
      const dir = join(tmpdir(), `dr-layer-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(dir, { recursive: true });
      return dir;
    })()
  );
  await Model.init(rootPath, { name: "Layer Verify Test", version: "0.1.0" });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

async function add(layer: string, type: string, name: string, attributes: Record<string, unknown>, file?: string, symbol?: string): Promise<void> {
  const result = await modelAddHandler({
    rootPath,
    layer,
    type,
    name,
    attributes,
    ...(file ? { sourceFile: file, sourceSymbol: symbol, sourceProvenance: "extracted" } : {}),
  } as any);
  if (result.isError) throw new Error((result.content[0] as any).text);
  clearModelCache();
}

async function modelGraph(): Promise<ChangesetGraph> {
  clearModelCache();
  const model = await Model.load(rootPath);
  const now = new Date().toISOString();
  return ChangesetGraph.build(model, new Changeset({ id: "base", name: "base", created: now, modified: now, status: "committed", baseSnapshot: "", changes: [] }));
}

async function verify(layers: string[], notIndexed: Map<string, string> = new Map(), extra: Partial<LayerVerifyInput> = {}) {
  return (await verifyResult(layers, notIndexed, extra)).reports;
}

async function verifyResult(layers: string[], notIndexed: Map<string, string> = new Map(), extra: Partial<LayerVerifyInput> = {}) {
  return verifyLayers({
    graph: fakeGraph(),
    config: CONFIG,
    analyzer: "cbm",
    sourceRoot: rootPath,
    model: await modelGraph(),
    layers,
    coverage: await loadExtractionCoverage("cbm"),
    notIndexed: async (files) => new Map(files.filter((f) => notIndexed.has(f)).map((f) => [f, notIndexed.get(f)!])),
    // Every file the model names exists, except the one a test removes.
    fileExists: (file) => file !== "db/gone.sql",
    fileText: (file) => (file === "db/broken.sql" ? "CREATE TABLE audit (\n  id INT\n);\n" : null),
    hasTriple: (id) => {
      const p = id.split(".");
      return p.length === 5 && getValidRelationships(`${p[0]}.${p[1]}`, p[2], `${p[3]}.${p[4]}`).length > 0;
    },
    ...extra,
  });
}

describe("layer-verify (#1082)", () => {
  it("has a check for every verifiable layer but api", () => {
    expect(Object.keys(LAYER_CHECKS).sort()).toEqual(VERIFIABLE_LAYERS.filter((l) => l !== "api").sort());
  });

  it("sorts data-store collections into matched, in code only, drift and not indexed", async () => {
    await add("data-store", "collection", "owners", { collectionType: "TABLE" }, "db/h2/schema.sql", "owners");
    await add("data-store", "collection", "legacy", { collectionType: "TABLE" }, "db/h2/schema.sql", "legacy");
    await add("data-store", "collection", "audit", { collectionType: "TABLE" }, "db/broken.sql", "audit");
    await add("data-store", "collection", "archive", { collectionType: "TABLE" }, "db/gone.sql", "archive");
    // In the partly parsed file, but the file doesn't name it any more: drift after all.
    await add("data-store", "collection", "dropped", { collectionType: "TABLE" }, "db/broken.sql", "dropped");
    // Sourced to an entity class, not SQL: this check doesn't read it.
    await add("data-store", "collection", "pets", { collectionType: "TABLE" }, "src/Pet.java", "Pet");
    await add("data-store", "collection", "notes", { collectionType: "TABLE" });

    const [report] = await verify(["data-store"], new Map([["db/broken.sql", "the analyzer parsed it only in part"]]));
    expect(report.layer).toBe("data-store");
    expect(report.buckets.matched.map((e) => e.id)).toEqual(["data-store.collection.owners"]);
    expect(report.buckets.in_graph_only).toEqual([]);
    expect(report.buckets.in_model_only.map((e) => [e.id, e.reason])).toEqual([
      ["data-store.collection.legacy", "the code has no symbol this element names"],
      ["data-store.collection.archive", "its source file is gone"],
      ["data-store.collection.dropped", "its source file doesn't name it any more"],
    ]);
    // A parse gap is not drift.
    expect(report.buckets.not_indexed.map((e) => [e.id, e.reason])).toEqual([["data-store.collection.audit", "the analyzer parsed it only in part"]]);
    expect(report.summary).toMatchObject({ matched_count: 1, gap_count: 0, drift_count: 3, not_indexed_count: 1, elements_without_source_ref: 1, elements_not_checked: 1 });
  });

  it("checks technology elements from infrastructure, matching an image by its id and a Secret as a configuration artifact", async () => {
    await add("technology", "node", "Service db", { nodeType: "container" }, "compose.yml", "Service/db");
    await add("technology", "artifact", "postgres", { artifactType: "container-image" });
    await add("technology", "node", "Deployment api", { nodeType: "container" }, "k8s/api.yml", "Deployment/api");

    const [technology] = await verify(["technology"]);
    expect(technology.buckets.matched.map((e) => e.id).sort()).toEqual(["technology.artifact.postgres", "technology.node.service-db"]);
    expect(technology.buckets.in_graph_only.map((e) => [e.id, e.type]).sort()).toEqual([
      ["technology.artifact.secret-creds", "technology.artifact"],
      ["technology.technologyservice.service-web", "technology.technologyservice"],
    ]);
    expect(technology.buckets.in_model_only.map((e) => e.id)).toEqual(["technology.node.deployment-api"]);
  });

  it("checks an infrastructure element only where its type's code lives, not any YAML or SQL file", async () => {
    // Hand-modelled, sourced to files no infrastructure node comes from: not drift.
    await add("technology", "artifact", "CI pipeline", { artifactType: "configuration" }, ".github/workflows/ci.yml", "build");
    await add("technology", "node", "App config", { nodeType: "container" }, "config/app.yml", "server");
    await add("technology", "systemsoftware", "Bash", { softwareType: "middleware" }, "scripts/run.yml", "bash");
    await add("data-store", "collection", "events", { collectionType: "TABLE" }, "db/events.yaml", "events");
    // A Kubernetes object and a SQL table that are gone: drift.
    await add("technology", "artifact", "Secret old", { artifactType: "configuration" }, "k8s/web.yml", "Secret/old");
    await add("data-store", "collection", "legacy", { collectionType: "TABLE" }, "db/h2/schema.sql", "legacy");

    const [dataStore, technology] = await verify(["data-store", "technology"]);
    expect(technology.buckets.in_model_only.map((e) => e.id)).toEqual(["technology.artifact.secret-old"]);
    expect(technology.summary.elements_not_checked).toBe(3);
    expect(dataStore.buckets.in_model_only.map((e) => e.id)).toEqual(["data-store.collection.legacy"]);
    expect(dataStore.summary.elements_not_checked).toBe(1);
  });

  it("honours recorded not-an-element decisions and the verify ignore file", async () => {
    await add("technology", "node", "Service db", { nodeType: "container" }, "compose.yml", "Service/db");
    await add("technology", "artifact", "postgres", { artifactType: "container-image" });
    await add("technology", "node", "Deployment api", { nodeType: "container" }, "k8s/api.yml", "Deployment/api");
    await add("technology", "node", "Deployment worker", { nodeType: "container" }, "k8s/api.yml", "Deployment/worker");

    const [technology] = await verify(["technology"], new Map(), {
      notElements: new Set(["k8s/web.yml#Service/web"]),
      ignoreRules: [
        { patterns: [{ handler: "Secret/*" }], reason: "secrets are modelled by hand", match: "graph_only" },
        { patterns: [], element_ids: ["technology.node.deployment-worker"], reason: "being retired", match: "model_only" },
      ],
    });
    // Decided not an element: not in the code only.
    expect(technology.buckets.in_graph_only.map((e) => e.id)).toEqual([]);
    expect(technology.buckets.in_model_only.map((e) => e.id)).toEqual(["technology.node.deployment-api"]);
    expect(technology.buckets.ignored!.map((e) => [e.id, e.reason]).sort()).toEqual([
      ["technology.artifact.secret-creds", "secrets are modelled by hand"],
      ["technology.node.deployment-worker", "being retired"],
    ]);
    expect(technology.summary).toMatchObject({ gap_count: 0, drift_count: 1, ignored_count: 2 });
  });

  it("reports a layer whose check fails as not verified, and keeps the other layers' results", async () => {
    await add("testing", "testcasesketch", "OwnerTests testShowOwner", { status: "automated" }, TEST_FILE, "OwnerTests.testShowOwner");
    const graph = fakeGraph();
    const failing: CardGraph = {
      ...graph,
      search: async (label, filePattern, fields) => {
        if (label === "Table") throw new Error("search_graph timed out");
        return graph.search(label, filePattern, fields);
      },
    };
    const result = await verifyResult(["data-store", "technology", "testing"], new Map(), { graph: failing });
    expect(result.notVerified).toEqual([
      { layer: "data-store", reason: "search_graph timed out" },
      { layer: "technology", reason: "search_graph timed out" },
    ]);
    expect(result.reports.map((r) => r.layer)).toEqual(["testing"]);
    expect(result.reports[0].buckets.matched.map((e) => e.id)).toEqual(["testing.testcasesketch.owner-tests-test-show-owner"]);
  });

  it("checks test cases and the tests relationships of the ones that match", async () => {
    await add("application", "applicationfunction", "OwnerController showOwner", {}, CONTROLLER_FILE, "OwnerController.showOwner");
    await add("application", "applicationfunction", "VetController list", {}, "src/vet/VetController.java", "VetController.list");
    await add("testing", "testcasesketch", "OwnerTests testShowOwner", { status: "automated" }, TEST_FILE, "OwnerTests.testShowOwner");
    await add("testing", "testcasesketch", "OwnerTests testGone", { status: "automated" }, TEST_FILE, "OwnerTests.testGone");
    // A TypeScript test case: extraction never cards it, so it can't be checked.
    await add("testing", "testcasesketch", "renders the list", { status: "automated" }, "web/list.test.ts", "renders the list");
    const sketch = "testing.testcasesketch.owner-tests-test-show-owner";
    const rel = await relationshipAddHandler({
      rootPath,
      relationships: [
        { source: sketch, predicate: "tests", target: "application.applicationfunction.owner-controller-show-owner" },
        { source: sketch, predicate: "tests", target: "application.applicationfunction.vet-controller-list" },
      ],
    } as any);
    expect(rel.isError).toBeFalsy();

    const [testing] = await verify(["testing"]);
    expect(testing.buckets.matched.map((e) => e.id)).toEqual([sketch]);
    expect(testing.buckets.in_graph_only.map((e) => e.id)).toEqual(["testing.testcasesketch.owner-tests-test-create"]);
    expect(testing.buckets.in_model_only.map((e) => e.id)).toEqual(["testing.testcasesketch.owner-tests-test-gone"]);
    expect(testing.summary.elements_not_checked).toBe(1);
    expect(testing.relationships!.matched).toEqual([
      { source: sketch, predicate: "tests", target: "application.applicationfunction.owner-controller-show-owner", edge: "TESTS" },
    ]);
    expect(testing.relationships!.in_model_only).toEqual([{ source: sketch, predicate: "tests", target: "application.applicationfunction.vet-controller-list" }]);
    expect(testing.summary.relationships).toEqual({ matched_count: 1, gap_count: 0, drift_count: 1 });
  });
});

describe("readRecordedDecisions (#1107 review)", () => {
  it("keeps an unstaged decision only while codebase_extract would: its changeset staged, or landed for a relationship", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dr-decisions-"));
    try {
      await mkdir(join(dir, ".dr", "analyzers", "extract"), { recursive: true });
      const d = (how: string, changesetId?: string) => ({ how, reason: "r", decidedAt: "2026-11-12T00:00:00.000Z", ...(changesetId ? { changesetId } : {}) });
      await writeFile(
        join(dir, ".dr", "analyzers", "extract", "decisions.json"),
        JSON.stringify({
          notElements: {
            "a.ts#rejected": d("rejected"),
            "a.ts#staged": d("unstaged", "cs-staged"),
            "a.ts#landed": d("unstaged", "cs-landed"),
            "a.ts#gone": d("unstaged", "cs-gone"),
          },
          notRelationships: {
            "x::uses::y": d("rejected"),
            "x::uses::staged": d("unstaged", "cs-staged"),
            "x::uses::landed": d("unstaged", "cs-landed"),
            "x::uses::gone": d("unstaged", "cs-gone"),
          },
        })
      );
      const changesets = [
        { id: "cs-staged", status: "staged" },
        { id: "cs-landed", status: "committed" },
      ];
      const pruned = await readRecordedDecisions(dir, changesets);
      expect([...pruned.notElements].sort()).toEqual(["a.ts#rejected", "a.ts#staged"]);
      expect([...pruned.notRelationships].sort()).toEqual(["x::uses::landed", "x::uses::staged", "x::uses::y"]);
      // Without the changesets, every recorded decision is kept.
      expect((await readRecordedDecisions(dir)).notElements.size).toBe(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("normalizeIndexCoverage", () => {
  it("names the files the graph doesn't fully cover, and why", () => {
    const raw = {
      paths: [
        { requested_path: "src/a.ts", status: "no_recorded_issue", freshness: "metadata_match", coverage: [] },
        { requested_path: "static/logo.png", status: "excluded", freshness: "not_tracked", coverage: [{ kind: "not_indexed_file", detail: "ignored-suffix" }] },
        { requested_path: "db/schema.sql", status: "partial", freshness: "metadata_match", coverage: [{ kind: "parse_partial" }] },
        { requested_path: "src/new.ts", status: "no_recorded_issue", freshness: "not_tracked", coverage: [] },
        { requested_path: "src/gone.ts", status: "no_recorded_issue", freshness: "missing", coverage: [] },
      ],
    };
    expect([...normalizeIndexCoverage(raw)]).toEqual([
      ["static/logo.png", "the analyzer does not index it (ignored-suffix)"],
      ["db/schema.sql", "the analyzer parsed it only in part"],
      ["src/new.ts", "the index has no record of it"],
    ]);
    expect(normalizeIndexCoverage("not json").size).toBe(0);
  });
});
