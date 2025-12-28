import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Changeset, ChangesetManager } from '../../src/core/changeset.js';
import { readdir, rm } from 'fs/promises';
import { fileExists } from '../../src/utils/file-io.js';

const TEST_DIR = '/tmp/changeset-test';

describe('Changeset', () => {
  describe('create', () => {
    it('should create a new changeset', () => {
      const changeset = Changeset.create('test-changeset', 'Test description');

      expect(changeset.name).toBe('test-changeset');
      expect(changeset.description).toBe('Test description');
      expect(changeset.status).toBe('draft');
      expect(changeset.changes).toHaveLength(0);
      expect(changeset.created).toBeDefined();
      expect(changeset.modified).toBeDefined();
    });
  });

  describe('addChange', () => {
    it('should add a change to the changeset', () => {
      const changeset = Changeset.create('test');
      changeset.addChange('add', 'elem-1', 'motivation', undefined, {
        name: 'New Element',
      });

      expect(changeset.changes).toHaveLength(1);
      expect(changeset.changes[0].type).toBe('add');
      expect(changeset.changes[0].elementId).toBe('elem-1');
    });

    it('should update modified timestamp on change', () => {
      const changeset = Changeset.create('test');
      const beforeModified = changeset.modified;

      // Wait a bit to ensure timestamp changes
      Bun.sleepSync(10);

      changeset.addChange('add', 'elem-1', 'motivation', undefined, {});

      expect(changeset.modified).not.toBe(beforeModified);
    });
  });

  describe('getChangeCount', () => {
    it('should return correct count of changes', () => {
      const changeset = Changeset.create('test');
      expect(changeset.getChangeCount()).toBe(0);

      changeset.addChange('add', 'elem-1', 'motivation', undefined, {});
      expect(changeset.getChangeCount()).toBe(1);

      changeset.addChange('update', 'elem-2', 'business', {}, {});
      expect(changeset.getChangeCount()).toBe(2);
    });
  });

  describe('getChangesByType', () => {
    it('should filter changes by type', () => {
      const changeset = Changeset.create('test');
      changeset.addChange('add', 'elem-1', 'motivation', undefined, {});
      changeset.addChange('add', 'elem-2', 'business', undefined, {});
      changeset.addChange('update', 'elem-3', 'application', {}, {});
      changeset.addChange('delete', 'elem-4', 'technology', {}, undefined);

      expect(changeset.getChangesByType('add')).toHaveLength(2);
      expect(changeset.getChangesByType('update')).toHaveLength(1);
      expect(changeset.getChangesByType('delete')).toHaveLength(1);
    });
  });

  describe('markApplied', () => {
    it('should mark changeset as applied', () => {
      const changeset = Changeset.create('test');
      expect(changeset.status).toBe('draft');

      changeset.markApplied();
      expect(changeset.status).toBe('applied');
    });
  });

  describe('markReverted', () => {
    it('should mark changeset as reverted', () => {
      const changeset = Changeset.create('test');
      changeset.markApplied();
      expect(changeset.status).toBe('applied');

      changeset.markReverted();
      expect(changeset.status).toBe('reverted');
    });
  });

  describe('toJSON/fromJSON', () => {
    it('should serialize and deserialize correctly', () => {
      const original = Changeset.create('test', 'description');
      original.addChange('add', 'elem-1', 'motivation', undefined, {
        name: 'Test',
      });

      const json = original.toJSON();
      const restored = Changeset.fromJSON(json);

      expect(restored.name).toBe(original.name);
      expect(restored.description).toBe(original.description);
      expect(restored.status).toBe(original.status);
      expect(restored.changes).toHaveLength(1);
    });
  });
});

describe('ChangesetManager', () => {
  beforeAll(async () => {
    // Create test directory
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Directory may not exist
    }
    await Bun.spawn(['mkdir', '-p', `${TEST_DIR}/.dr`]).exited;
  });

  afterAll(async () => {
    // Clean up
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore errors
    }
  });

  describe('create', () => {
    it('should create and save a changeset', async () => {
      const manager = new ChangesetManager(TEST_DIR);
      const changeset = await manager.create('test-changeset', 'Test');

      expect(changeset.name).toBe('test-changeset');
      expect(changeset.description).toBe('Test');

      // Verify it was saved
      const loaded = await manager.load('test-changeset');
      expect(loaded).not.toBeNull();
      expect(loaded?.name).toBe('test-changeset');
    });
  });

  describe('load', () => {
    it('should return null for non-existent changeset', async () => {
      const manager = new ChangesetManager(TEST_DIR);
      const loaded = await manager.load('non-existent');
      expect(loaded).toBeNull();
    });
  });

  describe('list', () => {
    it('should list all changesets', async () => {
      const manager = new ChangesetManager(TEST_DIR);

      // Clean slate
      try {
        await rm(`${TEST_DIR}/.dr/changesets`, { recursive: true });
      } catch {
        // May not exist
      }

      // Create some changesets
      await manager.create('changeset-1', 'First');
      await manager.create('changeset-2', 'Second');

      const list = await manager.list();
      expect(list).toHaveLength(2);
      expect(list.map((c) => c.name).sort()).toEqual([
        'changeset-1',
        'changeset-2',
      ]);
    });

    it('should return empty list when no changesets exist', async () => {
      const manager = new ChangesetManager('/tmp/non-existent-changeset-dir');
      const list = await manager.list();
      expect(list).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('should delete a changeset', async () => {
      const manager = new ChangesetManager(TEST_DIR);

      // Create a changeset
      await manager.create('to-delete', 'Will be deleted');

      // Verify it exists
      let loaded = await manager.load('to-delete');
      expect(loaded).not.toBeNull();

      // Delete it
      await manager.delete('to-delete');

      // Verify it's gone
      loaded = await manager.load('to-delete');
      expect(loaded).toBeNull();
    });

    it('should throw error when deleting non-existent changeset', async () => {
      const manager = new ChangesetManager(TEST_DIR);

      try {
        await manager.delete('non-existent');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error instanceof Error).toBe(true);
      }
    });
  });
});
