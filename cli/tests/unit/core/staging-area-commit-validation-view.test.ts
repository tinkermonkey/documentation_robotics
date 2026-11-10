/**
 * StagingAreaManager.commit validates the committed changeset against the base plus that changeset
 * only. Another changeset that happens to be active must not make a dangling reference look valid.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetActivateHandler, changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetUnstageHandler } from "../../../src/mcp/tools/changeset-editing.js";

const X = "application.applicationfunction.x";
const Y = "application.applicationservice.y";

let rootPath: string;

async function addY(): Promise<void> {
  await modelAddHandler({ layer: "application", type: "applicationservice", name: "y", attributes: { serviceType: "synchronous" }, rootPath });
}

async function baseFiles(): Promise<string> {
  const dir = join(rootPath, "documentation-robotics", "model");
  const { readdir } = await import("node:fs/promises");
  // readdir's recursive order isn't stable, so sort the paths before comparing the contents.
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((f) => join(f.parentPath, f.name))
    .sort();
  return (await Promise.all(files.map((f) => readFile(f, "utf-8")))).join("\n");
}

async function commit(name: string, options: { force?: boolean } = {}) {
  const model = await Model.load(rootPath, { lazyLoad: false });
  const manager = new StagingAreaManager(model.rootPath, model);
  const changeset = await manager.load(name);
  return manager.commit(model, changeset!.id, { validate: true, force: options.force });
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-commit-validation-view-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Commit Validation View", version: "0.1.0" });
  await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" }, rootPath });

  // B stages x and "x realizes y", but not y: y was staged to wire the relationship, then unstaged
  // with the relationship kept.
  await changesetCreateHandler({ name: "bbb", rootPath });
  await modelAddHandler({ layer: "application", type: "applicationfunction", name: "x", rootPath });
  await addY();
  await relationshipAddHandler({ source: X, predicate: "realizes", target: Y, rootPath });
  await changesetUnstageHandler({ elementId: Y, keepRelationships: true, rootPath });

  // A, left active, stages y.
  await changesetCreateHandler({ name: "aaa", rootPath });
  await addY();
  await changesetActivateHandler({ changesetId: "aaa", rootPath });
  clearModelCache();
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

// One test: test:unit runs core tests with --concurrent, and the setup shares rootPath.
describe("StagingAreaManager.commit validation view", () => {
  it("refuses a reference that only the active changeset satisfies, then validates the active one itself", async () => {
    const before = await baseFiles();
    await expect(commit("bbb")).rejects.toThrow(/Relationship target element 'application\.applicationservice\.y' not found/);
    expect(await baseFiles()).toBe(before);

    // Committing the active changeset still validates, and passes: y lands.
    const landed = await commit("aaa");
    expect(landed.validation.ran).toBe(true);
    expect(landed.validation.passed).toBe(true);
    expect(await baseFiles()).toContain(Y);

    // Now y is in the base, B validates (the base moved under it, hence force).
    const second = await commit("bbb", { force: true });
    expect(second.validation.passed).toBe(true);
    expect(await baseFiles()).toContain(X);
  });
});
