/**
 * Changeset - Represents a collection of model changes
 *
 * Changesets allow grouping related modifications to the architecture model
 * and applying/reverting them as a unit.
 */

import { readJSON, writeJSON, ensureDir, fileExists } from '../utils/file-io.js';
import type { Model } from './model.js';
import { Element } from './element.js';

/**
 * Represents a single change in a changeset
 */
export interface Change {
  type: 'add' | 'update' | 'delete';
  elementId: string;
  layerName: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Represents a staged change with sequence number for replay
 */
export interface StagedChange extends Change {
  sequenceNumber: number;
}

/**
 * Status values for changesets (supports both legacy and new lifecycle)
 * Legacy: 'draft' | 'applied' | 'reverted'
 * New staging: 'staged' | 'committed' | 'discarded'
 */
export type ChangesetStatus = 'draft' | 'applied' | 'reverted' | 'staged' | 'committed' | 'discarded';

/**
 * Changeset metadata
 */
export interface ChangesetData {
  name: string;
  description?: string;
  created: string;
  modified: string;
  changes: Change[];
  status: ChangesetStatus;
}

/**
 * Extended changeset data with staging semantics
 */
export interface StagedChangesetData {
  id: string;
  name: string;
  description?: string;
  created: string;
  modified: string;
  status: ChangesetStatus;
  baseSnapshot: string;
  changes: StagedChange[];
  stats: {
    additions: number;
    modifications: number;
    deletions: number;
  };
}

/**
 * Changeset class for managing model changes
 */
export class Changeset {
  name: string;
  description?: string;
  created: string;
  modified: string;
  changes: Change[] = [];
  status: ChangesetStatus = 'draft';

  // Extended staging fields (optional for backward compatibility)
  id?: string;
  baseSnapshot?: string;
  stats?: {
    additions: number;
    modifications: number;
    deletions: number;
  };

  constructor(data: ChangesetData | StagedChangesetData) {
    this.name = data.name;
    this.description = data.description;
    this.created = data.created;
    this.modified = data.modified;
    this.changes = data.changes || [];
    this.status = data.status || 'draft';

    // Load extended fields if present
    if ('id' in data) {
      this.id = (data as StagedChangesetData).id;
    }
    if ('baseSnapshot' in data) {
      this.baseSnapshot = (data as StagedChangesetData).baseSnapshot;
    }
    if ('stats' in data) {
      this.stats = (data as StagedChangesetData).stats;
    }
  }

  /**
   * Create a new changeset
   */
  static create(name: string, description?: string): Changeset {
    const now = new Date().toISOString();
    return new Changeset({
      name,
      description,
      created: now,
      modified: now,
      changes: [],
      status: 'draft',
    });
  }

  /**
   * Add a change to the changeset
   */
  addChange(
    type: 'add' | 'update' | 'delete',
    elementId: string,
    layerName: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>
  ): void {
    this.changes.push({
      type,
      elementId,
      layerName,
      before,
      after,
      timestamp: new Date().toISOString(),
    });
    this.updateModified();
  }

  /**
   * Update the modified timestamp
   */
  updateModified(): void {
    this.modified = new Date().toISOString();
  }

  /**
   * Get number of changes
   */
  getChangeCount(): number {
    return this.changes.length;
  }

  /**
   * Get changes by type
   */
  getChangesByType(type: 'add' | 'update' | 'delete'): Change[] {
    return this.changes.filter((c) => c.type === type);
  }

  /**
   * Calculate and update changeset statistics
   */
  updateStats(): void {
    this.stats = {
      additions: this.getChangesByType('add').length,
      modifications: this.getChangesByType('update').length,
      deletions: this.getChangesByType('delete').length,
    };
  }

  /**
   * Mark changeset as applied
   */
  markApplied(): void {
    this.status = 'applied';
    this.updateModified();
  }

  /**
   * Mark changeset as reverted
   */
  markReverted(): void {
    this.status = 'reverted';
    this.updateModified();
  }

  /**
   * Mark changeset as staged
   */
  markStaged(): void {
    this.status = 'staged';
    this.updateModified();
  }

  /**
   * Mark changeset as committed
   */
  markCommitted(): void {
    this.status = 'committed';
    this.updateModified();
  }

  /**
   * Mark changeset as discarded
   */
  markDiscarded(): void {
    this.status = 'discarded';
    this.updateModified();
  }

  /**
   * Serialize to JSON
   */
  toJSON(): ChangesetData | StagedChangesetData {
    const base = {
      name: this.name,
      description: this.description,
      created: this.created,
      modified: this.modified,
      changes: this.changes,
      status: this.status,
    };

    // Include extended fields if present
    if (this.id && this.baseSnapshot && this.stats) {
      return {
        ...base,
        id: this.id,
        baseSnapshot: this.baseSnapshot,
        stats: this.stats,
      } as StagedChangesetData;
    }

    return base as ChangesetData;
  }

  /**
   * Create from JSON data
   */
  static fromJSON(data: ChangesetData | StagedChangesetData): Changeset {
    return new Changeset(data);
  }
}

/**
 * Changeset Manager for storing and retrieving changesets
 */
export class ChangesetManager {
  private changesetsDir: string;

  constructor(modelPath: string) {
    this.changesetsDir = `${modelPath}/.dr/changesets`;
  }

  /**
   * Create a new changeset
   */
  async create(name: string, description?: string): Promise<Changeset> {
    const changeset = Changeset.create(name, description);
    await this.save(changeset);
    return changeset;
  }

