import { describe, it, expect } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import YAML from "yaml";
import { Model } from "../../../src/core/model.js";
import { upgradeModel } from "../../../src/core/model-upgrade.js";
import { applyCatalogMigrations, pendingCatalogMigrations } from "../../../src/core/catalog-migration.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { RELATIONSHIP_REWRITE_TABLE } from "../../../src/core/relationship-migration-table.js";
import { RelationshipValidator } from "../../../src/validators/relationship-schema-validator.js";
import { buildRewriteTable, loadCatalogTriples, type ChangeRecord } from "../../../scripts/generate-relationship-migration.js";

const SEARCH = "00000000-0000-4000-8000-0000000000c1";

/** A 0.9.0 model with product.capability elements, one with a UUID and one whose id is its path */
const ELEMENTS: Record<string, Array<{ id: string; path: string; references?: unknown[] }>> = {
  "01_motivation": [{ id: "00000000-0000-4000-8000-0000000000a1", path: "motivation.requirement.find-fast" }],
  "02_business": [{ id: "00000000-0000-4000-8000-0000000000b1", path: "business.businessfunction.find-information" }],
  "03_product": [
    { id: SEARCH, path: "product.capability.search" },
    { id: "product.capability.discovery", path: "product.capability.discovery" },
    {
      id: "00000000-0000-4000-8000-0000000000c3",
      path: "product.feature.search-box",
      references: [{ source: "product.feature.search-box", target: "product.capability.search", type: "documents" }],
    },
  ],
  "05_application": [{ id: "00000000-0000-4000-8000-0000000000d1", path: "application.applicationservice.search-api" }],
};

const RELATIONSHIPS = [
  { source: "product.feature.search-box", predicate: "realizes", target: "product.capability.search", layer: "product" },
  { source: "product.capability.search", predicate: "realizes", target: "business.businessfunction.find-information", layer: "product", targetLayer: "business" },
  // fulfills becomes satisfies (product principles), after the type rename
  { source: SEARCH, predicate: "fulfills", target: "motivation.requirement.find-fast", layer: "product", targetLayer: "motivation" },
  { source: "application.applicationservice.search-api", predicate: "realizes", target: "product.capability.search", layer: "application", targetLayer: "product" },
  { source: "product.capability.discovery", predicate: "aggregates", target: "product.capability.search", layer: "product" },
];

async function writeModel(root: string, specVersion = "0.9.0"): Promise<void> {
  const modelDir = join(root, "documentation-robotics", "model");
  await mkdir(modelDir, { recursive: true });
  await writeFile(
    join(modelDir, "manifest.yaml"),
    YAML.stringify({
      version: "1.0.0",
      schema: "documentation-robotics-v1",
      spec_version: specVersion,
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      project: { name: "element-type-migration-test", version: "1.0.0" },
    })
  );
  for (const [dir, elements] of Object.entries(ELEMENTS)) {
    await mkdir(join(modelDir, dir), { recursive: true });
    const doc: Record<string, unknown> = {};
    for (const { id, path, references } of elements) {
      const [layerId, type, name] = path.split(".");
      doc[path] = { id, path, spec_node_id: `${layerId}.${type}`, type, layer_id: layerId, name, ...(references && { references }) };
      if (type === "capability") (doc[path] as Record<string, unknown>).attributes = { status: "delivered" };
    }
    await writeFile(join(modelDir, dir, "elements.yaml"), YAML.stringify(doc));
  }
  await writeFile(join(modelDir, "relationships.yaml"), `# Intra-layer relationships\n\n${YAML.stringify(RELATIONSHIPS)}`);
}

