import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Changeset } from '../../../src/core/changeset.js';
import { StagedChangesetStorage } from '../../../src/core/staged-changeset-storage.js';
import { BaseSnapshotManager } from '../../../src/core/base-snapshot-manager.js';
import { Model } from '../../../src/core/model.js';
import { Manifest } from '../../../src/core/manifest.js';
import { Layer } from '../../../src/core/layer.js';
import { Element } from '../../../src/core/element.js';
import { rm, mkdir } from 'fs/promises';

const TEST_DIR = '/tmp/staged-changeset-test';

describe('Staged Changeset Data Model', () => {
  describe('Changeset with extended fields', () => {
    it('should create changeset with staging fields', () => {
      const changeset = Changeset.create('test-changeset', 'Test description');

      // Basic fields
      expect(changeset.name).toBe('test-changeset');
      expect(changeset.status).toBe('draft');

      // Add extended fields manually
      changeset.id = 'test-changeset-001';
      changeset.baseSnapshot = 'sha256:abc123';
      changeset.stats = { additions: 0, modifications: 0, deletions: 0 };

      expect(changeset.id).toBe('test-changeset-001');
      expect(changeset.baseSnapshot).toBe('sha256:abc123');
      expect(changeset.stats).toEqual({ additions: 0, modifications: 0, deletions: 0 });
    });

    it('should update stats from changes', () => {
      const changeset = Changeset.create('test');
      changeset.id = 'test-001';
      changeset.baseSnapshot = 'sha256:abc';

      changeset.addChange('add', 'elem-1', 'api', undefined, { name: 'New' });
      changeset.addChange('add', 'elem-2', 'api', undefined, { name: 'Another' });
      changeset.addChange('update', 'elem-3', 'application', {}, {});
      changeset.addChange('delete', 'elem-4', 'technology', {}, undefined);

      changeset.updateStats();

      expect(changeset.stats?.additions).toBe(2);
      expect(changeset.stats?.modifications).toBe(1);
      expect(changeset.stats?.deletions).toBe(1);
    });

    it('should support new status values', () => {
      const changeset = Changeset.create('test');

      changeset.markStaged();
      expect(changeset.status).toBe('staged');

      changeset.markCommitted();
      expect(changeset.status).toBe('committed');

      changeset.markDiscarded();
      expect(changeset.status).toBe('discarded');
    });

    it('should serialize and deserialize with extended fields', () => {
      const original = Changeset.create('test', 'description');
      original.id = 'test-001';
      original.baseSnapshot = 'sha256:abc123';
      original.status = 'staged';
      original.addChange('add', 'elem-1', 'api', undefined, { name: 'Test' });
      original.updateStats();

      const json = original.toJSON();
      const restored = Changeset.fromJSON(json);

      expect(restored.id).toBe('test-001');
      expect(restored.baseSnapshot).toBe('sha256:abc123');
      expect(restored.status).toBe('staged');
      expect(restored.stats?.additions).toBe(1);
      expect(restored.changes).toHaveLength(1);
    });
  });
});

