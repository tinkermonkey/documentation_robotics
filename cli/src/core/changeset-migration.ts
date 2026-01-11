/**
 * ChangesetMigration - Migrate changesets from old to new format
 *
 * Converts changesets from:
 * - Old format: .dr/changesets/{name}.json
 * - New format: documentation-robotics/changesets/{id}/metadata.yaml + changes.yaml
 *
 * Status mapping:
 * - draft -> draft
 * - applied -> committed
 * - reverted -> discarded (with note)
 */

import { fileExists } from '../utils/file-io.js';
import { ChangesetManager } from './changeset.js';
import { StagedChangesetStorage } from './staged-changeset-storage.js';
import { BaseSnapshotManager } from './base-snapshot-manager.js';
import type { Model } from './model.js';
import type { StagedChange } from './changeset.js';
import path from 'path';

/**
 * Migration result
 */
export interface MigrationResult {
  totalChangesets: number;
  migratedChangesets: number;
  failedChangesets: number;
  skippedChangesets: number;
  errors: Array<{
    name: string;
    error: string;
  }>;
}

/**
 * Migrate changesets from old format to new format
 */
export async function migrateChangesets(
  rootPath: string,
  model: Model
): Promise<MigrationResult> {
  const oldManager = new ChangesetManager(rootPath);
  const newStorage = new StagedChangesetStorage(rootPath);
  const snapshotManager = new BaseSnapshotManager();

  const result: MigrationResult = {
    totalChangesets: 0,
    migratedChangesets: 0,
    failedChangesets: 0,
    skippedChangesets: 0,
    errors: [],
  };

  try {
    // Load old changesets
    const oldChangesets = await oldManager.list();
    result.totalChangesets = oldChangesets.length;

    if (result.totalChangesets === 0) {
      // No changesets to migrate
      return result;
    }

    // Capture current model snapshot
    const baseSnapshot = await snapshotManager.captureSnapshot(model);

    for (const oldChangeset of oldChangesets) {
      try {
        // Generate ID from name (kebab-case)
        const id = generateChangesetId(oldChangeset.name);

        // Check if already migrated
        const existing = await newStorage.load(id);
        if (existing) {
          result.skippedChangesets++;
          continue;
        }

        // Map status to new enum
        const newStatus = mapStatus(oldChangeset.status);

        // Create new changeset with extended format
        const migratedChangeset = await newStorage.create(
          id,
          oldChangeset.name,
          oldChangeset.description,
          baseSnapshot
        );

        // Update changeset properties
        migratedChangeset.status = newStatus as any;
        migratedChangeset.baseSnapshot = baseSnapshot;

        // Convert changes to StagedChange format with sequence numbers
        migratedChangeset.changes = oldChangeset.changes.map((change, index) => ({
          ...change,
          sequenceNumber: index,
        } as StagedChange));

        // Update stats
        migratedChangeset.updateStats();
        migratedChangeset.updateModified();

        // Save migrated changeset
        await newStorage.save(migratedChangeset);

        result.migratedChangesets++;
      } catch (error) {
        result.failedChangesets++;
        result.errors.push({
          name: oldChangeset.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  } catch (error) {
    throw new Error(
      `Migration failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate a changeset ID from a name
 * Format: kebab-case, lowercase, alphanumeric with hyphens
 */
function generateChangesetId(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .substring(0, 100); // Limit length
}

/**
 * Map old status values to new status values
 */
function mapStatus(oldStatus: string): 'draft' | 'staged' | 'committed' | 'discarded' {
  switch (oldStatus) {
    case 'draft':
      return 'draft';
    case 'applied':
      return 'committed';
    case 'reverted':
      return 'discarded';
    default:
      return 'draft';
  }
}

/**
 * Check if migration is needed
 */
export async function isMigrationNeeded(rootPath: string): Promise<boolean> {
  const oldChangesetsDir = path.join(rootPath, '.dr', 'changesets');
  return fileExists(oldChangesetsDir);
}
