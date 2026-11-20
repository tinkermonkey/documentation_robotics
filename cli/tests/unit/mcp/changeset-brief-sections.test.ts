/**
 * changeset_brief's sections on a plan too large to return whole (#1183, #1232), and what its intent
 * section counts as untraced (#1231, #1221).
 *
 * - A section comes in a compact form. A long list comes a page at a time, sized to a target the
 *   caller can change: `pages` has each list's true total, how many items the answer holds and the
 *   call for the next page. No limit puts an item out of reach or lets a page read as the whole.
 * - `detail: "full"` with sections returns those sections as the full brief has them.
 * - A part traces through the whole that composes it; an element whose type the catalog relates to
 *   no intent type is counted apart from the untraced; an empty intent says why.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { buildBrief, computeImpact, hasCatalogRouteToIntent, type ChangesetBrief } from "../../../src/core/changeset-analysis.js";
import {
  BRIEF_SECTIONS,
  briefSections,
  compactDelta,
  compactIntent,
  gapLines,
  SECTIONS_TARGET_BYTES,
  type BriefSection,
  type DeltaPage,
  type SectionsOptions,
} from "../../../src/core/changeset-brief-compact.js";
import type { BriefDelta } from "../../../src/core/changeset-brief-delta.js";
import { clearModelCache, loadModel } from "../../../src/mcp/tools/shared.js";
import { loadChangesetGraph } from "../../../src/mcp/tools/changeset-shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import {
  changesetBriefHandler,
  changesetBriefTool,
  changesetImpactHandler,
  changesetImpactTool,
} from "../../../src/mcp/tools/changeset-analysis-tools.js";

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

/** The full brief of the active changeset, for calling the core functions with a small target. */
async function fullBrief() {
  const model = await loadModel(rootPath);
  const { graph } = await loadChangesetGraph(model, undefined);
  return buildBrief({ graph });
}

