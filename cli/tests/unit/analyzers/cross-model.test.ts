/**
 * Federated extraction (src/analyzers/cross-model.ts): codebase-memory-mcp's CROSS_* edges as
 * cross-model references. The CBM shapes below are the ones CBM 0.12.1 wrote for three fixture
 * repositories (docs/analyzers/CBM_MAPPING_INVENTORY.md, "Cross-repository edges"); CBM itself is
 * not needed: the graph is faked, the cards, Tier 0, plan and staging are the real code.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { changesetCreateHandler, changesetDeactivateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetVerifyHandler } from "../../../src/mcp/tools/changeset-verify.js";
import { createCodebaseExtractHandler } from "../../../src/mcp/tools/codebase-extract.js";
import { createCodebaseIndexHandler } from "../../../src/mcp/tools/codebase-index.js";
import type { CodebaseToolDeps } from "../../../src/mcp/tools/codebase-shared.js";
import { writeIndexMeta, writeSession } from "../../../src/analyzers/session-state.js";
import type { SpawnFn } from "../../../src/analyzers/index-job.js";
import type { AnalyzerBackend } from "../../../src/analyzers/base-analyzer.js";
import { collectExtraction, extractionConfigFrom, type CrossEdge, type ExtractionGraph } from "../../../src/analyzers/cards/extract.js";
import type { ChangesetGraph } from "../../../src/core/changeset-graph.js";
import { catalogHasTriple } from "../../../src/core/extraction-observability.js";
import type { CardGraph, GraphNode } from "../../../src/analyzers/cards/types.js";
import { tier0RulesFrom } from "../../../src/analyzers/tier0-rules.js";
import type { AnalyzerHeuristic } from "../../../src/analyzers/types.js";
import {
  attachTargetRoutes,
  bundledPredicateInverse,
  CROSS_REPO_RERUN_HINT,
  crossRepoConfigPath,
  declaredTargets,
  handlerRoutes,
  indexExternalModel,
  linkCrossRepoTargets,
  loadCrossRepoConfig,
  normalizeGitUrl,
  planCrossModelReferences,
  readCrossRepoConfig,
  resolveTargetModel,
  runCrossRepoPass,
  skippedCrossRepoRun,
  staleCrossRepoTargets,
  urlPathOnly,
  writeCrossRepoConfig,
  type CrossRepoRun,
  type CrossRepoTools,
  type GitReader,
} from "../../../src/analyzers/cross-model.js";
import { CbmTools } from "../../../src/analyzers/cbm-responses.js";

const HEAD = "1111111111111111111111111111111111111111";
const META = { git_head: HEAD, timestamp: "2026-11-12T12:00:00.000Z", node_count: 40, edge_count: 60 };
const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../spec/dist/analyzers/cbm.json"), "utf-8"));
const CONFIG = extractionConfigFrom(
  tier0RulesFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]),
  Object.values(CBM.edges_by_type),
  Object.values(CBM.nodes_by_label)
);

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

// ---------------------------------------------------------------------------
// The calling repository (svc-shipping) as CBM 0.12.1 indexes it after a cross-repo pass
// ---------------------------------------------------------------------------

const P = "xr-svc-shipping";
const ORDERS = "xr-svc-orders";
const WEB = "xr-web-client";
const MAIN = "app/main.py";
const EVENTS = "app/events.py";
const TESTS = "tests/test_shipping.py";
const CLIENT_ROUTE = "__route__GET__http://svc-orders:8000/api/orders/{}";
const SERVED_ROUTE = "__route__POST__/api/shipments";

interface FakeEdge {
  type: string;
  from: string;
  to: string;
  props?: Record<string, string>;
}

function shippingNodes(): GraphNode[] {
  return [
    { label: "Function", name: "fetch_order", qualified_name: `${P}.app.main.fetch_order`, file_path: MAIN, start_line: 8, end_line: 11 },
    { label: "Function", name: "create_shipment", qualified_name: `${P}.app.main.create_shipment`, file_path: MAIN, start_line: 14, end_line: 16, decorators: ['@app.post("/api/shipments")'] },
    { label: "Function", name: "test_fetch_order", qualified_name: `${P}.tests.test_shipping.test_fetch_order`, file_path: TESTS, start_line: 3, end_line: 6 },
    { label: "Route", name: CLIENT_ROUTE, qualified_name: CLIENT_ROUTE, file_path: "", method: "GET" },
    { label: "Route", name: SERVED_ROUTE, qualified_name: SERVED_ROUTE, file_path: "", method: "POST" },
  ] as GraphNode[];
}

/** The CROSS_* edges, with the properties CBM 0.12.1 sets. */
function shippingEdges(): FakeEdge[] {
  const orders = { target_project: ORDERS, target_function: "get_order", target_file: MAIN, url_path: "http://svc-orders:8000/api/orders/{}", transport: "GET" };
  return [
    { type: "HTTP_CALLS", from: `${P}.app.main.fetch_order`, to: CLIENT_ROUTE },
    { type: "HTTP_CALLS", from: `${P}.tests.test_shipping.test_fetch_order`, to: CLIENT_ROUTE },
    { type: "HANDLES", from: `${P}.app.main.create_shipment`, to: SERVED_ROUTE },
    { type: "CROSS_HTTP_CALLS", from: `${P}.app.main.fetch_order`, to: CLIENT_ROUTE, props: orders },
    { type: "CROSS_HTTP_CALLS", from: `${P}.tests.test_shipping.test_fetch_order`, to: CLIENT_ROUTE, props: orders },
    // The serving side's copy: the handler, pointing back at a caller in the web client.
    {
      type: "CROSS_HTTP_CALLS",
      from: `${P}.app.main.create_shipment`,
      to: SERVED_ROUTE,
      props: { target_project: WEB, target_function: "ship", target_file: "src/ship.ts", url_path: "/api/shipments" },
    },
    // A socket.io event: from the file, to this project's Channel.
    {
      type: "CROSS_CHANNEL",
      from: `${P}.app.events.py.__file__`,
      to: "__channel__socketio__order-shipped",
      props: { target_project: WEB, target_function: "live.ts", target_file: "src/live.ts", url_path: "", transport: "socketio" },
    },
  ];
}

