/**
 * Base drift on the changeset endpoints: GET /api/changesets and GET /api/changesets/:id report
 * whether the base model changed under a changeset, with no commit attempt, so the viewer can show
 * it before Apply. The state is the one a commit reports. Drift never refuses a commit (#1200): a
 * drifted changeset lands through POST .../commit, whose result says what the base overlapped, and
 * blocksCommit is always false. The state is read by the changeset's purpose: content-free drift
 * (#1169: a base change that overlaps nothing the changeset stages) and a verification record whose
 * plan landed (#1171) have nothing to warn about.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_INDEX_FILE, DRIFT_LIST_LIMIT } from "../../../src/core/changeset-base-index.js";
import { driftDetail, driftStatus } from "../../../src/core/changeset-drift-status.js";
import { extractionPurpose } from "../../../src/core/changeset-purpose.js";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { ChangesetActionResultSchema, ChangesetDetailSchema, ChangesetsListSchema } from "../../../src/server/schemas.js";
import type { VisualizationServer } from "../../../src/server/server.js";
import { createServerWithoutChatDetection } from "./helpers.js";

const GOAL = "motivation.goal.faster-checkout";
const OTHER_GOAL = "motivation.goal.lower-costs";
const SERVICE = "application.applicationservice.order-export";

let rootPath: string;
let server: VisualizationServer | undefined;

/** An element as a staged add or update carries it. */
function goal(id: string, description: string, uuid: string = randomUUID()) {
  return {
    id: uuid,
    path: id,
    spec_node_id: "motivation.goal",
    type: "goal",
    layer_id: "motivation",
    name: id.split(".")[2],
    description,
    attributes: { priority: "high" },
  };
}

function service(id: string) {
  return {
    id: randomUUID(),
    path: id,
    spec_node_id: "application.applicationservice",
    type: "applicationservice",
    layer_id: "application",
    name: id.split(".")[2],
    attributes: { serviceType: "synchronous" },
  };
}

/** A manager over the model as it is on disk now. */
async function fresh(): Promise<{ model: Model; manager: StagingAreaManager }> {
  const model = await Model.load(rootPath, { lazyLoad: false });
  return { model, manager: new StagingAreaManager(rootPath, model) };
}

/** Creates a changeset staging one add; returns its id. */
async function planAdding(name: string, element: ReturnType<typeof goal> | ReturnType<typeof service>): Promise<string> {
  const { manager } = await fresh();
  const id = (await manager.create(name)).id!;
  await manager.stage(id, { type: "add", elementId: element.path, layerName: element.layer_id, after: element });
  return id;
}

/** Lands a changeset the way setup needs it (no validation: the fixtures are minimal). */
async function land(id: string): Promise<void> {
  const { model, manager } = await fresh();
  const result = await manager.commit(model, id, { validate: false });
  expect(result.failed).toBe(0);
}

/** The server over the model as it is on disk now, as the watcher's reload leaves it. */
async function api() {
  server?.stop();
  const { model } = await fresh();
  server = createServerWithoutChatDetection(model, { authEnabled: false });
  const request = (path: string, init?: RequestInit) => (server as any).app.request(path, init) as Promise<Response>;
  return {
    list: async () => ChangesetsListSchema.parse(await (await request("/api/changesets")).json()).changesets,
    detail: async (id: string, query = "") =>
      ChangesetDetailSchema.parse(await (await request(`/api/changesets/${id}${query}`)).json()),
    commit: (id: string) => request(`/api/changesets/${id}/commit`, { method: "POST" }),
  };
}

