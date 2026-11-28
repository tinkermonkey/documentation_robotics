/**
 * Overlaps between staged changesets (#1209) and `dependsOn` (#1292), through the real tool handlers
 * over a model in a temp folder.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelDeleteHandler } from "../../../src/mcp/tools/model-delete.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import {
  changesetActivateHandler,
  changesetCreateHandler,
  changesetDeactivateHandler,
} from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetDiscardHandler, changesetUpdateHandler } from "../../../src/mcp/tools/changeset-editing.js";
import { changesetCommitHandler } from "../../../src/mcp/tools/changeset-commit.js";
import { changesetOverlapsHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";
import { computeChangesetOverlaps } from "../../../src/core/changeset-overlaps.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";

const GOAL = "motivation.goal.faster-checkout";
const BASE_FN = "application.applicationfunction.shared-fn";

let rootPath: string;

const parse = (result: any): any => JSON.parse(result.content[0].text);
const isError = (result: any): boolean => result.isError === true;

async function plan(name: string): Promise<void> {
  expect(isError(await changesetCreateHandler({ name, description: `Plan ${name}`, rootPath }))).toBe(false);
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-overlaps-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Overlaps Test Model", version: "0.1.0" });
  await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" }, rootPath });
  await modelAddHandler({ layer: "application", type: "applicationfunction", name: "shared-fn", description: "The original text", rootPath });
  clearModelCache();
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("changeset_overlaps (#1209)", () => {
  it("reports two full-element updates of one element as a conflict, and what a combined update needs", async () => {
    await plan("plan-a");
    await modelUpdateHandler({ id: BASE_FN, description: "Text from A", rootPath });
    await changesetDeactivateHandler({ rootPath });
    await plan("plan-b");
    await modelUpdateHandler({ id: BASE_FN, name: "Renamed by B", rootPath });
    await changesetDeactivateHandler({ rootPath });

    const result = parse(await changesetOverlapsHandler({ rootPath }));
    expect(result.counts.total).toBe(1);
    expect(result.counts.bySeverity.conflict).toBe(1);
    const overlap = result.overlaps[0];
    expect(overlap).toMatchObject({ of: "element", id: BASE_FN, severity: "conflict", reason: "changed-in-base" });
    expect(overlap.consequence).toContain("silently");
    // Different fields changed, but each carries the whole element: the later one puts the other's back.
    expect(overlap.combined.conflicts).toEqual([]);
    expect(overlap.combined.keeps.map((k: any) => k.field).sort()).toEqual(["description", "name"]);
    expect(overlap.combined.needs).toContain("whole element");
    expect(result.notChecked.length).toBeGreaterThan(0);
  });

  it("names fields both changed to different values as the conflict to decide", async () => {
    await plan("plan-a");
    await modelUpdateHandler({ id: BASE_FN, description: "Text from A", rootPath });
    await changesetDeactivateHandler({ rootPath });
    await plan("plan-b");
    await modelUpdateHandler({ id: BASE_FN, description: "Text from B", rootPath });
    await changesetDeactivateHandler({ rootPath });

    const { overlaps } = parse(await changesetOverlapsHandler({ rootPath }));
    expect(overlaps[0].combined.conflicts).toHaveLength(1);
    expect(overlaps[0].combined.conflicts[0]).toMatchObject({
      field: "description",
      base: "The original text",
      values: { "plan-a": "Text from A", "plan-b": "Text from B" },
    });
  });

  it("lists a link that ends on an element another changeset deletes, and puts the delete last", async () => {
    await plan("plan-link");
    await modelAddHandler({ layer: "application", type: "applicationservice", name: "svc", attributes: { serviceType: "synchronous" }, rootPath });
    await relationshipAddHandler({ source: "application.applicationservice.svc", predicate: "realizes", target: GOAL, rootPath });
    await changesetDeactivateHandler({ rootPath });
    await plan("plan-delete");
    await modelDeleteHandler({ id: GOAL, force: true, rootPath } as any);
    await changesetDeactivateHandler({ rootPath });

    const result = parse(await changesetOverlapsHandler({ rootPath }));
    const link = result.overlaps.find((o: any) => o.of === "relationship");
    expect(link).toBeDefined();
    expect(link.endpoint).toBe(GOAL);
    expect(link.severity).toBe("conflict");
    expect(["linked-in-base", "endpoint-removed-in-base"]).toContain(link.reason);
    // The delete lands last, even though it was staged second or first.
    expect(result.suggestedOrder).toEqual(["plan-link", "plan-delete"]);
  });

  it("calls a link to an element another changeset only edits information, not a conflict", async () => {
    await plan("plan-link");
    await modelAddHandler({ layer: "application", type: "applicationservice", name: "svc", attributes: { serviceType: "synchronous" }, rootPath });
    await relationshipAddHandler({ source: "application.applicationservice.svc", predicate: "realizes", target: GOAL, rootPath });
    await changesetDeactivateHandler({ rootPath });
    await plan("plan-edit");
    await modelUpdateHandler({ id: GOAL, description: "Edited elsewhere", rootPath });
    await changesetDeactivateHandler({ rootPath });

    const result = parse(await changesetOverlapsHandler({ rootPath }));
    expect(result.counts.bySeverity.conflict).toBe(0);
    expect(result.overlaps[0]).toMatchObject({ severity: "info", reason: "endpoint-changed-elsewhere", endpoint: GOAL });
  });

  it("says nothing overlaps when nothing does, and pages with true totals", async () => {
    await plan("plan-a");
    await modelAddHandler({ layer: "application", type: "applicationfunction", name: "only-a", rootPath });
    await changesetDeactivateHandler({ rootPath });
    await plan("plan-b");
    await modelAddHandler({ layer: "application", type: "applicationfunction", name: "only-b", rootPath });
    await changesetDeactivateHandler({ rootPath });
    const none = parse(await changesetOverlapsHandler({ rootPath }));
    expect(none.counts.total).toBe(0);
    expect(none.overlaps).toEqual([]);

    // Two elements both update, paged one at a time.
    await modelAddHandler({ layer: "application", type: "applicationfunction", name: "second-shared", rootPath });
    await changesetActivateHandler({ changeset: "plan-a", rootPath });
    await modelUpdateHandler({ id: BASE_FN, description: "a", rootPath });
    await modelUpdateHandler({ id: "application.applicationfunction.second-shared", description: "a", rootPath });
    await changesetActivateHandler({ changeset: "plan-b", rootPath });
    await modelUpdateHandler({ id: BASE_FN, description: "b", rootPath });
    await modelUpdateHandler({ id: "application.applicationfunction.second-shared", description: "b", rootPath });
    await changesetDeactivateHandler({ rootPath });
    const page = parse(await changesetOverlapsHandler({ limit: 1, rootPath }));
    expect(page.page).toMatchObject({ total: 2, returned: 1, offset: 0, nextOffset: 1 });
    expect(page.counts.total).toBe(2);
    expect(page.more).toContain("offset: 1");
  });

  it("agrees when two changesets stage the same thing, and never merges anything", async () => {
    await plan("plan-a");
    await modelUpdateHandler({ id: BASE_FN, description: "Same text", rootPath });
    await changesetDeactivateHandler({ rootPath });
    await plan("plan-b");
    await modelUpdateHandler({ id: BASE_FN, description: "Same text", rootPath });
    await changesetDeactivateHandler({ rootPath });
    const result = parse(await changesetOverlapsHandler({ rootPath }));
    expect(result.overlaps[0].severity).toBe("agrees");
    const manager = new StagingAreaManager(rootPath);
    expect((await manager.load("plan-a"))!.changes).toHaveLength(1);
    expect((await manager.load("plan-b"))!.changes).toHaveLength(1);
  });

  it("reads each overlap in the order a landing uses, and names a changeset once whatever it is called by", async () => {
    await plan("plan-a");
    await modelUpdateHandler({ id: BASE_FN, description: "A", rootPath });
    await changesetDeactivateHandler({ rootPath });
    await plan("plan-b");
    await modelDeleteHandler({ id: BASE_FN, force: true, rootPath } as any);
    await changesetDeactivateHandler({ rootPath });
    const manager = new StagingAreaManager(rootPath);
    const a = (await manager.load("plan-a"))!;
    const b = (await manager.load("plan-b"))!;
    // Landing B first: A's update then has nothing to apply to.
    const reversed = computeChangesetOverlaps([b, a], { landOrder: ["plan-b", "plan-a"] });
    expect(reversed.overlaps[0].changesets).toEqual(["plan-b", "plan-a"]);
    expect(reversed.overlaps[0].reason).toBe("removed-in-base");
    const suggested = computeChangesetOverlaps([b, a]);
    expect(suggested.suggestedOrder).toEqual(["plan-a", "plan-b"]);
    const byIdAndName = parse(await changesetOverlapsHandler({ changesets: ["plan-a", a.id, "plan-b"], rootPath }));
    expect(byIdAndName.changesets).toHaveLength(2);
  });

  it("does not call a dependent's delete of what its dependency adds a conflict", async () => {
    await plan("step-a");
    await modelAddHandler({ layer: "application", type: "applicationfunction", name: "extra", rootPath });
    await changesetDeactivateHandler({ rootPath });
    await changesetCreateHandler({ name: "step-b", description: "B", dependsOn: ["step-a"], rootPath });
    await modelDeleteHandler({ id: "application.applicationfunction.extra", force: true, rootPath } as any);
    await changesetDeactivateHandler({ rootPath });
    const result = parse(await changesetOverlapsHandler({ rootPath }));
    expect(result.counts.bySeverity.conflict).toBe(0);
  });

  it("is a pure comparison of staged changes", async () => {
    await plan("plan-a");
    await modelUpdateHandler({ id: BASE_FN, description: "A", rootPath });
    await changesetDeactivateHandler({ rootPath });
    const manager = new StagingAreaManager(rootPath);
    const a = (await manager.load("plan-a"))!;
    expect(computeChangesetOverlaps([a]).counts.total).toBe(0);
  });
});

describe("dependsOn (#1292)", () => {
  async function stageButtonInA(): Promise<void> {
    await plan("step-a");
    await modelAddHandler({ layer: "application", type: "applicationfunction", name: "button", rootPath });
    await changesetDeactivateHandler({ rootPath });
  }

  it("refuses to link to an element staged in another changeset unless it is a dependency", async () => {
    await stageButtonInA();
    await plan("step-b");
    await modelAddHandler({ layer: "application", type: "applicationservice", name: "svc", attributes: { serviceType: "synchronous" }, rootPath });
    const refused = await relationshipAddHandler({
      source: "application.applicationservice.svc",
      predicate: "serves",
      target: "application.applicationfunction.button",
      rootPath,
    });
    expect(isError(refused) || parse(refused).status === "invalid" || /not found/.test(JSON.stringify(parse(refused)))).toBe(true);
  });

  it("resolves elements staged in the dependency for writes and for reads", async () => {
    await stageButtonInA();
    const created = parse(await changesetCreateHandler({ name: "step-b", description: "B", dependsOn: ["step-a"], rootPath }));
    expect(created.dependsOn).toHaveLength(1);
    await modelAddHandler({ layer: "application", type: "applicationservice", name: "svc", attributes: { serviceType: "synchronous" }, rootPath });
    const linked = await relationshipAddHandler({
      source: "application.applicationservice.svc",
      predicate: "serves",
      target: "application.applicationfunction.button",
      rootPath,
    });
    expect(isError(linked)).toBe(false);
    expect(parse(linked).status).toBe("staged");

    const shown = await modelShowHandler({ id: "application.applicationfunction.button", rootPath });
    expect(isError(shown)).toBe(false);
    expect(JSON.stringify(parse(shown))).toContain("button");
  });

  it("refuses a dependency that is itself, missing, or would make a cycle", async () => {
    await stageButtonInA();
    await plan("step-b");
    expect(isError(await changesetUpdateHandler({ dependsOn: ["step-b"], rootPath }))).toBe(true);
    expect(isError(await changesetUpdateHandler({ dependsOn: ["no-such"], rootPath }))).toBe(true);
    await changesetUpdateHandler({ dependsOn: ["step-a"], rootPath });
    const cycle = await changesetUpdateHandler({ changeset: "step-a", dependsOn: ["step-b"], rootPath });
    expect(isError(cycle)).toBe(true);
    expect(JSON.stringify(cycle)).toContain("wait for each other");
  });

  it("refuses to land a changeset before its dependency, and lands both in order in one call", async () => {
    await stageButtonInA();
    await changesetCreateHandler({ name: "step-b", description: "B", dependsOn: ["step-a"], rootPath });
    await modelAddHandler({ layer: "application", type: "applicationservice", name: "svc", attributes: { serviceType: "synchronous" }, rootPath });
    await relationshipAddHandler({ source: "application.applicationservice.svc", predicate: "serves", target: "application.applicationfunction.button", rootPath });
    await changesetDeactivateHandler({ rootPath });

    const alone = await changesetCommitHandler({ changeset: "step-b", rootPath });
    expect(isError(alone)).toBe(true);
    expect(JSON.stringify(alone)).toContain("have not landed");
    expect(JSON.stringify(alone)).toContain("step-a");

    const wrongOrder = await changesetCommitHandler({ changesets: ["step-b", "step-a"], rootPath });
    expect(isError(wrongOrder)).toBe(true);
    const manager = new StagingAreaManager(rootPath);
    expect((await manager.load("step-a"))!.status).toBe("staged");
    expect((await manager.load("step-b"))!.status).toBe("staged");

    const both = parse(await changesetCommitHandler({ changesets: ["step-a", "step-b"], rootPath }));
    expect(both.status).toBe("committed");
    expect(both.landed.map((l: any) => l.name)).toEqual(["step-a", "step-b"]);
    expect((await manager.load("step-b"))!.status).toBe("committed");
  });

  it("lands the dependent alone once its dependency has landed", async () => {
    await stageButtonInA();
    await changesetCreateHandler({ name: "step-b", description: "B", dependsOn: ["step-a"], rootPath });
    await modelAddHandler({ layer: "application", type: "applicationservice", name: "svc", attributes: { serviceType: "synchronous" }, rootPath });
    await relationshipAddHandler({ source: "application.applicationservice.svc", predicate: "serves", target: "application.applicationfunction.button", rootPath });
    await changesetDeactivateHandler({ rootPath });
    expect(parse(await changesetCommitHandler({ changeset: "step-a", rootPath })).status).toBe("committed");
    clearModelCache();
    const landed = parse(await changesetCommitHandler({ changeset: "step-b", rootPath }));
    expect(landed.status).toBe("committed");
  });

  it("warns when a dependency is discarded, and then refuses its dependent", async () => {
    await stageButtonInA();
    await plan("step-b");
    await changesetUpdateHandler({ dependsOn: ["step-a"], rootPath });
    await changesetDeactivateHandler({ rootPath });

    const unconfirmed = await changesetDiscardHandler({ changeset: "step-a", confirm: false, rootPath });
    expect(JSON.stringify(unconfirmed)).toContain("step-b");
    const discarded = parse(await changesetDiscardHandler({ changeset: "step-a", confirm: true, rootPath }));
    expect(discarded.status).toBe("discarded");
    expect(discarded.warning).toContain("step-b");
    expect(discarded.dependents).toEqual(["step-b"]);

    const landing = await changesetCommitHandler({ changeset: "step-b", rootPath });
    // step-b stages nothing, so it has nothing to land; the dependency check still names the gap or says so.
    expect(JSON.stringify(landing)).toMatch(/step-a|nothing-to-commit|no longer exists/);
  });

  it("refuses a dependency on a record that never lands, and does not rename when dependsOn is refused", async () => {
    await plan("step-b");
    const manager = new StagingAreaManager(rootPath, await Model.load(rootPath, { lazyLoad: false }));
    const record = await manager.create("rec", "a record", undefined, { purpose: "verification" } as any);
    const refused = await changesetUpdateHandler({ changeset: "step-b", name: "renamed-b", dependsOn: [record.id], rootPath });
    expect(isError(refused)).toBe(true);
    expect((await manager.load("step-b"))!.name).toBe("step-b");
  });

  it("treats a dependency's staged element as landed in the overlap comparison", async () => {
    await stageButtonInA();
    await plan("step-b");
    await changesetUpdateHandler({ dependsOn: ["step-a"], rootPath });
    await modelUpdateHandler({ id: "application.applicationfunction.button", description: "B edits what A adds", rootPath });
    await changesetDeactivateHandler({ rootPath });
    const result = parse(await changesetOverlapsHandler({ rootPath }));
    // B builds on A: the shared element is ordered, not a conflict, and A comes first.
    expect(result.counts.bySeverity.conflict).toBe(0);
    expect(result.suggestedOrder).toEqual(["step-a", "step-b"]);
  });

  it("includes the overlap comparison in a call that lands several changesets", async () => {
    await plan("plan-a");
    await modelUpdateHandler({ id: BASE_FN, description: "A", rootPath });
    await changesetDeactivateHandler({ rootPath });
    await plan("plan-b");
    await modelUpdateHandler({ id: BASE_FN, description: "B", rootPath });
    await changesetDeactivateHandler({ rootPath });
    const result = parse(await changesetCommitHandler({ changesets: ["plan-a", "plan-b"], rootPath }));
    expect(result.overlaps.counts.bySeverity.conflict).toBe(1);
    expect(result.overlaps.conflicts[0].id).toBe(BASE_FN);
    expect(result.summary.join("\n")).toContain("changeset_overlaps lists every one");
  });
});
