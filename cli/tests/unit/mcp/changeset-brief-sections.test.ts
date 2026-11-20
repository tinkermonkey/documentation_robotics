/**
 * changeset_brief's sections on a plan too large to return whole (#1183, #1232), and what its intent
 * section counts as untraced (#1231, #1221).
 *
 * - A section comes in a compact form; together they stay within a budget, and `cut` says what was
 *   summarised or left out and the call that returns it.
 * - `detail: "full"` with sections returns those sections as the full brief has them.
 * - A part traces through the whole that composes it; an element whose type the catalog relates to
 *   no intent type is counted apart from the untraced; an empty intent says why.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { buildBrief, hasCatalogRouteToIntent } from "../../../src/core/changeset-analysis.js";
import { briefSections, compactIntent, gapLines, SECTIONS_BUDGET_BYTES } from "../../../src/core/changeset-brief-compact.js";
import { clearModelCache, loadModel } from "../../../src/mcp/tools/shared.js";
import { loadChangesetGraph } from "../../../src/mcp/tools/changeset-shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetBriefHandler, changesetBriefTool } from "../../../src/mcp/tools/changeset-analysis-tools.js";

function text(result: any): string {
  if (result.isError) throw new Error(result.content[0].text);
  return result.content[0].text;
}

const FEATURE = "product.feature.order-export";
const SERVICE = "application.applicationservice.checkout";
const VIEW = "ux.view.workstation-window";

let rootPath: string;

type NewElement = { layer: string; type: string; name: string; description?: string; attributes?: Record<string, unknown> };
type Triple = { source: string; predicate: string; target: string };

/** Stages (or, with no changeset active, writes) elements and relationships in one call each. */
async function addAll(elements: NewElement[], relationships: Triple[] = []): Promise<void> {
  const result = JSON.parse(text(await modelAddHandler({ elements, relationships, rootPath } as any)));
  const invalid = [...(result.elements?.results ?? []), ...(result.relationships?.results ?? [])].filter((r: any) => r.status === "invalid");
  if (invalid.length > 0) throw new Error(`invalid fixture: ${JSON.stringify(invalid[0])}`);
}

async function relate(source: string, predicate: string, target: string): Promise<void> {
  text(await relationshipAddHandler({ source, predicate, target, rootPath }));
}

async function brief(args: Record<string, unknown> = {}): Promise<{ json: any; bytes: number }> {
  const raw = text(await changesetBriefHandler({ ...(args as any), rootPath }));
  return { json: JSON.parse(raw), bytes: Buffer.byteLength(raw) };
}

