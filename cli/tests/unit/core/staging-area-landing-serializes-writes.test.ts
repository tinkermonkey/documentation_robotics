/**
 * A landing and the writes staging into its changeset are serialized (#1437): the landing holds the
 * changeset's lock from the read it lands to the save that marks it committed, so every write that
 * reports success is on disk afterwards (landed with the changeset), and every other write is
 * refused, naming the changeset. Afterwards writes aimed at the landed changeset are refused
 * instead of falling through to the base model, until a changeset is activated or the checkout
 * deactivates.
 */

import { describe, it, expect } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { ChangesetClosedToWritesError, landingLockOwner } from "../../../src/core/changeset-write-refusal.js";
import { readLandedNote } from "../../../src/core/active-changeset-marker.js";
import { FileLock } from "../../../src/utils/file-lock.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import {
  changesetActivateHandler,
  changesetCreateHandler,
  changesetDeactivateHandler,
} from "../../../src/mcp/tools/changeset-lifecycle.js";

async function newProject(): Promise<string> {
  clearModelCache();
  const rootPath = join(tmpdir(), `dr-landing-writes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Landing Writes", version: "0.1.0" });
  return rootPath;
}

function goal(name: string) {
  const id = `motivation.goal.${name}`;
  return {
    type: "add" as const,
    elementId: id,
    layerName: "motivation",
    after: {
      id: crypto.randomUUID(),
      path: id,
      spec_node_id: "motivation.goal",
      layer_id: "motivation",
      type: "goal",
      name,
      attributes: { priority: "high" },
      layer: "motivation",
    },
  };
}

async function baseGoals(rootPath: string): Promise<string[]> {
  const model = await Model.load(rootPath, { lazyLoad: false });
  const layer = await model.getBaseLayer("motivation");
  return (layer?.listElements() ?? []).map((e) => e.path ?? e.id).sort();
}

const text = (result: { content: Array<{ type: string; text?: string }> }): string => result.content[0]?.text ?? "";

describe("landing a changeset while writes stage into it (#1437)", () => {
  it("never loses a write: each one lands with the changeset or is refused naming it", async () => {
    const rootPath = await newProject();
    try {
      await changesetCreateHandler({ name: "wire-tests", rootPath });
      clearModelCache();
      const model = await Model.load(rootPath, { lazyLoad: false });
      const manager = new StagingAreaManager(model.rootPath, model);
      const plan = (await manager.load("wire-tests"))!;
      await manager.stage(plan.id!, goal("first"));

      // Writes from another "process" (their own manager), racing the landing.
      const writer = new StagingAreaManager(rootPath);
      const names = Array.from({ length: 12 }, (_, i) => `racing-${i}`);
      const landing = manager.commit(model, plan.id!, { validate: false });
      const writes = await Promise.allSettled(
        names.map(async (name, i) => {
          await new Promise((resolve) => setTimeout(resolve, i * 3));
          await writer.stage(plan.id!, goal(name));
          return name;
        })
      );
      const result = await landing;

      const succeeded = writes.flatMap((w) => (w.status === "fulfilled" ? [w.value] : []));
      const refused = writes.flatMap((w) => (w.status === "rejected" ? [w.reason] : []));
      for (const reason of refused) {
        expect(reason).toBeInstanceOf(ChangesetClosedToWritesError);
        expect(String(reason.message)).toContain("'wire-tests'");
      }
      // Every write that reported success is in the base model; nothing else is.
      const landed = await baseGoals(rootPath);
      expect(landed).toEqual(["motivation.goal.first", ...succeeded.map((n) => `motivation.goal.${n}`)].sort());
      expect(result.committed).toBe(1 + succeeded.length);
      // The committed changeset holds exactly what landed: no write slipped in after its snapshot.
      expect((await manager.load("wire-tests"))!.changes.length).toBe(1 + succeeded.length);
      expect(succeeded.length + refused.length).toBe(names.length);
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("refuses at once a write that finds the landing holding the changeset's lock", async () => {
    const rootPath = await newProject();
    try {
      await changesetCreateHandler({ name: "plan", rootPath });
      const storage = new StagedChangesetStorage(rootPath);
      const manager = new StagingAreaManager(rootPath);
      const plan = (await manager.load("plan"))!;
      const lock = new FileLock(storage.getChangesetPath(plan.id!));
      await lock.acquire({ owner: landingLockOwner(plan) });
      try {
        const started = Date.now();
        const error = await storage.addChange(plan.id!, goal("late")).catch((e) => e);
        expect(error).toBeInstanceOf(ChangesetClosedToWritesError);
        expect(error.state).toBe("landing");
        expect(error.message).toContain("Changeset 'plan' is being landed");
        // Refused, not waited out: the default lock wait is five seconds.
        expect(Date.now() - started).toBeLessThan(2000);
      } finally {
        await lock.release();
      }
      expect((await manager.load("plan"))!.changes.length).toBe(0);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("refuses a write into a changeset that was landed while it waited for the lock", async () => {
    const rootPath = await newProject();
    try {
      await changesetCreateHandler({ name: "plan", rootPath });
      const storage = new StagedChangesetStorage(rootPath);
      const plan = (await new StagingAreaManager(rootPath).load("plan"))!;
      plan.status = "committed";
      await storage.save(plan);
      for (const write of [
        () => storage.addChange(plan.id!, goal("late")),
        () => storage.addChanges(plan.id!, [goal("late")]),
        () => storage.removeChanges(plan.id!, ["motivation.goal.late"]),
      ]) {
        const error = await write().catch((e) => e);
        expect(error).toBeInstanceOf(ChangesetClosedToWritesError);
        expect(error.message).toContain("Changeset 'plan' was landed");
      }
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("refuses writes after landing the active changeset, until a changeset is activated or the checkout deactivates", async () => {
    const rootPath = await newProject();
    try {
      await changesetCreateHandler({ name: "plan", rootPath });
      await modelAddHandler({ layer: "motivation", type: "goal", name: "kept", attributes: { priority: "high" }, rootPath });
      clearModelCache();
      const model = await Model.load(rootPath, { lazyLoad: false });
      const manager = new StagingAreaManager(model.rootPath, model);
      const plan = (await manager.load("plan"))!;
      await manager.commit(model, plan.id!, { validate: true });
      expect((await readLandedNote(rootPath))?.name).toBe("plan");
      clearModelCache();

      // Element and relationship writes, single and batch, all refuse naming the changeset.
      const refusals = [
        await modelAddHandler({ layer: "motivation", type: "goal", name: "after", attributes: { priority: "low" }, rootPath }),
        await modelAddHandler({ elements: [{ layer: "motivation", type: "goal", name: "after", attributes: { priority: "low" } }], rootPath }),
        await relationshipAddHandler({ source: "motivation.goal.kept", predicate: "aggregates", target: "motivation.goal.kept", rootPath }),
      ];
      for (const refusal of refusals) {
        expect(refusal.isError).toBe(true);
        expect(text(refusal)).toContain("Changeset 'plan' was landed");
        expect(text(refusal)).toContain("changeset_deactivate");
      }
      expect(await baseGoals(rootPath)).toEqual(["motivation.goal.kept"]);

      // A new changeset takes writes again, and clears the note.
      await changesetCreateHandler({ name: "next", rootPath });
      expect(await readLandedNote(rootPath)).toBeNull();
      const staged = JSON.parse(
        text(await modelAddHandler({ layer: "motivation", type: "goal", name: "after", attributes: { priority: "low" }, rootPath }))
      );
      expect(staged.status).toBe("staged");
      expect(staged.changeset).toBe("next");
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("leaves no note when the landed changeset was not the active one", async () => {
    const rootPath = await newProject();
    try {
      await changesetCreateHandler({ name: "landing", rootPath });
      await modelAddHandler({ layer: "motivation", type: "goal", name: "kept", attributes: { priority: "high" }, rootPath });
      await changesetCreateHandler({ name: "other", rootPath });
      await changesetActivateHandler({ changesetId: "other", rootPath });
      await changesetDeactivateHandler({ rootPath });
      clearModelCache();
      const model = await Model.load(rootPath, { lazyLoad: false });
      const manager = new StagingAreaManager(model.rootPath, model);
      await manager.commit(model, (await manager.load("landing"))!.id!, { validate: true });
      expect(await readLandedNote(rootPath)).toBeNull();
      expect(await manager.getWriteTarget()).toBeNull();
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
