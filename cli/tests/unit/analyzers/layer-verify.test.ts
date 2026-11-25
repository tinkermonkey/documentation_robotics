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
import { LAYER_CHECKS, readRecordedDecisions, rejectionsApplied, rulesApplied, verifyLayers, type LayerVerifyInput } from "../../../src/analyzers/layer-verify.js";
import { compileRules } from "../../../src/analyzers/project-rules.js";
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

/** The graph: a SQL table, compose and Kubernetes objects, an image, and a JUnit test class (and `extra` nodes). */
function fakeGraph(extra: FakeNode[] = []): CardGraph {
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
  nodes.push(...extra);
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
    // What a recorded rejection or a rule covers is listed with why, never dropped unseen.
    expect(technology.buckets.ignored!.map((e) => [e.id, e.reason]).sort()).toEqual([
      ["k8s/web.yml#Service/web", "recorded as not an element (codebase_extract reject)"],
      ["technology.artifact.secret-creds", "secrets are modelled by hand"],
      ["technology.node.deployment-worker", "being retired"],
    ]);
    expect(technology.summary).toMatchObject({ gap_count: 0, drift_count: 1, ignored_count: 3 });
    // The report says which decisions it had, and how many each layer applied.
    const applied = rejectionsApplied(
      { notElements: new Set(["k8s/web.yml#Service/web"]), notRelationships: new Set(), file: ".dr/analyzers/extract/decisions.json", found: true },
      [technology]
    );
    expect(applied).toMatchObject({ found: true, recorded: { elements: 1, relationships: 0 }, applied: { technology: 1 } });
    expect(applied.note).toContain("1 recorded rejection(s) were read and 1 kept an entry out");
    expect(applied.note).toContain("is not in git");
  });

  it("applies the project's kept rules as codebase_extract does, listing what they leave out under ignored (#1414)", async () => {
    // A program the code launches: Tier 0 decides it system software, whose softwareType the code can't give.
    const graph = fakeGraph([{ label: "Process", name: "git", qualified_name: "__process__git", file_path: "scripts/release.sh" } as FakeNode]);
    const plain = await verify(["technology"], new Map(), { graph });
    const inCode = (r: (typeof plain)[number]) => r.buckets.in_graph_only.map((e) => e.id).sort();
    const before = inCode(plain[0]);
    expect(before).toEqual(expect.arrayContaining(["technology.systemsoftware.git", "technology.technologyservice.service-web", "technology.artifact.secret-creds"]));

    // A kept rule over the launched programs (as #1414's), and one over the Kubernetes folder.
    const rules = compileRules([
      { name: "launched-processes-modelled-by-hand", where: { label: "Process" }, as: "none", reason: "modelled by hand" },
      { name: "k8s-not-ours", where: { files: "k8s/" }, as: "none", reason: "another team's manifests" },
    ]);
    const [technology] = await verify(["technology"], new Map(), { graph, rules });
    const ignored = (technology.buckets.ignored ?? []).map((e) => [e.id, e.reason]);
    const ruleReason = (rule: string, why: string) => `a kept rule in documentation-robotics/extraction-rules.yaml says it is not an element (${rule}: ${why})`;
    // What Tier 0 decided and can stage (the Secret, a configuration artifact) stays in the code only without overrideTier0.
    expect(inCode(technology)).toContain("technology.artifact.secret-creds");
    // What Tier 0 decided but can't stage (system software and a technology service need attributes the
    // code doesn't give: needs-attributes cards to codebase_extract) is the rule's, as extraction decides it.
    expect(inCode(technology)).not.toContain("technology.systemsoftware.git");
    expect(inCode(technology)).not.toContain("technology.technologyservice.service-web");
    expect(ignored).toContainEqual(["scripts/release.sh#git", ruleReason("launched-processes-modelled-by-hand", "modelled by hand")]);
    expect(ignored).toContainEqual(["k8s/web.yml#Service/web", ruleReason("k8s-not-ours", "another team's manifests")]);

    // With overrideTier0 the k8s rule takes what Tier 0 decided and can stage there too.
    const overriding = compileRules([{ name: "k8s-not-ours", where: { files: "k8s/" }, as: "none", reason: "another team's manifests", overrideTier0: true }]);
    const [taken] = await verify(["technology"], new Map(), { graph, rules: overriding });
    expect(inCode(taken)).not.toContain("technology.artifact.secret-creds");
    expect((taken.buckets.ignored ?? []).map((e) => e.reason)).toContain(
      "a kept rule in documentation-robotics/extraction-rules.yaml says it is not an element (k8s-not-ours: another team's manifests)"
    );
    // The kept rule without overrideTier0 left what Tier 0 can stage in the code only: counted, with what to add.
    const result = await verifyResult(["technology"], new Map(), { graph, rules });
    expect(result.tier0Kept).toEqual({ "k8s-not-ours": 1 });
    const warned = rulesApplied(2, result.reports, undefined, result.tier0Kept);
    expect(warned.tier0Kept).toEqual({ "k8s-not-ours": 1 });
    expect(warned.warnings).toEqual([
      expect.stringContaining(
        "To keep rejecting these 1 symbol(s), add overrideTier0: true to rule 'k8s-not-ours' in documentation-robotics/extraction-rules.yaml"
      ),
    ]);
    // The report says how many rules it read and how many entries each layer left out because of one.
    const applied = rulesApplied(1, [taken]);
    expect(applied.applied.technology).toBeGreaterThan(0);
    expect(applied.note).toContain("1 kept rule(s) were applied");
    expect(rulesApplied(0, [], "the file is not valid YAML").note).toContain("No kept rule was applied");
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

describe("layer status: checked and in step, checked and drifted, or not checked (#1180)", () => {
  it("says not checked, with why, when nothing in the layer could be compared", async () => {
    // A frontend's stores: a key-value store and files, none of them SQL.
    await add("data-store", "collection", "auth token", { collectionType: "COLLECTION" }, "src/stores/authStore.ts", "authStore");
    await add("data-store", "collection", "layer files", { collectionType: "COLLECTION" }, "model/manifest.yaml");
    await add("data-store", "collection", "notes", { collectionType: "COLLECTION" });

    const graph = fakeGraph();
    const noTables: CardGraph = { ...graph, search: async (label, filePattern, fields) => (label === "Table" ? [] : graph.search(label, filePattern, fields)) };
    const [dataStore] = await verify(["data-store"], new Map(), { graph: noTables });
    expect(dataStore.status).toBe("not_checked");
    expect(dataStore.status_text).toContain("none of the model's 3 data-store collections could be compared");
    expect(dataStore.coverage).toEqual({ model_elements: 3, checked: 0, not_checked: 3, code_entries: 0 });
    // Every element that was not compared is listed under a reason, with what would make it checkable.
    expect(dataStore.not_checked!.map((g) => [g.count, g.ids])).toEqual([
      [2, ["data-store.collection.auth-token", "data-store.collection.layer-files"]],
      [1, ["data-store.collection.notes"]],
    ]);
    expect(dataStore.not_checked![0].reason).toContain("this check reads SQL tables only");
    expect(dataStore.not_checked![0].to_check).toContain("nothing to change when the store is not SQL");
    expect(dataStore.not_checked![1].reason).toContain("no source reference");
  });

  it("says the technology layer was not checked when none of its elements is where the check reads", async () => {
    // A frontend's technology layer, modelled by hand: nothing in a compose file or a manifest.
    await add("technology", "systemsoftware", "Node", { softwareType: "middleware" }, ".nvmrc");
    await add("technology", "node", "CDN", { nodeType: "container" }, "docs/hosting.md", "CDN");
    await add("technology", "artifact", "Bundle", { artifactType: "configuration" });
    const graph = fakeGraph();
    const noInfra: CardGraph = { ...graph, search: async () => [] };
    const [technology] = await verify(["technology"], new Map(), { graph: noInfra });
    expect(technology.status).toBe("not_checked");
    expect(technology.status_text).toContain("none of the model's 3 technology nodes, services, artifacts and system software could be compared");
    expect(technology.coverage).toEqual({ model_elements: 3, checked: 0, not_checked: 3, code_entries: 0 });
    const reasons = Object.fromEntries(technology.not_checked!.map((g) => [g.ids[0], g]));
    expect(reasons["technology.systemsoftware.node"].reason).toContain("not a dependency manifest");
    expect(reasons["technology.systemsoftware.node"].to_check).toContain("dependencies.<name>");
    expect(reasons["technology.node.cdn"].reason).toContain("not a compose file or a Kubernetes manifest");
    expect(reasons["technology.artifact.bundle"].reason).toContain("no source reference");
    // Nothing is in the model only: an element the check can't read is not drift.
    expect(technology.buckets.in_model_only).toEqual([]);
  });

  it("says the testing layer was not checked when no sketch is in a test file the check read", async () => {
    await add("testing", "testcasesketch", "manual smoke test", { status: "automated" });
    await add("testing", "testcasesketch", "checkout flow", { status: "automated" }, "docs/test-plan.md", "checkout flow");
    // A TypeScript test file the analyzer has no module for: its cases were not read.
    await add("testing", "testcasesketch", "renders the list", { status: "automated" }, "web/list.test.ts", "list > renders the list");
    const graph = fakeGraph();
    const noTests: CardGraph = {
      ...graph,
      search: async () => [],
      rows: async (cypher) => (/^MATCH \(f:File\)/.test(cypher) ? [] : graph.rows(cypher)),
    };
    const [testing] = await verify(["testing"], new Map(), { graph: noTests });
    expect(testing.status).toBe("not_checked");
    expect(testing.coverage).toEqual({ model_elements: 3, checked: 0, not_checked: 3, code_entries: 0 });
    expect(testing.status_text).toContain("none of the model's 3 test case sketches could be compared");
    const why = testing.not_checked!.map((g) => [g.ids, g.reason] as const);
    expect(why.find(([ids]) => ids.includes("testing.testcasesketch.manual-smoke-test"))![1]).toContain("no source reference");
    expect(why.find(([ids]) => ids.includes("testing.testcasesketch.checkout-flow"))![1]).toContain("not a test file by its path");
    // The file is a test file by its path, but its cases were not read: said, not reported as drift.
    expect(why.find(([ids]) => ids.includes("testing.testcasesketch.renders-the-list"))![1]).toContain("JavaScript and TypeScript test cases");
    expect(testing.buckets.in_model_only).toEqual([]);
  });

  it("says in step only by an ignore rule when what differs is covered by one", async () => {
    await add("data-store", "collection", "owners", { collectionType: "TABLE" }, "db/h2/schema.sql", "owners");
    await add("data-store", "collection", "legacy", { collectionType: "TABLE" }, "db/h2/schema.sql", "legacy");
    const [dataStore] = await verify(["data-store"], new Map(), {
      ignoreRules: [{ patterns: [], element_ids: ["data-store.collection.legacy"], reason: "being retired", match: "model_only" }],
    });
    expect(dataStore.status).toBe("in_step");
    expect(dataStore.status_text).toBe(
      "Checked 2 of the model's 2 data-store collections: in step with the code, apart from 1 in the model only that an ignore rule covers."
    );
  });

  it("says not checked when the model and the code both have nothing, naming what the check reads", async () => {
    const graph = fakeGraph();
    const empty: CardGraph = { ...graph, search: async () => [] };
    const [dataStore] = await verify(["data-store"], new Map(), { graph: empty });
    expect(dataStore.status).toBe("not_checked");
    expect(dataStore.status_text).toContain("nothing to compare");
    expect(dataStore.status_text).toContain("CREATE TABLE statements in .sql files");
    expect(dataStore.not_checked).toBeUndefined();
  });

  it("says in step only for what it compared, and counts the rest as not checked", async () => {
    await add("data-store", "collection", "owners", { collectionType: "TABLE" }, "db/h2/schema.sql", "owners");
    await add("data-store", "collection", "pets", { collectionType: "TABLE" }, "src/Pet.java", "Pet");
    const [dataStore] = await verify(["data-store"]);
    expect(dataStore.status).toBe("in_step");
    expect(dataStore.status_text).toContain("Checked 1 of the model's 2 data-store collections: in step");
    expect(dataStore.status_text).toContain("1 of the model's 2 data-store collections could not be checked");
    expect(dataStore.coverage).toEqual({ model_elements: 2, checked: 1, not_checked: 1, code_entries: 1 });
  });

  it("says drifted when the code has what the model lacks, even with no model element of the layer", async () => {
    const [technology] = await verify(["technology"]);
    expect(technology.status).toBe("drifted");
    expect(technology.status_text).toContain("the model has no technology nodes, services, artifacts and system software");
    expect(technology.coverage.code_entries).toBe(technology.buckets.in_graph_only.length);
  });

  it("lists every entry of a long bucket: the report itself is never cut (the tool pages it)", async () => {
    const graph = fakeGraph();
    const tables = Array.from({ length: 230 }, (_, i) => ({
      label: "Table",
      name: `t_${i}`,
      qualified_name: `${P}.db.big.schema.t_${i}`,
      file_path: "db/big/schema.sql",
      start_line: i * 3 + 1,
      end_line: i * 3 + 3,
    }));
    const manyTables: CardGraph = { ...graph, search: async (label, filePattern, fields) => (label === "Table" ? (tables as any) : graph.search(label, filePattern, fields)) };
    const [dataStore] = await verify(["data-store"], new Map(), { graph: manyTables });
    expect(dataStore.buckets.in_graph_only).toHaveLength(230);
    expect(dataStore.summary.gap_count).toBe(230);
    expect(dataStore.coverage.code_entries).toBe(230);
    expect((dataStore as any).omitted).toBeUndefined();
  });

  it("checks system software sourced to a dependency manifest against what the manifest lists", async () => {
    await add("technology", "systemsoftware", "React", { softwareType: "middleware" }, "package.json", "dependencies.react");
    await add("technology", "systemsoftware", "Router", { softwareType: "middleware" }, "package.json", "dependencies.@tanstack/react-router");
    await add("technology", "systemsoftware", "Vite", { softwareType: "middleware" }, "package.json", "devDependencies.vite");
    await add("technology", "systemsoftware", "Zustand", { softwareType: "middleware" }, "package.json", "dependencies.zustand");
    await add("technology", "systemsoftware", "Requests", { softwareType: "middleware" }, "requirements.txt", "requests");
    await add("technology", "systemsoftware", "Node", { softwareType: "middleware" }, "package.json");
    await add("technology", "systemsoftware", "Bash", { softwareType: "middleware" }, "scripts/run.yml", "bash");
    const manifest = JSON.stringify({
      name: "viewer",
      dependencies: { react: "^19.0.0", "@tanstack/react-router": "^1.0.0" },
      devDependencies: { vite: "^6.0.0" },
    });
    const graph = fakeGraph();
    const noInfra: CardGraph = { ...graph, search: async () => [] };
    const [technology] = await verify(["technology"], new Map(), {
      graph: noInfra,
      fileText: (file) => (file === "package.json" ? manifest : file === "requirements.txt" ? "flask==3.0\nrequests>=2.31\n" : null),
    });
    expect(technology.buckets.matched.map((e) => e.id).sort()).toEqual([
      "technology.systemsoftware.react",
      "technology.systemsoftware.requests",
      "technology.systemsoftware.router",
      "technology.systemsoftware.vite",
    ]);
    expect(technology.buckets.in_model_only.map((e) => [e.id, e.reason])).toEqual([
      ["technology.systemsoftware.zustand", "package.json doesn't list it any more"],
    ]);
    expect(technology.status).toBe("drifted");
    // No symbol to look for, and a file that is no manifest: not checked, each with its reason.
    expect(technology.not_checked!.map((g) => g.ids)).toEqual([["technology.systemsoftware.node"], ["technology.systemsoftware.bash"]]);
    expect(technology.not_checked![0].to_check).toContain("dependencies.<name>");
    expect(technology.coverage).toEqual({ model_elements: 7, checked: 5, not_checked: 2, code_entries: 4 });
  });

  it("compares the it() / test() cases of a JavaScript or TypeScript test file with the model's", async () => {
    const file = "web/list.test.ts";
    await mkdir(join(rootPath, "web"), { recursive: true });
    await writeFile(
      join(rootPath, file),
      'import { describe, it, expect } from "vitest";\n' +
        'describe("list", () => {\n' +
        '  it("renders the list", () => {\n    expect(1).toBe(1);\n  });\n' +
        '  it("sorts by name", () => {\n    expect(2).toBe(2);\n  });\n' +
        "});\n"
    );
    await add("testing", "testcasesketch", "list renders the list", { status: "automated" }, file, "list > renders the list");
    await add("testing", "testcasesketch", "list filters", { status: "automated" }, file, "list > filters");

    const graph = fakeGraph();
    const withTestFile: CardGraph = {
      ...graph,
      rows: async (cypher) => {
        if (/^MATCH \(m:Module\) RETURN m\.file_path, m\.qualified_name, m\.is_test$/.test(cypher)) return [[file, `${P}.web.list.test`, "true"]];
        if (/^MATCH \(f:File\) RETURN f\.file_path$/.test(cypher)) return [...(await graph.rows(cypher)), [file]];
        return graph.rows(cypher);
      },
    };
    const [testing] = await verify(["testing"], new Map(), { graph: withTestFile });
    // Before: no JS/TS case was read, so every one of these was "not checked" and the layer read empty.
    expect(testing.buckets.matched.map((e) => e.id)).toEqual(["testing.testcasesketch.list-renders-the-list"]);
    expect(testing.buckets.in_model_only.map((e) => e.id)).toEqual(["testing.testcasesketch.list-filters"]);
    expect(testing.buckets.in_graph_only.map((e) => e.name)).toContain("list > sorts by name");
    expect(testing.summary.elements_not_checked).toBe(0);
    expect(testing.status).toBe("drifted");
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
      expect(pruned).toMatchObject({ file: join(".dr", "analyzers", "extract", "decisions.json"), found: true });
      expect(pruned.error).toBeUndefined();

      // No file: nothing recorded here, and that is said, not an error.
      const none = await readRecordedDecisions(join(dir, "elsewhere"));
      expect(none).toMatchObject({ found: false });
      expect(none.error).toBeUndefined();
      expect(rejectionsApplied(none, []).note).toContain("This checkout has no recorded rejections");

      // A file that can't be parsed is an error the report carries: no decision was applied.
      await writeFile(join(dir, ".dr", "analyzers", "extract", "decisions.json"), "{ not json");
      const broken = await readRecordedDecisions(dir);
      expect(broken.found).toBe(true);
      expect(broken.notElements.size).toBe(0);
      expect(broken.error).toContain("is not valid JSON, so no recorded rejection was applied");
      expect(rejectionsApplied(broken, []).note).toContain("No recorded rejection was applied");
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
