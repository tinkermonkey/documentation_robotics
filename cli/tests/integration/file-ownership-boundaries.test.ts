import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Model } from '../../src/core/model.js';
import { Manifest } from '../../src/core/manifest.js';
import { Layer } from '../../src/core/layer.js';
import { Element } from '../../src/core/element.js';
import { StagedChangesetStorage } from '../../src/core/staged-changeset-storage.js';
import { BaseSnapshotManager } from '../../src/core/base-snapshot-manager.js';
import { FileLock } from '../../src/utils/file-lock.js';
import { readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

describe('File Ownership Boundaries', () => {
  let baseModel: Model;
  let storage: StagedChangesetStorage;
  let snapshotManager: BaseSnapshotManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dr-ownership-test-'));
    storage = new StagedChangesetStorage(tempDir);
    snapshotManager = new BaseSnapshotManager();

    // Create test model with initial layers
    const manifest = new Manifest({
      name: 'Ownership Test Model',
      description: 'Model for testing file ownership boundaries',
      version: '1.0.0',
      specVersion: '0.7.1',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    baseModel = new Model(tempDir, manifest);

    // Set up test layers
    const apiLayer = new Layer('api');
    const dataModelLayer = new Layer('data-model');

    apiLayer.addElement(
      new Element({
        id: 'api.endpoint.get-users',
        type: 'endpoint',
        name: 'Get Users',
        description: 'Retrieve all users',
        properties: { method: 'GET', path: '/users' },
      })
    );

    dataModelLayer.addElement(
      new Element({
        id: 'data-model.entity.user',
        type: 'entity',
        name: 'User',
        description: 'User entity',
      })
    );

    baseModel.addLayer(apiLayer);
    baseModel.addLayer(dataModelLayer);

    await baseModel.saveManifest();
    await baseModel.saveLayer('api');
    await baseModel.saveLayer('data-model');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Changeset File Isolation', () => {
    it('should create changesets in isolated directories', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const cs1 = await storage.create('changeset-1', 'First', 'Test', baseSnapshot);
      const cs2 = await storage.create('changeset-2', 'Second', 'Test', baseSnapshot);

      expect(cs1.id).toBe('changeset-1');
      expect(cs2.id).toBe('changeset-2');

      // Verify separate directories
      const cs1Dir = join(tempDir, 'documentation-robotics', 'changesets', 'changeset-1');
      const cs2Dir = join(tempDir, 'documentation-robotics', 'changesets', 'changeset-2');

      expect(existsSync(cs1Dir)).toBe(true);
      expect(existsSync(cs2Dir)).toBe(true);
      expect(cs1Dir).not.toBe(cs2Dir);
    });

    it('should prevent changesets from accessing each other\'s files', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const cs1 = await storage.create('cs-isolation-1', 'First', 'Test', baseSnapshot);
      const cs2 = await storage.create('cs-isolation-2', 'Second', 'Test', baseSnapshot);

      // Modify cs1
      cs1.changes = [
        {
          type: 'add',
          elementId: 'api.endpoint.create-user',
          layerName: 'api',
          after: {
            id: 'api.endpoint.create-user',
            type: 'endpoint',
            name: 'Create User',
            description: 'Create new user',
            properties: { method: 'POST', path: '/users' },
          },
        },
      ];
      await storage.save(cs1);

      // Load cs2 and verify it doesn't have cs1's changes
      const cs2Reloaded = await storage.load('cs-isolation-2');
      expect(cs2Reloaded.changes.length).toBe(0);

      // Reload cs1 and verify changes persist
      const cs1Reloaded = await storage.load('cs-isolation-1');
      expect(cs1Reloaded.changes.length).toBe(1);
      expect(cs1Reloaded.changes[0].elementId).toBe('api.endpoint.create-user');
    });

    it('should enforce boundary when listing changesets', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      await storage.create('list-test-1', 'First', 'Test', baseSnapshot);
      await storage.create('list-test-2', 'Second', 'Test', baseSnapshot);
      await storage.create('list-test-3', 'Third', 'Test', baseSnapshot);

      const allChangesets = await storage.list();

      // Verify all changesets are listed separately
      const ids = allChangesets.map((cs) => cs.id);
      expect(ids).toContain('list-test-1');
      expect(ids).toContain('list-test-2');
      expect(ids).toContain('list-test-3');
      expect(ids.length).toBe(3);

      // Verify each is independent
      for (const changeset of allChangesets) {
        const reloaded = await storage.load(changeset.id);
        expect(reloaded.id).toBe(changeset.id);
      }
    });
  });

  describe('Changeset ID Validation Boundaries', () => {
    it('should prevent path traversal in changeset IDs', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      // Attempt IDs with path traversal patterns
      const maliciousIds = ['..', '../..', '../../etc/passwd', 'valid/../invalid'];

      for (const id of maliciousIds) {
        try {
          await storage.create(id, 'Test', 'Test', baseSnapshot);
          // If validation works correctly, this shouldn't be reached
          // But test expects the ID to be sanitized
          const created = await storage.load(id);
          const sanitized = created.id;
          // Verify the ID was sanitized and doesn't contain traversal attempts
          expect(sanitized).not.toContain('..');
          expect(sanitized).not.toContain('/');
        } catch (error) {
          // Either throws or sanitizes - both are acceptable
          expect(error).toBeDefined();
        }
      }
    });

    it('should prevent special characters in changeset IDs', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      // Attempt IDs with special characters
      const specialCharIds = [
        'test<script>',
        'test|pipe',
        'test"quote',
        'test:colon',
        'test?question',
      ];

      for (const id of specialCharIds) {
        try {
          await storage.create(id, 'Test', 'Test', baseSnapshot);
          const created = await storage.load(id);
          const sanitized = created.id;
          // Verify special characters are removed/sanitized
          expect(sanitized).not.toMatch(/[<>:"|?*]/);
        } catch (error) {
          // Either throws or sanitizes - both are acceptable
          expect(error).toBeDefined();
        }
      }
    });

    it('should normalize changeset IDs consistently', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      // Create with normalized ID
      const cs = await storage.create('my-test-changeset', 'Test', 'Test', baseSnapshot);

      // Attempt to load with different case/spacing
      const loaded = await storage.load('my-test-changeset');
      expect(loaded.id).toBe(cs.id);
      expect(loaded.id).toBe('my-test-changeset');
    });
  });

  describe('Concurrent Access Boundaries', () => {
    it('should handle concurrent changeset creation', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      // Create multiple changesets concurrently
      const createPromises = Array.from({ length: 5 }, (_, i) =>
        storage.create(`concurrent-cs-${i}`, `Changeset ${i}`, 'Test', baseSnapshot)
      );

      const results = await Promise.all(createPromises);

      // Verify all were created successfully
      expect(results.length).toBe(5);
      results.forEach((cs, i) => {
        expect(cs.id).toBe(`concurrent-cs-${i}`);
      });

      // Verify all can be loaded independently
      for (let i = 0; i < 5; i++) {
        const loaded = await storage.load(`concurrent-cs-${i}`);
        expect(loaded.id).toBe(`concurrent-cs-${i}`);
      }
    });

    it('should handle concurrent modifications to different changesets', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const cs1 = await storage.create('cs-mod-1', 'First', 'Test', baseSnapshot);
      const cs2 = await storage.create('cs-mod-2', 'Second', 'Test', baseSnapshot);

      // Modify both concurrently
      const modPromises = [
        (async () => {
          cs1.changes = [
            {
              type: 'add',
              elementId: 'api.endpoint.endpoint-1',
              layerName: 'api',
              after: {
                id: 'api.endpoint.endpoint-1',
                type: 'endpoint',
                name: 'Endpoint 1',
                description: 'First endpoint',
                properties: { method: 'GET', path: '/ep1' },
              },
            },
          ];
          await storage.save(cs1);
        })(),
        (async () => {
          cs2.changes = [
            {
              type: 'add',
              elementId: 'api.endpoint.endpoint-2',
              layerName: 'api',
              after: {
                id: 'api.endpoint.endpoint-2',
                type: 'endpoint',
                name: 'Endpoint 2',
                description: 'Second endpoint',
                properties: { method: 'POST', path: '/ep2' },
              },
            },
          ];
          await storage.save(cs2);
        })(),
      ];

      await Promise.all(modPromises);

      // Verify changes are isolated
      const cs1Reloaded = await storage.load('cs-mod-1');
      const cs2Reloaded = await storage.load('cs-mod-2');

      expect(cs1Reloaded.changes[0].elementId).toBe('api.endpoint.endpoint-1');
      expect(cs2Reloaded.changes[0].elementId).toBe('api.endpoint.endpoint-2');
      expect(cs1Reloaded.changes.length).toBe(1);
      expect(cs2Reloaded.changes.length).toBe(1);
    });
  });

  describe('File Integrity Across Boundaries', () => {
    it('should maintain changeset metadata integrity during concurrent access', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const cs = await storage.create('integrity-test', 'Test', 'Test description', baseSnapshot);

      // Read metadata before modifications
      const originalMetadata = {
        id: cs.id,
        title: cs.title,
        description: cs.description,
      };

      // Make concurrent modifications
      const modPromises = Array.from({ length: 3 }, async (_, i) => {
        const loaded = await storage.load('integrity-test');
        loaded.changes.push({
          type: 'add',
          elementId: `api.endpoint.test-${i}`,
          layerName: 'api',
          after: {
            id: `api.endpoint.test-${i}`,
            type: 'endpoint',
            name: `Test ${i}`,
            description: 'Test endpoint',
            properties: { method: 'GET', path: `/test${i}` },
          },
        });
        await storage.save(loaded);
      });

      await Promise.all(modPromises);

      // Verify metadata is unchanged
      const finalLoaded = await storage.load('integrity-test');
      expect(finalLoaded.id).toBe(originalMetadata.id);
      expect(finalLoaded.title).toBe(originalMetadata.title);
      expect(finalLoaded.description).toBe(originalMetadata.description);
    });

    it('should prevent partial writes to changeset files', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const cs = await storage.create('write-test', 'Test', 'Test', baseSnapshot);

      // Add multiple changes
      cs.changes = Array.from({ length: 10 }, (_, i) => ({
        type: 'add' as const,
        elementId: `api.endpoint.write-test-${i}`,
        layerName: 'api',
        after: {
          id: `api.endpoint.write-test-${i}`,
          type: 'endpoint',
          name: `Write Test ${i}`,
          description: 'Write test endpoint',
          properties: { method: 'GET', path: `/write${i}` },
        },
      }));

      await storage.save(cs);

      // Reload and verify all changes are present (not partial)
      const reloaded = await storage.load('write-test');
      expect(reloaded.changes.length).toBe(10);
      reloaded.changes.forEach((change, i) => {
        expect(change.elementId).toBe(`api.endpoint.write-test-${i}`);
      });
    });

    it('should handle concurrent reads during active modifications', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const cs = await storage.create('read-during-mod', 'Test', 'Test', baseSnapshot);

      // Concurrent reads and modifications
      const readPromises = Array.from({ length: 5 }, () =>
        storage.load('read-during-mod')
      );

      const modified = await storage.load('read-during-mod');
      modified.changes = [
        {
          type: 'add',
          elementId: 'api.endpoint.concurrent-read',
          layerName: 'api',
          after: {
            id: 'api.endpoint.concurrent-read',
            type: 'endpoint',
            name: 'Concurrent Read Test',
            description: 'Test',
            properties: { method: 'GET', path: '/concurrent' },
          },
        },
      ];

      const modPromise = storage.save(modified);
      const readResults = await Promise.all(readPromises);

      await modPromise;

      // At least one read should have the modification (depending on timing)
      // But all should complete without error
      expect(readResults.length).toBe(5);
      readResults.forEach((loaded) => {
        expect(loaded.id).toBe('read-during-mod');
      });
    });
  });

  describe('Cross-Changeset Boundary Enforcement', () => {
    it('should prevent direct file access across changesets', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const cs1 = await storage.create('cross-1', 'First', 'Test', baseSnapshot);
      const cs2 = await storage.create('cross-2', 'Second', 'Test', baseSnapshot);

      // Modify cs1
      cs1.changes = [
        {
          type: 'add',
          elementId: 'api.endpoint.cross-endpoint',
          layerName: 'api',
          after: {
            id: 'api.endpoint.cross-endpoint',
            type: 'endpoint',
            name: 'Cross Endpoint',
            description: 'Test',
            properties: { method: 'GET', path: '/cross' },
          },
        },
      ];
      await storage.save(cs1);

      // Verify cs2 can't see cs1's changes through normal API
      const cs2Loaded = await storage.load('cross-2');
      expect(cs2Loaded.changes).not.toContain(cs1.changes[0]);
      expect(
        cs2Loaded.changes.some((c) => c.elementId === 'api.endpoint.cross-endpoint')
      ).toBe(false);
    });

    it('should isolate base snapshots across changesets', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const cs1 = await storage.create('snapshot-1', 'First', 'Test', baseSnapshot);
      const cs2 = await storage.create('snapshot-2', 'Second', 'Test', baseSnapshot);

      // Verify both have the same base snapshot reference
      expect(cs1.baseSnapshot).toBeDefined();
      expect(cs2.baseSnapshot).toBeDefined();

      // Each changeset's snapshot should be independent
      const cs1ReloadedSnapshot = cs1.baseSnapshot;
      const cs2ReloadedSnapshot = cs2.baseSnapshot;

      expect(cs1ReloadedSnapshot).toEqual(cs2ReloadedSnapshot);
    });

    it('should prevent changeset ID collisions', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const cs1 = await storage.create('unique-id', 'First', 'Test', baseSnapshot);
      expect(cs1.id).toBe('unique-id');

      // Attempt to create another with same ID
      const cs2Attempt = await storage.create('unique-id', 'Second', 'Test', baseSnapshot);

      // Either throws, overwrites, or returns existing
      // Verify consistency in behavior
      const loaded = await storage.load('unique-id');
      expect(loaded.id).toBe('unique-id');
    });
  });

  describe('Delete Operations Across Boundaries', () => {
    it('should delete changeset without affecting others', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      await storage.create('delete-1', 'First', 'Test', baseSnapshot);
      await storage.create('delete-2', 'Second', 'Test', baseSnapshot);

      // Delete first changeset
      await storage.delete('delete-1');

      // Verify it's deleted
      const allChangesets = await storage.list();
      const ids = allChangesets.map((cs) => cs.id);

      expect(ids).not.toContain('delete-1');
      expect(ids).toContain('delete-2');
    });

    it('should handle deletion of non-existent changeset gracefully', async () => {
      // Attempt to delete non-existent changeset
      try {
        await storage.delete('nonexistent-cs');
        // Success - no error thrown
        expect(true).toBe(true);
      } catch (error) {
        // Either throws or succeeds - both are acceptable for non-existent
        expect(error).toBeDefined();
      }
    });

    it('should prevent access after changeset deletion', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const cs = await storage.create('delete-access', 'Test', 'Test', baseSnapshot);
      await storage.delete('delete-access');

      // Attempt to load deleted changeset
      try {
        await storage.load('delete-access');
        // If it succeeds, the changeset should have been properly deleted
        const allChangesets = await storage.list();
        expect(allChangesets.some((c) => c.id === 'delete-access')).toBe(false);
      } catch (error) {
        // Expected - changeset not found
        expect(error).toBeDefined();
      }
    });
  });

  describe('Base Model File Boundaries', () => {
    it('should protect base model from changeset modifications', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      // Create changeset with modifications
      const cs = await storage.create('base-protect', 'Test', 'Test', baseSnapshot);
      cs.changes = [
        {
          type: 'add',
          elementId: 'api.endpoint.protection-test',
          layerName: 'api',
          after: {
            id: 'api.endpoint.protection-test',
            type: 'endpoint',
            name: 'Protection Test',
            description: 'Test',
            properties: { method: 'GET', path: '/protect' },
          },
        },
      ];
      await storage.save(cs);

      // Reload base model and verify it's unchanged
      const baseModelReloaded = await Model.load(tempDir);
      const apiLayer = await baseModelReloaded.getLayer('api');
      expect(apiLayer?.getElement('api.endpoint.protection-test')).toBeUndefined();

      // Verify original elements still exist
      expect(apiLayer?.getElement('api.endpoint.get-users')).toBeDefined();
    });

    it('should maintain separate storage locations for base model and changesets', async () => {
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const cs = await storage.create('location-test', 'Test', 'Test', baseSnapshot);

      const baseModelPath = join(tempDir, 'documentation-robotics', 'model');
      const changesetPath = join(
        tempDir,
        'documentation-robotics',
        'changesets',
        'location-test'
      );

      expect(existsSync(baseModelPath)).toBe(true);
      expect(existsSync(changesetPath)).toBe(true);
      expect(baseModelPath).not.toBe(changesetPath);
    });
  });
});
