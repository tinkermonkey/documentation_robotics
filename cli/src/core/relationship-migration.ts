/**
 * Relationship catalog migration
 *
 * When the spec removes, renames or reverses relationship schemas, relationships that a model
 * recorded against the old catalog stop validating. RELATIONSHIP_REWRITE_TABLE maps every retired
 * triple ({sourceLayer}.{sourceType}.{predicate}.{destLayer}.{destType}) to the triple that now
 * expresses the same meaning, and every retired predicate to its replacement. The table is
 * generated from the applied-*.json change records by cli/scripts/generate-relationship-migration.ts;
 * this module applies it to a model's relationships.yaml and to the relationship changes held in
 * its staged changesets.
 */

import { readdir } from "fs/promises";
import type { Model } from "./model.js";
import type { Relationship } from "./relationships.js";
import type { Change, StagedChange } from "./changeset.js";
import { CANONICAL_LAYER_NAMES } from "./layers.js";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";
import { FileLock } from "../utils/file-lock.js";
import { getErrorMessage } from "../utils/errors.js";
import { normalizeNodeType } from "../generated/node-types.js";
import { RELATIONSHIP_REWRITE_TABLE } from "./relationship-migration-table.js";

export interface RelationshipRewriteRule {
  /** Replacement triple, or null when the relationship has no replacement and is dropped */
  to: string | null;
  /** True when the replacement runs the other way, so the relationship's source and target swap */
  swap: boolean;
  /** Change records the rule was composed from, oldest first */
  records: string[];
}

export interface RelationshipRewriteTable {
  /** Change record files the table was generated from */
  sources: string[];
  /** Retired predicate -> replacement predicate, applied to any pair */
  predicateRenames: Record<string, string>;
  /** Retired triple -> replacement */
  triples: Record<string, RelationshipRewriteRule>;
}

/** What a model element id resolves to, for rule lookup and duplicate detection */
export interface ResolvedElement {
  /** Spec node type, e.g. "application.applicationservice" */
  specNodeId: string;
  /** One id per element, so a path and a UUID naming the same element compare equal */
  canonicalId: string;
}

export type ElementResolver = (elementId: string) => ResolvedElement | undefined;

export interface RelationshipRewriteChange {
  action: "rewritten" | "dropped-duplicate" | "dropped";
  before: { source: string; predicate: string; target: string };
  after?: { source: string; predicate: string; target: string };
  /** The rules applied, e.g. "a.x.implements.b.y -> a.x.realizes.b.y" */
  rules: string[];
}

export interface RelationshipRewriteResult {
  relationships: Relationship[];
  changes: RelationshipRewriteChange[];
}

/** Rules are composed when the table is generated, so a chain is at most a predicate rename plus one triple rule */
const MAX_RULES_PER_RELATIONSHIP = 4;

function predicateOf(triple: string): string {
  const parts = triple.split(".");
  if (parts.length !== 5) {
    throw new Error(`Malformed relationship triple '${triple}' in the rewrite table`);
  }
  return parts[2];
}

function swapEnds(rel: Relationship, predicate: string): Relationship {
  const sourceLayer = rel.targetLayer ?? rel.layer;
  const targetLayer = rel.layer;
  const swapped: Relationship = {
    ...rel,
    source: rel.target,
    target: rel.source,
    predicate,
    layer: sourceLayer,
  };
  if (targetLayer && targetLayer !== sourceLayer) {
    swapped.targetLayer = targetLayer;
  } else {
    delete swapped.targetLayer;
  }
  return swapped;
}

function rewriteOne(
  rel: Relationship,
  resolve: ElementResolver,
  table: RelationshipRewriteTable
): { rel: Relationship | null; rules: string[] } | null {
  let current = rel;
  const rules: string[] = [];

  for (let i = 0; i < MAX_RULES_PER_RELATIONSHIP; i++) {
    const source = resolve(current.source);
    const target = resolve(current.target);
    const key =
      source && target ? `${source.specNodeId}.${current.predicate}.${target.specNodeId}` : undefined;
    const rule = key ? table.triples[key] : undefined;

    if (key && rule) {
      if (rule.to === null) {
        rules.push(`${key} -> (removed)`);
        return { rel: null, rules };
      }
      rules.push(`${key} -> ${rule.to}`);
      const predicate = predicateOf(rule.to);
      current = rule.swap ? swapEnds(current, predicate) : { ...current, predicate };
      continue;
    }

    const renamed = table.predicateRenames[current.predicate];
    if (renamed) {
      rules.push(`${current.predicate} -> ${renamed}`);
      current = { ...current, predicate: renamed };
      continue;
    }

    break;
  }

  return rules.length > 0 ? { rel: current, rules } : null;
}

