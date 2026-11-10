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
import { existsSync, readFileSync } from "node:fs";
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
import {
  changedInRange,
  codeChangesSince,
  parseHunks,
  parseNameStatus,
  sourceEditsSince,
  type CodeChangesResult,
} from "../../../src/analyzers/code-changes.js";
import { FileLock } from "../../../src/utils/file-lock.js";
import { decisionKey, describeDocstring, extractedElementId, needsAttributesCard, sameFact } from "../../../src/analyzers/extraction-plan.js";
import { TEST_PATH, namedRoutePath, routesCalledIn } from "../../../src/analyzers/cards/routes.js";
import { changesetDiscardHandler, changesetUnstageHandler } from "../../../src/mcp/tools/changeset-editing.js";
import { generateElementId } from "../../../src/utils/id-generator.js";
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
  /** A route's name as CBM stores it, with the code's parameter names (`/owners/{ownerId}`). */
  cbm_name?: string;
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
      if (/^MATCH \(r:Route\) RETURN r\.qualified_name, r\.name/.test(cypher)) {
        return project.nodes.filter((n) => n.label === "Route" && n.cbm_name).map((n) => [n.qualified_name, n.cbm_name]);
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
  changes: { value: CodeChangesResult | null };
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

const OPERATION = "api.operation.get-owners-owner-id";
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
    expect(op.attributes).toMatchObject({ http_method: "GET", http_path: "/owners/{ownerId}", operationId: "get-owners-owner-id", tags: "owners" });
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

    // The docstring changes in the code. The description is the one extraction wrote, so it follows.
    await writeFile(join(rootPath, ".dr", "analyzers", "extract", "descriptions.json"), JSON.stringify({ [SCHEMA]: "An owner of pets." }));
    h.project.nodes.find((n) => n.name === "Owner")!.docstring = "A pet owner, with contact details.";
    const changed = ok(await createCodebaseExtractHandler(h.deps)({ changeset: "as-built-2", rootPath }));
    expect(changed.staged.updates).toBe(1);
    expect(changed.staged.updated.items).toEqual([{ id: SCHEMA, fields: ["description"] }]);
    const update = (await changesetOf(changed.changeset.id)).changes.find((c) => c.type === "update")!;
    expect(update.elementId).toBe(SCHEMA);
    expect((update.before as any).description).toBe("An owner of pets.");
    expect((update.after as any).description).toBe("A pet owner, with contact details.");
  });

  it("never overwrites a description someone wrote, and fills an empty one", async () => {
    await indexed();
    await addToBase({
      layer: "data-model",
      type: "objectschema",
      name: "Owner",
      description: "Written by the agent.",
      attributes: { type: "object" },
      sourceFile: OWNER_FILE,
      sourceSymbol: "Owner",
      sourceProvenance: "extracted",
    });
    await addToBase({
      layer: "application",
      type: "applicationinterface",
      name: "Owner Controller",
      attributes: { protocol: "HTTP" },
      sourceFile: CONTROLLER_FILE,
      sourceSymbol: "OwnerController",
      sourceProvenance: "extracted",
    });
    const h = harness();
    h.project.nodes.find((n) => n.name === "OwnerController")!.docstring = "Pages for owners.";
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(result.staged.updated.items).toEqual([{ id: "application.applicationinterface.owner-controller", fields: ["description"] }]);
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
        name: "GET /owners/{ownerId}",
        attributes: { operationId: "get-owners-owner-id", summary: "Show an owner", tags: "owners", http_method: "GET", http_path: "/owners/{ownerId}" },
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
      expect.objectContaining({ built: OPERATION, match: "probable", fields: [{ field: "attributes.summary", planned: "Show an owner", built: "GET /owners/{ownerId}" }] }),
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

describe("codebase_extract review fixes", () => {
  const OP_ATTRS = { operationId: "show-owner", summary: "Show an owner", tags: "owners" };

  it("B1: keeps an operation's named path parameters and trailing slash", async () => {
    await indexed();
    await addToBase({
      layer: "api",
      type: "operation",
      name: "Show Owner",
      attributes: { ...OP_ATTRS, http_method: "GET", http_path: "/owners/{ownerId}/" },
    });
    const h = harness();
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(result.staged.adds).toBe(4);
    // Only the code location is new; method and path already say what the code says.
    expect(result.staged.updated.items).toEqual([{ id: "api.operation.show-owner", fields: ["source_reference"] }]);
    const update = (await changesetOf(result.changeset.id)).changes.find((c) => c.type === "update")!;
    expect((update.after as any).attributes).toMatchObject({ http_method: "GET", http_path: "/owners/{ownerId}/" });
  });

  it("B2: matches a route element by its symbol with a named parameter, without a duplicate", async () => {
    await indexed();
    await addToBase({
      layer: "api",
      type: "operation",
      name: "Show Owner",
      attributes: OP_ATTRS,
      sourceFile: CONTROLLER_FILE,
      sourceSymbol: "GET /owners/{ownerId}",
      sourceProvenance: "extracted",
    });
    const h = harness();
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    const changes = (await changesetOf(result.changeset.id)).changes;
    expect(changes.some((c) => c.type === "add" && c.elementId.startsWith("api.operation."))).toBe(false);
    // It gains the method and path the code gives, and keeps its own location.
    expect(result.staged.updated.items).toEqual([
      { id: "api.operation.show-owner", fields: ["attributes.http_method", "attributes.http_path"] },
    ]);
    expect(changes.some((c) => c.type === "relationship-add" && c.elementId === `api.operation.show-owner::realizes::${HANDLER}`)).toBe(true);
  });

  it("B3: matches each element to one symbol, sends the second to the agent, and settles: runs 2 and 3 stage nothing", async () => {
    await indexed();
    const file = "src/test/owner/PetsTests.java";
    const qn = (cls: string) => `${P}.src.test.owner.PetsTests.${cls}.testShow`;
    await addToBase({
      layer: "testing",
      type: "testcasesketch",
      name: "Show test",
      attributes: { status: "automated" },
      sourceFile: file,
      sourceSymbol: "testShow",
      sourceProvenance: "extracted",
    });
    const h = harness();
    for (const cls of ["OwnerTests", "PetTests"]) {
      h.project.nodes.push({
        label: "Method",
        name: "testShow",
        qualified_name: qn(cls),
        file_path: file,
        parent_class: `${P}.src.test.owner.PetsTests.${cls}`,
        start_line: 1,
        end_line: 4,
        docstring: `${cls} shows.`,
        source: "@Test\nvoid testShow() {\n}",
        decorators: ["@Test"],
      });
    }
    // Two routes that differ only by a trailing slash.
    h.project.nodes.push(
      { label: "Route", name: "__route__GET__/health", qualified_name: "__route__GET__/health", file_path: CONTROLLER_FILE, method: "GET" },
      { label: "Route", name: "__route__GET__/health/", qualified_name: "__route__GET__/health/", file_path: CONTROLLER_FILE, method: "GET" }
    );
    const handler = createCodebaseExtractHandler(h.deps);
    const first = ok(await handler({ rootPath }));
    const ambiguous = first.undecided.items.filter((c: any) => c.kind === "ambiguous");
    expect(ambiguous.map((c: any) => c.symbol)).toEqual(["PetTests.testShow"]);
    expect(ambiguous[0].reason).toContain("testing.testcasesketch.show-test");
    expect(first.staged.adds).toBe(7);

    for (const run of [2, 3]) {
      const again = ok(await handler({ rootPath }));
      expect({ run, ...again.staged }).toEqual({ run, adds: 0, updates: 0, relationships: 0, byLayer: {} });
      expect(again.undecided.items.filter((c: any) => c.kind === "ambiguous").map((c: any) => c.symbol)).toEqual(["PetTests.testShow"]);
    }
  });

  it("B4: returns previousActive on later runs too, while that changeset is staged", async () => {
    await indexed();
    const plan = ok(await changesetCreateHandler({ name: "owner-page", rootPath }));
    const h = harness();
    const handler = createCodebaseExtractHandler(h.deps);
    const first = ok(await handler({ rootPath }));
    expect(first.previousActive).toEqual({ id: plan.id, name: "owner-page" });
    const second = ok(await handler({ rootPath }));
    expect(second.previousActive).toEqual({ id: plan.id, name: "owner-page" });
    expect(second.next.join(" ")).toContain("changeset_verify");
    expect(second.next.join(" ")).not.toContain("changeset_commit");
  });

  it("B5: with nothing to stage, creates and activates nothing", async () => {
    await indexed();
    const plan = ok(await changesetCreateHandler({ name: "owner-page", rootPath }));
    const h = harness();
    h.project = { nodes: [], edges: [] };
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(result.changeset).toBeNull();
    expect(result.message).toContain("Nothing to stage");
    clearModelCache();
    const model = await Model.load(rootPath);
    const manager = new StagingAreaManager(rootPath, model);
    expect(await manager.getActiveId()).toBe(plan.id);
    expect((await manager.list()).map((c) => c.name)).toEqual(["owner-page"]);
  });

  it("B7: stops before staging when the call is cancelled or out of time, and runs one at a time", async () => {
    await indexed();
    const h = harness();
    const controller = new AbortController();
    controller.abort();
    const cancelled = fail(await createCodebaseExtractHandler(h.deps)({ rootPath }, { signal: controller.signal } as any));
    expect(cancelled.error).toContain("cancelled");

    const slow = fail(await createCodebaseExtractHandler({ ...h.deps, budgetMs: -1 })({ rootPath }));
    expect(slow.error).toContain("budget");
    expect(slow.suggestions[0]).toContain("layers");

    const lock = new FileLock(join(rootPath, ".dr", "analyzers", "extract", "run"));
    await lock.acquire();
    try {
      const busy = fail(await createCodebaseExtractHandler(h.deps)({ rootPath }));
      expect(busy.error).toContain("in progress");
    } finally {
      await lock.release();
    }
    clearModelCache();
    expect(await new StagingAreaManager(rootPath, await Model.load(rootPath)).list()).toHaveLength(0);
  });

  it("names a since run after its range, apart from a whole-codebase run at the same commit", async () => {
    await indexed();
    const h = harness();
    h.changes.value = { base: "abc1234def", changed: new Set([OWNER_FILE]), deleted: new Map() };
    const since = ok(await createCodebaseExtractHandler(h.deps)({ since: "main", rootPath }));
    expect(since.changeset.name).toBe(`extract-abc1234..${HEAD.slice(0, 7)}`);
    const whole = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(whole.changeset.name).toBe(`extract-${HEAD.slice(0, 7)}`);
  });

  it("doesn't match a route to an operation by method and path when that operation names other code", async () => {
    await indexed();
    await addToBase({
      layer: "api",
      type: "operation",
      name: "Other Service Owner",
      attributes: { ...OP_ATTRS, http_method: "GET", http_path: "/owners/{id}" },
      sourceFile: "services/other/OwnerApi.java",
      sourceSymbol: "getOwner",
      sourceProvenance: "extracted",
    });
    const h = harness();
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    const adds = (await changesetOf(result.changeset.id)).changes.filter((c) => c.type === "add").map((c) => c.elementId);
    expect(adds).toContain(OPERATION);
  });

  it("refuses a later page asked with other arguments, and prunes cards of changesets no longer staged", async () => {
    await indexed();
    const h = harness();
    const handler = createCodebaseExtractHandler(h.deps);
    ok(await handler({ layers: ["application"], pageSize: 1, rootPath }));
    const other = fail(await handler({ page: 2, pageSize: 1, layers: ["api"], rootPath }));
    // The error quotes both: what the call named and what the run had.
    expect(other.error).toContain("layers: api (its run had layers: application)");
    expect(ok(await handler({ page: 2, pageSize: 1, layers: ["application"], rootPath })).undecided.items).toHaveLength(1);

    const stale = join(rootPath, ".dr", "analyzers", "extract", "changeset-gone.json");
    await writeFile(stale, JSON.stringify({ changesetId: "changeset-gone", cards: [] }));
    ok(await handler({ layers: ["application"], rootPath }));
    expect(await readdir(join(rootPath, ".dr", "analyzers", "extract"))).not.toContain("changeset-gone.json");
  });

  it("warns about uncommitted source edits newer than the index", async () => {
    await indexed();
    const h = harness();
    const seen: number[] = [];
    h.deps.sourceEdits = async (_root, sinceMs) => {
      seen.push(sinceMs);
      return ["src/owner/Owner.java"];
    };
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    expect(seen).toEqual([Date.parse(META.timestamp)]);
    expect(result.warning).toContain("Re-index with codebase_index");
    expect(result.warning).not.toContain("force");
    expect(result.warning).toContain("src/owner/Owner.java");
  });
});

/** A fake symbol's qualified name, as springProject builds them. */
function qnOf(file: string, ...names: string[]): string {
  return `${P}.${file.replace(/\.java$/, "").replace(/\//g, ".")}.${names.join(".")}`;
}

async function relationshipIds(changesetId: string): Promise<string[]> {
  return (await changesetOf(changesetId)).changes.filter((c) => c.type === "relationship-add").map((c) => c.elementId);
}

describe("codebase_extract validation fixes (2026-11-10)", () => {
  it("bug 4: an element it staged that the agent unstaged is recorded, and later runs leave it out", async () => {
    await indexed();
    const h = harness();
    const handler = createCodebaseExtractHandler(h.deps);
    const first = ok(await handler({ rootPath }));
    ok(await changesetUnstageHandler({ elementId: TEST_SKETCH, rootPath }));
    clearModelCache();

    const again = ok(await handler({ rootPath }));
    expect(again.staged.adds).toBe(0);
    expect(again.notElements).toMatchObject({ total: 1, skipped: 1 });
    expect(again.notElements.recorded.items).toEqual([{ symbol: "OwnerTests.testShowOwner", file: TEST_FILE, how: "unstaged" }]);

    const third = ok(await handler({ rootPath }));
    expect(third.staged.adds).toBe(0);
    expect(third.notElements).toMatchObject({ total: 1, skipped: 1 });
    expect(third.notElements.recorded).toBeUndefined();
    const stored = JSON.parse(await readFile(join(rootPath, ".dr", "analyzers", "extract", "decisions.json"), "utf-8"));
    expect(Object.values(stored.notElements)).toEqual([
      expect.objectContaining({ how: "unstaged", symbol: "OwnerTests.testShowOwner", changeset: first.changeset.name }),
    ]);
  });

  it("bug 4: rejected cards are kept per project, left out of later runs, and cleared on request", async () => {
    await indexed();
    const h = harness();
    const handler = createCodebaseExtractHandler(h.deps);
    const first = ok(await handler({ rootPath }));
    expect(first.undecided.items.map((c: any) => c.symbol).sort()).toEqual(["Helpers", "Helpers.format", "OwnerService"]);
    const helpers = first.undecided.items.find((c: any) => c.symbol === "Helpers");

    // An unknown card records nothing.
    const bad = fail(await handler({ reject: [{ card: "nope", reason: "x" }, { card: helpers.cardId, reason: "x" }], rootPath }));
    expect(bad.error).toContain("nope");
    expect(existsSync(join(rootPath, ".dr", "analyzers", "extract", "decisions.json"))).toBe(false);

    const rejected = ok(
      await handler({ reject: [{ card: helpers.cardId, reason: "a static utility" }, { card: "Helpers.format", reason: "a helper" }], rootPath })
    );
    // Decisions only: nothing is extracted or staged.
    expect(rejected.notElements).toMatchObject({ total: 2 });
    expect(rejected.notElements.recorded.total).toBe(2);
    expect(rejected.undecided).toBeUndefined();
    expect(rejected.message).toContain("nothing was extracted");
    const rerun = ok(await handler({ rootPath }));
    expect(rerun.undecided.items.map((c: any) => c.symbol)).toEqual(["OwnerService"]);
    expect(rerun.notElements).toMatchObject({ total: 2, skipped: 2 });

    // Kept for the project: a run into another changeset leaves them out too.
    const other = ok(await handler({ changeset: "as-built-2", rootPath }));
    expect(other.undecided.items.map((c: any) => c.symbol)).toEqual(["OwnerService"]);
    expect(other.notElements.skipped).toBe(2);

    ok(await handler({ changeset: "as-built-2", clearRejected: ["Helpers.format"], rootPath }));
    const one = ok(await handler({ changeset: "as-built-2", rootPath }));
    expect(one.notElements).toMatchObject({ total: 1, skipped: 1 });
    expect(one.undecided.items.map((c: any) => c.symbol).sort()).toEqual(["Helpers.format", "OwnerService"]);
    expect(ok(await handler({ changeset: "as-built-2", clearRejected: true, rootPath })).notElements).toMatchObject({ total: 0, cleared: 1 });
    expect(ok(await handler({ changeset: "as-built-2", rootPath })).undecided.total).toBe(3);
  });

  it("bug 5: a route nothing handles is never decided as an operation; it is a last, unhandled-route card", async () => {
    await indexed();
    const h = harness();
    h.project.nodes.push(
      { label: "Route", name: "__route__GET__/owners/1", qualified_name: "__route__GET__/owners/1", file_path: "", method: "GET" },
      { label: "Route", name: "__route__GET__/owners?lastName=", qualified_name: "__route__GET__/owners?lastName=", file_path: "", method: "GET" }
    );
    const result = ok(await createCodebaseExtractHandler(h.deps)({ pageSize: 50, rootPath }));
    expect(result.staged.adds).toBe(5);
    const ops = (await changesetOf(result.changeset.id)).changes.filter((c) => c.type === "add" && c.elementId.startsWith("api."));
    expect(ops.map((c) => c.elementId)).toEqual([OPERATION]);
    const unhandled = result.undecided.items.filter((c: any) => c.kind === "unhandled-route");
    expect(unhandled.map((c: any) => c.symbol).sort()).toEqual(["GET /owners/1", "GET /owners?lastName="]);
    expect(result.undecided.items.slice(-2)).toEqual(unhandled);
  });

  it("bug 6: a re-run stages relationships for an element the agent added from a card, through its members", async () => {
    await indexed();
    const h = harness();
    h.project.edges.push({ type: "WRITES", from: qnOf(HELPERS_FILE, "Helpers", "format"), to: qnOf(OWNER_FILE, "Owner") });
    const handler = createCodebaseExtractHandler(h.deps);
    const first = ok(await handler({ rootPath }));
    const helpers = first.undecided.items.find((c: any) => c.symbol === "Helpers");
    ok(
      await modelAddHandler({
        layer: "application",
        type: "applicationcomponent",
        name: "Helpers",
        attributes: { type: "internal" },
        sourceFile: helpers.file,
        sourceSymbol: helpers.symbol,
        sourceProvenance: "extracted",
        rootPath,
      })
    );
    clearModelCache();
    const again = ok(await handler({ rootPath }));
    expect(again.staged.relationships).toBe(1);
    expect(await relationshipIds(first.changeset.id)).toContain(`application.applicationcomponent.helpers::accesses::${SCHEMA}`);
  });

  it("bug 6: maps INHERITS to specializes, and a test's calls and URLs to tests, where the catalog allows", async () => {
    await indexed();
    const h = harness();
    const personFile = "src/model/Person.java";
    const person = qnOf(personFile, "Person");
    const urlTest = qnOf(TEST_FILE, "OwnerTests", "testOwnerPage");
    h.project.nodes.push(
      { label: "Class", name: "Person", qualified_name: person, file_path: personFile, start_line: 1, end_line: 30, source: "@MappedSuperclass\npublic class Person {\n}", decorators: ["@MappedSuperclass"] },
      {
        label: "Method",
        name: "testOwnerPage",
        qualified_name: urlTest,
        file_path: TEST_FILE,
        parent_class: qnOf(TEST_FILE, "OwnerTests"),
        start_line: 22,
        end_line: 30,
        source: '@Test\nvoid testOwnerPage() {\n  mockMvc.perform(get("/owners/{ownerId}", 1)).andExpect(status().isOk());\n}',
        decorators: ["@Test"],
      }
    );
    h.project.edges.push(
      { type: "INHERITS", from: qnOf(OWNER_FILE, "Owner"), to: person },
      { type: "CALLS", from: qnOf(TEST_FILE, "OwnerTests", "testShowOwner"), to: `${qnOf(CONTROLLER_FILE, "OwnerController")}.showOwner` }
    );
    const result = ok(await createCodebaseExtractHandler(h.deps)({ rootPath }));
    const rels = await relationshipIds(result.changeset.id);
    expect(rels).toContain(`${SCHEMA}::specializes::data-model.objectschema.person`);
    expect(rels).toContain(`${TEST_SKETCH}::tests::${HANDLER}`);
    expect(rels).toContain(`testing.testcasesketch.owner-tests-test-owner-page::tests::${OPERATION}`);
  });

  it("bug 7: since leaves out DR's own files and files that are neither source nor named by the model", async () => {
    await indexed();
    // A file that is not source but that the model names stays in scope.
    await addToBase({
      layer: "application",
      type: "dataobject",
      name: "Owner Record",
      sourceFile: "docs/owner.schema.json",
      sourceSymbol: "Owner",
      sourceProvenance: "extracted",
    });
    const h = harness();
    h.changes.value = {
      base: "abc123",
      changed: new Set([
        OWNER_FILE,
        "README.md",
        "package.json",
        "docs/owner.schema.json",
        "documentation-robotics/changesets/x/changes.yaml",
        ".dr/analyzers/extract/decisions.json",
      ]),
      deleted: new Map([["documentation-robotics/changesets/y/changes.yaml", null]]),
    };
    const result = ok(await createCodebaseExtractHandler(h.deps)({ since: "main", rootPath }));
    expect(result.scope).toMatchObject({ changedFiles: 2, deletedFiles: 0 });
  });

  it("bug 8: with since, a reference the file never had is reference-never-matched, not removed by the range", async () => {
    await indexed();
    await mkdir(join(rootPath, "src", "owner"), { recursive: true });
    await writeFile(join(rootPath, OWNER_FILE), "@Entity\npublic class Owner extends Person {\n}\n");
    for (const [name, symbol] of [
      ["Owner Pets", "listPets"],
      ["Owner Visits", "listVisits"],
    ]) {
      await addToBase({ layer: "application", type: "dataobject", name, sourceFile: OWNER_FILE, sourceSymbol: symbol, sourceProvenance: "extracted" });
    }
    const h = harness();
    h.changes.value = {
      base: "abc123",
      changed: new Set([OWNER_FILE]),
      deleted: new Map(),
      fileAtBase: (f) => (f === OWNER_FILE ? "class Owner {\n  List<Pet> listPets() {}\n}\n" : null),
    };
    const result = ok(await createCodebaseExtractHandler(h.deps)({ since: "main", rootPath }));
    const [removed, never] = result.candidateDeletes.items;
    expect([removed.id, removed.evidence]).toEqual(["application.dataobject.owner-pets", "symbol-missing"]);
    expect(removed.detail).toContain("had listPets at the start of the range");
    expect([never.id, never.evidence]).toEqual(["application.dataobject.owner-visits", "reference-never-matched"]);
    expect(never.detail).not.toContain("no longer");
    expect(result.next.join(" ")).toContain("reference-never-matched");

    // Without since there is no base to compare with: no claim about when it went.
    const all = ok(await createCodebaseExtractHandler(h.deps)({ changeset: "whole", rootPath }));
    expect(all.candidateDeletes.items.map((d: any) => d.detail)).toEqual([
      expect.stringContaining("has no listPets"),
      expect.stringContaining("has no listVisits"),
    ]);
  });

  it("bug 9: ids keep word breaks, new operations keep parameter names, and / is get-root", async () => {
    await indexed();
    const h = harness();
    const repoFile = "src/owner/PetTypeRepository.java";
    const repo = qnOf(repoFile, "PetTypeRepository");
    h.project.nodes.push(
      { label: "Route", name: "__route__GET__/", qualified_name: "__route__GET__/", file_path: CONTROLLER_FILE, method: "GET" },
      {
        label: "Route",
        name: "__route__POST__/owners/{}/pets/{}/edit",
        qualified_name: "__route__POST__/owners/{}/pets/{}/edit",
        file_path: CONTROLLER_FILE,
        method: "POST",
        cbm_name: "/owners/{ownerId}/pets/{petId}/edit",
      },
      {
        label: "Method",
        name: "findPetTypes",
        qualified_name: `${repo}.findPetTypes`,
        file_path: repoFile,
        parent_class: repo,
        start_line: 5,
        end_line: 7,
        source: '@Query("SELECT ptype FROM PetType ptype")\nList<PetType> findPetTypes();',
        decorators: ['@Query("SELECT ptype FROM PetType ptype")'],
      }
    );
    const result = ok(await createCodebaseExtractHandler(h.deps)({ pageSize: 50, rootPath }));
    const adds = (await changesetOf(result.changeset.id)).changes.filter((c) => c.type === "add");
    const root = adds.find((c) => c.elementId === "api.operation.get-root")!;
    expect((root.after as any).attributes).toMatchObject({ http_path: "/", operationId: "get-root" });
    const edit = adds.find((c) => c.elementId === "api.operation.post-owners-owner-id-pets-pet-id-edit")!;
    expect((edit.after as any).attributes).toMatchObject({ http_path: "/owners/{ownerId}/pets/{petId}/edit", operationId: "post-owners-owner-id-pets-pet-id-edit" });

    // model_add with the card's proposed name gives the id extraction would use.
    const card = result.undecided.items.find((c: any) => c.kind === "needs-attributes");
    expect(card.proposed).toMatchObject({ name: "PetTypeRepository findPetTypes", id: "data-store.accesspattern.pet-type-repository-find-pet-types" });
    expect(generateElementId(card.proposed.layer, card.proposed.type, card.proposed.name)).toBe(card.proposed.id);
    expect(result.undecided.items.find((c: any) => c.symbol === "Helpers.format").name).toBe("Helpers format");
  });

  it("bug 10: a page call without since pages the run's cards; naming another since is refused, quoting both", async () => {
    await indexed();
    const h = harness();
    h.changes.value = { base: "abc123", changed: new Set([SERVICE_FILE, HELPERS_FILE]), deleted: new Map() };
    const handler = createCodebaseExtractHandler(h.deps);
    const first = ok(await handler({ since: "main", pageSize: 1, rootPath }));
    expect(first.undecided.pages).toBe(3);
    const second = ok(await handler({ changeset: first.changeset.name, page: 2, pageSize: 1, rootPath }));
    expect(second.scope.since).toBe("main");
    expect(second.undecided.items).toHaveLength(1);
    // Without the changeset either: the active extraction changeset's cards.
    expect(ok(await handler({ page: 3, pageSize: 1, rootPath })).changeset.name).toBe(first.changeset.name);
    const other = fail(await handler({ changeset: first.changeset.name, page: 2, since: "develop", rootPath }));
    expect(other.error).toContain("since: develop (its run had since: main)");
  });

  it("with since, marks cards whose lines changed in the range and puts them first", async () => {
    await indexed();
    const h = harness();
    h.changes.value = { base: "abc123", changed: new Set([SERVICE_FILE, HELPERS_FILE]), deleted: new Map(), hunks: new Map([[HELPERS_FILE, [[5, 6]]]]) };
    const result = ok(await createCodebaseExtractHandler(h.deps)({ since: "main", rootPath }));
    expect(result.undecided.changedInRange).toBe(2);
    expect(result.undecided.items.map((c: any) => [c.symbol, c.changedInRange ?? false])).toEqual([
      ["Helpers", true],
      ["Helpers.format", true],
      ["OwnerService", false],
    ]);
    expect(result.next.join(" ")).toContain("changedInRange");
  });
});

describe("codebase_extract review of PR 1061", () => {
  const sinceHarness = () => {
    const h = harness();
    h.changes.value = { base: "abc1234def", changed: new Set([SERVICE_FILE, HELPERS_FILE]), deleted: new Map() };
    return h;
  };

  it("a reject call records decisions only, and a run into a since changeset keeps that run's since", async () => {
    await indexed();
    const h = sinceHarness();
    const handler = createCodebaseExtractHandler(h.deps);
    const first = ok(await handler({ since: "main", rootPath }));
    expect(first.next.join(" ")).toContain(`changeset: "${first.changeset.name}", since: "main"`);
    const before = (await changesetOf(first.changeset.id)).changes.length;
    const helpers = first.undecided.items.find((c: any) => c.symbol === "Helpers");

    // No changeset named: the active extraction changeset's cards; nothing is extracted.
    const rejected = ok(await handler({ reject: [{ card: helpers.cardId, reason: "a utility" }], rootPath }));
    expect(rejected.changeset.name).toBe(first.changeset.name);
    expect(rejected.notElements.recorded.total).toBe(1);
    expect((await changesetOf(first.changeset.id)).changes.length).toBe(before);

    // Re-running it by name keeps its since: no whole-codebase extraction lands in it.
    h.sinceCalls.length = 0;
    const again = ok(await handler({ changeset: first.changeset.name, rootPath }));
    expect(h.sinceCalls).toEqual(["main"]);
    expect(again.scope).toMatchObject({ since: "main", changedFiles: 2 });
    expect(again.staged.adds).toBe(0);
    expect(again.undecided.items.map((c: any) => c.symbol).sort()).toEqual(["Helpers.format", "OwnerService"]);
    const stored = JSON.parse(await readFile(join(rootPath, ".dr", "analyzers", "extract", `${first.changeset.id}.json`), "utf-8"));
    expect(stored.since).toBe("main");

    const other = fail(await handler({ changeset: first.changeset.name, since: "develop", rootPath }));
    expect(other.error).toContain("since: develop (its run had since: main)");
  });

  it("a page call with no changeset reads the active extraction run, even when another run has cards at this commit", async () => {
    await indexed();
    const h = sinceHarness();
    const handler = createCodebaseExtractHandler(h.deps);
    const whole = ok(await handler({ pageSize: 1, rootPath }));
    const since = ok(await handler({ since: "main", pageSize: 1, rootPath }));
    expect(since.changeset.name).not.toBe(whole.changeset.name);
    const p2 = ok(await handler({ page: 2, pageSize: 1, rootPath }));
    expect(p2.changeset.name).toBe(since.changeset.name);
    expect(p2.scope.since).toBe("main");
  });

  it("checks a renamed file's old path at the base", async () => {
    await indexed();
    await mkdir(join(rootPath, "src", "owner"), { recursive: true });
    await writeFile(join(rootPath, OWNER_FILE), "@Entity\npublic class Owner {\n}\n");
    await addToBase({ layer: "application", type: "dataobject", name: "Owner Pets", sourceFile: OWNER_FILE, sourceSymbol: "listPets", sourceProvenance: "extracted" });
    const h = harness();
    h.changes.value = {
      base: "abc123",
      changed: new Set([OWNER_FILE]),
      deleted: new Map([["src/old/Owner.java", OWNER_FILE]]),
      fileAtBase: (f) => (f === "src/old/Owner.java" ? "class Owner {\n  List<Pet> listPets() {}\n}\n" : null),
    };
    const result = ok(await createCodebaseExtractHandler(h.deps)({ since: "main", rootPath }));
    expect(result.candidateDeletes.items.map((d: any) => [d.id, d.evidence])).toEqual([["application.dataobject.owner-pets", "symbol-missing"]]);
  });

  it("says so when the range's changed lines can't be read", async () => {
    await indexed();
    const h = sinceHarness();
    h.changes.value!.hunksError = "stdout maxBuffer length exceeded";
    const result = ok(await createCodebaseExtractHandler(h.deps)({ since: "main", rootPath }));
    expect(result.hunksWarning).toContain("maxBuffer");
  });

  it("drops an inferred decision when its changeset is discarded", async () => {
    await indexed();
    const h = harness();
    const handler = createCodebaseExtractHandler(h.deps);
    const first = ok(await handler({ rootPath }));
    ok(await changesetUnstageHandler({ elementId: TEST_SKETCH, rootPath }));
    clearModelCache();
    expect(ok(await handler({ rootPath })).notElements.total).toBe(1);
    ok(await changesetDiscardHandler({ changesetId: first.changeset.id, confirm: true, rootPath }));
    clearModelCache();
    const fresh = ok(await handler({ changeset: "as-built-2", rootPath }));
    expect(fresh.staged.adds).toBe(5);
    expect(fresh.notElements).toBeUndefined();
  });

  it("refuses to reject a bare symbol several cards share, and records nothing while another call holds the lock", async () => {
    await indexed();
    const h = harness();
    for (const file of ["src/a/tool.ts", "src/b/tool.ts"]) {
      h.project.nodes.push({ label: "Function", name: "main", qualified_name: `${P}.${file.replace(/\.ts$/, "").replace(/\//g, ".")}.main`, file_path: file, start_line: 1, end_line: 3, source: "function main() {}" });
    }
    const handler = createCodebaseExtractHandler(h.deps);
    const first = ok(await handler({ pageSize: 50, rootPath }));
    const mains = first.undecided.items.filter((c: any) => c.symbol === "main");
    expect(mains).toHaveLength(2);
    const bad = fail(await handler({ reject: [{ card: "main", reason: "x" }], rootPath }));
    expect(bad.error).toContain("names more than one card");
    for (const c of mains) expect(bad.error).toContain(c.cardId);

    const lock = new FileLock(join(rootPath, ".dr", "analyzers", "extract", "run"));
    await lock.acquire();
    try {
      const busy = fail(await handler({ reject: [{ card: mains[0].cardId, reason: "x" }], rootPath }));
      expect(busy.error).toContain("in progress");
    } finally {
      await lock.release();
    }
    expect(existsSync(join(rootPath, ".dr", "analyzers", "extract", "decisions.json"))).toBe(false);
  });

  it("treats any route with no file and no HANDLES edge as unhandled, whoever calls it", async () => {
    await indexed();
    const h = harness();
    h.project.nodes.push({ label: "Route", name: "__route__ANY__/users/{}", qualified_name: "__route__ANY__/users/{}", file_path: "", method: "ANY" });
    const result = ok(await createCodebaseExtractHandler(h.deps)({ pageSize: 50, rootPath }));
    expect(result.undecided.items.find((c: any) => c.symbol === "ANY /users/{}")?.kind).toBe("unhandled-route");
  });

  it("keys a route decision by its file, so a rejected client URL can't hide a served route", () => {
    expect(decisionKey("src/A.java", "GET /owners/{ownerId}")).toBe(decisionKey("src/A.java", "GET /owners/{}"));
    expect(decisionKey(null, "GET /owners/{}")).not.toBe(decisionKey("src/A.java", "GET /owners/{}"));
  });

  it("matches only HTTP or test client calls to routes with a literal segment, and only test files", () => {
    const served = [
      { name: "__route__GET__/owners/new", method: "GET", path: "/owners/new" },
      { name: "__route__GET__/{}", method: "GET", path: "/{}" },
    ];
    expect(routesCalledIn('cache.get("/owners/new"); map.get("/x"); get("/owners/new");', served)).toEqual([]);
    expect(routesCalledIn('client.get("/anything")', served)).toEqual([]);
    expect(routesCalledIn('mockMvc.perform(get("/owners/new"))', served)).toEqual(["__route__GET__/owners/new"]);
    expect(routesCalledIn('await fetch("/owners/new")', served)).toEqual(["__route__GET__/owners/new"]);
    expect(TEST_PATH.test("spec/schemas/nodes/api/operation.node.schema.json")).toBe(false);
    expect(TEST_PATH.test("src/utils/graph.spec.ts")).toBe(true);
    expect(TEST_PATH.test("src/test/java/OwnerTests.java")).toBe(true);
  });
});

describe("extraction helpers (2026-11-10)", () => {
  it("names a route's parameters from CBM's name, a path literal, path-marked parameters, or plain ones", () => {
    expect(namedRoutePath("/owners/{}/pets/{}", "/owners/{ownerId}/pets/{petId}", null)).toBe("/owners/{ownerId}/pets/{petId}");
    expect(namedRoutePath("/owners/{}", "/owners/{}", '@GetMapping("/owners/{ownerId}")\npublic String show(int id) {')).toBe("/owners/{ownerId}");
    expect(namedRoutePath("/owners/{}/pets/new", null, '@GetMapping("/pets/new")\npublic String init(@PathVariable("ownerId") int id, ModelMap model) {')).toBe(
      "/owners/{ownerId}/pets/new"
    );
    expect(namedRoutePath("/users/{}", null, "async def get_user(user_id: int, db: Session = Depends(get_db)):")).toBe("/users/{user_id}");
    // An entity parameter is not a path segment: the parameter stays unnamed.
    expect(namedRoutePath("/owners/{}/pets/new", null, "public String init(Owner owner, ModelMap model) {")).toBe("/owners/{}/pets/new");
    expect(extractedElementId("api", "operation", "GET /")).toBe("api.operation.get-root");
  });

  it("finds the served routes a test calls by URL", () => {
    const served = [
      { name: "__route__GET__/owners/{}", method: "GET", path: "/owners/{}" },
      { name: "__route__GET__/owners/new", method: "GET", path: "/owners/new" },
      { name: "__route__POST__/owners/new", method: "POST", path: "/owners/new" },
    ];
    const source = 'mockMvc.perform(get("/owners/new")); mockMvc.perform(post("/owners/new").param("x", "y")); restTemplate.getForEntity("/owners/1?x=2", String.class);';
    expect(routesCalledIn(source, served).sort()).toEqual(["__route__GET__/owners/new", "__route__GET__/owners/{}", "__route__POST__/owners/new"]);
    expect(routesCalledIn('get("/vets")', served)).toEqual([]);
  });

  it("reads the changed lines of a diff, and whether a symbol's lines touch them", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3 +3,2 @@ x",
      "@@ -10,2 +11,0 @@ y",
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,4 @@",
    ].join("\n");
    const hunks = parseHunks(diff);
    expect(hunks.get("src/a.ts")).toEqual([
      [3, 4],
      [11, 11],
    ]);
    expect(hunks.get("src/new.ts")).toBe("all");
    expect(changedInRange(hunks.get("src/a.ts"), 1, 3)).toBe(true);
    expect(changedInRange(hunks.get("src/a.ts"), 5, 10)).toBe(false);
    expect(changedInRange(hunks.get("src/new.ts"), null, null)).toBe(true);
    expect(changedInRange(undefined, 1, 100)).toBe(false);
  });

  it("builds a needs-attributes card whose proposed name gives its id through model_add", () => {
    const symbol = {
      qualifiedName: "p.Repo.findAll",
      card: { id: "c1", label: "Method", name: "findAll", qualified_name: "Repo.findAll", file_path: "Repo.java", start_line: 1, end_line: 2, parent_class: "Repo", docstring: null, signature: null },
      facts: { decorators: [], decorator_names: [], file_importers: 0, methods: 0, usage_files: 0 },
      tier0: null,
    } as any;
    const card = needsAttributesCard(
      { id: "data-store.accesspattern.repo-find-all", layer: "data-store", type: "accesspattern", name: "Repo.findAll", attributes: {}, symbol, rule: "r" },
      "p",
      ["needs targetCollection"]
    );
    expect(card.proposed).toMatchObject({ name: "Repo findAll", id: "data-store.accesspattern.repo-find-all" });
    expect(generateElementId("data-store", "accesspattern", card.proposed!.name)).toBe(card.proposed!.id);
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

    // A deleted file recreated and left untracked is there again, not deleted.
    await writeFile(join(code, "src", "gone.ts"), "export const back = 1;\n");
    const again = await codeChangesSince(await realpath(code), "main");
    expect([...again.changed].sort()).toEqual(["src/edit.ts", "src/gone.ts", "src/moved.ts", "src/new.ts"]);
    expect([...again.deleted]).toEqual([["src/move.ts", "src/moved.ts"]]);

    // Edits newer than the index, uncommitted: the new and recreated files, not the committed ones.
    const edited = await sourceEditsSince(await realpath(code), Date.now() - 60_000, (f) => f.endsWith(".ts"));
    expect(edited).toEqual(["src/gone.ts", "src/new.ts"]);
  });

  it("bug 7: leaves DR's own folders out of a range, and gives each file's changed lines and its text at the base", async () => {
    const repo = join(rootPath, "repo-dr");
    await mkdir(join(repo, "src"), { recursive: true });
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" };
    const git = (...args: string[]) => {
      const r = spawnSync("git", args, { cwd: repo, env, encoding: "utf-8" });
      if (r.status !== 0) throw new Error(r.stderr);
    };
    git("init", "-q", "-b", "main");
    await writeFile(join(repo, "src", "a.ts"), "export const one = 1;\nexport const two = 2;\nexport const three = 3;\n");
    await mkdir(join(repo, "documentation-robotics", "changesets", "c1"), { recursive: true });
    await writeFile(join(repo, "documentation-robotics", "changesets", "c1", "changes.yaml"), "[]\n");
    // A file bigger than spawnSync's default 1 MB buffer, and a doc.
    const big = Array.from({ length: 40_000 }, (_, i) => `export const value${i} = "${"x".repeat(20)}";`);
    await writeFile(join(repo, "src", "big.ts"), big.join("\n") + "\n");
    await writeFile(join(repo, "README.md"), "readme\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    big[20_000] = "export const changed = 1;";
    await writeFile(join(repo, "src", "big.ts"), big.join("\n") + "\n");
    await writeFile(join(repo, "README.md"), "readme, edited\n");
    // The work: one line of code, plus what DR itself writes (a changeset, .dr state).
    await writeFile(join(repo, "src", "a.ts"), "export const one = 1;\nexport const two = 22;\nexport const three = 3;\n");
    await writeFile(join(repo, "src", "new.ts"), "export const fresh = 1;\n");
    await writeFile(join(repo, "documentation-robotics", "changesets", "c1", "changes.yaml"), "- {}\n");
    await mkdir(join(repo, "documentation-robotics", "changesets", "c2"), { recursive: true });
    await writeFile(join(repo, "documentation-robotics", "changesets", "c2", "metadata.yaml"), "id: c2\n");
    await mkdir(join(repo, ".dr", "analyzers", "extract"), { recursive: true });
    await writeFile(join(repo, ".dr", "analyzers", "extract", "decisions.json"), "{}\n");

    const changes = await codeChangesSince(await realpath(repo), "main");
    expect([...changes.changed].sort()).toEqual(["README.md", "src/a.ts", "src/big.ts", "src/new.ts"]);
    // Changed lines only for source files, even past 1 MB of diff and file text.
    expect([...changes.hunks!].sort()).toEqual([
      ["src/a.ts", [[2, 2]]],
      ["src/big.ts", [[20_001, 20_001]]],
      ["src/new.ts", "all"],
    ]);
    expect(changes.hunksError).toBeUndefined();
    expect(changes.fileAtBase!("src/a.ts")).toContain("two = 2;");
    expect(changes.fileAtBase!("src/big.ts")!.length).toBeGreaterThan(1024 * 1024);
    expect(changes.fileAtBase!("src/new.ts")).toBeNull();
  });

  it("compares an operation's method and path the way the code can give them", () => {
    expect(sameFact("http_path", "/owners/{ownerId}/", "/owners/{}")).toBe(true);
    expect(sameFact("http_path", "/owners/:id", "/owners/{}")).toBe(true);
    expect(sameFact("http_path", "/owners/{id}/pets", "/owners/{}")).toBe(false);
    expect(sameFact("http_method", "get", "GET")).toBe(true);
    expect(sameFact("http_method", "POST", "GET")).toBe(false);
  });

  it("describes a docstring by its first paragraph, without comment markers", () => {
    expect(describeDocstring("/**\n * Lists owners.\n * Paged.\n *\n * @param x\n */")).toBe("Lists owners. Paged.");
    expect(describeDocstring('"""Create a user.\n\nLong text."""')).toBe("Create a user.");
    expect(describeDocstring(null)).toBeUndefined();
  });
});
