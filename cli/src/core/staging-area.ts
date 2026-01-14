/**
 * StagingAreaManager - Manages staged changesets and interception logic
 *
 * Provides:
 * - Changeset lifecycle management (create, load, list, delete)
 * - Staging operations (stage, unstage, discard)
 * - Commit operations with drift detection and validation
 * - Base snapshot tracking for drift detection
 */

import path from 'path';
import { StagedChangesetStorage } from './staged-changeset-storage.js';
import { BaseSnapshotManager } from './base-snapshot-manager.js';
import { Changeset, StagedChange } from './changeset.js';
import { ChangesetValidator } from './changeset-validator.js';
import { fileExists } from '../utils/file-io.js';
import type { Model } from './model.js';

/**
 * Options for commit operation
 */
export interface CommitOptions {
  force?: boolean;        // Ignore drift warnings
  validate?: boolean;     // Run validation (default: true)
  dryRun?: boolean;       // Preview without applying
}

/**
 * Drift report for change detection
 */
export interface DriftReport {
  isDrifted: boolean;
  baseSnapshotId: string;
  currentSnapshotId: string;
  changedElements: {
    elementId: string;
    layerName: string;
    type: 'added' | 'modified' | 'deleted';
  }[];
  warnings: string[];
}

/**
 * Result of commit operation
 */
export interface CommitResult {
  changeset: string;
  committed: number;
  failed: number;
  validation: {
    passed: boolean;
    errors: string[];
  };
  driftWarning?: DriftReport;
}

/**
 * StagingAreaManager provides changeset and staging operations
 */
export class StagingAreaManager {
  private storage: StagedChangesetStorage;
  private snapshotManager: BaseSnapshotManager;
  private validator: ChangesetValidator;
  private projectionEngine: any; // VirtualProjectionEngine (lazy loaded to avoid circular dependency)
  private rootPath: string;
  private model: Model | null = null;

  constructor(rootPath: string, model?: Model) {
    this.rootPath = rootPath;
    this.model = model || null;
    this.storage = new StagedChangesetStorage(rootPath);
    this.snapshotManager = new BaseSnapshotManager();
    this.validator = new ChangesetValidator(rootPath);
    this.projectionEngine = null; // Lazy loaded
  }

  /**
   * Get or create projection engine instance
   */
  private async getProjectionEngine(): Promise<any> {
    if (!this.projectionEngine) {
      const { VirtualProjectionEngine } = await import('./virtual-projection.js');
      this.projectionEngine = new VirtualProjectionEngine(this.rootPath);
    }
    return this.projectionEngine;
  }

  /**
   * Create a new staged changeset
   */
  async create(name: string, description?: string): Promise<Changeset> {
    if (!this.model) {
      throw new Error('Model required for creating changesets');
    }
    const id = this.generateChangesetId();
    const baseSnapshotId = await this.snapshotManager.captureSnapshot(this.model);

    const changeset = await this.storage.create(id, name, description, baseSnapshotId);
    changeset.id = id;
    return changeset;
  }

  /**
   * Load a changeset by name or ID
   */
  async load(name: string): Promise<Changeset | null> {
    // Try loading directly as ID first
    let changeset = await this.storage.load(name);
    if (changeset) {
      return changeset;
    }

    // If not found by ID, search by name in all changesets
    const all = await this.storage.list();
    return all.find((cs) => cs.name === name) || null;
  }

  /**
   * List all staged changesets
   */
  async list(): Promise<Changeset[]> {
    return this.storage.list();
  }

  /**
   * Delete a changeset
   */
  async delete(name: string): Promise<void> {
    const changeset = await this.load(name);
    if (!changeset) {
      throw new Error(`Changeset '${name}' not found`);
    }

    if (!changeset.id) {
      throw new Error(`Changeset '${name}' has no ID and cannot be deleted`);
    }

    await this.storage.delete(changeset.id);
  }