/** The full brief of the active changeset, for calling the core functions with a small budget. */
async function fullBrief() {
  const model = await loadModel(rootPath);
  const { graph } = await loadChangesetGraph(model, undefined);
  return buildBrief({ graph });
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-brief-sections-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Brief Sections Model", version: "0.1.0" });
  await addAll(
    [
      { layer: "product", type: "feature", name: "order-export", attributes: { priority: "high", status: "planned" } },
      { layer: "application", type: "applicationservice", name: "checkout", attributes: { serviceType: "synchronous" } },
    ],
    [{ source: SERVICE, predicate: "realizes", target: FEATURE }]
  );
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

/**
 * A plan of `count` functions, each with a description, and as many orphan schemas. The functions
 * realize the plan's own services, ten to a service (so none is a hub), which realize the feature.
 */
async function planLarge(count: number): Promise<void> {
  await changesetCreateHandler({ name: "large-plan", description: "A plan too large to return whole.", rootPath });
  const services = Array.from({ length: Math.ceil(count / 10) }, (_, i) => ({
    layer: "application",
    type: "applicationservice",
    name: `export-stage-${i}`,
    attributes: { serviceType: "synchronous" },
  }));
  const functions = Array.from({ length: count }, (_, i) => ({
    layer: "application",
    type: "applicationfunction",
    name: `export-step-number-${i}`,
    description: `Step ${i} of the export. ${"Streams rows in batches. ".repeat(6)}`,
  }));
  const schemas = Array.from({ length: count }, (_, i) => ({
    layer: "data-model",
    type: "objectschema",
    name: `export-row-shape-${i}`,
    attributes: { type: "object" },
  }));
  await addAll(
    [...services, ...functions, ...schemas],
    [
      ...services.map((s) => ({ source: `application.applicationservice.${s.name}`, predicate: "realizes", target: FEATURE })),
      ...functions.map((f, i) => ({
        source: `application.applicationfunction.${f.name}`,
        predicate: "realizes",
        target: `application.applicationservice.export-stage-${Math.floor(i / 10)}`,
      })),
    ]
  );
}

describe("changeset_brief sections within one tool result (#1183, #1232)", () => {
  it("returns intent as counts and the untraced, not the traced list with its paths (#1232)", async () => {
    await planLarge(40);
    const { json, bytes } = await brief({ sections: ["intent"] });
    // 4 services and their 40 functions trace to the feature; 40 schemas are connected to nothing.
    expect(json.intent.counts).toEqual({ traced: 44, untraced: 40 });
    // More than 30 traced: counted. The untraced are what the agent acts on: every id.
    expect(json.intent.traced).toBeUndefined();
    expect(json.intent.untraced).toHaveLength(40);
    expect(json.intent.untraced[0]).toBe("data-model.objectschema.export-row-shape-0");
    expect(json.cut).toBeUndefined();
    expect(bytes).toBeLessThan(4_000);

    // The traces, each with its path, are a call away.
    const full = await brief({ sections: ["intent"], detail: "full" });
    expect(full.json.detail).toBe("full");
    expect(full.json.intent.traced).toHaveLength(44);
    expect(full.json.intent.traced.find((t: any) => t.element === "application.applicationfunction.export-step-number-12").path).toEqual([
      "application.applicationfunction.export-step-number-12",
      "application.applicationservice.export-stage-1",
      FEATURE,
    ]);
    expect(full.bytes).toBeGreaterThan(bytes * 3);
    // Only the section asked for, though the detail is full.
    expect(full.json.layers).toBeUndefined();
    expect(full.json.gaps).toBeUndefined();

    // A few elements: the traced come as lines saying what each traces to.
    const few = (await brief({ sections: ["intent"], ids: ["application.applicationfunction.export-step-number-3"] })).json;
    expect(few.intent).toEqual({
      counts: { traced: 1, untraced: 0 },
      traced: [`application.applicationfunction.export-step-number-3 → ${FEATURE}`],
      untraced: [],
    });
  });

  it("summarises a long untraced list per type when it does not fit, and says how to get the ids", async () => {
    await planLarge(40);
    const full = await fullBrief();
    const small = briefSections(full, ["gaps", "intent"], { budgetBytes: 3_000 });
    expect(Buffer.byteLength(JSON.stringify(small, null, 2))).toBeLessThanOrEqual(3_000);
    expect(small.intent).toMatchObject({
      counts: { traced: 44, untraced: 40 },
      untracedByType: [{ type: "data-model.objectschema", count: 40 }],
    });
    // 40 unconnected schemas say the same thing: one line.
    expect(small.gaps).toHaveLength(1);
    expect((small.gaps as string[])[0]).toMatch(/^unconnected: .* \(40 elements: data-model\.objectschema\.export-row-shape-0, .*\+35 more\)$/);
    expect(small.cut?.map((c) => c.section).sort()).toEqual(["gaps", "intent"]);
    for (const cut of small.cut ?? []) {
      expect(cut.summarised).toBeDefined();
      expect(cut.how).toContain('detail: "full"');
    }

    // The same call with room for it lists every gap and every untraced id, and reports no cut.
    const roomy = briefSections(full, ["gaps", "intent"]);
    expect(roomy.gaps).toHaveLength(40);
    expect((roomy.intent as any).untraced).toHaveLength(40);
    expect(roomy.cut).toBeUndefined();
  });

  it("cuts the build view to the budget and pages it with offset, saying what is left (#1183)", async () => {
    await planLarge(40);
    const full = await fullBrief();
    const budget = 6_000;
    const seen = new Set<string>();
    let offset = 0;
    for (let page = 0; page < 40; page++) {
      const result = briefSections(full, ["changes"], { filter: { layers: ["application"] }, offset, budgetBytes: budget });
      expect(Buffer.byteLength(JSON.stringify(result, null, 2))).toBeLessThanOrEqual(budget);
      expect(result.changes!.length).toBeGreaterThan(0);
      for (const c of result.changes!) seen.add(c.id);
      const cut = result.cut?.find((c) => c.section === "changes");
      if (!cut) break;
      expect(cut).toMatchObject({ of: 44, shown: result.changes!.length, unit: "elements", nextOffset: offset + result.changes!.length });
      expect(cut.byType).toEqual({ "application.applicationservice": 4, "application.applicationfunction": 40 });
      expect(cut.how).toContain(`offset: ${cut.nextOffset}`);
      offset = cut.nextOffset!;
    }
    // Every element of the layer, once, and none of the other layer's.
    expect(seen.size).toBe(44);
    expect([...seen].every((id) => id.startsWith("application."))).toBe(true);

    // Past the end: an empty list and a line saying so.
    const past = briefSections(full, ["changes"], { filter: { layers: ["application"] }, offset: 99 });
    expect(past.changes).toEqual([]);
    expect(past.more).toContain("offset 99 is past the 44 elements the filter keeps");
  });

  it("shares the budget so a small section keeps its list when a large one is cut", async () => {
    await planLarge(40);
    const full = await fullBrief();
    const result = briefSections(full, ["changes", "relationshipChanges", "acceptedGaps"], { budgetBytes: 8_000 });
    expect(Buffer.byteLength(JSON.stringify(result, null, 2))).toBeLessThanOrEqual(8_000);
    expect(result.relationshipChanges).toEqual([]);
    expect(result.acceptedGaps).toEqual([]);
    expect(result.cut?.map((c) => c.section)).toEqual(["changes"]);
    expect(result.changes!.length).toBeGreaterThan(5);
  });

  it("keeps a real 80-element answer within the 40 KB budget through the tool", async () => {
    await planLarge(110);
    for (const args of [{ sections: ["changes"] }, { sections: ["layers"] }, { sections: ["changes", "layers", "gaps", "intent", "codeTouched"] }]) {
      const { json, bytes } = await brief(args);
      expect(bytes).toBeLessThanOrEqual(SECTIONS_BUDGET_BYTES);
      expect(json.cut.length).toBeGreaterThan(0);
      expect(json.more).toContain("cut says what was summarised or left out");
    }
    // A filtered section costs what it returns: one element, one element's bytes.
    const one = await brief({ sections: ["changes", "intent", "gaps"], ids: ["data-model.objectschema.export-row-shape-7"] });
    expect(one.json.changes).toHaveLength(1);
    expect(one.json.intent.untraced).toEqual(["data-model.objectschema.export-row-shape-7"]);
    expect(one.json.gaps).toHaveLength(1);
    expect(one.json.cut).toBeUndefined();
    expect(one.bytes).toBeLessThan(2_500);
  }, 60_000);

  it("lists the connections a change adds and counts the rest per predicate and layer (#1183)", async () => {
    // A service with 12 test cases, as a sync changeset stages them.
    await changesetCreateHandler({ name: "sync", description: "Sync.", rootPath });
    const tests = Array.from({ length: 12 }, (_, i) => ({
      layer: "testing",
      type: "testcasesketch",
      name: `export-case-${i}`,
      attributes: { status: "automated", implementationFormat: "automated" },
    }));
    await addAll(
      [{ layer: "application", type: "applicationservice", name: "exporter", attributes: { serviceType: "synchronous" } }, ...tests],
      [
        { source: "application.applicationservice.exporter", predicate: "realizes", target: FEATURE },
        ...tests.map((t) => ({ source: `testing.testcasesketch.${t.name}`, predicate: "tests", target: "application.applicationservice.exporter" })),
      ]
    );
    const exporter = (json: any) => json.layers.find((l: any) => l.layer === "application").changes[0];

    // By default 8 of a group are listed and the rest counted.
    const all = exporter((await brief({ sections: ["layers"], layers: ["application"] })).json);
    expect(all.connections).toContain(`realizes → ${FEATURE}`);
    expect(all.connections.filter((c: string) => c.startsWith("tests ← "))).toHaveLength(8);
    expect(all.connectionCounts).toEqual({ "tests ← testing": 4 });

    // otherLayers leaves the test cases out of the listing: one count.
    const narrowed = exporter((await brief({ sections: ["layers"], layers: ["application"], otherLayers: ["product", "application"] })).json);
    expect(narrowed.connections).toEqual([`realizes → ${FEATURE}`]);
    expect(narrowed.connectionCounts).toEqual({ "tests ← testing": 12 });
    expect(narrowed).toMatchObject({ op: "added", type: "applicationservice", name: "exporter", attributes: { serviceType: "synchronous" } });

    // In full: every connection, with the other end's name and layer.
    const full = exporter((await brief({ sections: ["layers"], layers: ["application"], detail: "full" })).json);
    expect(full.connections).toHaveLength(13);
    expect(full.connections[0].otherLayer).toBeDefined();
  });

  it("counts unchanged connections of an updated element instead of listing them", async () => {
    await addAll(
      Array.from({ length: 5 }, (_, i) => ({ layer: "application", type: "applicationfunction", name: `existing-step-${i}` })),
      Array.from({ length: 5 }, (_, i) => ({ source: `application.applicationfunction.existing-step-${i}`, predicate: "realizes", target: SERVICE }))
    );
    await changesetCreateHandler({ name: "rework", description: "Rework.", rootPath });
    const { modelUpdateHandler } = await import("../../../src/mcp/tools/model-update.js");
    text(await modelUpdateHandler({ id: SERVICE, description: "Now asynchronous.", rootPath } as any));
    await addAll([{ layer: "application", type: "applicationfunction", name: "new-step" }], [
      { source: "application.applicationfunction.new-step", predicate: "realizes", target: SERVICE },
    ]);
    const { json } = await brief({ sections: ["layers"], ids: [SERVICE] });
    const service = json.layers[0].changes[0];
    expect(service.connections).toEqual(["realizes ← application.applicationfunction.new-step"]);
    expect(service.connectionCounts).toEqual({ "realizes → product (base)": 1, "realizes ← application (base)": 5 });
    expect(service.changedFields).toEqual([{ field: "description", before: undefined, after: "Now asynchronous." }]);
  });

  it("gives unwired connections per type past 25 elements, and codeTouched for the filter's elements", async () => {
    await changesetCreateHandler({ name: "services", description: "Services.", rootPath });
    await addAll(
      Array.from({ length: 30 }, (_, i) => ({
        layer: "application",
        type: "applicationservice",
        name: `worker-${i}`,
        attributes: { serviceType: "synchronous" },
        sourceFile: `src/workers/worker-${i}.ts`,
        sourceProvenance: "manual",
      })) as any
    );
    const { json } = await brief({ sections: ["unwired", "codeTouched"], unwiredLayers: ["product"] });
    expect(json.unwired.elements).toBeUndefined();
    const services = json.unwired.byType.find((t: any) => t.type === "application.applicationservice");
    expect(services).toMatchObject({ elements: 30, more: 25 });
    expect(services.byLayer[0].entries).toContain("out realizes product.feature (1 existing, 0 added): 30 elements");
    expect(json.cut.find((c: any) => c.section === "unwired").how).toContain("ids (up to 25 elements)");
    expect(json.codeTouched).toHaveLength(30);
    expect(json.codeTouched[0]).toEqual({ file: "src/workers/worker-0.ts", changed: ["application.applicationservice.worker-0"] });

    // A few elements: each element's own entries, as before.
    const few = (await brief({ sections: ["unwired", "codeTouched"], unwiredLayers: ["product"], ids: ["application.applicationservice.worker-3"] })).json;
    expect(few.unwired.elements).toHaveLength(1);
    expect(few.unwired.elements[0].byLayer[0].entries[0]).toMatchObject({ direction: "out", predicate: "realizes" });
    expect(few.codeTouched).toEqual([{ file: "src/workers/worker-3.ts", changed: ["application.applicationservice.worker-3"] }]);
    expect(few.cut).toBeUndefined();
  });

  it("groups peer-pattern gaps of one type that lack the same connection", () => {
    const gap = (i: number) => ({
      kind: "peer-pattern" as const,
      element: `application.applicationfunction.step-${i}`,
      detail: `${i + 2} of ${i + 3} existing application.applicationfunction elements wired like this one have --accesses--> data-model.objectschema; this one has none.`,
      connection: { direction: "out" as const, predicate: "accesses", otherType: "data-model.objectschema" },
    });
    const lines = gapLines([gap(0), gap(1), gap(2)], { group: true });
    expect(lines).toEqual([
      "peer-pattern: most existing application.applicationfunction elements wired like these have --accesses--> data-model.objectschema; " +
        "these have none (3 elements: application.applicationfunction.step-0, application.applicationfunction.step-1, application.applicationfunction.step-2)",
    ]);
    // One gap keeps its own line, counts and all.
    expect(gapLines([gap(0)], { group: true })).toEqual([`${gap(0).element}: peer-pattern: ${gap(0).detail}`]);
  });

  it("describes the sections' budget, offset and full form", () => {
    expect(changesetBriefTool.description).toContain("offset");
    expect(Object.keys(changesetBriefTool.inputSchema)).toEqual(expect.arrayContaining(["offset", "otherLayers"]));
    expect((changesetBriefTool.inputSchema.sections as any).description).toContain("40 KB");
  });
});

describe("changeset_brief intent: what counts as untraced (#1231, #1221)", () => {
  it("traces a part through the whole that composes it, past a hub", async () => {
    await changesetCreateHandler({ name: "workstation", description: "The workstation window.", rootPath });
    // A view with 18 sub-views is a hub: the bounded walk reaches it and does not go through it.
    const subviews = Array.from({ length: 18 }, (_, i) => ({ layer: "ux", type: "subview", name: `panel-${i}` }));
    await addAll(
      [{ layer: "ux", type: "view", name: "workstation-window", attributes: { type: "page" } }, ...subviews, { layer: "ux", type: "subview", name: "floating-palette" }],
      [
        { source: VIEW, predicate: "realizes", target: FEATURE },
        ...subviews.map((s) => ({ source: VIEW, predicate: "composes", target: `ux.subview.${s.name}` })),
      ]
    );
    const full = (await brief({ sections: ["intent"], detail: "full" })).json.intent;
    expect(full.traced).toHaveLength(19);
    expect(full.traced.find((t: any) => t.element === "ux.subview.panel-4")).toEqual({
      element: "ux.subview.panel-4",
      tracesTo: FEATURE,
      distance: 2,
      path: ["ux.subview.panel-4", VIEW, FEATURE],
      through: VIEW,
    });
    // The view traces by its own walk: no `through`.
    expect(full.traced.find((t: any) => t.element === VIEW).through).toBeUndefined();
    expect(full.untraced).toEqual([]);

    // A sub-view nothing composes cannot be linked to intent itself: counted apart, with the reason.
    expect(hasCatalogRouteToIntent("ux.subview")).toBe(false);
    expect(hasCatalogRouteToIntent("ux.view")).toBe(true);
    expect(full.noCatalogRoute).toEqual(["ux.subview.floating-palette"]);

    const compact = (await brief({ sections: ["intent"] })).json.intent;
    expect(compact.counts).toEqual({ traced: 19, untraced: 0, noCatalogRoute: 1 });
    expect(compact.traced).toContain(`ux.subview.panel-4 → ${FEATURE} (through ${VIEW})`);
    expect(compact.untraced).toEqual([]);
    expect(compact.noCatalogRoute).toMatchObject({ byType: { "ux.subview": 1 }, ids: ["ux.subview.floating-palette"] });
    expect(compact.noCatalogRoute.note).toContain("not counted as untraced");

    // The default brief counts the same way.
    const byDefault = (await brief()).json.intent;
    expect(byDefault.counts).toEqual({ traced: 19, untraced: 0, noCatalogRoute: 1 });
    expect(byDefault.traced).toContain("ux.subview.panel-4");
  });

  it("follows wholes of wholes, and leaves the parts of an untraced whole untraced", async () => {
    await changesetCreateHandler({ name: "nested", description: "Nested parts.", rootPath });
    await addAll(
      [
        { layer: "ux", type: "view", name: "workstation-window", attributes: { type: "page" } },
        { layer: "ux", type: "view", name: "orphan-window", attributes: { type: "page" } },
        { layer: "ux", type: "subview", name: "top-bar" },
        { layer: "ux", type: "subview", name: "orphan-bar" },
        ...Array.from({ length: 16 }, (_, i) => ({ layer: "ux", type: "componentinstance", name: `button-${i}` })),
      ],
      [
        { source: VIEW, predicate: "realizes", target: FEATURE },
        { source: VIEW, predicate: "composes", target: "ux.subview.top-bar" },
        { source: "ux.view.orphan-window", predicate: "composes", target: "ux.subview.orphan-bar" },
        ...Array.from({ length: 16 }, (_, i) => ({ source: "ux.subview.top-bar", predicate: "composes", target: `ux.componentinstance.button-${i}` })),
      ]
    );
    const intent = (await brief({ sections: ["intent"], detail: "full" })).json.intent;
    // A button's own walk stops at the top bar (a hub of 17); it traces through it.
    expect(intent.traced.find((t: any) => t.element === "ux.componentinstance.button-9")).toMatchObject({
      tracesTo: FEATURE,
      through: "ux.subview.top-bar",
      path: ["ux.componentinstance.button-9", "ux.subview.top-bar", VIEW, FEATURE],
    });
    // The orphan view can be linked to a feature and is not: untraced. Its sub-view cannot: apart.
    expect(intent.untraced).toEqual(["ux.view.orphan-window"]);
    expect(intent.noCatalogRoute).toEqual(["ux.subview.orphan-bar"]);
  });

  it("explains an empty intent for a plan made only of intent elements (#1221)", async () => {
    await addAll([{ layer: "motivation", type: "goal", name: "model-stays-as-built", attributes: { priority: "high" } }]);
    await changesetCreateHandler({ name: "record-upgrade-drops", description: "Two requirements and a feature.", rootPath });
    await addAll(
      [
        { layer: "motivation", type: "requirement", name: "a-migration-records-what-it-drops", attributes: { requirementType: "functional", priority: "high" } },
        { layer: "product", type: "feature", name: "upgrade-drop-record", attributes: { priority: "high", status: "planned" } },
      ],
      [
        { source: "product.feature.upgrade-drop-record", predicate: "satisfies", target: "motivation.requirement.a-migration-records-what-it-drops" },
        { source: "motivation.requirement.a-migration-records-what-it-drops", predicate: "realizes", target: "motivation.goal.model-stays-as-built" },
      ]
    );
    const note = "Nothing to trace: all 2 changed elements are motivation, business or product elements.";
    const byDefault = (await brief()).json.intent;
    expect(byDefault.counts).toEqual({ traced: 0, untraced: 0 });
    expect(byDefault.untraced).toEqual([]);
    expect(byDefault.note).toContain(note);
    expect(byDefault.note).toContain("are not listed");
    expect((await brief({ sections: ["intent"] })).json.intent.note).toContain(note);
    expect((await brief({ detail: "full" })).json.intent).toEqual({ traced: [], untraced: [], note: expect.stringContaining(note) });

    // One element outside the intent layers: it is traced, and there is nothing to explain.
    await addAll([{ layer: "application", type: "applicationfunction", name: "record-drops" }], [
      { source: "application.applicationfunction.record-drops", predicate: "satisfies", target: "motivation.requirement.a-migration-records-what-it-drops" },
    ]);
    const mixed = (await brief()).json.intent;
    expect(mixed.counts).toEqual({ traced: 1, untraced: 0 });
    expect(mixed.note).toBeUndefined();

    // The tool says what intent covers.
    expect(changesetBriefTool.description).toContain("outside motivation, business and product");
    expect(changesetBriefTool.description).toContain("has nothing to trace and says so");
  });

  it("gives the compact intent's untraced per type with the first ids when the list is long", () => {
    const ids = (type: string, n: number) => Array.from({ length: n }, (_, i) => `${type}.item-${i}`);
    const intent = {
      traced: ids("api.operation", 31).map((element) => ({ element, tracesTo: FEATURE, distance: 1, path: [element, FEATURE] })),
      untraced: [...ids("application.applicationfunction", 40), ...ids("data-model.objectschema", 3)],
      unanchored: [{ element: "data-model.objectschema.item-0", tracesTo: "product.feature.new", path: [], detail: "" }],
      noCatalogRoute: ids("application.applicationcomponent", 2),
    };
    expect(compactIntent(intent)).toEqual({
      counts: { traced: 31, untraced: 43, unanchored: 1, noCatalogRoute: 2 },
      untracedByType: [
        { type: "application.applicationfunction", count: 40, ids: ids("application.applicationfunction", 5), more: 35 },
        { type: "data-model.objectschema", count: 3, ids: ids("data-model.objectschema", 3) },
      ],
      unanchored: ["data-model.objectschema.item-0 → product.feature.new"],
      noCatalogRoute: {
        byType: { "application.applicationcomponent": 2 },
        ids: ids("application.applicationcomponent", 2),
        note: expect.stringContaining("trace only through a neighbour"),
      },
    });
    // With room for the list: every untraced id.
    expect(compactIntent(intent, { listLimit: Infinity }).untraced).toHaveLength(43);
  });
});