beforeEach(async () => {
  const dir = join(tmpdir(), `dr-server-drift-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  rootPath = await realpath(dir);
  await Model.init(rootPath, { name: "Drift REST Test", version: "0.1.0" });
  // A goal in the base for the plans to be staged against.
  await land(await planAdding("seed", goal(GOAL, "Checkout in under two minutes")));
});

afterEach(async () => {
  server?.stop();
  server = undefined;
  await rm(rootPath, { recursive: true, force: true });
});

describe("base drift on the changeset endpoints", () => {
  it.serial("a changeset whose base has not changed reads none, on the list and the detail", async () => {
    const id = await planAdding("export-orders", service(SERVICE));
    const { list, detail } = await api();

    const summary = (await list())[id].drift;
    expect(summary).toEqual({
      state: "none",
      blocksCommit: false,
      message: "The base model has not changed under this changeset.",
    });
    // Nothing changed, so there is nothing to describe: the detail is the summary.
    expect((await detail(id)).drift).toEqual(summary);
  });

  it.serial("a plan whose base element changed under it reads drifted, with what landing does about it, and commit lands it", async () => {
    const { model, manager } = await fresh();
    const before = model.layers.get("motivation")!.getElement(GOAL)!.toJSON() as unknown as Record<string, unknown>;
    const update = (description: string) => ({
      type: "update" as const,
      elementId: GOAL,
      layerName: "motivation",
      before,
      after: { ...before, description },
    });
    const planId = (await manager.create("reword-goal")).id!;
    await manager.stage(planId, update("Checkout in under a minute"));
    // Another changeset rewords the same goal and lands first.
    const otherId = (await manager.create("other-reword")).id!;
    await manager.stage(otherId, update("Checkout in thirty seconds"));
    await land(otherId);

    const { list, detail, commit } = await api();
    const summary = (await list())[planId];
    expect(summary.drift.state).toBe("drifted");
    expect(summary.drift.blocksCommit).toBe(false);
    expect(summary.drift.message).toContain("overlaps what this changeset stages");
    expect(summary.drift.message).toContain("It still lands");
    expect(summary.actions).toContain("commit");

    const { drift } = await detail(planId);
    expect(drift).toMatchObject({ state: "drifted", blocksCommit: false, baseIndex: "recorded" });
    expect(drift.overlapping!.elements).toMatchObject([{ id: GOAL, reason: "changed-in-base" }]);
    expect(drift.overlapping!.elements[0].consequence).toContain("landing replaces the base's edit with the plan's version");
    expect(drift.overlapping!.elements[0].resolve).toContain("stage it again");
    expect(drift.baseChanges).toMatchObject({
      counts: { elementsAdded: 0, elementsRemoved: 0, elementsChanged: 1, relationshipsAdded: 0, relationshipsRemoved: 0 },
      elementsChanged: [GOAL],
      layers: ["motivation"],
      truncated: false,
    });
    // The overlap is in `overlapping`; `warnings` holds only what could not be told.
    expect(drift.warnings).toEqual([]);

    // Apply lands it (the route has no force and needs none), and says what it landed over.
    const landed = await commit(planId);
    expect(landed.status).toBe(200);
    const result = ChangesetActionResultSchema.parse(await landed.json());
    expect(result).toMatchObject({ status: "committed", committed: 1, failed: 0 });
    expect(result.drift!.message).toContain("overlapped 1 staged change(s)");
    expect(result.drift!.overlapping!.elements).toMatchObject([{ id: GOAL, reason: "changed-in-base" }]);
    expect(result.drift!.overlapping!.elements[0].consequence).toContain("replaces the base's edit");
    const after = (await fresh()).model.layers.get("motivation")!.getElement(GOAL)!.toJSON();
    expect(after.description).toBe("Checkout in under a minute");
  });

  it.serial("a reviewed commit (a body with drop) lands a drifted changeset too, and puts nothing back", async () => {
    const { model, manager } = await fresh();
    const before = model.layers.get("motivation")!.getElement(GOAL)!.toJSON() as unknown as Record<string, unknown>;
    const update = (description: string) => ({ type: "update" as const, elementId: GOAL, layerName: "motivation", before, after: { ...before, description } });
    const planId = (await manager.create("reword-goal")).id!;
    await manager.stage(planId, update("Checkout in under a minute"));
    const added = service(SERVICE);
    await manager.stage(planId, { type: "add", elementId: added.path, layerName: added.layer_id, after: added });
    const otherId = (await manager.create("other-reword")).id!;
    await manager.stage(otherId, update("Checkout in thirty seconds"));
    await land(otherId);

    // The reviewer leaves the overlapping update out: what lands overlaps nothing.
    const { detail } = await api();
    const overlappingUpdate = (await detail(planId)).changes.find((change) => change.elementId === GOAL)!;
    const landed = await (server as any).app.request(`/api/changesets/${planId}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop: [(overlappingUpdate as { sequenceNumber: number }).sequenceNumber] }),
    });
    expect(landed.status).toBe(200);
    const result = ChangesetActionResultSchema.parse(await landed.json());
    expect(result).toMatchObject({ status: "committed", committed: 1 });
    expect(result.drift).toBeUndefined();
    const after = (await fresh()).model.layers.get("motivation")!.getElement(GOAL)!.toJSON();
    expect(after.description).toBe("Checkout in thirty seconds");
  });

  it.serial("content-free drift (another changeset landed elsewhere) reads content-free, and commit lands it with no drift in the result (#1169)", async () => {
    const planId = await planAdding("export-orders", service(SERVICE));
    await land(await planAdding("lower-costs", goal(OTHER_GOAL, "Track costs")));

    const { list, detail, commit } = await api();
    const summary = (await list())[planId].drift;
    expect(summary.state).toBe("content-free");
    expect(summary.blocksCommit).toBe(false);
    expect(summary.message).toContain("nothing it stages overlaps the change");
    expect(summary.message).toContain("In the base since: 1 element(s) added");

    const { drift } = await detail(planId);
    expect(drift).toMatchObject({ state: "content-free", blocksCommit: false, baseIndex: "recorded" });
    expect(drift.overlapping).toEqual({ elements: [], relationships: [] });
    expect(drift.baseChanges).toMatchObject({
      counts: { elementsAdded: 1, elementsRemoved: 0, elementsChanged: 0 },
      elementsAdded: [OTHER_GOAL],
      layers: ["motivation"],
    });

    // The commit lands it, with nothing to warn about.
    const landed = await commit(planId);
    expect(landed.status).toBe(200);
    const result = await landed.json();
    expect(result).toMatchObject({ status: "committed", committed: 1, failed: 0 });
    expect(result.drift).toBeUndefined();
  });

  it.serial("an edit to a base element the plan neither edits nor links to reads content-free, and commit lands it", async () => {
    const planId = await planAdding("export-orders", service(SERVICE));
    // Another changeset rewords the seeded goal, which this plan does not touch, and lands.
    const { model, manager } = await fresh();
    const before = model.layers.get("motivation")!.getElement(GOAL)!.toJSON() as unknown as Record<string, unknown>;
    const otherId = (await manager.create("reword-goal")).id!;
    await manager.stage(otherId, {
      type: "update",
      elementId: GOAL,
      layerName: "motivation",
      before,
      after: { ...before, description: "Checkout in thirty seconds" },
    });
    await land(otherId);

    const { list, detail, commit } = await api();
    expect((await list())[planId].drift).toMatchObject({ state: "content-free", blocksCommit: false });
    const { drift } = await detail(planId);
    expect(drift.overlapping).toEqual({ elements: [], relationships: [] });
    expect(drift.baseChanges).toMatchObject({ counts: { elementsChanged: 1 }, elementsChanged: [GOAL], layers: ["motivation"] });
    expect(drift.message).toContain("1 element(s) changed, none of them overlapping a staged change");
    expect((await commit(planId)).status).toBe(200);
  });

  it.serial("an update of an element the base removed reads drifted with removed-in-base, and commit lands and reports it", async () => {
    const { model, manager } = await fresh();
    const before = model.layers.get("motivation")!.getElement(GOAL)!.toJSON() as unknown as Record<string, unknown>;
    const planId = (await manager.create("reword-goal")).id!;
    await manager.stage(planId, {
      type: "update",
      elementId: GOAL,
      layerName: "motivation",
      before,
      after: { ...before, description: "Checkout in under a minute" },
    });
    const otherId = (await manager.create("drop-goal")).id!;
    await manager.stage(otherId, { type: "delete", elementId: GOAL, layerName: "motivation", before });
    await land(otherId);

    const { detail, commit } = await api();
    // Parsed with the documented schema, which lists the overlap reasons by hand.
    const { drift } = await detail(planId);
    expect(drift).toMatchObject({ state: "drifted", blocksCommit: false });
    expect(drift.overlapping!.elements).toMatchObject([{ id: GOAL, reason: "removed-in-base" }]);
    expect(drift.baseChanges!.counts).toMatchObject({ elementsRemoved: 1 });
    const landed = await commit(planId);
    expect(landed.status).toBe(200);
    const result = ChangesetActionResultSchema.parse(await landed.json());
    // The update had nothing to apply to, as its consequence said.
    expect(result).toMatchObject({ status: "committed", committed: 0, failed: 1 });
    expect(result.drift!.overlapping!.elements[0].consequence).toContain("reported as failed");
  });

  it.serial("a verification record whose plan has landed reads not-applicable, never as a problem (#1171)", async () => {
    const planId = await planAdding("export-orders", service(SERVICE));
    const { manager } = await fresh();
    const record = await manager.create(
      "export-orders-as-built",
      "As-built extraction of the code at abc1234, files changed since main. Staged by codebase_extract.",
      { kind: "extract" },
      extractionPurpose({ since: "main", gitHead: "abc1234", previousActive: { id: planId } })
    );
    // The record holds what the plan planned, as extraction found it built.
    const built = service(SERVICE);
    await manager.stage(record.id!, { type: "add", elementId: built.path, layerName: built.layer_id, after: built });

    // While the plan is staged the record has nothing to report either.
    let { list } = await api();
    expect((await list())[record.id!].drift).toEqual({
      state: "not-applicable",
      blocksCommit: false,
      message: "A verification record is never landed, so base drift does not apply to it. Its plan 'export-orders' is still staged.",
    });

    // The plan lands: the base now has the element the record adds, which for a plan is drift.
    await land(planId);
    const { model, manager: after } = await fresh();
    expect((await after.detectDrift(record.id!)).isDrifted).toBe(true);
    expect(model.layers.get("application")!.getElement(SERVICE)).toBeTruthy();

    const reads = await api();
    list = reads.list;
    const summary = (await list())[record.id!];
    expect(summary).toMatchObject({ purpose: "verification", verifies: planId, actions: ["discard"] });
    expect(summary.drift).toEqual({
      state: "not-applicable",
      blocksCommit: false,
      message: "A verification record is never landed, so base drift does not apply to it. Its plan 'export-orders' has landed.",
    });
    expect((await reads.detail(record.id!)).drift).toEqual(summary.drift);
    // The landed plan itself has no drift to report.
    expect((await list())[planId].drift).toMatchObject({ state: "not-applicable", blocksCommit: false });
    expect((await list())[planId].drift.message).toContain("committed");
  });

  it.serial("without a base index a changed hash stays drifted, the detail says what it cannot list, and commit still lands", async () => {
    const planId = await planAdding("export-orders", service(SERVICE));
    await rm(join(rootPath, "documentation-robotics", "changesets", planId, BASE_INDEX_FILE));
    await land(await planAdding("lower-costs", goal(OTHER_GOAL, "Track costs")));

    const { list, detail, commit } = await api();
    expect((await list())[planId].drift).toMatchObject({ state: "drifted", blocksCommit: false });
    const { drift } = await detail(planId);
    expect(drift.baseIndex).toBe("not-recorded");
    expect(drift.warnings).toHaveLength(1);
    expect(drift.warnings![0]).toContain("No base index was recorded");
    expect(drift.baseChanges).toBeUndefined();
    expect(drift.overlapping).toEqual({ elements: [], relationships: [] });

    const landed = await commit(planId);
    expect(landed.status).toBe(200);
    const result = ChangesetActionResultSchema.parse(await landed.json());
    expect(result.drift!.message).toContain("could not be listed");
    expect(result.drift!.overlapping).toBeUndefined();
  });

  it.serial("a re-baselined changeset reads none, and the detail of one that still overlaps says it was re-baselined", async () => {
    const { model, manager } = await fresh();
    const before = model.layers.get("motivation")!.getElement(GOAL)!.toJSON() as unknown as Record<string, unknown>;
    const update = (description: string) => ({ type: "update" as const, elementId: GOAL, layerName: "motivation", before, after: { ...before, description } });
    const staleId = (await manager.create("reword-goal")).id!;
    await manager.stage(staleId, update("Checkout in under a minute"));
    const cleanId = await planAdding("export-orders", service(SERVICE));
    const otherId = (await manager.create("other-reword")).id!;
    await manager.stage(otherId, update("Checkout in thirty seconds"));
    await land(otherId);
    await (await fresh()).manager.rebaseline(staleId);
    await (await fresh()).manager.rebaseline(cleanId);

    const { list, detail } = await api();
    expect((await list())[cleanId].drift).toMatchObject({ state: "none", blocksCommit: false });
    // The stale update is still an overlap: a re-baseline does not hide what landing would replace.
    const { drift } = await detail(staleId);
    expect(drift.state).toBe("drifted");
    expect(drift.rebaselined).toMatchObject({ times: 1 });
    expect(drift.overlapping!.elements).toMatchObject([{ id: GOAL, reason: "changed-in-base" }]);
    expect(drift.baseChanges!.counts).toMatchObject({ elementsChanged: 0 });
  });

  it.serial("a changeset with no base snapshot reads unknown and is not blocked", async () => {
    const planId = await planAdding("export-orders", service(SERVICE));
    const { manager } = await fresh();
    const changeset = (await manager.load(planId))!;
    changeset.baseSnapshot = undefined as unknown as string;
    await (manager as any).storage.save(changeset);

    const { list, commit } = await api();
    const { drift } = (await list())[planId];
    expect(drift).toMatchObject({ state: "unknown", blocksCommit: false });
    expect(drift.message).toContain("No base snapshot");
    // As the message says: the commit is not refused for drift.
    expect((await commit(planId)).status).toBe(200);
  });

  it.serial("a verification record whose plan is gone reads not-applicable, with no word about the plan", async () => {
    const { manager } = await fresh();
    const record = await manager.create(
      "export-orders-as-built",
      "As-built extraction of the code at abc1234, files changed since main. Staged by codebase_extract.",
      { kind: "extract" },
      extractionPurpose({ since: "main", gitHead: "abc1234", previousActive: { id: "changeset-0-gone" } })
    );

    const { list } = await api();
    expect((await list())[record.id!].drift).toEqual({
      state: "not-applicable",
      blocksCommit: false,
      message: "A verification record is never landed, so base drift does not apply to it.",
    });
  });

  it.serial("the baseChanges lists are a page with true totals, readable to the end; layers and counts are whole", async () => {
    const planId = await planAdding("export-orders", service(SERVICE));
    // The base gains more application services than a list holds, one product feature that sorts
    // after all of them (so it is cut from elementsAdded), and a relationship whose only
    // motivation-layer trace is its target.
    const { manager } = await fresh();
    const otherId = (await manager.create("many")).id!;
    const count = DRIFT_LIST_LIMIT + 5;
    for (let i = 0; i < count; i++) {
      const added = service(`application.applicationservice.bulk-${String(i).padStart(3, "0")}`);
      await manager.stage(otherId, { type: "add", elementId: added.path, layerName: added.layer_id, after: added });
    }
    const feature = {
      id: randomUUID(),
      path: "product.feature.bulk-import",
      spec_node_id: "product.feature",
      type: "feature",
      layer_id: "product",
      name: "bulk-import",
      attributes: { priority: "low", status: "planned" },
    };
    await manager.stage(otherId, { type: "add", elementId: feature.path, layerName: "product", after: feature });
    const source = "application.applicationservice.bulk-000";
    await manager.stage(otherId, {
      type: "relationship-add",
      elementId: `${source}::realizes::${GOAL}`,
      layerName: "application",
      after: { source, predicate: "realizes", target: GOAL, layer: "application", category: "structural" },
    });
    await land(otherId);

    const { detail } = await api();
    const { drift } = await detail(planId);
    expect(drift.state).toBe("content-free");
    expect(drift.baseChanges!.counts).toMatchObject({ elementsAdded: count + 1, relationshipsAdded: 1 });
    expect(drift.baseChanges!.elementsAdded).toHaveLength(DRIFT_LIST_LIMIT);
    expect(drift.baseChanges!.elementsAdded).not.toContain(feature.path);
    expect(drift.baseChanges!.truncated).toBe(true);
    expect(drift.baseChanges!.layers).toEqual(["application", "motivation", "product"]);
    // The default length is a page, not a cut-off: the page says what there is and how to go on.
    expect(drift.baseChanges!.page).toEqual({
      offset: 0,
      limit: DRIFT_LIST_LIMIT,
      totals: { elementsAdded: count + 1, elementsRemoved: 0, elementsChanged: 0, relationshipsAdded: 1, relationshipsRemoved: 0 },
      returned: { elementsAdded: DRIFT_LIST_LIMIT, elementsRemoved: 0, elementsChanged: 0, relationshipsAdded: 1, relationshipsRemoved: 0 },
      nextOffset: DRIFT_LIST_LIMIT,
      // The call that reads on from any reader, the brief's included.
      more: expect.stringContaining(`rebaseline: "preview", limit: ${DRIFT_LIST_LIMIT}, offset: ${DRIFT_LIST_LIMIT}`),
    });

    // The next page carries the rest, the feature that was cut included, and ends the lists.
    const next = (await detail(planId, `?driftOffset=${drift.baseChanges!.page.nextOffset}`)).drift.baseChanges!;
    expect(next.elementsAdded).toHaveLength(count + 1 - DRIFT_LIST_LIMIT);
    expect(next.elementsAdded).toContain(feature.path);
    expect(next.page).toMatchObject({ offset: DRIFT_LIST_LIMIT, returned: { elementsAdded: count + 1 - DRIFT_LIST_LIMIT, relationshipsAdded: 0 } });
    expect(next.page.nextOffset).toBeUndefined();
    // Counts and layers are computed over everything, whatever the page.
    expect(next.counts).toEqual(drift.baseChanges!.counts);
    expect(next.layers).toEqual(drift.baseChanges!.layers);

    // Everything at once, on request.
    const whole = (await detail(planId, "?driftLimit=1000")).drift.baseChanges!;
    expect(whole.elementsAdded).toHaveLength(count + 1);
    expect(whole.truncated).toBe(false);
    expect(whole.page.nextOffset).toBeUndefined();

    const bad = await (server as any).app.request(`/api/changesets/${planId}?driftLimit=0`);
    expect(bad.status).toBe(400);
  });
});

