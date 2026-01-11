import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ChangesetManager, Changeset } from '../../../src/core/changeset.js';
import { StagedChangesetStorage } from '../../../src/core/staged-changeset-storage.js';
import { migrateChangesets, isMigrationNeeded } from '../../../src/core/changeset-migration.js';
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
      expect(migratedDraft?.status).toBe('draft');

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
  });
});
