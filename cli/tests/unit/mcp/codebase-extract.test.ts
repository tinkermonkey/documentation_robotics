/**
 * Unit tests for codebase_extract: the extraction cascade staged into an as-built changeset.
 *
 * codebase-memory-mcp is not needed. The analyzer's graph is faked (a small Spring-style project);
 * cards, Tier 0, the edge mapping, the plan and the staging are the real code, with the real
 * rules and mappings from spec/dist/analyzers/cbm.json.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetVerifyHandler } from "../../../src/mcp/tools/changeset-verify.js";
import { createCodebaseExtractHandler } from "../../../src/mcp/tools/codebase-extract.js";
import { createCodebaseIndexHandler } from "../../../src/mcp/tools/codebase-index.js";
import type { CodebaseToolDeps } from "../../../src/mcp/tools/codebase-shared.js";
import { writeIndexMeta, writeSession } from "../../../src/analyzers/session-state.js";
import type { SpawnFn } from "../../../src/analyzers/index-job.js";
import type { AnalyzerBackend } from "../../../src/analyzers/base-analyzer.js";
import { collectExtraction, extractionConfigFrom } from "../../../src/analyzers/cards/extract.js";
import type { CardGraph, GraphNode } from "../../../src/analyzers/cards/types.js";
import { tier0RulesFrom } from "../../../src/analyzers/tier0-rules.js";
import type { AnalyzerHeuristic } from "../../../src/analyzers/types.js";
import { codeChangesSince, parseNameStatus } from "../../../src/analyzers/code-changes.js";
import { describeDocstring } from "../../../src/analyzers/extraction-plan.js";
import { registeredToolNames } from "../../../src/mcp/tool-registry.js";
import { drMcpAllowedTools } from "../../../src/coding-agents/drbot-mcp.js";
import { changesetOnlyRefusal } from "../../../src/mcp/changeset-only.js";
import { loadModel } from "../../../src/mcp/tools/shared.js";

const HEAD = "1111111111111111111111111111111111111111";
const NEW_HEAD = "2222222222222222222222222222222222222222";
const META = { git_head: HEAD, timestamp: "2026-11-09T12:00:00.000Z", node_count: 120, edge_count: 340 };

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
// A fake analyzer graph
// ---------------------------------------------------------------------------

const P = "proj";
const CONTROLLER_FILE = "src/owner/OwnerController.java";
const OWNER_FILE = "src/owner/Owner.java";
const SERVICE_FILE = "src/owner/OwnerService.java";
const HELPERS_FILE = "src/util/Helpers.java";
const TEST_FILE = "src/test/owner/OwnerTests.java";

interface FakeNode extends GraphNode {
  source?: string;
  decorators?: string[];
}

interface FakeProject {
  nodes: FakeNode[];
  edges: Array<{ type: string; from: string; to: string }>;
}

/** A Spring-style project: a controller and its handler, the route, an entity, a service, a helper and a test. */
function springProject(): FakeProject {
  const qn = (file: string, ...names: string[]) => `${P}.${file.replace(/\.java$/, "").replace(/\//g, ".")}.${names.join(".")}`;
  const controller = qn(CONTROLLER_FILE, "OwnerController");
  return {
    nodes: [
      { label: "Class", name: "OwnerController", qualified_name: controller, file_path: CONTROLLER_FILE, start_line: 10, end_line: 80, source: "@Controller\nclass OwnerController {\n}", decorators: ["@Controller"] },
      { label: "Method", name: "showOwner", qualified_name: `${controller}.showOwner`, file_path: CONTROLLER_FILE, parent_class: controller, start_line: 40, end_line: 52, source: '@GetMapping("/owners/{ownerId}")\npublic ModelAndView showOwner(int id) {\n}', decorators: ['@GetMapping("/owners/{ownerId}")'] },
      { label: "Method", name: "OwnerController", qualified_name: `${controller}.OwnerController`, file_path: CONTROLLER_FILE, parent_class: controller, start_line: 20, end_line: 22, source: "OwnerController(OwnerRepository owners) {\n}" },
      { label: "Route", name: "__route__GET__/owners/{}", qualified_name: "__route__GET__/owners/{}", file_path: "", method: "GET" },
      { label: "Class", name: "Owner", qualified_name: qn(OWNER_FILE, "Owner"), file_path: OWNER_FILE, start_line: 5, end_line: 60, docstring: "An owner of pets.", source: "@Entity\npublic class Owner extends Person {\n}", decorators: ["@Entity"] },
      { label: "Class", name: "OwnerService", qualified_name: qn(SERVICE_FILE, "OwnerService"), file_path: SERVICE_FILE, start_line: 3, end_line: 30, source: "@Service\npublic class OwnerService {\n}", decorators: ["@Service"] },
      { label: "Class", name: "Helpers", qualified_name: qn(HELPERS_FILE, "Helpers"), file_path: HELPERS_FILE, start_line: 1, end_line: 20, source: "public class Helpers {\n}" },
      { label: "Method", name: "format", qualified_name: qn(HELPERS_FILE, "Helpers", "format"), file_path: HELPERS_FILE, parent_class: qn(HELPERS_FILE, "Helpers"), start_line: 4, end_line: 8, source: "static String format(String s) {\n}" },
      { label: "Method", name: "testShowOwner", qualified_name: qn(TEST_FILE, "OwnerTests", "testShowOwner"), file_path: TEST_FILE, parent_class: qn(TEST_FILE, "OwnerTests"), start_line: 12, end_line: 20, source: "@Test\nvoid testShowOwner() {\n}", decorators: ["@Test"] },
    ],
    edges: [
      { type: "HANDLES", from: `${controller}.showOwner`, to: "__route__GET__/owners/{}" },
      { type: "WRITES", from: `${controller}.showOwner`, to: qn(OWNER_FILE, "Owner") },
    ],
  };
}

