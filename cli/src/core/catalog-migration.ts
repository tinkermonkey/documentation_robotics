/**
 * Catalog migration: brings a model's elements and relationships in line with the current spec
 * catalog, using the generated rewrite table (relationship-migration-table.ts).
 *
 *   1. element type renames (element-type-migration.ts), so the rules below see the new types
 *   2. relationship rewrites in relationships.yaml (relationship-migration.ts)
 *   3. the same rewrites in staged changesets
 *
 * It runs inside the 0.9.0 -> 0.10.0 and 0.10.0 -> 0.11.0 migrations, and on its own when `dr upgrade` finds a model
 * already at the current spec version that still names retired types or relationships: the
 * catalog can change between spec version bumps, and a model stamped with the version before
 * a change would otherwise never receive it. Every step only rewrites what the table matches,
 * so running it again on a migrated model changes nothing.
 */
import type { Model } from "./model.js";
import type { Relationship } from "./relationships.js";
import { migrateElementTypes, summarizeElementTypeChanges, type ElementTypeRenameChange } from "./element-type-migration.js";
import {
  migrateRelationshipsFile,
  migrateStagedChangesets,
  summarizeRelationshipChanges,
  type RelationshipRewriteChange,
  type StagedRelationshipRewriteChange,
} from "./relationship-migration.js";

export interface CatalogMigrationResult {
  filesModified: number;
  /** One phrase per kind of change, for the migration description */
  summaries: string[];
  errors: string[];
  details: {
    elementTypeChanges: ElementTypeRenameChange[];
    relationshipChanges: RelationshipRewriteChange[];
    stagedRelationshipChanges: StagedRelationshipRewriteChange[];
    /**
     * relationships.yaml as the migration leaves it (as it would, in a dry run). Absent when the
     * relationships were not migrated (an element-type error, an unreadable file).
     */
    committedRelationshipsAfter?: Relationship[];
  };
}

export async function applyCatalogMigrations(
  model: Model,
  options: { dryRun?: boolean } = {}
): Promise<CatalogMigrationResult> {
  const dryRun = options.dryRun ?? false;
  // Renamed element types first (product.capability -> product.softwarecapability), so the
  // relationship rules, which name the new types, resolve the renamed elements.
  const types = await migrateElementTypes(model, undefined, { dryRun });

  const relationships = types.errors.length
    ? { filesModified: 0, changes: [], committed: { before: [], after: [] }, error: undefined }
    : await migrateRelationshipsFile(model, undefined, { dryRun });
  const staged = relationships.error
    ? { changesetsModified: 0, changes: [], errors: [] }
    : await migrateStagedChangesets(model, relationships.committed, undefined, { dryRun });

  const summaries = [
    ...(types.changes.length > 0 ? [`element types renamed: ${summarizeElementTypeChanges(types.changes)}`] : []),
    relationships.changes.length > 0 ? summarizeRelationshipChanges(relationships.changes) : "no relationships to rewrite",
    ...(staged.changes.length > 0 ? [summarizeRelationshipChanges(staged.changes, "staged relationship changes")] : []),
  ];

  return {
    filesModified: types.filesModified + types.changesetsModified + relationships.filesModified + staged.changesetsModified,
    summaries,
    errors: [...types.errors, ...(relationships.error ? [relationships.error] : []), ...staged.errors],
    details: {
      elementTypeChanges: types.changes,
      relationshipChanges: relationships.changes,
      stagedRelationshipChanges: staged.changes,
      ...(!types.errors.length && !relationships.error ? { committedRelationshipsAfter: relationships.committed.after } : {}),
    },
  };
}

/** How many catalog changes the model still needs; all zero when it is in line with the catalog */
export async function pendingCatalogMigrations(
  model: Model
): Promise<{ elementTypes: number; relationships: number; stagedRelationships: number; errors: string[] }> {
  const r = await applyCatalogMigrations(model, { dryRun: true });
  return {
    elementTypes: r.details.elementTypeChanges.length,
    relationships: r.details.relationshipChanges.length,
    stagedRelationships: r.details.stagedRelationshipChanges.length,
    errors: r.errors,
  };
}