  /**
   * Stage a change in the changeset
   * Blocks model mutation and records change in staging area
   */
  async stage(changesetId: string, change: Omit<StagedChange, 'sequenceNumber'>): Promise<void> {
    const changeset = await this.storage.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    // Only allow staging when status is 'staged'
    if (changeset.status !== 'staged') {
      throw new Error(
        `Cannot stage changes on changeset with status '${changeset.status}'. ` +
        `Changeset must have status 'staged' to accept new changes.`
      );
    }

    const stagedChange: StagedChange = {
      ...change,
      timestamp: change.timestamp || new Date().toISOString(),
      sequenceNumber: changeset.changes.length,
    };

    await this.storage.addChange(changesetId, stagedChange);

    // Invalidate projection cache for this layer
    const engine = await this.getProjectionEngine();
    engine.invalidateOnStage(changesetId, change.layerName);
  }

  /**
   * Unstage a specific element from the changeset
   * Removes all changes for the element and resequences remaining
   */
  async unstage(changesetId: string, elementId: string): Promise<void> {
    const changeset = await this.storage.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    if (changeset.status !== 'staged') {
      throw new Error(
        `Cannot unstage changes on changeset with status '${changeset.status}'. ` +
        `Changeset must have status 'staged'.`
      );
    }

    // Remove change and resequence
    await this.storage.removeChange(changesetId, elementId);

    // Invalidate projection cache (all layers since we don't know which layer the element was in)
    const engine = await this.getProjectionEngine();
    engine.invalidateOnUnstage(changesetId);
  }

  /**
   * Discard all changes in the changeset
   * Clears changes and sets status to 'discarded'
   */
  async discard(changesetId: string): Promise<void> {
    const changeset = await this.storage.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    // Clear changes and update status
    changeset.changes = [];
    changeset.status = 'discarded';
    // Note: stats auto-computed from changes array (will be 0/0/0)
    changeset.updateModified();

    await this.storage.save(changeset);

    // Invalidate all projections for this changeset
    const engine = await this.getProjectionEngine();
    engine.invalidateOnDiscard(changesetId);
  }

  /**
   * Capture a base snapshot for drift detection
   */
  async captureBaseSnapshot(changesetId: string): Promise<string> {
    if (!this.model) {
      throw new Error('Model required for capturing base snapshot');
    }
    const changeset = await this.storage.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    const snapshotId = await this.snapshotManager.captureSnapshot(this.model);
    changeset.baseSnapshot = snapshotId;
    changeset.updateModified();
    await this.storage.save(changeset);

    return snapshotId;
  }

  /**
   * Detect drift by comparing base snapshot to current model state
   */
  async detectDrift(changesetId: string): Promise<DriftReport> {
    if (!this.model) {
      throw new Error('Model required for drift detection');
    }
    const changeset = await this.storage.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    if (!changeset.baseSnapshot) {
      return {
        isDrifted: false,
        baseSnapshotId: 'unknown',
        currentSnapshotId: 'unknown',
        changedElements: [],
        warnings: ['No base snapshot available for drift detection'],
      };
    }

    // Capture current snapshot to compare against base
    const currentSnapshotId = await this.snapshotManager.captureSnapshot(this.model);

    // Note: BaseSnapshotManager works with hashes, not full snapshot objects
    // Drift detection is limited to comparing snapshot IDs (hashes)
    // Full element-level diff detection would require storing complete snapshot data
    const isDrifted = changeset.baseSnapshot !== currentSnapshotId;

    const warnings: string[] = [];
    const changedElements: DriftReport['changedElements'] = [];

    if (isDrifted) {
      warnings.push(
        `Model has drifted since changeset creation (base snapshot hash differs from current)`
      );
    }

    return {
      isDrifted,
      baseSnapshotId: changeset.baseSnapshot,
      currentSnapshotId: currentSnapshotId,
      changedElements,
      warnings,
    };
  }

