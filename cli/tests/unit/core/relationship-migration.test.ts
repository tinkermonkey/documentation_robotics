import { describe, it, expect } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import YAML from "yaml";
import { MigrationRegistry } from "../../../src/core/migration-registry.js";
import { Model } from "../../../src/core/model.js";
import { upgradeModel } from "../../../src/core/model-upgrade.js";
import type { Relationship } from "../../../src/core/relationships.js";
import type { Change } from "../../../src/core/changeset.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { StagedChangesetStorage } from "../../../src/core/staged-changeset-storage.js";
import {
  rewriteRelationships,
  rewriteStagedChangeset,
  type ElementResolver,
  type RelationshipRewriteTable,
  type StagedRelationshipRewriteChange
} from "../../../src/core/relationship-migration.js";
import { RELATIONSHIP_REWRITE_TABLE } from "../../../src/core/relationship-migration-table.js";
import { RelationshipValidator } from "../../../src/validators/relationship-schema-validator.js";
import {
  buildRewriteTable,
  loadCatalogTriples,
  loadChangeRecords
} from "../../../scripts/generate-relationship-migration.js";

interface TestElement {
  uuid: string;
  path: string;
}

/** Elements of the 0.9.0 test model, by layer directory */
const LAYERS: Record<string, TestElement[]> = {
  "04_security": [
    { uuid: "00000000-0000-4000-8000-000000000001", path: "security.countermeasure.rate-limiting" }
  ],
  "05_application": [
    {
      uuid: "00000000-0000-4000-8000-000000000011",
      path: "application.applicationprocess.place-order"
    },
    { uuid: "00000000-0000-4000-8000-000000000012", path: "application.dataobject.order" },
    {
      uuid: "00000000-0000-4000-8000-000000000013",
      path: "application.applicationservice.ordering"
    },
    {
      uuid: "00000000-0000-4000-8000-000000000014",
      path: "application.applicationcomponent.order-service"
    },
    {
      uuid: "00000000-0000-4000-8000-000000000015",
      path: "application.applicationfunction.price-order"
    }
  ],
  "06_technology": [
    { uuid: "00000000-0000-4000-8000-000000000021", path: "technology.systemsoftware.waf" }
  ],
  "07_api": [
    { uuid: "00000000-0000-4000-8000-000000000031", path: "api.operation.create-order" },
    { uuid: "00000000-0000-4000-8000-000000000032", path: "api.requestbody.create-order-body" },
    { uuid: "00000000-0000-4000-8000-000000000033", path: "api.parameter.order-id" },
    { uuid: "00000000-0000-4000-8000-000000000034", path: "api.securityscheme.oauth" },
    { uuid: "00000000-0000-4000-8000-000000000035", path: "api.oauthflows.oauth-flows" }
  ],
  "10_ux": [
    { uuid: "00000000-0000-4000-8000-000000000041", path: "ux.stateaction.submit-order" },
    { uuid: "00000000-0000-4000-8000-000000000042", path: "ux.stateactiontemplate.submit" }
  ]
};

const rel = (
  source: string,
  predicate: string,
  target: string,
  layer: string,
  targetLayer?: string
): Relationship => ({
  source,
  predicate,
  target,
  layer,
  ...(targetLayer ? { targetLayer } : {}),
  category: "structural"
});

