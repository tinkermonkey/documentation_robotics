/**
 * Landing a plan keeps the source references extraction found (issue #1096).
 *
 * The /dr-plan flow lands the plan and discards the as-built changeset. The plan's code-level
 * elements were planned before the code existed, so they carry no sourceFile or sourceSymbol; landed
 * as they are, the model can't tie them to the code, and the next codebase_extract offers their
 * symbols again. changeset_verify now lists them (sourceReferences) and, with
 * adoptSourceReferences: true, copies the as-built references onto the plan.
 *
 * codebase-memory-mcp is not needed: the analyzer's graph is faked, as in the codebase_extract unit
 * tests; cards, Tier 0, the plan and the staging are the real code.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir as mkdirAsync, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { stagedSourceReference } from "../../src/core/staged-source-reference.js";
import { clearModelCache } from "../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../src/mcp/tools/model-add.js";
import { changesetCreateHandler, changesetDeactivateHandler } from "../../src/mcp/tools/changeset-lifecycle.js";
import { changesetVerifyHandler } from "../../src/mcp/tools/changeset-verify.js";
import { createCodebaseExtractHandler } from "../../src/mcp/tools/codebase-extract.js";
import type { CodebaseToolDeps } from "../../src/mcp/tools/codebase-shared.js";
import { writeIndexMeta, writeSession } from "../../src/analyzers/session-state.js";
import type { SpawnFn } from "../../src/analyzers/index-job.js";
import type { AnalyzerBackend } from "../../src/analyzers/base-analyzer.js";
import { collectExtraction, extractionConfigFrom } from "../../src/analyzers/cards/extract.js";
import type { CardGraph, GraphNode } from "../../src/analyzers/cards/types.js";
import { tier0RulesFrom } from "../../src/analyzers/tier0-rules.js";
import type { AnalyzerHeuristic } from "../../src/analyzers/types.js";


const HEAD = "1111111111111111111111111111111111111111";
const META = { git_head: HEAD, timestamp: "2026-11-09T12:00:00.000Z", node_count: 4, edge_count: 0 };
const CBM = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../spec/dist/analyzers/cbm.json"), "utf-8"));
const CONFIG = extractionConfigFrom(
  tier0RulesFrom(CBM.heuristics.heuristics as AnalyzerHeuristic[]),
  Object.values(CBM.edges_by_type),
  Object.values(CBM.nodes_by_label)
);

const P = "proj";
const HELPERS_FILE = "src/util/Helpers.java";
/** The plan's element, and what the agent stages from the Helpers card. */
const HELPERS = "application.applicationcomponent.helpers";

/** A small project: one helper class, which no Tier-0 rule decides (an undecided card). */
function project(): GraphNode[] {
  return [
    {
      label: "Class",
      name: "Helpers",
      qualified_name: `${P}.src.util.Helpers.Helpers`,
      file_path: HELPERS_FILE,
      start_line: 1,
      end_line: 20,
    } as GraphNode,
  ];
}

