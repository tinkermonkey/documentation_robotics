import { describe, it, expect } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import YAML from "yaml";
import { Model } from "../../../src/core/model.js";
import { upgradeModel } from "../../../src/core/model-upgrade.js";
import { applyCatalogMigrations, pendingCatalogMigrations } from "../../../src/core/catalog-migration.js";
import { RETIRED_ATTRIBUTES, migrateRetiredAttributes } from "../../../src/core/attribute-migration.js";
import { scanUpgrades } from "../../../src/core/upgrade-plan.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { SchemaValidator } from "../../../src/validators/schema-validator.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";

const VERSION = getCliBundledSpecVersion();
const PARTITION = "testing.inputspacepartition.email";
const SKETCH = "testing.testcasesketch.signup-happy-path";
const OTHER_SKETCH = "testing.testcasesketch.signup-invalid-email";
const NOTHING_RETIRED = { elementTypes: 0, retiredAttributes: 0, stagedRetiredAttributes: 0, relationships: 0, stagedRelationships: 0, errors: [] };

/** A model at the current spec version whose testing elements still carry the attributes #1091 removed */
async function writeModel(root: string, specVersion: string = VERSION): Promise<void> {
  const modelDir = join(root, "documentation-robotics", "model");
  await mkdir(join(modelDir, "13_testing"), { recursive: true });
  await writeFile(
    join(modelDir, "manifest.yaml"),
    YAML.stringify({
      version: "1.0.0",
      schema: "documentation-robotics-v1",
      spec_version: specVersion,
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      project: { name: "attribute-migration-test", version: "1.0.0" },
    })
  );
  const element = (path: string, id: string, attributes: Record<string, unknown>) => {
    const [layerId, type, name] = path.split(".");
    return { [path]: { id, path, spec_node_id: `${layerId}.${type}`, type, layer_id: layerId, name, attributes } };
  };
  await writeFile(
    join(modelDir, "13_testing", "elements.yaml"),
    YAML.stringify({
      ...element(PARTITION, "00000000-0000-4000-8000-0000000000f1", {
        fieldRef: "api.parameter.email",
        presenceRule: "required",
        description: "Email addresses",
      }),
      ...element(SKETCH, "00000000-0000-4000-8000-0000000000f2", {
        status: "draft",
        inputSelections: ["testing.inputpartitionselection.valid-email"],
      }),
      ...element("testing.testcasesketch.signup-invalid-email", "00000000-0000-4000-8000-0000000000f4", { status: "draft" }),
      // targetinputfield keeps its fieldRef
      ...element("testing.targetinputfield.signup-email", "00000000-0000-4000-8000-0000000000f3", {
        fieldRef: "api.parameter.email",
        partitionRef: PARTITION,
      }),
    })
  );
  await writeFile(join(modelDir, "relationships.yaml"), "# Intra-layer relationships\n\n[]\n");
}

