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

  it("returns named sections in full beside the compact rest", async () => {
    const { json } = await brief({ sections: ["layers", "unwired", "intent", "changeset"] });
    expect(json.detail).toBe("compact");
    expect(json.layers[0].changes[0].connections[0].otherName).toBeDefined();
    expect(json.unwired.mode).toBe("summary");
    expect(json.intent.traced[0].path).toBeDefined();
    expect(json.changeset.description.length).toBeGreaterThan(400);
    // Not named: still compact.
    expect(typeof json.gaps[0]).toBe("string");
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

  it("describes the compact default and how to get more", () => {
    expect(changesetBriefTool.description).toContain("compact");
    expect(changesetBriefTool.description).toContain('detail: "full"');
    expect(Object.keys(changesetBriefTool.inputSchema)).toEqual(expect.arrayContaining(["detail", "sections", "since"]));
  });
});
