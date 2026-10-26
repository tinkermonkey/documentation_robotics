import { describe, it, expect } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import YAML from "yaml";
import { Model } from "../../../src/core/model.js";
import { upgradeModel } from "../../../src/core/model-upgrade.js";
import type { Change } from "../../../src/core/changeset.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";

const modelDir = (root: string) => join(root, "documentation-robotics", "model");

/** An element as a layer's elements.yaml records it */
function elementRecord(uuid: string, path: string, attributes?: Record<string, unknown>) {
  const [layerId, type, name] = path.split(".");
  return {
    id: uuid,
    path,
    spec_node_id: `${layerId}.${type}`,
    type,
    layer_id: layerId,
    name,
    ...(attributes && { attributes })
  };
}

/** Write a 0.9.0 model with one application service */
async function writeModel(root: string): Promise<void> {
  await mkdir(join(modelDir(root), "05_application"), { recursive: true });
  await writeFile(
    join(modelDir(root), "manifest.yaml"),
    YAML.stringify({
      version: "1.0.0",
      schema: "documentation-robotics-v1",
      spec_version: "0.9.0",
      // Model.load stamps the current time on a manifest without these, which changes the
      // model's snapshot on every load
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      project: { name: "model-upgrade-test", version: "1.0.0" }
    })
  );
  const ordering = "application.applicationservice.ordering";
  await writeFile(
    join(modelDir(root), "05_application", "elements.yaml"),
    YAML.stringify({ [ordering]: elementRecord("00000000-0000-4000-8000-000000000001", ordering) })
  );
}