/** relationships.yaml as a 0.9.0 model recorded it */
const RELATIONSHIPS_0_9_0: Relationship[] = [
  // implements is retired: becomes realizes on the same pair
  rel(
    "technology.systemsoftware.waf",
    "implements",
    "security.countermeasure.rate-limiting",
    "technology",
    "security"
  ),
  // renamed predicates (same pair)
  rel(
    "application.applicationprocess.place-order",
    "depends-on",
    "application.dataobject.order",
    "application"
  ),
  rel(
    "application.applicationprocess.place-order",
    "delivers-value",
    "application.applicationservice.ordering",
    "application"
  ),
  // reverse-direction twin: the retired direction becomes the catalog direction, ends swapped
  rel("api.requestbody.create-order-body", "serves", "api.operation.create-order", "api"),
  // reverse-direction twin whose catalog direction is already recorded (by UUID): dropped
  rel("api.parameter.order-id", "references", "api.operation.create-order", "api"),
  rel("00000000-0000-4000-8000-000000000031", "aggregates", "api.parameter.order-id", "api"),
  // reversed schema whose 4-part id was corrected (a "create" row): ends swapped
  rel("api.oauthflows.oauth-flows", "serves", "api.securityscheme.oauth", "api"),
  // plain duplicate: assigned-to sat beside composes on the same pair
  rel(
    "application.applicationcomponent.order-service",
    "assigned-to",
    "application.applicationfunction.price-order",
    "application"
  ),
  rel(
    "application.applicationcomponent.order-service",
    "composes",
    "application.applicationfunction.price-order",
    "application"
  ),
  // two retired relationships that both become stateaction realizes stateactiontemplate
  rel("ux.stateaction.submit-order", "specializes", "ux.stateactiontemplate.submit", "ux"),
  rel("ux.stateactiontemplate.submit", "provides", "ux.stateaction.submit-order", "ux"),
  // still valid: untouched
  rel(
    "application.applicationservice.ordering",
    "serves",
    "application.applicationprocess.place-order",
    "application"
  )
];

async function writeModel(root: string): Promise<void> {
  const modelDir = join(root, "documentation-robotics", "model");
  await mkdir(modelDir, { recursive: true });
  await writeFile(
    join(modelDir, "manifest.yaml"),
    YAML.stringify({
      version: "1.0.0",
      schema: "documentation-robotics-v1",
      spec_version: "0.9.0",
      // Model.load stamps the current time on a manifest without these, which changes the
      // model's snapshot (and so a staged changeset's drift check) on every load
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      project: { name: "relationship-migration-test", version: "1.0.0" }
    })
  );

  for (const [dir, elements] of Object.entries(LAYERS)) {
    await mkdir(join(modelDir, dir), { recursive: true });
    const doc: Record<string, unknown> = {};
    for (const { uuid, path } of elements) {
      const [layerId, type, name] = path.split(".");
      doc[path] = {
        id: uuid,
        path,
        spec_node_id: `${layerId}.${type}`,
        type,
        layer_id: layerId,
        name
      };
    }
    await writeFile(join(modelDir, dir, "elements.yaml"), YAML.stringify(doc));
  }

  await writeFile(
    join(modelDir, "relationships.yaml"),
    `# Intra-layer relationships\n\n${YAML.stringify(RELATIONSHIPS_0_9_0)}`
  );
}

const triples = (rels: Relationship[]) => rels.map((r) => `${r.source} ${r.predicate} ${r.target}`);

