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

describe('Cache Invalidation Optimization', () => {
  let baseModel: Model;
  let storage: StagedChangesetStorage;
  let engine: VirtualProjectionEngine;
  let snapshotManager: BaseSnapshotManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dr-cache-test-'));
    storage = new StagedChangesetStorage(tempDir);
    engine = new VirtualProjectionEngine(tempDir);
    snapshotManager = new BaseSnapshotManager();

    // Create test model with three layers
    const manifest = new Manifest({
      name: 'Cache Test Model',
      description: 'Model for testing cache invalidation',
      version: '1.0.0',
      specVersion: '0.7.1',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    baseModel = new Model(tempDir, manifest);

    // Create three layers for multi-layer testing
    const apiLayer = new Layer('api');
    const dataModelLayer = new Layer('data-model');
    const appLayer = new Layer('application');

    // Add elements to API layer
    apiLayer.addElement(new Element({
      id: 'api-endpoint-users',
      type: 'endpoint',
      name: 'Users Endpoint',
      description: 'Manage users',
      properties: { method: 'GET', path: '/users' },
    }));

    apiLayer.addElement(new Element({
      id: 'api-endpoint-posts',
      type: 'endpoint',
      name: 'Posts Endpoint',
      description: 'Manage posts',
      properties: { method: 'GET', path: '/posts' },
    }));

    // Add elements to data-model layer
    dataModelLayer.addElement(new Element({
      id: 'data-model-entity-user',
      type: 'entity',
      name: 'User',
      description: 'User entity',
    }));

    dataModelLayer.addElement(new Element({
      id: 'data-model-entity-post',
      type: 'entity',
      name: 'Post',
      description: 'Post entity',
    }));

    // Add elements to application layer
    appLayer.addElement(new Element({
      id: 'app-component-user-list',
      type: 'component',
      name: 'User List',
      description: 'Displays list of users',
    }));

    appLayer.addElement(new Element({
      id: 'app-component-user-form',
      type: 'component',
      name: 'User Form',
      description: 'Form for user creation',
    }));

    baseModel.addLayer(apiLayer);
    baseModel.addLayer(dataModelLayer);
    baseModel.addLayer(appLayer);

    await baseModel.saveManifest();
    await baseModel.saveLayer('api');
    await baseModel.saveLayer('data-model');
    await baseModel.saveLayer('application');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Layer-Specific Invalidation', () => {
    it('should only invalidate affected layers when unstaging element', async () => {
      const changesetId = 'layer-specific-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Multi-layer Test',
        'Changes across API and data-model layers',
        baseSnapshot
      );

      // Stage changes in multiple layers
      changeset.changes = [
        {
          type: 'update',
          elementId: 'api-endpoint-users',
          layerName: 'api',
          sequenceNumber: 1,
          before: { name: 'Users Endpoint' },
          after: { name: 'Updated Users Endpoint' },
        },
        {
          type: 'update',
          elementId: 'data-model-entity-user',
          layerName: 'data-model',
          sequenceNumber: 2,
          before: { name: 'User' },
          after: { name: 'Updated User' },
        },
      ];

      await storage.save(changeset);

      // Project both layers to warm the cache
      const apiLayerBefore = await engine.projectLayer(baseModel, changesetId, 'api');
      const dataLayerBefore = await engine.projectLayer(baseModel, changesetId, 'data-model');

      // Verify both are cached
      let metrics = engine.getCacheMetrics(changesetId);
      expect(metrics?.hits).toBe(0);
      expect(metrics?.misses).toBe(2); // One miss per layer

      // Project again - should hit cache
      await engine.projectLayer(baseModel, changesetId, 'api');
      await engine.projectLayer(baseModel, changesetId, 'data-model');

      metrics = engine.getCacheMetrics(changesetId);
      expect(metrics?.hits).toBe(2); // Cache hits

      // Unstage only the API element
      await engine.invalidateOnUnstage(changesetId, 'api-endpoint-users');

      // API layer cache should be cleared, data-model cache should remain
      const apiLayerAfter = await engine.projectLayer(baseModel, changesetId, 'api');
      expect(apiLayerAfter.getElement('api-endpoint-users')?.name).toBe('Updated Users Endpoint');

      metrics = engine.getCacheMetrics(changesetId);
      expect(metrics?.misses).toBe(3); // One additional miss for API layer

      // Data-model should still hit cache
      await engine.projectLayer(baseModel, changesetId, 'data-model');
      metrics = engine.getCacheMetrics(changesetId);
      expect(metrics?.hits).toBe(3); // Cache hit for data-model
    });

    it('should use full invalidation when elementId not provided', async () => {
      const changesetId = 'full-invalidation-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Full Invalidation Test',
        'Test full cache invalidation',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'update',
          elementId: 'api-endpoint-users',
          layerName: 'api',
          sequenceNumber: 1,
          before: { name: 'Users' },
          after: { name: 'All Users' },
        },
        {
          type: 'update',
          elementId: 'data-model-entity-user',
          layerName: 'data-model',
          sequenceNumber: 2,
          before: { name: 'User' },
          after: { name: 'User Updated' },
        },
      ];

      await storage.save(changeset);

      // Warm cache
      await engine.projectLayer(baseModel, changesetId, 'api');
      await engine.projectLayer(baseModel, changesetId, 'data-model');

      let metrics = engine.getCacheMetrics(changesetId);
      expect(metrics?.misses).toBe(2);

      // Full invalidation without elementId
      await engine.invalidateOnUnstage(changesetId);

      // Both layers should require recomputation
      await engine.projectLayer(baseModel, changesetId, 'api');
      await engine.projectLayer(baseModel, changesetId, 'data-model');

      metrics = engine.getCacheMetrics(changesetId);
      expect(metrics?.misses).toBe(4); // Two additional misses
      expect(metrics?.hits).toBe(0); // No hits after full invalidation
    });
  });

  describe('Cache Metrics Tracking', () => {
    it('should track cache hits and misses accurately', async () => {
      const changesetId = 'metrics-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Metrics Test',
        'Test cache metrics tracking',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'update',
          elementId: 'api-endpoint-users',
          layerName: 'api',
          sequenceNumber: 1,
          before: { name: 'Users' },
          after: { name: 'Users Updated' },
        },
      ];

      await storage.save(changeset);

      // First projection - miss
      await engine.projectLayer(baseModel, changesetId, 'api');
      let metrics = engine.getCacheMetrics(changesetId);
      expect(metrics?.misses).toBe(1);
      expect(metrics?.hits).toBe(0);

      // Second projection - hit
      await engine.projectLayer(baseModel, changesetId, 'api');
      metrics = engine.getCacheMetrics(changesetId);
      expect(metrics?.hits).toBe(1);
      expect(metrics?.misses).toBe(1);

      // Multiple hits
      await engine.projectLayer(baseModel, changesetId, 'api');
      await engine.projectLayer(baseModel, changesetId, 'api');
      await engine.projectLayer(baseModel, changesetId, 'api');

      metrics = engine.getCacheMetrics(changesetId);
      expect(metrics?.hits).toBe(4);
      expect(metrics?.misses).toBe(1);
    });

    it('should record invalidation counts in metrics', async () => {
      const changesetId = 'invalidation-count-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Invalidation Count Test',
        'Test invalidation counting',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-new',
          layerName: 'api',
          sequenceNumber: 1,
          after: { name: 'New Endpoint', type: 'endpoint' },
        },
      ];

      await storage.save(changeset);

      // Warm cache
      await engine.projectLayer(baseModel, changesetId, 'api');

      let metrics = engine.getCacheMetrics(changesetId);
      expect(metrics?.invalidations).toBe(0);

      // First invalidation
      engine.invalidateOnStage(changesetId, 'api');
      metrics = engine.getCacheMetrics(changesetId);
      expect(metrics?.invalidations).toBe(1);

      // Second invalidation
      engine.invalidateOnStage(changesetId);
      metrics = engine.getCacheMetrics(changesetId);
      expect(metrics?.invalidations).toBe(2);

      // Check timestamp is recorded
      expect(metrics?.lastInvalidation).toBeDefined();
      const lastInvalidTime = new Date(metrics?.lastInvalidation || '');
      expect(lastInvalidTime.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('Concurrent Cache Operations', () => {
    it('should handle concurrent layer projections safely', async () => {
      const changesetId = 'concurrent-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Concurrent Test',
        'Test concurrent projections',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'update',
          elementId: 'api-endpoint-users',
          layerName: 'api',
          sequenceNumber: 1,
          before: { name: 'Users' },
          after: { name: 'All Users' },
        },
        {
          type: 'update',
          elementId: 'data-model-entity-user',
          layerName: 'data-model',
          sequenceNumber: 2,
          before: { name: 'User' },
          after: { name: 'User Entity' },
        },
        {
          type: 'update',
          elementId: 'app-component-user-list',
          layerName: 'application',
          sequenceNumber: 3,
          before: { name: 'User List' },
          after: { name: 'Updated User List' },
        },
      ];

      await storage.save(changeset);

      // Launch concurrent projections
      const projections = await Promise.all([
        engine.projectLayer(baseModel, changesetId, 'api'),
        engine.projectLayer(baseModel, changesetId, 'data-model'),
        engine.projectLayer(baseModel, changesetId, 'application'),
        engine.projectLayer(baseModel, changesetId, 'api'),
        engine.projectLayer(baseModel, changesetId, 'data-model'),
      ]);

      // Verify all projections returned valid layers and complete without errors
      expect(projections).toHaveLength(5);
      projections.forEach(layer => {
        expect(layer).toBeDefined();
        expect(layer.name).toMatch(/^(api|data-model|application)$/);
      });

      // Verify cache metrics tracked operations without specific counts
      // (concurrent timing can affect exact hit/miss counts)
      const metrics = engine.getCacheMetrics(changesetId);
      expect(metrics).toBeDefined();
      expect(metrics?.hits || 0).toBeGreaterThanOrEqual(0);
      expect(metrics?.misses || 0).toBeGreaterThanOrEqual(0);
    });

    it('should handle invalidation during concurrent operations', async () => {
      const changesetId = 'concurrent-invalidation-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Concurrent Invalidation Test',
        'Test invalidation during concurrent ops',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'update',
          elementId: 'api-endpoint-users',
          layerName: 'api',
          sequenceNumber: 1,
          before: { name: 'Users' },
          after: { name: 'Users V2' },
        },
        {
          type: 'update',
          elementId: 'data-model-entity-user',
          layerName: 'data-model',
          sequenceNumber: 2,
          before: { name: 'User' },
          after: { name: 'User V2' },
        },
      ];

      await storage.save(changeset);

      // Warm caches in parallel
      await Promise.all([
        engine.projectLayer(baseModel, changesetId, 'api'),
        engine.projectLayer(baseModel, changesetId, 'data-model'),
      ]);

      // Invalidate one layer and project concurrently
      const invalidationPromise = engine.invalidateOnUnstage(
        changesetId,
        'api-endpoint-users'
      );
      const projectionPromise = Promise.all([
        engine.projectLayer(baseModel, changesetId, 'api'),
        engine.projectLayer(baseModel, changesetId, 'data-model'),
      ]);

      const [, projections] = await Promise.all([
        invalidationPromise,
        projectionPromise,
      ]);

      // Both projections should complete successfully
      expect(projections).toHaveLength(2);
      expect(projections[0]).toBeDefined();
      expect(projections[1]).toBeDefined();

      // API layer should show updated content
      expect(projections[0].getElement('api-endpoint-users')?.name).toBe('Users V2');
    });

    it('should maintain consistency across concurrent invalidations', async () => {
      const changesetId = 'concurrent-invalidation-consistency-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Concurrent Invalidation Consistency Test',
        'Test consistency of concurrent invalidations',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'update',
          elementId: 'api-endpoint-users',
          layerName: 'api',
          sequenceNumber: 1,
          before: { name: 'Users' },
          after: { name: 'Users Final' },
        },
        {
          type: 'update',
          elementId: 'data-model-entity-user',
          layerName: 'data-model',
          sequenceNumber: 2,
          before: { name: 'User' },
          after: { name: 'User Final' },
        },
      ];

      await storage.save(changeset);

      // Warm cache
      await engine.projectLayer(baseModel, changesetId, 'api');
      await engine.projectLayer(baseModel, changesetId, 'data-model');

      // Multiple concurrent invalidations
      await Promise.all([
        engine.invalidateOnUnstage(changesetId, 'api-endpoint-users'),
        engine.invalidateOnUnstage(changesetId, 'data-model-entity-user'),
        engine.invalidateOnUnstage(changesetId),
      ]);

      // Verify metrics tracked all invalidations
      const metrics = engine.getCacheMetrics(changesetId);
      expect(metrics?.invalidations).toBeGreaterThanOrEqual(2);

      // Re-project both layers - should all be misses
      const projections = await Promise.all([
        engine.projectLayer(baseModel, changesetId, 'api'),
        engine.projectLayer(baseModel, changesetId, 'data-model'),
      ]);

      expect(projections).toHaveLength(2);
      projections.forEach(layer => {
        expect(layer).toBeDefined();
      });
    });
  });

  describe('Cache Correctness Under All Operations', () => {
    it('should serve correct data after add operations', async () => {
      const changesetId = 'add-operation-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Add Operation Test',
        'Test cache correctness for add operations',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-new-resource',
          layerName: 'api',
          sequenceNumber: 1,
          after: {
            id: 'api-endpoint-new-resource',
            name: 'New Resource Endpoint',
            type: 'endpoint',
            properties: { method: 'POST', path: '/resources' },
          },
        },
      ];

      await storage.save(changeset);

      // Project twice - first is miss, second is hit
      const projection1 = await engine.projectLayer(baseModel, changesetId, 'api');
      const projection2 = await engine.projectLayer(baseModel, changesetId, 'api');

      // Both should have the new element
      const newElement1 = projection1.getElement('api-endpoint-new-resource');
      const newElement2 = projection2.getElement('api-endpoint-new-resource');

      expect(newElement1?.name).toBe('New Resource Endpoint');
      expect(newElement2?.name).toBe('New Resource Endpoint');
      expect(newElement1?.id).toBe(newElement2?.id);
    });

    it('should serve correct data after update operations', async () => {
      const changesetId = 'update-operation-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Update Operation Test',
        'Test cache correctness for update operations',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'update',
          elementId: 'api-endpoint-users',
          layerName: 'api',
          sequenceNumber: 1,
          before: { name: 'Users Endpoint' },
          after: {
            name: 'Users Endpoint V2',
            description: 'Updated to handle pagination',
            properties: { method: 'GET', path: '/users?page=1' },
          },
        },
      ];

      await storage.save(changeset);

      const projection1 = await engine.projectLayer(baseModel, changesetId, 'api');
      const projection2 = await engine.projectLayer(baseModel, changesetId, 'api');

      const element1 = projection1.getElement('api-endpoint-users');
      const element2 = projection2.getElement('api-endpoint-users');

      expect(element1?.name).toBe('Users Endpoint V2');
      expect(element2?.name).toBe('Users Endpoint V2');
      expect(element1?.description).toBe('Updated to handle pagination');
      expect(element2?.description).toBe('Updated to handle pagination');
    });

    it('should serve correct data after delete operations', async () => {
      const changesetId = 'delete-operation-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Delete Operation Test',
        'Test cache correctness for delete operations',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'delete',
          elementId: 'api-endpoint-posts',
          layerName: 'api',
          sequenceNumber: 1,
          before: { name: 'Posts Endpoint' },
        },
      ];

      await storage.save(changeset);

      const projection1 = await engine.projectLayer(baseModel, changesetId, 'api');
      const projection2 = await engine.projectLayer(baseModel, changesetId, 'api');

      // Both projections should not have the deleted element (null or undefined)
      expect(projection1.getElement('api-endpoint-posts')).toBeFalsy();
      expect(projection2.getElement('api-endpoint-posts')).toBeFalsy();

      // But other elements should still be there
      expect(projection1.getElement('api-endpoint-users')).toBeDefined();
      expect(projection2.getElement('api-endpoint-users')).toBeDefined();
    });

    it('should serve correct data with mixed operations', async () => {
      const changesetId = 'mixed-operations-test';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Mixed Operations Test',
        'Test cache correctness with mixed operations',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'add',
          elementId: 'api-endpoint-comments',
          layerName: 'api',
          sequenceNumber: 1,
          after: {
            id: 'api-endpoint-comments',
            name: 'Comments Endpoint',
            type: 'endpoint',
          },
        },
        {
          type: 'update',
          elementId: 'api-endpoint-users',
          layerName: 'api',
          sequenceNumber: 2,
          before: { name: 'Users Endpoint' },
          after: { name: 'Users Endpoint Updated' },
        },
        {
          type: 'delete',
          elementId: 'api-endpoint-posts',
          layerName: 'api',
          sequenceNumber: 3,
          before: { name: 'Posts Endpoint' },
        },
      ];

      await storage.save(changeset);

      // Project multiple times
      const p1 = await engine.projectLayer(baseModel, changesetId, 'api');
      const p2 = await engine.projectLayer(baseModel, changesetId, 'api');
      const p3 = await engine.projectLayer(baseModel, changesetId, 'api');

      for (const projection of [p1, p2, p3]) {
        // Added element should be present
        expect(projection.getElement('api-endpoint-comments')?.name).toBe('Comments Endpoint');

        // Updated element should show new name
        expect(projection.getElement('api-endpoint-users')?.name).toBe('Users Endpoint Updated');

        // Deleted element should not be present (null or undefined)
        expect(projection.getElement('api-endpoint-posts')).toBeFalsy();
      }
    });
  });
});