interface Fake {
  nodes: GraphNode[];
  edges: FakeEdge[];
  queries: string[];
}

function fakeGraph(fake: Fake): CardGraph {
  const byQn = new Map(fake.nodes.map((n) => [n.qualified_name, n]));
  return {
    project: P,
    async search(label, filePattern) {
      return fake.nodes.filter((n) => n.label === label && (!filePattern || n.file_path === filePattern));
    },
    async rows(cypher) {
      fake.queries.push(cypher);
      const cross = /^MATCH \(a\)-\[r:(CROSS_\w+)\]->\(b\) RETURN a\.qualified_name, a\.file_path, a\.name, a\.label, b\.qualified_name, b\.name, r\.target_project/.exec(cypher);
      if (cross) {
        return fake.edges
          .filter((e) => e.type === cross[1])
          .map((e) => {
            const a = byQn.get(e.from);
            const p = e.props ?? {};
            const file = a?.file_path ?? (e.from.includes("events.py") ? EVENTS : "");
            return [e.from, file, a?.name ?? e.from, a?.label ?? "File", e.to, e.to, p.target_project, p.target_function, p.target_file, p.url_path ?? "", p.transport ?? ""];
          });
      }
      const edgeRead = /^MATCH \(a\)-\[r:(\w+)\]->\(b\) RETURN a\.qualified_name, a\.file_path, a\.name/.exec(cypher);
      if (edgeRead) {
        return fake.edges
          .filter((e) => e.type === edgeRead[1])
          .map((e) => [e.from, byQn.get(e.from)?.file_path ?? "", byQn.get(e.from)?.name ?? e.from, e.to, byQn.get(e.to)?.file_path ?? "", byQn.get(e.to)?.name ?? e.to]);
      }
      if (/HANDLES\]->\(x:Route\)/.test(cypher)) return fake.edges.filter((e) => e.type === "HANDLES").map((e) => [e.from, e.to]);
      if (/-\[r\]->\(x:Route\)/.test(cypher)) {
        return fake.edges.filter((e) => e.type === "HANDLES" || e.type === "HTTP_CALLS").map((e) => [e.from, byQn.get(e.from)?.file_path ?? "", e.to]);
      }
      if (/MATCH \(a:Function\)/.test(cypher)) return fake.nodes.filter((n) => n.label === "Function").map((n) => [n.qualified_name, n.file_path]);
      return [];
    },
    async snippet(qn) {
      return byQn.has(qn) ? { source: `def ${byQn.get(qn)!.name}():\n    pass` } : null;
    },
  };
}

/** svc-orders' handlers, as `MATCH (f)-[:HANDLES]->(r:Route) RETURN f.name, f.file_path, r.qualified_name, r.name` returns them. */
const ORDERS_HANDLERS: unknown[][] = [
  ["create_order", MAIN, "__route__POST__/api/orders", "/api/orders"],
  ["get_order", MAIN, "__route__GET__/api/orders/{}", "/api/orders/{order_id}"],
];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let rootPath: string;
let ordersRoot: string;

async function tempDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return realpath(dir);
}

beforeEach(async () => {
  clearModelCache();
  rootPath = await tempDir("dr-xr-shipping");
  ordersRoot = await tempDir("dr-xr-orders");
  await Model.init(rootPath, { name: "Shipping", version: "0.1.0" });
  await declareModels({ "svc-orders": { url: "https://github.com/acme/svc-orders.git" } });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
  await rm(ordersRoot, { recursive: true, force: true });
});

async function declareModels(models: Record<string, { url?: string }>): Promise<void> {
  const file = join(rootPath, "documentation-robotics", "model", "manifest.yaml");
  const manifest = parseYAML(await readFile(file, "utf-8"));
  manifest.models = models;
  await writeFile(file, stringifyYAML(manifest));
  clearModelCache();
}

/** svc-orders' own DR model: the operation for GET /api/orders/{order_id} and its handler. */
async function ordersModel(): Promise<void> {
  await Model.init(ordersRoot, { name: "Orders", version: "0.1.0" });
  clearModelCache();
  ok(
    await modelAddHandler({
      rootPath: ordersRoot,
      layer: "api",
      type: "operation",
      name: "GET api orders order_id",
      attributes: { http_method: "GET", http_path: "/api/orders/{order_id}", operationId: "get-order", summary: "Get an order", tags: "orders" },
      sourceFile: MAIN,
      sourceSymbol: "GET /api/orders/{order_id}",
      sourceProvenance: "extracted",
    } as any)
  );
  ok(
    await modelAddHandler({
      rootPath: ordersRoot,
      layer: "application",
      type: "applicationfunction",
      name: "get order",
      sourceFile: MAIN,
      sourceSymbol: "get_order",
      sourceProvenance: "extracted",
    } as any)
  );
  clearModelCache();
}

async function indexed(): Promise<void> {
  await writeSession({ active_analyzer: "cbm", selected_at: new Date().toISOString() }, rootPath);
  await writeIndexMeta(META, rootPath, "cbm");
}

async function configure(): Promise<void> {
  await writeCrossRepoConfig(rootPath, "cbm", { version: 1, targets: [{ model: "svc-orders", codebase: ordersRoot }] });
}

function harness(): { deps: CodebaseToolDeps; fake: Fake } {
  const fake: Fake = { nodes: shippingNodes(), edges: shippingEdges(), queries: [] };
  const backend = {
    name: "cbm",
    detect: async () => ({ installed: true, binary_path: "/bin/cbm" }),
    // What CbmAnalyzer.extract adds to collectExtraction: the projects, and the target's routes.
    extract: async (_root: string, options: any) => {
      const extraction = await collectExtraction(fakeGraph(fake), CONFIG, "cbm", options);
      if (extraction.crossEdges) {
        extraction.crossProjects = { [P]: rootPath, [ORDERS]: ordersRoot, [WEB]: "/elsewhere/web-client" };
        attachTargetRoutes(extraction.crossEdges, ORDERS, handlerRoutes(ORDERS_HANDLERS));
      }
      return extraction;
    },
  } as unknown as AnalyzerBackend;
  const spawn: SpawnFn = () => Object.assign(new EventEmitter(), { pid: 60001, unref() {} }) as any;
  const deps: CodebaseToolDeps = {
    getAnalyzer: async (name) => (name === "cbm" ? backend : undefined),
    discover: async () => ({ found: [], selected: "cbm" }),
    spawn,
    drCommand: { command: "/usr/bin/node", args: ["/opt/dr/dist/cli.js"] },
    isAlive: () => true,
    gitHead: () => HEAD,
    codeChanges: async () => {
      throw new Error("no changes configured");
    },
  };
  return { deps, fake };
}

