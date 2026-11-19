/**
 * The upgrade record (#1164): the relationships a spec migration dropped, written as a staged
 * changeset that names each one, never lands, and survives later migrations.
 */
import { describe, it, expect } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import YAML from "yaml";
import { Model } from "../../../src/core/model.js";
import { upgradeModel } from "../../../src/core/model-upgrade.js";
import { applyCatalogMigrations } from "../../../src/core/catalog-migration.js";
import type { Relationship } from "../../../src/core/relationships.js";
import type { StagedChange } from "../../../src/core/changeset.js";
import { originLabel } from "../../../src/core/changeset.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import { driftStatus } from "../../../src/core/changeset-drift-status.js";
import {
  allowedActions,
  isRecordPurpose,
  purposeOf,
  readPurpose,
  RecordLandingError,
  UpgradeRecordLandingError,
} from "../../../src/core/changeset-purpose.js";
import { readOrigin } from "../../../src/core/changeset-review.js";
import { ChangesetGraph } from "../../../src/core/changeset-graph.js";
import {
  catalogRoutesFor,
  describeDropRecord,
  droppedRelationshipsOf,
  nextDropRecordName,
  planDropRecord,
  summarizeDropsByType,
  type DroppedRelationship,
} from "../../../src/core/upgrade-drop-record.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";

const VERSION = getCliBundledSpecVersion();
const RECORD_NAME = `upgrade-drops-${VERSION}`;

const OPERATION = "api.operation.list-orders";
const OTHER_OPERATION = "api.operation.get-order";
const RESPONSE = "api.response.ok";
const TAG = "api.tag.orders";
const DATABASE = "data-store.database.orders-db";
const COMPONENT = "application.applicationcomponent.order-repository";

const ELEMENTS: Record<string, string[]> = {
  "05_application": [COMPONENT],
  "07_api": [OPERATION, OTHER_OPERATION, RESPONSE, TAG],
  "09_data-store": [DATABASE],
};

const rel = (source: string, predicate: string, target: string, properties?: Record<string, unknown>): Relationship => {
  const layer = source.split(".")[0];
  const targetLayer = target.split(".")[0];
  return {
    source,
    predicate,
    target,
    layer,
    ...(targetLayer !== layer ? { targetLayer } : {}),
    ...(properties ? { properties } : {}),
  };
};

/** Retired with no replacement, and nothing in the catalog between an operation and a response */
const DELIVERS = rel(OPERATION, "delivers", RESPONSE, { status: 200 });
const DELIVERS_TOO = rel(OTHER_OPERATION, "delivers", RESPONSE);
/** Retired with no replacement; the catalog still has operation references tag */
const AGGREGATES = rel(TAG, "aggregates", OPERATION);
/** Retired, with a route: rewritten, never recorded */
const SERVES = rel(DATABASE, "serves", COMPONENT);
/** Still in the catalog */
const REFERENCES = rel(OPERATION, "references", TAG);

const key = (r: { source: string; predicate: string; target: string }) => `${r.source}::${r.predicate}::${r.target}`;

async function writeModel(root: string, relationships: Relationship[]): Promise<void> {
  const modelDir = join(root, "documentation-robotics", "model");
  await mkdir(modelDir, { recursive: true });
  await writeFile(
    join(modelDir, "manifest.yaml"),
    YAML.stringify({
      version: "1.0.0",
      schema: "documentation-robotics-v1",
      spec_version: VERSION,
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      project: { name: "upgrade-drop-record-test", version: "1.0.0" },
    })
  );
  for (const [dir, paths] of Object.entries(ELEMENTS)) {
    await mkdir(join(modelDir, dir), { recursive: true });
    const doc: Record<string, unknown> = {};
    for (const path of paths) {
      const [layerId, type, name] = path.split(".");
      doc[path] = { id: crypto.randomUUID(), path, spec_node_id: `${layerId}.${type}`, type, layer_id: layerId, name };
    }
    await writeFile(join(modelDir, dir, "elements.yaml"), YAML.stringify(doc));
  }
  await writeFile(join(modelDir, "relationships.yaml"), YAML.stringify(relationships));
}

const committedRelationships = async (root: string): Promise<Relationship[]> =>
  YAML.parse(await readFile(join(root, "documentation-robotics", "model", "relationships.yaml"), "utf-8"));

