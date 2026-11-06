/**
 * Unit tests for iterating on a plan: unwired connections and deltas in changeset_brief, and
 * focused, hub-collapsing walks in changeset_impact. See "Iterating on a plan" in
 * docs/CHANGE_MODELING.md.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { modelDeleteHandler } from "../../../src/mcp/tools/model-delete.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetUnstageHandler } from "../../../src/mcp/tools/changeset-editing.js";
import { relationshipAddHandler, relationshipDeleteHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetBriefHandler, changesetImpactHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";
import { loadModel } from "../../../src/mcp/tools/shared.js";
import { loadChangesetGraph } from "../../../src/mcp/tools/changeset-shared.js";
import { buildBrief, computeUnwired } from "../../../src/core/changeset-analysis.js";
import { diffBriefs, type BriefSide } from "../../../src/core/changeset-brief-delta.js";
import { isValidRelationship } from "../../../src/generated/relationship-index.js";

function parse(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

const GOAL = "motivation.goal.faster-checkout";
const SERVICE = "application.applicationservice.checkout";
const FUNCTION = "application.applicationfunction.export-orders";
const OPERATION = "api.operation.export-orders";
const SCHEMA = "data-model.objectschema.order-export-row";

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

async function impact(args: Record<string, unknown> = {}): Promise<any> {
  return parse(await changesetImpactHandler({ ...(args as any), rootPath }));
}

/** A goal and a checkout service that realizes it. */
async function setUpBaseModel(): Promise<void> {
  await Model.init(rootPath, { name: "Iteration Test Model", version: "0.1.0" });
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
  rootPath = join(tmpdir(), `dr-mcp-iteration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await setUpBaseModel();
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("changeset_brief unwired connections", () => {
  it("summarizes by default: counts per layer, entries only for layers the change reaches", async () => {
    await planExportOrders();
    const result = await brief();
    expect(result.unwired.mode).toBe("summary");

    const fn = findElement(result.unwired, FUNCTION);
    expect(fn.type).toBe("application.applicationfunction");
    expect(fn.total).toBe(fn.byLayer.reduce((sum: number, l: any) => sum + l.count, 0));
    for (const layer of fn.byLayer) {
      const reached = result.reach.touched.includes(layer.layer);
      expect(layer.entries !== undefined).toBe(reached);
      if (reached) expect(layer.entries).toHaveLength(layer.count);
    }
    // At least one layer the change does not reach is summarized by count alone.
    expect(fn.byLayer.some((l: any) => !result.reach.touched.includes(l.layer) && l.count > 0)).toBe(true);
  });

  it("lists only catalog triples the element does not already satisfy, with existing counts", async () => {
    await planExportOrders();
    const result = await brief({ unwired: "full" });

    for (const element of result.unwired.elements) {
      for (const entry of allEntries(element)) {
        const valid =
          entry.direction === "out"
            ? isValidRelationship(element.type, entry.predicate, entry.otherType)
            : isValidRelationship(entry.otherType, entry.predicate, element.type);
        expect(valid).toBe(true);
      }
    }

    const fn = findElement(result.unwired, FUNCTION);
    const fnEntries = allEntries(fn);
    // Wired: it realizes the service, and the operation realizes it.
    expect(fnEntries).not.toContainEqual(
      expect.objectContaining({ direction: "out", predicate: "realizes", otherType: "application.applicationservice" })
    );
    expect(fnEntries).not.toContainEqual(
      expect.objectContaining({ direction: "in", predicate: "realizes", otherType: "api.operation" })
    );
    // Unwired: it accesses no object schema, and the model has none.
    expect(fnEntries).toContainEqual({
      direction: "out",
      predicate: "accesses",
      otherType: "data-model.objectschema",
      existingCount: 0,
    });

    const op = allEntries(findElement(result.unwired, OPERATION));
    // The model has one goal, one function (already wired) and no other operations than this one.
    expect(op).toContainEqual({ direction: "out", predicate: "realizes", otherType: "motivation.goal", existingCount: 1 });
    // Every layer is listed in full.
    for (const layer of findElement(result.unwired, OPERATION).byLayer) expect(layer.entries).toHaveLength(layer.count);
  });

  it("filters by layer, lists those layers' entries, and reports unknown layers", async () => {
    await planExportOrders();
    const result = await brief({ unwiredLayers: ["motivation", "nonsense"] });
    expect(result.unwired.layers).toEqual(["motivation", "nonsense"]);
    expect(result.unwired.unknownLayers).toEqual(["nonsense"]);
    for (const element of result.unwired.elements) {
      for (const layer of element.byLayer) {
        expect(layer.layer).toBe("motivation");
        expect(layer.entries).toHaveLength(layer.count);
      }
    }
  });

  it("omits the section with unwired: none", async () => {
    await planExportOrders();
    expect((await brief({ unwired: "none" })).unwired).toBeUndefined();
  });

  it("covers updated elements and leaves deleted ones out", async () => {
    await changesetCreateHandler({ name: "rework", rootPath });
    parse(await modelUpdateHandler({ id: SERVICE, description: "Checkout, reworked", rootPath } as any));
    parse(await modelDeleteHandler({ id: GOAL, force: true, rootPath } as any));
    const result = await brief({ unwired: "full" });
    expect(result.unwired.elements.map((e: any) => e.element)).toEqual([SERVICE]);
    // Its realizes link to the goal is deleted with the goal, so it is unwired again, and no goal is left.
    expect(allEntries(result.unwired.elements[0])).toContainEqual({
      direction: "out",
      predicate: "realizes",
      otherType: "motivation.goal",
      existingCount: 0,
    });
  });
});

describe("changeset_brief deltas", () => {
  it("returns the revision and, with since, what changed on the next pass", async () => {
    await planExportOrders();
    const first = await brief();
    expect(first.revision).toBe(3);
    expect(first.delta).toBeUndefined();

    // Pass 2: an object schema, not yet connected.
    await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
    const second = await brief({ since: first.revision });
    expect(second.revision).toBe(4);
    expect(second.delta.since).toBe(3);
    expect(second.delta.elements).toEqual({ added: [SCHEMA], removed: [] });
    expect(second.delta.gaps.opened).toContainEqual(expect.objectContaining({ kind: "unconnected", element: SCHEMA }));
    expect(second.delta.gaps.closed).toEqual([]);
    expect(second.delta.reach.newlyReached).toEqual(["data-model"]);
    expect(second.delta.intent.newlyUntraced).toEqual([SCHEMA]);
    expect(second.delta.unwired.newElements).toEqual([{ element: SCHEMA, count: expect.any(Number) }]);
    // The function's existingCount for object schemas changed, but nothing was wired or unwired on it.
    expect(second.delta.unwired.wired).toEqual([]);
    expect(second.delta.unwired.new).toEqual([]);
    expect(second.delta.note).toContain("approximate");

    // Pass 3: the function accesses it.
    await relate(FUNCTION, "accesses", SCHEMA);
    const third = await brief({ since: second.revision });
    expect(third.delta.elements).toEqual({ added: [], removed: [] });
    expect(third.delta.gaps.closed).toContainEqual(expect.objectContaining({ kind: "unconnected", element: SCHEMA }));
    expect(third.delta.intent.newlyTraced).toEqual([SCHEMA]);
    expect(third.delta.reach).toEqual({ newlyReached: [], noLongerReached: [] });
    expect(third.delta.unwired.wired).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ element: FUNCTION, direction: "out", predicate: "accesses", otherType: "data-model.objectschema" }),
        expect.objectContaining({ element: SCHEMA, direction: "in", predicate: "accesses", otherType: "application.applicationfunction" }),
      ])
    );
    expect(third.delta.unwired.wired).toHaveLength(2);

    // Since the start: everything is new.
    const whole = await brief({ since: -1 });
    expect(whole.delta.elements.added.sort()).toEqual([FUNCTION, OPERATION, SCHEMA].sort());
    expect(whole.delta.reach.newlyReached).toEqual(["application", "api", "data-model"]);
  });

  it("is empty when nothing changed since the revision", async () => {
    await planExportOrders();
    const first = await brief();
    const again = await brief({ since: first.revision });
    expect(again.delta).toMatchObject({
      elements: { added: [], removed: [] },
      gaps: { opened: [], closed: [] },
      unwired: { wired: [], new: [], newElements: [] },
      reach: { newlyReached: [], noLongerReached: [] },
      intent: { newlyTraced: [], newlyUntraced: [] },
    });
    expect(again.delta.warnings).toBeUndefined();
  });

  it("warns when since is past the revision because changes were unstaged, rather than guessing", async () => {
    await planExportOrders();
    const first = await brief();
    // Unstaging the operation drops its add and the relationship to it: two changes, renumbered.
    parse(await changesetUnstageHandler({ elementId: OPERATION, rootPath }));
    const after = await brief({ since: first.revision });
    expect(after.revision).toBe(1);
    expect(after.delta.warnings.join(" ")).toContain("past the current revision");
    expect(after.delta.warnings.join(" ")).toContain("does not list what was unstaged");
    // Nothing is stored between calls, so the unstaged operation cannot be named as removed.
    expect(after.delta.elements).toEqual({ added: [], removed: [] });
  });

  it("approximates the earlier state when an earlier change was unstaged, and warns given the token", async () => {
    await planExportOrders();
    await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
    const before = await brief(); // revision 4
    await relate(FUNCTION, "accesses", SCHEMA); // revision 5
    // Unstage the function's realizes link (revision 2): later changes shift down by one, so
    // revision 4 now ends at the accesses link, and the rebuilt "then" already has it.
    parse(await changesetUnstageHandler({ source: FUNCTION, target: SERVICE, rootPath }));
    const after = await brief({ since: before.revision });
    expect(after.revision).toBe(4);
    // A bare number can't tell: the note is all there is.
    expect(after.delta.warnings).toBeUndefined();
    expect(after.delta.note).toContain("unstaged");

    // The token names the plan at revision 4, so the rewritten prefix is caught.
    const withToken = await brief({ since: before.revisionToken });
    expect(withToken.delta.since).toBe(4);
    expect(withToken.delta.warnings).toHaveLength(1);
    expect(withToken.delta.warnings[0]).toContain("unstaged");
    expect(withToken.delta.warnings[0]).toContain("approximate");
  });

  it("returns a revision token that is stable while the plan is, and gives no warning then", async () => {
    await planExportOrders();
    const first = await brief();
    expect(first.revisionToken).toMatch(/^3:[0-9a-f]+$/);
    const again = await brief({ since: first.revisionToken });
    expect(again.revisionToken).toBe(first.revisionToken);
    expect(again.delta.since).toBe(3);
    expect(again.delta.warnings).toBeUndefined();

    // Staging more keeps the prefix: the delta is exact and unwarned.
    await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
    const next = await brief({ since: first.revisionToken });
    expect(next.revisionToken).toMatch(/^4:/);
    expect(next.delta.elements).toEqual({ added: [SCHEMA], removed: [] });
    expect(next.delta.warnings).toBeUndefined();
  });

  it("warns when unstaging and restaging bring the revision back to the same number", async () => {
    await planExportOrders();
    const first = await brief(); // revision 3
    // Unstage the operation (its add and its relationship go: revision 1), then stage two
    // unconnected object schemas (revision 3 again).
    parse(await changesetUnstageHandler({ elementId: OPERATION, rootPath }));
    await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
    await add({ layer: "data-model", type: "objectschema", name: "order-export-total", attributes: { type: "object" } });
    const after = await brief({ since: first.revisionToken });
    expect(after.revision).toBe(3);
    expect(after.revisionToken).not.toBe(first.revisionToken);
    expect(after.delta.warnings).toHaveLength(1);
    expect(after.delta.warnings[0]).toContain("not the ones that revision token was taken from");

    // The bare number still answers as before (the plan compared with itself), without a warning.
    const bare = await brief({ since: first.revision });
    expect(bare.delta.elements).toEqual({ added: [], removed: [] });
    expect(bare.delta.warnings).toBeUndefined();
  });

  it("warns once when a token's revision is past the current one", async () => {
    await planExportOrders();
    const first = await brief();
    parse(await changesetUnstageHandler({ elementId: OPERATION, rootPath }));
    const after = await brief({ since: first.revisionToken });
    expect(after.delta.warnings).toHaveLength(1);
    expect(after.delta.warnings[0]).toContain("past the current revision");
  });

  it("rejects a since string that is not a revision token", async () => {
    await planExportOrders();
    await expect(brief({ since: "three" })).rejects.toThrow();
  });

  it("lists connections newly unwired on an element already in the change, and intent lost", async () => {
    await changesetCreateHandler({ name: "rework", rootPath });
    parse(await modelUpdateHandler({ id: SERVICE, description: "Checkout, reworked", rootPath } as any));
    const first = await brief(); // revision 0: the service is updated and still realizes the goal
    expect(first.intent.untraced).not.toContain(SERVICE);
    // Stage the deletion of its realizes link to the goal: the service stays in the change but is
    // unwired toward goals again, and no longer traces to one.
    parse(await relationshipDeleteHandler({ source: SERVICE, target: GOAL, rootPath }));
    const after = await brief({ since: first.revisionToken });
    expect(after.delta.warnings).toBeUndefined();
    expect(after.delta.unwired.new).toEqual([
      expect.objectContaining({
        element: SERVICE,
        layer: "motivation",
        direction: "out",
        predicate: "realizes",
        otherType: "motivation.goal",
      }),
    ]);
    expect(after.delta.unwired.newElements).toEqual([]);
    expect(after.delta.unwired.wired).toEqual([]);
    expect(after.delta.intent.newlyUntraced).toEqual([SERVICE]);
    expect(after.delta.intent.newlyTraced).toEqual([]);
    expect(after.delta.elements).toEqual({ added: [], removed: [] });
  });

  it("lists elements removed and layers no longer reached between two states of the plan", async () => {
    /** The brief side as the plan stands now, built in process. */
    async function side(): Promise<BriefSide> {
      clearModelCache();
      const { graph } = await loadChangesetGraph(await loadModel(rootPath));
      return { brief: buildBrief({ graph, unwired: "none" }), unwired: computeUnwired(graph) };
    }
    const TOTAL = "data-model.objectschema.order-export-total";
    await planExportOrders();
    await add({ layer: "data-model", type: "objectschema", name: "order-export-row", attributes: { type: "object" } });
    await add({ layer: "data-model", type: "objectschema", name: "order-export-total", attributes: { type: "object" } });
    const then = await side();
    expect(then.brief.reach.touched).toContain("data-model");

    // Unstage every data-model element.
    parse(await changesetUnstageHandler({ elementId: SCHEMA, rootPath }));
    parse(await changesetUnstageHandler({ elementId: TOTAL, rootPath }));
    const now = await side();

    const delta = diffBriefs(then, now, then.brief.revision);
    expect(delta.elements.removed.sort()).toEqual([SCHEMA, TOTAL].sort());
    expect(delta.elements.added).toEqual([]);
    expect(delta.reach.noLongerReached).toEqual(["data-model"]);
    expect(delta.reach.newlyReached).toEqual([]);
    expect(delta.gaps.closed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "unconnected", element: SCHEMA }),
        expect.objectContaining({ kind: "unconnected", element: TOTAL }),
      ])
    );
    // Removed elements' unwired connections are neither wired nor new.
    expect(delta.unwired.wired.filter((e) => e.element === SCHEMA || e.element === TOTAL)).toEqual([]);
    expect(delta.unwired.new).toEqual([]);
  });
});

describe("changeset_impact focus and hubs", () => {
  /** A hub: the checkout service realized by `count` existing functions. */
  async function addHub(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await add({ layer: "application", type: "applicationfunction", name: `step-${i}` });
      await relate(`application.applicationfunction.step-${i}`, "realizes", SERVICE);
    }
  }

  /** Plans one operation realizing one existing function. */
  async function planOperation(): Promise<void> {
    await changesetCreateHandler({ name: "op", rootPath });
    await add({
      layer: "api",
      type: "operation",
      name: "run-step",
      attributes: { operationId: "runStep", summary: "Run step 0", tags: "steps" },
    });
    await relate("api.operation.run-step", "realizes", "application.applicationfunction.step-0");
  }

  it("reports a hub with its degree and does not walk through it, unless asked", async () => {
    await addHub(16); // the service: 16 functions + the goal = degree 17
    await planOperation();

    const collapsed = await impact({ depth: 3 });
    expect(collapsed.hubThreshold).toBe(15);
    expect(collapsed.hubs).toEqual([{ id: SERVICE, degree: 17, depth: 2 }]);
    expect(collapsed.reached).toBe(2); // step-0, then the service
    expect(collapsed.perHop).toEqual([
      { depth: 1, reached: 1 },
      { depth: 2, reached: 1 },
    ]);
    expect(collapsed.byLayer.motivation).toBeUndefined();

    const expanded = await impact({ depth: 3, expandHubs: true });
    expect(expanded.hubs).toEqual([{ id: SERVICE, degree: 17, depth: 2 }]);
    expect(expanded.reached).toBe(2 + 15 + 1); // + the other functions and the goal
    expect(expanded.perHop).toEqual([
      { depth: 1, reached: 1 },
      { depth: 2, reached: 1 },
      { depth: 3, reached: 16 },
    ]);

    const raised = await impact({ depth: 3, hubThreshold: 20 });
    expect(raised.hubs).toEqual([]);
    expect(raised.reached).toBe(18);
  });

  it("walks from chosen elements, reporting unknown ids without failing", async () => {
    await planExportOrders();
    const result = await impact({ from: [SERVICE, "api.operation.nope"], depth: 1 });
    expect(result.from).toEqual([SERVICE]);
    expect(result.unknownFrom).toEqual(["api.operation.nope"]);
    // One hop from the service: the goal, and the function the plan adds (marked as changed).
    expect(result.byLayer.motivation).toEqual([expect.objectContaining({ id: GOAL, distance: 1 })]);
    expect(result.byLayer.application).toEqual([expect.objectContaining({ id: FUNCTION, distance: 1, status: "added" })]);
    expect(result.perHop).toEqual([{ depth: 1, reached: 2 }]);
    expect(result.changed).toBe(2);

    const none = await impact({ from: ["api.operation.nope"] });
    expect(none.reached).toBe(0);
    expect(none.from).toEqual([]);
    expect(none.warnings).toEqual([expect.stringContaining("None of the from ids")]);
    expect(result.warnings).toBeUndefined();
  });

  it("warns when from is empty instead of looking like nothing is affected", async () => {
    await planExportOrders();
    const empty = await impact({ from: [] });
    expect(empty.reached).toBe(0);
    expect(empty.warnings).toEqual([expect.stringContaining("from is empty")]);
    expect((await impact()).warnings).toBeUndefined();
  });

  it("keeps today's output for a small model (no hubs, no from)", async () => {
    await planExportOrders();
    const result = await impact({ depth: 2 });
    expect(result.from).toBeUndefined();
    expect(result.unknownFrom).toBeUndefined();
    expect(result.hubs).toEqual([]);
    expect(result.perHop).toEqual([
      { depth: 1, reached: 1 },
      { depth: 2, reached: 1 },
    ]);
    expect(result.byLayer.application[0].status).toBeUndefined();
  });
});
