/**
 * A landing that fails and rolls back leaves the model and the changeset as they were (found in the
 * review of PR 1455, fixed there): the files and folders the landing created where nothing was are
 * removed (a type's first file, a layer's first folder), and nothing else; relationships.yaml is put
 * back, and a changeset the landing had already saved as committed is staged again, still active,
 * so it can land after all.
 */

import { describe, it, expect, spyOn } from "bun:test";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { readActiveMarker, readLandedNote } from "../../../src/core/active-changeset-marker.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCreateHandler, changesetDeactivateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";

async function newProject(): Promise<string> {
  clearModelCache();
  const rootPath = join(tmpdir(), `dr-landing-rollback-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Landing Rollback", version: "0.1.0" });
  return rootPath;
}

/** Every file under the model folder with its content: what a rollback must leave as it found it. */
async function modelSnapshot(rootPath: string): Promise<Record<string, string>> {
  const modelDir = join(rootPath, "documentation-robotics", "model");
  const snapshot: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        snapshot[`${relative(modelDir, full)}/`] = "";
        await walk(full);
      } else {
        snapshot[relative(modelDir, full)] = await readFile(full, "utf-8");
      }
    }
  };
  await walk(modelDir);
  return snapshot;
}

const fn = (name: string) => ({ layer: "application", type: "applicationfunction", name });

describe("a landing that rolls back", () => {
  it.serial("removes what it created, puts relationships.yaml back, and leaves the changeset staged and active", async () => {
    const rootPath = await newProject();
    try {
      // The base: application functions linked by a relationship, and no motivation layer.
      await modelAddHandler({
        elements: [fn("load"), fn("save")],
        relationships: [{ source: "application.applicationfunction.save", predicate: "depends-on", target: "application.applicationfunction.load" }],
        rootPath,
      });
      // A model with no motivation folder (one an older dr made, or a layer removed by hand).
      await rm(join(rootPath, "documentation-robotics", "model", "01_motivation"), { recursive: true, force: true });
      clearModelCache();
      // The plan: a goal (the motivation layer's first folder and file), a service (application's
      // first applicationservice file) and a relationship (a new row in relationships.yaml).
      await changesetCreateHandler({ name: "plan", rootPath });
      await modelAddHandler({
        elements: [
          { layer: "motivation", type: "goal", name: "fast", attributes: { priority: "high" } },
          { layer: "application", type: "applicationservice", name: "orders", attributes: { serviceType: "synchronous" } },
        ],
        relationships: [{ source: "application.applicationfunction.load", predicate: "depends-on", target: "application.applicationfunction.save" }],
        rootPath,
      });
      clearModelCache();
      const before = await modelSnapshot(rootPath);
      const created = (snapshot: Record<string, string>) =>
        Object.keys(snapshot).filter((entry) => entry.endsWith("/goal.yaml") || entry.endsWith("/application_service.yaml"));
      expect(created(before)).toEqual([]);
      expect(Object.keys(before)).not.toContain("01_motivation/");

      const model = await Model.load(rootPath, { lazyLoad: false });
      const manager = new StagingAreaManager(rootPath, model);
      const plan = (await manager.load("plan"))!;
      // Fail after the layers, relationships.yaml and the changeset's status were saved.
      const saveManifest = spyOn(model, "saveManifest").mockImplementation(async () => {
        throw new Error("EIO: manifest");
      });
      const error = await manager.commit(model, plan.id!, { validate: false }).catch((e) => e);
      saveManifest.mockRestore();
      expect(String(error.message)).toContain("rollback succeeded");

      // The model is as it was: no goal or applicationservice file, the old rows.
      expect(await modelSnapshot(rootPath)).toEqual(before);
      // The changeset is staged and active again, with every change, and writes stage into it.
      const after = (await manager.load("plan"))!;
      expect(after.status).toBe("staged");
      expect(after.changes.length).toBe(plan.changes.length);
      expect(await readActiveMarker(rootPath)).toBe(plan.id!);
      expect(await readLandedNote(rootPath)).toBeNull();
      // Writable: a write stages into it, not into the base model.
      clearModelCache();
      const staged = await modelAddHandler({ layer: "motivation", type: "goal", name: "later", attributes: { priority: "low" }, rootPath });
      expect(JSON.parse((staged.content[0] as { text: string }).text)).toMatchObject({ status: "staged", changeset: "plan" });
      const changes = (await manager.load("plan"))!.changes.length;
      expect(changes).toBe(plan.changes.length + 1);
      expect(Object.keys(await modelSnapshot(rootPath))).toEqual(Object.keys(before));

      // And it lands after all, as a plan still to land (not "already-landed").
      clearModelCache();
      const retry = await Model.load(rootPath, { lazyLoad: false });
      const landed = await new StagingAreaManager(rootPath, retry).commit(retry, plan.id!, { validate: false });
      expect(landed.committed).toBe(changes);
      const final = await modelSnapshot(rootPath);
      expect(created(final).length).toBe(2);
      expect(Object.keys(final)).toContain("01_motivation/");
      expect(final["relationships.yaml"]).toContain("application.applicationfunction.save");
    } finally {
      clearModelCache();
      await changesetDeactivateHandler({ rootPath }).catch(() => undefined);
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it.serial("keeps a base file named in another letter case, and what it didn't create (review of PR 1455)", async () => {
    const rootPath = await newProject();
    try {
      // A base goal in Goal.yaml: the landing's save renames it goal.yaml (planLayerFiles). Where
      // letter case is ignored (macOS), the restored Goal.yaml is that same file, and a rollback
      // that removed whatever a list of names lacked deleted it.
      await modelAddHandler({ layer: "motivation", type: "goal", name: "base", attributes: { priority: "high" }, rootPath });
      const modelDir = join(rootPath, "documentation-robotics", "model");
      await rename(join(modelDir, "01_motivation", "goal.yaml"), join(modelDir, "01_motivation", "Goal.yaml"));
      clearModelCache();
      await changesetCreateHandler({ name: "plan", rootPath });
      await modelAddHandler({ layer: "motivation", type: "goal", name: "planned", attributes: { priority: "low" }, rootPath });
      clearModelCache();
      const before = await modelSnapshot(rootPath);
      expect(before["01_motivation/Goal.yaml"]).toContain("motivation.goal.base");

      const model = await Model.load(rootPath, { lazyLoad: false });
      const manager = new StagingAreaManager(rootPath, model);
      const plan = (await manager.load("plan"))!;
      // Something else writes into the model folder while the landing runs, then the landing fails.
      const saveManifest = spyOn(model, "saveManifest").mockImplementation(async () => {
        await writeFile(join(modelDir, "01_motivation", "notes.md"), "not the landing's\n");
        throw new Error("EIO: manifest");
      });
      const error = await manager.commit(model, plan.id!, { validate: false }).catch((e) => e);
      saveManifest.mockRestore();
      expect(String(error.message)).toContain("rollback succeeded");

      // The base goal is where it was, under its own name, and the other writer's file is kept.
      const after = await modelSnapshot(rootPath);
      expect(after["01_motivation/notes.md"]).toBe("not the landing's\n");
      delete after["01_motivation/notes.md"];
      expect(after).toEqual(before);
      expect((await manager.load("plan"))!.status).toBe("staged");
    } finally {
      clearModelCache();
      await changesetDeactivateHandler({ rootPath }).catch(() => undefined);
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
