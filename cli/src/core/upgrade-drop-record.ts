/**
 * Upgrade record - the relationships a spec migration dropped, kept as a staged changeset.
 *
 * When the catalog retires a relationship type with no replacement, the migration removes the
 * model's relationships of that type (relationship-migration.ts). Before this record the only
 * trace was the git diff (#1164). The upgrade now writes one staged changeset,
 * `upgrade-drops-<spec version>`, with purpose `upgrade-record` (changeset-purpose.ts):
 *
 * - one staged relationship delete per dropped relationship, `before` holding the relationship as
 *   it was recorded and `origin` (`by: upgrade`) naming the retired type and the change record
 *   that retired it. A delete is what the migration did, and it reads correctly in every changeset
 *   view. A staged add would not validate: the type is gone from the catalog.
 * - staged relationship adds the migration removed from other changesets, recorded the same way,
 *   their origin naming the changeset they were staged in.
 * - a description that counts the drops by type and lists, per type, the relationship types the
 *   catalog still has between the same two element types, in either direction: the routes the
 *   user can take by hand.
 *
 * The record never lands (StagingAreaManager.landingRefusal), base drift does not apply to it
 * (changeset-drift-status.ts), and later migrations leave it alone (migrateStagedChangesets).
 * Were it committed all the same, its deletes would find nothing to delete. The user restores
 * what they want in a changeset of their own, then discards the record.
 */

import type { Change } from "./changeset.js";
import type { CatalogMigrationResult } from "./catalog-migration.js";
import type { Relationship } from "./relationships.js";
import { Model } from "./model.js";
import { StagingAreaManager } from "./staging-area.js";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";
import { RELATIONSHIPS_BY_SOURCE } from "../generated/relationship-index.js";

/** A relationship the migration dropped for want of a replacement */
export interface DroppedRelationship {
  relationship: Relationship;
  /** The retired relationship type, "{layer}.{type}.{predicate}.{layer}.{type}" */
  retiredType: string;
  /** The change records that retired the type, oldest first */
  records: string[];
  /** For a staged add the migration removed from a changeset: that changeset's id */
  stagedIn?: string;
}

/** A relationship type the catalog has between the two element types of a retired one */
export interface CatalogRoute {
  source: string;
  predicate: string;
  target: string;
  /** True when it runs from the retired type's target to its source */
  swapped: boolean;
}

/** The drops of one retired type */
export interface DroppedTypeSummary {
  retiredType: string;
  sourceType: string;
  predicate: string;
  targetType: string;
  count: number;
  /** How many of them were staged adds removed from other changesets */
  staged: number;
  /** What the catalog still has between the two element types; empty when it has nothing */
  routes: CatalogRoute[];
}

/** The record an upgrade wrote, or the reason it could not */
export interface UpgradeDropRecord {
  /** The changeset's name, e.g. "upgrade-drops-0.13.0" */
  name: string;
  /** The changeset's id; absent when the record could not be written */
  id?: string;
  /** Dropped relationships the record lists */
  count: number;
  byType: DroppedTypeSummary[];
  /** Set when writing the record failed: the drops are then only in the upgrade's own output */
  error?: string;
}

const RECORD_NAME_PREFIX = "upgrade-drops-";

function splitType(triple: string): { sourceType: string; predicate: string; targetType: string } {
  const parts = triple.split(".");
  if (parts.length !== 5) {
    throw new Error(`'${triple}' is not a {layer}.{type}.{predicate}.{layer}.{type} relationship type`);
  }
  return { sourceType: `${parts[0]}.${parts[1]}`, predicate: parts[2], targetType: `${parts[3]}.${parts[4]}` };
}

function relationshipKey(rel: { source: string; predicate: string; target: string }): string {
  return `${rel.source}::${rel.predicate}::${rel.target}`;
}

/**
 * The relationship types the catalog has between the two element types of a retired type, same
 * direction first. They are candidates, not replacements: whether one says what the dropped
 * relationship said is the user's call.
 */
