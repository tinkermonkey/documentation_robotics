/**
 * StagingAreaManager.commit writes the committed changeset's relationship changes onto the base
 * relationships only. Model.load merges the active changeset's staged relationships into
 * model.relationships for reads; committing another changeset must not land them (or the active
 * changeset's staged removals) in relationships.yaml.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { relationshipAddHandler, relationshipDeleteHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { changesetActivateHandler, changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";

const GOAL = "motivation.goal.faster-checkout";
const BASE_SERVICE = "application.applicationservice.checkout";
const ACTIVE_SERVICE = "application.applicationservice.s2";
const COMMITTED_SERVICE = "application.applicationservice.s1";

let rootPath: string;

async function addService(name: string): Promise<void> {
  await modelAddHandler({ layer: "application", type: "applicationservice", name, attributes: { serviceType: "synchronous" }, rootPath });
}

async function baseRelationships(): Promise<string> {
  return readFile(join(rootPath, "documentation-robotics", "model", "relationships.yaml"), "utf-8");
}

/** The source ids of the `realizes` rows targeting the goal in relationships.yaml. */
async function realizers(): Promise<string[]> {
  const model = await Model.load(rootPath, { lazyLoad: false });
  const ids = new Map<string, string>();
  for (const layer of model.layers.values()) {
    for (const element of layer.listElements()) {
      ids.set(element.id, element.path ?? element.id);
      if (element.path) ids.set(element.path, element.path);
    }
  }
  const text = await baseRelationships();
  expect(text.length).toBeGreaterThan(0);
  return model
    .getBaseRelationships()
    .filter((r) => r.predicate === "realizes" && (ids.get(r.target) ?? r.target) === GOAL)
    .map((r) => ids.get(r.source) ?? r.source)
    .sort();
}

beforeEach(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-commit-base-rels-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Commit Base Relationships", version: "0.1.0" });
  await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" }, rootPath });
  await addService("checkout");
  await relationshipAddHandler({ source: BASE_SERVICE, predicate: "realizes", target: GOAL, rootPath });

  // "bbb" adds s1 realizes the goal.
  await changesetCreateHandler({ name: "bbb", rootPath });
  await addService("s1");
  await relationshipAddHandler({ source: COMMITTED_SERVICE, predicate: "realizes", target: GOAL, rootPath });

  // "aaa", left active, adds s2 realizes the goal and removes checkout realizes the goal.
  await changesetCreateHandler({ name: "aaa", rootPath });
  await addService("s2");
  await relationshipAddHandler({ source: ACTIVE_SERVICE, predicate: "realizes", target: GOAL, rootPath });
  await relationshipDeleteHandler({ source: BASE_SERVICE, target: GOAL, rootPath });
  await changesetActivateHandler({ changesetId: "aaa", rootPath });
  clearModelCache();
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

// One test: test:unit runs core tests with --concurrent, and the setup shares rootPath.
describe("StagingAreaManager.commit with another changeset active", () => {
  it("lands only the committed changeset's relationship changes, then the active one's own", async () => {
    expect(await realizers()).toEqual([BASE_SERVICE]);

    const model = await Model.load(rootPath, { lazyLoad: false });
    expect(model.getActiveChangesetId()).not.toBeNull();
    const manager = new StagingAreaManager(model.rootPath, model);
    const bbb = await manager.load("bbb");
    const result = await manager.commit(model, bbb!.id, { validate: true });
    expect(result.committed).toBe(2);

    // s1's relationship is in; the active changeset's add (s2) and removal (checkout) are not.
    expect(await realizers()).toEqual([BASE_SERVICE, COMMITTED_SERVICE].sort());
    expect((await manager.load("aaa"))!.status).toBe("staged");

    // Committing the active changeset still lands its own add and removal. The base moved under
    // it (bbb landed), hence force.
    const again = await Model.load(rootPath, { lazyLoad: false });
    const activeManager = new StagingAreaManager(again.rootPath, again);
    const aaa = await activeManager.load("aaa");
    await activeManager.commit(again, aaa!.id, { validate: true, force: true });
    expect(await realizers()).toEqual([ACTIVE_SERVICE, COMMITTED_SERVICE].sort());
  });
});
