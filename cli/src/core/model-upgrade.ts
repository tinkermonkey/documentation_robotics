/**
 * Model upgrade - moves a model to a newer spec version and keeps its staged changesets
 * committable.
 *
 * A staged changeset records a hash of the model it was created on (its base snapshot), and
 * committing it fails while the model no longer has that hash. An upgrade always changes the
 * hash: it writes a new spec version into the manifest, and migrations may rewrite element
 * files. So the upgrade re-baselines each staged changeset that was in step with the model
 * before the upgrade onto the upgraded model. A changeset that had drifted before the upgrade
 * keeps its base snapshot, so that drift still blocks its commit.
 *
 * Relationships the migration dropped for want of a replacement are written to a staged
 * changeset of their own, the upgrade record (upgrade-drop-record.ts). Required attributes the new
 * spec version leaves empty are listed, and the values that follow plainly from the element itself
 * are staged in another, for review (upgrade-fills.ts).
 */

import { readdir } from "fs/promises";
import { Model } from "./model.js";
import { MigrationRegistry, type ApplyMigrationsResult } from "./migration-registry.js";
import { applyCatalogMigrations, type CatalogMigrationResult } from "./catalog-migration.js";
import {
  droppedRelationshipsOf,
  planDropRecord,
  writeDropRecord,
  type DroppedRelationship,
  type UpgradeDropRecord,
} from "./upgrade-drop-record.js";
import { deriveFills, fillsStagedEarlier, stageFills, type StagedEarlier, type UpgradeFills } from "./upgrade-fills.js";
import { unfilledRequired, validateBaseModel, withoutStaged, type UnfilledRequired } from "./upgrade-validation.js";
import type { ValidationIssue } from "../validators/types.js";
import { BaseSnapshotManager, isContentSnapshot } from "./base-snapshot-manager.js";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";
import { FileLock } from "../utils/file-lock.js";
import { getErrorMessage } from "../utils/errors.js";

export interface ModelUpgradeOptions {
  fromVersion: string;
  toVersion: string;
  /** No migration path exists between the versions: only write the new spec version */
  versionBumpOnly?: boolean;
  /**
   * The model is at the target version but still names retired types, attributes or
   * relationships: apply the catalog migration (element type renames, retired attribute removal
   * and relationship rewrites) on its own
   */
  catalogOnly?: boolean;
  /** Passed to the migrations (default true) */
  validate?: boolean;
  /**
   * Derive values for the required attributes the upgraded model leaves empty and stage them in a
   * changeset for review (default true). Never done when the spec version doesn't change.
   */
  stageFills?: boolean;
}

/** A staged changeset, by directory id and name */
export interface ChangesetRef {
  id: string;
  name: string;
}

export interface ChangesetRebaselineResult {
  /** Staged changesets now based on the upgraded model */
  rebaselined: ChangesetRef[];
  /** Staged changesets that had drifted before the upgrade; they keep their base snapshot */
  drifted: ChangesetRef[];
  /** Changesets that could not be read or re-baselined */
  errors: string[];
}

export interface ModelUpgradeResult {
  /** The migrations applied; absent for a version bump */
  migration?: ApplyMigrationsResult;
  changesets: ChangesetRebaselineResult;
  /**
   * The staged changeset that records the relationships the migration dropped; absent when it
   * dropped none. With `error` set the record could not be written, and the drops are only in
   * `migration`'s details.
   */
  dropRecord?: UpgradeDropRecord;
  /**
   * The upgraded base model's validation errors; absent when it could not be validated
   * (`validationError` says why).
   */
  validationErrors?: ValidationIssue[];
  validationError?: string;
  /**
   * The staged changeset holding the values derived for required attributes the upgraded model
   * leaves empty; absent when none could be derived. With `error` set it could not be written.
   */
  fills?: UpgradeFills;
  /**
   * Values an earlier upgrade already staged in a fills changeset that has not landed: this run
   * stages none of them again. Absent when there are none.
   */
  stagedEarlier?: StagedEarlier[];
  /** The required attributes still empty after the derived values (this run's and earlier ones'), per element */
  unfilled?: UnfilledRequired[];
}

/** Staged changesets sorted by whether they match the model before an upgrade */
export interface ChangesetBaselines {
  /** Snapshot of the model before the upgrade; null when there is no staged changeset */
  snapshot: string | null;
  /**
   * The same model hashed as changesets created before CLI 0.7.0 recorded it
   * (BaseSnapshotManager.captureFullSnapshot); set when a staged changeset carries such a hash.
   */
  fullSnapshot?: string;
  inStep: ChangesetRef[];
  drifted: ChangesetRef[];
  errors: string[];
}

/**
 * Upgrade the model at startPath to options.toVersion and save it, then re-baseline its
 * staged changesets on the upgraded model.
 */