/** Run a test against its own on-disk 0.9.0 model (the unit suite runs tests concurrently) */
async function withModel(test: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dr-relationship-migration-"));
  try {
    await writeModel(root);
    await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("relationship catalog migration (0.9.0 -> 0.10.0)", () => {
  it("rewrites retired relationships so the model validates against the current catalog", () =>
    withModel(async (root) => {
      const validator = new RelationshipValidator();
      await validator.initialize();

      // The fixture really is affected: the retired triples do not validate before the upgrade
      const before = await Model.load(root, { lazyLoad: false });
      const beforeResult = await validator.validateModel(before);
      expect(beforeResult.errors.length).toBe(9);
      expect(beforeResult.errors.every((e) => e.message.startsWith("No schema found"))).toBe(true);

      const registry = new MigrationRegistry();
      const result = await registry.applyMigrations(before, {
        fromVersion: "0.9.0",
        toVersion: "0.10.0"
      });
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].changes?.error).toBeUndefined();
      expect(result.applied[0].changes?.filesModified).toBe(1);

      const after = await Model.load(root, { lazyLoad: false });
      const afterResult = await validator.validateModel(after);
      expect(afterResult.errors).toEqual([]);

      const migrated = after.relationships.getAll();
      expect(triples(migrated)).toEqual([
        "technology.systemsoftware.waf realizes security.countermeasure.rate-limiting",
        "application.applicationprocess.place-order accesses application.dataobject.order",
        "application.applicationprocess.place-order realizes application.applicationservice.ordering",
        "api.operation.create-order aggregates api.requestbody.create-order-body",
        "00000000-0000-4000-8000-000000000031 aggregates api.parameter.order-id",
        "api.securityscheme.oauth composes api.oauthflows.oauth-flows",
        "application.applicationcomponent.order-service composes application.applicationfunction.price-order",
        "ux.stateaction.submit-order realizes ux.stateactiontemplate.submit",
        "application.applicationservice.ordering serves application.applicationprocess.place-order"
      ]);

      // No two relationships name the same pair and predicate
      expect(new Set(triples(migrated)).size).toBe(migrated.length);

      // Cross-layer metadata survives; a swap within one layer stays intra-layer
      const realizes = migrated.find(
        (r) => r.predicate === "realizes" && r.source === "technology.systemsoftware.waf"
      );
      expect(realizes).toMatchObject({ layer: "technology", targetLayer: "security" });
      const aggregates = migrated.find((r) => r.target === "api.requestbody.create-order-body");
      expect(aggregates?.layer).toBe("api");
      expect(aggregates?.targetLayer).toBeUndefined();

      const changes = result.applied[0].changes?.details?.relationshipChanges as Array<{
        action: string;
      }>;
      expect(changes.filter((c) => c.action === "rewritten")).toHaveLength(6);
      expect(changes.filter((c) => c.action === "dropped-duplicate")).toHaveLength(3);
      expect(before.manifest.specVersion).toBe("0.10.0");
    }));

  it("leaves relationships.yaml untouched when nothing is affected", () =>
    withModel(async (root) => {
      const path = join(root, "documentation-robotics", "model", "relationships.yaml");
      const untouched = `# Intra-layer relationships\n\n${YAML.stringify([RELATIONSHIPS_0_9_0.at(-1)])}`;
      await writeFile(path, untouched);

      const model = await Model.load(root, { lazyLoad: false });
      const result = await new MigrationRegistry().applyMigrations(model, {
        fromVersion: "0.9.0",
        toVersion: "0.10.0"
      });

      expect(result.applied[0].changes?.filesModified).toBe(0);
      expect(await readFile(path, "utf-8")).toBe(untouched);
    }));

  it("is idempotent", () =>
    withModel(async (root) => {
      const model = await Model.load(root, { lazyLoad: false });
      const registry = new MigrationRegistry();
      await registry.applyMigrations(model, { fromVersion: "0.9.0", toVersion: "0.10.0" });
      const path = join(root, "documentation-robotics", "model", "relationships.yaml");
      const once = await readFile(path, "utf-8");

      const again = await registry.applyMigrations(await Model.load(root, { lazyLoad: false }), {
        fromVersion: "0.9.0",
        toVersion: "0.10.0"
      });
      expect(again.applied[0].changes?.filesModified).toBe(0);
      expect(await readFile(path, "utf-8")).toBe(once);
    }));
});

/** A staged add of an element that exists only in the changeset, shaped like Element.toJSON() */
const elementAdd = (
  uuid: string,
  path: string,
  attributes?: Record<string, unknown>
): Omit<Change, "timestamp"> => {
  const [layerId, type, name] = path.split(".");
  return {
    type: "add",
    elementId: path,
    layerName: layerId,
    after: {
      id: uuid,
      path,
      spec_node_id: `${layerId}.${type}`,
      type,
      layer_id: layerId,
      name,
      ...(attributes && { attributes })
    }
  };
};

const relationshipKey = (r: { source: string; predicate: string; target: string }) =>
  `${r.source}::${r.predicate}::${r.target}`;