describe('BaseSnapshotManager', () => {
  let testModel: Model;

  beforeAll(async () => {
    // Create test directory
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore
    }
    await mkdir(TEST_DIR, { recursive: true });

    // Create a test model
    const manifest = new Manifest({
      name: 'Test Model',
      version: '1.0.0',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    testModel = new Model(TEST_DIR, manifest);

    // Add some test layers
    const apiLayer = new Layer('api');
    apiLayer.addElement(
      new Element({
        id: 'api-endpoint-test',
        type: 'endpoint',
        name: 'Test Endpoint',
        properties: { method: 'GET', path: '/test' },
      })
    );
    testModel.layers.set('api', apiLayer);

    const appLayer = new Layer('application');
    appLayer.addElement(
      new Element({
        id: 'app-component-test',
        type: 'component',
        name: 'Test Component',
        properties: {},
      })
    );
    testModel.layers.set('application', appLayer);
  });

  afterAll(async () => {
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore
    }
  });

  it('should capture snapshot hash', async () => {
    const manager = new BaseSnapshotManager();
    const snapshot = await manager.captureSnapshot(testModel);

    expect(snapshot).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('should produce consistent snapshot hash', async () => {
    const manager = new BaseSnapshotManager();
    const snapshot1 = await manager.captureSnapshot(testModel);
    const snapshot2 = await manager.captureSnapshot(testModel);

    expect(snapshot1).toBe(snapshot2);
  });

  it('should detect no drift for identical models', async () => {
    const manager = new BaseSnapshotManager();
    const snapshot = await manager.captureSnapshot(testModel);

    const report = await manager.detectDrift(snapshot, testModel);

    expect(report.hasDrift).toBe(false);
    expect(report.baseSnapshotHash).toBe(snapshot);
    expect(report.currentModelHash).toBe(snapshot);
  });

  it('should detect drift after model changes', async () => {
    const manager = new BaseSnapshotManager();
    const originalSnapshot = await manager.captureSnapshot(testModel);

    // Modify model by adding new element
    const apiLayer = testModel.layers.get('api');
    if (apiLayer) {
      apiLayer.addElement(
        new Element({
          id: 'api-endpoint-new',
          type: 'endpoint',
          name: 'New Endpoint',
          properties: { method: 'POST', path: '/new' },
        })
      );
    }

    const report = await manager.detectDrift(originalSnapshot, testModel);

    expect(report.hasDrift).toBe(true);
    expect(report.baseSnapshotHash).toBe(originalSnapshot);
    expect(report.currentModelHash).not.toBe(originalSnapshot);
  });

  it('should compare snapshots', async () => {
    const manager = new BaseSnapshotManager();
    const snapshot1 = 'sha256:abc123';
    const snapshot2 = 'sha256:def456';

    const identical = await manager.compareSnapshots(snapshot1, snapshot1);
    expect(identical.identical).toBe(true);
    expect(identical.difference).toBeNull();

    const different = await manager.compareSnapshots(snapshot1, snapshot2);
    expect(different.identical).toBe(false);
    expect(different.difference).toBeDefined();
  });
});

describe('StagedChangesetStorage', () => {
  beforeAll(async () => {
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore
    }
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore
    }
  });

  it('should create changeset with YAML files', async () => {
    const storage = new StagedChangesetStorage(TEST_DIR);
    const changeset = await storage.create(
      'test-001',
      'Test Changeset',
      'Test description',
      'sha256:abc123'
    );

    expect(changeset.id).toBe('test-001');
    expect(changeset.name).toBe('Test Changeset');
    expect(changeset.baseSnapshot).toBe('sha256:abc123');
    expect(changeset.status).toBe('draft');
  });

  it('should load changeset from YAML files', async () => {
    const storage = new StagedChangesetStorage(TEST_DIR);
    await storage.create('load-test', 'Load Test', 'Test', 'sha256:def456');

    const loaded = await storage.load('load-test');

    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Load Test');
    expect(loaded?.baseSnapshot).toBe('sha256:def456');
  });

  it('should return null for non-existent changeset', async () => {
    const storage = new StagedChangesetStorage(TEST_DIR);
    const loaded = await storage.load('non-existent');

    expect(loaded).toBeNull();
  });

  it('should save changeset with updates', async () => {
    const storage = new StagedChangesetStorage(TEST_DIR);
    let changeset = await storage.create('save-test', 'Save Test', 'Test', 'sha256:xyz789');

    // Add changes
    changeset.addChange('add', 'elem-1', 'api', undefined, { name: 'New' });
    changeset.addChange('update', 'elem-2', 'application', {}, {});
    changeset.updateStats();

    // Save
    await storage.save(changeset);

    // Reload and verify
    const loaded = await storage.load('save-test');
    expect(loaded?.changes).toHaveLength(2);
    expect(loaded?.stats?.additions).toBe(1);
    expect(loaded?.stats?.modifications).toBe(1);
  });

  it('should list all changesets', async () => {
    const storage = new StagedChangesetStorage(TEST_DIR);

    // Clean up first
    try {
      const existing = await storage.list();
      for (const cs of existing) {
        if (cs.id) await storage.delete(cs.id);
      }
    } catch {
      // Ignore
    }

    // Create test changesets
    await storage.create('cs-1', 'Changeset 1', '', 'sha256:aaa');
    await storage.create('cs-2', 'Changeset 2', '', 'sha256:bbb');

    const list = await storage.list();

    expect(list.length).toBeGreaterThanOrEqual(2);
    const ids = list.map((c) => c.id);
    expect(ids).toContain('cs-1');
    expect(ids).toContain('cs-2');
  });

  it('should delete changeset', async () => {
    const storage = new StagedChangesetStorage(TEST_DIR);

    // Create and delete
    await storage.create('to-delete', 'To Delete', '', 'sha256:zzz');
    let loaded = await storage.load('to-delete');
    expect(loaded).not.toBeNull();

    await storage.delete('to-delete');
    loaded = await storage.load('to-delete');
    expect(loaded).toBeNull();
  });

  it('should throw error when deleting non-existent changeset', async () => {
    const storage = new StagedChangesetStorage(TEST_DIR);

    try {
      await storage.delete('non-existent');
      expect(true).toBe(false); // Should not reach
    } catch (error) {
      expect(error instanceof Error).toBe(true);
    }
  });

  it('should add change to changeset', async () => {
    const storage = new StagedChangesetStorage(TEST_DIR);
    await storage.create('change-test', 'Change Test', '', 'sha256:aaa');

    await storage.addChange('change-test', {
      type: 'add',
      elementId: 'elem-1',
      layerName: 'api',
      timestamp: new Date().toISOString(),
      sequenceNumber: 0,
      after: { name: 'New Element' },
    });

    const loaded = await storage.load('change-test');
    expect(loaded?.changes).toHaveLength(1);
    expect(loaded?.changes[0].elementId).toBe('elem-1');
  });

  it('should remove change from changeset', async () => {
    const storage = new StagedChangesetStorage(TEST_DIR);
    await storage.create('remove-test', 'Remove Test', '', 'sha256:aaa');

    // Add multiple changes
    await storage.addChange('remove-test', {
      type: 'add',
      elementId: 'elem-1',
      layerName: 'api',
      timestamp: new Date().toISOString(),
      sequenceNumber: 0,
      after: { name: 'Elem 1' },
    });

    await storage.addChange('remove-test', {
      type: 'add',
      elementId: 'elem-2',
      layerName: 'api',
      timestamp: new Date().toISOString(),
      sequenceNumber: 1,
      after: { name: 'Elem 2' },
    });

    // Remove one
    await storage.removeChange('remove-test', 'elem-1');

    const loaded = await storage.load('remove-test');
    expect(loaded?.changes).toHaveLength(1);
    expect(loaded?.changes[0].elementId).toBe('elem-2');
  });
});