function fakeGraph(project: FakeProject): CardGraph {
  const byQn = new Map(project.nodes.map((n) => [n.qualified_name, n]));
  const edgesOf = (type: string) => project.edges.filter((e) => e.type === type);
  return {
    project: P,
    async search(label, filePattern) {
      return project.nodes.filter((n) => n.label === label && (!filePattern || n.file_path === filePattern));
    },
    async rows(cypher) {
      // The extraction's edge reads: MATCH (a)-[r:TYPE]->(b) RETURN a.qualified_name, a.file_path, a.name, ...
      const edgeRead = /^MATCH \(a\)-\[r:(\w+)\]->\(b\) RETURN a\.qualified_name, a\.file_path, a\.name/.exec(cypher);
      if (edgeRead) {
        return edgesOf(edgeRead[1]).map((e) => {
          const a = byQn.get(e.from);
          const b = byQn.get(e.to);
          return [e.from, a?.file_path ?? "", a?.name ?? e.from, e.to, b?.file_path ?? "", b?.name ?? e.to];
        });
      }
      const inFiles = /WHERE n\.file_path IN \[(.*)\]/.exec(cypher);
      if (inFiles) {
        const files = [...inFiles[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
        return project.nodes.filter((n) => files.includes(n.file_path)).map((n) => [n.file_path, n.qualified_name, n.name, n.label]);
      }
      if (/CALLS\]->/.test(cypher)) return edgesOf("CALLS").map((e) => [e.from, e.to]);
      if (/HANDLES\]->\(x:Route\)/.test(cypher)) return edgesOf("HANDLES").map((e) => [e.from, e.to]);
      if (/-\[r\]->\(x:Route\)/.test(cypher)) return edgesOf("HANDLES").map((e) => [e.from, byQn.get(e.from)?.file_path ?? "", e.to]);
      if (/MATCH \(a:Function\)/.test(cypher)) return project.nodes.filter((n) => n.label === "Function").map((n) => [n.qualified_name, n.file_path]);
      if (/decorators IS NOT NULL/.test(cypher)) return project.nodes.filter((n) => n.decorators).map((n) => [n.qualified_name, JSON.stringify(n.decorators)]);
      return [];
    },
    async snippet(qn) {
      const n = byQn.get(qn);
      return n?.source ? { source: n.source } : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  deps: CodebaseToolDeps;
  project: FakeProject;
  head: { value: string | null };
  changes: { value: { base: string; changed: Set<string>; deleted: Map<string, string | null> } | null };
  sinceCalls: string[];
}

function harness(): Harness {
  const h: Harness = {
    project: springProject(),
    head: { value: HEAD },
    changes: { value: null },
    sinceCalls: [],
    deps: undefined as unknown as CodebaseToolDeps,
  };
  const backend = {
    name: "cbm",
    detect: async () => ({ installed: true, binary_path: "/bin/cbm" }),
    // The graph is faked; cards, Tier 0 and the edge reads are the real code.
    extract: async (_projectRoot: string, options: any) => collectExtraction(fakeGraph(h.project), CONFIG, "cbm", options),
  } as unknown as AnalyzerBackend;
  const spawn: SpawnFn = () => Object.assign(new EventEmitter(), { pid: 60000, unref() {} }) as any;
  h.deps = {
    getAnalyzer: async (name) => (name === "cbm" ? backend : undefined),
    discover: async () => ({ found: [], selected: "cbm" }),
    spawn,
    drCommand: { command: "/usr/bin/node", args: ["/opt/dr/dist/cli.js"] },
    isAlive: () => true,
    gitHead: () => h.head.value,
    codeChanges: async (_root, since) => {
      h.sinceCalls.push(since);
      if (!h.changes.value) throw new Error("no changes configured");
      return h.changes.value;
    },
  };
  return h;
}

let rootPath: string;

beforeEach(async () => {
  clearModelCache();
  rootPath = await realpath(
    await (async () => {
      const dir = join(tmpdir(), `dr-mcp-extract-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(dir, { recursive: true });
      return dir;
    })()
  );
  await Model.init(rootPath, { name: "Extract Test Model", version: "0.1.0" });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

async function indexed(): Promise<void> {
  await writeSession({ active_analyzer: "cbm", selected_at: new Date().toISOString() }, rootPath);
  await writeIndexMeta(META, rootPath, "cbm");
}

/** The base model's files (everything under model/), with their content. */
async function baseModelFiles(): Promise<Record<string, string>> {
  const dir = join(rootPath, "documentation-robotics", "model");
  const files: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    files[file] = await readFile(file, "utf-8");
  }
  return files;
}

async function changesetOf(id: string) {
  clearModelCache();
  const model = await Model.load(rootPath);
  return (await new StagingAreaManager(rootPath, model).load(id))!;
}

/** Add an element to the base model (no changeset active). */
async function addToBase(args: Record<string, unknown>): Promise<void> {
  ok(await modelAddHandler({ rootPath, ...(args as any) }));
  clearModelCache();
}

const OPERATION = "api.operation.get-owners-param";
const HANDLER = "application.applicationfunction.owner-controller-show-owner";
const INTERFACE = "application.applicationinterface.owner-controller";
const SCHEMA = "data-model.objectschema.owner";
const TEST_SKETCH = "testing.testcasesketch.owner-tests-test-show-owner";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("codebase_extract", () => {
  it("bootstraps an empty model into a new changeset, never the base model", async () => {
    await indexed();
    const h = harness();
    const before = await baseModelFiles();

    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));

    expect(result.changeset.name).toBe(`extract-${HEAD.slice(0, 7)}`);
    expect(result.changeset.created).toBe(true);
    expect(result.cards).toMatchObject({ cards: 8, decided: 5, rejected: 0, narrowed: 1, undecided: 2, needsAttributes: 0 });
    expect(result.staged.adds).toBe(5);
    expect(result.staged.byLayer).toEqual({
      api: { adds: 1, updates: 0, relationships: 1 },
      application: { adds: 2, updates: 0, relationships: 1 },
      "data-model": { adds: 1, updates: 0, relationships: 0 },
      testing: { adds: 1, updates: 0, relationships: 0 },
    });
    expect(result.staged.relationships).toBe(2);
    expect(result.candidateDeletes.total).toBe(0);

    const changeset = await changesetOf(result.changeset.id);
    const adds = changeset.changes.filter((c) => c.type === "add");
    expect(adds.map((c) => c.elementId).sort()).toEqual([HANDLER, INTERFACE, OPERATION, SCHEMA, TEST_SKETCH].sort());
    const op = adds.find((c) => c.elementId === OPERATION)!.after as any;
    expect(op.attributes).toMatchObject({ http_method: "GET", http_path: "/owners/{}", operationId: "get-owners", tags: "owners" });
    const schema = adds.find((c) => c.elementId === SCHEMA)!.after as any;
    expect(schema.description).toBe("An owner of pets.");
    expect(schema.attributes).toEqual({ type: "object" });
    expect(schema.source_reference).toEqual({ provenance: "extracted", locations: [{ file: OWNER_FILE, symbol: "Owner" }] });
    const handler = adds.find((c) => c.elementId === HANDLER)!.after as any;
    expect(handler.source_reference.locations).toEqual([{ file: CONTROLLER_FILE, symbol: "OwnerController.showOwner" }]);
    const rels = changeset.changes.filter((c) => c.type === "relationship-add").map((c) => c.elementId).sort();
    expect(rels).toEqual([`${OPERATION}::realizes::${HANDLER}`, `${HANDLER}::accesses::${SCHEMA}`].sort());

    // A constructor named after its class is not a card.
    expect(result.undecided.items.map((c: any) => c.symbol)).not.toContain("OwnerController.OwnerController");
    expect(await baseModelFiles()).toEqual(before);
  });

  it("stages nothing when re-run on unchanged code", async () => {
    await indexed();
    const h = harness();
    const handler = createCodebaseExtractHandler(h.deps);
    const first = ok(await handler({ rootPath }));
    const count = (await changesetOf(first.changeset.id)).changes.length;

    const again = ok(await handler({ rootPath }));
    expect(again.changeset).toMatchObject({ id: first.changeset.id, created: false });
    expect(again.staged).toMatchObject({ adds: 0, updates: 0, relationships: 0 });
    expect(again.unchanged).toMatchObject({ elements: 5, relationships: 2 });
    expect((await changesetOf(first.changeset.id)).changes.length).toBe(count);
  });

  it("stages a changed symbol of the base model as an update, and leaves matched ones alone", async () => {
    await indexed();
    await addToBase({
      layer: "data-model",
      type: "objectschema",
      name: "Owner",
      description: "An owner of pets.",
      attributes: { type: "object" },
      sourceFile: OWNER_FILE,
      sourceSymbol: "Owner",
      sourceProvenance: "extracted",
    });
    const h = harness();
    const unchanged = ok(await createCodebaseExtractHandler(h.deps)({ changeset: "as-built-1", rootPath }));
    expect(unchanged.staged.updates).toBe(0);
    expect(unchanged.staged.adds).toBe(4);
    expect(unchanged.unchanged.elements).toBe(1);

    // The docstring changes in the code.
    h.project.nodes.find((n) => n.name === "Owner")!.docstring = "A pet owner, with contact details.";
    const changed = ok(await createCodebaseExtractHandler(h.deps)({ changeset: "as-built-2", rootPath }));
    expect(changed.staged.updates).toBe(1);
    expect(changed.staged.updated.items).toEqual([{ id: SCHEMA, fields: ["description"] }]);
    const update = (await changesetOf(changed.changeset.id)).changes.find((c) => c.type === "update")!;
    expect(update.elementId).toBe(SCHEMA);
    expect((update.before as any).description).toBe("An owner of pets.");
    expect((update.after as any).description).toBe("A pet owner, with contact details.");
  });

  it("folds a change into an add the extraction changeset already stages", async () => {
    await indexed();
    const h = harness();
    const handler = createCodebaseExtractHandler(h.deps);
    const first = ok(await handler({ rootPath }));
    h.project.nodes.find((n) => n.name === "Owner")!.docstring = "Someone who owns pets.";
    const again = ok(await handler({ rootPath }));
    expect(again.staged.updates).toBe(1);
    const changeset = await changesetOf(first.changeset.id);
    expect(changeset.changes.filter((c) => c.type === "update")).toHaveLength(0);
    expect((changeset.changes.find((c) => c.elementId === SCHEMA)!.after as any).description).toBe("Someone who owns pets.");
  });

  it("limits the run to files changed since a ref", async () => {
    await indexed();
    const h = harness();
    h.changes.value = { base: "abc123", changed: new Set([OWNER_FILE]), deleted: new Map() };
    const result = ok(await createCodebaseExtractHandler(h.deps)({ since: "main", rootPath }));
    expect(h.sinceCalls).toEqual(["main"]);
    expect(result.scope).toMatchObject({ since: "main", base: "abc123", changedFiles: 1 });
    expect(result.cards.cards).toBe(1);
    expect(result.staged.adds).toBe(1);
    const changeset = await changesetOf(result.changeset.id);
    expect(changeset.changes.map((c) => c.elementId)).toEqual([SCHEMA]);
  });

  it("lists an element whose file was deleted as a candidate delete, without staging it", async () => {
    await indexed();
    await addToBase({
      layer: "application",
      type: "applicationcomponent",
      name: "Legacy Importer",
      attributes: { type: "internal" },
      sourceFile: "src/legacy/Importer.java",
      sourceSymbol: "Importer",
      sourceProvenance: "extracted",
    });
    const h = harness();
    h.changes.value = { base: "abc123", changed: new Set([OWNER_FILE]), deleted: new Map([["src/legacy/Importer.java", null]]) };
    const result = ok(await createCodebaseExtractHandler(h.deps)({ since: "main", rootPath }));
    expect(result.candidateDeletes.items).toEqual([
      expect.objectContaining({
        id: "application.applicationcomponent.legacy-importer",
        evidence: "file-deleted",
        file: "src/legacy/Importer.java",
      }),
    ]);
    const changeset = await changesetOf(result.changeset.id);
    expect(changeset.changes.some((c) => c.type === "delete")).toBe(false);

    // Without since, a missing file is the evidence.
    const all = ok(await createCodebaseExtractHandler(h.deps)({ changeset: "whole", rootPath }));
    expect(all.candidateDeletes.items.map((d: any) => [d.id, d.evidence])).toEqual([
      ["application.applicationcomponent.legacy-importer", "file-missing"],
    ]);
  });

  it("lists an element whose symbol the file no longer has, but not one whose name is still in the file", async () => {
    await indexed();
    await mkdir(join(rootPath, "src", "owner"), { recursive: true });
    await writeFile(join(rootPath, OWNER_FILE), "@Entity\npublic class Owner extends Person {\n  private String nickname;\n}\n");
    for (const [name, symbol] of [
      ["Owner Pets", "listPets"],
      ["Owner Nickname", "nickname"],
    ]) {
      await addToBase({
        layer: "application",
        type: "dataobject",
        name,
        sourceFile: OWNER_FILE,
        sourceSymbol: symbol,
        sourceProvenance: "extracted",
      });
    }
    const h = harness();
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(result.candidateDeletes.items).toEqual([
      expect.objectContaining({ id: "application.dataobject.owner-pets", evidence: "symbol-missing", symbol: "listPets" }),
    ]);
  });

  it("returns the undecided cards paged, and later pages from the last run", async () => {
    await indexed();
    const h = harness();
    const handler = createCodebaseExtractHandler(h.deps);
    const first = ok(await handler({ pageSize: 1, rootPath }));
    expect(first.undecided).toMatchObject({ total: 3, page: 1, pageSize: 1, pages: 3 });
    const [narrowed] = first.undecided.items;
    expect(narrowed).toMatchObject({
      kind: "narrowed",
      symbol: "OwnerService",
      file: SERVICE_FILE,
      candidates: ["application.applicationservice", "application.applicationcomponent"],
      rule: "tier0_spring_service",
    });
    expect(narrowed.reason).toContain("Tier 1 is not wired");
    expect(first.next.join(" ")).toContain("page: 2");

    // The agent stages its decision for the first card; page 2 reads the stored cards.
    ok(
      await modelAddHandler({
        layer: "application",
        type: "applicationservice",
        name: "Owner Service",
        attributes: { serviceType: "synchronous" },
        sourceFile: narrowed.file,
        sourceSymbol: narrowed.symbol,
        sourceProvenance: "extracted",
        rootPath,
      })
    );
    const second = ok(await handler({ page: 2, pageSize: 1, rootPath }));
    expect(second.undecided.items).toHaveLength(1);
    expect(second.undecided.items[0]).toMatchObject({ kind: "no-rule", label: "Class", symbol: "Helpers", hint: "application.applicationcomponent" });
    const firstAgain = ok(await handler({ page: 1, pageSize: 1, rootPath }));
    // Page 1 again re-runs, and the decided card is gone: it is modelled now.
    expect(firstAgain.undecided.total).toBe(2);
    expect(firstAgain.unchanged.modelled).toBe(1);
  });

  it("leaves the extraction changeset active and returns the one active before", async () => {
    await indexed();
    const plan = ok(await changesetCreateHandler({ name: "add-owner-page", rootPath }));
    const h = harness();
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(result.previousActive).toEqual({ id: plan.id, name: "add-owner-page" });
    expect(result.changeset.active).toBe(true);
    clearModelCache();
    const model = await Model.load(rootPath);
    expect(await new StagingAreaManager(rootPath, model).getActiveId()).toBe(result.changeset.id);
    expect(result.next.join(" ")).toContain(`changeset_activate with "${plan.id}"`);
    // The plan's own changes are not part of the as-built changeset.
    expect((await changesetOf(plan.id)).changes).toHaveLength(0);
  });

  it("feeds changeset_verify: the plan verifies against the extraction changeset", async () => {
    await indexed();
    ok(await changesetCreateHandler({ name: "owner-page", rootPath }));
    ok(
      await modelAddHandler({
        layer: "api",
        type: "operation",
        name: "GET /owners/{param}",
        attributes: { operationId: "get-owners", summary: "Show an owner", tags: "owners", http_method: "GET", http_path: "/owners/{}" },
        rootPath,
      })
    );
    ok(await modelAddHandler({ layer: "data-model", type: "objectschema", name: "Owner", attributes: { type: "object" }, rootPath }));
    const h = harness();
    const extraction = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(extraction.previousActive.name).toBe("owner-page");

    clearModelCache();
    const report = ok(await changesetVerifyHandler({ planned: "owner-page", against: { changesetId: extraction.changeset.id }, rootPath }));
    expect(report.against.kind).toBe("changeset");
    expect(report.summary.elements).toMatchObject({ planned: 2, matched: 2, missing: 0 });
    expect(report.elements.matched.map((m: any) => m.built)).toEqual([SCHEMA]);
    // The operation matches by name; its summary differs (the plan wrote one, extraction defaults it).
    expect(report.elements.divergent).toEqual([
      expect.objectContaining({ built: OPERATION, match: "probable", fields: [{ field: "attributes.summary", planned: "Show an owner", built: "GET /owners/{}" }] }),
    ]);
    expect(report.verdict).toBe("diverges");
    // What the build has that the plan didn't: the handler, the interface and the test.
    expect(report.summary.elements.unplanned).toBe(3);
  });

  it("stages only the layers asked for", async () => {
    await indexed();
    const h = harness();
    const result = ok(await createCodebaseExtractHandler(h.deps)({ layers: ["api"], rootPath }));
    expect(Object.keys(result.staged.byLayer)).toEqual(["api"]);
    expect(result.staged.adds).toBe(1);
    const bad = fail(await createCodebaseExtractHandler(h.deps)({ layers: ["datastore"], rootPath }));
    expect(bad.error).toContain("Unknown layer");
  });

  it("points at codebase_index when the index is missing, stale or still running", async () => {
    const h = harness();
    const missing = fail(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(missing.error).toBe("The code is not indexed");
    expect(missing.suggestions[0]).toContain("codebase_index");
    expect(missing.suggestions[0]).toContain("codebase_extract");

    await indexed();
    h.head.value = NEW_HEAD;
    const stale = fail(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(stale.error).toContain("stale");
    expect(stale.suggestions[0]).toContain("codebase_index");

    ok(await createCodebaseIndexHandler(h.deps)({ force: true, rootPath }));
    const running = fail(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(running.error).toContain("in progress");
    // Nothing was created.
    const model = await Model.load(rootPath);
    expect(await new StagingAreaManager(rootPath, model).list()).toHaveLength(0);
  });
});

describe("registration", () => {
  it("is registered", () => {
    expect(registeredToolNames()).toContain("codebase_extract");
  });

  it("is kept off DrBot's allowlists", () => {
    for (const mode of ["read-safe", "changesets"] as const) {
      expect(drMcpAllowedTools(mode)).not.toContain("mcp__dr__codebase_extract");
    }
  });

  it("is allowed in changeset-only mode, since it only writes a changeset", async () => {
    expect(await changesetOnlyRefusal("codebase_extract", rootPath, loadModel, { DR_CHANGESET_ONLY: "true" })).toBeNull();
  });
});

describe("helpers", () => {
  it("parses git name-status output, renames included", () => {
    const into = { changed: new Set<string>(), deleted: new Map<string, string | null>() };
    parseNameStatus(["M", "a.ts", "D", "b.ts", "R087", "old.ts", "new.ts", "A", "c.ts", ""].join("\0"), into);
    expect([...into.changed].sort()).toEqual(["a.ts", "c.ts", "new.ts"]);
    expect([...into.deleted]).toEqual([
      ["b.ts", null],
      ["old.ts", "new.ts"],
    ]);
  });

  it("reads a branch's changes since its merge base with a ref, relative to the codebase root", async () => {
    const repo = join(rootPath, "repo");
    const code = join(repo, "app");
    await mkdir(join(code, "src"), { recursive: true });
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" };
    const git = (...args: string[]) => {
      const r = spawnSync("git", args, { cwd: repo, env, encoding: "utf-8" });
      if (r.status !== 0) throw new Error(r.stderr);
    };
    git("init", "-q", "-b", "main");
    for (const f of ["keep.ts", "edit.ts", "gone.ts", "move.ts"]) await writeFile(join(code, "src", f), `export const ${f.replace(".ts", "")} = "${f}";\n`);
    await writeFile(join(repo, "README.md"), "outside the codebase root\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "feature");
    await writeFile(join(code, "src", "edit.ts"), "export const edit = 2;\n");
    await rm(join(code, "src", "gone.ts"));
    git("mv", "app/src/move.ts", "app/src/moved.ts");
    await writeFile(join(repo, "README.md"), "changed\n");
    git("add", "-A");
    git("commit", "-q", "-m", "feature work");
    await writeFile(join(code, "src", "new.ts"), "export const fresh = 1;\n");

    const changes = await codeChangesSince(await realpath(code), "main");
    expect([...changes.changed].sort()).toEqual(["src/edit.ts", "src/moved.ts", "src/new.ts"]);
    expect([...changes.deleted].sort()).toEqual([
      ["src/gone.ts", null],
      ["src/move.ts", "src/moved.ts"],
    ]);
    await expect(codeChangesSince(await realpath(code), "no-such-branch")).rejects.toThrow("not a commit");
  });

  it("describes a docstring by its first paragraph, without comment markers", () => {
    expect(describeDocstring("/**\n * Lists owners.\n * Paged.\n *\n * @param x\n */")).toBe("Lists owners. Paged.");
    expect(describeDocstring('"""Create a user.\n\nLong text."""')).toBe("Create a user.");
    expect(describeDocstring(null)).toBeUndefined();
  });
});
