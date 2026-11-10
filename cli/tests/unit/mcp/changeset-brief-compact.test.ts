/**
 * changeset_brief's compact default (FINDINGS.md D2): the brief returned 55–420 KB, more than the
 * client takes in one result. The compact brief keeps counts, reach, gaps, intent, drift and the
 * changed elements with their connections as ids; detail: "full" and sections bring the rest back.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetUpdateHandler } from "../../../src/mcp/tools/changeset-editing.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { annotationCreateHandler } from "../../../src/mcp/tools/annotation-create.js";
import { changesetBriefHandler, changesetBriefTool } from "../../../src/mcp/tools/changeset-analysis-tools.js";

function text(result: any): string {
  if (result.isError) throw new Error(result.content[0].text);
  return result.content[0].text;
}

const GOAL = "motivation.goal.faster-checkout";
const SERVICE = "application.applicationservice.checkout";
const FUNCTION = "application.applicationfunction.export-orders";
const OPERATION = "api.operation.export-orders";
const SCHEMA = "data-model.objectschema.order-export-row";

let rootPath: string;

async function add(args: Record<string, unknown>): Promise<void> {
  text(await modelAddHandler({ ...(args as any), rootPath }));
}

async function relate(source: string, predicate: string, target: string): Promise<void> {
  text(await relationshipAddHandler({ source, predicate, target, rootPath }));
}

async function brief(args: Record<string, unknown> = {}): Promise<{ json: any; bytes: number }> {
  const raw = text(await changesetBriefHandler({ ...(args as any), rootPath }));
  return { json: JSON.parse(raw), bytes: Buffer.byteLength(raw) };
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-brief-compact-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Brief Test Model", version: "0.1.0" });
  await add({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" } });
  await add({
    layer: "application",
    type: "applicationservice",
    name: "checkout",
    attributes: { serviceType: "synchronous" },
    sourceFile: "src/checkout/service.ts",
    sourceProvenance: "manual",
  });
  await relate(SERVICE, "realizes", GOAL);
  await changesetCreateHandler({ name: "export-orders", description: "Export orders as CSV. ".repeat(40), rootPath });
  await add({
    layer: "application",
    type: "applicationfunction",
    name: "export-orders",
    description: `Writes the CSV. ${"Streams rows in batches. ".repeat(10)}`,
    sourceFile: "src/export/orders.ts",
    sourceProvenance: "manual",
  });
  await add({
    layer: "api",
    type: "operation",
    name: "export-orders",
    attributes: { operationId: "exportOrders", summary: "Export orders as CSV", tags: "orders" },
  });
  await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
  await relate(FUNCTION, "realizes", SERVICE);
  await relate(OPERATION, "realizes", FUNCTION);
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("changeset_brief compact (D2)", () => {
  it("defaults to a compact summary with connections as ids", async () => {
    const { json } = await brief();
    expect(json.detail).toBe("compact");
    expect(json.layers).toBeUndefined();
    expect(json.byLayer).toEqual([
      { layer: "application", added: 1, updated: 0, deleted: 0 },
      { layer: "api", added: 1, updated: 0, deleted: 0 },
      { layer: "data-model", added: 1, updated: 0, deleted: 0 },
    ]);
    expect(json.summary).toMatchObject({ elementsAdded: 3, relationshipsAdded: 2 });
    expect(json.reach.touched).toEqual(["application", "api", "data-model"]);

    const byId = Object.fromEntries(json.changes.map((c: any) => [c.id, c]));
    expect(byId[FUNCTION]).toEqual({
      id: FUNCTION,
      op: "added",
      // A short description and its files: what the build needs without the full brief.
      description: expect.stringMatching(/^Writes the CSV\. Streams rows/),
      sourceFiles: ["orders.ts"],
      // Its incoming relationship from the operation is listed once, on the operation.
      connections: [`realizes → ${SERVICE}`],
    });
    expect(byId[FUNCTION].description.length).toBeLessThanOrEqual(160);
    expect(byId[OPERATION].connections).toEqual([`realizes → ${FUNCTION}`]);
    expect(byId[SCHEMA].connections).toEqual([]);
    // No attributes per element: those are in the full brief.
    expect(byId[OPERATION].attributes).toBeUndefined();

    // Files: the changed ones with their paths, and the ones that hold only neighbours ("must not break").
    expect(json.codeTouched).toEqual(["src/export/orders.ts (1)"]);
    expect(json.neighborFiles).toEqual(["src/checkout/service.ts"]);

    // Gaps one line each; intent as ids.
    expect(json.gaps).toContain(`${SCHEMA}: unconnected: Added with no relationships: nothing in the model says what it serves, realizes or uses.`);
    expect(json.gaps.every((g: unknown) => typeof g === "string")).toBe(true);
    expect(json.intent.traced).toEqual(expect.arrayContaining([FUNCTION, OPERATION]));
    expect(json.intent.untraced).toEqual([SCHEMA]);

    // Unwired is counted per layer, not listed.
    expect(typeof json.unwired.total).toBe("number");
    expect(json.unwired.total).toBe(Object.values(json.unwired.byLayer as Record<string, number>).reduce((a, b) => a + b, 0));
    expect(json.unwired.elements).toBeUndefined();

    // Drift, and the changeset's description in full: accepted gaps and decisions live there.
    expect(json.changeset.drift.isDrifted).toBe(false);
    expect(json.changeset.drift.overlapping).toEqual([]);
    expect(json.changeset.description).toBe("Export orders as CSV. ".repeat(40));
    expect(json.revisionToken).toMatch(/^\d+:[0-9a-f]+$/);
    expect(json.more).toContain('detail: "full"');
  });

  it("returns the full brief, unchanged, with detail: full", async () => {
    const { json } = await brief({ detail: "full" });
    expect(json.detail).toBeUndefined();
    expect(json.layers.map((l: any) => l.layer)).toEqual(["application", "api", "data-model"]);
    expect(json.unwired.mode).toBe("summary");
    expect(json.gaps[0].kind).toBeDefined();
    expect(json.changeset.description.length).toBeGreaterThan(400);
  });

  it("returns only the named sections, in full, under a small header (round 2: sections didn't narrow)", async () => {
    const { json } = await brief({ sections: ["layers", "unwired", "intent", "changeset"] });
    expect(json.detail).toBe("compact");
    expect(json.sections).toEqual(["layers", "unwired", "intent", "changeset"]);
    expect(json.layers[0].changes[0].connections[0].otherName).toBeDefined();
    expect(json.unwired.mode).toBe("summary");
    expect(json.intent.traced[0].path).toBeDefined();
    expect(json.changeset.description.length).toBeGreaterThan(400);
    expect(json.changeset.drift.isDrifted).toBe(false);
    // Not named: left out.
    for (const key of ["gaps", "changes", "codeTouched", "byLayer", "reach", "feedback", "relationshipChanges"]) {
      expect(json[key]).toBeUndefined();
    }

    const gaps = await brief({ sections: ["gaps"] });
    expect(Object.keys(gaps.json).sort()).toEqual(["changeset", "detail", "gaps", "more", "revision", "revisionToken", "sections", "summary"]);
    expect(gaps.json.changeset).toEqual({ id: expect.any(String), name: "export-orders", status: "staged" });
    expect(gaps.json.gaps[0].kind).toBeDefined();
    expect(gaps.bytes).toBeLessThan(2_000);

    // changes alone: every changed element in the compact form.
    const changes = (await brief({ sections: ["changes"] })).json;
    expect(changes.changes.map((c: any) => c.id).sort()).toEqual([FUNCTION, OPERATION, SCHEMA].sort());
    expect(changes.gaps).toBeUndefined();
  });

  it("keeps the unwired listing opt-in: unwired set lists it, none leaves it out", async () => {
    expect((await brief({ unwired: "full" })).json.unwired.mode).toBe("full");
    expect((await brief({ unwired: "none" })).json.unwired).toBeUndefined();
  });

  it("keeps the since delta working, compact, and leaves the element list to the delta", async () => {
    const first = (await brief()).json;
    await add({ layer: "application", type: "dataobject", name: "order-row" });
    await relate(FUNCTION, "accesses", "application.dataobject.order-row");

    const { json } = await brief({ since: first.revisionToken });
    expect(json.delta.since).toBe(first.revision);
    expect(json.delta.elements.added).toContain("application.dataobject.order-row");
    expect(json.delta.relationships.added).toContain(`${FUNCTION} --accesses--> application.dataobject.order-row`);
    expect(json.delta.unwired).toEqual({ wired: expect.any(Number), new: expect.any(Number), newElements: 1 });
    expect(json.changes).toBeUndefined();
    expect(json.more).toContain('sections: ["changes"]');

    const withChanges = (await brief({ since: first.revisionToken, sections: ["changes", "delta"] })).json;
    expect(withChanges.changes.map((c: any) => c.id)).toContain("application.dataobject.order-row");
    expect(withChanges.delta.relationships.added[0].source).toBeDefined();

    const quiet = (await brief({ since: json.revisionToken })).json;
    expect(quiet.delta.elements).toEqual({ added: [], removed: [], updated: [] });
  });

  it("lists open review comments one line each", async () => {
    text(await annotationCreateHandler({ elementId: FUNCTION, content: "Should this stream? ".repeat(20), author: "reviewer", rootPath } as any));
    const { json } = await brief();
    expect(json.feedback).toHaveLength(1);
    expect(json.feedback[0]).toMatch(new RegExp(`^ann-\\S+ on ${FUNCTION.replace(/\./g, "\\.")} \\(reviewer, 0 replies\\): Should this stream\\?`));
    expect(json.feedback[0].length).toBeLessThan(320);
  });

  it("stays under 20 KB for a 15-element plan, a fraction of the full brief", async () => {
    for (let i = 0; i < 12; i++) {
      await add({ layer: "application", type: "applicationfunction", name: `step-${i}`, description: `Step ${i} of the export. `.repeat(6) });
      await relate(`application.applicationfunction.step-${i}`, "realizes", SERVICE);
      if (i > 0) await relate(`application.applicationfunction.step-${i}`, "depends-on", `application.applicationfunction.step-${i - 1}`);
    }
    await changesetUpdateHandler({ description: "Plan notes. ".repeat(300), rootPath } as any);
    const compact = await brief();
    const full = await brief({ detail: "full" });
    expect(compact.json.changes).toHaveLength(15);
    expect(compact.bytes).toBeLessThan(20_000);
    expect(compact.bytes * 3).toBeLessThan(full.bytes);
  });

  it("sections: changes is the build view, and layers or ids narrow it (PR 1066 review: layers ~3 KB per element)", async () => {
    const { modelUpdateHandler } = await import("../../../src/mcp/tools/model-update.js");
    text(await modelUpdateHandler({ id: SERVICE, attributePatch: { serviceType: "asynchronous" }, rootPath } as any));

    const build = await brief({ sections: ["changes"] });
    const byId = Object.fromEntries(build.json.changes.map((c: any) => [c.id, c]));
    expect(byId[OPERATION]).toMatchObject({
      op: "added",
      name: "export-orders",
      attributes: { operationId: "exportOrders", summary: "Export orders as CSV", tags: "orders" },
      connections: [`realizes → ${FUNCTION}`],
    });
    // The full description, not cut.
    expect(byId[FUNCTION].description.length).toBeGreaterThan(160);
    expect(byId[SERVICE].changedFields).toEqual([{ field: "attributes.serviceType", before: "synchronous", after: "asynchronous" }]);
    const layers = await brief({ sections: ["layers"] });
    expect(build.bytes).toBeLessThan(layers.bytes);

    const api = (await brief({ sections: ["changes", "gaps", "layers"], layers: ["api"] })).json;
    expect(api.filter).toEqual({ layers: ["api"] });
    expect(api.changes.map((c: any) => c.id)).toEqual([OPERATION]);
    expect(api.layers.map((l: any) => l.layer)).toEqual(["api"]);
    expect(api.gaps.every((g: any) => g.element.startsWith("api."))).toBe(true);

    const one = (await brief({ sections: ["changes"], ids: [SCHEMA, "api.operation.nope"] })).json;
    expect(one.changes.map((c: any) => c.id)).toEqual([SCHEMA]);
    expect(one.more).toContain("Not changed by this changeset: api.operation.nope");
  });

  it("summarises a large plan by type and cuts long id lists, under 30 KB (round 2: 56–66 KB bootstrap brief)", async () => {
    // A bootstrap-sized plan: 130 more elements, none tracing to intent.
    for (let i = 0; i < 90; i++) {
      await add({ layer: "testing", type: "testcasesketch", name: `owner-controller-tests-case-number-${i}`, attributes: { status: "automated", implementationFormat: "automated" }, description: `Case ${i}. `.repeat(8) });
    }
    for (let i = 0; i < 40; i++) {
      await add({ layer: "application", type: "applicationfunction", name: `owner-controller-handler-number-${i}`, sourceFile: `src/main/java/owner/Handler${i}.java`, sourceProvenance: "manual" });
    }
    const compact = await brief();
    expect(compact.json.changes).toBeUndefined();
    const tests = compact.json.changesByType.find((g: any) => g.type === "testing.testcasesketch");
    expect(tests).toMatchObject({ added: 90, updated: 0, deleted: 0, more: 85 });
    expect(tests.ids).toHaveLength(5);
    expect(compact.json.changesByType.reduce((n: number, g: any) => n + g.added, 0)).toBe(133);
    expect(compact.json.intent.untraced).toHaveLength(30);
    expect(compact.json.intent.counts.untraced).toBeGreaterThan(130);
    expect(compact.json.more).toContain('sections: ["changes"]');
    // A bootstrap's unconnected adds share one gap line.
    expect(compact.json.gaps.some((g: string) => /^unconnected: .* \(1[0-9]{2} elements: .*, \+1[0-9]{2} more\)$/.test(g))).toBe(true);
    expect(compact.bytes).toBeLessThan(30_000);

    const all = await brief({ sections: ["changes"] });
    expect(all.json.changes).toHaveLength(133);

    // A delta from the start lists at most 30 of each, with the full counts.
    const first = await brief({ since: 0 });
    expect(first.json.delta.elements.added).toHaveLength(30);
    expect(first.json.delta.counts["elements.added"]).toBeGreaterThan(130);
    expect(first.bytes).toBeLessThan(30_000);
  });

  it("describes the compact default and how to get more", () => {
    expect(changesetBriefTool.description).toContain("compact");
    expect(changesetBriefTool.description).toContain('detail: "full"');
    expect(Object.keys(changesetBriefTool.inputSchema)).toEqual(expect.arrayContaining(["detail", "sections", "since"]));
  });
});
