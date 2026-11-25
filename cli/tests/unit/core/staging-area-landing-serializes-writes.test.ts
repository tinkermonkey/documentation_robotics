/**
 * A landing and the writes staging into its changeset are serialized (#1437): the landing holds the
 * changeset's lock from the read it lands to the save that marks it committed, so every write that
 * reports success is on disk afterwards (landed with the changeset), and every other write is
 * refused, naming the changeset. A landing of the active changeset leaves its landed note before
 * the status save, so no write falls through to the base model at any point of the landing or
 * after it, until a changeset is activated or the checkout deactivates.
 */

import { describe, it, expect, spyOn } from "bun:test";
import { mkdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as markerModule from "../../../src/core/active-changeset-marker.js";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { ChangesetClosedToWritesError, landingLockOwner } from "../../../src/core/changeset-write-refusal.js";
import { readActiveMarker, readLandedNote } from "../../../src/core/active-changeset-marker.js";
import { ModelReportOrchestrator } from "../../../src/reports/model-report-orchestrator.js";
import { FileLock } from "../../../src/utils/file-lock.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import {
  changesetActivateHandler,
  changesetCreateHandler,
  changesetDeactivateHandler,
} from "../../../src/mcp/tools/changeset-lifecycle.js";
import { writeGoal } from "../../helpers/landing-writer.js";
import { lastChangesetWrite } from "../../../src/core/changeset-write-activity.js";

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

/** A project with an active plan that stages one goal, and its manager over a fresh model. */
async function activePlan(rootPath: string, name = "plan") {
  await changesetCreateHandler({ name, rootPath });
  await modelAddHandler({ layer: "motivation", type: "goal", name: "kept", attributes: { priority: "high" }, rootPath });
  clearModelCache();
  const model = await Model.load(rootPath, { lazyLoad: false });
  const manager = new StagingAreaManager(model.rootPath, model);
  return { model, manager, plan: (await manager.load(name))! };
}

const text = (result: { content: Array<{ type: string; text?: string }> }): string => result.content[0]?.text ?? "";

