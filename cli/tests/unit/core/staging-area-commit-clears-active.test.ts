/**
 * Landing a changeset through StagingAreaManager.commit clears it as the active changeset, whoever
 * calls it. Left active, reads would keep projecting the landed changeset over the base and later
 * writes would stage into a changeset that is already committed.
 */

import { describe, it, expect, spyOn } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetActivateHandler, changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";

async function newProject(): Promise<string> {
  clearModelCache();
  const rootPath = join(tmpdir(), `dr-commit-clears-active-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Commit Clears Active", version: "0.1.0" });
  return rootPath;
}

async function addGoal(rootPath: string, name: string): Promise<void> {
  await modelAddHandler({ layer: "motivation", type: "goal", name, attributes: { priority: "high" }, rootPath });
}

async function baseGoals(rootPath: string): Promise<string[]> {
  const model = await Model.load(rootPath, { lazyLoad: false });
  const layer = await model.getBaseLayer("motivation");
  return (layer?.listElements() ?? []).map((e) => e.path ?? e.id).sort();
}

// Each test makes its own project: test:unit runs core tests with --concurrent.
describe("StagingAreaManager.commit and the active changeset", () => {
  it("clears the landed changeset when it is the active one", async () => {
    const rootPath = await newProject();
    try {
      await changesetCreateHandler({ name: "plan", rootPath });
      await addGoal(rootPath, "faster-checkout");
      clearModelCache();

      const model = await Model.load(rootPath, { lazyLoad: false });
      const manager = new StagingAreaManager(model.rootPath, model);
      const plan = await manager.load("plan");
      expect(model.getActiveChangesetId()).toBe(plan!.id);

      const result = await manager.commit(model, plan!.id, { validate: true });
      expect(result.committed).toBe(1);
      expect(result.deactivated).toBe(true);
      expect(result.deactivationError).toBeUndefined();

      // Neither the marker on disk nor the model in hand still names it.
      expect(await manager.getActiveId()).toBeNull();
      expect(model.getActiveChangesetId()).toBeNull();
      const reloaded = await Model.load(rootPath, { lazyLoad: false });
      expect(reloaded.getActiveChangesetId()).toBeNull();

      // A later write lands in the base instead of staging into the committed changeset.
      clearModelCache();
      await addGoal(rootPath, "lower-cost");
      expect((await manager.load("plan"))!.changes.length).toBe(1);
      expect(await baseGoals(rootPath)).toEqual([
        "motivation.goal.faster-checkout",
        "motivation.goal.lower-cost",
      ]);
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("leaves a different active changeset active", async () => {
    const rootPath = await newProject();
    try {
      await changesetCreateHandler({ name: "landing", rootPath });
      await addGoal(rootPath, "faster-checkout");
      await changesetCreateHandler({ name: "other", rootPath });
      await addGoal(rootPath, "lower-cost");
      await changesetActivateHandler({ changesetId: "other", rootPath });
      clearModelCache();

      const model = await Model.load(rootPath, { lazyLoad: false });
      const manager = new StagingAreaManager(model.rootPath, model);
      const other = await manager.load("other");
      const landing = await manager.load("landing");
      expect(model.getActiveChangesetId()).toBe(other!.id);

      const result = await manager.commit(model, landing!.id, { validate: true });
      expect(result.deactivated).toBe(false);
      expect(result.deactivationError).toBeUndefined();

      expect(await manager.getActiveId()).toBe(other!.id);
      expect(model.getActiveChangesetId()).toBe(other!.id);
      expect(await baseGoals(rootPath)).toEqual(["motivation.goal.faster-checkout"]);
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("reports a landed changeset it could not deactivate instead of failing the commit", async () => {
    const rootPath = await newProject();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await changesetCreateHandler({ name: "plan", rootPath });
      await addGoal(rootPath, "faster-checkout");
      clearModelCache();

      const model = await Model.load(rootPath, { lazyLoad: false });
      const manager = new StagingAreaManager(model.rootPath, model);
      const plan = await manager.load("plan");
      manager.clearActive = async () => {
        throw new Error("EACCES: permission denied, open '.active'");
      };

      const result = await manager.commit(model, plan!.id, { validate: true });

      // The changes landed and the changeset is committed; the marker still names it, and the
      // result and a console warning say so.
      expect(result.committed).toBe(1);
      expect(result.deactivated).toBe(false);
      expect(result.deactivationError).toContain("EACCES");
      expect((await manager.load("plan"))!.status).toBe("committed");
      expect(await manager.getActiveId()).toBe(plan!.id);
      expect(await baseGoals(rootPath)).toEqual(["motivation.goal.faster-checkout"]);
      expect(warn.mock.calls.some((call) => String(call[0]).includes("still the active changeset"))).toBe(true);
    } finally {
      warn.mockRestore();
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