export async function upgradeModel(
  startPath: string,
  options: ModelUpgradeOptions
): Promise<ModelUpgradeResult> {
  // Load every layer, as `dr changeset commit` does before it checks for drift
  const model = await Model.load(startPath, { lazyLoad: false });
  const baselines = await captureChangesetBaselines(model);

  let migration: ApplyMigrationsResult | undefined;
  if (options.versionBumpOnly) {
    model.manifest.specVersion = options.toVersion;
    await model.saveManifest();
  } else if (options.catalogOnly) {
    const catalog = await applyCatalogMigrations(model);
    if (catalog.errors.length > 0) {
      throw new Error(`Catalog migration failed: ${catalog.errors.join("; ")}`);
    }
    migration = {
      applied: [
        {
          from: options.fromVersion,
          to: options.toVersion,
          description: `Catalog changes applied (${catalog.summaries.join("; ")})`,
          changes: {
            migrationsApplied: 1,
            filesModified: catalog.filesModified,
            description: catalog.summaries.join("; "),
            details: catalog.details,
          },
        },
      ],
      currentVersion: options.fromVersion,
      targetVersion: options.toVersion,
      totalChanges: 1,
    };
    // Saving the manifest stamps cli_version with the dr that upgraded the model
    await model.saveManifest();
    await model.saveDirtyLayers();
  } else {
    migration = await new MigrationRegistry().applyMigrations(model, {
      fromVersion: options.fromVersion,
      toVersion: options.toVersion,
      dryRun: false,
      validate: options.validate ?? true,
    });
    await model.saveManifest();
    await model.saveDirtyLayers();
  }

  const changesets = await rebaselineChangesets(startPath, baselines);
  const dropRecord = await recordDrops(model.rootPath, options, droppedByMigration(migration));
  const filled = await fillRequired(model.rootPath, options);
  return { migration, changesets, ...(dropRecord ? { dropRecord } : {}), ...filled };
}

/**
 * Validate the upgraded model as it is on disk, derive the values that follow plainly from each
 * element for the required attributes it leaves empty, and stage them for review. The migration
 * is already saved, so a failure here is reported with the result, not thrown.
 */
async function fillRequired(
  rootPath: string,
  options: ModelUpgradeOptions
): Promise<Pick<ModelUpgradeResult, "validationErrors" | "validationError" | "fills" | "stagedEarlier" | "unfilled">> {
  let upgraded: Model;
  let errors: ValidationIssue[];
  try {
    upgraded = await Model.load(rootPath, { lazyLoad: false });
    errors = (await validateBaseModel(upgraded)).errors;
  } catch (error) {
    return { validationError: getErrorMessage(error) };
  }
  // What an unlanded fills changeset from an earlier run already stages is neither derived again
  // nor listed as left empty: it is waiting for review where it is.
  let stagedEarlier: StagedEarlier[] = [];
  try {
    stagedEarlier = await fillsStagedEarlier(rootPath);
  } catch {
    // An unreadable changeset says nothing about what is staged
  }
  const earlier = stagedEarlier.length > 0 ? { stagedEarlier } : {};
  const unfilled = withoutStaged(
    unfilledRequired(errors),
    stagedEarlier.flatMap((entry) => entry.fills)
  );
  if (unfilled.length === 0 || options.stageFills === false || options.fromVersion === options.toVersion) {
    return { validationErrors: errors, ...earlier, ...(unfilled.length > 0 ? { unfilled } : {}) };
  }
  const derived = deriveFills(upgraded, unfilled);
  const fills = await stageFills(rootPath, options, derived.fills);
  return {
    validationErrors: errors,
    ...(fills ? { fills } : {}),
    ...earlier,
    // A changeset that could not be written fills nothing
    ...(fills && !fills.error
      ? derived.left.length > 0
        ? { unfilled: derived.left }
        : {}
      : unfilled.length > 0
        ? { unfilled }
        : {}),
  };
}

/** The relationships the applied migration steps dropped for want of a replacement */
export function droppedByMigration(migration: ApplyMigrationsResult | undefined): DroppedRelationship[] {
  const details: Pick<CatalogMigrationResult["details"], "relationshipChanges" | "stagedRelationshipChanges"> = {
    relationshipChanges: [],
    stagedRelationshipChanges: [],
  };
  for (const step of migration?.applied ?? []) {
    const stepDetails = step.changes?.details as Partial<CatalogMigrationResult["details"]> | undefined;
    details.relationshipChanges.push(...(stepDetails?.relationshipChanges ?? []));
    details.stagedRelationshipChanges.push(...(stepDetails?.stagedRelationshipChanges ?? []));
  }
  return droppedRelationshipsOf(details);
}

/**
 * Write the upgrade record. The migration is already on disk, so a failure here is reported with
 * the result, not thrown: the drops are still in the migration's details.
 */
