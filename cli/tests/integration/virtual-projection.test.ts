import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VirtualProjectionEngine } from '../../src/core/virtual-projection.js';
import { Model } from '../../src/core/model.js';
import { Manifest } from '../../src/core/manifest.js';
import { Layer } from '../../src/core/layer.js';
import { Element } from '../../src/core/element.js';
import { StagedChangesetStorage } from '../../src/core/staged-changeset-storage.js';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';

describe('VirtualProjectionEngine Integration Tests', () => {
  let engine: VirtualProjectionEngine;
  let storage: StagedChangesetStorage;
  let baseModel: Model;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dr-vp-int-test-'));
    engine = new VirtualProjectionEngine(tempDir);
    storage = new StagedChangesetStorage(tempDir);

    // Create comprehensive test model
    const manifest = new Manifest({
      name: 'Integration Test Model',
      description: 'Complete model for integration testing',
      version: '1.0.0',
      specVersion: '0.7.1',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    baseModel = new Model(tempDir, manifest);

    // Initialize all 12 layers
    const layerNames = [
      'motivation',
      'business',
      'security',
      'application',
      'technology',
      'api',
      'data-model',
      'data-store',
      'ux',
      'navigation',
      'apm',
      'testing',
    ];

    for (const layerName of layerNames) {
      const layer = new Layer(layerName);
      baseModel.addLayer(layer);
    }
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Integration: 10-change scenario', () => {
    it('should apply 10 staged changes and produce correct merged view', async () => {
      const changesetId = 'integration-test-10-changes';
      await storage.create(changesetId, '10 Changes Test', undefined, 'base-snapshot');

      // Stage 10 changes across multiple layers
      const changes = [
        // Motivation layer additions
        {
          type: 'add' as const,
          elementId: 'motivation-goal-digital-transform',
          layerName: 'motivation',
          after: {
            id: 'motivation-goal-digital-transform',
            name: 'Digital Transformation',
            type: 'goal',
            properties: { priority: 'high', timeline: '24-months' },
          },
          sequenceNumber: 0,
        },
        {
          type: 'add' as const,
          elementId: 'motivation-goal-improve-security',
          layerName: 'motivation',
          after: {
            id: 'motivation-goal-improve-security',
            name: 'Improve Security Posture',
            type: 'goal',
            properties: { priority: 'critical' },
          },
          sequenceNumber: 1,
        },

        // Application layer additions
        {
          type: 'add' as const,
          elementId: 'application-service-auth-service',
          layerName: 'application',
          after: {
            id: 'application-service-auth-service',
            name: 'Authentication Service',
            type: 'service',
            properties: { version: '1.0.0', status: 'active' },
          },
          sequenceNumber: 2,
        },
        {
          type: 'add' as const,
          elementId: 'application-service-api-gateway',
          layerName: 'application',
          after: {
            id: 'application-service-api-gateway',
            name: 'API Gateway',
            type: 'service',
            properties: { version: '2.0.0', replicas: 3 },
          },
          sequenceNumber: 3,
        },

        // API layer additions
        {
          type: 'add' as const,
          elementId: 'api-endpoint-post-login',
          layerName: 'api',
          after: {
            id: 'api-endpoint-post-login',
            name: 'POST /auth/login',
            type: 'endpoint',
            properties: { method: 'POST', status: 'active' },
          },
          sequenceNumber: 4,
        },
        {
          type: 'add' as const,
          elementId: 'api-endpoint-get-user',
          layerName: 'api',
          after: {
            id: 'api-endpoint-get-user',
            name: 'GET /users/{id}',
            type: 'endpoint',
            properties: { method: 'GET', auth: 'required' },
          },
          sequenceNumber: 5,
        },

        // Data model additions
        {
          type: 'add' as const,
          elementId: 'data-model-entity-user',
          layerName: 'data-model',
          after: {
            id: 'data-model-entity-user',
            name: 'User',
            type: 'entity',
            properties: { fields: ['id', 'email', 'password'] },
          },
          sequenceNumber: 6,
        },
        {
          type: 'add' as const,
          elementId: 'data-model-entity-session',
          layerName: 'data-model',
          after: {
            id: 'data-model-entity-session',
            name: 'Session',
            type: 'entity',
            properties: { fields: ['token', 'userId', 'expiresAt'] },
          },
          sequenceNumber: 7,
        },

        // Business layer updates (updates to base elements)
        {
          type: 'add' as const,
          elementId: 'business-process-user-auth',
          layerName: 'business',
          after: {
            id: 'business-process-user-auth',
            name: 'User Authentication Process',
            type: 'process',
            properties: { status: 'designed' },
          },
          sequenceNumber: 8,
        },
        {
          type: 'add' as const,
          elementId: 'business-process-session-management',
          layerName: 'business',
          after: {
            id: 'business-process-session-management',
            name: 'Session Management Process',
            type: 'process',
            properties: { status: 'designed' },
          },
          sequenceNumber: 9,
        },
      ];

      for (const change of changes) {
        await storage.addChange(changesetId, change);
      }

      // Verify all changes were stored
      const changeset = await storage.load(changesetId);
      expect(changeset?.changes.length).toBe(10);

      // Project model and verify merged state
      const projected = await engine.projectModel(baseModel, changesetId);

      expect(projected.isProjection).toBe(true);
      expect(projected.layers.has('motivation')).toBe(true);
      expect(projected.layers.has('application')).toBe(true);
      expect(projected.layers.has('api')).toBe(true);
      expect(projected.layers.has('data-model')).toBe(true);
      expect(projected.layers.has('business')).toBe(true);

      // Verify specific elements exist in projected view
      const motivationLayer = projected.layers.get('motivation')!;
      expect(motivationLayer.getElement('motivation-goal-digital-transform')).toBeDefined();
      expect(motivationLayer.getElement('motivation-goal-improve-security')).toBeDefined();

      const appLayer = projected.layers.get('application')!;
      expect(appLayer.getElement('application-service-auth-service')).toBeDefined();
      expect(appLayer.getElement('application-service-api-gateway')).toBeDefined();

      const apiLayer = projected.layers.get('api')!;
      expect(apiLayer.getElement('api-endpoint-post-login')).toBeDefined();
      expect(apiLayer.getElement('api-endpoint-get-user')).toBeDefined();

      const dataLayer = projected.layers.get('data-model')!;
      expect(dataLayer.getElement('data-model-entity-user')).toBeDefined();
      expect(dataLayer.getElement('data-model-entity-session')).toBeDefined();

      // Verify element properties are preserved
      const authEndpoint = apiLayer.getElement('api-endpoint-post-login')!;
      expect(authEndpoint.name).toBe('POST /auth/login');
      expect(authEndpoint.properties.method).toBe('POST');

      // Compute diff and verify
      const diff = await engine.computeDiff(baseModel, changesetId);
      expect(diff.additions.length).toBe(10);
      expect(diff.modifications.length).toBe(0);
      expect(diff.deletions.length).toBe(0);
    });

    it('should correctly handle complex change sequence: add, update, delete', async () => {
      const changesetId = 'complex-sequence-test';
      await storage.create(changesetId, 'Complex Sequence', undefined, 'base-snapshot');

      const elementId = 'application-service-order-processing';

      // Sequence: add -> update -> delete
      await storage.addChange(changesetId, {
        type: 'add',
        elementId,
        layerName: 'application',
        after: {
          name: 'Order Processing Service v1',
          type: 'service',
          properties: { version: '1.0.0' },
        },
        sequenceNumber: 0,
      });

      await storage.addChange(changesetId, {
        type: 'update',
        elementId,
        layerName: 'application',
        before: { name: 'Order Processing Service v1' },
        after: {
          name: 'Order Processing Service v2',
          properties: { version: '2.0.0' },
        },
        sequenceNumber: 1,
      });

      await storage.addChange(changesetId, {
        type: 'delete',
        elementId,
        layerName: 'application',
        before: { name: 'Order Processing Service v2' },
        sequenceNumber: 2,
      });

      // Project layer and verify final state
      const projected = await engine.projectLayer(baseModel, changesetId, 'application');

      // Element should not exist after delete
      expect(projected.getElement(elementId)).toBeUndefined();

      // Verify diff shows net result: nothing (add -> update -> delete = no net change)
      const diff = await engine.computeDiff(baseModel, changesetId);
      expect(diff.additions.length).toBe(1);
      expect(diff.modifications.length).toBe(1);
      expect(diff.deletions.length).toBe(1);
    });

    it('should maintain layer independence across projections', async () => {
      const changesetId = 'layer-independence-test';
      await storage.create(changesetId, 'Layer Independence', undefined, 'base-snapshot');

      // Add to motivation layer
      await storage.addChange(changesetId, {
        type: 'add',
        elementId: 'motivation-goal-test',
        layerName: 'motivation',
        after: { name: 'Test Goal' },
        sequenceNumber: 0,
      });

      // Add to application layer
      await storage.addChange(changesetId, {
        type: 'add',
        elementId: 'application-service-test',
        layerName: 'application',
        after: { name: 'Test Service' },
        sequenceNumber: 1,
      });

      // Project individual layers
      const motivationProj = await engine.projectLayer(
        baseModel,
        changesetId,
        'motivation'
      );
      const appProj = await engine.projectLayer(baseModel, changesetId, 'application');

      // Verify independence
      expect(motivationProj.getElement('motivation-goal-test')).toBeDefined();
      expect(motivationProj.getElement('application-service-test')).toBeUndefined();

      expect(appProj.getElement('application-service-test')).toBeDefined();
      expect(appProj.getElement('motivation-goal-test')).toBeUndefined();
    });
  });

  describe('Performance: 1000-element model', () => {
    it('should complete projection in under 500ms for 1000-element model', async () => {
      const changesetId = 'perf-test-large-model';
      await storage.create(changesetId, 'Large Model Performance', undefined, 'base-snapshot');

      // Create a large layer with 1000 elements
      const largeLayer = new Layer('large-layer');
      for (let i = 0; i < 1000; i++) {
        largeLayer.addElement(
          new Element({
            id: `large-layer-element-${i}`,
            name: `Element ${i}`,
            type: 'component',
            properties: { index: i },
          })
        );
      }
      baseModel.addLayer(largeLayer);

      // Add 100 changes to the large layer
      for (let i = 0; i < 100; i++) {
        await storage.addChange(changesetId, {
          type: 'add',
          elementId: `large-layer-new-element-${i}`,
          layerName: 'large-layer',
          after: {
            name: `New Element ${i}`,
            type: 'component',
          },
          sequenceNumber: i,
        });
      }

      // Measure projection time
      const startTime = Date.now();
      const projected = await engine.projectLayer(baseModel, changesetId, 'large-layer');
      const endTime = Date.now();

      const elapsed = endTime - startTime;

      // Verify projection is correct
      expect(projected.listElements().length).toBe(1100); // 1000 original + 100 new

      // Performance assertion: must complete in under 500ms
      expect(elapsed).toBeLessThan(500);
    });
  });
});