describe("drift status when the check itself fails", () => {
  it.serial("a failed drift check reads unknown and does not fail the read", async () => {
    const planId = await planAdding("export-orders", service(SERVICE));
    const { manager } = await fresh();
    const changeset = (await manager.load(planId))!;
    const failing = { detectDrift: () => Promise.reject(new Error("model unreadable")) };

    expect(await driftStatus(failing, { changeset, purpose: "plan" })).toEqual({
      state: "unknown",
      blocksCommit: false,
      message: "Drift could not be checked: model unreadable",
    });
  });

  it.serial("a failure to describe what changed keeps the status and says so in warnings", async () => {
    const planId = await planAdding("export-orders", service(SERVICE));
    const { manager } = await fresh();
    const changeset = (await manager.load(planId))!;
    const drifted = {
      detectDrift: async () => ({ isDrifted: true, baseSnapshotId: "a", currentSnapshotId: "b", warnings: [] }),
    };
    const unreadable = {
      getLayerNames: () => {
        throw new Error("layers unreadable");
      },
    } as unknown as Model;

    const detail = await driftDetail(unreadable, drifted, { changeset, purpose: "plan" });
    expect(detail).toMatchObject({ state: "drifted", blocksCommit: false });
    expect(detail.warnings).toEqual(["Could not name what changed in the base: layers unreadable"]);
    expect(detail.overlapping).toBeUndefined();
  });
});

describe("model reloads", () => {
  it.serial("a reload that finishes after a newer one started does not put its older model back", async () => {
    await api();
    const older = (await fresh()).model;
    const newer = (await fresh()).model;
    // Two overlapping reloads (one per file event of a write): the first to start finishes last.
    let finishOlder!: (model: Model) => void;
    const loads = [new Promise<Model>((resolve) => (finishOlder = resolve)), Promise.resolve(newer)];
    (server as any).loadModelFromDisk = () => loads.shift();
    const sent: any[] = [];
    (server as any).clients.add({ send: (data: string) => sent.push(JSON.parse(data)), close: () => {} });

    const first = (server as any).reloadAndBroadcast();
    const second = (server as any).reloadAndBroadcast();
    await second;
    finishOlder(older);
    await first;

    expect((server as any).model).toBe(newer);
    expect(sent.filter((m) => m.type === "model.updated")).toHaveLength(1);
  });
});