async function changesetOf(id: string) {
  clearModelCache();
  const model = await Model.load(rootPath);
  return (await new StagingAreaManager(rootPath, model).load(id))!;
}

const TEST_SKETCH = "testing.testcasesketch.test-fetch-order";
const FETCH = "application.applicationfunction.fetch-order";

// ---------------------------------------------------------------------------
// codebase_extract
// ---------------------------------------------------------------------------

describe("codebase_extract with cross-repo targets", () => {
  it("reads no cross-repository edge and says nothing about them without a configuration", async () => {
    await indexed();
    const { deps, fake } = harness();
    const result = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(result.crossModel).toBeUndefined();
    expect(fake.queries.some((q) => q.includes("CROSS_"))).toBe(false);
  });

  it("stages a verified reference from a test case to the other model's operation", async () => {
    await indexed();
    await ordersModel();
    await configure();
    const { deps } = harness();
    const result = ok(await createCodebaseExtractHandler(deps)({ rootPath }));

    expect(result.crossModel.staged).toBe(1);
    expect(result.crossModel.unverified).toBe(0);
    expect(result.crossModel.references.items).toEqual([
      { source: TEST_SKETCH, type: "tests", target: "@svc-orders/api.operation.get-api-orders-order-id", verified: true },
    ]);
    // The serving side's copy and the channel are left out, with why.
    const skipped = Object.keys(result.crossModel.skipped).join(" | ");
    expect(skipped).toContain("serving side");
    expect(skipped).toContain("CROSS_CHANNEL");
    // fetch_order is a card, not an element yet.
    expect(skipped).toContain("not an element");

    const changeset = await changesetOf(result.changeset.id);
    const add = changeset.changes.find((c) => c.type === "add" && c.elementId === TEST_SKETCH)!.after as any;
    expect(add.references).toHaveLength(1);
    expect(add.references[0]).toMatchObject({ source: TEST_SKETCH, target: "@svc-orders/api.operation.get-api-orders-order-id", type: "tests" });
    expect(add.references[0].description).toContain("Verified against @svc-orders's model");
    // A reference, never a relationship.
    expect(changeset.changes.filter((c) => c.type === "relationship-add").some((c) => c.elementId.includes("@"))).toBe(false);
  });

  it("references the handler with flows-to from application code, and stages nothing more on a re-run", async () => {
    await indexed();
    await ordersModel();
    await configure();
    ok(
      await modelAddHandler({
        rootPath,
        layer: "application",
        type: "applicationfunction",
        name: "fetch order",
        sourceFile: MAIN,
        sourceSymbol: "fetch_order",
        sourceProvenance: "extracted",
      } as any)
    );
    clearModelCache();
    const { deps } = harness();
    const handler = createCodebaseExtractHandler(deps);
    const result = ok(await handler({ rootPath }));

    const items = result.crossModel.references.items;
    // No catalog triple runs from an application function to api.operation: the handler instead.
    expect(items).toContainEqual({ source: FETCH, type: "flows-to", target: "@svc-orders/application.applicationfunction.get-order", verified: true });
    const update = (await changesetOf(result.changeset.id)).changes.find((c) => c.type === "update" && c.elementId === FETCH)!;
    expect((update.after as any).references).toEqual([
      expect.objectContaining({ source: FETCH, target: "@svc-orders/application.applicationfunction.get-order", type: "flows-to" }),
    ]);

    const again = ok(await handler({ rootPath }));
    expect(again.crossModel.staged).toBe(0);
    expect(again.crossModel.alreadyPresent).toBe(2);
  });

  it("stages the reference unverified when the other repository has no DR model, and says so", async () => {
    await indexed();
    await configure();
    const { deps } = harness();
    const result = ok(await createCodebaseExtractHandler(deps)({ rootPath }));

    expect(result.crossModel.unverified).toBe(1);
    // The id extraction gives the route in svc-orders, with the parameter name svc-orders' code uses.
    expect(result.crossModel.references.items).toEqual([
      { source: TEST_SKETCH, type: "tests", target: "@svc-orders/api.operation.get-api-orders-order-id", verified: false },
    ]);
    const add = (await changesetOf(result.changeset.id)).changes.find((c) => c.elementId === TEST_SKETCH)!.after as any;
    expect(add.references[0].description).toContain("Unverified: no DR model for @svc-orders was found");
  });

  it("lists, and does not stage, a route the other model has no element for", async () => {
    await indexed();
    await Model.init(ordersRoot, { name: "Orders", version: "0.1.0" });
    clearModelCache();
    await configure();
    const { deps } = harness();
    const result = ok(await createCodebaseExtractHandler(deps)({ rootPath }));

    expect(result.crossModel.staged).toBe(0);
    expect(result.crossModel.unresolved.items[0]).toMatchObject({
      source: TEST_SKETCH,
      model: "svc-orders",
      route: "GET /api/orders/{order_id}",
      candidate: "@svc-orders/api.operation.get-api-orders-order-id",
    });
    expect(result.crossModel.unresolved.items[0].reason).toContain("has no element");
  });

  it("records a reference-only update as extraction's, so verify doesn't credit it to the agent", async () => {
    await indexed();
    await ordersModel();
    await configure();
    ok(
      await modelAddHandler({
        rootPath,
        layer: "application",
        type: "applicationfunction",
        name: "fetch order",
        sourceFile: MAIN,
        sourceSymbol: "fetch_order",
        sourceProvenance: "extracted",
      } as any)
    );
    clearModelCache();
    // A plan that touches something else, set aside before the build is extracted.
    ok(await changesetCreateHandler({ name: "plan-shipping", rootPath } as any));
    ok(await modelUpdateHandler({ id: FETCH, description: "Fetches an order from svc-orders.", rootPath } as any));
    ok(await changesetDeactivateHandler({ rootPath } as any));
    clearModelCache();

    const { deps } = harness();
    const result = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    const update = (await changesetOf(result.changeset.id)).changes.find((c) => c.type === "update" && c.elementId === FETCH)!;
    // Only the references changed: no other update of FETCH is staged.
    const { references: _after, metadata: _m1, ...afterRest } = update.after as any;
    const { references: _before, metadata: _m2, ...beforeRest } = update.before as any;
    expect(afterRest).toEqual(beforeRest);

    const report = ok(await changesetVerifyHandler({ planned: "plan-shipping", against: { changesetId: result.changeset.id }, rootPath } as any));
    const agentAdded = (report.extraction.asBuilt.agentAdded ?? []).map((a: any) => a.id);
    expect(agentAdded).not.toContain(FETCH);
    expect(report.extraction.asBuilt.elements.agentAdded).toBe(0);
  });

  it("leaves out, and says so, a target whose model the manifest no longer declares", async () => {
    await indexed();
    await ordersModel();
    await configure();
    await declareModels({ payments: {} });
    const { deps, fake } = harness();
    const result = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(result.crossModel).toMatchObject({ staged: 0, undeclared: ["svc-orders"] });
    expect(result.crossModel.warnings.join(" ")).toContain("no longer declares");
    expect(fake.queries.some((q) => q.includes("CROSS_"))).toBe(false);
  });

  it("uses the declared spelling of a target's model", async () => {
    await indexed();
    await ordersModel();
    await configure();
    await declareModels({ "SVC-Orders": {} });
    const { deps } = harness();
    const result = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(result.crossModel.references.items[0].target).toBe("@SVC-Orders/api.operation.get-api-orders-order-id");
    expect(result.crossModel.undeclared).toBeUndefined();
  });

  it("warns about an unreadable cross-repo.json instead of silently turning federation off", async () => {
    await indexed();
    await mkdir(join(rootPath, ".dr", "analyzers", "cbm"), { recursive: true });
    await writeFile(crossRepoConfigPath(rootPath, "cbm"), "{ not json", "utf-8");
    await expect(readCrossRepoConfig(rootPath, "cbm")).rejects.toThrow("cross-repo.json is unreadable");
    expect((await loadCrossRepoConfig(rootPath, "cbm")).warning).toContain("call codebase_index with crossRepo to rewrite it");

    const { deps } = harness();
    const result = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(result.crossModel.warnings[0]).toContain("cross-repo.json is unreadable");
    const status = ok(await createCodebaseIndexHandler(deps)({ rootPath, status: true }));
    expect(status.crossRepo.warnings[0]).toContain("cross-repo.json is unreadable");
    // A missing file is no configuration, and no warning.
    await rm(crossRepoConfigPath(rootPath, "cbm"));
    expect(await loadCrossRepoConfig(rootPath, "cbm")).toEqual({ config: null });
  });

  it("review: a preview says what a run would about cross-repo.json and undeclared models", async () => {
    await indexed();
    await mkdir(join(rootPath, ".dr", "analyzers", "cbm"), { recursive: true });
    await writeFile(crossRepoConfigPath(rootPath, "cbm"), "{ not json", "utf-8");
    const { deps } = harness();
    const unreadable = ok(await createCodebaseExtractHandler(deps)({ rootPath, preview: true }));
    expect(unreadable.preview).toBe(true);
    expect(unreadable.crossModel.warnings[0]).toContain("cross-repo.json is unreadable");

    await configure();
    await declareModels({ payments: {} });
    const undeclared = ok(await createCodebaseExtractHandler(deps)({ rootPath, preview: true }));
    expect(undeclared.crossModel.undeclared).toEqual(["svc-orders"]);
    expect(undeclared.crossModel.warnings.join(" ")).toContain("no longer declares");
  });

  it("review: crossRepo: false removes an unreadable cross-repo.json", async () => {
    await indexed();
    await mkdir(join(rootPath, ".dr", "analyzers", "cbm"), { recursive: true });
    await writeFile(crossRepoConfigPath(rootPath, "cbm"), "{ not json", "utf-8");
    const { deps } = harness();
    deps.spawn = (() => Object.assign(new EventEmitter(), { pid: 60003, unref() {} }) as any) as SpawnFn;
    ok(await createCodebaseIndexHandler(deps)({ rootPath, crossRepo: false, force: true }));
    expect(existsSync(crossRepoConfigPath(rootPath, "cbm"))).toBe(false);
    expect(await loadCrossRepoConfig(rootPath, "cbm")).toEqual({ config: null });
  });

  it("reports the other model's layer files it could not parse", async () => {
    await indexed();
    await Model.init(ordersRoot, { name: "Orders", version: "0.1.0" });
    clearModelCache();
    const apiDir = join(ordersRoot, "documentation-robotics", "model", "07_api");
    await mkdir(apiDir, { recursive: true });
    await writeFile(join(apiDir, "operations.yaml"), "elements: [unclosed\n  - path: x\n", "utf-8");
    await configure();
    const { deps } = harness();
    const result = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(result.crossModel.unreadableModelFiles.items).toEqual([expect.objectContaining({ model: "svc-orders", file: "07_api/operations.yaml" })]);
    expect(result.crossModel.warnings.join(" ")).toContain("could not be parsed");
    expect(result.crossModel.unresolved.items[0].reason).toContain("could not read: 07_api/operations.yaml");
  });

  it("replaces an earlier run's unverified guess once the other model can verify it", async () => {
    await indexed();
    await configure();
    const { deps } = harness();
    const handler = createCodebaseExtractHandler(deps);
    const first = ok(await handler({ rootPath }));
    expect(first.crossModel.unverified).toBe(1);

    await ordersModel();
    const again = ok(await handler({ rootPath }));
    expect(again.crossModel).toMatchObject({ staged: 1, unverified: 0 });
    const add = (await changesetOf(again.changeset.id)).changes.find((c) => c.type === "add" && c.elementId === TEST_SKETCH)!.after as any;
    expect(add.references).toHaveLength(1);
    expect(add.references[0].description).toContain("Verified against @svc-orders's model");
  });

  it("counts calls into a CBM project that is not a configured target", async () => {
    await indexed();
    await ordersModel();
    await writeCrossRepoConfig(rootPath, "cbm", { version: 1, targets: [{ model: "svc-orders", codebase: "/somewhere/else" }] });
    const { deps } = harness();
    const result = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(result.crossModel.staged).toBe(0);
    expect(result.crossModel.unknownProjects).toEqual([ORDERS]);
  });
});

