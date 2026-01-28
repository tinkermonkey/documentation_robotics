/**
 * Changeset Storage Location Validation Tests
 *
 * These tests validate that changesets are stored in the correct location:
 * documentation-robotics/changesets/{changeset-id}/
 *
 * The storage structure includes:
 * - metadata.yaml: Contains name, description, dates, status, base snapshot
 * - changes.yaml: Contains the list of changes (delta-only format)
 *
 * Tests verify:
 * - Changesets are created in the new storage location
 * - Directory structure is correctly organized
 * - Files (metadata.yaml, changes.yaml) exist and contain valid data
 * - Old .dr/changesets/ location is not used
 * - Changeset data persists correctly across operations
 * - Active marker file tracked in correct location
 *
 * Note: These tests validate the low-level StagedChangesetStorage implementation.
 * Higher-level StagingAreaManager tests (which map draft→staged status and provide
 * apply/revert aliases) are in test_staging_area_manager.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StagedChangesetStorage } from '../../src/core/staged-changeset-storage.js';
import { StagingAreaManager } from '../../src/core/staging-area.js';
import { BaseSnapshotManager } from '../../src/core/base-snapshot-manager.js';
import { Model } from '../../src/core/model.js';
import { Manifest } from '../../src/core/manifest.js';
import { Layer } from '../../src/core/layer.js';
import { Element } from '../../src/core/element.js';
import { tmpdir } from 'os';
import { mkdtemp, rm, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { fileExists } from '../../src/utils/file-io.js';
import yaml from 'yaml';

describe('Changeset Storage Location', () => {
  let baseModel: Model;
  let storage: StagedChangesetStorage;
  let snapshotManager: BaseSnapshotManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dr-storage-test-'));
    storage = new StagedChangesetStorage(tempDir);
    snapshotManager = new BaseSnapshotManager();

    // Create test model
    const manifest = new Manifest({
      name: 'Storage Test Model',
      description: 'Model for testing changeset storage location',
      version: '1.0.0',
      specVersion: '0.7.1',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    baseModel = new Model(tempDir, manifest);

    // Add API layer for testing
    const apiLayer = new Layer('api');
    const endpoint = new Element({
      id: 'api-endpoint-list-items',
      type: 'endpoint',
      name: 'List Items',
      description: 'List all items',
      properties: { method: 'GET', path: '/items' },
    });
    apiLayer.addElement(endpoint);

    baseModel.addLayer(apiLayer);
    await baseModel.saveManifest();
    await baseModel.saveLayer('api');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Storage Location Structure', () => {
    it('should create changeset in documentation-robotics/changesets/ directory', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const changesetId = 'test-storage-location';

      await storage.create(
        changesetId,
        'Test Storage Location',
        'Verify storage location',
        baseSnapshot
      );

      // Verify the new storage location exists
      const expectedPath = join(tempDir, 'documentation-robotics', 'changesets', changesetId);
      expect(await fileExists(expectedPath)).toBe(true);

      // Verify old .dr/changesets location is NOT used
      const oldPath = join(tempDir, '.dr', 'changesets', changesetId);
      expect(await fileExists(oldPath)).toBe(false);
    });

    it('should organize changesets by ID in documentation-robotics/changesets/', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      // Create multiple changesets
      const ids = ['feature-1', 'feature-2', 'bugfix-1'];
      for (const id of ids) {
        await storage.create(id, `Changeset ${id}`, `Test ${id}`, baseSnapshot);
      }

      // Verify each changeset has its own directory
      const changesetsDir = join(tempDir, 'documentation-robotics', 'changesets');
      const subdirs = await readdir(changesetsDir);
      expect(subdirs).toEqual(expect.arrayContaining(ids));
    });
  });

  describe('File Structure and Contents', () => {
    it('should create metadata.yaml file with correct structure', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const changesetId = 'metadata-test';

      await storage.create(
        changesetId,
        'Metadata Test',
        'Test metadata file structure',
        baseSnapshot
      );

      // Verify metadata.yaml exists
      const metadataPath = join(
        tempDir,
        'documentation-robotics',
        'changesets',
        changesetId,
        'metadata.yaml'
      );
      expect(await fileExists(metadataPath)).toBe(true);

      // Read and parse metadata
      const metadataContent = await readFile(metadataPath, 'utf-8');
      const metadata = yaml.parse(metadataContent);

      // Verify required fields
      expect(metadata).toHaveProperty('id');
      expect(metadata).toHaveProperty('name');
      expect(metadata).toHaveProperty('created');
      expect(metadata).toHaveProperty('modified');
      expect(metadata).toHaveProperty('status');
      expect(metadata).toHaveProperty('baseSnapshot');
      expect(metadata).toHaveProperty('stats');

      // Verify field values
      expect(metadata.id).toBe(changesetId);
      expect(metadata.name).toBe('Metadata Test');
      expect(metadata.description).toBe('Test metadata file structure');
      // Status is 'draft' at the StagedChangesetStorage level (low-level storage layer).
      // StagingAreaManager maps this to 'staged' for user-facing operations.
      expect(metadata.status).toBe('draft');
      expect(metadata.baseSnapshot).toBe(baseSnapshot);
      expect(metadata.stats).toEqual({
        additions: 0,
        modifications: 0,
        deletions: 0,
      });
    });

    it('should create changes.yaml file with empty list initially', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const changesetId = 'changes-test';

      await storage.create(
        changesetId,
        'Changes Test',
        'Test changes file',
        baseSnapshot
      );

      // Verify changes.yaml exists
      const changesPath = join(
        tempDir,
        'documentation-robotics',
        'changesets',
        changesetId,
        'changes.yaml'
      );
      expect(await fileExists(changesPath)).toBe(true);

      // Read and parse changes
      const changesContent = await readFile(changesPath, 'utf-8');
      const changes = yaml.parse(changesContent);

      // Verify it's an empty array initially
      expect(Array.isArray(changes)).toBe(true);
      expect(changes).toHaveLength(0);
    });

    it('should have exactly two files in changeset directory', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const changesetId = 'file-count-test';

      await storage.create(
        changesetId,
        'File Count Test',
        'Verify exactly 2 files',
        baseSnapshot
      );

      // List files in changeset directory
      const changesetDir = join(
        tempDir,
        'documentation-robotics',
        'changesets',
        changesetId
      );
      const files = await readdir(changesetDir);

      // Should have exactly 2 files
      expect(files).toHaveLength(2);
      expect(files).toContain('metadata.yaml');
      expect(files).toContain('changes.yaml');
    });
  });

  describe('Data Persistence', () => {
    it('should persist changeset metadata across storage operations', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const changesetId = 'persistence-test';

      // Create changeset
      const original = await storage.create(
        changesetId,
        'Persistence Test',
        'Test data persistence',
        baseSnapshot
      );

      // Load it back
      const loaded = await storage.load(changesetId);

      // Verify all metadata persists
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(original.id);
      expect(loaded?.name).toBe(original.name);
      expect(loaded?.description).toBe(original.description);
      expect(loaded?.status).toBe(original.status);
      expect(loaded?.baseSnapshot).toBe(original.baseSnapshot);
      expect(loaded?.created).toBe(original.created);
      expect(loaded?.modified).toBe(original.modified);
    });

    it('should persist changes added to changeset', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const changesetId = 'changes-persistence-test';

      const changeset = await storage.create(
        changesetId,
        'Changes Persistence Test',
        'Test changes persistence',
        baseSnapshot
      );

      // Add changes to the changeset
      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-new',
          layerName: 'api',
          after: {
            id: 'api-endpoint-new',
            type: 'endpoint',
            name: 'New Endpoint',
            properties: { method: 'POST', path: '/items' },
          },
        },
      ];

      // Save changes to storage
      await storage.save(changeset);

      // Load it back
      const loaded = await storage.load(changesetId);

      // Verify changes persist
      expect(loaded).not.toBeNull();
      expect(loaded?.changes).toHaveLength(1);
      expect(loaded?.changes[0].type).toBe('add');
      expect(loaded?.changes[0].elementId).toBe('api-endpoint-new');
      expect(loaded?.changes[0].after.name).toBe('New Endpoint');
    });
  });

  describe('Changeset Listing', () => {
    it('should list all changesets from documentation-robotics/changesets/', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      // Create multiple changesets
      const ids = ['feature-alpha', 'feature-beta', 'bugfix-gamma'];
      for (const id of ids) {
        await storage.create(id, `Changeset ${id}`, `Description ${id}`, baseSnapshot);
      }

      // List all changesets
      const all = await storage.list();

      // Verify all are listed
      const listedIds = all.map((cs) => cs.id);
      expect(listedIds).toEqual(expect.arrayContaining(ids));
      expect(all).toHaveLength(ids.length);
    });

    it('should list changesets with correct metadata', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const changesetId = 'listing-test';

      await storage.create(
        changesetId,
        'Listing Test',
        'Test changeset listing',
        baseSnapshot
      );

      const all = await storage.list();
      const found = all.find((cs) => cs.id === changesetId);

      expect(found).not.toBeUndefined();
      expect(found?.name).toBe('Listing Test');
      expect(found?.description).toBe('Test changeset listing');
    });
  });

  describe('Changeset Deletion', () => {
    it('should delete changeset directory from documentation-robotics/changesets/', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const changesetId = 'delete-test';

      await storage.create(
        changesetId,
        'Delete Test',
        'Test changeset deletion',
        baseSnapshot
      );

      const expectedPath = join(
        tempDir,
        'documentation-robotics',
        'changesets',
        changesetId
      );
      expect(await fileExists(expectedPath)).toBe(true);

      // Delete the changeset
      await storage.delete(changesetId);

      // Verify it's deleted
      expect(await fileExists(expectedPath)).toBe(false);
    });

    it('should not affect other changesets when deleting', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      // Create two changesets
      const id1 = 'delete-keep-test-1';
      const id2 = 'delete-keep-test-2';

      await storage.create(id1, 'Keep Test 1', 'First changeset', baseSnapshot);
      await storage.create(id2, 'Keep Test 2', 'Second changeset', baseSnapshot);

      // Delete first one
      await storage.delete(id1);

      // Verify first is gone
      expect(await storage.load(id1)).toBeNull();

      // Verify second still exists
      const loaded = await storage.load(id2);
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(id2);
    });
  });

  describe('Storage Path Verification', () => {
    it('should never create changesets in .dr/ directory', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const changesetId = 'no-dr-location';

      await storage.create(
        changesetId,
        'No DR Location',
        'Ensure not in .dr/',
        baseSnapshot
      );

      // Verify .dr directory is not created for changesets
      const drChangesetPath = join(tempDir, '.dr', 'changesets');
      const doesExist = await fileExists(drChangesetPath);

      // Even if .dr exists for other purposes, changesets should not be there
      if (doesExist) {
        const files = await readdir(drChangesetPath);
        expect(files).not.toContain(changesetId);
      }
    });

    it('should use kebab-case IDs in storage paths', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const changesetId = 'kebab-case-id';

      await storage.create(
        changesetId,
        'Kebab Case Test',
        'Verify kebab-case usage',
        baseSnapshot
      );

      // Verify directory uses kebab-case
      const changesetDir = join(
        tempDir,
        'documentation-robotics',
        'changesets',
        changesetId
      );
      expect(await fileExists(changesetDir)).toBe(true);

      // List parent directory to verify kebab-case is used
      const changesetsDir = join(tempDir, 'documentation-robotics', 'changesets');
      const dirs = await readdir(changesetsDir);
      expect(dirs).toContain('kebab-case-id');
    });
  });

  describe('Active Changeset Tracking', () => {
    it('should create .active marker in documentation-robotics/changesets/', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const changesetId = 'active-marker-test';
      const stagingManager = new StagingAreaManager(tempDir, baseModel);

      // Create and set active
      await storage.create(
        changesetId,
        'Active Marker Test',
        'Test active marker location',
        baseSnapshot
      );
      await stagingManager.setActive(changesetId);

      // Verify .active marker exists in correct location
      const activeMarkerPath = join(
        tempDir,
        'documentation-robotics',
        'changesets',
        '.active'
      );
      expect(await fileExists(activeMarkerPath)).toBe(true);

      // Verify marker contains correct changeset ID
      const markerContent = await readFile(activeMarkerPath, 'utf-8');
      expect(markerContent.trim()).toBe(changesetId);
    });

    it('should not create .active marker in .dr/changesets/', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const changesetId = 'not-in-dr-active';
      const stagingManager = new StagingAreaManager(tempDir, baseModel);

      await storage.create(
        changesetId,
        'Not in DR',
        'Verify .active not in .dr',
        baseSnapshot
      );
      await stagingManager.setActive(changesetId);

      // Verify old location is not used
      const oldActiveMarkerPath = join(tempDir, '.dr', 'changesets', 'active');
      expect(await fileExists(oldActiveMarkerPath)).toBe(false);
    });
  });

  describe('Directory Structure Consistency', () => {
    it('should create documentation-robotics directory structure if missing', async () => {
      // Verify directory exists after first changeset
      const emptyDir = join(tempDir, 'empty-model');
      await rm(emptyDir, { recursive: true, force: true });

      const tempStorage = new StagedChangesetStorage(emptyDir);
      const testModel = new Model(
        emptyDir,
        new Manifest({
          name: 'Empty Model',
          description: 'Test auto-creation of dirs',
          version: '1.0.0',
          specVersion: '0.7.1',
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        })
      );

      await testModel.saveManifest();

      const testLayer = new Layer('api');
      const endpoint = new Element({
        id: 'api-endpoint-test',
        type: 'endpoint',
        name: 'Test Endpoint',
        properties: { method: 'GET', path: '/test' },
      });
      testLayer.addElement(endpoint);
      testModel.addLayer(testLayer);
      await testModel.saveLayer('api');

      const baseSnapshot = await snapshotManager.captureSnapshot(testModel);

      // Create changeset - should create directory structure
      await tempStorage.create(
        'auto-dir-test',
        'Auto Directory Test',
        'Test auto-creation',
        baseSnapshot
      );

      // Verify structure was created
      const docRoboticsDir = join(emptyDir, 'documentation-robotics');
      const changesetsDir = join(docRoboticsDir, 'changesets');
      const changesetDir = join(changesetsDir, 'auto-dir-test');

      expect(await fileExists(docRoboticsDir)).toBe(true);
      expect(await fileExists(changesetsDir)).toBe(true);
      expect(await fileExists(changesetDir)).toBe(true);

      // Cleanup
      await rm(emptyDir, { recursive: true, force: true });
    });

    it('should maintain consistent directory structure across multiple operations', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const ids = ['op1', 'op2', 'op3', 'op4', 'op5'];

      // Create, modify, list, and delete in sequence
      for (const id of ids) {
        await storage.create(id, `Op ${id}`, `Operation ${id}`, baseSnapshot);
      }

      // Verify structure
      const changesetsDir = join(tempDir, 'documentation-robotics', 'changesets');
      const dirs = await readdir(changesetsDir);
      expect(dirs.sort()).toEqual(ids.sort());

      // Load all and verify each has correct files
      for (const id of ids) {
        const changeset = await storage.load(id);
        expect(changeset).not.toBeNull();
        expect(changeset?.id).toBe(id);

        const changesetPath = join(changesetsDir, id);
        const files = await readdir(changesetPath);
        expect(files.sort()).toEqual(['changes.yaml', 'metadata.yaml']);
      }
    });
  });

  describe('Storage Location Documentation', () => {
    it('should use documentation-robotics as root directory (not .dr)', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      await storage.create(
        'doc-root-test',
        'Documentation Root Test',
        'Verify root directory',
        baseSnapshot
      );

      // Verify documentation-robotics path
      const docRoboticsPath = join(tempDir, 'documentation-robotics', 'changesets');
      const changesetPath = join(docRoboticsPath, 'doc-root-test');
      expect(await fileExists(changesetPath)).toBe(true);

      // Confirm .dr is not used for changesets
      const drPath = join(tempDir, '.dr', 'changesets', 'doc-root-test');
      expect(await fileExists(drPath)).toBe(false);
    });

    it('should follow naming convention: documentation-robotics/changesets/{id}/', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);
      const ids = ['alpha', 'beta', 'gamma'];

      for (const id of ids) {
        await storage.create(id, `Test ${id}`, `Description ${id}`, baseSnapshot);
      }

      // Verify each changeset follows the naming convention
      for (const id of ids) {
        const expectedPath = join(tempDir, 'documentation-robotics', 'changesets', id);
        expect(await fileExists(expectedPath)).toBe(true);

        // Verify files within
        const metadataPath = join(expectedPath, 'metadata.yaml');
        const changesPath = join(expectedPath, 'changes.yaml');
        expect(await fileExists(metadataPath)).toBe(true);
        expect(await fileExists(changesPath)).toBe(true);
      }
    });
  });
});