async function withModel(test: (root: string) => Promise<void>, specVersion = "0.9.0"): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dr-element-type-migration-"));
  try {
    await writeModel(root, specVersion);
    await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Stage, on the 0.9.0 model, a new capability and a relationship to it */
async function stage(root: string): Promise<string> {
  const storage = new StagedChangesetStorage(root);
  const model = await Model.load(root, { lazyLoad: false });
  const changeset = await new StagingAreaManager(root, model).create("add-export", "stage a capability before the upgrade");
  const now = new Date().toISOString();
  changeset.changes = [
    {
      type: "add",
      elementId: "product.capability.export",
      layerName: "product",
      after: { id: "00000000-0000-4000-8000-0000000000c9", path: "product.capability.export", spec_node_id: "product.capability", type: "capability", layer_id: "product", name: "export", attributes: { status: "planned" } },
      timestamp: now,
      sequenceNumber: 0,
    },
    {
      type: "relationship-add",
      elementId: "product.capability.export::aggregates::product.capability.search",
      layerName: "product",
      after: { source: "product.capability.export", predicate: "aggregates", target: "product.capability.search", layer: "product" },
      timestamp: now,
      sequenceNumber: 1,
    },
  ] as never;
  await storage.save(changeset);
  return changeset.id;
}

describe("element type renames (0.9.0 -> 0.10.0)", () => {
  it("is generated from the change records", () => {
    expect(RELATIONSHIP_REWRITE_TABLE.typeRenames).toEqual({ "product.capability": "product.softwarecapability" });
  });

  it("renames elements, their relationships, references and staged changes", () =>
    withModel(async (root) => {
      const changesetId = await stage(root);
      const result = await upgradeModel(root, { fromVersion: "0.9.0", toVersion: "0.10.0" });
      const migration = result.migration?.applied[0]?.changes;
      expect(migration?.error).toBeUndefined();
      expect(migration?.details?.elementTypeChanges).toEqual([
        { from: "product.capability.search", to: "product.softwarecapability.search", fromType: "product.capability", toType: "product.softwarecapability" },
        { from: "product.capability.discovery", to: "product.softwarecapability.discovery", fromType: "product.capability", toType: "product.softwarecapability" },
      ]);

      const model = await Model.load(root, { lazyLoad: false });
      const product = model.layers.get("product")!;
      const search = product.getElement(SEARCH)!;
      expect(search).toMatchObject({ path: "product.softwarecapability.search", type: "softwarecapability", spec_node_id: "product.softwarecapability" });
      expect(search.attributes).toEqual({ status: "delivered" });
      // An element whose stored id was not a UUID (the model gives it one on load) is renamed too
      expect(product.getElement("product.softwarecapability.discovery")?.type).toBe("softwarecapability");
      expect(product.getElement("product.capability.search")).toBeUndefined();
      expect(product.getElement("product.feature.search-box")?.references).toEqual([
        { source: "product.feature.search-box", target: "product.softwarecapability.search", type: "documents" },
      ]);

      // Relationships follow the paths, and the product rules rewrite fulfills to satisfies
      expect(model.relationships.getAll().map((r) => `${r.source} ${r.predicate} ${r.target}`)).toEqual([
        "product.feature.search-box realizes product.softwarecapability.search",
        "product.softwarecapability.search realizes business.businessfunction.find-information",
        `${SEARCH} satisfies motivation.requirement.find-fast`,
        "application.applicationservice.search-api realizes product.softwarecapability.search",
        "product.softwarecapability.discovery aggregates product.softwarecapability.search",
      ]);
      const validator = new RelationshipValidator();
      await validator.initialize();
      expect((await validator.validateModel(model)).errors).toEqual([]);

      // The layer file is named for the new type
      const files = await import("fs/promises").then((fs) => fs.readdir(join(root, "documentation-robotics", "model", "03_product")));
      expect(files.some((f) => /capability/.test(f) && !/software/.test(f))).toBe(false);

      // The staged changeset names the new type and paths, and commits cleanly
      const staged = await new StagedChangesetStorage(root).load(changesetId);
      expect(staged?.changes.map((c) => c.elementId)).toEqual([
        "product.softwarecapability.export",
        "product.softwarecapability.export::aggregates::product.softwarecapability.search",
      ]);
      expect(staged?.changes[0].after).toMatchObject({ path: "product.softwarecapability.export", spec_node_id: "product.softwarecapability", type: "softwarecapability" });
      const committed = await Model.load(root, { lazyLoad: false });
      await new StagingAreaManager(root, committed).commit(committed, changesetId);
      const after = await Model.load(root, { lazyLoad: false });
      expect(after.layers.get("product")!.getElement("product.softwarecapability.export")?.type).toBe("softwarecapability");
      expect((await validator.validateModel(after)).errors).toEqual([]);
    }));

  it("leaves a model without renamed types untouched", () =>
    withModel(async (root) => {
      const productDir = join(root, "documentation-robotics", "model", "03_product");
      await writeFile(join(productDir, "elements.yaml"), YAML.stringify({ "product.feature.x": { id: "00000000-0000-4000-8000-0000000000e1", path: "product.feature.x", spec_node_id: "product.feature", type: "feature", layer_id: "product", name: "x" } }));
      await writeFile(join(root, "documentation-robotics", "model", "relationships.yaml"), "# Intra-layer relationships\n\n[]\n");
      const result = await upgradeModel(root, { fromVersion: "0.9.0", toVersion: "0.10.0" });
      expect(result.migration?.applied[0]?.changes?.details?.elementTypeChanges).toEqual([]);
      expect(await readFile(join(root, "documentation-robotics", "model", "relationships.yaml"), "utf-8")).toBe("# Intra-layer relationships\n\n[]\n");
    }));
});

describe("rename-type in the rewrite table generator", () => {
  const record = (name: string, at: string, actions: ChangeRecord["actions"]): ChangeRecord => ({ file: name, record: name, applied_at: at, actions });

  it("re-keys and re-targets earlier rules, and records the rename", () => {
    const catalog = loadCatalogTriples();
    const { table } = buildRewriteTable(
      [
        // an earlier record retires a triple naming the old type, and rewrites one onto it
        record("a", "2026-01-01", [
          { action: "delete", from: "product.workflowstep.uses.product.capability", to: null },
          { action: "rename", from: "product.capability.fulfills.motivation.requirement", to: "product.capability.satisfies.motivation.requirement" },
        ]),
        record("b", "2026-01-02", [{ action: "rename-type", from: "product.capability", to: "product.softwarecapability" }]),
      ],
      catalog
    );
    expect(table.typeRenames).toEqual({ "product.capability": "product.softwarecapability" });
    expect(table.triples["product.workflowstep.uses.product.softwarecapability"]).toMatchObject({ to: null, records: ["a", "b"] });
    expect(table.triples["product.softwarecapability.fulfills.motivation.requirement"]).toMatchObject({ to: "product.softwarecapability.satisfies.motivation.requirement", swap: false });
    expect(Object.keys(table.triples).some((k) => k.includes("product.capability."))).toBe(false);
  });

  it("refuses a rename that is not between two layer.type names", () => {
    expect(() => buildRewriteTable([record("c", "2026-01-01", [{ action: "rename-type", from: "capability", to: "product.softwarecapability" }])], loadCatalogTriples())).toThrow(/rename-type|renaming type/);
  });
});

describe("catalog migration on a model already at the current version", () => {
  it("finds the pending changes, applies them without a version change, and is then clean", () =>
    withModel(async (root) => {
      const changesetId = await stage(root);
      const pending = await pendingCatalogMigrations(await Model.load(root, { lazyLoad: false }));
      expect(pending).toMatchObject({ elementTypes: 2, errors: [] });
      expect(pending.relationships).toBeGreaterThan(0);

      const result = await upgradeModel(root, { fromVersion: "0.10.0", toVersion: "0.10.0", catalogOnly: true });
      expect(result.migration?.applied[0]?.changes?.details?.elementTypeChanges).toHaveLength(2);
      expect(result.changesets.rebaselined.map((c) => c.id)).toEqual([changesetId]);

      const model = await Model.load(root, { lazyLoad: false });
      expect(model.manifest.specVersion).toBe("0.10.0");
      const validator = new RelationshipValidator();
      await validator.initialize();
      expect((await validator.validateModel(model)).errors).toEqual([]);
      expect(await pendingCatalogMigrations(model)).toEqual({ elementTypes: 0, retiredAttributes: 0, stagedRetiredAttributes: 0, relationships: 0, stagedRelationships: 0, errors: [] });

      // The staged changeset was renamed too and still commits
      await new StagingAreaManager(root, model).commit(model, changesetId);
      const after = await Model.load(root, { lazyLoad: false });
      expect(after.layers.get("product")!.getElement("product.softwarecapability.export")?.type).toBe("softwarecapability");
    }, "0.10.0"));

  it("gives a dry run the relationships apply writes (committedRelationshipsAfter, for wouldOrphan)", () =>
    withModel(async (root) => {
      const dry = await applyCatalogMigrations(await Model.load(root, { lazyLoad: false }), { dryRun: true });
      const after = dry.details.committedRelationshipsAfter;
      expect(after).toBeDefined();
      expect(after!.some((rel) => rel.predicate === "fulfills")).toBe(false);
      expect(after!.some((rel) => rel.predicate === "satisfies")).toBe(true);

      await upgradeModel(root, { fromVersion: "0.10.0", toVersion: "0.10.0", catalogOnly: true });
      const written = YAML.parse(
        await readFile(join(root, "documentation-robotics", "model", "relationships.yaml"), "utf-8")
      ) as Array<{ predicate: string }>;
      expect(after!.map((rel) => rel.predicate).sort()).toEqual(written.map((rel) => rel.predicate).sort());
    }, "0.10.0"));

  it("reports nothing pending, and changes nothing, on a model in line with the catalog", () =>
    withModel(async (root) => {
      await upgradeModel(root, { fromVersion: "0.10.0", toVersion: "0.10.0", catalogOnly: true });
      const relationshipsPath = join(root, "documentation-robotics", "model", "relationships.yaml");
      const once = await readFile(relationshipsPath, "utf-8");
      const model = await Model.load(root, { lazyLoad: false });
      expect(await pendingCatalogMigrations(model)).toEqual({ elementTypes: 0, retiredAttributes: 0, stagedRetiredAttributes: 0, relationships: 0, stagedRelationships: 0, errors: [] });
      await upgradeModel(root, { fromVersion: "0.10.0", toVersion: "0.10.0", catalogOnly: true });
      expect(await readFile(relationshipsPath, "utf-8")).toBe(once);
    }, "0.10.0"));
});
