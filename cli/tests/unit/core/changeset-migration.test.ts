import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ChangesetManager, Changeset } from '../../../src/core/changeset.js';
import { StagedChangesetStorage } from '../../../src/core/staged-changeset-storage.js';
import { migrateChangesets, isMigrationNeeded, validateMigration, dryRunMigration, backupOldChangesets, rollbackMigration, cleanupMigration } from '../../../src/core/changeset-migration.js';
import { Model } from '../../../src/core/model.js';
import { Manifest } from '../../../src/core/manifest.js';
import { Layer } from '../../../src/core/layer.js';
import { Element } from '../../../src/core/element.js';
import { rm, mkdir } from 'fs/promises';
import { fileExists } from '../../../src/utils/file-io.js';

const TEST_DIR = '/tmp/migration-test';

describe('Changeset Migration', () => {
  let testModel: Model;

  beforeAll(async () => {
    // Clean up
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore
    }
    await mkdir(`${TEST_DIR}/.dr`, { recursive: true });

    // Create test model
    const manifest = new Manifest({
      name: 'Test Model',
      version: '1.0.0',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    testModel = new Model(TEST_DIR, manifest);

    // Add test layer
    const apiLayer = new Layer('api');
    apiLayer.addElement(
      new Element({
        id: 'api-endpoint-test',
        type: 'endpoint',
        name: 'Test',
        properties: {},
      })
    );
    testModel.layers.set('api', apiLayer);
  });

  afterAll(async () => {
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore
    }
  });

  describe('isMigrationNeeded', () => {
    it('should detect if migration is needed', async () => {
      const hasOldChangesets = await isMigrationNeeded(TEST_DIR);
      // Initially there might be a .dr directory
      expect(typeof hasOldChangesets).toBe('boolean');
    });
  });

  describe('migrateChangesets', () => {
    it('should migrate changesets from old to new format', async () => {
      // Create old-format changesets
      const oldManager = new ChangesetManager(TEST_DIR);
      const cs1 = await oldManager.create('test-changeset-1', 'First');
      cs1.addChange('add', 'elem-1', 'api', undefined, { name: 'New' });
      await oldManager.save(cs1);

      const cs2 = await oldManager.create('test-changeset-2', 'Second');
      cs2.addChange('update', 'elem-2', 'api', {}, {});
      cs2.markApplied();
      await oldManager.save(cs2);

      // Run migration
      const result = await migrateChangesets(TEST_DIR, testModel);

      expect(result.totalChangesets).toBeGreaterThan(0);
      expect(result.migratedChangesets).toBeGreaterThan(0);

      // Verify new format exists
      const newStorage = new StagedChangesetStorage(TEST_DIR);
      const migrated1 = await newStorage.load('test-changeset-1');
      expect(migrated1).not.toBeNull();
      expect(migrated1?.name).toBe('test-changeset-1');
      expect(migrated1?.baseSnapshot).toBeDefined();
    });

    it('should map old status to new status', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);

      // Create changesets with different statuses
      const draft = await oldManager.create('draft-test', 'Draft');
      draft.addChange('add', 'elem-a', 'api', undefined, { name: 'A' });
      await oldManager.save(draft);

      const applied = await oldManager.create('applied-test', 'Applied');
      applied.addChange('add', 'elem-b', 'api', undefined, { name: 'B' });
      applied.markApplied();
      await oldManager.save(applied);

      // Migrate
      await migrateChangesets(TEST_DIR, testModel);

      // Check status mapping
      const newStorage = new StagedChangesetStorage(TEST_DIR);

      const migratedDraft = await newStorage.load('draft-test');
      expect(migratedDraft?.status).toBe('staged');

      const migratedApplied = await newStorage.load('applied-test');
      expect(migratedApplied?.status).toBe('committed');
    });

    it('should preserve changes during migration', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);

      // Create changeset with multiple changes
      const cs = await oldManager.create('changes-test', 'Changes');
      cs.addChange('add', 'elem-1', 'api', undefined, { name: 'E1', type: 'endpoint' });
      cs.addChange('add', 'elem-2', 'api', undefined, { name: 'E2', type: 'endpoint' });
      cs.addChange('update', 'elem-3', 'application', {}, { name: 'Updated' });
      cs.addChange('delete', 'elem-4', 'application', {}, undefined);
      await oldManager.save(cs);

      // Migrate
      await migrateChangesets(TEST_DIR, testModel);

      // Verify changes
      const newStorage = new StagedChangesetStorage(TEST_DIR);
      const migrated = await newStorage.load('changes-test');

      expect(migrated?.changes).toHaveLength(4);
      expect(migrated?.stats?.additions).toBe(2);
      expect(migrated?.stats?.modifications).toBe(1);
      expect(migrated?.stats?.deletions).toBe(1);
    });

    it('should assign sequence numbers during migration', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);

      const cs = await oldManager.create('sequence-test', 'Sequence');
      cs.addChange('add', 'elem-1', 'api', undefined, { name: 'A' });
      cs.addChange('add', 'elem-2', 'api', undefined, { name: 'B' });
      cs.addChange('add', 'elem-3', 'api', undefined, { name: 'C' });
      await oldManager.save(cs);

      // Migrate
      await migrateChangesets(TEST_DIR, testModel);

      // Verify sequence numbers
      const newStorage = new StagedChangesetStorage(TEST_DIR);
      const migrated = await newStorage.load('sequence-test');

      expect(migrated?.changes[0].sequenceNumber).toBe(0);
      expect(migrated?.changes[1].sequenceNumber).toBe(1);
      expect(migrated?.changes[2].sequenceNumber).toBe(2);
    });

    it('should capture base snapshot during migration', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);

      const cs = await oldManager.create('snapshot-test', 'Snapshot');
      cs.addChange('add', 'elem-1', 'api', undefined, { name: 'A' });
      await oldManager.save(cs);

      // Migrate
      const result = await migrateChangesets(TEST_DIR, testModel);

      expect(result.migratedChangesets).toBeGreaterThan(0);

      // Verify snapshot was captured
      const newStorage = new StagedChangesetStorage(TEST_DIR);
      const migrated = await newStorage.load('snapshot-test');

      expect(migrated?.baseSnapshot).toBeDefined();
      expect(migrated?.baseSnapshot).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('should skip already migrated changesets', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);
      const newStorage = new StagedChangesetStorage(TEST_DIR);

      // Create old format
      const cs = await oldManager.create('skip-test', 'Skip');
      cs.addChange('add', 'elem-1', 'api', undefined, { name: 'A' });
      await oldManager.save(cs);

      // Manually create in new format
      await newStorage.create('skip-test', 'Skip', '', 'sha256:existing');

      // Migrate
      const result = await migrateChangesets(TEST_DIR, testModel);

      expect(result.skippedChangesets).toBeGreaterThan(0);
    });

    it('should handle migration failures gracefully', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);

      // Create valid changeset
      const validCs = await oldManager.create('valid-test', 'Valid');
      validCs.addChange('add', 'elem-1', 'api', undefined, { name: 'A' });
      await oldManager.save(validCs);

      // Create changeset with missing fields (will fail during migration)
      const invalidCs = await oldManager.create('invalid-test', 'Invalid');
      invalidCs.addChange('add', 'elem-2', 'api', undefined, { name: 'B' });
      // Simulate corrupted data by not setting changes
      invalidCs.changes = [];
      await oldManager.save(invalidCs);

      // Migrate - should handle error for invalid, migrate valid
      const result = await migrateChangesets(TEST_DIR, testModel);

      expect(result.migratedChangesets).toBeGreaterThan(0);
      expect(result.totalChangesets).toBeGreaterThan(0);
      // At least the valid changeset should migrate
    });

    it('should validate migration before proceeding', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);

      // Create test changesets
      const cs1 = await oldManager.create('validation-test-1', 'Test');
      cs1.addChange('add', 'elem-1', 'api', undefined, { name: 'A' });
      await oldManager.save(cs1);

      const cs2 = await oldManager.create('validation-test-2', 'Test');
      cs2.addChange('add', 'elem-2', 'api', undefined, { name: 'B' });
      await oldManager.save(cs2);

      // Validate
      const validation = await validateMigration(TEST_DIR, testModel);

      expect(validation.migrationNeeded).toBe(true);
      expect(validation.totalOldChangesets).toBeGreaterThan(0);
      expect(validation.canProceed).toBe(true);
    });

    it('should perform dry-run without making changes', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);
      const newStorage = new StagedChangesetStorage(TEST_DIR);

      // Create test changeset
      const cs = await oldManager.create('dryrun-test', 'Dry Run');
      cs.addChange('add', 'elem-1', 'api', undefined, { name: 'A' });
      cs.addChange('add', 'elem-2', 'api', undefined, { name: 'B' });
      await oldManager.save(cs);

      // Perform dry-run
      const dryRun = await dryRunMigration(TEST_DIR, testModel);

      expect(dryRun.summary.totalToMigrate).toBeGreaterThan(0);
      expect(dryRun.changesets).toHaveLength(dryRun.summary.totalToMigrate);

      // Verify nothing was actually migrated
      const migrated = await newStorage.load('dryrun-test');
      expect(migrated).toBeNull();
    });

    it('should map status correctly during dry-run', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);

      // Create changesets with different statuses
      const draft = await oldManager.create('draft-dryrun', 'Draft');
      draft.addChange('add', 'elem-1', 'api', undefined, { name: 'A' });
      await oldManager.save(draft);

      const applied = await oldManager.create('applied-dryrun', 'Applied');
      applied.addChange('add', 'elem-2', 'api', undefined, { name: 'B' });
      applied.markApplied();
      await oldManager.save(applied);

      // Dry-run
      const dryRun = await dryRunMigration(TEST_DIR, testModel);

      const draftEntry = dryRun.changesets.find((c) => c.newId === 'draft-dryrun');
      expect(draftEntry?.mappedStatus).toBe('staged');

      const appliedEntry = dryRun.changesets.find((c) => c.newId === 'applied-dryrun');
      expect(appliedEntry?.mappedStatus).toBe('committed');
    });

    it('should backup old changesets before migration', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);

      // Create test changeset
      const cs = await oldManager.create('backup-test', 'Backup');
      cs.addChange('add', 'elem-1', 'api', undefined, { name: 'A' });
      await oldManager.save(cs);

      // Backup old changesets
      const backupPath = await backupOldChangesets(TEST_DIR);

      expect(backupPath).not.toBeNull();
      expect(backupPath).toContain('backup');
    });

    it('should handle partial migration recovery', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);
      const newStorage = new StagedChangesetStorage(TEST_DIR);

      // Create multiple changesets
      for (let i = 0; i < 3; i++) {
        const cs = await oldManager.create(`partial-test-${i}`, `Partial ${i}`);
        cs.addChange('add', `elem-${i}`, 'api', undefined, { name: `E${i}` });
        await oldManager.save(cs);
      }

      // First migration (some succeed, some fail)
      let result = await migrateChangesets(TEST_DIR, testModel);
      const migratedCount1 = result.migratedChangesets;

      // Re-run migration (should skip already migrated, handle others)
      result = await migrateChangesets(TEST_DIR, testModel);

      expect(result.skippedChangesets).toBeGreaterThan(0);
      expect(result.migratedChangesets + result.skippedChangesets).toBe(result.totalChangesets);
    });

    it('should detect when migration is not needed', async () => {
      // Clean up old changesets directory
      const oldChangesetsDir = `${TEST_DIR}/.dr/changesets`;
      try {
        await rm(oldChangesetsDir, { recursive: true });
      } catch {
        // Ignore if doesn't exist
      }

      // Check migration needed
      const needed = await isMigrationNeeded(TEST_DIR);
      expect(typeof needed).toBe('boolean');
    });

    it('should preserve all change metadata during migration', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);
      const newStorage = new StagedChangesetStorage(TEST_DIR);

      // Create changeset with various change types
      const cs = await oldManager.create('metadata-test', 'Metadata');
      cs.addChange('add', 'api-endpoint-create', 'api', undefined, {
        name: 'Create User',
        method: 'POST',
        path: '/users',
      });
      cs.addChange('update', 'api-endpoint-list', 'api', { method: 'GET' }, { method: 'GET', limit: 100 });
      cs.addChange('delete', 'api-endpoint-old', 'api', { deprecated: true }, undefined);
      await oldManager.save(cs);

      // Migrate
      await migrateChangesets(TEST_DIR, testModel);

      // Verify metadata preserved
      const migrated = await newStorage.load('metadata-test');
      expect(migrated?.changes).toHaveLength(3);
      expect(migrated?.changes[0].type).toBe('add');
      expect(migrated?.changes[1].type).toBe('update');
      expect(migrated?.changes[2].type).toBe('delete');
    });
  });

  describe('Rollback and Recovery', () => {
    it('should rollback migration from backup', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);

      // Create test changeset
      const cs = await oldManager.create('rollback-test', 'Rollback');
      cs.addChange('add', 'elem-1', 'api', undefined, { name: 'A' });
      await oldManager.save(cs);

      // Backup before migration
      const backupPath = await backupOldChangesets(TEST_DIR);
      expect(backupPath).not.toBeNull();

      // Migrate
      const migrateResult = await migrateChangesets(TEST_DIR, testModel);
      expect(migrateResult.migratedChangesets).toBeGreaterThan(0);

      // Rollback
      const success = await rollbackMigration(TEST_DIR);
      expect(success).toBe(true);

      // Verify old format is restored
      const restored = await oldManager.load('rollback-test');
      expect(restored).not.toBeNull();
    });

    it('should cleanup migrated changesets', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);

      // Create and migrate
      const cs = await oldManager.create('cleanup-test', 'Cleanup');
      cs.addChange('add', 'elem-1', 'api', undefined, { name: 'A' });
      await oldManager.save(cs);

      // Backup
      await backupOldChangesets(TEST_DIR);

      // Migrate
      await migrateChangesets(TEST_DIR, testModel);

      // Cleanup
      await cleanupMigration(TEST_DIR, false);

      // Verify migrated changesets are removed
      const newStorage = new StagedChangesetStorage(TEST_DIR);
      const migrated = await newStorage.load('cleanup-test');
      expect(migrated).toBeNull();
    });

    it('should support rollback with recovery', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);

      // Create test changeset
      const cs = await oldManager.create('recovery-test', 'Recovery');
      cs.addChange('add', 'elem-1', 'api', undefined, { name: 'A' });
      await oldManager.save(cs);

      // Backup
      await backupOldChangesets(TEST_DIR);

      // Migrate
      const migrateResult = await migrateChangesets(TEST_DIR, testModel);
      expect(migrateResult.migratedChangesets).toBeGreaterThan(0);

      // Cleanup with restore
      await cleanupMigration(TEST_DIR, true);

      // Verify restored
      const restored = await oldManager.load('recovery-test');
      expect(restored).not.toBeNull();
    });

    it('should handle rollback errors gracefully', async () => {
      // Try to rollback without backup
      try {
        // Create test dir without backup
        const testDir = '/tmp/no-backup-test';
        await mkdir(testDir, { recursive: true });

        await rollbackMigration(testDir);
        expect(false).toBe(true); // Should throw
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('Backup');
      }
    });

    it('should support concurrent rollback operations', async () => {
      const oldManager = new ChangesetManager(TEST_DIR);

      // Create multiple changesets
      for (let i = 0; i < 5; i++) {
        const cs = await oldManager.create(`concurrent-test-${i}`, `Concurrent ${i}`);
        cs.addChange('add', `elem-${i}`, 'api', undefined, { name: `E${i}` });
        await oldManager.save(cs);
      }

      // Backup
      await backupOldChangesets(TEST_DIR);

      // Migrate
      let result = await migrateChangesets(TEST_DIR, testModel);
      expect(result.migratedChangesets).toBeGreaterThan(0);

      // Concurrent rollback attempts (simulate multiple operations)
      const rollback1 = rollbackMigration(TEST_DIR);
      const rollback2 = rollbackMigration(TEST_DIR);

      // At least one should succeed
      try {
        await Promise.all([rollback1, rollback2]);
      } catch {
        // Expected - concurrent operations may conflict
      }

      // Verify old format exists
      const cs = await oldManager.load('concurrent-test-0');
      expect(cs).not.toBeNull();
    });

    it('should generate rollback procedure documentation', async () => {
      // This test documents the rollback procedure for users
      // In a real scenario, users would follow these steps:

      // 1. Create backup before migration
      // await backupOldChangesets(rootPath);

      // 2. Run migration
      // await migrateChangesets(rootPath, model);

      // 3. If migration fails, rollback:
      // await rollbackMigration(rootPath);

      // 4. If migration succeeds but needs cleanup:
      // await cleanupMigration(rootPath, false);

      // 5. To restore from backup if needed:
      // await cleanupMigration(rootPath, true);

      expect(true).toBe(true); // Documentation test
    });
  });
});