/** Run a test against its own on-disk model (the unit suite runs tests concurrently) */
async function withModel(relationships: Relationship[], test: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dr-upgrade-drop-record-"));
  try {
    await writeModel(root, relationships);
    await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const upgrade = (root: string) => upgradeModel(root, { fromVersion: VERSION, toVersion: VERSION, catalogOnly: true });

async function managerFor(root: string): Promise<{ model: Model; manager: StagingAreaManager; storage: StagedChangesetStorage }> {
  const model = await Model.load(root, { lazyLoad: false });
  return { model, manager: new StagingAreaManager(model.rootPath, model), storage: new StagedChangesetStorage(model.rootPath) };
}

const stagedAdd = (r: Relationship) => ({
  type: "relationship-add" as const,
  elementId: key(r),
  layerName: r.layer,
  after: r as unknown as Record<string, unknown>,
  timestamp: "2026-01-01T00:00:00.000Z",
});

describe("the upgrade-record purpose", () => {
  it("is a declared purpose, a record, and offers only discard", () => {
    expect(readPurpose({ purpose: "upgrade-record" })).toEqual({ purpose: "upgrade-record" });
    expect(isRecordPurpose("upgrade-record")).toBe(true);
    expect(isRecordPurpose("verification")).toBe(true);
    expect(isRecordPurpose("plan")).toBe(false);
    expect(allowedActions("upgrade-record", "staged")).toEqual(["discard"]);
    expect(allowedActions("upgrade-record", "discarded")).toEqual([]);
    expect(readOrigin({ kind: "upgrade", detail: "spec 0.10.0 -> 0.13.0" })).toEqual({
      kind: "upgrade",
      detail: "spec 0.10.0 -> 0.13.0",
    });
  });

  it("labels a change the upgrade decided by its rule", () => {
    expect(originLabel({ by: "upgrade", rule: "api.operation.delivers.api.response retired by cs-177ff609" })).toBe(
      "upgrade api.operation.delivers.api.response retired by cs-177ff609"
    );
  });
});

describe("catalogRoutesFor", () => {
  it("lists the relationship types the catalog has between the two element types, either way round", () => {
    // What the three restored routes were found by
    expect(catalogRoutesFor("data-store.database.serves.application.applicationcomponent")).toContainEqual({
      source: "application.applicationcomponent",
      predicate: "accesses",
      target: "data-store.database",
      swapped: true,
    });
    expect(catalogRoutesFor("api.tag.aggregates.api.operation")).toContainEqual({
      source: "api.operation",
      predicate: "references",
      target: "api.tag",
      swapped: true,
    });
    // Same direction comes first, and is not marked swapped
    const sameWay = catalogRoutesFor("api.operation.frobnicates.api.tag");
    expect(sameWay[0]).toEqual({ source: "api.operation", predicate: "references", target: "api.tag", swapped: false });
  });

  it("is empty when the catalog has nothing between them, and lists a self-type once", () => {
    expect(catalogRoutesFor("api.operation.delivers.api.response")).toEqual([]);
    expect(catalogRoutesFor("motivation.nosuchtype.serves.testing.nosuchtype")).toEqual([]);
    const self = catalogRoutesFor("motivation.requirement.frobnicates.motivation.requirement");
    expect(self.length).toBeGreaterThan(0);
    expect(self.every((route) => !route.swapped)).toBe(true);
    expect(() => catalogRoutesFor("not-a-triple")).toThrow("is not a {layer}.{type}.{predicate}.{layer}.{type}");
  });
});

describe("droppedRelationshipsOf", () => {
  const dropped = (r: Relationship, type: string) => ({
    action: "dropped" as const,
    before: { source: r.source, predicate: r.predicate, target: r.target },
    rules: [`${type} -> (removed)`],
    dropped: { type, records: ["cs-1"], relationship: r },
  });

  it("takes the model's drops and the staged adds dropped from changesets, each relationship once", () => {
    const type = "api.operation.delivers.api.response";
    const drops = droppedRelationshipsOf({
      relationshipChanges: [
        dropped(DELIVERS, type),
        { action: "rewritten", before: SERVES, after: SERVES, rules: [] },
        { action: "dropped-duplicate", before: SERVES, after: SERVES, rules: [] },
      ],
      stagedRelationshipChanges: [
        // A staged delete of a relationship the model's migration dropped: already recorded
        { ...dropped(DELIVERS, type), changeset: "plan-1", stagedAs: "relationship-delete" },
        // A staged add of the same relationship: also already recorded
        { ...dropped(DELIVERS, type), changeset: "plan-1", stagedAs: "relationship-add" },
        // A staged add only the changeset had
        { ...dropped(DELIVERS_TOO, type), changeset: "plan-1", stagedAs: "relationship-add" },
        // A staged delete of something the model never had recorded as dropped: nothing was lost
        { ...dropped(AGGREGATES, "api.tag.aggregates.api.operation"), changeset: "plan-1", stagedAs: "relationship-delete" },
      ],
    });
    expect(drops).toEqual([
      { relationship: DELIVERS, retiredType: type, records: ["cs-1"] },
      { relationship: DELIVERS_TOO, retiredType: type, records: ["cs-1"], stagedIn: "plan-1" },
    ]);
    expect(droppedRelationshipsOf({})).toEqual([]);
  });

  it("is summarized by type, most first, with the routes, and described for the reader", () => {
    const drops: DroppedRelationship[] = [
      { relationship: AGGREGATES, retiredType: "api.tag.aggregates.api.operation", records: ["cs-1"] },
      { relationship: DELIVERS, retiredType: "api.operation.delivers.api.response", records: ["cs-1"] },
      { relationship: DELIVERS_TOO, retiredType: "api.operation.delivers.api.response", records: ["cs-1"], stagedIn: "plan-1" },
    ];
    const byType = summarizeDropsByType(drops);
    expect(byType.map((entry) => [entry.retiredType, entry.count, entry.staged, entry.routes.length > 0])).toEqual([
      ["api.operation.delivers.api.response", 2, 1, false],
      ["api.tag.aggregates.api.operation", 1, 0, true],
    ]);
    expect(byType[0]).toMatchObject({ sourceType: "api.operation", predicate: "delivers", targetType: "api.response" });

    const description = describeDropRecord({ fromVersion: "0.10.0", toVersion: "0.13.0" }, byType);
    expect(description).toContain("Record of the 3 relationship(s) the upgrade dropped when it moved the model from spec 0.10.0 to 0.13.0");
    expect(description).toContain("1 of them were staged adds the upgrade removed from other changesets");
    expect(description).toContain("never lands");
    expect(description).toContain(
      "- 2 x api.operation --[delivers]--> api.response: the catalog has no relationship type between these two element types"
    );
    expect(description).toContain(
      "- 1 x api.tag --[aggregates]--> api.operation: the catalog has api.operation --[references]--> api.tag (ends swapped)"
    );
    expect(describeDropRecord({ fromVersion: "0.13.0", toVersion: "0.13.0" }, byType)).toContain(
      "when it applied catalog changes to the model (spec 0.13.0)"
    );
  });
});

describe("an upgrade that drops relationships", () => {
  it("writes one staged record naming each one, what retired it, and the relationship as it was", () =>
    withModel([DELIVERS, AGGREGATES, SERVES, REFERENCES], async (root) => {
      const result = await upgrade(root);

      // The model: two dropped, one rewritten with ends swapped, one untouched
      expect(await committedRelationships(root)).toEqual([rel(COMPONENT, "accesses", DATABASE), REFERENCES]);

      expect(result.dropRecord).toMatchObject({ name: RECORD_NAME, count: 2 });
      expect(result.dropRecord!.error).toBeUndefined();
      expect(result.dropRecord!.byType.map((entry) => entry.retiredType).sort()).toEqual([
        "api.operation.delivers.api.response",
        "api.tag.aggregates.api.operation",
      ]);

      const { manager, storage } = await managerFor(root);
      const changesets = await storage.list();
      expect(changesets).toHaveLength(1);
      const record = changesets[0];
      expect(record.id).toBe(result.dropRecord!.id!);
      expect(record.name).toBe(RECORD_NAME);
      expect(record.status).toBe("staged");
      expect(record.purpose).toBe("upgrade-record");
      expect(record.origin).toEqual({ kind: "upgrade", detail: `spec ${VERSION} -> ${VERSION}` });
      expect(await purposeOf(root, record)).toEqual({ purpose: "upgrade-record", declared: true });
      expect(record.description).toContain("- 1 x api.operation --[delivers]--> api.response");
      expect(record.description).toContain("api.operation --[references]--> api.tag (ends swapped)");
      // It is not made active: later writes don't stage into a record
      expect(await manager.getActiveId()).toBeNull();

      expect(record.stats).toEqual({ additions: 0, modifications: 0, deletions: 2 });
      const changes = record.changes as StagedChange[];
      expect(changes.map((c) => [c.type, c.elementId, c.layerName, c.sequenceNumber])).toEqual([
        ["relationship-delete", key(DELIVERS), "api", 0],
        ["relationship-delete", key(AGGREGATES), "api", 1],
      ]);
      // The whole relationship, properties included, to restore from
      expect(changes[0].before).toEqual(DELIVERS as unknown as Record<string, unknown>);
      expect(changes[0].after).toBeUndefined();
      expect(changes[0].origin?.by).toBe("upgrade");
      expect(changes[0].origin?.rule).toMatch(/^api\.operation\.delivers\.api\.response retired by \S+/);
      expect(changes[1].origin?.rule).toMatch(/^api\.tag\.aggregates\.api\.operation retired by \S+/);
    }));

  it("writes none when nothing is dropped, and no second one when run again", () =>
    withModel([SERVES, REFERENCES], async (root) => {
      expect((await upgrade(root)).dropRecord).toBeUndefined();
      expect(await (await managerFor(root)).storage.list()).toEqual([]);

      // Now drop something, then run twice more
      const relationships = await committedRelationships(root);
      await writeFile(
        join(root, "documentation-robotics", "model", "relationships.yaml"),
        YAML.stringify([...relationships, DELIVERS])
      );
      expect((await upgrade(root)).dropRecord?.name).toBe(RECORD_NAME);
      expect((await upgrade(root)).dropRecord).toBeUndefined();
      expect((await upgrade(root)).dropRecord).toBeUndefined();
      expect((await (await managerFor(root)).storage.list()).map((c) => c.name)).toEqual([RECORD_NAME]);
    }));

  it("leaves an earlier record as it is, and names a later one apart", () =>
    withModel([DELIVERS], async (root) => {
      const first = (await upgrade(root)).dropRecord!;
      const { storage } = await managerFor(root);
      const before = await readFile(join(storage.getChangesetPath(first.id!), "changes.yaml"), "utf-8");

      // The model picks up another relationship of a retired type; the migration runs again
      await writeFile(join(root, "documentation-robotics", "model", "relationships.yaml"), YAML.stringify([AGGREGATES]));
      const model = await Model.load(root, { lazyLoad: false });
      const dryRun = await applyCatalogMigrations(model, { dryRun: true });
      // The record's own staged deletes are not counted as staged changes to drop
      expect(dryRun.details.stagedRelationshipChanges).toEqual([]);
      expect(await nextDropRecordName(root, VERSION)).toBe(`${RECORD_NAME}-2`);

      const second = (await upgrade(root)).dropRecord!;
      expect(second.name).toBe(`${RECORD_NAME}-2`);
      expect(await readFile(join(storage.getChangesetPath(first.id!), "changes.yaml"), "utf-8")).toBe(before);
      expect((await storage.load(first.id!))!.changes.map((c) => c.elementId)).toEqual([key(DELIVERS)]);
      expect((await storage.load(second.id!))!.changes.map((c) => c.elementId)).toEqual([key(AGGREGATES)]);
    }));

  it("records a staged add it removes from another changeset, naming that changeset", () =>
    withModel([REFERENCES], async (root) => {
      const { manager, storage } = await managerFor(root);
      const plan = await manager.create("plan", "stages a relationship of a retired type");
      await storage.addChanges(plan.id, [stagedAdd(DELIVERS), stagedAdd(REFERENCES)]);

      const preview = await applyCatalogMigrations(await Model.load(root, { lazyLoad: false }), { dryRun: true });
      expect(await planDropRecord(root, VERSION, droppedRelationshipsOf(preview.details))).toMatchObject({
        name: RECORD_NAME,
        count: 1,
      });
      expect((await storage.list()).map((c) => c.name)).toEqual(["plan"]);

      const result = await upgrade(root);
      expect(result.dropRecord).toMatchObject({ name: RECORD_NAME, count: 1 });
      expect(result.dropRecord!.byType[0]).toMatchObject({ count: 1, staged: 1 });

      // The plan lost the add; the record has it
      expect((await storage.load(plan.id))!.changes.map((c) => c.elementId)).toEqual([key(REFERENCES)]);
      const record = (await storage.load(result.dropRecord!.id!))!;
      expect(record.changes).toHaveLength(1);
      expect(record.changes[0]).toMatchObject({ type: "relationship-delete", elementId: key(DELIVERS), before: DELIVERS });
      expect(record.changes[0].origin?.rule).toContain(`; a staged add removed from changeset ${plan.id}`);
      expect(record.description).toContain("1 of them were staged adds the upgrade removed from other changesets");
    }));
});

describe("an upgrade record", () => {
  it("is never landed, with force or without, and base drift does not apply to it", () =>
    withModel([DELIVERS, REFERENCES], async (root) => {
      const recordId = (await upgrade(root)).dropRecord!.id!;
      const { model, manager, storage } = await managerFor(root);
      const record = (await storage.load(recordId))!;

      const refusal = await manager.landingRefusal(record);
      expect(refusal).toBeInstanceOf(UpgradeRecordLandingError);
      expect(refusal).toBeInstanceOf(RecordLandingError);
      expect(refusal!.message).toContain(`Changeset '${RECORD_NAME}' is an upgrade record`);
      expect(refusal!.fullText).toContain("To restore a dropped relationship");

      for (const options of [{}, { force: true }, { dryRun: true }, { force: true, validate: false }]) {
        await expect(manager.commit(model, recordId, options)).rejects.toBeInstanceOf(UpgradeRecordLandingError);
      }
      expect(await committedRelationships(root)).toEqual([REFERENCES]);
      expect((await storage.load(recordId))!.status).toBe("staged");

      expect(await driftStatus(manager, { changeset: record, purpose: "upgrade-record" })).toEqual({
        state: "not-applicable",
        blocksCommit: false,
        message: "An upgrade record is never landed, so base drift does not apply to it.",
      });
    }));

  it("changes nothing when its deletes are applied all the same (a dr that does not know the purpose)", () =>
    withModel([DELIVERS, REFERENCES], async (root) => {
      const recordId = (await upgrade(root)).dropRecord!.id!;
      const { storage } = await managerFor(root);
      // An older dr reads an unknown purpose as none and infers `plan`: the same staged deletes, landed
      const metadataPath = join(storage.getChangesetPath(recordId), "metadata.yaml");
      const metadata = YAML.parse(await readFile(metadataPath, "utf-8"));
      delete metadata.purpose;
      delete metadata.origin;
      await writeFile(metadataPath, YAML.stringify(metadata));

      const { model, manager } = await managerFor(root);
      expect((await manager.purposeOf((await storage.load(recordId))!)).purpose).toBe("plan");
      const result = await manager.commit(model, recordId, { validate: false });
      expect(result.failed).toBe(0);
      expect(await committedRelationships(root)).toEqual([REFERENCES]);
    }));

  it("projects onto the model without touching it: its deletes name relationships the model no longer has", () =>
    withModel([DELIVERS, REFERENCES], async (root) => {
      const recordId = (await upgrade(root)).dropRecord!.id!;
      const { model, storage } = await managerFor(root);
      const record = (await storage.load(recordId))!;
      const graph = await ChangesetGraph.build(model, record);
      const statuses = graph.relationships().map((r) => `${r.source} ${r.predicate} ${r.target}: ${r.status}`);
      expect(statuses).toEqual([`${OPERATION} references ${TAG}: unchanged`]);
      expect(graph.changedRelationships()).toEqual([]);
      expect(graph.changedElements()).toEqual([]);
    }));

  it("can be discarded, which removes it and frees its name", () =>
    withModel([DELIVERS], async (root) => {
      const recordId = (await upgrade(root)).dropRecord!.id!;
      const { manager, storage } = await managerFor(root);
      expect(await nextDropRecordName(root, VERSION)).toBe(`${RECORD_NAME}-2`);
      await manager.discard(recordId);
      expect(await storage.load(recordId)).toBeNull();
      expect(await nextDropRecordName(root, VERSION)).toBe(RECORD_NAME);
      expect(await committedRelationships(root)).toEqual([]);
    }));
});