const relationshipAdd = (r: Relationship): Omit<Change, "timestamp"> => ({
  type: "relationship-add",
  elementId: relationshipKey(r),
  layerName: r.layer,
  after: { ...r }
});

const relationshipDelete = (r: Relationship): Omit<Change, "timestamp"> => ({
  type: "relationship-delete",
  elementId: relationshipKey(r),
  layerName: r.layer,
  before: { ...r }
});

/** Stage changes in a new changeset on the 0.9.0 model at root, the way the CLI records them */
async function stageChangeset(
  root: string,
  changes: Array<Omit<Change, "timestamp">>
): Promise<string> {
  const model = await Model.load(root, { lazyLoad: false });
  const staging = new StagingAreaManager(root, model);
  const changeset = await staging.create("staged under 0.9.0");
  await staging.setActive(changeset.id);
  for (const change of changes) {
    await staging.stage(changeset.id, change);
  }
  return changeset.id;
}

/** Run the 0.9.0 -> 0.10.0 upgrade of the model data the way `dr upgrade` does */
async function upgrade(root: string): Promise<StagedRelationshipRewriteChange[]> {
  const { migration } = await upgradeModel(root, { fromVersion: "0.9.0", toVersion: "0.10.0" });
  const changes = migration!.applied[0].changes;
  expect(changes?.error).toBeUndefined();
  return changes?.details?.stagedRelationshipChanges as StagedRelationshipRewriteChange[];
}

/** Commit a changeset after the upgrade, without --force, and reload the model from disk */
async function commit(root: string, changesetId: string): Promise<Model> {
  const model = await Model.load(root, { lazyLoad: false });
  await new StagingAreaManager(root, model).commit(model, changesetId);
  return Model.load(root, { lazyLoad: false });
}

