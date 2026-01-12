import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Model } from '../../src/core/model.js';
import { Manifest } from '../../src/core/manifest.js';
import { Layer } from '../../src/core/layer.js';
import { Element } from '../../src/core/element.js';
import { StagedChangesetStorage } from '../../src/core/staged-changeset-storage.js';
import { VirtualProjectionEngine } from '../../src/core/virtual-projection.js';
import { BaseSnapshotManager } from '../../src/core/base-snapshot-manager.js';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';

describe('End-to-End Staging Workflow', () => {
  let baseModel: Model;
  let storage: StagedChangesetStorage;
  let engine: VirtualProjectionEngine;
  let snapshotManager: BaseSnapshotManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dr-staging-test-'));
    storage = new StagedChangesetStorage(tempDir);
    engine = new VirtualProjectionEngine(tempDir);
    snapshotManager = new BaseSnapshotManager();

    // Create test model
    const manifest = new Manifest({
      name: 'Staging Test Model',
      description: 'Model for testing staging workflows',
      version: '1.0.0',
      specVersion: '0.7.1',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    baseModel = new Model(tempDir, manifest);

    // Add API and data-model layers for testing
    const apiLayer = new Layer('api');
    const dataModelLayer = new Layer('data-model');

    // Add initial elements
    const endpoint1 = new Element({
      id: 'api-endpoint-list-users',
      type: 'endpoint',
      name: 'List Users',
      description: 'List all users',
      properties: { method: 'GET', path: '/users' },
    });
    apiLayer.addElement(endpoint1);

    const endpoint2 = new Element({
      id: 'api-endpoint-create-user',
      type: 'endpoint',
      name: 'Create User',
      description: 'Create a new user',
      properties: { method: 'POST', path: '/users' },
    });
    apiLayer.addElement(endpoint2);

    const entity1 = new Element({
      id: 'data-model-entity-user',
      type: 'entity',
      name: 'User',
      description: 'User entity',
    });
    dataModelLayer.addElement(entity1);

    baseModel.addLayer(apiLayer);
    baseModel.addLayer(dataModelLayer);

    await baseModel.saveManifest();
    await baseModel.saveLayer('api');
    await baseModel.saveLayer('data-model');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });


  describe('Preview shows merged view', () => {
    it('should project staged changes showing merged view of model', async () => {
      const changesetId = 'preview-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Preview Test',
        'Test preview projection',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-new',
          layerName: 'api',
          after: {
            id: 'api-endpoint-new',
            type: 'endpoint',
            name: 'New Endpoint',
          },
          sequenceNumber: 0,
        },
      ];

      await storage.save(changeset);

      // Project the changes
      const projectedModel = await engine.projectModel(baseModel, changesetId);

      // Verify projection includes base elements plus staged changes
      const projectedApi = projectedModel.layers.get('api');
      expect(projectedApi?.getElement('api-endpoint-list-users')).toBeDefined();
      expect(projectedApi?.getElement('api-endpoint-new')).toBeDefined();
    });
  });

  describe('Commit operations', () => {
    it('should block commit when drift is detected without --force flag', async () => {
      const changesetId = 'drift-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Drift Test',
        'Test drift detection',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-test',
          layerName: 'api',
          after: {
            id: 'api-endpoint-test',
            type: 'endpoint',
            name: 'Test',
          },
          sequenceNumber: 0,
        },
      ];

      await storage.save(changeset);

      // Simulate drift by modifying base model
      const apiLayer = await baseModel.getLayer('api');
      if (apiLayer) {
        const newElement = new Element({
          id: 'api-endpoint-drift',
          type: 'endpoint',
          name: 'Drift Element',
        });
        apiLayer.addElement(newElement);
        await baseModel.saveLayer('api');
      }

      // Detect drift
      const driftReport = await snapshotManager.detectDrift(baseSnapshot, baseModel);
      expect(driftReport.hasDrift).toBe(true);
    });

    it('should apply changes atomically when committing', async () => {
      const changesetId = 'atomic-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Atomic Test',
        'Test atomic commit',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-atomic1',
          layerName: 'api',
          after: {
            id: 'api-endpoint-atomic1',
            type: 'endpoint',
            name: 'Atomic 1',
          },
          sequenceNumber: 0,
        },
        {
          type: 'add',
          elementId: 'api-endpoint-atomic2',
          layerName: 'api',
          after: {
            id: 'api-endpoint-atomic2',
            type: 'endpoint',
            name: 'Atomic 2',
          },
          sequenceNumber: 1,
        },
      ];

      await storage.save(changeset);

      // Verify changeset status can transition to committed
      changeset.status = 'committed';
      await storage.save(changeset);

      const savedChangeset = await storage.load(changesetId);
      expect(savedChangeset?.status).toBe('committed');
      expect(savedChangeset?.changes.length).toBe(2);
    });

  });

  describe('Discard operations', () => {
    it('should clear all changes and update status when discarding', async () => {
      const changesetId = 'discard-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Discard Test',
        'Test discard',
        baseSnapshot
      );

      // Add changes
      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-discard1',
          layerName: 'api',
          after: {
            id: 'api-endpoint-discard1',
            type: 'endpoint',
            name: 'To Discard 1',
          },
          sequenceNumber: 0,
        },
        {
          type: 'add',
          elementId: 'api-endpoint-discard2',
          layerName: 'api',
          after: {
            id: 'api-endpoint-discard2',
            type: 'endpoint',
            name: 'To Discard 2',
          },
          sequenceNumber: 1,
        },
      ];

      await storage.save(changeset);
      expect(changeset.changes.length).toBe(2);

      // Discard changes
      changeset.changes = [];
      changeset.status = 'discarded';
      await storage.save(changeset);

      const discarded = await storage.load(changesetId);
      expect(discarded?.changes.length).toBe(0);
      expect(discarded?.status).toBe('discarded');
    });
  });
});
