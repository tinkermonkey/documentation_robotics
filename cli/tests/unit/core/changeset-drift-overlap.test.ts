/**
 * What blocks a landing for drift: only a base change that overlaps a staged change
 * (`contentFreeDrift`, read by `StagingAreaManager.detectDrift` and so by every commit).
 *
 * The base hash changes whenever anything in the model does, so one landing moves every other
 * staged changeset's hash. With a base index, that is drift only when the base overlaps what the
 * changeset stages; an edit to an element it neither edits nor links to is content-free and lands
 * without force. Without a base index the two can't be told apart, so a changed hash still blocks.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_INDEX_FILE, describeDrift } from "../../../src/core/changeset-base-index.js";
import { ChangesetGraph } from "../../../src/core/changeset-graph.js";
import type { StagedChange } from "../../../src/core/changeset.js";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";

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

/** Lands a changeset, forced: the setup's own landings are not what is under test. */
async function land(id: string): Promise<void> {
  const { model, manager } = await fresh();
  const result = await manager.commit(model, id, { validate: false, force: true });
  expect(result.failed).toBe(0);
}

/** The drift check a commit makes, and what describeDrift says overlaps. */
async function drift(id: string) {
  const { model, manager } = await fresh();
  const report = await manager.detectDrift(id);
  const described = await describeDrift(model, await ChangesetGraph.build(model, (await manager.load(id))!));
  return { report, overlapping: described.overlapping, counts: described.baseChanges?.counts };
}

/** Commits without force, as a person would: resolves to the error message when refused. */
async function commit(id: string): Promise<string | undefined> {
  const { model, manager } = await fresh();
  try {
    const result = await manager.commit(model, id, { validate: false });
    expect(result.failed).toBe(0);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
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
  it.serial("an edit to an element it neither edits nor links to: not drift, and it lands without force", async () => {
    const id = await plan("export-orders", [add(element(SERVICE, { serviceType: "synchronous" }))]);
    await land(await plan("reword", [await reword(CHEAPER, "Halve hosting costs")]));

    const { report, overlapping, counts } = await drift(id);
    expect(report).toMatchObject({ isDrifted: false, contentFree: true });
    expect(report.warnings[0]).toContain("nothing it was staged against changed");
    expect(report.warnings[0]).toContain("In the base since: 1 element(s) changed, none of them overlapping a staged change.");
    expect(overlapping).toEqual({ elements: [], relationships: [] });
    expect(counts).toMatchObject({ elementsChanged: 1 });
    expect(await commit(id)).toBeUndefined();
  });

  it.serial("an edit to another element than the one it updates", async () => {
    const id = await plan("reword-faster", [await reword(FASTER, "Checkout in under a minute")]);
    await land(await plan("reword-cheaper", [await reword(CHEAPER, "Halve hosting costs")]));

    expect((await drift(id)).report).toMatchObject({ isDrifted: false, contentFree: true });
    expect(await commit(id)).toBeUndefined();
  });

  it.serial("the removal of an element and of a relationship it does not touch", async () => {
    const id = await plan("export-orders", [add(element(SERVICE, { serviceType: "synchronous" }))]);
    await land(await plan("drop", [link("relationship-delete", REALIZES), await remove(CHEAPER)]));

    const { report, overlapping, counts } = await drift(id);
    expect(counts).toMatchObject({ elementsRemoved: 1, relationshipsRemoved: 1 });
    expect(overlapping).toEqual({ elements: [], relationships: [] });
    expect(report).toMatchObject({ isDrifted: false, contentFree: true });
    expect(report.warnings[0]).toContain("1 element(s) removed, 1 relationship(s) removed");
    expect(await commit(id)).toBeUndefined();
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
    expect(await commit(id)).toBeUndefined();
  });
});

