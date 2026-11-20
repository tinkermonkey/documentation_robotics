/**
 * Routes for dropped relationship types (#1164).
 *
 * The rewrite-table generator's `replace-dropped` action lets a later change record name the
 * catalog type that replaces a triple an earlier record dropped. The record
 * applied-routes-for-dropped-relationships.json uses it for the three links spec 0.11.0 removed
 * and Context Studio proposals 93d40a94 and 38fa8fa3 gave a route, each with source and target
 * swapped. Committed relationships and staged ones get the same rewrite.
 */
import { describe, it, expect } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import YAML from "yaml";
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
} from "../../../src/core/relationship-migration.js";
import { RELATIONSHIP_REWRITE_TABLE } from "../../../src/core/relationship-migration-table.js";
import { RelationshipValidator } from "../../../src/validators/relationship-schema-validator.js";
import { isValidRelationship } from "../../../src/generated/relationship-index.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";
import {
  buildRewriteTable,
  loadCatalogTriples,
  loadChangeRecords,
  type ChangeAction,
  type ChangeRecord,
} from "../../../scripts/generate-relationship-migration.js";

// ---------------------------------------------------------------------------------------------
// The generator action

const record = (name: string, appliedAt: string, actions: ChangeAction[]): ChangeRecord => ({
  file: `records/applied-${name}.json`,
  record: name,
  applied_at: appliedAt,
  actions,
});

const DROPPED = "store.database.serves.app.component";
const REPLACEMENT = "app.component.accesses.store.database";
const drop = record("principles", "2026-01-01", [{ action: "delete", from: DROPPED, to: null }]);
const replace = (to: string | null, from = DROPPED) =>
  record("routes", "2026-02-01", [{ action: "replace-dropped", from, to }]);

describe("generator: replace-dropped", () => {
  it("gives a triple an earlier record dropped its replacement, with ends swapped when it runs the other way", () => {
    const { table, warnings } = buildRewriteTable([drop, replace(REPLACEMENT)], new Set([REPLACEMENT]));
    expect(table.triples).toEqual({
      [DROPPED]: { to: REPLACEMENT, swap: true, records: ["principles", "routes"] },
    });
    expect(warnings).toEqual([]);
  });

  it("keeps the ends when the replacement runs the same way", () => {
    const sameWay = "store.database.flows-to.app.component";
    const { table } = buildRewriteTable([drop, replace(sameWay)], new Set([sameWay]));
    expect(table.triples[DROPPED]).toEqual({ to: sameWay, swap: false, records: ["principles", "routes"] });
  });

  it("also re-routes a rule that was renamed into the dropped triple, composing the swaps", () => {
    // component uses database (reversed into database serves component), which was then dropped
    const renamed = record("tier1", "2025-12-01", [
      { action: "rename", kind: "reverse", from: "app.component.uses.store.database", to: DROPPED },
    ]);
    const { table } = buildRewriteTable([renamed, drop, replace(REPLACEMENT)], new Set([REPLACEMENT]));
    expect(table.triples["app.component.uses.store.database"]).toEqual({
      to: REPLACEMENT,
      // reversed once by the rename and once by the replacement: back to its own direction
      swap: false,
      records: ["tier1", "principles", "routes"],
    });
    expect(table.triples[DROPPED]).toEqual({ to: REPLACEMENT, swap: true, records: ["principles", "routes"] });
  });

  it("follows a type rename between the drop and its replacement", () => {
    const renameType = record("split", "2026-01-15", [{ action: "rename-type", from: "app.component", to: "app.module" }]);
    const newReplacement = "app.module.accesses.store.database";
    const { table } = buildRewriteTable(
      [drop, renameType, replace(newReplacement, "store.database.serves.app.module")],
      new Set([newReplacement])
    );
    expect(table.triples).toEqual({
      "store.database.serves.app.module": { to: newReplacement, swap: true, records: ["principles", "split", "routes"] },
    });
  });

  it("stops when the replacement is not in the catalog", () => {
    expect(() => buildRewriteTable([drop, replace(REPLACEMENT)], new Set())).toThrow(
      `routes: ${DROPPED} -> ${REPLACEMENT}: the replacement is not in the current catalog`
    );
  });

  it("stops when no earlier record dropped the triple", () => {
    // Never recorded at all
    expect(() => buildRewriteTable([replace(REPLACEMENT)], new Set([REPLACEMENT]))).toThrow(
      `no earlier record dropped ${DROPPED}, so there is nothing to replace`
    );
    // Recorded, but renamed, not dropped
    const renamed = record("tier1", "2026-01-01", [
      { action: "rename", from: DROPPED, to: "store.database.flows-to.app.component" },
    ]);
    expect(() =>
      buildRewriteTable([renamed, replace(REPLACEMENT)], new Set([REPLACEMENT, "store.database.flows-to.app.component"]))
    ).toThrow("so there is nothing to replace");
    // The replacement record is older than the drop
    const early = { ...replace(REPLACEMENT), applied_at: "2025-01-01" };
    expect(() => buildRewriteTable([early, drop], new Set([REPLACEMENT]))).toThrow("so there is nothing to replace");
  });

  it("stops when the replacement links other element types, or names none", () => {
    const elsewhere = "app.service.accesses.store.database";
    expect(() => buildRewriteTable([drop, replace(elsewhere)], new Set([elsewhere]))).toThrow(
      "the replacement has a different source or destination type"
    );
    expect(() => buildRewriteTable([drop, replace(null)], new Set())).toThrow("needs a replacement triple");
  });

  it("is used once: a second replacement for the same drop has nothing left to replace", () => {
    const again = record("routes-2", "2026-03-01", [{ action: "replace-dropped", from: DROPPED, to: REPLACEMENT }]);
    expect(() => buildRewriteTable([drop, replace(REPLACEMENT), again], new Set([REPLACEMENT]))).toThrow(
      "so there is nothing to replace"
    );
  });
});

