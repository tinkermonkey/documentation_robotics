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
 */

import { readdir } from "fs/promises";
import { Model } from "./model.js";
import { MigrationRegistry, type ApplyMigrationsResult } from "./migration-registry.js";
import { BaseSnapshotManager } from "./base-snapshot-manager.js";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";
import { FileLock } from "../utils/file-lock.js";
import { getErrorMessage } from "../utils/errors.js";

export interface ModelUpgradeOptions {
  fromVersion: string;
  toVersion: string;
  /** No migration path exists between the versions: only write the new spec version */
  versionBumpOnly?: boolean;
  /** Passed to the migrations (default true) */
  validate?: boolean;
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
}

/** Staged changesets sorted by whether they match the model before an upgrade */
export interface ChangesetBaselines {
  /** Snapshot of the model before the upgrade; null when there is no staged changeset */
  snapshot: string | null;
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

  return { migration, changesets: await rebaselineChangesets(startPath, baselines) };
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

  const snapshot = await new BaseSnapshotManager().captureSnapshot(model);
  baselines.snapshot = snapshot;
  for (const { ref, baseSnapshot } of changesets) {
    // A changeset without a base snapshot never reports drift, so it needs no re-baseline
    if (!baseSnapshot) {
      continue;
    }
    (baseSnapshot === snapshot ? baselines.inStep : baselines.drifted).push(ref);
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
          changeset.baseSnapshot !== baselines.snapshot
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
        `Could not re-baseline changeset '${ref.name}': ${getErrorMessage(error)}; committing it needs --force`
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
      if (changeset?.status === "staged") {
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