export function catalogRoutesFor(retiredType: string): CatalogRoute[] {
  const { sourceType, targetType } = splitType(retiredType);
  const between = (from: string, to: string, swapped: boolean): CatalogRoute[] =>
    (RELATIONSHIPS_BY_SOURCE.get(from) ?? [])
      .filter((spec) => spec.destinationSpecNodeId === to)
      .map((spec) => ({ source: from, predicate: spec.predicate, target: to, swapped }))
      .sort((a, b) => a.predicate.localeCompare(b.predicate));
  return [
    ...between(sourceType, targetType, false),
    ...(sourceType === targetType ? [] : between(targetType, sourceType, true)),
  ];
}

/**
 * The relationships a catalog migration dropped, from its details: the model's own, then the
 * staged adds it removed from changesets. A staged delete it removed is not one: the relationship
 * it would have deleted is among the model's drops. Each relationship is listed once.
 */
export function droppedRelationshipsOf(
  details: Pick<Partial<CatalogMigrationResult["details"]>, "relationshipChanges" | "stagedRelationshipChanges">
): DroppedRelationship[] {
  const seen = new Set<string>();
  const drops: DroppedRelationship[] = [];
  const take = (
    change: { action: string; dropped?: { type: string; records: string[]; relationship: Relationship } },
    stagedIn?: string
  ) => {
    if (change.action !== "dropped" || !change.dropped) return;
    const key = relationshipKey(change.dropped.relationship);
    if (seen.has(key)) return;
    seen.add(key);
    drops.push({
      relationship: change.dropped.relationship,
      retiredType: change.dropped.type,
      records: change.dropped.records,
      ...(stagedIn ? { stagedIn } : {}),
    });
  };
  for (const change of details.relationshipChanges ?? []) take(change);
  for (const change of details.stagedRelationshipChanges ?? []) {
    if (change.stagedAs === "relationship-add") take(change, change.changeset);
  }
  return drops;
}

/** The drops counted by retired type, most first, each with the routes the catalog still has */
export function summarizeDropsByType(drops: DroppedRelationship[]): DroppedTypeSummary[] {
  const byType = new Map<string, DroppedTypeSummary>();
  for (const drop of drops) {
    let entry = byType.get(drop.retiredType);
    if (!entry) {
      entry = {
        retiredType: drop.retiredType,
        ...splitType(drop.retiredType),
        count: 0,
        staged: 0,
        routes: catalogRoutesFor(drop.retiredType),
      };
      byType.set(drop.retiredType, entry);
    }
    entry.count++;
    if (drop.stagedIn) entry.staged++;
  }
  return [...byType.values()].sort((a, b) => b.count - a.count || a.retiredType.localeCompare(b.retiredType));
}

function formatType(type: { sourceType: string; predicate: string; targetType: string }): string {
  return `${type.sourceType} --[${type.predicate}]--> ${type.targetType}`;
}

/** One line per route, e.g. "a.x --[accesses]--> b.y (ends swapped)" */
export function formatRoutes(routes: CatalogRoute[]): string {
  return routes
    .map((route) => `${route.source} --[${route.predicate}]--> ${route.target}${route.swapped ? " (ends swapped)" : ""}`)
    .join("; ");
}

