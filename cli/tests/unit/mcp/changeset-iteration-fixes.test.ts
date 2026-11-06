/**
 * Regression tests for the iteration-run fixes: deltas that survive an unstage (monotonic sequence
 * numbers and unstage tombstones), delta coverage of updates and relationship changes, an intent
 * trace that skips hubs and does not count unanchored added intent, and unwired counts and size.
 * See "Iterating on a plan" in docs/CHANGE_MODELING.md.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { StagedChangesetStorage, MAX_UNSTAGED_TOMBSTONES } from "../../../src/core/staged-changeset-storage.js";
import { ChangesetGraph, changesetRevision } from "../../../src/core/changeset-graph.js";
import { clearModelCache, compactJson, loadModel } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetUnstageHandler } from "../../../src/mcp/tools/changeset-editing.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetBriefHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";
import { changesetShowHandler } from "../../../src/mcp/tools/changeset-show.js";

function parse(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

const GOAL = "motivation.goal.faster-checkout";
const SERVICE = "application.applicationservice.checkout";
const FUNCTION = "application.applicationfunction.export-orders";
const OPERATION = "api.operation.export-orders";
const SCHEMA = "data-model.objectschema.order-export-row";
const FEATURE = "product.feature.order-export";

let rootPath: string;

async function add(args: Record<string, unknown>): Promise<any> {
  return parse(await modelAddHandler({ ...(args as any), rootPath }));
}

async function relate(source: string, predicate: string, target: string): Promise<any> {
  return parse(await relationshipAddHandler({ source, predicate, target, rootPath }));
}

async function brief(args: Record<string, unknown> = {}): Promise<any> {
  return parse(await changesetBriefHandler({ ...(args as any), rootPath }));
}

async function unstage(args: Record<string, unknown>): Promise<any> {
  return parse(await changesetUnstageHandler({ ...(args as any), rootPath }));
}

async function activeChangeset() {
  clearModelCache();
  const model = await loadModel(rootPath);
  const manager = new StagingAreaManager(model.rootPath, model);
  const id = (await manager.getActiveId())!;
  return { model, manager, changeset: (await manager.load(id))! };
}

/** A goal and a checkout service that realizes it. */
async function setUpBaseModel(): Promise<void> {
  await Model.init(rootPath, { name: "Iteration Fix Model", version: "0.1.0" });
  await add({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" } });
  await add({ layer: "application", type: "applicationservice", name: "checkout", attributes: { serviceType: "synchronous" } });
  expect((await relate(SERVICE, "realizes", GOAL)).status).toBe("added");
}

/** Plans "export orders": four changes, so revision 3. */
async function planExportOrders(): Promise<void> {
  await changesetCreateHandler({ name: "export-orders", rootPath });
  await add({ layer: "application", type: "applicationfunction", name: "export-orders" });
  await add({
    layer: "api",
    type: "operation",
    name: "export-orders",
    attributes: { operationId: "exportOrders", summary: "Export orders as CSV", tags: "orders" },
  });
  await relate(FUNCTION, "realizes", SERVICE);
  await relate(OPERATION, "realizes", FUNCTION);
}

const allEntries = (element: any) => element.byLayer.flatMap((l: any) => l.entries ?? []);
const findElement = (unwired: any, id: string) => unwired.elements.find((e: any) => e.element === id);

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-mcp-iter-fix-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await setUpBaseModel();
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Sequence numbers are monotonic; unstages leave tombstones
// ---------------------------------------------------------------------------

describe("sequence numbers across an unstage", () => {
  it("keeps the remaining changes' numbers and never reuses one", async () => {
    await planExportOrders(); // 0 fn, 1 op, 2 fn realizes service, 3 op realizes fn
    await unstage({ elementId: OPERATION }); // drops 1 and 3
    let { changeset } = await activeChangeset();
    expect((changeset.changes as any[]).map((c) => c.sequenceNumber)).toEqual([0, 2]);

    await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
    ({ changeset } = await activeChangeset());
    const seqs = (changeset.changes as any[]).map((c) => c.sequenceNumber);
    // Two unstage events (the operation's add, then its relationship) took 4 and 5.
    expect(seqs).toEqual([0, 2, 6]);
    expect(changesetRevision(changeset)).toBe(6);
  });

  it("records each unstaged change as a tombstone that commit, preview and the projection ignore", async () => {
    await planExportOrders();
    await unstage({ elementId: OPERATION });
    const { model, manager, changeset } = await activeChangeset();
    expect(changeset.unstaged.map((t) => [t.sequence, t.change.type, t.change.elementId])).toEqual(
      expect.arrayContaining([
        [1, "add", OPERATION],
        [3, "relationship-add", `${OPERATION}::realizes::${FUNCTION}`],
      ])
    );
    for (const t of changeset.unstaged) expect(t.removedAt).toBeGreaterThan(3);

    // The projection (now) does not resurrect them; the rebuilt revision 3 does.
    const now = await ChangesetGraph.build(model, changeset);
    expect(now.getElement(OPERATION)).toBeUndefined();
    const then = await ChangesetGraph.build(model, changeset, { throughSequence: 3 });
    expect(then.getElement(OPERATION)?.status).toBe("added");

    const preview = await manager.commit(model, changeset.id, { dryRun: true, validate: false, force: true });
    expect(preview.committed).toBe(2);
    const result = await manager.commit(model, changeset.id, { validate: false, force: true });
    expect(result.committed).toBe(2);
    clearModelCache();
    const after = await loadModel(rootPath);
    expect(await after.getElementById(FUNCTION)).toBeDefined();
    expect(await after.getElementById(OPERATION)).toBeUndefined();
  });

  it("keeps loading an existing contiguous changeset and numbers its next change after it", async () => {
    await planExportOrders();
    const { changeset } = await activeChangeset();
    // Rewrite it as an older CLI left it: contiguous numbers, no high-water mark, no tombstones.
    const dir = new StagedChangesetStorage(rootPath).getChangesetPath(changeset.id);
    const metadata = yaml.parse(await readFile(join(dir, "metadata.yaml"), "utf-8"));
    delete metadata.lastSequence;
    delete metadata.unstaged;
    await writeFile(join(dir, "metadata.yaml"), yaml.stringify(metadata), "utf-8");

    const first = await brief();
    expect(first.revision).toBe(3);
    await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
    const { changeset: reloaded } = await activeChangeset();
    expect((reloaded.changes as any[]).map((c) => c.sequenceNumber)).toEqual([0, 1, 2, 3, 4]);
    const next = await brief({ since: first.revisionToken });
    expect(next.delta.warnings).toBeUndefined();
    expect(next.delta.elements.added).toEqual([SCHEMA]);
  });

  it("keeps the tombstone list bounded and warns when a delta reaches past what it kept", async () => {
    await planExportOrders();
    await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
    const first = await brief(); // revision 4

    // A long session: the record already holds a full list of later stage-and-unstage pairs.
    const { changeset } = await activeChangeset();
    const storage = new StagedChangesetStorage(rootPath);
    const scratch = Array.from({ length: MAX_UNSTAGED_TOMBSTONES }, (_, i) => ({
      sequence: 5 + 2 * i,
      removedAt: 6 + 2 * i,
      change: { type: "add" as const, elementId: `data-model.objectschema.scratch-${i}`, layerName: "data-model" },
    }));
    changeset.unstaged = scratch;
    changeset.lastSequence = scratch[scratch.length - 1].removedAt;
    await storage.save(changeset);

    // The next unstage pushes the oldest tombstones out.
    await unstage({ elementId: SCHEMA });
    const { changeset: after } = await activeChangeset();
    expect(after.unstaged).toHaveLength(MAX_UNSTAGED_TOMBSTONES);
    expect(after.unstaged[after.unstaged.length - 1].change.elementId).toBe(SCHEMA);
    expect(after.unstagedPrunedThrough).toBe(6);

    // The schema's unstage is still recorded, so a delta from revision 4 names it, and warns that
    // older unstages may be missing.
    const later = await brief({ since: first.revisionToken });
    expect(later.delta.unstaged).toEqual([expect.objectContaining({ operation: "add", elementId: SCHEMA })]);
    expect(later.delta.warnings.join(" ")).toContain("tombstone");
    // A delta from after the dropped ones is exact.
    const recent = await brief({ since: 6 });
    expect(recent.delta.warnings).toBeUndefined();
  });

  it("shows changeset_show summary sequences as stored, gaps included", async () => {
    await planExportOrders();
    await unstage({ elementId: OPERATION });
    const shown = parse(await changesetShowHandler({ rootPath, changesetId: "export-orders", detail: "summary" } as any));
    expect(shown.changes.map((c: any) => c.sequence)).toEqual([0, 2]);
  });
});

// ---------------------------------------------------------------------------
// 1b. A since delta after an unstage
// ---------------------------------------------------------------------------

describe("changeset_brief delta after an unstage", () => {
  it("lists what was unstaged since, with the element removed and the layer no longer reached (pass 6)", async () => {
    await planExportOrders();
    await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
    await relate(FUNCTION, "accesses", SCHEMA);
    const first = await brief();

    // Unstage the schema (its accesses link goes with it), then stage one more change.
    await unstage({ elementId: SCHEMA });
    await relate(OPERATION, "references", SERVICE);
    const after = await brief({ since: first.revisionToken });

    expect(after.revision).toBeGreaterThan(first.revision);
    expect(after.delta.warnings).toBeUndefined();
    expect(after.delta.unstaged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "add", elementId: SCHEMA }),
        expect.objectContaining({ operation: "relationship-add", source: FUNCTION, predicate: "accesses", target: SCHEMA }),
      ])
    );
    expect(after.delta.unstaged).toHaveLength(2);
    expect(after.delta.elements.removed).toEqual([SCHEMA]);
    expect(after.delta.reach.noLongerReached).toEqual(["data-model"]);
    expect(after.delta.relationships.added).toEqual([{ source: OPERATION, predicate: "references", target: SERVICE }]);
    expect(after.delta.relationships.removed).toEqual([{ source: FUNCTION, predicate: "accesses", target: SCHEMA }]);
  });

  it("is not empty when an unstage and a stage leave the change count the same (pass 9)", async () => {
    await planExportOrders();
    const first = await brief();
    await unstage({ source: OPERATION, target: FUNCTION });
    await relate(OPERATION, "references", SERVICE);
    const after = await brief({ since: first.revisionToken });
    expect(after.revision).not.toBe(first.revision);
    expect(after.delta.unstaged).toEqual([
      expect.objectContaining({ operation: "relationship-add", source: OPERATION, predicate: "realizes", target: FUNCTION }),
    ]);
    expect(after.delta.relationships).toEqual({
      added: [{ source: OPERATION, predicate: "references", target: SERVICE }],
      removed: [{ source: OPERATION, predicate: "realizes", target: FUNCTION }],
    });
  });

  it("reports source-only and target-only unstages and the new edge after them (pass 8)", async () => {
    await planExportOrders();
    await relate(OPERATION, "references", SERVICE);
    const first = await brief();
    await unstage({ source: FUNCTION });
    await unstage({ target: FUNCTION });
    await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
    await relate(FUNCTION, "accesses", SCHEMA);
    const after = await brief({ since: first.revisionToken });
    expect(after.delta.warnings).toBeUndefined();
    expect(after.delta.unstaged.map((u: any) => `${u.source} ${u.predicate} ${u.target}`).sort()).toEqual(
      [`${FUNCTION} realizes ${SERVICE}`, `${OPERATION} realizes ${FUNCTION}`].sort()
    );
    expect(after.delta.relationships.added).toEqual([{ source: FUNCTION, predicate: "accesses", target: SCHEMA }]);
    expect(after.delta.elements.added).toEqual([SCHEMA]);
  });

  it("still warns, given a token, when a change up to it was rewritten in place", async () => {
    await planExportOrders();
    const first = await brief();
    const { changeset } = await activeChangeset();
    const storage = new StagedChangesetStorage(rootPath);
    const fnAdd = (changeset.changes as any[]).find((c) => c.elementId === FUNCTION && c.type === "add");
    await storage.updateChange(changeset.id, FUNCTION, {
      ...fnAdd,
      after: { ...fnAdd.after, description: "rewritten" },
    });
    const after = await brief({ since: first.revisionToken });
    expect(after.delta.warnings.join(" ")).toContain("rewritten in place");
  });
});