/** Key under which two relationships naming the same element pair and predicate compare equal */
function identityOf(resolve: ElementResolver): (rel: Relationship) => string {
  return (rel) =>
    [
      resolve(rel.source)?.canonicalId ?? rel.source,
      rel.predicate,
      resolve(rel.target)?.canonicalId ?? rel.target,
    ].join("\u0000");
}

function tripleOf(rel: Relationship): RelationshipRewriteChange["before"] {
  return { source: rel.source, predicate: rel.predicate, target: rel.target };
}

/**
 * Rewrite relationships recorded against retired catalog entries.
 *
 * A relationship whose triple has a rule takes the replacement predicate, with source and target
 * swapped when the replacement runs the other way. A relationship whose endpoints cannot be
 * resolved only gets predicate renames, which need no types. A rewritten relationship that would
 * duplicate one already in the list (same source, predicate and target) is dropped; relationships
 * the table does not touch are kept as they are, in their original order.
 */
export function rewriteRelationships(
  relationships: Relationship[],
  resolve: ElementResolver,
  table: RelationshipRewriteTable = RELATIONSHIP_REWRITE_TABLE
): RelationshipRewriteResult {
  const identity = identityOf(resolve);
  const triple = tripleOf;

  const outcomes = relationships.map((rel) => ({ rel, outcome: rewriteOne(rel, resolve, table) }));

  // Untouched relationships win over rewritten ones, wherever they appear in the file
  const present = new Set(outcomes.filter((o) => o.outcome === null).map((o) => identity(o.rel)));

  const result: Relationship[] = [];
  const changes: RelationshipRewriteChange[] = [];

  for (const { rel, outcome } of outcomes) {
    if (outcome === null) {
      result.push(rel);
      continue;
    }
    if (outcome.rel === null) {
      changes.push({ action: "dropped", before: triple(rel), rules: outcome.rules });
      continue;
    }
    const key = identity(outcome.rel);
    if (present.has(key)) {
      changes.push({
        action: "dropped-duplicate",
        before: triple(rel),
        after: triple(outcome.rel),
        rules: outcome.rules,
      });
      continue;
    }
    present.add(key);
    result.push(outcome.rel);
    changes.push({
      action: "rewritten",
      before: triple(rel),
      after: triple(outcome.rel),
      rules: outcome.rules,
    });
  }

  return { relationships: result, changes };
}

/** The element fields a resolver reads; a staged add's `after` carries the same ones */
interface ElementData {
  id?: unknown;
  spec_node_id?: unknown;
  type?: unknown;
  layer_id?: unknown;
}

function toResolved(element: ElementData, layerName: string): ResolvedElement | undefined {
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  const id = text(element.id);
  const layerId = text(element.layer_id) ?? layerName;
  const type = text(element.type);
  const specNodeId =
    text(element.spec_node_id) ?? (type ? `${layerId}.${normalizeNodeType(layerId, type)}` : undefined);
  return id && specNodeId ? { specNodeId, canonicalId: id } : undefined;
}

/**
 * Build a resolver over the model's base layers (never a changeset projection), loading any
 * layer that is not in memory yet.
 */
async function buildResolver(model: Model): Promise<ElementResolver> {
  for (const layerName of CANONICAL_LAYER_NAMES) {
    if (!model.layers.has(layerName)) {
      await model.loadLayer(layerName);
    }
  }

  // Index paths and UUIDs once; Layer.getElement scans every node for a UUID
  const index = new Map<string, ResolvedElement | undefined>();
  for (const layer of model.layers.values()) {
    for (const element of layer.listElements()) {
      const resolved = toResolved(element, layer.name);
      index.set(element.path, resolved);
      index.set(element.id, resolved);
    }
  }

  return (elementId: string) => {
    if (index.has(elementId)) {
      return index.get(elementId);
    }
    // Legacy semantic ids are only reachable through Layer.getElement
    let resolved: ResolvedElement | undefined;
    for (const layer of model.layers.values()) {
      const element = layer.getElement(elementId);
      if (element) {
        resolved = toResolved(element, layer.name);
        break;
      }
    }
    index.set(elementId, resolved);
    return resolved;
  };
}

