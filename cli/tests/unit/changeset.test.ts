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