async function withModel(test: (root: string) => Promise<void>, specVersion?: string): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dr-attribute-migration-"));
  try {
    await writeModel(root, specVersion);
    await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Stage a new partition carrying fieldRef, an update to the sketch, and a relationship */
async function stage(root: string): Promise<string> {
  const storage = new StagedChangesetStorage(root);
  const model = await Model.load(root, { lazyLoad: false });
  const changeset = await new StagingAreaManager(root, model).create("more-partitions", "stage before the upgrade");
  const now = new Date().toISOString();
  changeset.changes = [
    {
      type: "add",
      elementId: "testing.inputspacepartition.age",
      layerName: "testing",
      after: {
        id: "00000000-0000-4000-8000-0000000000f9",
        path: "testing.inputspacepartition.age",
        spec_node_id: "testing.inputspacepartition",
        type: "inputspacepartition",
        layer_id: "testing",
        name: "age",
        attributes: { fieldRef: "api.parameter.age", presenceRule: "optional" },
      },
      timestamp: now,
      sequenceNumber: 0,
    },
    {
      // An update payload that names no type: the element's type comes from the model
      type: "update",
      elementId: SKETCH,
      layerName: "testing",
      before: { name: "signup-happy-path", attributes: { status: "draft", inputSelections: ["x"] } },
      after: { name: "signup-happy-path", attributes: { status: "approved", inputSelections: ["x"] } },
      timestamp: now,
      sequenceNumber: 1,
    },
    {
      type: "relationship-add",
      elementId: `${OTHER_SKETCH}::depends-on::${SKETCH}`,
      layerName: "testing",
      after: { source: OTHER_SKETCH, predicate: "depends-on", target: SKETCH, layer: "testing" },
      timestamp: now,
      sequenceNumber: 2,
    },
  ] as never;
  await storage.save(changeset);
  return changeset.id;
}

async function readTestingLayer(root: string): Promise<string> {
  const dir = join(root, "documentation-robotics", "model", "13_testing");
  const files = (await readdir(dir)).sort();
  return (await Promise.all(files.map((f) => readFile(join(dir, f), "utf-8")))).join("\n");
}

describe("retired attributes (#1091)", () => {
  it("lists the attributes the spec removed", () => {
    expect(RETIRED_ATTRIBUTES).toMatchObject({
      "testing.testcasesketch": ["inputSelections"],
      "testing.inputspacepartition": ["fieldRef"],
    });
  });

  it("removes them from elements and keeps the other attributes", () =>
    withModel(async (root) => {
      const before = await Model.load(root, { lazyLoad: false });
      const schemaErrors = async (model: Model) =>
        (await new SchemaValidator().validateLayer(model.layers.get("testing")!)).errors.length;
      expect(await schemaErrors(before)).toBeGreaterThan(0);

      const result = await upgradeModel(root, { fromVersion: VERSION, toVersion: VERSION, catalogOnly: true });
      const step = result.migration?.applied[0]?.changes;
      expect(step?.description).toContain("retired attributes removed: testing.inputspacepartition.fieldRef (1 element)");
      expect(step?.details?.retiredAttributeChanges).toEqual([
        { element: PARTITION, specNodeId: "testing.inputspacepartition", attributes: ["fieldRef"] },
        { element: SKETCH, specNodeId: "testing.testcasesketch", attributes: ["inputSelections"] },
      ]);
      expect(step?.filesModified).toBeGreaterThan(0);

      const model = await Model.load(root, { lazyLoad: false });
      const testing = model.layers.get("testing")!;
      expect(testing.getElement(PARTITION)?.attributes).toEqual({ presenceRule: "required", description: "Email addresses" });
      expect(testing.getElement(SKETCH)?.attributes).toEqual({ status: "draft" });
      expect(testing.getElement("testing.targetinputfield.signup-email")?.attributes).toEqual({
        fieldRef: "api.parameter.email",
        partitionRef: PARTITION,
      });
      expect(model.manifest.specVersion).toBe(VERSION);
      expect(await schemaErrors(model)).toBe(0);
    }));

  it("removes them from staged element changes, and the changeset still commits", () =>
    withModel(async (root) => {
      const changesetId = await stage(root);
      const result = await upgradeModel(root, { fromVersion: VERSION, toVersion: VERSION, catalogOnly: true });
      expect(result.migration?.applied[0]?.changes?.details?.stagedRetiredAttributeChanges).toEqual([
        { changeset: changesetId, stagedAs: "add", element: "testing.inputspacepartition.age", specNodeId: "testing.inputspacepartition", attributes: ["fieldRef"] },
        { changeset: changesetId, stagedAs: "update", element: SKETCH, specNodeId: "testing.testcasesketch", attributes: ["inputSelections"] },
      ]);
      expect(result.changesets.rebaselined.map((c) => c.id)).toEqual([changesetId]);

      const staged = await new StagedChangesetStorage(root).load(changesetId);
      expect(staged?.changes.map((c) => c.sequenceNumber)).toEqual([0, 1, 2]);
      expect(staged?.changes[0].after?.attributes).toEqual({ presenceRule: "optional" });
      expect(staged?.changes[1].before?.attributes).toEqual({ status: "draft" });
      expect(staged?.changes[1].after?.attributes).toEqual({ status: "approved" });
      expect(staged?.changes[2].after).toEqual({ source: OTHER_SKETCH, predicate: "depends-on", target: SKETCH, layer: "testing" });

      const model = await Model.load(root, { lazyLoad: false });
      await new StagingAreaManager(root, model).commit(model, changesetId);
      const after = await Model.load(root, { lazyLoad: false });
      const testing = after.layers.get("testing")!;
      expect(testing.getElement("testing.inputspacepartition.age")?.attributes).toEqual({ presenceRule: "optional" });
      expect(testing.getElement(SKETCH)?.attributes).toEqual({ status: "approved" });
    }));

  it("changes nothing in a dry run", () =>
    withModel(async (root) => {
      const changesetId = await stage(root);
      const storage = new StagedChangesetStorage(root);
      const layerBefore = await readTestingLayer(root);
      const changesBefore = JSON.stringify((await storage.load(changesetId))?.changes);

      const model = await Model.load(root, { lazyLoad: false });
      const dry = await applyCatalogMigrations(model, { dryRun: true });
      expect(dry.errors).toEqual([]);
      expect(dry.details.retiredAttributeChanges).toHaveLength(2);
      expect(dry.details.stagedRetiredAttributeChanges).toHaveLength(2);
      expect(dry.filesModified).toBe(0);

      // Neither the loaded model nor anything on disk changed
      const testing = model.layers.get("testing")!;
      expect(testing.getElement(PARTITION)?.attributes).toMatchObject({ fieldRef: "api.parameter.email" });
      expect(testing.getElement(SKETCH)?.attributes).toMatchObject({ inputSelections: ["testing.inputpartitionselection.valid-email"] });
      expect(await readTestingLayer(root)).toBe(layerBefore);
      expect(JSON.stringify((await storage.load(changesetId))?.changes)).toBe(changesBefore);
    }));

  it("counts them as pending, and the upgrade scan offers the catalog step", () =>
    withModel(async (root) => {
      await stage(root);
      expect(await pendingCatalogMigrations(await Model.load(root, { lazyLoad: false }))).toEqual({
        ...NOTHING_RETIRED,
        retiredAttributes: 2,
        stagedRetiredAttributes: 2,
      });

      const scan = await scanUpgrades(root, { targetBundledSpec: true });
      const catalog = scan.actions.find((action) => action.catalogOnly);
      expect(catalog).toBeDefined();
      expect(catalog?.details).toEqual([
        "Remove retired attributes from 2 element(s): testing.inputspacepartition.fieldRef (1 element); testing.testcasesketch.inputSelections (1 element)",
        "Remove retired attributes from 2 staged change(s)",
      ]);
    }));

  it("changes nothing on a second run", () =>
    withModel(async (root) => {
      const changesetId = await stage(root);
      await upgradeModel(root, { fromVersion: VERSION, toVersion: VERSION, catalogOnly: true });
      const storage = new StagedChangesetStorage(root);
      const layerOnce = await readTestingLayer(root);
      // The changes, not the whole changeset: every upgrade re-baselines an in-step changeset
      const changesetOnce = JSON.stringify((await storage.load(changesetId))?.changes);

      const model = await Model.load(root, { lazyLoad: false });
      expect(await pendingCatalogMigrations(model)).toEqual(NOTHING_RETIRED);
      const again = await migrateRetiredAttributes(model);
      expect(again).toEqual({ layersModified: 0, changes: [], changesetsModified: 0, stagedChanges: [], errors: [] });
      const twice = await upgradeModel(root, { fromVersion: VERSION, toVersion: VERSION, catalogOnly: true });
      expect(twice.migration?.applied[0]?.changes?.filesModified).toBe(0);
      expect(await readTestingLayer(root)).toBe(layerOnce);
      expect(JSON.stringify((await storage.load(changesetId))?.changes)).toBe(changesetOnce);

      const scan = await scanUpgrades(root, { targetBundledSpec: true });
      expect(scan.actions.some((action) => action.catalogOnly)).toBe(false);
    }));

  it("takes its rows from the table it is given", () =>
    withModel(async (root) => {
      const model = await Model.load(root, { lazyLoad: false });
      const result = await migrateRetiredAttributes(model, { "testing.targetinputfield": ["partitionRef"] }, { dryRun: true });
      expect(result.changes).toEqual([
        { element: "testing.targetinputfield.signup-email", specNodeId: "testing.targetinputfield", attributes: ["partitionRef"] },
      ]);
    }));
  it("removes them in the same run when a model at 0.11.0 is upgraded to the current version", async () => {
    await withModel(async (root) => {
      const result = await upgradeModel(root, { fromVersion: "0.11.0", toVersion: VERSION });
      expect(result.migration?.applied.at(-1)?.to).toBe(VERSION);
      const model = await Model.load(root, { lazyLoad: false });
      expect(model.manifest.specVersion).toBe(VERSION);
      const testing = model.layers.get("testing")!;
      expect(testing.getElement(PARTITION)?.attributes).toEqual({ presenceRule: "required", description: "Email addresses" });
      expect(testing.getElement(SKETCH)?.attributes).toEqual({ status: "draft" });
      expect(await pendingCatalogMigrations(model)).toEqual(NOTHING_RETIRED);
    }, "0.11.0");
  });
});