/** The committed relationships as recorded before the migration and as rewritten by it */
export interface CommittedRelationships {
  before: Relationship[];
  after: Relationship[];
}

export interface RelationshipMigrationResult {
  filesModified: number;
  changes: RelationshipRewriteChange[];
  committed: CommittedRelationships;
  error?: string;
}

/**
 * Apply the rewrite table to documentation-robotics/model/relationships.yaml on disk.
 * The file is rewritten only when at least one relationship changes.
 */
export async function migrateRelationshipsFile(
  model: Model,
  table: RelationshipRewriteTable = RELATIONSHIP_REWRITE_TABLE
): Promise<RelationshipMigrationResult> {
  const fs = await import("fs/promises");
  const YAML = await import("yaml");
  const relationshipsPath = `${model.rootPath}/documentation-robotics/model/relationships.yaml`;

  let content: string;
  try {
    content = await fs.readFile(relationshipsPath, "utf-8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return { filesModified: 0, changes: [], committed: { before: [], after: [] } };
    }
    throw error;
  }

  const data = YAML.parse(content) ?? [];
  if (!Array.isArray(data)) {
    return {
      filesModified: 0,
      changes: [],
      committed: { before: [], after: [] },
      error: `relationships.yaml is not a list of relationships (found ${typeof data}); fix the file and run the upgrade again`,
    };
  }

  const resolve = await buildResolver(model);
  const { relationships, changes } = rewriteRelationships(data as Relationship[], resolve, table);
  const committed = { before: data as Relationship[], after: relationships };

  if (changes.length === 0) {
    return { filesModified: 0, changes, committed };
  }

  // Same layout as Model.saveRelationships()
  const header = `# Intra-layer relationships
# Format: source_id -> predicate -> target_id
# Last updated: ${new Date().toISOString()}

`;
  await fs.writeFile(relationshipsPath, header + YAML.stringify(relationships), "utf-8");
  return { filesModified: 1, changes, committed };
}

/** A staged relationship change the migration rewrote or removed from its changeset */
export interface StagedRelationshipRewriteChange extends RelationshipRewriteChange {
  /** Id of the changeset that holds the change */
  changeset: string;
  /** What the staged change does to the relationship */
  stagedAs: "relationship-add" | "relationship-delete";
  /**
   * For a dropped duplicate, what already covers the rewritten relationship:
   * "model" - the migrated model has it (staged add);
   * "changeset" - an earlier staged change already adds or deletes it;
   * "kept" - the changeset deletes it, but another relationship the model or the changeset keeps
   *   was rewritten to it, so deleting it would also remove that one (staged delete)
   */
  duplicateOf?: "model" | "changeset" | "kept";
}

function isRelationship(value: unknown): value is Relationship {
  const rel = value as Partial<Relationship> | undefined;
  return (
    typeof rel === "object" &&
    rel !== null &&
    typeof rel.source === "string" &&
    typeof rel.predicate === "string" &&
    typeof rel.target === "string"
  );
}

/** A staged relationship change carrying a rewritten relationship, re-keyed to match it */
function withRelationship(change: Change, field: "before" | "after", rel: Relationship): Change {
  return {
    ...change,
    elementId: `${rel.source}::${rel.predicate}::${rel.target}`,
    layerName: rel.layer || change.layerName,
    [field]: rel as unknown as Record<string, unknown>,
  };
}

/** Resolve the elements a changeset adds as well as the model's own */
function withStagedElements(base: ElementResolver, changes: Change[]): ElementResolver {
  const staged = new Map<string, ResolvedElement>();
  for (const change of changes) {
    if (change.type !== "add" || !change.after) {
      continue;
    }
    const resolved = toResolved(change.after, change.layerName);
    if (!resolved) {
      continue;
    }
    for (const key of [change.after.path, change.after.id, change.elementId]) {
      if (typeof key === "string" && key) {
        staged.set(key, resolved);
      }
    }
  }
  // The model wins: committing an add whose element already exists is a no-op
  return (elementId) => base(elementId) ?? staged.get(elementId);
}