  /**
   * Save a changeset to disk
   */
  async save(changeset: Changeset): Promise<void> {
    await ensureDir(this.changesetsDir);
    const filePath = `${this.changesetsDir}/${this.sanitizeName(changeset.name)}.json`;
    await writeJSON(filePath, changeset.toJSON(), true);
  }

  /**
   * Load a changeset by name
   */
  async load(name: string): Promise<Changeset | null> {
    const filePath = `${this.changesetsDir}/${this.sanitizeName(name)}.json`;

    if (!(await fileExists(filePath))) {
      return null;
    }

    const data = await readJSON<ChangesetData>(filePath);
    return Changeset.fromJSON(data);
  }

  /**
   * List all changesets
   */
  async list(): Promise<Changeset[]> {
    if (!(await fileExists(this.changesetsDir))) {
      return [];
    }

    const fs = await import('fs/promises');
    const files = await fs.readdir(this.changesetsDir);
    const changesets: Changeset[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const data = await readJSON<ChangesetData>(
          `${this.changesetsDir}/${file}`
        );
        changesets.push(Changeset.fromJSON(data));
      }
    }

    return changesets;
  }

  /**
   * Delete a changeset
   */
  async delete(name: string): Promise<void> {
    const filePath = `${this.changesetsDir}/${this.sanitizeName(name)}.json`;

    if (!(await fileExists(filePath))) {
      throw new Error(`Changeset '${name}' not found`);
    }

    const fs = await import('fs/promises');
    await fs.unlink(filePath);
  }

  /**
   * Apply a changeset to the model
   */
  async apply(model: Model, name: string): Promise<ApplyResult> {
    const changeset = await this.load(name);

    if (!changeset) {
      throw new Error(`Changeset '${name}' not found`);
    }

    const result: ApplyResult = {
      changeset: name,
      applied: 0,
      failed: 0,
      errors: [],
    };

    for (const change of changeset.changes) {
      try {
        const layer = await model.getLayer(change.layerName);

        if (!layer) {
          throw new Error(`Layer '${change.layerName}' not found`);
        }

        if (change.type === 'add' && change.after) {
          // Add element to layer
          const elements = layer.listElements();
          const elementExists = elements.some((e) => e.id === change.elementId);

          if (!elementExists) {
            // Create element based on after data
            const elementData = change.after as Record<string, unknown>;
            const element = new Element({
              id: change.elementId,
              type: (elementData.type as string) || 'unknown',
              name: (elementData.name as string) || change.elementId,
              description: elementData.description as string | undefined,
              properties: elementData,
            });
            layer.addElement(element);
            result.applied++;
          }
        } else if (change.type === 'update' && change.after) {
          // Update element in layer
          const element = layer.getElement(change.elementId);

          if (element) {
            const elementData = change.after as Record<string, unknown>;
            Object.assign(element, elementData);
            result.applied++;
          }
        } else if (change.type === 'delete') {
          // Delete element from layer
          const element = layer.getElement(change.elementId);

          if (element) {
            layer.deleteElement(change.elementId);
            result.applied++;
          }
        }
      } catch (error) {
        result.failed++;
        result.errors.push({
          change,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (result.failed === 0) {
      changeset.markApplied();
      await this.save(changeset);
    }

    return result;
  }

  /**
   * Revert a changeset from the model
   */
  async revert(model: Model, name: string): Promise<RevertResult> {
    const changeset = await this.load(name);

    if (!changeset) {
      throw new Error(`Changeset '${name}' not found`);
    }

    const result: RevertResult = {
      changeset: name,
      reverted: 0,
      failed: 0,
      errors: [],
    };

    // Process changes in reverse order
    for (let i = changeset.changes.length - 1; i >= 0; i--) {
      const change = changeset.changes[i];

      try {
        const layer = await model.getLayer(change.layerName);

        if (!layer) {
          throw new Error(`Layer '${change.layerName}' not found`);
        }

        // Reverse each operation
        if (change.type === 'add') {
          // Remove the element that was added
          const element = layer.getElement(change.elementId);

          if (element) {
            layer.deleteElement(change.elementId);
            result.reverted++;
          }
        } else if (change.type === 'update' && change.before) {
          // Restore to previous state
          const element = layer.getElement(change.elementId);

          if (element) {
            const elementData = change.before as Record<string, unknown>;
            Object.assign(element, elementData);
            result.reverted++;
          }
        } else if (change.type === 'delete' && change.before) {
          // Recreate the deleted element
          const elements = layer.listElements();
          const elementExists = elements.some((e) => e.id === change.elementId);

          if (!elementExists) {
            const elementData = change.before as Record<string, unknown>;
            const element = new Element({
              id: change.elementId,
              type: (elementData.type as string) || 'unknown',
              name: (elementData.name as string) || change.elementId,
              description: elementData.description as string | undefined,
              properties: elementData,
            });
            layer.addElement(element);
            result.reverted++;
          }
        }
      } catch (error) {
        result.failed++;
        result.errors.push({
          change,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (result.failed === 0) {
      changeset.markReverted();
      await this.save(changeset);
    }

    return result;
  }

  /**
   * Sanitize changeset name for use as filename
   */
  private sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
}

/**
 * Result of applying a changeset
 */
export interface ApplyResult {
  changeset: string;
  applied: number;
  failed: number;
  errors: Array<{
    change: Change;
    error: string;
  }>;
}

/**
 * Result of reverting a changeset
 */
export interface RevertResult {
  changeset: string;
  reverted: number;
  failed: number;
  errors: Array<{
    change: Change;
    error: string;
  }>;
}
