/**
 * What a landing warns about for drift: only a base change that overlaps a staged change
 * (`describeDrift`'s `overlapping`, read by `StagingAreaManager.detectDrift` and so by every commit).
 *
 * Drift never refuses a commit (#1200). The base hash changes whenever any content in the model
 * does, so one landing moves every other staged changeset's hash. With a base index, that is drift
 * only when the base overlaps what the changeset stages; an edit to an element it neither edits
 * nor links to, or only links to (#1208), is content-free. An overlap lands with a warning that
 * says what landing does about it. Without a base index the two can't be told apart, so a changed
 * hash warns without a list.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_INDEX_FILE, describeDrift, readBaseIndex } from "../../../src/core/changeset-base-index.js";
import { BaseSnapshotManager, CONTENT_SNAPSHOT_PREFIX } from "../../../src/core/base-snapshot-manager.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { ChangesetGraph } from "../../../src/core/changeset-graph.js";
import type { StagedChange } from "../../../src/core/changeset.js";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager, type CommitResult } from "../../../src/core/staging-area.js";

const FASTER = "motivation.goal.faster-checkout";
const CHEAPER = "motivation.goal.lower-costs";
const SPARE = "motivation.goal.fewer-returns";
const REQUIREMENT = "motivation.requirement.one-page-checkout";
const SERVICE = "application.applicationservice.order-export";
const REALIZES = { source: REQUIREMENT, predicate: "realizes", target: FASTER };

type Staged = Omit<StagedChange, "sequenceNumber">;

let rootPath: string;

function element(id: string, attributes: Record<string, unknown>, description = "") {
  const [layer, type, name] = id.split(".");
  return { id: randomUUID(), path: id, spec_node_id: `${layer}.${type}`, type, layer_id: layer, name, description, attributes };
}

const add = (e: ReturnType<typeof element>): Staged => ({ type: "add", elementId: e.path, layerName: e.layer_id, after: e });

const link = (type: "relationship-add" | "relationship-delete", rel: typeof REALIZES): Staged => {
  const data = { ...rel, layer: rel.source.split(".")[0], category: "structural" };
  return {
    type,
    elementId: `${rel.source}::${rel.predicate}::${rel.target}`,
    layerName: data.layer,
    ...(type === "relationship-add" ? { after: data } : { before: data }),
  };
};

/** A manager over the model as it is on disk now. */
async function fresh(): Promise<{ model: Model; manager: StagingAreaManager }> {
  const model = await Model.load(rootPath, { lazyLoad: false });
  return { model, manager: new StagingAreaManager(rootPath, model) };
}

/** The base element as a staged update or delete carries it. */
async function inBase(id: string): Promise<Record<string, unknown>> {
  const { model } = await fresh();
  return model.layers.get(id.split(".")[0])!.getElement(id)!.toJSON() as unknown as Record<string, unknown>;
}

async function reword(id: string, description: string): Promise<Staged> {
  const before = await inBase(id);
  return { type: "update", elementId: id, layerName: id.split(".")[0], before, after: { ...before, description } };
}

async function remove(id: string): Promise<Staged> {
  return { type: "delete", elementId: id, layerName: id.split(".")[0], before: await inBase(id) };
}

/** Creates a changeset staging these changes; returns its id. */
async function plan(name: string, changes: Staged[]): Promise<string> {
  const { manager } = await fresh();
  const id = (await manager.create(name)).id!;
  for (const change of changes) await manager.stage(id, change);
  return id;
}

/** Lands a changeset the setup needs in the base: its own landing is not what is under test. */
async function land(id: string): Promise<void> {
  const { model, manager } = await fresh();
  const result = await manager.commit(model, id, { validate: false });
  expect(result.failed).toBe(0);
}

/** The drift check a commit makes, and what describeDrift says overlaps. */
async function drift(id: string) {
  const { model, manager } = await fresh();
  const report = await manager.detectDrift(id);
  const described = await describeDrift(model, await ChangesetGraph.build(model, (await manager.load(id))!));
  return { report, overlapping: described.overlapping, counts: described.baseChanges?.counts };
}

/** Commits as a person would, with no force. Drift never refuses it, so it resolves to the result. */
async function commit(id: string): Promise<CommitResult> {
  const { model, manager } = await fresh();
  return manager.commit(model, id, { validate: false });
}