// ---------------------------------------------------------------------------
// codebase_index crossRepo
// ---------------------------------------------------------------------------

describe("codebase_index crossRepo", () => {
  it("records the targets by declared name, forces a run, and turns off with false", async () => {
    await indexed();
    const { deps } = harness();
    const spawned: string[][] = [];
    deps.spawn = ((_cmd: string, args: string[]) => {
      spawned.push(args);
      return Object.assign(new EventEmitter(), { pid: 60002, unref() {} }) as any;
    }) as SpawnFn;
    const index = createCodebaseIndexHandler(deps);

    const result = ok(await index({ rootPath, crossRepo: [{ codebase: ordersRoot, model: "SVC-ORDERS" }] }));
    expect(result.started).toBe(true);
    expect(spawned.at(-1)).toContain("--force");
    expect(result.crossRepo.targets).toEqual([{ model: "svc-orders", codebase: ordersRoot }]);
    expect((await readCrossRepoConfig(rootPath, "cbm"))!.targets).toEqual([{ model: "svc-orders", codebase: ordersRoot }]);

    ok(await index({ rootPath, crossRepo: false, force: true }));
    expect(existsSync(crossRepoConfigPath(rootPath, "cbm"))).toBe(false);
  });

  it("refuses an undeclared model, this codebase itself, and a missing directory", async () => {
    await indexed();
    const { deps } = harness();
    const index = createCodebaseIndexHandler(deps);
    expect(fail(await index({ rootPath, crossRepo: [{ codebase: ordersRoot, model: "payments" }] })).error).toContain("not declared");
    expect(fail(await index({ rootPath, crossRepo: [{ codebase: rootPath, model: "svc-orders" }] })).error).toContain("this codebase");
    expect(fail(await index({ rootPath, crossRepo: [{ codebase: join(ordersRoot, "nope"), model: "svc-orders" }] })).error).toContain("no directory");
    expect(existsSync(crossRepoConfigPath(rootPath, "cbm"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("cross-model helpers", () => {
  it("keeps the targets whose model is declared, in the declared spelling", () => {
    const targets = [
      { model: "svc-orders", codebase: "/a" },
      { model: "gone", codebase: "/b" },
    ];
    expect(declaredTargets(targets, { "SVC-Orders": {} })).toEqual({ targets: [{ model: "SVC-Orders", codebase: "/a" }], undeclared: ["gone"] });
    expect(declaredTargets(targets, undefined)).toEqual({ targets: [], undeclared: ["svc-orders", "gone"] });
  });

  it("normalizes git URLs so ssh, https and scp forms compare equal", () => {
    const want = "github.com/acme/svc-orders";
    expect(normalizeGitUrl("git@github.com:acme/svc-orders.git")).toBe(want);
    expect(normalizeGitUrl("https://user@GitHub.com/acme/svc-orders.git")).toBe(want);
    expect(normalizeGitUrl("ssh://git@github.com:22/acme/svc-orders")).toBe(want);
    expect(normalizeGitUrl("https://github.com/acme/svc-orders/")).toBe(want);
  });

  it("resolves a repository to the declared model by name or by url", () => {
    const models = { "svc-orders": { url: "https://github.com/acme/svc-orders.git" }, payments: {} };
    expect(resolveTargetModel(models, "/r", "Payments")).toBe("payments");
    expect(resolveTargetModel(models, "/r", undefined, () => "git@github.com:acme/svc-orders.git")).toBe("svc-orders");
    expect(() => resolveTargetModel(models, "/r", undefined, () => "git@github.com:acme/other.git")).toThrow("No declared model has the url");
    expect(() => resolveTargetModel(models, "/r", undefined, () => null)).toThrow("no git origin remote");
    expect(() => resolveTargetModel(models, "/r", "unknown")).toThrow("not declared");
  });

  it("reads a URL's path and each handler's served route", () => {
    expect(urlPathOnly("http://svc-orders:8000/api/orders/{}?x=1")).toBe("/api/orders/{}");
    expect(urlPathOnly("/api/orders")).toBe("/api/orders");
    const routes = handlerRoutes([...ORDERS_HANDLERS, ["get_order", MAIN, "__route__HEAD__/api/orders/{}", "/api/orders/{order_id}"], ["x", MAIN, "/not/a/route", null]]);
    expect(routes.get(`${MAIN}#get_order`)).toEqual([
      { method: "GET", path: "/api/orders/{order_id}" },
      { method: "HEAD", path: "/api/orders/{order_id}" },
    ]);
    // The caller's method picks one; an ANY call with two candidates picks none.
    const edge = (transport: string | null, to: string): CrossEdge => ({
      type: "CROSS_HTTP_CALLS",
      from: { qualifiedName: "a", name: "a", file: "a.py", label: "Function" },
      to: { qualifiedName: to, name: to },
      targetProject: ORDERS,
      targetFunction: "get_order",
      targetFile: MAIN,
      urlPath: "/api/orders/{}",
      transport,
      served: false,
    });
    const edges = [edge("GET", "__route__GET__/api/orders/{}"), edge(null, "__route__ANY__/api/orders/{}")];
    attachTargetRoutes(edges, ORDERS, routes);
    expect(edges[0].targetRoute).toEqual({ method: "GET", path: "/api/orders/{order_id}" });
    expect(edges[1].targetRoute).toBeUndefined();
  });

  it("runs the pass against the targets CBM has indexed, indexing one it has not", async () => {
    const calls: string[] = [];
    const projects = [
      { name: "own", root_path: rootPath },
      { name: "orders", root_path: ordersRoot },
    ];
    const other = await tempDir("dr-xr-web");
    const tools: CrossRepoTools = {
      listProjects: async () => projects,
      indexRepository: async (repo) => {
        calls.push(`index ${repo}`);
        return { project: "web", status: "indexed" };
      },
      crossRepoIntelligence: async (repo, targets, options) => {
        calls.push(`cross ${repo} ${targets.join(",")} as ${options?.name}`);
        return { status: "success", mode: "cross-repo-intelligence", cross_http_calls: 3, cross_channel: 1, total_cross_edges: 4, elapsed_ms: 12.5 };
      },
    };
    try {
      const run = await runCrossRepoPass(tools, rootPath, [
        { model: "svc-orders", codebase: ordersRoot },
        { model: "web", codebase: other },
        { model: "gone", codebase: join(other, "missing") },
      ]);
      expect(calls).toEqual([`index ${other}`, `cross ${rootPath} orders,web as own`]);
      expect(run).toMatchObject({ ok: true, project: "own", counts: { cross_http_calls: 3, cross_channel: 1, total_cross_edges: 4 } });
      expect(run.targets.map((t) => t.index)).toEqual(["existing", "indexed", "missing"]);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("reports a failed pass instead of throwing", async () => {
    const tools: CrossRepoTools = {
      listProjects: async () => [{ name: "orders", root_path: ordersRoot }],
      indexRepository: async () => ({}),
      crossRepoIntelligence: async () => {
        throw new Error("cross-repo source or target project is missing, invalid, or not indexed");
      },
    };
    const run = await runCrossRepoPass(tools, rootPath, [{ model: "svc-orders", codebase: ordersRoot }]);
    expect(run.ok).toBe(false);
    expect(run.error).toContain("not indexed");
  });

  it("asks CBM for cross-repo-intelligence with the target projects", async () => {
    const seen: any[] = [];
    const tools = new CbmTools({
      invokeTool: async (name: string, args: unknown) => {
        seen.push({ name, args });
        return { status: "success", total_cross_edges: 0 };
      },
    });
    await tools.crossRepoIntelligence("/repo", ["orders"]);
    expect(seen).toEqual([
      { name: "index_repository", args: { repo_path: "/repo", mode: "cross-repo-intelligence", target_projects: ["orders"], format: "json" } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The pass's record: target staleness, a skipped pass, a failed pass
// ---------------------------------------------------------------------------

describe("cross-repo pass state", () => {
  const A = "2222222222222222222222222222222222222222";
  const B = "3333333333333333333333333333333333333333";
  const git = (head: string | null, committed: string | null = null): GitReader => ({ head: () => head, commitTime: () => committed });
  const linked = (target: Record<string, unknown>): CrossRepoRun => ({
    at: "2026-11-12T12:00:00.000Z",
    ok: true,
    project: "own",
    targets: [{ model: "svc-orders", codebase: ordersRoot, project: "orders", index: "existing", ...target }],
    counts: { total_cross_edges: 4 },
  });
  const sh = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, stdio: "pipe", encoding: "utf-8" }).stdout.trim();
  async function commitIn(dir: string, file: string): Promise<string> {
    if (!existsSync(join(dir, ".git"))) {
      sh(dir, "init", "-q");
      sh(dir, "config", "user.email", "test@example.com");
      sh(dir, "config", "user.name", "Test");
      sh(dir, "config", "commit.gpgsign", "false");
    }
    await writeFile(join(dir, file), file, "utf-8");
    sh(dir, "add", ".");
    sh(dir, "commit", "-q", "-m", file);
    return sh(dir, "rev-parse", "HEAD");
  }

  it("records the commit a target was indexed at: the HEAD the pass indexed, or DR's index metadata there", async () => {
    const first = await commitIn(ordersRoot, "a.py");
    const tools: CrossRepoTools = {
      listProjects: async () => [{ name: "own", root_path: rootPath }],
      indexRepository: async () => ({ project: "orders" }),
      crossRepoIntelligence: async () => ({ status: "success", total_cross_edges: 1 }),
    };
    const indexedNow = await runCrossRepoPass(tools, rootPath, [{ model: "svc-orders", codebase: ordersRoot }]);
    expect(indexedNow.targets[0]).toMatchObject({ index: "indexed", indexedCommit: first });
    expect(staleCrossRepoTargets(indexedNow)).toEqual([]);

    // Already indexed: DR's metadata in that repository names the commit.
    await writeIndexMeta({ ...META, git_head: first }, ordersRoot, "cbm");
    tools.listProjects = async () => [
      { name: "own", root_path: rootPath },
      { name: "orders", root_path: ordersRoot },
    ];
    const existing = await runCrossRepoPass(tools, rootPath, [{ model: "svc-orders", codebase: ordersRoot }]);
    expect(existing.targets[0]).toMatchObject({ index: "existing", indexedCommit: first, indexedAt: META.timestamp });

    // The repository moved on: the next status says so, with both commits.
    const second = await commitIn(ordersRoot, "b.py");
    const stale = staleCrossRepoTargets(existing);
    expect(stale).toEqual([expect.objectContaining({ model: "svc-orders", indexed: first, head: second })]);
    expect(stale[0].message).toBe(
      `svc-orders was indexed at ${first.slice(0, 7)}; its HEAD is ${second.slice(0, 7)}; run codebase_index there (${ordersRoot}), then codebase_index here with force: true to re-link`
    );
  });

  it("ignores index metadata naming a commit the repository lacks, and falls back to CBM's index time", async () => {
    await commitIn(ordersRoot, "a.py");
    await writeIndexMeta({ ...META, git_head: A }, ordersRoot, "cbm");
    const asked: string[] = [];
    const tools: CrossRepoTools = {
      listProjects: async () => [{ name: "orders", root_path: ordersRoot }],
      indexRepository: async () => ({}),
      crossRepoIntelligence: async () => ({ status: "success" }),
      indexStatus: async (project) => {
        asked.push(project);
        return { project, status: "ready", indexed_at: "2026-11-04T20:25:05Z" };
      },
    };
    const run = await runCrossRepoPass(tools, rootPath, [{ model: "svc-orders", codebase: ordersRoot }]);
    expect(asked).toEqual(["orders"]);
    expect(run.targets[0].indexedCommit).toBeUndefined();
    expect(run.targets[0].indexedAt).toBe("2026-11-04T20:25:05Z");
  });

  it("tells a stale target by its commit, or by a HEAD committed after its index time", () => {
    expect(staleCrossRepoTargets(linked({ indexedCommit: A }), git(A))).toEqual([]);
    expect(staleCrossRepoTargets(linked({ indexedCommit: A }), git(B))[0].message).toContain("svc-orders was indexed at 2222222; its HEAD is 3333333; run codebase_index there");
    // Only the index time: a HEAD committed after it is newer than the index.
    const byTime = linked({ indexedAt: "2026-11-04T20:25:05Z" });
    expect(staleCrossRepoTargets(byTime, git(B, "2026-11-03T10:00:00Z"))).toEqual([]);
    const late = staleCrossRepoTargets(byTime, git(B, "2026-11-12T11:09:48-05:00"));
    expect(late[0]).toMatchObject({ indexed: "2026-11-04T20:25:05Z", head: B });
    expect(late[0].message).toContain("svc-orders was indexed at 2026-11-04T20:25:05Z; its HEAD 3333333 was committed after that");
    // Not a git checkout, or nothing recorded: nothing to say.
    expect(staleCrossRepoTargets(linked({ indexedCommit: A }), git(null))).toEqual([]);
    expect(staleCrossRepoTargets(linked({}), git(B, "2026-11-12T00:00:00Z"))).toEqual([]);
  });

  it("records a pass skipped for undeclared models with zero edges, replacing the last run's counts", async () => {
    await writeCrossRepoConfig(rootPath, "cbm", { version: 1, targets: [{ model: "svc-orders", codebase: ordersRoot }], lastRun: linked({}) });
    await declareModels({ payments: {} });
    const calls: string[] = [];
    const tools: CrossRepoTools = {
      listProjects: async () => (calls.push("list"), []),
      indexRepository: async () => (calls.push("index"), {}),
      crossRepoIntelligence: async () => (calls.push("cross"), {}),
    };
    const { run, warnings } = await linkCrossRepoTargets(tools, rootPath, "cbm", rootPath);
    expect(calls).toEqual([]);
    expect(run).toMatchObject({ ok: false, targets: [], counts: { total_cross_edges: 0 } });
    expect(run!.skipped).toContain("svc-orders");
    expect(warnings.map((w) => w.message).join(" ")).toContain("no longer declares");
    const stored = (await readCrossRepoConfig(rootPath, "cbm"))!;
    expect(stored.targets).toEqual([{ model: "svc-orders", codebase: ordersRoot }]);
    expect(stored.lastRun).toEqual(run!);
  });

  it("records a pass skipped when the manifest can't be read", async () => {
    const bare = await tempDir("dr-xr-bare");
    try {
      await writeCrossRepoConfig(bare, "cbm", { version: 1, targets: [{ model: "svc-orders", codebase: ordersRoot }], lastRun: linked({}) });
      const tools: CrossRepoTools = { listProjects: async () => [], indexRepository: async () => ({}), crossRepoIntelligence: async () => ({}) };
      const { run, warnings } = await linkCrossRepoTargets(tools, bare, "cbm", bare);
      expect(run!.skipped).toContain("the manifest's models: could not be read");
      expect(run!.counts).toEqual({ total_cross_edges: 0 });
      expect(warnings[0].message).toContain("pass was skipped");
      expect((await readCrossRepoConfig(bare, "cbm"))!.lastRun!.skipped).toBe(run!.skipped);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it("says how a failed pass runs again", async () => {
    await configure();
    const tools: CrossRepoTools = {
      listProjects: async () => [{ name: "orders", root_path: ordersRoot }],
      indexRepository: async () => ({}),
      crossRepoIntelligence: async () => {
        throw new Error("target project is not indexed");
      },
    };
    const { run, warnings } = await linkCrossRepoTargets(tools, rootPath, "cbm", rootPath, { git: git(null) });
    expect(run!.ok).toBe(false);
    expect(run!.skipped).toBeUndefined();
    expect(warnings).toEqual([
      { message: "The cross-repo-intelligence pass failed; cross-model references won't be extracted", suggestions: ["target project is not indexed", CROSS_REPO_RERUN_HINT] },
    ]);
    expect(CROSS_REPO_RERUN_HINT).toContain("codebase_index with force: true");
    expect(CROSS_REPO_RERUN_HINT).toContain("when the crossRepo list changes");
  });

  it("codebase_index status shows a failed, a skipped and a stale pass, with what to do", async () => {
    await indexed();
    const status = async (lastRun: CrossRepoRun, targetGit: GitReader = git(null)) => {
      await writeCrossRepoConfig(rootPath, "cbm", { version: 1, targets: [{ model: "svc-orders", codebase: ordersRoot }], lastRun });
      const { deps } = harness();
      deps.targetGit = targetGit;
      return ok(await createCodebaseIndexHandler(deps)({ rootPath, status: true })).crossRepo;
    };

    const failed = await status({ at: "2026-11-12T12:00:00.000Z", ok: false, targets: [], error: "target project is not indexed" });
    expect(failed.warnings).toEqual([
      `The last cross-repo-intelligence pass failed (target project is not indexed), so there are no cross-repository edges. ${CROSS_REPO_RERUN_HINT}`,
    ]);

    const skipped = await status(skippedCrossRepoRun("no target's model is declared under the manifest's models: (svc-orders)"));
    expect(skipped.lastRun).toMatchObject({ ok: false, counts: { total_cross_edges: 0 } });
    expect(skipped.warnings[0]).toContain("skipped the cross-repo-intelligence pass (no target's model is declared");

    const stale = await status(linked({ indexedCommit: A }), git(B));
    expect(stale.stale).toEqual([{ model: "svc-orders", codebase: ordersRoot, indexed: A, head: B }]);
    expect(stale.warnings).toEqual([expect.stringContaining("svc-orders was indexed at 2222222; its HEAD is 3333333")]);

    expect((await status(linked({ indexedCommit: A }), git(A))).warnings).toBeUndefined();
  });

  it("codebase_extract's crossModel section warns about a stale target", async () => {
    await indexed();
    await ordersModel();
    await writeCrossRepoConfig(rootPath, "cbm", { version: 1, targets: [{ model: "svc-orders", codebase: ordersRoot }], lastRun: linked({ indexedCommit: A }) });
    const { deps } = harness();
    deps.targetGit = git(B);
    const result = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(result.crossModel.staged).toBe(1);
    expect(result.crossModel.stale).toEqual([{ model: "svc-orders", codebase: ordersRoot, indexed: A, head: B }]);
    expect(result.crossModel.warnings).toContainEqual(expect.stringContaining("svc-orders was indexed at 2222222; its HEAD is 3333333; run codebase_index there"));
  });
});

// ---------------------------------------------------------------------------
// A caller the catalog reaches only from the operation's side (api.operation serves <caller>)
// ---------------------------------------------------------------------------

describe("cross-model references through serves", () => {
  const OPERATION = "api.operation.get-api-orders-order-id";
  const HANDLER = "application.applicationfunction.get-order";
  const COMPONENT = "application.applicationcomponent.shipping-client";

  /** The planner's input for svc-shipping's fetch_order calling svc-orders' GET /api/orders/{order_id}. */
  function planFor(callerType: string, hasTriple: (id: string) => boolean, inverseOf?: (predicate: string) => string | undefined) {
    const [layer, type] = callerType.split(".");
    const caller = `${layer}.${type}.fetch-order`;
    const edge: CrossEdge = {
      type: "CROSS_HTTP_CALLS",
      from: { qualifiedName: `${P}.app.main.fetch_order`, name: "fetch_order", file: MAIN, label: "Function" },
      to: { qualifiedName: CLIENT_ROUTE, name: CLIENT_ROUTE },
      targetProject: ORDERS,
      targetFunction: "get_order",
      targetFile: MAIN,
      urlPath: "http://svc-orders:8000/api/orders/{}",
      transport: "GET",
      served: false,
      targetRoute: { method: "GET", path: "/api/orders/{order_id}" },
    };
    const external = indexExternalModel("svc-orders", join(ordersRoot, "documentation-robotics", "model"), [
      { id: OPERATION, layer: "api", type: "operation", attributes: { http_method: "GET", http_path: "/api/orders/{order_id}" }, locations: [{ file: MAIN }] },
      { id: HANDLER, layer: "application", type: "applicationfunction", attributes: {}, locations: [{ file: MAIN, symbol: "get_order" }] },
    ]);
    const plan = planCrossModelReferences({
      extraction: { project: P, symbols: [], crossEdges: [edge] } as unknown as ExtractionGraph,
      existing: { elements: new Map(), getRelationship: () => undefined } as unknown as ChangesetGraph,
      elementOf: new Map([[edge.from.qualifiedName, caller]]),
      elements: new Map([[caller, { layer, type }]]),
      hasTriple,
      targets: new Map([[ORDERS, { target: { model: "svc-orders", codebase: ordersRoot }, external }]]),
      ...(inverseOf ? { inverseOf } : {}),
    });
    return { caller, plan };
  }
  const withTriple = (extra: string) => (id: string) => id === extra || catalogHasTriple(id);

  it("records served-by on a component caller, from the catalog's api.operation serves applicationcomponent", () => {
    expect(catalogHasTriple("api.operation.serves.application.applicationcomponent")).toBe(true);
    const { caller, plan } = planFor("application.applicationcomponent", catalogHasTriple);
    expect(plan.unresolved).toEqual([]);
    expect(plan.references).toEqual([
      expect.objectContaining({ source: caller, type: "served-by", target: `@svc-orders/${OPERATION}`, verified: true }),
    ]);
    expect(plan.references[0].description).toContain(
      "the catalog runs api.operation --serves--> application.applicationcomponent, so the caller records it as served-by"
    );
  });

  it("keeps a function caller on flows-to until the catalog has api.operation serves applicationfunction", () => {
    const now = planFor("application.applicationfunction", catalogHasTriple);
    expect(now.plan.references.map((r) => [r.type, r.target])).toEqual([["flows-to", `@svc-orders/${HANDLER}`]]);

    // Once the triple lands in the catalog, the same caller references the operation instead.
    const later = planFor("application.applicationfunction", withTriple("api.operation.serves.application.applicationfunction"));
    expect(later.plan.references.map((r) => [r.type, r.target])).toEqual([["served-by", `@svc-orders/${OPERATION}`]]);
  });

  it("reads the inverse from the predicate catalog, and tries nothing it can't name", () => {
    expect(bundledPredicateInverse("serves")).toBe("served-by");
    const { plan } = planFor("application.applicationcomponent", catalogHasTriple, () => undefined);
    expect(plan.references).toEqual([]);
    expect(plan.unresolved[0].reason).toContain("the catalog has no relationship between application.applicationcomponent and");
  });

  it("codebase_extract stages served-by in the component caller's references", async () => {
    await indexed();
    await ordersModel();
    await configure();
    ok(
      await modelAddHandler({
        rootPath,
        layer: "application",
        type: "applicationcomponent",
        name: "shipping client",
        attributes: { type: "internal" },
        sourceFile: MAIN,
        sourceSymbol: "fetch_order",
        sourceProvenance: "extracted",
      } as any)
    );
    clearModelCache();
    const { deps } = harness();
    const result = ok(await createCodebaseExtractHandler(deps)({ rootPath }));
    expect(result.crossModel.references.items).toContainEqual({ source: COMPONENT, type: "served-by", target: `@svc-orders/${OPERATION}`, verified: true });
    const update = (await changesetOf(result.changeset.id)).changes.find((c) => c.type === "update" && c.elementId === COMPONENT)!;
    expect((update.after as any).references).toEqual([
      expect.objectContaining({ source: COMPONENT, target: `@svc-orders/${OPERATION}`, type: "served-by" }),
    ]);
    // A reference, never a relationship (CLAUDE.md section 6).
    const relationships = (await changesetOf(result.changeset.id)).changes.filter((c) => c.type === "relationship-add");
    expect(relationships.some((c) => c.elementId.includes("@svc-orders") || c.elementId.includes(OPERATION))).toBe(false);
  });
});