// ---------------------------------------------------------------------------------------------
// The three routes in the generated table

/** [retired triple, its replacement] */
const ROUTES: Array<[string, string]> = [
  [
    "data-store.database.serves.application.applicationcomponent",
    "application.applicationcomponent.accesses.data-store.database",
  ],
  [
    "data-store.database.serves.application.applicationservice",
    "application.applicationservice.accesses.data-store.database",
  ],
  ["ux.view.serves.application.applicationservice", "application.applicationservice.serves.ux.view"],
];

const DATABASE = "data-store.database.orders-db";
const COMPONENT = "application.applicationcomponent.order-repository";
const SERVICE = "application.applicationservice.order-service";
const VIEW = "ux.view.order-list";
const OPERATION = "api.operation.list-orders";
const RESPONSE = "api.response.ok";

const ELEMENTS: Record<string, string[]> = {
  "05_application": [COMPONENT, SERVICE],
  "07_api": [OPERATION, RESPONSE],
  "09_data-store": [DATABASE],
  "10_ux": [VIEW],
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

/** The three old links, and one whose type has no replacement */
const OLD_LINKS: Relationship[] = [
  rel(DATABASE, "serves", COMPONENT),
  rel(DATABASE, "serves", SERVICE),
  rel(VIEW, "serves", SERVICE, { note: "loads the list" }),
];
const NO_ROUTE = rel(OPERATION, "delivers", RESPONSE);

const NEW_LINKS: Relationship[] = [
  rel(COMPONENT, "accesses", DATABASE),
  rel(SERVICE, "accesses", DATABASE),
  rel(SERVICE, "serves", VIEW, { note: "loads the list" }),
];

/** Resolves the test elements by their path */
const resolve: ElementResolver = (id) => {
  const [layer, type] = id.split(".");
  return Object.values(ELEMENTS).flat().includes(id) ? { specNodeId: `${layer}.${type}`, canonicalId: id } : undefined;
};

describe("the three routes Context Studio restored", () => {
  it("are in the generated table, each ending at a catalog type with ends swapped", () => {
    const catalog = loadCatalogTriples();
    for (const [retired, replacement] of ROUTES) {
      const rule = RELATIONSHIP_REWRITE_TABLE.triples[retired];
      expect(rule.to).toBe(replacement);
      expect(rule.swap).toBe(true);
      expect(rule.records.at(-1)).toBe("routes-for-dropped-relationships");
      expect(catalog.has(replacement)).toBe(true);
      expect(catalog.has(retired)).toBe(false);
    }
  });

  it("come from the replace-dropped record: without it the generator still drops them", () => {
    const records = loadChangeRecords();
    const routes = records.find((r) => r.record === "routes-for-dropped-relationships")!;
    expect(routes.actions.map((a) => [a.action, a.from, a.to])).toEqual(
      ROUTES.map(([retired, replacement]) => ["replace-dropped", retired, replacement])
    );
    const without = buildRewriteTable(records.filter((r) => r !== routes), loadCatalogTriples()).table;
    for (const [retired] of ROUTES) {
      expect(without.triples[retired].to).toBeNull();
    }
  });

  it("rewrite committed relationships, swapping source, target and their layers and keeping properties", () => {
    const { relationships, changes } = rewriteRelationships([...OLD_LINKS, NO_ROUTE], resolve);
    expect(relationships).toEqual(NEW_LINKS);
    expect(changes.map((c) => c.action)).toEqual(["rewritten", "rewritten", "rewritten", "dropped"]);
    expect(changes[0].rules).toEqual([`${ROUTES[0][0]} -> ${ROUTES[0][1]}`]);
  });

  it("drop an old link when the model already holds its replacement", () => {
    const { relationships, changes } = rewriteRelationships([OLD_LINKS[0], NEW_LINKS[0]], resolve);
    expect(relationships).toEqual([NEW_LINKS[0]]);
    expect(changes.map((c) => c.action)).toEqual(["dropped-duplicate"]);
  });

  it("rewrite staged adds and staged deletes the same way", () => {
    const staged = (type: Change["type"], r: Relationship, sequenceNumber: number): Change =>
      ({
        type,
        elementId: `${r.source}::${r.predicate}::${r.target}`,
        layerName: r.layer,
        [type === "relationship-add" ? "after" : "before"]: r,
        sequenceNumber,
      }) as Change;
    // The model holds the view's link (deleted by the changeset); the changeset adds the other two
    const committed = { before: [OLD_LINKS[2]], after: [NEW_LINKS[2]] };
    const { changes, report } = rewriteStagedChangeset(
      {
        id: "plan",
        changes: [
          staged("relationship-add", OLD_LINKS[0], 0),
          staged("relationship-add", OLD_LINKS[1], 1),
          staged("relationship-delete", OLD_LINKS[2], 2),
        ],
      },
      committed,
      resolve
    );
    expect(report.map((r) => `${r.stagedAs} ${r.action}`)).toEqual([
      "relationship-add rewritten",
      "relationship-add rewritten",
      "relationship-delete rewritten",
    ]);
    expect(changes).toEqual([
      { ...staged("relationship-add", NEW_LINKS[0], 0), layerName: "application" },
      { ...staged("relationship-add", NEW_LINKS[1], 1), layerName: "application" },
      { ...staged("relationship-delete", NEW_LINKS[2], 2), layerName: "application" },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// On disk, through upgradeModel

async function writeModel(root: string, relationships: Relationship[]): Promise<void> {
  const modelDir = join(root, "documentation-robotics", "model");
  await mkdir(modelDir, { recursive: true });
  await writeFile(
    join(modelDir, "manifest.yaml"),
    YAML.stringify({
      version: "1.0.0",
      schema: "documentation-robotics-v1",
      spec_version: getCliBundledSpecVersion(),
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      project: { name: "route-replacement-test", version: "1.0.0" },
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

describe("upgrading a model that holds the three old links", () => {
  it("rewrites them in relationships.yaml and in a staged changeset, to relationships the catalog accepts", async () => {
    const root = await mkdtemp(join(tmpdir(), "dr-route-replacement-"));
    try {
      // The model holds the first link; a staged plan adds the other two
      await writeModel(root, [OLD_LINKS[0]]);
      const model = await Model.load(root, { lazyLoad: false });
      const manager = new StagingAreaManager(model.rootPath, model);
      const plan = await manager.create("plan", "adds the other two old links");
      const storage = new StagedChangesetStorage(model.rootPath);
      await storage.addChanges(
        plan.id,
        OLD_LINKS.slice(1).map((r) => ({
          type: "relationship-add" as const,
          elementId: `${r.source}::${r.predicate}::${r.target}`,
          layerName: r.layer,
          after: r as unknown as Record<string, unknown>,
          timestamp: "2026-01-01T00:00:00.000Z",
        }))
      );

      const version = getCliBundledSpecVersion();
      const result = await upgradeModel(root, { fromVersion: version, toVersion: version, catalogOnly: true });

      expect(await committedRelationships(root)).toEqual([NEW_LINKS[0]]);
      const stagedAfter = (await storage.load(plan.id))!.changes;
      expect(stagedAfter.map((c) => c.after)).toEqual(NEW_LINKS.slice(1) as unknown as Array<Record<string, unknown>>);
      expect(stagedAfter.map((c) => c.elementId)).toEqual(
        NEW_LINKS.slice(1).map((r) => `${r.source}::${r.predicate}::${r.target}`)
      );
      // Nothing was dropped, so no record is written
      expect(result.dropRecord).toBeUndefined();
      expect((await storage.list()).map((c) => c.name)).toEqual(["plan"]);

      // The catalog accepts every rewritten relationship, and no longer has the old types
      const typeOf = (id: string) => id.split(".").slice(0, 2).join(".");
      for (const r of NEW_LINKS) {
        expect(isValidRelationship(typeOf(r.source), r.predicate, typeOf(r.target))).toBe(true);
      }
      for (const r of OLD_LINKS) {
        expect(isValidRelationship(typeOf(r.source), r.predicate, typeOf(r.target))).toBe(false);
      }
      const validator = new RelationshipValidator();
      await validator.initialize();
      const errors = (await validator.validateModel(await Model.load(root, { lazyLoad: false }))).errors;
      expect(errors.filter((e) => e.message.startsWith("No schema found"))).toEqual([]);

      // Idempotent
      const again = await upgradeModel(root, { fromVersion: version, toVersion: version, catalogOnly: true });
      expect(again.dropRecord).toBeUndefined();
      expect(await committedRelationships(root)).toEqual([NEW_LINKS[0]]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