/** Run a test against its own on-disk 0.9.0 model (the unit suite runs tests concurrently) */
async function withModel(test: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dr-model-upgrade-"));
  try {
    await writeModel(root);
    await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Change the base model outside any changeset, as a hand edit would */
async function addBaseElement(root: string, uuid: string, path: string): Promise<void> {
  const file = join(modelDir(root), "05_application", "elements.yaml");
  const doc = YAML.parse(await readFile(file, "utf-8"));
  doc[path] = elementRecord(uuid, path);
  await writeFile(file, YAML.stringify(doc));
}

const elementAdd = (uuid: string, path: string): Omit<Change, "timestamp"> => ({
  type: "add",
  elementId: path,
  layerName: path.split(".")[0],
  after: elementRecord(uuid, path, { serviceType: "synchronous" })
});

/** Create a changeset on the model as it is now and stage one element add in it */
async function stageChangeset(root: string, name: string, uuid: string, path: string): Promise<string> {
  const model = await Model.load(root, { lazyLoad: false });
  const staging = new StagingAreaManager(root, model);
  const changeset = await staging.create(name);
  await staging.stage(changeset.id, elementAdd(uuid, path));
  return changeset.id;
}

async function baseSnapshot(root: string, changesetId: string): Promise<string> {
  return (await new StagedChangesetStorage(root).load(changesetId))!.baseSnapshot;
}

/** Commit a changeset the way `dr changeset commit` does, without --force */
async function commit(root: string, changesetId: string): Promise<Model> {
  const model = await Model.load(root, { lazyLoad: false });
  await new StagingAreaManager(root, model).commit(model, changesetId);
  return Model.load(root, { lazyLoad: false });
}

describe("upgradeModel re-baselines staged changesets", () => {
  it("lets a changeset staged on the 0.9.0 model commit without --force after the upgrade", () =>
    withModel(async (root) => {
      const invoicing = "application.applicationservice.invoicing";
      const changesetId = await stageChangeset(
        root,
        "add invoicing",
        "00000000-0000-4000-8000-000000000011",
        invoicing
      );
      const before = await baseSnapshot(root, changesetId);

      const result = await upgradeModel(root, { fromVersion: "0.9.0", toVersion: "0.10.0" });

      expect(result.migration?.applied.map((m) => m.to)).toEqual(["0.10.0"]);
      expect(result.changesets).toEqual({
        rebaselined: [{ id: changesetId, name: "add invoicing" }],
        drifted: [],
        errors: []
      });
      expect(await baseSnapshot(root, changesetId)).not.toBe(before);

      const committed = await commit(root, changesetId);
      expect(committed.manifest.specVersion).toBe("0.10.0");
      expect(committed.getElementById(invoicing)).toBeDefined();
    }));

  it("keeps the base snapshot of a changeset that had drifted before the upgrade", () =>
    withModel(async (root) => {
      const driftedId = await stageChangeset(
        root,
        "staged before the edit",
        "00000000-0000-4000-8000-000000000021",
        "application.applicationservice.invoicing"
      );
      await addBaseElement(
        root,
        "00000000-0000-4000-8000-000000000022",
        "application.applicationservice.billing"
      );

      // A discarded changeset in step with the model is history: the upgrade leaves it alone
      const discardedId = await stageChangeset(
        root,
        "discarded",
        "00000000-0000-4000-8000-000000000023",
        "application.applicationservice.refunds"
      );
      const storage = new StagedChangesetStorage(root);
      const discarded = (await storage.load(discardedId))!;
      discarded.status = "discarded";
      await storage.save(discarded);

      const shipping = "application.applicationservice.shipping";
      const inStepId = await stageChangeset(
        root,
        "staged after the edit",
        "00000000-0000-4000-8000-000000000024",
        shipping
      );
      const driftedBefore = await baseSnapshot(root, driftedId);
      const discardedBefore = await baseSnapshot(root, discardedId);

      const result = await upgradeModel(root, { fromVersion: "0.9.0", toVersion: "0.10.0" });

      expect(result.changesets).toEqual({
        rebaselined: [{ id: inStepId, name: "staged after the edit" }],
        drifted: [{ id: driftedId, name: "staged before the edit" }],
        errors: []
      });
      expect(await baseSnapshot(root, driftedId)).toBe(driftedBefore);
      expect(await baseSnapshot(root, discardedId)).toBe(discardedBefore);

      const model = await Model.load(root, { lazyLoad: false });
      const drift = await new StagingAreaManager(root, model).detectDrift(driftedId);
      expect(drift.isDrifted).toBe(true);
      await expect(commit(root, driftedId)).rejects.toThrow("Base model has drifted");

      const committed = await commit(root, inStepId);
      expect(committed.getElementById(shipping)).toBeDefined();
    }));

  it("re-baselines staged changesets when the upgrade only bumps the spec version", () =>
    withModel(async (root) => {
      const changesetId = await stageChangeset(
        root,
        "add invoicing",
        "00000000-0000-4000-8000-000000000031",
        "application.applicationservice.invoicing"
      );

      const result = await upgradeModel(root, {
        fromVersion: "0.9.0",
        toVersion: "0.10.0",
        versionBumpOnly: true
      });

      expect(result.migration).toBeUndefined();
      expect(result.changesets.rebaselined).toEqual([{ id: changesetId, name: "add invoicing" }]);
      const committed = await commit(root, changesetId);
      expect(committed.manifest.specVersion).toBe("0.10.0");
    }));

  it("reports nothing when no changeset is staged", () =>
    withModel(async (root) => {
      const result = await upgradeModel(root, { fromVersion: "0.9.0", toVersion: "0.10.0" });
      expect(result.changesets).toEqual({ rebaselined: [], drifted: [], errors: [] });
    }));
});

describe("upgradeModel migrates objectschema.required", () => {
  it("saves required as an array, which saving the loaded layers used to overwrite", () =>
    withModel(async (root) => {
      const order = "data-model.objectschema.order";
      const dataModelDir = join(modelDir(root), "08_data-model");
      await mkdir(dataModelDir, { recursive: true });
      await writeFile(
        join(dataModelDir, "elements.yaml"),
        YAML.stringify({
          [order]: elementRecord("00000000-0000-4000-8000-000000000041", order, {
            type: "object",
            required: "id, total"
          })
        })
      );

      await upgradeModel(root, { fromVersion: "0.9.0", toVersion: "0.10.0" });

      // Saving the layer may rename its file; every file that records the schema holds the array
      const saved: unknown[] = [];
      for (const file of await readdir(dataModelDir)) {
        const doc = YAML.parse(await readFile(join(dataModelDir, file), "utf-8"));
        if (doc?.[order]) {
          saved.push(doc[order].attributes.required);
        }
      }
      expect(saved).toEqual([["id", "total"]]);

      const upgraded = await Model.load(root, { lazyLoad: false });
      expect(upgraded.getElementById(order)?.attributes.required).toEqual(["id", "total"]);
    }));
});
