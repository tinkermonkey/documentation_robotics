/**
 * ChangesetMigration - Migrate changesets from old to new format
 *
 * Converts changesets from:
 * - Old format: .dr/changesets/{name}.json
 * - New format: documentation-robotics/changesets/{id}/metadata.yaml + changes.yaml
 *
 * Status mapping:
 * - draft -> staged
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
 * Migration validation result
 */
export interface MigrationValidationResult {
  migrationNeeded: boolean;
  totalOldChangesets: number;
  alreadyMigratedCount: number;
  requiresMigrationCount: number;
  validationIssues: Array<{
    changeset: string;
    issue: string;
  }>;
  warnings: string[];
  canProceed: boolean;
}

/**
 * Migration dry-run result (preview without changes)
 */
export interface MigrationDryRunResult {
  summary: {
    totalToMigrate: number;
    alreadyMigrated: number;
    expectedFailures: number;
  };
  changesets: Array<{
    oldName: string;
    newId: string;
    currentStatus: string;
    mappedStatus: string;
    changes: number;
    issues?: string[];
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
        migratedChangeset.status = newStatus;
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
 *
 * Status mapping:
 * - draft → staged (moved to staging area)
 * - applied → committed (already applied to model)
 * - reverted → discarded (no longer needed)
 */
function mapStatus(oldStatus: string): 'draft' | 'staged' | 'committed' | 'discarded' {
  switch (oldStatus) {
    case 'draft':
      return 'staged';  // Draft changesets become staged in the new system
    case 'applied':
      return 'committed';
    case 'reverted':
      return 'discarded';
    default:
      return 'staged';
  }
}

/**
 * Check if migration is needed
 */
export async function isMigrationNeeded(rootPath: string): Promise<boolean> {
  const oldChangesetsDir = path.join(rootPath, '.dr', 'changesets');
  return fileExists(oldChangesetsDir);
}

/**
 * Validate migration without making changes
 * Returns detailed information about what would be migrated
 */
export async function validateMigration(
  rootPath: string,
  _model: Model
): Promise<MigrationValidationResult> {
  const oldManager = new ChangesetManager(rootPath);
  const newStorage = new StagedChangesetStorage(rootPath);

  const result: MigrationValidationResult = {
    migrationNeeded: false,
    totalOldChangesets: 0,
    alreadyMigratedCount: 0,
    requiresMigrationCount: 0,
    validationIssues: [],
    warnings: [],
    canProceed: true,
  };

  try {
    const oldChangesets = await oldManager.list();
    result.totalOldChangesets = oldChangesets.length;
    result.migrationNeeded = result.totalOldChangesets > 0;

    if (result.totalOldChangesets === 0) {
      result.warnings.push('No old-format changesets found - migration not needed');
      return result;
    }

    for (const oldChangeset of oldChangesets) {
      const id = generateChangesetId(oldChangeset.name);

      // Check if already migrated
      const existing = await newStorage.load(id);
      if (existing) {
        result.alreadyMigratedCount++;
        continue;
      }

      result.requiresMigrationCount++;

      // Validate changeset structure
      if (!oldChangeset.changes || !Array.isArray(oldChangeset.changes)) {
        result.validationIssues.push({
          changeset: oldChangeset.name,
          issue: 'Missing or invalid changes array',
        });
        result.canProceed = false;
      }

      if (!oldChangeset.status) {
        result.validationIssues.push({
          changeset: oldChangeset.name,
          issue: 'Missing status field',
        });
        result.canProceed = false;
      }
    }

    // Add warnings if all are already migrated
    if (result.requiresMigrationCount === 0 && result.alreadyMigratedCount > 0) {
      result.warnings.push(`All ${result.alreadyMigratedCount} changesets already migrated`);
    }

    return result;
  } catch (error) {
    result.canProceed = false;
    result.warnings.push(
      `Validation error: ${error instanceof Error ? error.message : String(error)}`
    );
    return result;
  }
}

/**
 * Perform a dry-run of migration (preview without making changes)
 * Shows what would be migrated and any potential issues
 */
export async function dryRunMigration(
  rootPath: string,
  _model: Model
): Promise<MigrationDryRunResult> {
  const oldManager = new ChangesetManager(rootPath);
  const newStorage = new StagedChangesetStorage(rootPath);

  const result: MigrationDryRunResult = {
    summary: {
      totalToMigrate: 0,
      alreadyMigrated: 0,
      expectedFailures: 0,
    },
    changesets: [],
  };

  try {
    const oldChangesets = await oldManager.list();

    for (const oldChangeset of oldChangesets) {
      const id = generateChangesetId(oldChangeset.name);

      // Check if already migrated
      const existing = await newStorage.load(id);
      if (existing) {
        result.summary.alreadyMigrated++;
        continue;
      }

      const mappedStatus = mapStatus(oldChangeset.status);
      const issues: string[] = [];

      // Validate changeset
      if (!oldChangeset.changes || oldChangeset.changes.length === 0) {
        issues.push('No changes to migrate');
        result.summary.expectedFailures++;
      }

      if (!oldChangeset.status) {
        issues.push('Invalid or missing status');
        result.summary.expectedFailures++;
      }

      result.changesets.push({
        oldName: oldChangeset.name,
        newId: id,
        currentStatus: oldChangeset.status || 'unknown',
        mappedStatus,
        changes: oldChangeset.changes?.length || 0,
        ...(issues.length > 0 && { issues }),
      });

      result.summary.totalToMigrate++;
    }

    return result;
  } catch (error) {
    throw new Error(
      `Dry-run failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Create a backup of old changesets before migration
 * Returns path to backup directory
 */
export async function backupOldChangesets(rootPath: string): Promise<string | null> {
  const oldChangesetsDir = path.join(rootPath, '.dr', 'changesets');

  if (!(await fileExists(oldChangesetsDir))) {
    return null;
  }

  const backupDir = path.join(rootPath, '.dr.backup', 'changesets');

  try {
    // Create backup using file system operations
    const { cp } = await import('fs/promises');
    await cp(oldChangesetsDir, backupDir, { recursive: true });
    return backupDir;
  } catch (error) {
    throw new Error(
      `Backup failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Rollback migration - restore old changesets from backup
 * Returns true if rollback succeeded, false otherwise
 */
export async function rollbackMigration(rootPath: string): Promise<boolean> {
  const backupDir = path.join(rootPath, '.dr.backup', 'changesets');
  const oldChangesetsDir = path.join(rootPath, '.dr', 'changesets');

  if (!(await fileExists(backupDir))) {
    throw new Error(
      'Backup directory not found - cannot rollback. Use --force to proceed anyway.'
    );
  }

  try {
    const { rm, cp } = await import('fs/promises');

    // Remove current migrations
    if (await fileExists(oldChangesetsDir)) {
      await rm(oldChangesetsDir, { recursive: true, force: true });
    }

    // Restore from backup
    await cp(backupDir, oldChangesetsDir, { recursive: true });

    return true;
  } catch (error) {
    throw new Error(
      `Rollback failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Remove migrated changesets and optionally restore from backup
 */
export async function cleanupMigration(
  rootPath: string,
  restoreBackup: boolean = false
): Promise<void> {
  const newChangesetDir = path.join(rootPath, 'documentation-robotics', 'changesets');
  const backupDir = path.join(rootPath, '.dr.backup', 'changesets');
  const oldChangesetsDir = path.join(rootPath, '.dr', 'changesets');

  try {
    const { rm } = await import('fs/promises');

    // Remove migrated changesets if requested
    if (await fileExists(newChangesetDir)) {
      await rm(newChangesetDir, { recursive: true, force: true });
    }

    // Optionally restore backup
    if (restoreBackup && (await fileExists(backupDir))) {
      if (await fileExists(oldChangesetsDir)) {
        await rm(oldChangesetsDir, { recursive: true, force: true });
      }
      const { cp } = await import('fs/promises');
      await cp(backupDir, oldChangesetsDir, { recursive: true });
    }
  } catch (error) {
    throw new Error(
      `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