// ---------------------------------------------------------------------------
// 2. Delta coverage: updates and relationship changes
// ---------------------------------------------------------------------------

describe("changeset_brief delta coverage", () => {
  it("lists element updates since, with the fields changed, on added and existing elements", async () => {
    await planExportOrders();
    const first = await brief();
    parse(await modelUpdateHandler({ id: OPERATION, attributePatch: { summary: "Export orders" }, rootPath } as any));
    parse(await modelUpdateHandler({ id: SERVICE, description: "Checkout, reworked", rootPath } as any));
    const after = await brief({ since: first.revisionToken });
    expect(after.delta.elements.updated).toEqual(
      expect.arrayContaining([
        { element: OPERATION, fields: ["attributes.summary"] },
        { element: SERVICE, fields: ["description"] },
      ])
    );
    expect(after.delta.elements.updated).toHaveLength(2);
  });

  it("lists relationships added since whose end is an element added in the same window", async () => {
    await planExportOrders();
    const first = await brief();
    await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
    await relate(FUNCTION, "accesses", SCHEMA);
    const after = await brief({ since: first.revisionToken });
    expect(after.delta.elements.added).toEqual([SCHEMA]);
    expect(after.delta.relationships).toEqual({
      added: [{ source: FUNCTION, predicate: "accesses", target: SCHEMA }],
      removed: [],
    });
    expect(after.delta.elements.updated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Intent trace
// ---------------------------------------------------------------------------

describe("changeset_brief intent trace", () => {
  it("returns the path of each trace", async () => {
    await planExportOrders();
    const result = await brief();
    const op = result.intent.traced.find((t: any) => t.element === OPERATION);
    expect(op).toMatchObject({ tracesTo: GOAL, distance: 3, path: [OPERATION, FUNCTION, SERVICE, GOAL] });
  });

  it("does not walk through a hub", async () => {
    // The service becomes a hub: realized by many existing functions.
    for (let i = 0; i < 16; i++) {
      await add({ layer: "application", type: "applicationfunction", name: `peer-${i}` });
      await relate(`application.applicationfunction.peer-${i}`, "realizes", SERVICE);
    }
    await planExportOrders();
    const result = await brief();
    expect(result.intent.untraced).toEqual(expect.arrayContaining([FUNCTION, OPERATION]));
    expect(result.intent.traced.map((t: any) => t.element)).not.toContain(FUNCTION);
  });

  it("counts an added intent element only when it traces to an existing one", async () => {
    const REQUIREMENT = "motivation.requirement.export-is-auditable";
    await add({
      layer: "motivation",
      type: "requirement",
      name: "export-is-auditable",
      attributes: { requirementType: "functional", priority: "high" },
    });
    // An operation, unconnected to the base, that exposes a new feature (pass 4 of the run).
    await changesetCreateHandler({ name: "export-orders", rootPath });
    await add({
      layer: "api",
      type: "operation",
      name: "export-orders",
      attributes: { operationId: "exportOrders", summary: "Export orders as CSV", tags: "orders" },
    });
    await add({ layer: "product", type: "feature", name: "order-export", attributes: { priority: "high", status: "planned" } });
    await relate(OPERATION, "exposes", FEATURE);

    const unanchored = await brief();
    expect(unanchored.intent.untraced).toContain(OPERATION);
    expect(unanchored.intent.unanchored).toEqual([
      expect.objectContaining({
        element: OPERATION,
        tracesTo: FEATURE,
        path: [OPERATION, FEATURE],
        detail: expect.stringContaining(`traces to added intent element ${FEATURE}, which traces to nothing`),
      }),
    ]);

    // Anchor the feature to the existing requirement: now the operation traces, through it.
    await relate(FEATURE, "satisfies", REQUIREMENT);
    const anchored = await brief();
    expect(anchored.intent.untraced).not.toContain(OPERATION);
    expect(anchored.intent.unanchored).toBeUndefined();
    expect(anchored.intent.traced).toContainEqual(
      expect.objectContaining({
        element: OPERATION,
        tracesTo: FEATURE,
        distance: 1,
        path: [OPERATION, FEATURE],
        anchoredBy: { id: REQUIREMENT, path: [FEATURE, REQUIREMENT] },
      })
    );
  });
});

// ---------------------------------------------------------------------------
// 4. existingCount and addedCount
// ---------------------------------------------------------------------------

describe("changeset_brief unwired counts", () => {
  it("counts only elements outside the changeset's own adds as existing, and adds apart", async () => {
    await planExportOrders();
    await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
    const result = await brief({ unwired: "full" });
    const fnEntries = allEntries(findElement(result.unwired, FUNCTION));
    expect(fnEntries).toContainEqual({
      direction: "out",
      predicate: "accesses",
      otherType: "data-model.objectschema",
      existingCount: 0,
      addedCount: 1,
    });
    // The function's own add is not counted for its own type; the base has none.
    const opEntries = allEntries(findElement(result.unwired, OPERATION));
    expect(opEntries).toContainEqual(
      expect.objectContaining({ direction: "out", predicate: "realizes", otherType: "motivation.goal", existingCount: 1, addedCount: 0 })
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Brief size: summary lists only types the model has
// ---------------------------------------------------------------------------

describe("changeset_brief unwired summary size", () => {
  it("lists entries only for types in the projected model and counts the rest per layer", async () => {
    await planExportOrders();
    const summary = await brief();
    const full = await brief({ unwired: "full" });

    const op = findElement(summary.unwired, OPERATION);
    const apiLayer = op.byLayer.find((l: any) => l.layer === "api");
    // The model has no other API element, so nothing in the api layer is listed.
    for (const entry of apiLayer.entries) expect(entry.existingCount + entry.addedCount).toBeGreaterThan(0);
    const fullApi = findElement(full.unwired, OPERATION).byLayer.find((l: any) => l.layer === "api");
    expect(apiLayer.typesNotInModel).toBe(fullApi.entries.filter((e: any) => e.existingCount + e.addedCount === 0).length);
    expect(apiLayer.typesNotInModel).toBeGreaterThan(0);
    expect(apiLayer.count).toBe(fullApi.count);
    // full keeps everything.
    expect(fullApi.entries).toHaveLength(fullApi.count);
    expect(fullApi.typesNotInModel).toBeUndefined();
    expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(full).length);
  });

  it("writes the same JSON with short objects on one line", async () => {
    await planExportOrders();
    const result = await changesetBriefHandler({ rootPath, unwired: "full" } as any);
    const text = (result.content[0] as any).text as string;
    const data = JSON.parse(text);
    expect(compactJson(data)).toBe(text);
    expect(text).toContain(
      '{"direction":"out","predicate":"realizes","otherType":"motivation.goal","existingCount":1,"addedCount":0}'
    );
    expect(text.length).toBeLessThan(JSON.stringify(data, null, 2).length);
  });
});