describe("relationship catalog migration of staged changesets (0.9.0 -> 0.10.0)", () => {
  it("rewrites staged relationship adds so the committed changeset validates", () =>
    withModel(async (root) => {
      const gateway = "technology.systemsoftware.api-gateway";
      const body = "api.requestbody.update-order-body";
      const changesetId = await stageChangeset(root, [
        elementAdd("00000000-0000-4000-8000-000000000051", gateway, { softwareType: "middleware" }),
        elementAdd("00000000-0000-4000-8000-000000000052", body),
        // implements is retired: becomes realizes on the same pair
        relationshipAdd(
          rel(gateway, "implements", "security.countermeasure.rate-limiting", "technology", "security")
        ),
        // retired direction, from an element only the changeset adds: ends swap
        relationshipAdd(rel(body, "serves", "api.operation.create-order", "api"))
      ]);

      // The staged relationships fail validation against the 0.10.0 catalog before the upgrade
      const validator = new RelationshipValidator();
      await validator.initialize();
      const before = await Model.load(root, { lazyLoad: false });
      const beforeErrors = (await validator.validateModel(before)).errors.map((e) => e.message);
      expect(beforeErrors.filter((m) => m.includes(gateway) || m.includes(body))).toHaveLength(2);

      const report = await upgrade(root);
      expect(report).toMatchObject([
        {
          changeset: changesetId,
          stagedAs: "relationship-add",
          action: "rewritten",
          before: { source: gateway, predicate: "implements", target: "security.countermeasure.rate-limiting" },
          after: { source: gateway, predicate: "realizes", target: "security.countermeasure.rate-limiting" },
          rules: [
            "technology.systemsoftware.implements.security.countermeasure -> technology.systemsoftware.realizes.security.countermeasure"
          ]
        },
        {
          changeset: changesetId,
          stagedAs: "relationship-add",
          action: "rewritten",
          after: { source: "api.operation.create-order", predicate: "aggregates", target: body },
          rules: ["api.requestbody.serves.api.operation -> api.operation.aggregates.api.requestbody"]
        }
      ]);

      // The changeset on disk carries the rewritten relationships under matching keys
      const staged = await new StagedChangesetStorage(root).load(changesetId);
      expect(
        staged!.changes.map((c) => ({ type: c.type, elementId: c.elementId, layerName: c.layerName }))
      ).toEqual([
        { type: "add", elementId: gateway, layerName: "technology" },
        { type: "add", elementId: body, layerName: "api" },
        {
          type: "relationship-add",
          elementId: `${gateway}::realizes::security.countermeasure.rate-limiting`,
          layerName: "technology"
        },
        {
          type: "relationship-add",
          elementId: `api.operation.create-order::aggregates::${body}`,
          layerName: "api"
        }
      ]);
      expect(staged!.changes[2].after).toMatchObject({ layer: "technology", targetLayer: "security" });

      const after = await commit(root, changesetId);
      expect((await validator.validateModel(after)).errors).toEqual([]);
      const migrated = triples(after.relationships.getAll());
      expect(migrated).toContain(`${gateway} realizes security.countermeasure.rate-limiting`);
      expect(migrated).toContain(`api.operation.create-order aggregates ${body}`);
      expect(migrated.filter((t) => t.includes("implements") || t.includes(" serves api."))).toEqual([]);
    }));

  it("drops staged adds that become duplicates and re-targets staged deletes", () =>
    withModel(async (root) => {
      const committed = [
        rel(
          "application.applicationcomponent.order-service",
          "composes",
          "application.applicationfunction.price-order",
          "application"
        ),
        rel(
          "application.applicationprocess.place-order",
          "depends-on",
          "application.dataobject.order",
          "application"
        ),
        // Both become stateaction realizes stateactiontemplate
        rel("ux.stateaction.submit-order", "specializes", "ux.stateactiontemplate.submit", "ux"),
        rel("ux.stateactiontemplate.submit", "provides", "ux.stateaction.submit-order", "ux")
      ];
      await writeFile(
        join(root, "documentation-robotics", "model", "relationships.yaml"),
        `# Intra-layer relationships\n\n${YAML.stringify(committed)}`
      );

      const flow = "api.oauthflow.auth-code";
      const changesetId = await stageChangeset(root, [
        // becomes composes, which the model already has
        relationshipAdd(
          rel(
            "application.applicationcomponent.order-service",
            "assigned-to",
            "application.applicationfunction.price-order",
            "application"
          )
        ),
        elementAdd("00000000-0000-4000-8000-000000000053", flow, { scopes: { "orders:write": "Place orders" } }),
        // two retired relationships that both become oauthflows composes oauthflow
        relationshipAdd(rel(flow, "associated-with", "api.oauthflows.oauth-flows", "api")),
        relationshipAdd(rel("api.oauthflows.oauth-flows", "aggregates", flow, "api")),
        // the committed relationship it deletes becomes accesses
        relationshipDelete(committed[1]),
        // the provides twin the changeset keeps becomes the same relationship
        relationshipDelete(committed[2])
      ]);

      const report = await upgrade(root);
      expect(
        report.map(({ stagedAs, action, duplicateOf }) => ({ stagedAs, action, duplicateOf }))
      ).toEqual([
        { stagedAs: "relationship-add", action: "dropped-duplicate", duplicateOf: "model" },
        { stagedAs: "relationship-add", action: "rewritten", duplicateOf: undefined },
        { stagedAs: "relationship-add", action: "dropped-duplicate", duplicateOf: "changeset" },
        { stagedAs: "relationship-delete", action: "rewritten", duplicateOf: undefined },
        { stagedAs: "relationship-delete", action: "dropped-duplicate", duplicateOf: "kept" }
      ]);

      const staged = await new StagedChangesetStorage(root).load(changesetId);
      expect(staged!.changes.map((c) => [c.type, c.elementId, (c as { sequenceNumber?: number }).sequenceNumber])).toEqual([
        ["add", flow, 0],
        ["relationship-add", `api.oauthflows.oauth-flows::composes::${flow}`, 1],
        [
          "relationship-delete",
          "application.applicationprocess.place-order::accesses::application.dataobject.order",
          2
        ]
      ]);

      const after = await commit(root, changesetId);
      const validator = new RelationshipValidator();
      await validator.initialize();
      expect((await validator.validateModel(after)).errors).toEqual([]);
      expect(triples(after.relationships.getAll())).toEqual([
        "application.applicationcomponent.order-service composes application.applicationfunction.price-order",
        "ux.stateaction.submit-order realizes ux.stateactiontemplate.submit",
        `api.oauthflows.oauth-flows composes ${flow}`
      ]);
    }));

  it("leaves committed changesets alone", () =>
    withModel(async (root) => {
      const changesetId = await stageChangeset(root, [
        relationshipAdd(
          rel(
            "application.applicationcomponent.order-service",
            "implements",
            "security.countermeasure.rate-limiting",
            "application",
            "security"
          )
        )
      ]);
      const storage = new StagedChangesetStorage(root);
      const changeset = await storage.load(changesetId);
      changeset!.markCommitted();
      await storage.save(changeset!);
      const path = join(root, "documentation-robotics", "changesets", changesetId, "changes.yaml");
      const recorded = await readFile(path, "utf-8");

      expect(await upgrade(root)).toEqual([]);
      expect(await readFile(path, "utf-8")).toBe(recorded);
    }));
});