/**
 * Rewrite the relationship changes of one staged changeset recorded against retired catalog
 * entries, so that committing it after the migration has the effect it would have had before.
 *
 * - A relationship-add takes its rewritten relationship and key. It is dropped when the rule has
 *   no replacement, or when the rewritten relationship is already in the migrated model or
 *   added by an earlier change in the changeset (an add the table does not touch wins, as in
 *   rewriteRelationships).
 * - A relationship-delete takes the rewritten form of the relationship it deletes, which is what
 *   the committed relationship became. It is dropped when the rule has no replacement (the
 *   migration already removed that relationship), when an earlier change already deletes the same
 *   rewritten relationship, or when the changeset's end state keeps another relationship that was
 *   rewritten to the same one and nothing later in the changeset adds it back: in the old catalog
 *   they were two relationships and the changeset deleted only one of them.
 *
 * Other changes are kept as they are. Changes come back in commit order, renumbered.
 */
export function rewriteStagedChangeset(
  changeset: { id: string; changes: Change[] },
  committed: CommittedRelationships,
  resolve: ElementResolver,
  table: RelationshipRewriteTable = RELATIONSHIP_REWRITE_TABLE
): { changes: Change[]; report: StagedRelationshipRewriteChange[] } {
  const identity = identityOf(resolve);
  const ordered = changeset.changes
    .map((change, index) => ({ change, order: (change as StagedChange).sequenceNumber ?? index }))
    .sort((a, b) => a.order - b.order)
    .map(({ change }) => {
      const value =
        change.type === "relationship-add"
          ? change.after
          : change.type === "relationship-delete"
            ? change.before
            : undefined;
      const rel = isRelationship(value) ? value : undefined;
      // rewriteOne: null when the table leaves the relationship as it is
      return { change, rel, outcome: rel ? rewriteOne(rel, resolve, table) : null };
    });
  const imageOf = (rel: Relationship, outcome: ReturnType<typeof rewriteOne>) =>
    outcome === null ? rel : outcome.rel;

  // Relationships the changeset's end state holds, replayed over the committed model as recorded,
  // and what they become
  const endState = new Map(committed.before.map((rel) => [identity(rel), rel]));
  for (const { change, rel } of ordered) {
    if (rel && change.type === "relationship-add") {
      endState.set(identity(rel), rel);
    } else if (rel) {
      endState.delete(identity(rel));
    }
  }
  const kept = new Set<string>();
  for (const rel of endState.values()) {
    const image = imageOf(rel, rewriteOne(rel, resolve, table));
    if (image) {
      kept.add(identity(image));
    }
  }

  // Position of the last staged add of each rewritten relationship
  const lastAdd = new Map<string, number>();
  ordered.forEach(({ change, rel, outcome }, position) => {
    const image = rel && change.type === "relationship-add" ? imageOf(rel, outcome) : null;
    if (image) {
      lastAdd.set(identity(image), position);
    }
  });

  // What the model holds, and what the changeset adds and deletes, as the rewritten changes replay
  const inModel = new Set(committed.after.map(identity));
  const added = new Set(
    ordered
      .filter(({ change, rel, outcome }) => rel && change.type === "relationship-add" && outcome === null)
      .map(({ rel }) => identity(rel!))
  );
  const deleted = new Set<string>();

  const changes: Change[] = [];
  const report: StagedRelationshipRewriteChange[] = [];
  const record = (
    stagedAs: StagedRelationshipRewriteChange["stagedAs"],
    entry: RelationshipRewriteChange,
    duplicateOf?: StagedRelationshipRewriteChange["duplicateOf"]
  ) => report.push({ ...entry, changeset: changeset.id, stagedAs, ...(duplicateOf && { duplicateOf }) });

  ordered.forEach(({ change, rel, outcome }, position) => {
    if (!rel) {
      changes.push(change);
      return;
    }
    const stagedAs = change.type as StagedRelationshipRewriteChange["stagedAs"];
    if (outcome !== null && outcome.rel === null) {
      // A delete has nothing left to delete: the file migration dropped the relationship too
      record(stagedAs, { action: "dropped", before: tripleOf(rel), rules: outcome.rules });
      return;
    }
    const image = outcome?.rel ?? rel;
    const key = identity(image);
    const entry = {
      action: "dropped-duplicate" as const,
      before: tripleOf(rel),
      after: tripleOf(image),
      rules: outcome?.rules ?? [],
    };

    if (stagedAs === "relationship-add") {
      if (outcome !== null && inModel.has(key)) {
        record(stagedAs, entry, "model");
        return;
      }
      if (outcome !== null && added.has(key)) {
        record(stagedAs, entry, "changeset");
        return;
      }
      added.add(key);
      deleted.delete(key);
    } else {
      if (kept.has(key) && (lastAdd.get(key) ?? -1) < position) {
        record(stagedAs, entry, "kept");
        return;
      }
      if (outcome !== null && deleted.has(key)) {
        record(stagedAs, entry, "changeset");
        return;
      }
      deleted.add(key);
      inModel.delete(key);
      added.delete(key);
    }

    if (outcome === null) {
      changes.push(change);
    } else {
      changes.push(withRelationship(change, stagedAs === "relationship-add" ? "after" : "before", image));
      record(stagedAs, { ...entry, action: "rewritten" });
    }
  });

  return {
    changes: changes.map((change, index) => ({ ...change, sequenceNumber: index }) as StagedChange),
    report,
  };
}