/** The record's description: what it is, what to do with it, and the drops by type with their routes */
export function describeDropRecord(
  versions: { fromVersion: string; toVersion: string },
  byType: DroppedTypeSummary[]
): string {
  const total = byType.reduce((n, entry) => n + entry.count, 0);
  const staged = byType.reduce((n, entry) => n + entry.staged, 0);
  const moved =
    versions.fromVersion === versions.toVersion
      ? `applied catalog changes to the model (spec ${versions.toVersion})`
      : `moved the model from spec ${versions.fromVersion} to ${versions.toVersion}`;
  const lines = [
    `Record of the ${total} relationship(s) the upgrade dropped when it ${moved}: their types were retired from ` +
      "the catalog with no replacement. Each staged relationship delete is one dropped relationship; its origin " +
      "names the retired type and the change record that retired it." +
      (staged > 0
        ? ` ${staged} of them were staged adds the upgrade removed from other changesets, which the origin names.`
        : ""),
    "This changeset is a record and never lands. To restore a relationship, add one of a type the catalog has " +
      "now, in a changeset of your own; the types it still has between the same two element types are listed " +
      "below. Discard the record when you are done with it.",
    "",
    `Dropped, by type (${byType.length}):`,
    ...byType.map((entry) => {
      const routes =
        entry.routes.length > 0
          ? `the catalog has ${formatRoutes(entry.routes)}`
          : "the catalog has no relationship type between these two element types";
      return `- ${entry.count} x ${formatType(entry)}: ${routes}`;
    }),
  ];
  return lines.join("\n");
}

/** The staged change that records one dropped relationship */
function recordChange(drop: DroppedRelationship, timestamp: string): Change {
  const rel = drop.relationship;
  const retiredBy = drop.records.length > 0 ? ` retired by ${drop.records.join(", ")}` : " retired";
  const stagedIn = drop.stagedIn ? `; a staged add removed from changeset ${drop.stagedIn}` : "";
  return {
    type: "relationship-delete",
    elementId: relationshipKey(rel),
    layerName: rel.layer || drop.retiredType.split(".")[0],
    before: rel as unknown as Record<string, unknown>,
    timestamp,
    origin: { by: "upgrade", rule: `${drop.retiredType}${retiredBy}${stagedIn}` },
  };
}

/**
 * The name the next upgrade record takes: `upgrade-drops-<spec version>`, with `-2`, `-3`, ...
 * when a changeset of that name already exists (a model at one spec version can receive catalog
 * changes more than once).
 */
export async function nextDropRecordName(rootPath: string, toVersion: string): Promise<string> {
  const taken = new Set((await new StagedChangesetStorage(rootPath).list()).map((changeset) => changeset.name));
  const base = `${RECORD_NAME_PREFIX}${toVersion}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

/**
 * What the record of these drops would be, without writing it: its name, the count and the drops
 * by type. Undefined when there is nothing to record.
 */
export async function planDropRecord(
  rootPath: string,
  toVersion: string,
  drops: DroppedRelationship[]
): Promise<UpgradeDropRecord | undefined> {
  if (drops.length === 0) return undefined;
  return {
    name: await nextDropRecordName(rootPath, toVersion),
    count: drops.length,
    byType: summarizeDropsByType(drops),
  };
}

/**
 * Write the record of what an upgrade dropped: a staged changeset that is not made active. Call
 * after the upgraded model is saved. Undefined when nothing was dropped (no changeset is written).
 *
 * @param rootPath - the project root (Model.rootPath)
 */
export async function writeDropRecord(
  rootPath: string,
  versions: { fromVersion: string; toVersion: string },
  drops: DroppedRelationship[]
): Promise<UpgradeDropRecord | undefined> {
  const planned = await planDropRecord(rootPath, versions.toVersion, drops);
  if (!planned) return undefined;

  // The upgraded model, read from disk: the record's base snapshot is the model it was written on
  const model = await Model.load(rootPath, { lazyLoad: false });
  const manager = new StagingAreaManager(model.rootPath, model);
  const changeset = await manager.create(
    planned.name,
    describeDropRecord(versions, planned.byType),
    { kind: "upgrade", detail: `spec ${versions.fromVersion} -> ${versions.toVersion}` },
    { purpose: "upgrade-record" }
  );
  const timestamp = new Date().toISOString();
  await new StagedChangesetStorage(model.rootPath).addChanges(
    changeset.id,
    drops.map((drop) => recordChange(drop, timestamp))
  );
  return { ...planned, id: changeset.id };
}
