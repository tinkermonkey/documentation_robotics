/**
 * Active Changeset Context
 *
 * Manages the currently active changeset and provides utilities for
 * automatic change tracking during model operations.
 */

import { readFile, writeFile, fileExists } from '../utils/file-io.js';
import { ChangesetManager } from './changeset.js';

/**
 * ActiveChangesetContext manages automatic change tracking
 * when a changeset is activated for transparent operation capture
 */
export class ActiveChangesetContext {
  private activePath: string;
  private manager: ChangesetManager;

  constructor(modelPath: string) {
    this.activePath = `${modelPath}/.dr/changesets/active`;
    this.manager = new ChangesetManager(modelPath);
  }

  /**
   * Get the currently active changeset name, if any
   */
  async getActive(): Promise<string | null> {
    if (!(await fileExists(this.activePath))) {
      return null;
    }
    const content = await readFile(this.activePath);
    return content.trim() || null;
  }

  /**
   * Set a changeset as active for automatic tracking
   */
  async setActive(changesetName: string): Promise<void> {
    // Verify changeset exists
    const changeset = await this.manager.load(changesetName);
    if (!changeset) {
      throw new Error(`Changeset '${changesetName}' not found`);
    }
    await writeFile(this.activePath, changesetName);
  }

  /**
   * Clear the active changeset
   */
  async clearActive(): Promise<void> {
    if (await fileExists(this.activePath)) {
      await writeFile(this.activePath, '');
    }
  }

  /**
   * Track a change in the active changeset
   * If no changeset is active, this is a no-op
   */
  async trackChange(
    type: 'add' | 'update' | 'delete',
    elementId: string,
    layerName: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>
  ): Promise<void> {
    const activeChangesetName = await this.getActive();
    if (!activeChangesetName) {
      return; // No active changeset, nothing to track
    }

    const changeset = await this.manager.load(activeChangesetName);
    if (!changeset) {
      throw new Error(`Active changeset '${activeChangesetName}' not found`);
    }

    changeset.addChange(type, elementId, layerName, before, after);
    await this.manager.save(changeset);
  }

  /**
   * Check if a changeset is currently active
   */
  async isActive(): Promise<boolean> {
    const active = await this.getActive();
    return active !== null;
  }
}