/** An unwired listing with one entry per changed element, for paging it. */
function buildBriefUnwired(full: ChangesetBrief): NonNullable<ChangesetBrief["unwired"]> {
  const elements = full.layers.flatMap((l) => l.changes).map((c) => ({
    element: c.id,
    type: c.id.split(".").slice(0, 2).join("."),
    total: 1,
    byLayer: [
      {
        layer: "product",
        count: 1,
        entries: [{ direction: "out" as const, predicate: "realizes", otherType: "product.feature", existingCount: 1, addedCount: 0 }],
      },
    ],
  }));
  return { mode: "summary", elements };
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

/** The items of a section's value, in order: what a page holds. */
function itemsOf(section: BriefSection, result: any): unknown[] {
  switch (section) {
    case "layers":
      return result.layers.flatMap((l: any) => l.changes.map((c: any) => c.id));
    case "changes":
      return result.changes.map((c: any) => c.id);
    case "intent":
      return result.intent.untraced;
    case "unwired":
      return result.unwired.elements.map((e: any) => e.element);
    case "alreadyInBase":
      return [...result.alreadyInBase.elements, ...result.alreadyInBase.relationships.map((r: any) => `${r.source}|${r.target}`)];
    case "codeTouched":
      return result.codeTouched.map((f: any) => f.file);
    default:
      return result[section].map((item: unknown) => JSON.stringify(item));
  }
}

/** Reads a section page by page, following nextOffset, and returns every item with the pages' totals. */
function readAll(full: ChangesetBrief, section: BriefSection, options: SectionsOptions) {
  const items: unknown[] = [];
  const totals = new Set<number>();
  let pages = 0;
  for (let offset: number | undefined = 0; offset !== undefined && pages < 500; pages++) {
    const result = briefSections(full, [section], { ...options, offset });
    const page = result.pages![section]!;
    const got = itemsOf(section, result);
    expect(page.returned).toBe(got.length);
    expect(got.length).toBeGreaterThan(0);
    // The next call is this call's arguments with the next offset.
    if (page.nextOffset !== undefined) expect(page.next).toBe(`changeset_brief ${JSON.stringify({ sections: [section], offset: page.nextOffset })}`);
    else expect(page.next).toBeUndefined();
    items.push(...got);
    totals.add(page.total);
    offset = page.nextOffset;
  }
  return { items, totals: [...totals], pages };
}

describe("changeset_brief sections: long lists page, nothing is dropped (#1183, #1232)", () => {
  it("returns intent as counts and the untraced, not the traced list with its paths (#1232)", async () => {
    await planLarge(40);
    const { json, bytes } = await brief({ sections: ["intent"] });
    // 4 services and their 40 functions trace to the feature; 40 schemas are connected to nothing.
    expect(json.intent.counts).toEqual({ traced: 44, untraced: 40 });
    // More than 30 traced: counted. The untraced are what the agent acts on: every id.
    expect(json.intent.traced).toBeUndefined();
    expect(json.intent.untraced).toHaveLength(40);
    expect(json.intent.untraced[0]).toBe("data-model.objectschema.export-row-shape-0");
    // The list is whole, and the answer says so.
    expect(json.pages).toEqual({ intent: { total: 40, returned: 40, unit: "untraced elements" } });
    expect(json.intent.untracedByType).toBeUndefined();
    expect(json.more).toContain("Every list is whole");
    expect(bytes).toBeLessThan(4_500);

    // A larger limit lists the traced too: the default of 30 is the caller's to change.
    const listed = (await brief({ sections: ["intent"], limit: 100 })).json.intent;
    expect(listed.traced).toHaveLength(44);

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

  it("gives a page and a summary of the whole when a list is past the target, with the call for the rest", async () => {
    await planLarge(40);
    const full = await fullBrief();
    const small = briefSections(full, ["gaps", "intent"], { targetBytes: 3_000 });
    expect(Buffer.byteLength(JSON.stringify(small, null, 2))).toBeLessThanOrEqual(3_000);

    // Counts are over all 40 untraced elements, though the answer holds a page of their ids.
    const intent = small.intent as any;
    const page = small.pages!.intent!;
    expect(intent.counts).toEqual({ traced: 44, untraced: 40 });
    expect(intent.untracedByType).toEqual([{ type: "data-model.objectschema", count: 40 }]);
    expect(page.total).toBe(40);
    expect(page.returned).toBe(intent.untraced.length);
    expect(page.returned).toBeLessThan(40);
    expect(page.nextOffset).toBe(page.returned);
    expect(page.next).toBe(`changeset_brief ${JSON.stringify({ sections: ["intent"], offset: page.returned })}`);

    // The gaps: a page of lines, and every gap counted by kind and by type.
    const gaps = small.pages!.gaps!;
    expect(gaps.total).toBe(40);
    expect(gaps.returned).toBe((small.gaps as string[]).length);
    expect(gaps.summary).toEqual({ byKind: { unconnected: 40 }, byType: { "data-model.objectschema": 40 } });
    expect(small.more).toContain(`gaps holds ${gaps.returned} of 40 gaps`);
    expect(small.more).toContain(`intent holds ${page.returned} of 40 untraced elements`);
    expect(small.more).toContain("targetBytes");

    // Following the pages reaches every untraced id and every gap, once.
    const untraced = readAll(full, "intent", { targetBytes: 3_000 });
    expect(untraced.items).toEqual(full.intent.untraced);
    expect(untraced.totals).toEqual([40]);
    expect(untraced.pages).toBeGreaterThan(1);
    const lines = readAll(full, "gaps", { targetBytes: 3_000 });
    expect(lines.items).toHaveLength(40);
    expect(new Set(lines.items).size).toBe(40);

    // The same call with room for it returns both lists whole, and says so.
    const roomy = briefSections(full, ["gaps", "intent"]);
    expect(roomy.gaps).toHaveLength(40);
    expect((roomy.intent as any).untraced).toHaveLength(40);
    expect(roomy.pages).toEqual({
      gaps: { total: 40, returned: 40, unit: "gaps" },
      intent: { total: 40, returned: 40, unit: "untraced elements" },
    });
  });

  it("pages the build view by size, and by limit when the caller names one (#1183)", async () => {
    await planLarge(40);
    const full = await fullBrief();
    const filter = { layers: ["application"] };
    const callArgs = { layers: ["application"] };
    const target = 6_000;
    const seen: string[] = [];
    let offset: number | undefined = 0;
    for (let page = 0; offset !== undefined && page < 60; page++) {
      const result = briefSections(full, ["changes"], { filter, offset, targetBytes: target, callArgs });
      expect(Buffer.byteLength(JSON.stringify(result, null, 2))).toBeLessThanOrEqual(target);
      const info = result.pages!.changes!;
      // The total is the filter's 44 elements on every page; the summary counts them all by type.
      expect(info).toMatchObject({ total: 44, returned: result.changes!.length, unit: "elements" });
      expect(result.changes!.length).toBeGreaterThan(0);
      if (info.nextOffset !== undefined) {
        expect(info.summary).toEqual({ byType: { "application.applicationservice": 4, "application.applicationfunction": 40 } });
        expect(info.next).toBe(`changeset_brief ${JSON.stringify({ layers: ["application"], sections: ["changes"], offset: info.nextOffset })}`);
      }
      seen.push(...result.changes!.map((c) => c.id));
      offset = info.nextOffset;
    }
    // Every element of the layer, once, in the full list's order, and none of the other layer's.
    const whole = briefSections(full, ["changes"], { filter, full: true }).changes!.map((c) => c.id);
    expect(seen).toEqual(whole);
    expect(seen).toHaveLength(44);

    // A limit is the page size whatever the bytes: 44 elements in one answer, past the target.
    const all = briefSections(full, ["changes"], { filter, limit: 100, targetBytes: target });
    expect(all.changes).toHaveLength(44);
    expect(all.pages!.changes).toEqual({ total: 44, returned: 44, unit: "elements" });
    expect(Buffer.byteLength(JSON.stringify(all, null, 2))).toBeGreaterThan(target);
    const ten = briefSections(full, ["changes"], { filter, limit: 10, offset: 40 });
    expect(ten.changes!.map((c) => c.id)).toEqual(whole.slice(40));
    // The last page: no next call, and still the count of all 44.
    expect(ten.pages!.changes).toMatchObject({ total: 44, returned: 4, unit: "elements", offset: 40 });
    expect(ten.pages!.changes!.nextOffset).toBeUndefined();
    expect(ten.pages!.changes!.next).toBeUndefined();

    // A target too small for one element still returns one: a target, not a cut-off.
    const tiny = briefSections(full, ["changes"], { filter, targetBytes: 200 });
    expect(tiny.changes).toHaveLength(1);
    expect(tiny.pages!.changes).toMatchObject({ total: 44, returned: 1, nextOffset: 1 });

    // Past the end: an empty page, the true total, and a line saying so.
    const past = briefSections(full, ["changes"], { filter, offset: 99 });
    expect(past.changes).toEqual([]);
    expect(past.pages!.changes).toMatchObject({ total: 44, returned: 0, unit: "elements", offset: 99 });
    expect(past.pages!.changes!.nextOffset).toBeUndefined();
    expect(past.more).toContain("offset 99 is past the 44 elements of changes the filter keeps");
  });

  it("keeps a short list whole when a long one beside it is paged", async () => {
    await planLarge(40);
    const full = await fullBrief();
    const result = briefSections(full, ["changes", "gaps"], { filter: { layers: ["application", "data-model"] }, targetBytes: 22_000 });
    expect(Buffer.byteLength(JSON.stringify(result, null, 2))).toBeLessThanOrEqual(22_000);
    // The 40 gap lines fit their share; the build view takes the rest and pages.
    expect(result.pages!.gaps).toEqual({ total: 40, returned: 40, unit: "gaps" });
    expect(result.pages!.changes).toMatchObject({ total: 84, unit: "elements" });
    expect(result.pages!.changes!.returned).toBeLessThan(84);
    expect(result.pages!.changes!.returned).toBeGreaterThan(5);
  });

  it("pages every list section to its whole set, with the true total on each page (limit and target)", async () => {
    await planLarge(40);
    const base = await fullBrief();
    // The sections a plan like this leaves short, filled so each has more items than a page.
    const many = <T>(make: (i: number) => T): T[] => Array.from({ length: 53 }, (_, i) => make(i));
    const full: ChangesetBrief = {
      ...base,
      relationshipChanges: many((i) => ({ status: "added", source: `application.applicationservice.a-${i}`, predicate: "serves", target: SERVICE })),
      alreadyInBase: {
        elements: many((i) => `application.applicationfunction.landed-${i}`).slice(0, 30),
        relationships: many((i) => ({ source: `application.applicationfunction.landed-${i}`, predicate: "realizes", target: SERVICE })).slice(0, 23),
      },
      acceptedGaps: many((i) => ({
        element: `application.applicationfunction.export-step-number-${i % 40}`,
        direction: "incoming" as const,
        predicate: "realizes",
        otherType: `api.operation-${i}`,
        reason: "No API exposes it",
        decidedBy: "agent",
        decidedAt: "2026-11-20T00:00:00.000Z",
      })) as any,
      feedback: many((i) => ({ annotationId: `ann-${i}`, elementId: SERVICE, author: "reviewer", content: `Comment ${i}`, tags: [], replies: 0 })),
      codeTouched: many((i) => ({
        file: `src/export/step-${i}.ts`,
        elements: [{ id: `application.applicationfunction.export-step-number-${i % 40}`, role: "changed" as const }],
      })),
    };
    const withUnwired = { ...full, unwired: buildBriefUnwired(full) };
    const expected: Record<string, number> = {
      changes: 84,
      layers: 84,
      gaps: 40,
      intent: 40,
      unwired: 84,
      codeTouched: 53,
      relationshipChanges: 53,
      alreadyInBase: 53,
      acceptedGaps: 53,
      feedback: 53,
    };
    // Every section but the two that are not lists, and the delta (paged apart, below).
    const listSections = BRIEF_SECTIONS.filter((section) => !["changeset", "drift", "delta"].includes(section));
    expect(Object.keys(expected).sort()).toEqual([...listSections].sort());
    for (const section of listSections) {
      const whole = itemsOf(section, briefSections(withUnwired, [section], { limit: 10_000 }));
      expect(whole).toHaveLength(expected[section]);
      for (const options of [{ limit: 7 }, { targetBytes: 2_500 }]) {
        const read = readAll(withUnwired, section, options);
        // The pages together are the whole set, in order, and each page reported the same total.
        expect(read.items).toEqual(whole);
        expect(read.totals).toEqual([expected[section]]);
        if (expected[section] > 7) expect(read.pages).toBeGreaterThan(1);
      }
    }
  });

  it("keeps a real 220-element answer near the 40 KB target through the tool, and returns it whole on request", async () => {
    await planLarge(110);
    for (const args of [{ sections: ["changes"] }, { sections: ["layers"] }, { sections: ["changes", "layers", "gaps", "intent", "codeTouched"] }]) {
      const { json, bytes } = await brief(args);
      expect(bytes).toBeLessThanOrEqual(SECTIONS_TARGET_BYTES);
      expect(json.pages.changes ?? json.pages.layers).toMatchObject({ total: 231, unit: "elements" });
      expect(json.more).toContain("Not everything is here");
    }
    // The next call the answer names returns the next page.
    const first = (await brief({ sections: ["changes"] })).json;
    const next = JSON.parse(first.pages.changes.next.replace(/^changeset_brief /, ""));
    expect(next).toEqual({ rootPath, sections: ["changes"], offset: first.pages.changes.returned });
    const second = (await brief(next)).json;
    expect(second.changes[0].id).not.toBe(first.changes[0].id);
    expect(second.pages.changes).toMatchObject({ total: 231, offset: first.pages.changes.returned });

    // A larger target or a limit returns more in one answer: the 40 KB is a default.
    const roomy = await brief({ sections: ["changes"], targetBytes: 400_000 });
    expect(roomy.json.changes).toHaveLength(231);
    expect(roomy.json.pages.changes).toEqual({ total: 231, returned: 231, unit: "elements" });
    expect((await brief({ sections: ["changes"], limit: 231 })).json.changes).toHaveLength(231);

    // A filtered section costs what it returns: one element, one element's bytes.
    const one = await brief({ sections: ["changes", "intent", "gaps"], ids: ["data-model.objectschema.export-row-shape-7"] });
    expect(one.json.changes).toHaveLength(1);
    expect(one.json.intent.untraced).toEqual(["data-model.objectschema.export-row-shape-7"]);
    expect(one.json.gaps).toHaveLength(1);
    expect(one.json.pages.changes).toEqual({ total: 1, returned: 1, unit: "elements" });
    expect(one.bytes).toBeLessThan(3_000);
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

    // By default 8 of a group are listed and the rest counted: lines and counts together are all 13.
    const all = exporter((await brief({ sections: ["layers"], layers: ["application"] })).json);
    expect(all.connections).toContain(`realizes → ${FEATURE}`);
    expect(all.connections.filter((c: string) => c.startsWith("tests ← "))).toHaveLength(8);
    expect(all.connectionCounts).toEqual({ "tests ← testing": 4 });

    // maxConnections changes the 8: every connection listed, or every one counted.
    const listed = exporter((await brief({ sections: ["layers"], layers: ["application"], maxConnections: 50 })).json);
    expect(listed.connections).toHaveLength(13);
    expect(listed.connectionCounts).toBeUndefined();
    const counted = exporter((await brief({ sections: ["layers"], layers: ["application"], maxConnections: 0 })).json);
    expect(counted.connections).toEqual([]);
    expect(counted.connectionCounts).toEqual({ "realizes → product": 1, "tests ← testing": 12 });

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

  it("pages unwired connections per element with a per-type summary of them all, and narrows codeTouched", async () => {
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
    // All 30 fit: each element's own entries, whole.
    const { json } = await brief({ sections: ["unwired", "codeTouched"], unwiredLayers: ["product"] });
    expect(json.unwired.elements).toHaveLength(30);
    expect(json.unwired.elements[0].byLayer[0].entries[0]).toMatchObject({ direction: "out", predicate: "realizes" });
    expect(json.pages.unwired).toEqual({ total: 30, returned: 30, unit: "elements" });
    expect(json.codeTouched).toHaveLength(30);
    expect(json.codeTouched[0]).toEqual({ file: "src/workers/worker-0.ts", changed: ["application.applicationservice.worker-0"] });

    // A page of 10: the summary still says, for all 30, which connection how many of them lack.
    const paged = (await brief({ sections: ["unwired", "codeTouched"], unwiredLayers: ["product"], limit: 10 })).json;
    expect(paged.unwired.elements).toHaveLength(10);
    expect(paged.pages.unwired).toMatchObject({ total: 30, returned: 10, nextOffset: 10 });
    const services = paged.pages.unwired.summary.byType.find((t: any) => t.type === "application.applicationservice");
    expect(services.elements).toBe(30);
    expect(services.byLayer[0].entries).toContain("out realizes product.feature (1 existing, 0 added): 30 elements");
    expect(JSON.parse(paged.pages.unwired.next.replace(/^changeset_brief /, ""))).toEqual({
      unwiredLayers: ["product"],
      limit: 10,
      rootPath,
      sections: ["unwired"],
      offset: 10,
    });
    expect(paged.pages.codeTouched).toMatchObject({ total: 30, returned: 10, summary: { changedElements: 30, neighborOnlyFiles: 0 } });

    // A filter: only that element's entries and its file.
    const few = (await brief({ sections: ["unwired", "codeTouched"], unwiredLayers: ["product"], ids: ["application.applicationservice.worker-3"] })).json;
    expect(few.unwired.elements).toHaveLength(1);
    expect(few.codeTouched).toEqual([{ file: "src/workers/worker-3.ts", changed: ["application.applicationservice.worker-3"] }]);
    expect(few.pages.unwired).toEqual({ total: 1, returned: 1, unit: "elements" });
  });

  it("pages the delta's lists with the same limit and offset, keeping each list's full length", () => {
    const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
    const delta: BriefDelta = {
      since: 0,
      revision: 9,
      elements: { added: ids("application.applicationfunction.added", 70), removed: ids("application.applicationfunction.removed", 3), updated: [] },
      relationships: {
        added: ids("s", 45).map((source) => ({ source, predicate: "realizes", target: SERVICE })),
        removed: [],
      },
      unstaged: [],
      gaps: { opened: [], closed: [] },
      acceptedGaps: { accepted: [], reopened: [] },
      unwired: { wired: [], new: [], newElements: [] },
      reach: { newlyReached: [], noLongerReached: [] },
      intent: { newlyTraced: [], newlyUntraced: ids("data-model.objectschema.row", 31) },
      note: "",
    };
    // The default page: 30 of each list, with the full length of every list that is not whole.
    const first: DeltaPage = { total: 0, returned: 0 };
    const compact = compactDelta(delta, { page: first });
    expect(compact.elements.added).toHaveLength(30);
    expect(compact.elements.removed).toHaveLength(3);
    expect(compact.counts).toEqual({ "elements.added": 70, "relationships.added": 45, "intent.newlyUntraced": 31 });
    expect(first).toEqual({ total: 149, returned: 93, nextOffset: 30 });

    // Following nextOffset reaches every entry of every list, once.
    const added: string[] = [];
    const relationships: string[] = [];
    const untraced: string[] = [];
    let returned = 0;
    for (let offset: number | undefined = 0, pass = 0; offset !== undefined && pass < 20; pass++) {
      const page: DeltaPage = { total: 0, returned: 0 };
      const part = compactDelta(delta, { limit: 20, offset, page });
      expect(page.total).toBe(149);
      added.push(...part.elements.added);
      relationships.push(...part.relationships.added);
      untraced.push(...part.intent.newlyUntraced);
      returned += page.returned;
      offset = page.nextOffset;
    }
    expect(added).toEqual(delta.elements.added);
    expect(relationships).toHaveLength(45);
    expect(untraced).toEqual(delta.intent.newlyUntraced);
    expect(returned).toBe(149);
  });

  it("pages a since delta through the tool when delta is named", async () => {
    await changesetCreateHandler({ name: "grow", description: "Grow.", rootPath });
    const start = (await brief()).json;
    await addAll(Array.from({ length: 45 }, (_, i) => ({ layer: "application", type: "applicationfunction", name: `grown-${i}` })));
    // Without naming delta: the first 30, the true length, and how to page them.
    const compact = (await brief({ since: start.revisionToken })).json;
    expect(compact.delta.elements.added).toHaveLength(30);
    expect(compact.delta.counts["elements.added"]).toBe(45);
    expect(compact.more).toContain('sections: ["delta"] with since and offset pages them');

    const first = (await brief({ since: start.revisionToken, sections: ["delta"] })).json;
    expect(first.pages.delta).toMatchObject({ unit: "entries", nextOffset: 30 });
    const next = JSON.parse(first.pages.delta.next.replace(/^changeset_brief /, ""));
    expect(next).toEqual({ rootPath, since: start.revisionToken, sections: ["delta"], offset: 30 });
    const second = (await brief(next)).json;
    expect([...first.delta.elements.added, ...second.delta.elements.added]).toHaveLength(45);
    expect(new Set([...first.delta.elements.added, ...second.delta.elements.added]).size).toBe(45);
    expect(second.pages.delta.nextOffset).toBeUndefined();
    // One call for all of it, when asked.
    expect((await brief({ since: start.revisionToken, sections: ["delta"], limit: 100 })).json.delta.elements.added).toHaveLength(45);
    expect((await brief({ since: start.revisionToken, sections: ["delta"], detail: "full" })).json.delta.elements.added).toHaveLength(45);
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

  it("describes the paging arguments and their defaults", () => {
    expect(changesetBriefTool.description).toContain("pages gives each list's true total");
    const schema = changesetBriefTool.inputSchema as Record<string, any>;
    expect(Object.keys(schema)).toEqual(expect.arrayContaining(["offset", "limit", "targetBytes", "maxConnections", "otherLayers"]));
    expect(schema.sections.description).toContain("40 KB");
    expect(schema.targetBytes.description).toContain("40960");
    expect(schema.limit.description).toContain("default 30");
    expect(schema.maxConnections.description).toContain("default 8");
  });
});

describe("changeset_impact: the walk counts everything and lists a page", () => {
  it("reports the true reach whatever maxElements is, and pages byLayer to the whole set", async () => {
    // 12 existing functions realize the service; the plan updates the service.
    await addAll(
      Array.from({ length: 12 }, (_, i) => ({ layer: "application", type: "applicationfunction", name: `existing-step-${i}` })),
      Array.from({ length: 12 }, (_, i) => ({ source: `application.applicationfunction.existing-step-${i}`, predicate: "realizes", target: SERVICE }))
    );
    await changesetCreateHandler({ name: "rework", description: "Rework.", rootPath });
    const { modelUpdateHandler } = await import("../../../src/mcp/tools/model-update.js");
    text(await modelUpdateHandler({ id: SERVICE, description: "Now asynchronous.", rootPath } as any));

    const model = await loadModel(rootPath);
    const { graph } = await loadChangesetGraph(model, undefined);
    const whole = computeImpact(graph, { depth: 1 });
    // The feature and the 12 functions.
    expect(whole).toMatchObject({ reached: 13, returned: 13, truncated: false });
    expect(whole.nextOffset).toBeUndefined();
    const idsOf = (report: ReturnType<typeof computeImpact>) => Object.values(report.byLayer).flatMap((list) => list.map((e) => e.id));

    // A page of 5: the counts are still of all 13, and the pages together are the whole set.
    const seen: string[] = [];
    for (let offset: number | undefined = 0, pass = 0; offset !== undefined && pass < 10; pass++) {
      const page = computeImpact(graph, { depth: 1, maxElements: 5, offset });
      expect(page.reached).toBe(13);
      expect(page.perHop).toEqual([{ depth: 1, reached: 13 }]);
      expect(page.returned).toBe(idsOf(page).length);
      expect(page.truncated).toBe(true);
      seen.push(...idsOf(page));
      offset = page.nextOffset;
    }
    expect(seen).toHaveLength(13);
    expect([...seen].sort()).toEqual(idsOf(whole).sort());

    // Through the tool: the answer says what it holds and names the call for the rest.
    const first = JSON.parse(text(await changesetImpactHandler({ depth: 1, maxElements: 5, rootPath })));
    expect(first).toMatchObject({ reached: 13, returned: 5, nextOffset: 5, truncated: true });
    expect(first.more).toContain("byLayer lists 5 of the 13 elements reached");
    expect(first.more).toContain(`changeset_impact ${JSON.stringify({ depth: 1, maxElements: 5, rootPath, offset: 5 })}`);
    const all = JSON.parse(text(await changesetImpactHandler({ depth: 1, rootPath })));
    expect(all.more).toBeUndefined();
    expect(changesetImpactTool.description).toContain("never cut short");
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
    // A larger limit lists what the default counts: every untraced id and every traced one.
    const listed = compactIntent(intent, { listLimit: 100 });
    expect(listed.untraced).toHaveLength(43);
    expect(listed.traced).toHaveLength(31);

    // Under sections: a page of the untraced ids, with every one counted per type beside it.
    const paged = compactIntent(intent, { untracedPage: intent.untraced.slice(0, 10) });
    expect(paged.untraced).toHaveLength(10);
    expect(paged.counts.untraced).toBe(43);
    expect(paged.untracedByType).toEqual([
      { type: "application.applicationfunction", count: 40 },
      { type: "data-model.objectschema", count: 3 },
    ]);

    // More unanchored elements than the limit: counted per added intent element, none dropped.
    const unanchored = ids("data-model.objectschema", 40).map((element, i) => ({
      element,
      tracesTo: i < 25 ? "product.feature.new" : "motivation.requirement.new",
      path: [],
      detail: "",
    }));
    const many = compactIntent({ ...intent, unanchored });
    expect(many.unanchored).toBeUndefined();
    expect(many.unanchoredByIntent).toEqual({ "product.feature.new": 25, "motivation.requirement.new": 15 });
    expect(many.counts.unanchored).toBe(40);
  });
});