// it.serial: some tests spy on shared prototypes and module exports (report regeneration, the
// landed note), which would reach the other tests' landings if they ran at once under --concurrent.
describe("landing a changeset while writes stage into it (#1437)", () => {
  it.serial("never loses a write: some land with the changeset, the rest are refused naming it", async () => {
    const rootPath = await newProject();
    try {
      const { model, manager, plan } = await activePlan(rootPath, "wire-tests");

      // Writers going through getWriteTarget and MutationHandler, as dr add and model_add do. Not
      // timed: the landing starts once a write has succeeded, and each writer goes on until it has
      // written twice after the landing ended, so both outcomes happen whatever the machine's load.
      let landingDone = false;
      let firstWrite!: () => void;
      const someWritten = new Promise<void>((resolve) => (firstWrite = resolve));
      const outcomes: PromiseSettledResult<string>[] = [];
      const writer = async (w: number) => {
        let after = 0;
        for (let i = 0; after < 2; i++) {
          if (landingDone) after++;
          const name = `racing-${w}-${i}`;
          try {
            await writeGoal(rootPath, name);
            outcomes.push({ status: "fulfilled", value: name });
            firstWrite();
          } catch (error) {
            outcomes.push({ status: "rejected", reason: error });
          }
        }
      };
      const writers = Promise.all([0, 1, 2].map(writer));
      await someWritten;
      const result = await manager.commit(model, plan.id!, { validate: false });
      landingDone = true;
      await writers;
      const settled = outcomes;

      const succeeded = settled.flatMap((w) => (w.status === "fulfilled" ? [w.value] : []));
      const refused = settled.flatMap((w) => (w.status === "rejected" ? [w.reason] : []));
      // Both happened: the race was real.
      expect(succeeded.length).toBeGreaterThan(0);
      expect(refused.length).toBeGreaterThan(0);
      for (const reason of refused) {
        expect(reason).toBeInstanceOf(ChangesetClosedToWritesError);
        expect(String(reason.message)).toContain("'wire-tests'");
      }
      // Every write that reported success landed with the changeset; nothing else is in the base.
      const landed = (await manager.load("wire-tests"))!.changes.map((c) => c.elementId);
      for (const name of succeeded) expect(landed).toContain(`motivation.goal.${name}`);
      expect(await baseGoals(rootPath)).toEqual(
        ["motivation.goal.kept", ...succeeded.map((n) => `motivation.goal.${n}`)].sort()
      );
      expect(result.committed).toBe(1 + succeeded.length);
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it.serial("refuses a write at the end of a landing, after the status is saved (review of PR 1455, finding 1)", async () => {
    const rootPath = await newProject();
    try {
      const { model, manager, plan } = await activePlan(rootPath);
      let during: unknown;
      // Report regeneration runs after the status save and before the landing returns: the gap
      // where a write once found the marker naming a committed changeset, no note, and the base.
      const regenerate = spyOn(ModelReportOrchestrator.prototype, "regenerate").mockImplementation(async function () {
        during = await writeGoal(rootPath, "slipped").catch((error) => error);
      });
      try {
        await manager.commit(model, plan.id!, { validate: false });
      } finally {
        regenerate.mockRestore();
      }
      expect(during).toBeInstanceOf(ChangesetClosedToWritesError);
      expect((during as Error).message).toContain("Changeset 'plan' was landed");
      expect(await baseGoals(rootPath)).toEqual(["motivation.goal.kept"]);
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it.serial("never lets a writer in another process fall through to the base model", async () => {
    const rootPath = await newProject();
    try {
      const { model, manager, plan } = await activePlan(rootPath);
      const child = Bun.spawn(["bun", join(import.meta.dir, "../../helpers/landing-writer.ts"), rootPath, "40", "15", "child"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await manager.commit(model, plan.id!, { validate: false });
      await child.exited;
      const lines = (await new Response(child.stdout).text())
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as { name: string; ok: boolean; error?: string });
      expect(lines.length).toBe(40);

      const landed = (await manager.load("plan"))!.changes.map((c) => c.elementId);
      const base = await baseGoals(rootPath);
      for (const write of lines) {
        const id = `motivation.goal.${write.name}`;
        if (write.ok) {
          // Written: into the changeset, so it landed with it. Never straight into the base.
          expect(landed).toContain(id);
          expect(base).toContain(id);
        } else {
          expect(write.error).toMatch(/Changeset 'plan' (was landed|is being landed)/);
          expect(base).not.toContain(id);
        }
      }
      // The writer outlived the landing, so some of its writes were refused.
      expect(lines.some((write) => !write.ok)).toBe(true);
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  }, 60_000);

  it.serial("refuses at once a write that finds the landing holding the changeset's lock", async () => {
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

  it.serial("lets a write through a crashed landing's lock once it is stale", async () => {
    const rootPath = await newProject();
    try {
      await changesetCreateHandler({ name: "plan", rootPath });
      const storage = new StagedChangesetStorage(rootPath);
      const plan = (await new StagingAreaManager(rootPath).load("plan"))!;
      const path = storage.getChangesetPath(plan.id!);
      // A landing that died holding the lock: no heartbeat, so it ages past the stale threshold.
      await new FileLock(path).acquire({ owner: landingLockOwner(plan) });
      const old = new Date(Date.now() - 60_000);
      await utimes(`${path}.lock`, old, old);
      await storage.addChange(plan.id!, goal("after-crash"));
      expect((await new StagingAreaManager(rootPath).load("plan"))!.changes.map((c) => c.elementId)).toEqual([
        "motivation.goal.after-crash",
      ]);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it.serial("refuses a write into a changeset that was landed while it waited for the lock", async () => {
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

  it.serial("fails the landing when the note can't be written, and puts the marker back on rollback", async () => {
    const rootPath = await newProject();
    try {
      // A goal in the base first, so the rollback has a layer file to put back as it was.
      await modelAddHandler({ layer: "motivation", type: "goal", name: "seed", attributes: { priority: "low" }, rootPath });
      const { model, manager, plan } = await activePlan(rootPath);
      const write = spyOn(markerModule, "writeLandedNote").mockImplementation(async () => {
        throw new Error("EACCES: permission denied");
      });
      try {
        const error = await manager.commit(model, plan.id!, { validate: false }).catch((e) => e);
        expect(String(error.message)).toContain("Failed to record the landing");
      } finally {
        write.mockRestore();
      }
      expect((await manager.load("plan"))!.status).toBe("staged");
      expect(await readActiveMarker(rootPath)).toBe(plan.id!);
      expect(await readLandedNote(rootPath)).toBeNull();
      expect(await baseGoals(rootPath)).toEqual(["motivation.goal.seed"]);

      // A landing that fails after the note: rolled back, the note is taken away and the plan is active again.
      clearModelCache();
      const fresh = await Model.load(rootPath, { lazyLoad: false });
      const saveManifest = spyOn(fresh, "saveManifest").mockImplementation(async () => {
        throw new Error("EIO: manifest");
      });
      const error = await new StagingAreaManager(rootPath, fresh).commit(fresh, plan.id!, { validate: false }).catch((e) => e);
      saveManifest.mockRestore();
      expect(error).toBeInstanceOf(Error);
      expect(await readLandedNote(rootPath)).toBeNull();
      expect(await readActiveMarker(rootPath)).toBe(plan.id!);
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it.serial("refuses writes after landing the active changeset, until a changeset is created or the checkout deactivates", async () => {
    const rootPath = await newProject();
    try {
      const { model, manager, plan } = await activePlan(rootPath);
      expect(await lastChangesetWrite(rootPath, plan.id!)).not.toBeNull();
      await manager.commit(model, plan.id!, { validate: true });
      expect((await readLandedNote(rootPath))?.name).toBe("plan");
      // A landed changeset has no last writer to warn about.
      expect(await lastChangesetWrite(rootPath, plan.id!)).toBeNull();
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
        expect(text(refusal)).toContain("another staged");
        expect(text(refusal)).toContain("changeset_deactivate");
      }
      expect(await baseGoals(rootPath)).toEqual(["motivation.goal.kept"]);

      // A new changeset takes writes again, and clears the note.
      await changesetCreateHandler({ name: "next", rootPath });
      const next = (await manager.load("next"))!;
      expect(await readLandedNote(rootPath)).toBeNull();
      const staged = JSON.parse(
        text(await modelAddHandler({ layer: "motivation", type: "goal", name: "after", attributes: { priority: "low" }, rootPath }))
      );
      expect(staged.status).toBe("staged");
      expect(staged.changeset).toBe("next");
      // Discarding forgets its last writer too.
      expect(await lastChangesetWrite(rootPath, next.id!)).not.toBeNull();
      await new StagingAreaManager(rootPath).discard(next.id!);
      expect(await lastChangesetWrite(rootPath, next.id!)).toBeNull();
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it.serial("refuses to activate the landed changeset, which would reopen it (review of PR 1455, finding 2)", async () => {
    const rootPath = await newProject();
    try {
      const { model, manager, plan } = await activePlan(rootPath);
      await manager.commit(model, plan.id!, { validate: true });
      const error = await manager.setActive(plan.id!).catch((e) => e);
      expect(String(error.message)).toContain("Changeset 'plan' is landed (committed), so it can't be made active");
      expect(error.suggestions.join(" ")).toContain("another staged changeset");
      const result = await changesetActivateHandler({ changesetId: "plan", rootPath });
      expect(result.isError).toBe(true);
      // Still landed, with its changes, and writes are still refused.
      const after = (await manager.load("plan"))!;
      expect(after.status).toBe("committed");
      expect(after.changes.length).toBe(1);
      expect((await readLandedNote(rootPath))?.name).toBe("plan");
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it.serial("never saves 'staged' back over a landing: the base snapshot and a re-baseline take the lock and re-check", async () => {
    const rootPath = await newProject();
    try {
      const { model, manager, plan } = await activePlan(rootPath);
      // A re-baseline while the landing holds the lock is refused at once.
      const storage = new StagedChangesetStorage(rootPath);
      const lock = new FileLock(storage.getChangesetPath(plan.id!));
      await lock.acquire({ owner: landingLockOwner(plan) });
      try {
        expect(String((await manager.rebaseline(plan.id!).catch((e) => e)).message)).toContain("is being landed");
        expect(String((await manager.captureBaseSnapshot(plan.id!).catch((e) => e)).message)).toContain("is being landed");
      } finally {
        await lock.release();
      }
      // After the landing, both refuse and leave it committed with what it landed.
      await manager.commit(model, plan.id!, { validate: false });
      expect(String((await manager.captureBaseSnapshot(plan.id!).catch((e) => e)).message)).toContain("was landed");
      expect(String((await manager.rebaseline(plan.id!).catch((e) => e)).message)).toContain("committed");
      const after = (await manager.load("plan"))!;
      expect(after.status).toBe("committed");
      expect(after.changes.length).toBe(1);
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it.serial("leaves no note when the landed changeset was not the active one", async () => {
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
