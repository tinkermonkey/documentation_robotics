/**
 * Unit tests for StagingAreaManager
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { StagingAreaManager } from '../../src/core/staging-area.js';
import { Model } from '../../src/core/model.js';
import path from 'path';
import { rm } from 'fs/promises';
import { fileExists, ensureDir } from '../../src/utils/file-io.js';

describe('StagingAreaManager', () => {
  let testDir: string;
  let manager: StagingAreaManager;
  let model: Model;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original working directory
    originalCwd = process.cwd();

    // Create temporary test directory
    testDir = path.join('/tmp', `test-staging-${Date.now()}-${Math.random()}`);
    await ensureDir(testDir);

    // Initialize basic model structure with required files
    const modelDir = path.join(testDir, 'documentation-robotics', 'model');
    await ensureDir(modelDir);

    // Create manifest file in YAML format (Model.load expects YAML)
    const { writeFile } = await import('../../src/utils/file-io.js');
    const manifestPath = path.join(modelDir, 'manifest.yaml');
    const manifest = `version: 0.1.0
specVersion: 0.7.1
created: ${new Date().toISOString()}
modified: ${new Date().toISOString()}
layers: {}`;
    await writeFile(manifestPath, manifest);

    // Load model for snapshot capture
    process.chdir(testDir);
    model = await Model.load();
    manager = new StagingAreaManager(testDir, model);
  });

  afterEach(async () => {
    // Restore original working directory
    process.chdir(originalCwd);

    // Clean up test directory
    if (await fileExists(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('Changeset lifecycle', () => {
    it('should create a new changeset', async () => {
      const changeset = await manager.create('test-changeset', 'Test description');

      expect(changeset).toBeDefined();
      expect(changeset.name).toBe('test-changeset');
      expect(changeset.description).toBe('Test description');
      expect(changeset.status).toBe('draft');
      expect(changeset.changes.length).toBe(0);
      expect(changeset.id).toBeDefined();
    });

    it('should load an existing changeset by name', async () => {
      const created = await manager.create('load-test', 'Load test');
      const loaded = await manager.load('load-test');

      expect(loaded).toBeDefined();
      expect(loaded?.name).toBe('load-test');
      expect(loaded?.id).toBe(created.id);
    });

    it('should load a changeset by ID', async () => {
      const created = await manager.create('by-id-test');
      const loaded = await manager.load(created.id!);

      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe(created.id);
    });

    it('should list all changesets', async () => {
      await manager.create('list-test-1');
      await manager.create('list-test-2');
      await manager.create('list-test-3');

      const changesets = await manager.list();
      expect(changesets.length).toBeGreaterThanOrEqual(3);
      expect(changesets.some((cs) => cs.name === 'list-test-1')).toBe(true);
      expect(changesets.some((cs) => cs.name === 'list-test-2')).toBe(true);
      expect(changesets.some((cs) => cs.name === 'list-test-3')).toBe(true);
    });

    it('should delete a changeset', async () => {
      const created = await manager.create('delete-test');
      await manager.delete('delete-test');

      const loaded = await manager.load('delete-test');
      expect(loaded).toBeNull();
    });

    it('should return null for non-existent changeset', async () => {
      const loaded = await manager.load('nonexistent');
      expect(loaded).toBeNull();
    });
  });

  describe('Staging operations', () => {
    it('should stage an add change', async () => {
      const changeset = await manager.create('stage-add-test');
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'test-element-1',
        layerName: 'application',
        after: { id: 'test-element-1', type: 'component', name: 'Test Component' },
      });

      const loaded = await manager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(1);
      expect(loaded?.changes[0].type).toBe('add');
      expect(loaded?.changes[0].elementId).toBe('test-element-1');
      expect((loaded?.changes[0] as any).sequenceNumber).toBe(0);
    });

    it('should stage multiple changes with sequence numbers', async () => {
      const changeset = await manager.create('stage-multiple-test');
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'elem-1',
        layerName: 'application',
        after: { id: 'elem-1' },
      });

      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'elem-2',
        layerName: 'application',
        after: { id: 'elem-2' },
      });

      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'elem-3',
        layerName: 'data-model',
        after: { id: 'elem-3' },
      });

      const loaded = await manager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(3);
      expect((loaded?.changes[0] as any).sequenceNumber).toBe(0);
      expect((loaded?.changes[1] as any).sequenceNumber).toBe(1);
      expect((loaded?.changes[2] as any).sequenceNumber).toBe(2);
    });

    it('should unstage a specific element', async () => {
      const changeset = await manager.create('unstage-test');
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'elem-1',
        layerName: 'application',
        after: { id: 'elem-1' },
      });

      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'elem-2',
        layerName: 'application',
        after: { id: 'elem-2' },
      });

      await manager.unstage(changeset.id!, 'elem-1');

      const loaded = await manager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(1);
      expect(loaded?.changes[0].elementId).toBe('elem-2');
      expect((loaded?.changes[0] as any).sequenceNumber).toBe(0);
    });

    it('should discard all changes', async () => {
      const changeset = await manager.create('discard-test');
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'elem-1',
        layerName: 'application',
        after: { id: 'elem-1' },
      });

      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'elem-2',
        layerName: 'application',
        after: { id: 'elem-2' },
      });

      await manager.discard(changeset.id!);

      const loaded = await manager.load(changeset.id!);
      expect(loaded?.changes.length).toBe(0);
      expect(loaded?.status).toBe('discarded');
      expect(loaded?.stats?.additions).toBe(0);
    });

    it('should prevent staging when changeset status is not staged', async () => {
      const changeset = await manager.create('status-test');

      // Mark as discarded
      await manager.discard(changeset.id!);

      // Try to stage - should fail
      let error: Error | null = null;
      try {
        await manager.stage(changeset.id!, {
          type: 'add',
          elementId: 'elem-1',
          layerName: 'application',
          after: { id: 'elem-1' },
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain('status');
    });
  });

  describe('Active changeset tracking', () => {
    it('should set and get active changeset', async () => {
      const changeset = await manager.create('active-test');

      await manager.setActive(changeset.id!);
      const active = await manager.getActive();

      expect(active).toBeDefined();
      expect(active?.id).toBe(changeset.id);
      expect(active?.name).toBe('active-test');
    });

    it('should clear active changeset', async () => {
      const changeset = await manager.create('clear-active-test');

      await manager.setActive(changeset.id!);
      await manager.clearActive();

      const active = await manager.getActive();
      expect(active).toBeNull();
    });

    it('should check if changeset is active', async () => {
      const changeset = await manager.create('check-active-test');

      await manager.setActive(changeset.id!);
      const isActive = await manager.isActive(changeset.id!);

      expect(isActive).toBe(true);
    });

    it('should return false for non-active changeset', async () => {
      const changeset = await manager.create('non-active-test');

      const isActive = await manager.isActive(changeset.id!);
      expect(isActive).toBe(false);
    });
  });

  describe('Statistics tracking', () => {
    it('should update stats when adding changes', async () => {
      const changeset = await manager.create('stats-test');
      await manager.setActive(changeset.id!);

      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'elem-add-1',
        layerName: 'application',
        after: { id: 'elem-add-1' },
      });

      await manager.stage(changeset.id!, {
        type: 'add',
        elementId: 'elem-add-2',
        layerName: 'application',
        after: { id: 'elem-add-2' },
      });

      await manager.stage(changeset.id!, {
        type: 'update',
        elementId: 'elem-update-1',
        layerName: 'application',
        before: { id: 'elem-update-1' },
        after: { id: 'elem-update-1', updated: true },
      });

      await manager.stage(changeset.id!, {
        type: 'delete',
        elementId: 'elem-delete-1',
        layerName: 'application',
        before: { id: 'elem-delete-1' },
      });

      const loaded = await manager.load(changeset.id!);
      expect(loaded?.stats?.additions).toBe(2);
      expect(loaded?.stats?.modifications).toBe(1);
      expect(loaded?.stats?.deletions).toBe(1);
    });
  });

  describe('Error handling', () => {
    it('should throw error when staging non-existent changeset', async () => {
      let error: Error | null = null;
      try {
        await manager.stage('nonexistent-id', {
          type: 'add',
          elementId: 'elem',
          layerName: 'application',
          after: { id: 'elem' },
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain('not found');
    });

    it('should throw error when unstaging from non-existent changeset', async () => {
      let error: Error | null = null;
      try {
        await manager.unstage('nonexistent-id', 'elem');
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain('not found');
    });

    it('should throw error when deleting non-existent changeset', async () => {
      let error: Error | null = null;
      try {
        await manager.delete('nonexistent');
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain('not found');
    });
  });
});