function fakeGraph(nodes: GraphNode[]): CardGraph {
  return {
    project: P,
    async search(label, filePattern) {
      return nodes.filter((n) => n.label === label && (!filePattern || n.file_path === filePattern));
    },
    async rows(cypher) {
      const inFiles = /WHERE n\.file_path IN \[(.*)\]/.exec(cypher);
      if (inFiles) {
        const files = [...inFiles[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
        return nodes.filter((n) => files.includes(n.file_path)).map((n) => [n.file_path, n.qualified_name, n.name, n.label]);
      }
      return [];
    },
    async snippet() {
      return { source: "public class Helpers {\n}" };
    },
  } as CardGraph;
}

function deps(): CodebaseToolDeps {
  const backend = {
    name: "cbm",
    detect: async () => ({ installed: true, binary_path: "/bin/cbm" }),
    extract: async (_projectRoot: string, options: any) => collectExtraction(fakeGraph(project()), CONFIG, "cbm", options),
  } as unknown as AnalyzerBackend;
  const spawn: SpawnFn = () => Object.assign(new EventEmitter(), { pid: 60000, unref() {} }) as any;
  return {
    getAnalyzer: async (name) => (name === "cbm" ? backend : undefined),
    discover: async () => ({ found: [], selected: "cbm" }),
    spawn,
    drCommand: { command: "/usr/bin/node", args: ["/opt/dr/dist/cli.js"] },
    isAlive: () => true,
    gitHead: () => HEAD,
    codeChanges: async () => {
      throw new Error("no since in these tests");
    },
  };
}

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}
function ok(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return parse(result);
}

let rootPath: string;

beforeEach(async () => {
  clearModelCache();
  const dir = join(tmpdir(), `dr-verify-srcref-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdirAsync(dir, { recursive: true });
  rootPath = await realpath(dir);
  await Model.init(rootPath, { name: "Source Reference Adoption", version: "0.1.0" });
  await writeSession({ active_analyzer: "cbm", selected_at: new Date().toISOString() }, rootPath);
  await writeIndexMeta(META, rootPath, "cbm");
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

const extract = (args: Record<string, unknown>) => createCodebaseExtractHandler(deps())({ rootPath, ...args } as any);

async function manager(): Promise<{ model: Model; manager: StagingAreaManager }> {
  clearModelCache();
  const model = await Model.load(rootPath, { lazyLoad: false });
  return { model, manager: new StagingAreaManager(model.rootPath, model) };
}

/**
 * The /dr-plan flow up to verify: a plan that adds the helpers component (no source reference: the
 * code doesn't exist yet), the build, and an as-built changeset from codebase_extract in which the
 * agent staged the Helpers card. Returns the plan's id.
 */
async function planAndExtract(): Promise<{ planId: string; asBuiltId: string }> {
  const plan = ok(await changesetCreateHandler({ name: "add-helpers", description: "Add the string helpers.", rootPath }));
  ok(
    await modelAddHandler({
      layer: "application",
      type: "applicationcomponent",
      name: "helpers",
      description: "String formatting helpers.",
      attributes: { type: "internal" },
      rootPath,
    })
  );
  ok(await changesetDeactivateHandler({ rootPath }));

  // Verify: extract the build into an as-built changeset; Helpers is a card the agent stages.
  const first = ok(await extract({ changeset: "add-helpers-as-built" }));
  const card = (first.undecided?.items ?? []).find((c: any) => c.symbol === "Helpers");
  expect(card).toBeDefined();
  if (!first.changeset?.id) ok(await changesetCreateHandler({ name: "add-helpers-as-built", rootPath }));
  ok(
    await modelAddHandler({
      layer: "application",
      type: "applicationcomponent",
      name: "Helpers",
      attributes: { type: "internal" },
      sourceFile: card.file,
      sourceSymbol: card.symbol,
      sourceProvenance: "extracted",
      rootPath,
    })
  );
  // The re-run records the card the agent staged, so verify counts it as extraction's.
  const second = ok(await extract({ changeset: "add-helpers-as-built" }));
  clearModelCache();
  return { planId: plan.id, asBuiltId: second.changeset.id };
}

/** Land the plan and discard the as-built changeset, as /dr-plan does. */
async function landPlan(planId: string, asBuiltId: string): Promise<void> {
  const { model, manager: m } = await manager();
  await m.commit(model, planId, { validate: true });
  await m.discard(asBuiltId);
  await m.clearActive();
  clearModelCache();
}

describe("changeset_verify and the source references extraction found (#1096)", () => {
  it("lists matched plan elements whose as-built match has a source reference the plan lacks", async () => {
    const { asBuiltId } = await planAndExtract();

    const report = ok(await changesetVerifyHandler({ planned: "add-helpers", against: { changesetId: asBuiltId }, rootPath }));

    expect(report.elements.matched.map((m: any) => m.planned)).toContain(HELPERS);
    expect(report.sourceReferences.missing).toEqual([
      {
        planned: HELPERS,
        built: HELPERS,
        op: "add",
        match: "exact",
        plannedReference: null,
        missing: [{ file: HELPERS_FILE, symbol: "Helpers" }],
        adopt: { provenance: "extracted", locations: [{ file: HELPERS_FILE, symbol: "Helpers" }] },
      },
    ]);
    expect(report.sourceReferences.next).toContain("adoptSourceReferences: true");
    expect(report.sourceReferences.adopted).toBeUndefined();

    // Read-only without the option: the plan is unchanged.
    const { manager: m } = await manager();
    const plan = (await m.load("add-helpers"))!;
    expect(stagedSourceReference(plan.changes.find((c) => c.type === "add")!.after as any)).toBeUndefined();
  }, 120_000);

  it("reproduces the bug: a plan landed without them is offered again by the next extract", async () => {
    const { planId, asBuiltId } = await planAndExtract();
    await landPlan(planId, asBuiltId);

    const again = ok(await extract({ changeset: "after-landing" }));
    expect(again.unchanged.modelled).toBe(0);
    expect((again.undecided?.items ?? []).map((c: any) => c.symbol)).toContain("Helpers");
    // Staging the card again fails: the plan's element has its id.
    if (!again.changeset?.id) ok(await changesetCreateHandler({ name: "after-landing", rootPath }));
    const failed = await modelAddHandler({
      layer: "application",
      type: "applicationcomponent",
      name: "Helpers",
      attributes: { type: "internal" },
      sourceFile: HELPERS_FILE,
      sourceSymbol: "Helpers",
      sourceProvenance: "extracted",
      rootPath,
    });
    expect(failed.isError).toBe(true);
    expect((failed.content[0] as any).text).toContain("already exists");
  }, 120_000);

  it("adoptSourceReferences copies them onto the plan, and the next extract counts them as modelled", async () => {
    const { planId, asBuiltId } = await planAndExtract();

    const report = ok(
      await changesetVerifyHandler({
        planned: "add-helpers",
        against: { changesetId: asBuiltId },
        adoptSourceReferences: true,
        rootPath,
      })
    );
    expect(report.sourceReferences.adopted.map((g: any) => g.planned)).toEqual([HELPERS]);
    expect(report.sourceReferences.missing).toEqual([]);
    expect(report.sourceReferences.next).toContain("Copied the source references of 1 element(s)");

    // The plan's add carries the reference now, rewritten in place (no extra change).
    const { manager: m } = await manager();
    const plan = (await m.load("add-helpers"))!;
    const adds = plan.changes.filter((c) => c.type === "add");
    expect(adds).toHaveLength(1);
    expect(plan.changes.filter((c) => c.type === "update")).toHaveLength(0);
    expect(stagedSourceReference(adds[0].after as any)).toEqual({
      provenance: "extracted",
      locations: [{ file: HELPERS_FILE, symbol: "Helpers" }],
    });

    // Verify again: nothing left to copy, and the match stands.
    const after = ok(await changesetVerifyHandler({ planned: "add-helpers", against: { changesetId: asBuiltId }, rootPath }));
    expect(after.sourceReferences).toBeUndefined();
    expect(after.elements.matched.map((m: any) => m.planned)).toContain(HELPERS);

    // Land the plan; the next extract ties the landed element to the code.
    await landPlan(planId, asBuiltId);
    const { model } = await manager();
    const landed = model.getElementById?.(HELPERS) ?? model.layers.get("application")!.getElement(HELPERS);
    expect(landed?.getSourceReference()?.locations).toEqual([{ file: HELPERS_FILE, symbol: "Helpers" }]);

    const again = ok(await extract({ changeset: "after-landing" }));
    expect(again.unchanged.modelled).toBe(1);
    expect((again.undecided?.items ?? []).map((c: any) => c.symbol)).not.toContain("Helpers");
  }, 120_000);

  it("adds the reference with an update when the plan updates an existing element", async () => {
    // The element exists in the base without a reference; the plan updates its description.
    ok(
      await modelAddHandler({
        layer: "application",
        type: "applicationcomponent",
        name: "helpers",
        attributes: { type: "internal" },
        rootPath,
      })
    );
    clearModelCache();
    const plan = ok(await changesetCreateHandler({ name: "describe-helpers", rootPath }));
    const { modelUpdateHandler } = await import("../../src/mcp/tools/model-update.js");
    ok(await modelUpdateHandler({ id: HELPERS, description: "String formatting helpers.", rootPath } as any));
    ok(await changesetDeactivateHandler({ rootPath }));

    // The as-built changeset updates the element with the code's reference; extraction's record
    // lists the update (as codebase_extract writes it), so verify takes it as evidence.
    const asBuilt = ok(
      await changesetCreateHandler({
        name: "describe-helpers-as-built",
        description: "As-built extraction of the code at 1111111. Staged by codebase_extract.",
        rootPath,
      })
    );
    const extractDir = join(rootPath, ".dr", "analyzers", "extract");
    await mkdirAsync(extractDir, { recursive: true });
    await writeFile(
      join(extractDir, `${asBuilt.id.replace(/[^\w.-]/g, "_")}.json`),
      JSON.stringify({
        changesetId: asBuilt.id,
        changesetName: "describe-helpers-as-built",
        gitHead: HEAD,
        since: null,
        layers: null,
        createdAt: "",
        cards: [],
        staged: [],
        updated: [{ id: HELPERS, fields: ["source_reference"] }],
      })
    );
    ok(
      await modelUpdateHandler({
        id: HELPERS,
        description: "String formatting helpers.",
        sourceFile: HELPERS_FILE,
        sourceSymbol: "Helpers",
        sourceProvenance: "extracted",
        rootPath,
      } as any)
    );
    ok(await changesetDeactivateHandler({ rootPath }));
    clearModelCache();

    const report = ok(
      await changesetVerifyHandler({
        planned: plan.id,
        against: { changesetId: asBuilt.id },
        adoptSourceReferences: true,
        rootPath,
      })
    );
    // The as-built element was extracted, then its description edited: its reference is still extraction's.
    expect(report.elements.matched[0].editedAfterExtraction.map((e: any) => e.field)).toEqual(["description"]);
    expect(report.sourceReferences.adopted.map((g: any) => [g.planned, g.op])).toEqual([[HELPERS, "update"]]);

    const { manager: m } = await manager();
    const staged = (await m.load(plan.id))!;
    const updates = staged.changes.filter((c) => c.type === "update");
    expect(updates).toHaveLength(2);
    expect(stagedSourceReference(updates[1].after as any)?.locations).toEqual([{ file: HELPERS_FILE, symbol: "Helpers" }]);
    expect((updates[1].after as any).description).toBe("String formatting helpers.");
  }, 120_000);

  it("doesn't copy a reference from an as-built element extraction didn't stage", async () => {
    const plan = ok(await changesetCreateHandler({ name: "add-helpers", rootPath }));
    ok(await modelAddHandler({ layer: "application", type: "applicationcomponent", name: "helpers", attributes: { type: "internal" }, rootPath }));
    ok(await changesetDeactivateHandler({ rootPath }));
    // Written by hand: no codebase_extract record, whatever provenance it declares.
    const asBuilt = ok(await changesetCreateHandler({ name: "hand-written", rootPath }));
    ok(
      await modelAddHandler({
        layer: "application",
        type: "applicationcomponent",
        name: "helpers",
        attributes: { type: "internal" },
        sourceFile: HELPERS_FILE,
        sourceSymbol: "Helpers",
        sourceProvenance: "extracted",
        rootPath,
      })
    );
    ok(await changesetDeactivateHandler({ rootPath }));
    clearModelCache();

    const report = ok(
      await changesetVerifyHandler({ planned: plan.id, against: { changesetId: asBuilt.id }, adoptSourceReferences: true, rootPath })
    );
    expect(report.sourceReferences.missing.map((g: any) => [g.planned, g.builtByAgent])).toEqual([[HELPERS, true]]);
    expect(report.sourceReferences.adopted).toBeUndefined();
    expect(report.sourceReferences.skipped[0].reason).toContain("not staged by extraction");

    const { manager: m } = await manager();
    const staged = (await m.load(plan.id))!;
    expect(stagedSourceReference(staged.changes.find((c) => c.type === "add")!.after as any)).toBeUndefined();
  }, 120_000);
});