describe("rewriteStagedChangeset", () => {
  const types: Record<string, string> = {
    a: "technology.systemsoftware",
    b: "security.countermeasure"
  };
  const resolve: ElementResolver = (id) =>
    types[id] ? { specNodeId: types[id], canonicalId: id } : undefined;
  const implementsRel = rel("a", "implements", "b", "technology", "security");
  const realizesRel = rel("a", "realizes", "b", "technology", "security");
  const staged = (changes: Array<Omit<Change, "timestamp">>) => ({
    id: "cs",
    changes: changes.map((c, sequenceNumber) => ({ ...c, sequenceNumber }))
  });

  it("drops a staged delete whose relationship the changeset re-adds under the new predicate", () => {
    // Under 0.9.0 the changeset swapped implements for realizes; after the migration the model
    // already says realizes, so deleting it would lose the relationship
    const { changes, report } = rewriteStagedChangeset(
      staged([relationshipAdd(realizesRel), relationshipDelete(implementsRel)]),
      { before: [implementsRel], after: [realizesRel] },
      resolve
    );
    expect(changes.map((c) => [c.type, c.elementId])).toEqual([
      ["relationship-add", "a::realizes::b"]
    ]);
    expect(report).toMatchObject([{ stagedAs: "relationship-delete", duplicateOf: "kept" }]);
  });

  it("leaves a changeset alone when it deletes and re-adds a relationship the table does not touch", () => {
    const changes = staged([
      relationshipDelete(realizesRel),
      relationshipAdd({ ...realizesRel, properties: { note: "re-added" } })
    ]).changes;
    const result = rewriteStagedChangeset(
      { id: "cs", changes },
      { before: [realizesRel], after: [realizesRel] },
      resolve
    );
    expect(result.report).toEqual([]);
    expect(result.changes).toEqual(changes);
  });

  it("keeps a delete when a later change in the changeset adds the relationship back", () => {
    // The committed implements and realizes merge into one realizes; the changeset deletes the
    // realizes and later re-adds it, so the delete must stay ahead of the add
    const { changes, report } = rewriteStagedChangeset(
      staged([relationshipDelete(realizesRel), relationshipAdd(realizesRel)]),
      { before: [implementsRel, realizesRel], after: [realizesRel] },
      resolve
    );
    expect(report).toEqual([]);
    expect(changes.map((c) => [c.type, c.elementId])).toEqual([
      ["relationship-delete", "a::realizes::b"],
      ["relationship-add", "a::realizes::b"]
    ]);
  });

  it("keeps an add and a later delete of the same retired relationship in order", () => {
    const { changes } = rewriteStagedChangeset(
      staged([relationshipAdd(implementsRel), relationshipDelete(implementsRel)]),
      { before: [], after: [] },
      resolve
    );
    expect(changes.map((c) => [c.type, c.elementId])).toEqual([
      ["relationship-add", "a::realizes::b"],
      ["relationship-delete", "a::realizes::b"]
    ]);
  });
});