async function recordDrops(
  rootPath: string,
  versions: { fromVersion: string; toVersion: string },
  drops: DroppedRelationship[]
): Promise<UpgradeDropRecord | undefined> {
  if (drops.length === 0) {
    return undefined;
  }
  try {
    return await writeDropRecord(rootPath, versions, drops);
  } catch (error) {
    const planned = await planDropRecord(rootPath, versions.toVersion, drops).catch(() => undefined);
    return {
      name: planned?.name ?? `upgrade-drops-${versions.toVersion}`,
      count: drops.length,
      byType: planned?.byType ?? [],
      error: getErrorMessage(error),
    };
  }
}

/**
 * Hash the model and sort its staged changesets into those whose base snapshot matches it
 * and those that had drifted from it. Call before the model changes.
 *
 * @param model - loaded with lazyLoad: false, as `dr changeset commit` loads it, because the
 *   snapshot hashes every loaded layer
 */
export async function captureChangesetBaselines(model: Model): Promise<ChangesetBaselines> {
  if (model.lazyLoad) {
    throw new Error("captureChangesetBaselines needs a model loaded with lazyLoad: false");
  }

  const { changesets, errors } = await listStagedChangesets(model.rootPath);
  const baselines: ChangesetBaselines = { snapshot: null, inStep: [], drifted: [], errors };
  if (changesets.length === 0) {
    return baselines;
  }

  const snapshots = new BaseSnapshotManager();
  const snapshot = await snapshots.captureSnapshot(model);
  baselines.snapshot = snapshot;
  for (const { ref, baseSnapshot } of changesets) {
    // A changeset without a base snapshot never reports drift, so it needs no re-baseline
    if (!baseSnapshot) {
      continue;
    }
    // Each recorded hash is compared with one made the same way (base-snapshot-manager.ts)
    if (!isContentSnapshot(baseSnapshot)) {
      baselines.fullSnapshot ??= await snapshots.captureFullSnapshot(model);
    }
    const now = isContentSnapshot(baseSnapshot) ? snapshot : baselines.fullSnapshot;
    (baseSnapshot === now ? baselines.inStep : baselines.drifted).push(ref);
  }
  return baselines;
}

/**
 * Point the changesets that were in step before the upgrade at the upgraded model. Call after
 * the upgraded model is saved.
 *
 * @param startPath - the path the model was loaded from before the upgrade
 */
export async function rebaselineChangesets(
  startPath: string,
  baselines: ChangesetBaselines
): Promise<ChangesetRebaselineResult> {
  const result: ChangesetRebaselineResult = {
    rebaselined: [],
    drifted: baselines.drifted,
    errors: [...baselines.errors],
  };
  if (baselines.inStep.length === 0) {
    return result;
  }

  // Reload rather than hash the model in memory: migrations may rewrite files on disk
  // without updating it, and the commit hashes what it loads from disk
  const upgraded = await Model.load(startPath, { lazyLoad: false });
  const snapshot = await new BaseSnapshotManager().captureSnapshot(upgraded);
  const storage = new StagedChangesetStorage(upgraded.rootPath);

  for (const ref of baselines.inStep) {
    try {
      await new FileLock(storage.getChangesetPath(ref.id)).withLock(async () => {
        const changeset = await storage.load(ref.id);
        // Skip a changeset whose status or base changed while the upgrade ran
        if (
          !changeset ||
          changeset.status !== "staged" ||
          (changeset.baseSnapshot !== baselines.snapshot && changeset.baseSnapshot !== baselines.fullSnapshot)
        ) {
          return;
        }
        changeset.baseSnapshot = snapshot;
        changeset.updateModified();
        await storage.save(changeset);
        result.rebaselined.push(ref);
      });
    } catch (error) {
      result.errors.push(
        `Could not re-baseline changeset '${ref.name}': ${getErrorMessage(error)}; it lands with a drift warning until it is re-baselined`
      );
    }
  }
  return result;
}

async function listStagedChangesets(rootPath: string): Promise<{
  changesets: Array<{ ref: ChangesetRef; baseSnapshot: string | undefined }>;
  errors: string[];
}> {
  const storage = new StagedChangesetStorage(rootPath);
  const changesets: Array<{ ref: ChangesetRef; baseSnapshot: string | undefined }> = [];
  const errors: string[] = [];

  let ids: string[];
  try {
    ids = (await readdir(storage.getChangesetsDir(), { withFileTypes: true }))
      // FileLock keeps "<changeset>.lock" directories beside the changesets
      .filter((entry) => entry.isDirectory() && !entry.name.endsWith(".lock"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") {
      errors.push(`Could not list changesets: ${getErrorMessage(error)}`);
    }
    return { changesets, errors };
  }

  for (const id of ids) {
    try {
      const changeset = await storage.load(id);
      // An upgrade record never lands, so it has no base to keep in step
      if (changeset?.status === "staged" && changeset.purpose !== "upgrade-record") {
        changesets.push({
          ref: { id, name: changeset.name || id },
          baseSnapshot: changeset.baseSnapshot,
        });
      }
    } catch (error) {
      errors.push(`Could not read changeset '${id}': ${getErrorMessage(error)}`);
    }
  }
  return { changesets, errors };
}
