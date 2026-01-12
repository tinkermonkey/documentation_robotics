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
  private rootPath: string;
  private model: Model | null = null;

  constructor(rootPath: string, model?: Model) {
    this.rootPath = rootPath;
    this.model = model || null;
    this.storage = new StagedChangesetStorage(rootPath);
    this.snapshotManager = new BaseSnapshotManager();
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
    changeset.stats = {
      additions: 0,
      modifications: 0,
      deletions: 0,
    };
    changeset.updateModified();

    await this.storage.save(changeset);
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
   * Applies staged changes to the model if validation passes
   */
  async commit(model: Model, changesetId: string, options: CommitOptions = {}): Promise<CommitResult> {
    const changeset = await this.storage.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    const isDryRun = options.dryRun === true;

    // Check for drift
    const drift = await this.detectDrift(changesetId);
    const result: CommitResult = {
      changeset: changeset.name,
      committed: 0,
      failed: 0,
      validation: {
        passed: true,
        errors: [],
      },
    };

    if (drift.isDrifted && !options.force) {
      result.driftWarning = drift;
      return result;
    }

    // Apply changes to model
    for (const change of changeset.changes) {
      try {
        const layer = await model.getLayer(change.layerName);
        if (!layer) {
          throw new Error(`Layer '${change.layerName}' not found`);
        }

        if (change.type === 'add' && change.after && !isDryRun) {
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
        } else if (change.type === 'update' && change.after && !isDryRun) {
          const element = layer.getElement(change.elementId);
          if (element) {
            const elementData = change.after as Record<string, unknown>;
            Object.assign(element, elementData);
            result.committed++;
          }
        } else if (change.type === 'delete' && !isDryRun) {
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
      }
    }

    // Save model changes if commit succeeded and not a dry run
    if (result.failed === 0 && !isDryRun) {
      // Save all modified layers
      const modifiedLayers = new Set<string>();
      for (const change of changeset.changes) {
        modifiedLayers.add(change.layerName);
      }

      for (const layerName of modifiedLayers) {
        await model.saveLayer(layerName);
      }
      await model.saveManifest();

      // Mark changeset as committed
      changeset.status = 'committed';
      changeset.updateModified();
      await this.storage.save(changeset);
    }

    return result;
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
   * Generate a unique changeset ID
   */
  private generateChangesetId(): string {
    return `changeset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