describe("rewriteRelationships", () => {
  const types: Record<string, string> = {
    a: "technology.systemsoftware",
    b: "security.countermeasure",
    c: "api.parameter",
    d: "api.operation"
  };
  const resolve: ElementResolver = (id) =>
    types[id] ? { specNodeId: types[id], canonicalId: id } : undefined;

  it("renames a retired predicate even when the endpoints cannot be resolved", () => {
    const { relationships, changes } = rewriteRelationships(
      [rel("unknown-1", "implements", "unknown-2", "technology")],
      resolve
    );
    expect(triples(relationships)).toEqual(["unknown-1 realizes unknown-2"]);
    expect(changes[0].rules).toEqual(["implements -> realizes"]);
  });

  it("does not apply triple rules to unresolved endpoints", () => {
    const input = [rel("unknown-1", "references", "d", "api")];
    expect(rewriteRelationships(input, resolve).relationships).toEqual(input);
  });

  it("swaps layer and targetLayer with the ends of a cross-layer relationship", () => {
    const table: RelationshipRewriteTable = {
      sources: [],
      predicateRenames: {},
      triples: {
        "technology.systemsoftware.serves.security.countermeasure": {
          to: "security.countermeasure.depends-on.technology.systemsoftware",
          swap: true,
          records: ["test"]
        }
      }
    };
    const { relationships } = rewriteRelationships(
      [rel("a", "serves", "b", "technology", "security")],
      resolve,
      table
    );
    expect(relationships).toEqual([rel("b", "depends-on", "a", "security", "technology")]);
  });

  it("drops a relationship whose rule has no replacement", () => {
    const table: RelationshipRewriteTable = {
      sources: [],
      predicateRenames: {},
      triples: {
        "api.parameter.references.api.operation": { to: null, swap: false, records: ["test"] }
      }
    };
    const { relationships, changes } = rewriteRelationships(
      [rel("c", "references", "d", "api"), rel("d", "aggregates", "c", "api")],
      resolve,
      table
    );
    expect(triples(relationships)).toEqual(["d aggregates c"]);
    expect(changes).toMatchObject([{ action: "dropped" }]);
  });
});

describe("relationship rewrite table", () => {
  it("matches what the generator builds from the applied-*.json records", () => {
    const { table } = buildRewriteTable(loadChangeRecords(), loadCatalogTriples());
    expect(table).toEqual(RELATIONSHIP_REWRITE_TABLE);
  });

  it("maps only retired triples, to triples the bundled catalog has", async () => {
    const { readFileSync } = await import("fs");
    const bundled = join(import.meta.dir, "../../../src/schemas/bundled");
    const manifest = JSON.parse(readFileSync(join(bundled, "manifest.json"), "utf-8"));
    const catalog = new Set<string>();
    for (const { id } of manifest.layers) {
      const layer = JSON.parse(readFileSync(join(bundled, `${id}.json`), "utf-8"));
      for (const s of Object.values(layer.relationshipSchemas ?? {}) as Array<
        Record<string, string>
      >) {
        catalog.add(`${s.source_spec_node_id}.${s.predicate}.${s.destination_spec_node_id}`);
      }
    }

    for (const [from, rule] of Object.entries(RELATIONSHIP_REWRITE_TABLE.triples)) {
      expect(catalog.has(from)).toBe(false);
      if (rule.to !== null) {
        expect(catalog.has(rule.to)).toBe(true);
      }
    }
    expect(RELATIONSHIP_REWRITE_TABLE.predicateRenames.implements).toBe("realizes");
    // 18 implements schemas + 86 from reflection tier 1; later change sets only add rules
    expect(Object.keys(RELATIONSHIP_REWRITE_TABLE.triples).length).toBeGreaterThanOrEqual(104);
  });
});