describe("a base change that overlaps a staged change is drift", () => {
  it.serial("an edit to the element it updates (changed-in-base)", async () => {
    const id = await plan("reword-faster", [await reword(FASTER, "Checkout in under a minute")]);
    await land(await plan("other-reword", [await reword(FASTER, "Checkout in thirty seconds")]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(report.contentFree).toBeUndefined();
    expect(overlapping.elements).toEqual([{ id: FASTER, reason: "changed-in-base" }]);
    expect(await commit(id)).toContain("drifted");
  });

  it.serial("an edit to an element it links to (endpoint-changed-in-base)", async () => {
    const id = await plan("export-orders", [
      add(element(SERVICE, { serviceType: "synchronous" })),
      link("relationship-add", { source: SERVICE, predicate: "realizes", target: FASTER }),
    ]);
    await land(await plan("other-reword", [await reword(FASTER, "Checkout in thirty seconds")]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.relationships).toEqual([
      { source: SERVICE, predicate: "realizes", target: FASTER, reason: "endpoint-changed-in-base", endpoints: [FASTER] },
    ]);
    expect(await commit(id)).toContain("drifted");
  });

  it.serial("the removal of the element it updates (removed-in-base)", async () => {
    const id = await plan("reword-cheaper", [await reword(CHEAPER, "Halve hosting costs")]);
    await land(await plan("drop", [await remove(CHEAPER)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toEqual([{ id: CHEAPER, reason: "removed-in-base" }]);
    expect(await commit(id)).toContain("drifted");
  });

  it.serial("an edit to the element it deletes (changed-in-base)", async () => {
    const id = await plan("drop-spare", [await remove(SPARE)]);
    await land(await plan("reword", [await reword(SPARE, "Halve the return rate")]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toEqual([{ id: SPARE, reason: "changed-in-base" }]);
    expect(await commit(id)).toContain("drifted");
  });

  it.serial("the base no longer has the element it deletes (already-removed)", async () => {
    const id = await plan("drop-spare", [await remove(SPARE)]);
    await land(await plan("drop-first", [await remove(SPARE)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toEqual([{ id: SPARE, reason: "already-removed" }]);
    expect(await commit(id)).toContain("drifted");
  });

  it.serial("the base no longer has the relationship it deletes (already-removed)", async () => {
    const id = await plan("unlink", [link("relationship-delete", REALIZES)]);
    await land(await plan("unlink-first", [link("relationship-delete", REALIZES)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.relationships).toEqual([{ ...REALIZES, reason: "already-removed" }]);
    expect(await commit(id)).toContain("drifted");
  });

  it.serial("the base already has what it adds (already-in-base)", async () => {
    const id = await plan("export-orders", [add(element(SERVICE, { serviceType: "synchronous" }))]);
    await land(await plan("same-service", [add(element(SERVICE, { serviceType: "synchronous" }))]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toEqual([{ id: SERVICE, reason: "already-in-base" }]);
    expect(await commit(id)).toContain("drifted");
  });
});

describe("an overlap is found whatever ops the changeset stages for it, in any order", () => {
  it.serial("a delete then an add (a recreate) of an element the base changed (changed-in-base)", async () => {
    // The last op for the element is "add", and landing it would replace the base's edit and purge
    // the relationship the base gained on it.
    const id = await plan("recreate-faster", [
      link("relationship-delete", REALIZES),
      await remove(FASTER),
      add(element(FASTER, { priority: "high" }, "Checkout in one step")),
    ]);
    await land(
      await plan("other", [
        await reword(FASTER, "Checkout in thirty seconds"),
        link("relationship-add", { source: REQUIREMENT, predicate: "influence", target: FASTER }),
      ])
    );

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toEqual([{ id: FASTER, reason: "changed-in-base" }]);
    expect(await commit(id)).toContain("drifted");
    expect(await inBase(FASTER)).toMatchObject({ description: "Checkout in thirty seconds" });
  });

  it.serial("a recreate of an element the base removed (removed-in-base): it is not put back", async () => {
    const id = await plan("recreate-spare", [await remove(SPARE), add(element(SPARE, { priority: "low" }, "No returns"))]);
    await land(await plan("drop", [await remove(SPARE)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toEqual([{ id: SPARE, reason: "removed-in-base" }]);
    expect(await commit(id)).toContain("drifted");
  });

  it.serial("an update then a delete of an element the base removed (already-removed)", async () => {
    const id = await plan("retire-spare", [await reword(SPARE, "Retired"), await remove(SPARE)]);
    await land(await plan("drop", [await remove(SPARE)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toEqual([{ id: SPARE, reason: "already-removed" }]);
    expect(await commit(id)).toContain("drifted");
  });

  it.serial("a delete then an add of a relationship the base removed (already-removed): it is not put back", async () => {
    const id = await plan("relink", [link("relationship-delete", REALIZES), link("relationship-add", REALIZES)]);
    await land(await plan("unlink", [link("relationship-delete", REALIZES)]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.relationships).toEqual([{ ...REALIZES, reason: "already-removed" }]);
    expect(await commit(id)).toContain("drifted");
  });

  it.serial("an add then a delete of an element the base gained since (already-in-base): the base's is not deleted", async () => {
    const mine = element(SERVICE, { serviceType: "synchronous" });
    const id = await plan("try-service", [add(mine), { type: "delete", elementId: SERVICE, layerName: "application", before: mine }]);
    await land(await plan("same-service", [add(element(SERVICE, { serviceType: "synchronous" }))]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toEqual([{ id: SERVICE, reason: "already-in-base" }]);
    expect(await commit(id)).toContain("drifted");
  });
});

describe("a staged delete and the relationships the base gained since", () => {
  it.serial("a delete of an element the base has since linked (linked-in-base): the new relationship is not purged", async () => {
    const id = await plan("drop-spare", [await remove(SPARE)]);
    await land(await plan("link-spare", [link("relationship-add", { source: REQUIREMENT, predicate: "realizes", target: SPARE })]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(overlapping.elements).toEqual([{ id: SPARE, reason: "linked-in-base" }]);
    expect(await commit(id)).toContain("drifted");
  });

  it.serial("a delete of an element while the base gained a relationship elsewhere is content-free", async () => {
    const id = await plan("drop-spare", [await remove(SPARE)]);
    await land(await plan("link-cheaper", [link("relationship-add", { source: REQUIREMENT, predicate: "realizes", target: CHEAPER })]));

    const { report, overlapping } = await drift(id);
    expect(overlapping).toEqual({ elements: [], relationships: [] });
    expect(report).toMatchObject({ isDrifted: false, contentFree: true });
    expect(await commit(id)).toBeUndefined();
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
    expect(await commit(id)).toContain("drifted");
  });
});

describe("without a base index", () => {
  it.serial("a changed hash still blocks, also when nothing overlaps: the two can't be told apart", async () => {
    const id = await plan("export-orders", [add(element(SERVICE, { serviceType: "synchronous" }))]);
    await rm(join(rootPath, "documentation-robotics", "changesets", id, BASE_INDEX_FILE));
    await land(await plan("reword", [await reword(CHEAPER, "Halve hosting costs")]));

    const { report, overlapping } = await drift(id);
    expect(report.isDrifted).toBe(true);
    expect(report.contentFree).toBeUndefined();
    expect(overlapping).toEqual({ elements: [], relationships: [] });
    expect(await commit(id)).toContain("drifted");
  });
});
