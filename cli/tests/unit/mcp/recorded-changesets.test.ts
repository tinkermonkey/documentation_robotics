/**
 * A plan's landing moves the verification records that name it to `recorded` (#1171): kept, not
 * staged work. changeset_list, project_status and changeset_discard read it that way, and a record
 * made before the status existed (still staged) reads as it did.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetListHandler } from "../../../src/mcp/tools/changeset-list.js";
import { changesetDiscardHandler } from "../../../src/mcp/tools/changeset-editing.js";
import { projectStatusHandler } from "../../../src/mcp/tools/project-status.js";

const MARKER = "As-built extraction of the code at abc1234, files changed since main. Staged by codebase_extract.";
let rootPath: string;

function ok(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-recorded-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Recorded", version: "0.1.0" });
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

/** A landed plan with a verification record kept (recorded) and one an older landing left staged. */
async function landedPlan() {
  const manager = new StagingAreaManager(rootPath, await Model.load(rootPath, { lazyLoad: false }));
  const plan = await manager.create("the-plan", "a plan");
  await manager.setActive(plan.id!);
  clearModelCache();
  ok(await modelAddHandler({ layer: "motivation", type: "goal", name: "Ship it", attributes: { priority: "high" }, rootPath }));
  const record = await manager.create("the-plan-as-built", MARKER, { kind: "extract" }, { purpose: "verification", verifies: plan.id, scope: { since: "main" } });
  const older = await manager.create("older-as-built", MARKER, { kind: "extract" }, { purpose: "verification", verifies: "cs-landed-before", scope: { since: "main" } });
  clearModelCache();
  const model = await Model.load(rootPath, { lazyLoad: false });
  await new StagingAreaManager(rootPath, model).commit(model, plan.id!, { validate: false, force: true });
  clearModelCache();
  return { plan, record, older };
}

describe("recorded changesets", () => {
  it("changeset_list leaves a recorded record out of the staged list, counts it, and lists it by status", async () => {
    const { record, older } = await landedPlan();
    const staged = ok(await changesetListHandler({ rootPath }));
    expect(Object.keys(staged.changesets)).toEqual([older.id!]);
    expect(staged.counts).toMatchObject({ staged: 1, committed: 1, recorded: 1 });
    expect(staged.more).toContain("1 recorded");

    const recorded = ok(await changesetListHandler({ status: "recorded", rootPath }));
    expect(recorded.changesets[record.id!]).toMatchObject({ status: "recorded", purpose: "verification", actions: ["discard"] });
    expect(Object.keys(ok(await changesetListHandler({ status: "all", rootPath })).changesets)).toHaveLength(3);
  });

  it("project_status doesn't count a recorded record as staged work, and counts it apart", async () => {
    const { record, older } = await landedPlan();
    const status = ok(await projectStatusHandler({ rootPath }));
    expect(status.changesets).toMatchObject({ stagedTotal: 1, committed: 1, recorded: 1 });
    expect(status.changesets.staged.map((c: any) => c.id)).toEqual([older.id]);
    expect(JSON.stringify(status.nextStep)).not.toContain(record.id!);

    // With the older record discarded, nothing is staged and the next step doesn't ask about one.
    ok(await changesetDiscardHandler({ changesetId: older.id!, confirm: true, rootPath }));
    clearModelCache();
    const clean = ok(await projectStatusHandler({ rootPath }));
    expect(clean.changesets).toMatchObject({ stagedTotal: 0, recorded: 1 });
    expect(clean.nextStep.summary).not.toContain("verification record");
  });

  it("changeset_discard removes a recorded record: discarding stays an explicit move", async () => {
    const { record } = await landedPlan();
    ok(await changesetDiscardHandler({ changesetId: record.id!, confirm: true, rootPath }));
    clearModelCache();
    expect(ok(await changesetListHandler({ status: "all", rootPath })).counts).toMatchObject({ recorded: 0 });
  });
});