  /**
   * Commit a changeset to the base model
   *
   * Implements atomic commit with the following steps:
   * 1. Detect drift (throw unless --force)
   * 2. Validate against projected model (validation errors always block)
   * 3. Backup current model state
   * 4. Apply all changes in sequence order
   * 5. Save all modified layers
   * 6. Update changeset status and history
   * 7. Rollback on any failure
   */
  async commit(model: Model, changesetId: string, options: CommitOptions = {}): Promise<CommitResult> {
    const changeset = await this.storage.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    const isDryRun = options.dryRun === true;
    const shouldValidate = options.validate !== false;

    // Step 1: Detect drift and throw if drifted without --force
    const drift = await this.detectDrift(changesetId);
    if (drift.isDrifted && !options.force) {
      throw new Error(
        `Base model has drifted since changeset creation. ` +
        `Use --force to commit anyway. Affected elements: ${drift.changedElements.map(e => e.elementId).join(', ')}`
      );
    }

    const result: CommitResult = {
      changeset: changeset.name,
      committed: 0,
      failed: 0,
      validation: {
        passed: true,
        errors: [],
      },
    };

    // Step 2: Validate against projected model (force cannot override validation)
    if (shouldValidate) {
      const validation = await this.validator.validateChangeset(model, changesetId);
      if (!validation.isValid()) {
        result.validation.passed = false;
        result.validation.errors = validation.errors.map(e => e.message);
        throw new Error(
          `Validation failed: ${result.validation.errors.join('; ')}`
        );
      }
    }

    // Step 3: Dry run early exit (before making any changes)
    if (isDryRun) {
      result.committed = changeset.changes.length;
      if (drift.isDrifted) {
        result.driftWarning = drift;
      }
      return result;
    }

    // Step 4: Backup model state for atomic rollback
    const backup = await this.backupModel(model);

    try {
      // Step 5: Apply all changes sequentially by sequence number
      const sortedChanges = [...(changeset.changes as StagedChange[])].sort(
        (a, b) => a.sequenceNumber - b.sequenceNumber
      );

      for (const change of sortedChanges) {
        try {
          const layer = await model.getLayer(change.layerName);
          if (!layer) {
            throw new Error(`Layer '${change.layerName}' not found`);
          }

          if (change.type === 'add' && change.after) {
            const elements = layer.listElements();
            const elementExists = elements.some((e) => e.id === change.elementId);

            if (!elementExists) {
              const { Element } = await import('./element.js');
              const elementData = change.after as Record<string, unknown>;
              const element = new Element({
                id: change.elementId,
                type: (elementData.type as string) || 'unknown',
                name: (elementData.name as string) || change.elementId,
                description: elementData.description as string | undefined,
                properties: elementData,
              });
              layer.addElement(element);
              result.committed++;
            }
          } else if (change.type === 'update' && change.after) {
            const element = layer.getElement(change.elementId);
            if (element) {
              const elementData = change.after as Record<string, unknown>;
              Object.assign(element, elementData);
              result.committed++;
            }
          } else if (change.type === 'delete') {
            const element = layer.getElement(change.elementId);
            if (element) {
              layer.deleteElement(change.elementId);
              result.committed++;
            }
          }
        } catch (error) {
          result.failed++;
          result.validation.passed = false;
          result.validation.errors.push(
            `Failed to apply change to ${change.elementId}: ${error instanceof Error ? error.message : String(error)}`
          );
          throw new Error(
            `Atomic commit failed at change ${sortedChanges.indexOf(change) + 1}/${sortedChanges.length}: ` +
            `${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Step 6: Save all modified layers atomically
      const modifiedLayers = new Set<string>();
      for (const change of sortedChanges) {
        modifiedLayers.add(change.layerName);
      }

      for (const layerName of modifiedLayers) {
        await model.saveLayer(layerName);
      }

      // Step 7: Update changeset status to committed
      changeset.status = 'committed';
      changeset.updateModified();
      await this.storage.save(changeset);

      // Step 8: Add changeset to manifest history
      if (!model.manifest.changeset_history) {
        model.manifest.changeset_history = [];
      }
      model.manifest.changeset_history.push({
        name: changeset.name,
        applied_at: new Date().toISOString(),
        action: 'applied',
      });

      // Step 9: Save manifest with updated changeset history
      await model.saveManifest();

      // Step 10: Clean up backup directory after successful commit
      await this.cleanupBackup(backup);

      return result;

    } catch (commitError) {
      // Step 8: Rollback on any failure - restore from backup
      try {
        await this.restoreModel(model, backup);
        // Rollback succeeded, throw original commit error
        throw commitError;
      } catch (rollbackError) {
        // CRITICAL: Rollback failed - model may be corrupted
        const compositeMessage =
          `Commit failed AND rollback failed. Model may be in corrupted state.\n` +
          `\n` +
          `Original commit error:\n` +
          `  ${commitError instanceof Error ? commitError.message : String(commitError)}\n` +
          `\n` +
          `Rollback error:\n` +
          `  ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}\n` +
          `\n` +
          `Backup location: ${backup}\n` +
          `Manual recovery may be required.`;

        const { CLIError } = await import('../utils/errors.js');
        throw new CLIError(compositeMessage, 1, [
          `Manually restore from backup: ${backup}`,
          `Copy manifest.json from backup to ${path.join(model.rootPath, 'documentation-robotics')}`,
          `Copy layer files from ${path.join(backup, 'layers')} to ${path.join(model.rootPath, 'documentation-robotics', 'layers')}`,
          `Run 'dr validate' after manual restoration`,
          `Contact support if issue persists`
        ]);
      }
    }
  }

  /**
   * Check if a changeset is currently active
   */
  async isActive(changesetId: string): Promise<boolean> {
    const activePath = path.join(this.rootPath, 'documentation-robotics', 'changesets', '.active');
    if (!(await fileExists(activePath))) {
      return false;
    }

    const { readFile } = await import('../utils/file-io.js');
    const activeId = await readFile(activePath);
    return activeId.trim() === changesetId;
  }

  /**
   * Set a changeset as active
   * Also transitions the changeset status to 'staged' to enable interception
   */
  async setActive(changesetId: string): Promise<void> {
    const changeset = await this.storage.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    // Transition to 'staged' status to enable interception
    if (changeset.status !== 'staged') {
      changeset.markStaged();
      await this.storage.save(changeset);
    }

    const { writeFile, ensureDir } = await import('../utils/file-io.js');
    const changesetDir = path.join(this.rootPath, 'documentation-robotics', 'changesets');
    await ensureDir(changesetDir);

    const activePath = path.join(changesetDir, '.active');
    await writeFile(activePath, changesetId);
  }

  /**
   * Clear the active changeset
   */
  async clearActive(): Promise<void> {
    const { writeFile } = await import('../utils/file-io.js');
    const activePath = path.join(this.rootPath, 'documentation-robotics', 'changesets', '.active');

    if (await fileExists(activePath)) {
      await writeFile(activePath, '');
    }
  }

  /**
   * Get the currently active changeset
   */
  async getActive(): Promise<Changeset | null> {
    const activePath = path.join(this.rootPath, 'documentation-robotics', 'changesets', '.active');

    if (!(await fileExists(activePath))) {
      return null;
    }

    const { readFile } = await import('../utils/file-io.js');
    const activeId = await readFile(activePath);
    const id = activeId.trim();

    if (!id) {
      return null;
    }

    return this.storage.load(id);
  }

  /**
   * Backup the current model state for atomic rollback
   *
   * Creates a temporary backup by copying all layer files and manifest.
   * Validates backup completeness and integrity before returning.
   * Used to restore model state if commit fails.
   */
  private async backupModel(model: Model): Promise<string> {
    const backupDir = path.join(
      this.rootPath,
      'documentation-robotics',
      '.backups',
      `backup-${Date.now()}`
    );

    const { ensureDir, readFile, atomicWrite } = await import('../utils/file-io.js');
    const { createHash } = await import('crypto');

    await ensureDir(backupDir);

    // Track what we're backing up for validation
    const backupManifest: {
      files: Array<{ path: string; checksum: string; size: number }>;
      timestamp: string;
    } = {
      files: [],
      timestamp: new Date().toISOString()
    };

    try {
      // Backup manifest - try both .yaml and .json formats
      let manifestPath = path.join(model.rootPath, 'documentation-robotics', 'model', 'manifest.yaml');
      if (!(await fileExists(manifestPath))) {
        manifestPath = path.join(model.rootPath, 'documentation-robotics', 'manifest.json');
      }
      if (!(await fileExists(manifestPath))) {
        throw new Error('Manifest file not found in expected locations');
      }

      const manifestContent = await readFile(manifestPath);
      const manifestChecksum = createHash('sha256').update(manifestContent).digest('hex');
      const manifestFilename = path.basename(manifestPath);

      await atomicWrite(path.join(backupDir, manifestFilename), manifestContent);
      backupManifest.files.push({
        path: manifestFilename,
        checksum: manifestChecksum,
        size: manifestContent.length
      });

      // Backup all layers - handle multiple YAML files per layer
      const layersDir = path.join(backupDir, 'layers');
      await ensureDir(layersDir);

      const fs = await import('fs/promises');

      for (const layer of model.layers.values()) {
        const layerBackupDir = path.join(layersDir, layer.name);
        await ensureDir(layerBackupDir);

        // Find the layer directory in the model
        const layerDirPath = await this.findLayerDirectory(model.rootPath, layer.name);
        if (!layerDirPath) {
          continue;
        }

        // Backup all YAML files in the layer directory
        const files = await fs.readdir(layerDirPath);
        for (const file of files) {
          if (file.endsWith('.yaml') || file.endsWith('.yml')) {
            const filePath = path.join(layerDirPath, file);
            const fileContent = await readFile(filePath);
            const fileChecksum = createHash('sha256').update(fileContent).digest('hex');

            await atomicWrite(path.join(layerBackupDir, file), fileContent);
            backupManifest.files.push({
              path: `layers/${layer.name}/${file}`,
              checksum: fileChecksum,
              size: fileContent.length
            });
          }
        }
      }

      // Write backup manifest for validation
      await atomicWrite(
        path.join(backupDir, '.backup-manifest.json'),
        JSON.stringify(backupManifest, null, 2)
      );

      // Validate backup completeness
      await this.validateBackup(backupDir, backupManifest);

      return backupDir;

    } catch (error) {
      // Clean up incomplete backup
      try {
        const { rm } = await import('node:fs/promises');
        await rm(backupDir, { recursive: true, force: true });
      } catch {
        // Warn but don't throw - original error is more important
        console.warn(`Warning: Failed to clean up incomplete backup at ${backupDir}`);
      }

      throw new Error(
        `Failed to create backup: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validate that backup is complete and matches source files
   */
  private async validateBackup(
    backupDir: string,
    manifest: { files: Array<{ path: string; checksum: string; size: number }> }
  ): Promise<void> {
    const { readFile, fileExists } = await import('../utils/file-io.js');
    const { createHash } = await import('crypto');

    for (const file of manifest.files) {
      const backupFilePath = path.join(backupDir, file.path);

      // Verify file exists
      if (!(await fileExists(backupFilePath))) {
        throw new Error(`Backup validation failed: ${file.path} not found in backup`);
      }

      // Verify checksum matches
      const content = await readFile(backupFilePath);
      const checksum = createHash('sha256').update(content).digest('hex');

      if (checksum !== file.checksum) {
        throw new Error(
          `Backup validation failed: ${file.path} checksum mismatch (expected ${file.checksum}, got ${checksum})`
        );
      }

      // Verify size matches
      if (content.length !== file.size) {
        throw new Error(
          `Backup validation failed: ${file.path} size mismatch (expected ${file.size}, got ${content.length})`
        );
      }
    }
  }

  /**
   * Clean up a backup directory after successful commit
   *
   * Removes the backup directory and all its contents to prevent disk accumulation
   */
  private async cleanupBackup(backupDir: string): Promise<void> {
    try {
      const { rm } = await import('node:fs/promises');
      await rm(backupDir, { recursive: true, force: true });
    } catch (error) {
      // Log cleanup failures but don't throw - successful commits shouldn't fail due to cleanup
      console.warn(`Failed to clean up backup directory ${backupDir}:`, error);
    }
  }

  /**
   * Restore model state from backup after failed commit
   *
   * Performs defensive restoration with per-file error handling.
   * Tracks restoration progress and provides detailed error reporting.
   */
  private async restoreModel(model: Model, backupDir: string): Promise<void> {
    const { readFile, fileExists, atomicWrite } = await import('../utils/file-io.js');

    const restoredFiles: string[] = [];
    const failedFiles: Array<{ path: string; error: string }> = [];

    try {
      // Restore manifest first (most critical) - try both .yaml and .json
      let backupManifestFile = path.join(backupDir, 'manifest.yaml');
      let manifestDestPath = path.join(model.rootPath, 'documentation-robotics', 'model', 'manifest.yaml');

      if (!(await fileExists(backupManifestFile))) {
        backupManifestFile = path.join(backupDir, 'manifest.json');
        manifestDestPath = path.join(model.rootPath, 'documentation-robotics', 'manifest.json');
      }

      try {
        if (!(await fileExists(backupManifestFile))) {
          throw new Error('Backup manifest file not found (tried .yaml and .json)');
        }

        const manifestContent = await readFile(backupManifestFile);
        await atomicWrite(manifestDestPath, manifestContent);
        restoredFiles.push(path.basename(backupManifestFile));
      } catch (error) {
        failedFiles.push({
          path: path.basename(backupManifestFile),
          error: error instanceof Error ? error.message : String(error)
        });
        // Manifest is critical - throw immediately
        throw new Error(
          `Failed to restore ${path.basename(backupManifestFile)}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Restore all layer files with defensive error handling
      const backupLayersDir = path.join(backupDir, 'layers');
      const fs = await import('fs/promises');

      for (const layer of model.layers.values()) {
        const backupLayerDir = path.join(backupLayersDir, layer.name);

        try {
          if (await fileExists(backupLayerDir)) {
            // Find the correct destination directory for this layer
            const layerDirPath = await this.findLayerDirectory(model.rootPath, layer.name);

            if (!layerDirPath) {
              console.warn(`Warning: Could not find destination directory for layer ${layer.name}, skipping`);
              continue;
            }

            // Restore all YAML files from backup
            const backupFiles = await fs.readdir(backupLayerDir);
            for (const file of backupFiles) {
              if (file.endsWith('.yaml') || file.endsWith('.yml')) {
                const backupFilePath = path.join(backupLayerDir, file);
                const destFilePath = path.join(layerDirPath, file);
                const fileContent = await readFile(backupFilePath);
                await atomicWrite(destFilePath, fileContent);
                restoredFiles.push(`layers/${layer.name}/${file}`);
              }
            }
          } else {
            // Layer directory doesn't exist in backup - log but continue
            console.warn(`Warning: Layer ${layer.name} not found in backup, skipping`);
          }
        } catch (error) {
          // Track failure but continue with other layers
          const errorMessage = error instanceof Error ? error.message : String(error);
          failedFiles.push({
            path: `layers/${layer.name}`,
            error: errorMessage
          });
          console.warn(`Warning: Failed to restore layer ${layer.name}: ${errorMessage}`);
        }
      }

      // Reload model layers to reflect restored state
      model.layers.clear();

      // If any files failed to restore, report but don't throw (manifest was restored)
      if (failedFiles.length > 0) {
        console.warn(
          `Warning: Restore completed with ${failedFiles.length} failures:\n` +
          failedFiles.map(f => `  - ${f.path}: ${f.error}`).join('\n')
        );
      }

    } catch (error) {
      // Critical failure during restore
      const errorMessage = error instanceof Error ? error.message : String(error);
      const summary =
        `Model restoration failed: ${errorMessage}\n` +
        `\n` +
        `Restoration progress:\n` +
        `  Successfully restored: ${restoredFiles.length} files\n` +
        `  Failed to restore: ${failedFiles.length} files\n` +
        `\n` +
        `Restored files:\n${restoredFiles.map(f => `  ✓ ${f}`).join('\n')}\n` +
        `\n` +
        `Failed files:\n${failedFiles.map(f => `  ✗ ${f.path}: ${f.error}`).join('\n')}\n` +
        `\n` +
        `Backup location: ${backupDir}`;

      throw new Error(summary);
    }
  }

  /**
   * Find the directory path for a layer
   * Follows same discovery logic as Model.loadLayer
   */
  private async findLayerDirectory(rootPath: string, layerName: string): Promise<string | null> {
    const fs = await import('fs/promises');
    const modelDir = path.join(rootPath, 'documentation-robotics', 'model');

    try {
      const entries = await fs.readdir(modelDir, { withFileTypes: true });
      const layerDir = entries.find(e =>
        e.isDirectory() && e.name.match(/^\d{2}_/) &&
        e.name.replace(/^\d{2}_/, '') === layerName
      );

      if (layerDir) {
        return path.join(modelDir, layerDir.name);
      }
    } catch {
      // Model directory doesn't exist or can't be read
    }

    return null;
  }

  /**
   * Generate a unique changeset ID
   */
  private generateChangesetId(): string {
    return `changeset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
