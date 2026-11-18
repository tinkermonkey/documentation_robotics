/**
 * Base drift on the changeset endpoints: GET /api/changesets and GET /api/changesets/:id report
 * whether the base model changed under a changeset, with no commit attempt, so the viewer can show
 * it before Apply. The state is the one a commit acts on (blocksCommit is true exactly when POST
 * .../commit answers 409 for drift), and it is read by the changeset's purpose: content-free drift
 * (#1169) and a verification record whose plan landed (#1171) never read as blocking.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_INDEX_FILE } from "../../../src/core/changeset-base-index.js";
import { extractionPurpose } from "../../../src/core/changeset-purpose.js";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { ChangesetDetailSchema, ChangesetsListSchema } from "../../../src/server/schemas.js";
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
    detail: async (id: string) => ChangesetDetailSchema.parse(await (await request(`/api/changesets/${id}`)).json()),
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
      message: "The base model has not changed since this changeset was created.",
    });
    // Nothing changed, so there is nothing to describe: the detail is the summary.
    expect((await detail(id)).drift).toEqual(summary);
  });

  it.serial("a plan whose base element changed under it reads drifted and blocking, with what changed, and commit agrees (409)", async () => {
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
    expect(summary.drift.blocksCommit).toBe(true);
    expect(summary.drift.message).toBe("The base model changed since this changeset was created, so a commit is refused for drift.");
    expect(summary.actions).toContain("commit");

    const { drift } = await detail(planId);
    expect(drift).toMatchObject({ state: "drifted", blocksCommit: true, baseIndex: "recorded" });
    expect(drift.overlapping!.elements).toEqual([{ id: GOAL, reason: "changed-in-base" }]);
    expect(drift.baseChanges).toMatchObject({
      counts: { elementsAdded: 0, elementsRemoved: 0, elementsChanged: 1, relationshipsAdded: 0, relationshipsRemoved: 0 },
      elementsChanged: [GOAL],
      layers: ["motivation"],
      truncated: false,
    });
    expect(drift.warnings!.join(" ")).toContain(`${GOAL} (changed-in-base)`);

    // The report and the commit read the same check.
    const refused = await commit(planId);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain("drifted");
  });

  it.serial("content-free drift (another changeset landed elsewhere) reads content-free, not blocking, and commit lands it (#1169)", async () => {
    const planId = await planAdding("export-orders", service(SERVICE));
    await land(await planAdding("lower-costs", goal(OTHER_GOAL, "Track costs")));

    const { list, detail, commit } = await api();
    const summary = (await list())[planId].drift;
    expect(summary.state).toBe("content-free");
    expect(summary.blocksCommit).toBe(false);
    expect(summary.message).toContain("nothing it was staged against changed");
    expect(summary.message).toContain("The base gained 1 element(s)");

    const { drift } = await detail(planId);
    expect(drift).toMatchObject({ state: "content-free", blocksCommit: false, baseIndex: "recorded" });
    expect(drift.overlapping).toEqual({ elements: [], relationships: [] });
    expect(drift.baseChanges).toMatchObject({
      counts: { elementsAdded: 1, elementsRemoved: 0, elementsChanged: 0 },
      elementsAdded: [OTHER_GOAL],
      layers: ["motivation"],
    });

    // The commit lands it: what the report said would not block did not.
    const landed = await commit(planId);
    expect(landed.status).toBe(200);
    expect(await landed.json()).toMatchObject({ status: "committed", committed: 1, failed: 0 });
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

  it.serial("without a base index a changed hash stays drifted, and the detail says what it cannot list", async () => {
    const planId = await planAdding("export-orders", service(SERVICE));
    await rm(join(rootPath, "documentation-robotics", "changesets", planId, BASE_INDEX_FILE));
    await land(await planAdding("lower-costs", goal(OTHER_GOAL, "Track costs")));

    const { list, detail } = await api();
    expect((await list())[planId].drift).toMatchObject({ state: "drifted", blocksCommit: true });
    const { drift } = await detail(planId);
    expect(drift.baseIndex).toBe("not-recorded");
    expect(drift.baseChanges).toBeUndefined();
    expect(drift.overlapping).toEqual({ elements: [], relationships: [] });
  });

  it.serial("a changeset with no base snapshot reads unknown and is not blocked", async () => {
    const planId = await planAdding("export-orders", service(SERVICE));
    const { manager } = await fresh();
    const changeset = (await manager.load(planId))!;
    changeset.baseSnapshot = undefined as unknown as string;
    await (manager as any).storage.save(changeset);

    const { list } = await api();
    const { drift } = (await list())[planId];
    expect(drift).toMatchObject({ state: "unknown", blocksCommit: false });
    expect(drift.message).toContain("No base snapshot");
  });
});
