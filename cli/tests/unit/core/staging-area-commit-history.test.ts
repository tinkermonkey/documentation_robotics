/**
 * Every landing stays in the manifest's changeset_history. Model.load reads the history, and
 * Model.saveManifest keeps the entries already on disk and appends its own, so a save after a
 * reload (or from a model loaded before another process committed) never drops an entry.
 */

import { describe, it, expect } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";

async function newProject(): Promise<string> {
  clearModelCache();
  const rootPath = join(tmpdir(), `dr-commit-history-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Commit History", version: "0.1.0" });
  return rootPath;
}

function manifestPath(rootPath: string): string {
  return join(rootPath, "documentation-robotics", "model", "manifest.yaml");
}

async function historyOnDisk(rootPath: string): Promise<Array<Record<string, unknown>>> {
  const manifest = parse(await readFile(manifestPath(rootPath), "utf-8"));
  return manifest.changeset_history ?? [];
}

/** Stage one goal into a new changeset named `name`, then land it through a freshly loaded model. */
async function stageAndCommit(rootPath: string, name: string, goal: string): Promise<void> {
  await changesetCreateHandler({ name, rootPath });
  await modelAddHandler({ layer: "motivation", type: "goal", name: goal, attributes: { priority: "high" }, rootPath });
  clearModelCache();
  const model = await Model.load(rootPath, { lazyLoad: false });
  const manager = new StagingAreaManager(model.rootPath, model);
  const changeset = await manager.load(name);
  const result = await manager.commit(model, changeset!.id, { validate: true });
  expect(result.committed).toBe(1);
  clearModelCache();
}

// Each test makes its own project: test:unit runs core tests with --concurrent.
describe("changeset_history across commits", () => {
  it("keeps both of two commits in a row, with a reload between them", async () => {
    const rootPath = await newProject();
    try {
      await stageAndCommit(rootPath, "first", "faster-checkout");
      expect((await historyOnDisk(rootPath)).map((e) => e.name)).toEqual(["first"]);

      // A reload reads the history back.
      const reloaded = await Model.load(rootPath, { lazyLoad: false });
      expect(reloaded.manifest.changeset_history?.map((e) => e.name)).toEqual(["first"]);

      await stageAndCommit(rootPath, "second", "lower-cost");
      const history = await historyOnDisk(rootPath);
      expect(history.map((e) => e.name)).toEqual(["first", "second"]);
      expect(history.every((e) => e.action === "committed" && typeof e.committed_at === "string")).toBe(true);

      const final = await Model.load(rootPath, { lazyLoad: false });
      expect(final.manifest.changeset_history?.map((e) => e.name)).toEqual(["first", "second"]);
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps the history on a plain manifest save", async () => {
    const rootPath = await newProject();
    try {
      await stageAndCommit(rootPath, "first", "faster-checkout");
      const model = await Model.load(rootPath, { lazyLoad: false });
      await model.saveManifest();
      expect((await historyOnDisk(rootPath)).map((e) => e.name)).toEqual(["first"]);
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps entries another process wrote after this model was loaded", async () => {
    const rootPath = await newProject();
    try {
      const stale = await Model.load(rootPath, { lazyLoad: false });
      await stageAndCommit(rootPath, "elsewhere", "faster-checkout");

      // The stale model never saw that commit; its save must not drop it.
      stale.manifest.changeset_history = [
        { name: "here", committed_at: "2026-11-12T00:00:00.000Z", action: "committed" },
      ];
      await stale.saveManifest();
      expect((await historyOnDisk(rootPath)).map((e) => e.name)).toEqual(["elsewhere", "here"]);
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("reads legacy entries and keeps entries it cannot read as written", async () => {
    const rootPath = await newProject();
    try {
      const manifest = parse(await readFile(manifestPath(rootPath), "utf-8"));
      manifest.changeset_history = [
        { name: "old", applied_at: "2025-01-01T00:00:00.000Z", action: "applied" },
        { name: "odd", committed_at: "2025-02-01T00:00:00.000Z", action: "archived" },
      ];
      await writeFile(manifestPath(rootPath), stringify(manifest));

      const model = await Model.load(rootPath, { lazyLoad: false });
      expect(model.manifest.changeset_history).toEqual([
        { name: "old", committed_at: "2025-01-01T00:00:00.000Z", action: "committed" },
      ]);

      await model.saveManifest();
      expect(await historyOnDisk(rootPath)).toEqual([
        { name: "old", committed_at: "2025-01-01T00:00:00.000Z", action: "committed" },
        { name: "odd", committed_at: "2025-02-01T00:00:00.000Z", action: "archived" },
      ]);
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