/** Whether the base has this relationship now. */
async function linked(rel: typeof REALIZES): Promise<boolean> {
  const { model } = await fresh();
  return model.getBaseRelationships().some((r) => r.source === rel.source && r.predicate === rel.predicate && r.target === rel.target);
}

async function exists(id: string): Promise<boolean> {
  const { model } = await fresh();
  return !!model.layers.get(id.split(".")[0])?.getElement(id);
}

beforeEach(async () => {
  const dir = join(tmpdir(), `dr-drift-overlap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  rootPath = await realpath(dir);
  await Model.init(rootPath, { name: "Drift Overlap Test", version: "0.1.0" });
  // The base every plan below is staged against: three goals, and a requirement realizing one.
  await land(
    await plan("seed", [
      add(element(FASTER, { priority: "high" }, "Checkout in under two minutes")),
      add(element(CHEAPER, { priority: "low" }, "Track costs")),
      add(element(SPARE, { priority: "low" }, "Fewer returns")),
      add(element(REQUIREMENT, { requirementType: "functional", priority: "high" })),
      link("relationship-add", REALIZES),
    ])
  );
});

afterEach(async () => {
  await rm(rootPath, { recursive: true, force: true });
});

describe("a base change the changeset does not overlap is content-free", () => {
  it.serial("an edit to an element it neither edits nor links to: not drift, and it lands with no warning", async () => {
    const id = await plan("export-orders", [add(element(SERVICE, { serviceType: "synchronous" }))]);
    await land(await plan("reword", [await reword(CHEAPER, "Halve hosting costs")]));

    const { report, overlapping, counts } = await drift(id);
    expect(report).toMatchObject({ isDrifted: false, contentFree: true });
    expect(report.warnings[0]).toContain("nothing it stages overlaps the change");
    expect(report.warnings[0]).toContain("In the base since: 1 element(s) changed, none of them overlapping a staged change.");
    expect(overlapping).toEqual({ elements: [], relationships: [] });
    expect(counts).toMatchObject({ elementsChanged: 1 });
    const result = await commit(id);
    expect(result).toMatchObject({ committed: 1, failed: 0 });
    expect(result.driftWarning).toBeUndefined();
    expect(result.driftDetail).toBeUndefined();
  });

  it.serial("an edit to another element than the one it updates", async () => {
    const id = await plan("reword-faster", [await reword(FASTER, "Checkout in under a minute")]);
    await land(await plan("reword-cheaper", [await reword(CHEAPER, "Halve hosting costs")]));

    expect((await drift(id)).report).toMatchObject({ isDrifted: false, contentFree: true });
    expect((await commit(id)).driftWarning).toBeUndefined();
  });

  it.serial("the removal of an element and of a relationship it does not touch", async () => {
    const id = await plan("export-orders", [add(element(SERVICE, { serviceType: "synchronous" }))]);
    await land(await plan("drop", [link("relationship-delete", REALIZES), await remove(CHEAPER)]));

    const { report, overlapping, counts } = await drift(id);
    expect(counts).toMatchObject({ elementsRemoved: 1, relationshipsRemoved: 1 });
    expect(overlapping).toEqual({ elements: [], relationships: [] });
    expect(report).toMatchObject({ isDrifted: false, contentFree: true });
    expect(report.warnings[0]).toContain("1 element(s) removed, 1 relationship(s) removed");
    expect((await commit(id)).driftWarning).toBeUndefined();
  });

  it.serial("an edit elsewhere under a plan that stages a relationship and a delete", async () => {
    // Neither end of the staged relationship, nor the element it deletes, is the one the base rewords.
    const id = await plan("rewire", [
      link("relationship-add", { source: REQUIREMENT, predicate: "realizes", target: CHEAPER }),
      await remove(SPARE),
    ]);
    await land(await plan("reword", [await reword(FASTER, "Checkout in thirty seconds")]));

    const { report, overlapping } = await drift(id);
    expect(overlapping).toEqual({ elements: [], relationships: [] });
    expect(report).toMatchObject({ isDrifted: false, contentFree: true });
    expect((await commit(id)).driftWarning).toBeUndefined();
  });

  it.serial("an edit to an element it only links to is not an overlap (#1208)", async () => {
    // The end keeps its id, and with it its layer and type: the link is as right as it was.
    const id = await plan("export-orders", [
      add(element(SERVICE, { serviceType: "synchronous" })),
      link("relationship-add", { source: SERVICE, predicate: "realizes", target: FASTER }),
      link("relationship-delete", REALIZES),
    ]);
    await land(
      await plan("other-reword", [
        await reword(FASTER, "Checkout in thirty seconds"),
        {
          ...(await reword(REQUIREMENT, "One page")),
          after: { ...(await inBase(REQUIREMENT)), name: "single-page-checkout", attributes: { requirementType: "functional", priority: "low" } },
        },
      ])
    );

    const { report, overlapping, counts } = await drift(id);
    expect(counts).toMatchObject({ elementsChanged: 2 });
    expect(overlapping).toEqual({ elements: [], relationships: [] });
    expect(report).toMatchObject({ isDrifted: false, contentFree: true });
    const result = await commit(id);
    expect(result).toMatchObject({ committed: 3, failed: 0 });
    expect(result.driftWarning).toBeUndefined();
    expect(await linked({ source: SERVICE, predicate: "realizes", target: FASTER })).toBe(true);
  });
});

describe("a base change that overlaps a staged change warns, and the changeset still lands", () => {
  it.serial("an edit to the element it updates (changed-in-base): landing replaces the base's edit", async () => {
    const id = await plan("reword-faster", [await reword(FASTER, "Checkout in under a minute")]);
    await land(await plan("other-reword", [await reword(FASTER, "Checkout in thirty seconds")]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(report.contentFree).toBeUndefined();
    expect(overlapping.elements).toMatchObject([{ id: FASTER, reason: "changed-in-base" }]);
    expect(overlapping.elements[0].consequence).toContain("landing replaces the base's edit with the plan's version");
    expect(overlapping.elements[0].resolve).toContain("stage it again");

    const result = await commit(id);
    expect(result).toMatchObject({ committed: 1, failed: 0 });
    expect(result.driftWarning?.isDrifted).toBe(true);
    expect(result.driftDetail?.overlapping.elements).toMatchObject([{ id: FASTER, reason: "changed-in-base" }]);
    expect(await inBase(FASTER)).toMatchObject({ description: "Checkout in under a minute" });
  });

  it.serial("a dry run reports the same overlaps and writes nothing", async () => {
    const id = await plan("reword-faster", [await reword(FASTER, "Checkout in under a minute")]);
    await land(await plan("other-reword", [await reword(FASTER, "Checkout in thirty seconds")]));

    const { model, manager } = await fresh();
    const dryRun = await manager.commit(model, id, { validate: false, dryRun: true });
    expect(dryRun.driftWarning?.isDrifted).toBe(true);
    expect(dryRun.driftDetail?.overlapping.elements).toMatchObject([{ id: FASTER, reason: "changed-in-base" }]);
    expect(await inBase(FASTER)).toMatchObject({ description: "Checkout in thirty seconds" });
  });

  it.serial("force is accepted and changes nothing", async () => {
    const id = await plan("reword-faster", [await reword(FASTER, "Checkout in under a minute")]);
    await land(await plan("other-reword", [await reword(FASTER, "Checkout in thirty seconds")]));

    const { model, manager } = await fresh();
    const result = await manager.commit(model, id, { validate: false, force: true });
    expect(result).toMatchObject({ committed: 1, failed: 0 });
    expect(result.driftDetail?.overlapping.elements).toMatchObject([{ id: FASTER, reason: "changed-in-base" }]);
  });

  it.serial("the removal of the element it updates (removed-in-base): the update has nothing to apply to", async () => {
    const id = await plan("reword-cheaper", [await reword(CHEAPER, "Halve hosting costs")]);
    await land(await plan("drop", [await remove(CHEAPER)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toMatchObject([{ id: CHEAPER, reason: "removed-in-base" }]);
    expect(overlapping.elements[0].consequence).toContain("reported as failed");

    const result = await commit(id);
    expect(result).toMatchObject({ committed: 0, failed: 1 });
    expect(result.driftDetail?.overlapping.elements).toMatchObject([{ id: CHEAPER, reason: "removed-in-base" }]);
    expect(await exists(CHEAPER)).toBe(false);
  });

  it.serial("an edit to the element it deletes (changed-in-base): landing deletes it, the edit included", async () => {
    const id = await plan("drop-spare", [await remove(SPARE)]);
    await land(await plan("reword", [await reword(SPARE, "Halve the return rate")]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toMatchObject([{ id: SPARE, reason: "changed-in-base" }]);
    expect(overlapping.elements[0].consequence).toContain("landing deletes it, the base's edit included");
    expect((await commit(id)).driftWarning?.isDrifted).toBe(true);
    expect(await exists(SPARE)).toBe(false);
  });

  it.serial("the base no longer has the element it deletes (already-removed): the delete is skipped", async () => {
    const id = await plan("drop-spare", [await remove(SPARE)]);
    await land(await plan("drop-first", [await remove(SPARE)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toMatchObject([{ id: SPARE, reason: "already-removed" }]);
    expect(await commit(id)).toMatchObject({ committed: 0, skipped: 1, failed: 0 });
  });

  it.serial("the base no longer has the relationship it deletes (already-removed)", async () => {
    const id = await plan("unlink", [link("relationship-delete", REALIZES)]);
    await land(await plan("unlink-first", [link("relationship-delete", REALIZES)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.relationships).toMatchObject([{ ...REALIZES, reason: "already-removed" }]);
    expect(overlapping.relationships[0].consequence).toContain("nothing to remove");
    expect((await commit(id)).driftDetail?.overlapping.relationships).toHaveLength(1);
    expect(await linked(REALIZES)).toBe(false);
  });

  it.serial("the base already has what it adds (already-in-base): the add is skipped", async () => {
    const id = await plan("export-orders", [add(element(SERVICE, { serviceType: "synchronous" }, "Mine"))]);
    await land(await plan("same-service", [add(element(SERVICE, { serviceType: "synchronous" }, "Theirs"))]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toMatchObject([{ id: SERVICE, reason: "already-in-base" }]);
    expect(overlapping.elements[0].consequence).toContain("the staged add is skipped");
    expect((await commit(id)).driftWarning?.isDrifted).toBe(true);
    expect(await inBase(SERVICE)).toMatchObject({ description: "Theirs" });
  });
});

describe("a staged change is compared with the base through what it was staged on", () => {
  it.serial("an update staged on the base as it is now is not an overlap, though the base changed since the changeset was created (#1239)", async () => {
    const id = await plan("reword-faster", [add(element(SERVICE, { serviceType: "synchronous" }))]);
    await land(await plan("other-reword", [await reword(FASTER, "Checkout in thirty seconds")]));
    // Staged after the base's edit, on the element as the base has it now.
    const { manager } = await fresh();
    await manager.stage(id, await reword(FASTER, "Checkout in ten seconds"));

    const { report, overlapping, counts } = await drift(id);
    expect(counts).toMatchObject({ elementsChanged: 1 });
    expect(overlapping).toEqual({ elements: [], relationships: [] });
    expect(report).toMatchObject({ isDrifted: false, contentFree: true });
    expect((await commit(id)).driftWarning).toBeUndefined();
    expect(await inBase(FASTER)).toMatchObject({ description: "Checkout in ten seconds" });
  });

  it.serial("an update restaged on the current base stops being changed-in-base", async () => {
    const id = await plan("reword-faster", [await reword(FASTER, "Checkout in under a minute")]);
    await land(await plan("other-reword", [await reword(FASTER, "Checkout in thirty seconds")]));
    expect((await drift(id)).overlapping.elements).toMatchObject([{ id: FASTER, reason: "changed-in-base" }]);

    const { manager } = await fresh();
    await manager.unstage(id, FASTER);
    await manager.stage(id, await reword(FASTER, "Checkout in thirty seconds, in one step"));

    const { report, overlapping } = await drift(id);
    expect(overlapping).toEqual({ elements: [], relationships: [] });
    expect(report).toMatchObject({ isDrifted: false, contentFree: true });
  });

  it.serial("without a base index a stale update is still found, from what it recorded", async () => {
    const id = await plan("reword-faster", [await reword(FASTER, "Checkout in under a minute")]);
    await rm(join(rootPath, "documentation-robotics", "changesets", id, BASE_INDEX_FILE));
    await land(await plan("other-reword", [await reword(FASTER, "Checkout in thirty seconds")]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toMatchObject([{ id: FASTER, reason: "changed-in-base" }]);
  });
});

describe("an overlap is found whatever ops the changeset stages for it, in any order", () => {
  it.serial("a delete then an add (a recreate) of an element the base changed (changed-in-base)", async () => {
    // The last op for the element is "add", and landing it replaces the base's edit and purges
    // the relationship the base gained on it.
    const id = await plan("recreate-faster", [
      link("relationship-delete", REALIZES),
      await remove(FASTER),
      add(element(FASTER, { priority: "high" }, "Checkout in one step")),
    ]);
    const influence = { source: REQUIREMENT, predicate: "influence", target: FASTER };
    await land(await plan("other", [await reword(FASTER, "Checkout in thirty seconds"), link("relationship-add", influence)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toMatchObject([{ id: FASTER, reason: "changed-in-base" }]);
    expect((await commit(id)).driftWarning?.isDrifted).toBe(true);
    expect(await inBase(FASTER)).toMatchObject({ description: "Checkout in one step" });
    expect(await linked(influence)).toBe(false);
  });

  it.serial("a recreate of an element the base removed (removed-in-base): landing puts it back", async () => {
    const id = await plan("recreate-spare", [await remove(SPARE), add(element(SPARE, { priority: "low" }, "No returns"))]);
    await land(await plan("drop", [await remove(SPARE)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toMatchObject([{ id: SPARE, reason: "removed-in-base" }]);
    expect(overlapping.elements[0].consequence).toContain("landing puts it back");
    expect((await commit(id)).driftWarning?.isDrifted).toBe(true);
    expect(await exists(SPARE)).toBe(true);
  });

  it.serial("an update then a delete of an element the base removed (already-removed)", async () => {
    const id = await plan("retire-spare", [await reword(SPARE, "Retired"), await remove(SPARE)]);
    await land(await plan("drop", [await remove(SPARE)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toMatchObject([{ id: SPARE, reason: "already-removed" }]);
    expect((await commit(id)).driftWarning?.isDrifted).toBe(true);
  });

  it.serial("a delete then an add of a relationship the base removed (already-removed): landing puts it back", async () => {
    const id = await plan("relink", [link("relationship-delete", REALIZES), link("relationship-add", REALIZES)]);
    await land(await plan("unlink", [link("relationship-delete", REALIZES)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.relationships).toMatchObject([{ ...REALIZES, reason: "already-removed" }]);
    expect(overlapping.relationships[0].consequence).toContain("landing puts it back");
    expect((await commit(id)).driftWarning?.isDrifted).toBe(true);
    expect(await linked(REALIZES)).toBe(true);
  });

  it.serial("an add then a delete of an element the base gained since (already-in-base): landing deletes the base's", async () => {
    const mine = element(SERVICE, { serviceType: "synchronous" });
    const id = await plan("try-service", [add(mine), { type: "delete", elementId: SERVICE, layerName: "application", before: mine }]);
    await land(await plan("same-service", [add(element(SERVICE, { serviceType: "synchronous" }))]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toMatchObject([{ id: SERVICE, reason: "already-in-base" }]);
    expect(overlapping.elements[0].consequence).toContain("landing deletes the base's element");
    expect((await commit(id)).driftWarning?.isDrifted).toBe(true);
    expect(await exists(SERVICE)).toBe(false);
  });
});

describe("a staged delete and the relationships the base gained since", () => {
  it.serial("a delete of an element the base has since linked (linked-in-base): landing purges the new relationship", async () => {
    const gained = { source: REQUIREMENT, predicate: "realizes", target: SPARE };
    const id = await plan("drop-spare", [await remove(SPARE)]);
    await land(await plan("link-spare", [link("relationship-add", gained)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toMatchObject([{ id: SPARE, reason: "linked-in-base" }]);
    expect(overlapping.elements[0].consequence).toContain("landing deletes the element and that relationship with it");
    expect((await commit(id)).driftWarning?.isDrifted).toBe(true);
    expect(await linked(gained)).toBe(false);
  });

  it.serial("a delete of an element while the base gained a relationship elsewhere is content-free", async () => {
    const id = await plan("drop-spare", [await remove(SPARE)]);
    await land(await plan("link-cheaper", [link("relationship-add", { source: REQUIREMENT, predicate: "realizes", target: CHEAPER })]));

    const { report, overlapping } = await drift(id);
    expect(overlapping).toEqual({ elements: [], relationships: [] });
    expect(report).toMatchObject({ isDrifted: false, contentFree: true });
    expect((await commit(id)).driftWarning).toBeUndefined();
  });
});

describe("a staged relationship that names an end by an id only the removed element could resolve", () => {
  it.serial("is an overlap when the base removed that element (endpoint-removed-in-base)", async () => {
    const uuid = (await inBase(CHEAPER)).id as string;
    const id = await plan("link-by-uuid", [link("relationship-add", { source: REQUIREMENT, predicate: "realizes", target: uuid })]);
    await land(await plan("drop", [await remove(CHEAPER)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.relationships).toHaveLength(1);
    expect(overlapping.relationships[0]).toMatchObject({ source: REQUIREMENT, reason: "endpoint-removed-in-base" });
    expect(overlapping.relationships[0].consequence).toContain("an element that no longer exists");
  });
});

describe("without a base index", () => {
  it.serial("a changed hash warns, also when nothing overlaps: the two can't be told apart, and it still lands", async () => {
    const id = await plan("export-orders", [add(element(SERVICE, { serviceType: "synchronous" }))]);
    await rm(join(rootPath, "documentation-robotics", "changesets", id, BASE_INDEX_FILE));
    await land(await plan("reword", [await reword(CHEAPER, "Halve hosting costs")]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(report.contentFree).toBeUndefined();
    expect(overlapping).toEqual({ elements: [], relationships: [] });

    const result = await commit(id);
    expect(result).toMatchObject({ committed: 1, failed: 0 });
    expect(result.driftWarning?.isDrifted).toBe(true);
    expect(result.driftDetail).toMatchObject({ baseIndex: "not-recorded", overlapping: { elements: [], relationships: [] } });
    expect(result.driftDetail?.warnings.join(" ")).toContain("No base index was recorded");
  });
});

describe("the base hash covers content and relationships only, with a version prefix (#1169)", () => {
  it.serial("a new changeset records a content snapshot, and a manifest-only change is not drift, with or without a base index", async () => {
    const id = await plan("export-orders", [add(element(SERVICE, { serviceType: "synchronous" }))]);
    const { manager } = await fresh();
    expect((await manager.load(id))!.baseSnapshot).toStartWith(CONTENT_SNAPSHOT_PREFIX);
    await rm(join(rootPath, "documentation-robotics", "changesets", id, BASE_INDEX_FILE));

    // What a landing or an upgrade does to the manifest without touching any element.
    const { model } = await fresh();
    model.manifest.changeset_history = [...(model.manifest.changeset_history ?? []), { name: "elsewhere", committed_at: new Date().toISOString(), action: "committed" }];
    await model.saveManifest();

    const { report } = await drift(id);
    expect(report).toMatchObject({ isDrifted: false });
    expect(report.contentFree).toBeUndefined();
    expect(report.currentSnapshotId).toBe(report.baseSnapshotId);
  });

  it.serial("a relationship the base gained changes the hash", async () => {
    const snapshots = new BaseSnapshotManager();
    const before = await snapshots.captureSnapshot((await fresh()).model);
    await land(await plan("link", [link("relationship-add", { source: REQUIREMENT, predicate: "realizes", target: CHEAPER })]));
    const after = await snapshots.captureSnapshot((await fresh()).model);
    expect(after).not.toBe(before);
    // The same content hashes the same, whenever it is read.
    expect(await snapshots.captureSnapshot((await fresh()).model)).toBe(after);
  });

  it.serial("a hash recorded before the prefix is compared with one made the same way, never read as drift for its format", async () => {
    const id = await plan("export-orders", [add(element(SERVICE, { serviceType: "synchronous" }))]);
    // As a changeset created by CLI 0.6.0 recorded it: the full snapshot, no prefix.
    const storage = new StagedChangesetStorage(rootPath);
    const changeset = (await storage.load(id))!;
    changeset.baseSnapshot = await new BaseSnapshotManager().captureFullSnapshot((await fresh()).model);
    expect(changeset.baseSnapshot).toStartWith("sha256:");
    await storage.save(changeset);

    const inStep = (await drift(id)).report;
    expect(inStep).toMatchObject({ isDrifted: false, baseSnapshotId: changeset.baseSnapshot, currentSnapshotId: changeset.baseSnapshot });

    // Another landing moves the full snapshot (its manifest history); the base index says it overlaps nothing.
    await land(await plan("reword", [await reword(CHEAPER, "Halve hosting costs")]));
    const moved = (await drift(id)).report;
    expect(moved).toMatchObject({ isDrifted: false, contentFree: true });
    expect(moved.currentSnapshotId).toStartWith("sha256:");
  });
});

describe("re-baselining a changeset (#1169)", () => {
  it.serial("returns what moved under it, and the base as it is now becomes its base", async () => {
    const gained = { source: REQUIREMENT, predicate: "realizes", target: SPARE };
    const id = await plan("drop-spare", [await remove(SPARE)]);
    await land(await plan("link-spare", [link("relationship-add", gained), await reword(CHEAPER, "Halve hosting costs")]));
    expect((await drift(id)).report.isDrifted).toBe(true);

    const { manager } = await fresh();
    const previous = (await manager.load(id))!.baseSnapshot;
    const result = await manager.rebaseline(id);

    expect(result.previousBaseSnapshot).toBe(previous);
    expect(result.baseSnapshot).not.toBe(previous);
    expect(result.before.baseChanges?.counts).toMatchObject({ elementsChanged: 1, relationshipsAdded: 1 });
    expect(result.before.overlapping.elements).toMatchObject([{ id: SPARE, reason: "linked-in-base" }]);
    expect(result.after.overlapping).toEqual({ elements: [], relationships: [] });
    expect(result.after.baseChanges?.counts).toEqual({ elementsAdded: 0, elementsRemoved: 0, elementsChanged: 0, relationshipsAdded: 0, relationshipsRemoved: 0 });

    const after = await fresh();
    expect((await after.manager.load(id))!.baseSnapshot).toBe(result.baseSnapshot);
    expect(await after.manager.detectDrift(id)).toMatchObject({ isDrifted: false, baseSnapshotId: result.baseSnapshot });
    expect((await readBaseIndex(rootPath, id))!.rebaselined).toMatchObject({ from: previous, times: 1 });
    // The staged change is as it was.
    expect((await after.manager.load(id))!.changes).toHaveLength(1);
    expect((await commit(id)).driftWarning).toBeUndefined();
  });

  it.serial("does not hide an update staged on older content: it stays changed-in-base until it is restaged", async () => {
    const id = await plan("reword-faster", [await reword(FASTER, "Checkout in under a minute")]);
    await land(await plan("other-reword", [await reword(FASTER, "Checkout in thirty seconds")]));

    const { manager } = await fresh();
    const result = await manager.rebaseline(id);
    expect(result.before.overlapping.elements).toMatchObject([{ id: FASTER, reason: "changed-in-base" }]);
    expect(result.after.overlapping.elements).toMatchObject([{ id: FASTER, reason: "changed-in-base" }]);

    // The hash now matches, and the landing still warns about what it would replace.
    const { report, overlapping } = await drift(id);
    expect(report.currentSnapshotId).toBe(report.baseSnapshotId);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toMatchObject([{ id: FASTER, reason: "changed-in-base" }]);
    expect((await commit(id)).driftDetail?.overlapping.elements).toMatchObject([{ id: FASTER, reason: "changed-in-base" }]);
  });

  it.serial("counts each re-baseline, and gives a changeset without a base index one", async () => {
    const id = await plan("export-orders", [add(element(SERVICE, { serviceType: "synchronous" }))]);
    await rm(join(rootPath, "documentation-robotics", "changesets", id, BASE_INDEX_FILE));
    await land(await plan("reword", [await reword(CHEAPER, "Halve hosting costs")]));

    const first = await (await fresh()).manager.rebaseline(id);
    expect(first.before.baseIndex).toBe("not-recorded");
    expect(first.before.baseChanges).toBeUndefined();
    expect(first.after.baseIndex).toBe("recorded");
    expect((await drift(id)).report.isDrifted).toBe(false);

    await (await fresh()).manager.rebaseline(id);
    expect((await readBaseIndex(rootPath, id))!.rebaselined?.times).toBe(2);
  });

  it.serial("is refused for a changeset that is no longer staged", async () => {
    const id = await plan("export-orders", [add(element(SERVICE, { serviceType: "synchronous" }))]);
    await land(id);
    await expect((await fresh()).manager.rebaseline(id)).rejects.toThrow("only a staged changeset can be re-baselined");
  });
});
