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
import type { VirtualProjectionEngine } from './virtual-projection.js';

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
  private projectionEngine: VirtualProjectionEngine | null = null;
  private rootPath: string;
  private model: Model | null = null;

  constructor(rootPath: string, model?: Model) {
    this.rootPath = rootPath;
    this.model = model || null;
    this.storage = new StagedChangesetStorage(rootPath);
    this.snapshotManager = new BaseSnapshotManager();
    this.validator = new ChangesetValidator(rootPath);
    this.projectionEngine = null; // Lazy loaded on first call to getProjectionEngine()
  }

  /**
   * Validate changeset ID format and content
   * Ensures ID is safe and provides early validation before file operations
   *
   * Validation rules:
   * - Must be a non-empty string
   * - Cannot contain path separators (.., /, \)
   * - Cannot contain special characters (<>:"|?*)
   * - During storage, the ID will be normalized: lowercase, spaces→hyphens, non-alphanumeric→stripped
   *
   * @param changesetId - The changeset ID to validate
   * @throws Error if ID contains invalid characters or structure
   */
  private validateChangesetId(changesetId: string): void {
    if (!changesetId || typeof changesetId !== 'string') {
      throw new Error('Changeset ID must be a non-empty string');
    }

    if (changesetId.trim() === '') {
      throw new Error('Changeset ID cannot be empty or whitespace-only');
    }

    // Check for path traversal attempts
    if (changesetId.includes('..') || changesetId.includes('/') || changesetId.includes('\\')) {
      throw new Error('Changeset ID cannot contain path separators or traversal sequences (..)');
    }

    // Check for special characters that could cause issues
    // Note: sanitizeId() will normalize the ID by converting to lowercase, replacing spaces with hyphens,
    // and removing all non-alphanumeric characters (except hyphens)
    if (/[<>:"|?*]/.test(changesetId)) {
      throw new Error(
        'Changeset ID contains invalid special characters (<>:"|?*). ' +
        'Only alphanumeric characters and hyphens are preserved. ' +
        'Spaces are converted to hyphens, and other characters are removed during storage.'
      );
    }
  }

  /**
   * Get or create projection engine instance (lazy initialization).
   * Deferred initialization avoids circular dependency issues at module load time.
   * @returns VirtualProjectionEngine instance for computing merged model views
   */
  private async getProjectionEngine(): Promise<VirtualProjectionEngine> {
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
   * If the changeset being deleted is the currently active changeset,
   * this method will also clear the active changeset marker.
   */
  async delete(name: string): Promise<void> {
    const changeset = await this.load(name);
    if (!changeset) {
      throw new Error(`Changeset '${name}' not found`);
    }

    if (!changeset.id) {
      throw new Error(`Changeset '${name}' has no ID and cannot be deleted`);
    }

    // Check if this changeset is the active one and clear it if so
    const activeChangeset = await this.getActive();
    if (activeChangeset && activeChangeset.id === changeset.id) {
      await this.clearActive();
    }

    await this.storage.delete(changeset.id);
  }

  /**
   * Stage a change in the changeset.
   * Records the change in the staging area without applying to the base model.
   * The changeset must be in 'staged' status to accept new changes.
   *
   * @param changesetId - ID of the changeset to stage the change in
   * @param change - The change to stage (type, elementId, layerName, before/after snapshots)
   * @throws Error if changeset ID is invalid, changeset not found, or not in 'staged' status
   */
  async stage(changesetId: string, change: Omit<StagedChange, 'sequenceNumber'>): Promise<void> {
    this.validateChangesetId(changesetId);

    const changeset = await this.storage.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    // Only allow staging when status is 'staged' (not 'committed' or 'discarded')
    if (changeset.status !== 'staged') {
      throw new Error(
        `Cannot stage changes on changeset with status '${changeset.status}'. ` +
        `Changeset must have status 'staged' to accept new changes.`
      );
    }

    const stagedChange: StagedChange = {
      ...change,
      timestamp: change.timestamp || new Date().toISOString(),
      sequenceNumber: -1, // Will be assigned by storage layer
    };

    await this.storage.addChange(changesetId, stagedChange);

    // Invalidate projection cache for this layer
    const engine = await this.getProjectionEngine();
    engine.invalidateOnStage(changesetId, change.layerName);
  }

  /**
   * Unstage a specific element from the changeset.
   * Removes all changes associated with the element.
   * The changeset must be in 'staged' status.
   *
   * @param changesetId - ID of the changeset to unstage from
   * @param elementId - ID of the element to remove all changes for
   * @throws Error if changeset ID is invalid, changeset not found, or not in 'staged' status
   */
  async unstage(changesetId: string, elementId: string): Promise<void> {
    this.validateChangesetId(changesetId);

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

    // Remove the element's changes and resequence remaining changes
    await this.storage.removeChange(changesetId, elementId);

    // Invalidate projection cache for the removed element's layers
    const engine = await this.getProjectionEngine();
    await engine.invalidateOnUnstage(changesetId, elementId);
  }

  /**
   * Discard all changes in the changeset.
   * Clears all staged changes and marks the changeset as 'discarded'.
   * This operation is irreversible for the changeset but does not affect the base model.
   *
   * @param changesetId - ID of the changeset to discard
   * @throws Error if changeset ID is invalid or changeset not found
   */
  async discard(changesetId: string): Promise<void> {
    this.validateChangesetId(changesetId);

    const changeset = await this.storage.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    // Clear all staged changes and update status
    changeset.changes = [];
    changeset.status = 'discarded';
    // Note: stats are auto-computed from changes array (will be 0/0/0 after clearing)
    changeset.updateModified();

    await this.storage.save(changeset);

    // Invalidate all projection cache entries for this changeset
    const engine = await this.getProjectionEngine();
    engine.invalidateOnDiscard(changesetId);
  }

  /**
   * Capture a base snapshot of the current model state for drift detection.
   * Stores a hash of the model that can be compared later to detect changes.
   *
   * @param changesetId - ID of the changeset to capture snapshot for
   * @returns SHA256 hash of the current model state
   * @throws Error if changeset not found or model not available
   */
  async captureBaseSnapshot(changesetId: string): Promise<string> {
    this.validateChangesetId(changesetId);

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
   * Detect drift by comparing base snapshot hash to current model state.
   * Identifies whether the base model has changed since the changeset was created.
   *
   * @param changesetId - ID of the changeset to check for drift
   * @returns DriftReport with isDrifted flag, snapshot hashes, and list of changed elements
   * @throws Error if changeset ID is invalid, changeset not found, or model not available
   *
   * @remarks
   * Drift detection is based on hash comparison of the entire model snapshot.
   * Returns isDrifted=false and warnings if no base snapshot was captured.
   * Full element-level drift information would require storing complete snapshots;
   * current implementation returns empty changedElements array (hash comparison only).
   */
  async detectDrift(changesetId: string): Promise<DriftReport> {
    this.validateChangesetId(changesetId);

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

    // Capture current model snapshot to compare against base
    const currentSnapshotId = await this.snapshotManager.captureSnapshot(this.model);

    // Compare snapshot hashes to detect drift
    // isDrifted=true indicates base model has changed since changeset creation
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
   * Commit a changeset to the base model with atomic guarantee.
   * Applies all staged changes and persists them to the base model.
   *
   * Implements atomic commit with the following steps:
   * 1. Detect drift in base model (fail unless force=true)
   * 2. Validate projected model (schema, references, semantics)
   * 3. Create backup of current model state
   * 4. Apply all changes in sequence order
   * 5. Save all modified layers to disk
   * 6. Update changeset status and manifest history
   * 7. Cleanup backup on success, restore on failure
   *
   * @param model - The model to commit changes to
   * @param changesetId - ID of the changeset to commit
   * @param options - Commit options (force, validate, dryRun)
   * @returns CommitResult with count of committed/failed changes and validation status
   * @throws Error if validation fails, drift detected without --force, or commit fails
   *
   * @remarks
   * Validation errors always block commit (cannot override with --force).
   * Dry-run mode performs all checks but does not persist changes.
   * On commit failure, model state is restored from backup; rollback failure triggers CRITICAL error.
   */
  async commit(model: Model, changesetId: string, options: CommitOptions = {}): Promise<CommitResult> {
    this.validateChangesetId(changesetId);

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
    let backup: string;
    try {
      backup = await this.backupModel(model);
    } catch (backupError) {
      // Backup creation failed - cannot proceed safely
      throw new Error(
        `Failed to create backup before commit. No changes have been applied. ` +
        `${backupError instanceof Error ? backupError.message : String(backupError)}`
      );
    }

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
        try {
          await model.saveLayer(layerName);
        } catch (error) {
          throw new Error(
            `Failed to save layer '${layerName}': ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Step 7: Update changeset status to committed ONLY AFTER successful saves
      changeset.status = 'committed';
      changeset.updateModified();

      try {
        await this.storage.save(changeset);
      } catch (error) {
        // Even if changeset save fails, continue to save manifest
        console.warn(`Warning: Failed to save changeset status to storage: ${error instanceof Error ? error.message : String(error)}`);
      }

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
      try {
        await model.saveManifest();
      } catch (manifestError) {
        // Manifest save failed - this is critical
        // Attempt to rollback since manifest wasn't saved
        console.error(`Manifest save failed: ${manifestError instanceof Error ? manifestError.message : String(manifestError)}`);
        throw new Error(
          `Failed to save manifest with changeset history: ${manifestError instanceof Error ? manifestError.message : String(manifestError)}`
        );
      }

      // Step 10: Clean up backup directory after successful commit
      // Note: cleanupBackup handles its own errors and logs them with ERROR severity
      await this.cleanupBackup(backup);

      return result;

    } catch (commitError) {
      // Attempt rollback on any failure - restore from backup
      let rollbackSucceeded = false;
      let rollbackError: Error | null = null;

      try {
        await this.restoreModel(model, backup);
        rollbackSucceeded = true;
      } catch (err) {
        rollbackError = err instanceof Error ? err : new Error(String(err));
      }

      // CRITICAL: Validate backup integrity BEFORE suggesting manual restoration
      let backupHealth: { isValid: boolean; filesChecked: number; errors: string[] };
      let backupValidationError: string | null = null;

      try {
        backupHealth = await this.validateBackupIntegrity(backup);
      } catch (validationErr) {
        backupValidationError = validationErr instanceof Error ? validationErr.message : String(validationErr);
        backupHealth = { isValid: false, filesChecked: 0, errors: [backupValidationError] };
      }

      // Build comprehensive error message
      let compositeMessage: string;
      const suggestions: string[] = [];

      if (rollbackSucceeded) {
        // Rollback succeeded - throw original commit error
        compositeMessage = `Commit failed but rollback succeeded. Model restored to pre-commit state.\n\n`;
        compositeMessage += `Error during commit:\n`;
        compositeMessage += `  ${commitError instanceof Error ? commitError.message : String(commitError)}\n\n`;
        compositeMessage += `Backup location (for reference): ${backup}`;

        // Clean up backup after successful rollback
        // Note: cleanupBackup handles its own errors and logs them with ERROR severity
        await this.cleanupBackup(backup);

        throw new Error(compositeMessage);
      } else {
        // Rollback failed - model may be corrupted
        compositeMessage =
          `Commit failed AND rollback failed. Model may be in corrupted state.\n` +
          `\n` +
          `Original commit error:\n` +
          `  ${commitError instanceof Error ? commitError.message : String(commitError)}\n` +
          `\n` +
          `Rollback error:\n` +
          `  ${rollbackError ? rollbackError.message : 'Unknown error'}\n` +
          `\n` +
          `Backup location: ${backup}\n`;

        // Add backup health status
        compositeMessage += `Backup integrity check:\n`;
        if (backupHealth.isValid) {
          compositeMessage += `  ✓ Backup is valid (${backupHealth.filesChecked} files checked)\n`;
        } else {
          compositeMessage += `  ✗ Backup integrity issues found:\n`;
          for (const error of backupHealth.errors) {
            compositeMessage += `    - ${error}\n`;
          }
        }

        compositeMessage += `\n`;

        if (backupHealth.isValid) {
          suggestions.push(
            `Backup is valid. Manually restore from backup: ${backup}`,
            `Copy manifest.json/manifest.yaml from backup to ${path.join(model.rootPath, 'documentation-robotics')}`,
            `Copy layer files from ${path.join(backup, 'layers')} to ${path.join(model.rootPath, 'documentation-robotics', 'layers')}`,
            `Run 'dr validate' after manual restoration`,
            `Contact support if issue persists`
          );
        } else {
          suggestions.push(
            `⚠ Backup integrity is compromised. Do NOT use this backup for recovery.`,
            `Check if backup files exist at: ${backup}`,
            `Verify disk space and file permissions`,
            `Contact support immediately - manual data recovery may be required`,
            `Do not attempt manual restoration with a corrupted backup`
          );
        }

        compositeMessage += `Manual recovery may be required.`;

        const { CLIError } = await import('../utils/errors.js');
        throw new CLIError(compositeMessage, 1, suggestions);
      }
    }
  }

  /**
   * Check if a changeset is currently active.
   * Active changesets intercept mutations to stage changes instead of applying to base model.
   *
   * @param changesetId - ID of the changeset to check
   * @returns true if changeset is marked as active, false otherwise
   * @throws Error if changeset ID is invalid
   */
  async isActive(changesetId: string): Promise<boolean> {
    this.validateChangesetId(changesetId);

    const activePath = path.join(this.rootPath, 'documentation-robotics', 'changesets', '.active');
    if (!(await fileExists(activePath))) {
      return false;
    }

    const { readFile } = await import('../utils/file-io.js');
    const activeId = await readFile(activePath);
    return activeId.trim() === changesetId;
  }

  /**
   * Activate a changeset to intercept model mutations.
   * Marks the changeset as active and transitions status to 'staged'.
   * Only one changeset can be active at a time.
   *
   * @param changesetId - ID of the changeset to activate
   * @throws Error if changeset ID is invalid or changeset not found
   *
   * @remarks
   * When a changeset is active, add/update/delete commands will stage changes
   * instead of applying them directly to the base model.
   */
  async setActive(changesetId: string): Promise<void> {
    this.validateChangesetId(changesetId);

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
   * Clear the active changeset marker.
   * Allows a new changeset to be activated or model mutations to proceed normally.
   */
  async clearActive(): Promise<void> {
    const { writeFile } = await import('../utils/file-io.js');
    const activePath = path.join(this.rootPath, 'documentation-robotics', 'changesets', '.active');

    if (await fileExists(activePath)) {
      await writeFile(activePath, '');
    }
  }

  /**
   * Get the currently active changeset.
   * Returns null if no changeset is active.
   *
   * @returns The active changeset or null if none is active
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
   * Backup the current model state for atomic rollback on commit failure.
   * Creates a temporary backup directory with copies of all layer files and manifest.
   * Validates backup completeness and calculates checksums for integrity verification.
   *
   * @param model - The model to backup
   * @returns Path to the backup directory
   * @throws Error if backup creation or validation fails
   *
   * @remarks
   * Backup includes:
   * - manifest.yaml or manifest.json
   * - All layer YAML files
   * - Backup manifest with checksums and metadata
   * Backup is removed after successful commit; retained if commit fails for recovery.
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
      // Clean up incomplete backup with detailed error handling
      const cleanupError = await this.forceRemoveBackupDir(backupDir);

      if (cleanupError) {
        console.error(
          `[ERROR] Failed to clean up incomplete backup at ${backupDir}: ${cleanupError}\n` +
          `[ACTION REQUIRED] Please manually remove this directory:\n` +
          `rm -rf "${backupDir}"\n` +
          `This can accumulate if backup creation is retried multiple times.`
        );
      }

      throw new Error(
        `Failed to create backup: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validate backup completeness and file integrity.
   * Verifies that all files in the manifest exist in the backup directory
   * with matching checksums and sizes.
   *
   * @param backupDir - Path to the backup directory
   * @param manifest - Backup manifest with file list and checksums
   * @throws Error if any file is missing, checksum mismatches, or size differs
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
   * Validate backup integrity by checking manifest and file checksums.
   * This is called before suggesting manual restoration to ensure the backup is usable.
   * @param backupDir - Path to the backup directory
   * @returns Promise resolving to backup health status or throwing error with details
   * @throws Error with details about any integrity issues found
   */
  async validateBackupIntegrity(backupDir: string): Promise<{
    isValid: boolean;
    filesChecked: number;
    errors: string[];
  }> {
    const { readFile, fileExists } = await import('../utils/file-io.js');
    const { createHash } = await import('crypto');

    const errors: string[] = [];
    let filesChecked = 0;

    try {
      // Check if backup directory exists
      if (!(await fileExists(backupDir))) {
        throw new Error(`Backup directory not found: ${backupDir}`);
      }

      // Load and validate backup manifest
      const manifestPath = path.join(backupDir, '.backup-manifest.json');
      if (!(await fileExists(manifestPath))) {
        throw new Error(`Backup manifest not found at ${manifestPath}`);
      }

      let manifest;
      try {
        const manifestContent = await readFile(manifestPath);
        manifest = JSON.parse(manifestContent.toString());
      } catch (err) {
        throw new Error(
          `Failed to read backup manifest: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      if (!manifest.files || !Array.isArray(manifest.files)) {
        throw new Error('Backup manifest is invalid or corrupted (missing files array)');
      }

      // Validate each file in the backup manifest
      for (const file of manifest.files) {
        filesChecked++;
        const backupFilePath = path.join(backupDir, file.path);

        // Check file exists
        if (!(await fileExists(backupFilePath))) {
          errors.push(`Missing: ${file.path}`);
          continue;
        }

        // Check checksum
        try {
          const content = await readFile(backupFilePath);
          const checksum = createHash('sha256').update(content).digest('hex');

          if (checksum !== file.checksum) {
            errors.push(
              `Checksum mismatch: ${file.path} (expected ${file.checksum}, got ${checksum})`
            );
            continue;
          }

          // Check size
          if (content.length !== file.size) {
            errors.push(
              `Size mismatch: ${file.path} (expected ${file.size}, got ${content.length})`
            );
          }
        } catch (err) {
          errors.push(
            `Failed to validate: ${file.path} (${err instanceof Error ? err.message : String(err)})`
          );
        }
      }

      return {
        isValid: errors.length === 0,
        filesChecked,
        errors
      };
    } catch (err) {
      throw new Error(
        `Backup integrity check failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Clean up a backup directory after successful commit.
   * Removes the backup directory and all its contents to prevent disk space accumulation.
   *
   * @param backupDir - Path to the backup directory to remove
   *
   * @remarks
   * Failures during cleanup are logged with ERROR severity but do not throw.
   * Successful commits should not fail due to cleanup errors, but users need to
   * know about cleanup failures to avoid disk space accumulation.
   * Includes actionable guidance for common failure scenarios.
   */
  private async cleanupBackup(backupDir: string): Promise<void> {
    try {
      const { rm } = await import('node:fs/promises');
      await rm(backupDir, { recursive: true, force: true });
    } catch (error) {
      // Log cleanup failures with ERROR severity - these mask real problems
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorCode = (error as NodeJS.ErrnoException)?.code;

      let suggestions = '';

      // Provide specific guidance based on error type
      if (errorCode === 'ENOSPC') {
        suggestions =
          '\n\n[ACTION REQUIRED] Disk space is full. Backup cleanup failed.\n' +
          'This will cause backup directories to accumulate and fill your disk.\n' +
          `Manual cleanup: rm -rf "${backupDir}"\n` +
          'Then free up disk space before attempting another commit.';
      } else if (errorCode === 'EACCES') {
        suggestions =
          '\n\n[PERMISSION ERROR] Cannot delete backup directory.\n' +
          `Directory: ${backupDir}\n` +
          'Check file permissions or try manual cleanup:\n' +
          `sudo rm -rf "${backupDir}"`;
      } else if (errorCode === 'ENOENT') {
        // Backup was already deleted - not an error, directory removal goal is achieved
        return;
      } else {
        suggestions =
          '\n\n[ACTION REQUIRED] Backup cleanup failed due to file system error.\n' +
          `Directory: ${backupDir}\n` +
          `Manual cleanup: rm -rf "${backupDir}"\n` +
          'Note: Backup directories accumulate over time and can fill disk space.';
      }

      console.error(
        `[ERROR] Failed to clean up backup directory after commit: ${errorMsg}` + suggestions
      );
    }
  }

  /**
   * Force remove a backup directory with enhanced error handling.
   * Attempts multiple strategies to ensure removal even with permission issues.
   *
   * @param backupDir - Path to the backup directory to remove
   * @returns Error message if removal failed, null if successful
   *
   * @remarks
   * This is used during backup creation failures to ensure cleanup of partial state.
   * Returns error details instead of throwing so caller can log and continue.
   */
  private async forceRemoveBackupDir(backupDir: string): Promise<string | null> {
    const fs = await import('fs/promises');

    try {
      // Try standard removal first
      await fs.rm(backupDir, { recursive: true, force: true });
      return null;
    } catch (error) {
      // If standard removal fails, try more aggressive approach
      try {
        // List directory contents and try to remove each item
        const entries = await fs.readdir(backupDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(backupDir, entry.name);
          try {
            if (entry.isDirectory()) {
              await fs.rm(fullPath, { recursive: true, force: true });
            } else {
              await fs.unlink(fullPath);
            }
          } catch (itemError) {
            console.warn(`Failed to remove ${fullPath}: ${itemError instanceof Error ? itemError.message : String(itemError)}`);
          }
        }

        // Try to remove the directory itself
        try {
          await fs.rmdir(backupDir);
          return null;
        } catch {
          // Directory may not be empty, return error
          return `Could not remove directory ${backupDir} - may contain leftover files`;
        }
      } catch (aggressiveError) {
        return `Backup cleanup failed: ${aggressiveError instanceof Error ? aggressiveError.message : String(aggressiveError)}`;
      }
    }
  }

  /**
   * Restore model state from backup after failed commit.
   * Restores manifest first (critical), then all layer files with defensive error handling.
   * Provides detailed reporting of restoration progress and failures.
   *
   * @param model - The model to restore
   * @param backupDir - Path to the backup directory
   * @throws Error with detailed restoration summary if restoration fails
   *
   * @remarks
   * Restoration strategy:
   * 1. Restore manifest first (critical for model integrity)
   * 2. Restore all layer files with per-file error handling
   * 3. Continue restoring remaining files even if some fail
   * 4. Throw detailed error if critical files fail to restore
   * Manifest restoration failure is fatal; layer failures are warnings.
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
   * Find the directory path for a layer in the model.
   * Uses same discovery logic as Model.loadLayer to locate layer directories.
   * Handles naming convention: `{PREFIX}_{layerName}` where PREFIX is numeric (01_motivation, etc).
   *
   * @param rootPath - Root path of the model
   * @param layerName - Name of the layer to find
   * @returns Path to the layer directory or null if not found
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
   * Generate a unique changeset ID.
   * Combines timestamp and random suffix to ensure uniqueness across concurrent operations.
   *
   * @returns A unique changeset ID in format `changeset-{timestamp}-{random}`
   */
  private generateChangesetId(): string {
    return `changeset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