export interface StagedRelationshipMigrationResult {
  changesetsModified: number;
  changes: StagedRelationshipRewriteChange[];
  errors: string[];
}

/**
 * Apply the rewrite table to the relationship changes of every staged changeset under
 * documentation-robotics/changesets. Committed and discarded changesets are history and stay as
 * they are. A changeset is rewritten only when at least one of its changes is affected.
 *
 * @param committed - relationships.yaml before and after migrateRelationshipsFile rewrote it
 */
export async function migrateStagedChangesets(
  model: Model,
  committed: CommittedRelationships,
  table: RelationshipRewriteTable = RELATIONSHIP_REWRITE_TABLE
): Promise<StagedRelationshipMigrationResult> {
  const storage = new StagedChangesetStorage(model.rootPath);
  const result: StagedRelationshipMigrationResult = { changesetsModified: 0, changes: [], errors: [] };

  let entries: string[];
  try {
    entries = (await readdir(storage.getChangesetsDir(), { withFileTypes: true }))
      // FileLock keeps "<changeset>.lock" directories beside the changesets
      .filter((entry) => entry.isDirectory() && !entry.name.endsWith(".lock"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return result;
    }
    throw error;
  }

  const base = await buildResolver(model);

  for (const id of entries) {
    try {
      await new FileLock(storage.getChangesetPath(id)).withLock(async () => {
        const changeset = await storage.load(id);
        if (!changeset || changeset.status !== "staged") {
          return;
        }
        const resolve = withStagedElements(base, changeset.changes);
        const { changes, report } = rewriteStagedChangeset(changeset, committed, resolve, table);
        if (report.length === 0) {
          return;
        }
        changeset.changes = changes;
        changeset.updateModified();
        await storage.save(changeset);
        result.changesetsModified++;
        result.changes.push(...report);
      });
    } catch (error) {
      result.errors.push(
        `Failed to migrate staged changeset '${id}': ${getErrorMessage(error)}; fix or delete the changeset and run the upgrade again`
      );
    }
  }

  return result;
}

/** One-line summary of a relationship migration, for the upgrade output */
export function summarizeRelationshipChanges(
  changes: RelationshipRewriteChange[],
  label = "relationships"
): string {
  const count = (action: RelationshipRewriteChange["action"]) =>
    changes.filter((c) => c.action === action).length;
  const parts = [`${count("rewritten")} rewritten`, `${count("dropped-duplicate")} dropped as duplicates`];
  const dropped = count("dropped");
  if (dropped > 0) {
    parts.push(`${dropped} dropped (no replacement)`);
  }
  return `${label}: ${parts.join(", ")}`;
}
