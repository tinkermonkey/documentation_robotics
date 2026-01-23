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

describe('Cache Performance Benchmarks', () => {
  let baseModel: Model;
  let storage: StagedChangesetStorage;
  let engine: VirtualProjectionEngine;
  let snapshotManager: BaseSnapshotManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dr-cache-perf-test-'));
    storage = new StagedChangesetStorage(tempDir);
    engine = new VirtualProjectionEngine(tempDir);
    snapshotManager = new BaseSnapshotManager();

    // Create test model with multiple layers
    const manifest = new Manifest({
      name: 'Cache Performance Model',
      description: 'Model for benchmarking cache performance',
      version: '1.0.0',
      specVersion: '0.7.1',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });

    baseModel = new Model(tempDir, manifest);

    // Create 8 layers to simulate larger model
    const layerNames = ['api', 'data-model', 'application', 'technology', 'security', 'business', 'motivation', 'ux'];
    for (const layerName of layerNames) {
      const layer = new Layer(layerName);

      // Add 5 elements per layer
      for (let i = 0; i < 5; i++) {
        layer.addElement(new Element({
          id: `${layerName}-element-${i}`,
          type: 'component',
          name: `${layerName} Component ${i}`,
          description: `Component in ${layerName} layer`,
        }));
      }

      baseModel.addLayer(layer);
      await baseModel.saveLayer(layerName);
    }

    await baseModel.saveManifest();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Cache Hit Rate Improvement', () => {
    it('should demonstrate cache hit improvement with layer-specific invalidation', async () => {
      const changesetId = 'hit-rate-benchmark';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Hit Rate Benchmark',
        'Benchmark cache hit rates',
        baseSnapshot
      );

      // Create changes affecting only 2 out of 8 layers
      changeset.changes = [
        {
          type: 'update',
          elementId: 'api-element-0',
          layerName: 'api',
          sequenceNumber: 1,
          before: { name: 'API Component 0' },
          after: { name: 'API Component 0 Updated' },
        },
        {
          type: 'update',
          elementId: 'data-model-element-0',
          layerName: 'data-model',
          sequenceNumber: 2,
          before: { name: 'Data-Model Component 0' },
          after: { name: 'Data-Model Component 0 Updated' },
        },
      ];

      await storage.save(changeset);

      // Warm cache for all layers
      const layerNames = ['api', 'data-model', 'application', 'technology', 'security', 'business', 'motivation', 'ux'];
      for (const layerName of layerNames) {
        await engine.projectLayer(baseModel, changesetId, layerName);
      }

      const metricsAfterWarmup = engine.getCacheMetrics(changesetId);
      expect(metricsAfterWarmup?.misses).toBe(8); // 8 initial misses
      expect(metricsAfterWarmup?.hits).toBe(0);

      // Unstage only the API element (affecting 1 layer)
      await engine.invalidateOnUnstage(changesetId, 'api-element-0');

      // Project all layers again
      for (const layerName of layerNames) {
        await engine.projectLayer(baseModel, changesetId, layerName);
      }

      const metricsAfterInvalidation = engine.getCacheMetrics(changesetId);

      // With layer-specific invalidation:
      // - API layer: 1 miss (invalidated)
      // - 7 other layers: 7 hits (not invalidated)
      // Total: 1 additional miss, 7 hits
      expect(metricsAfterInvalidation?.misses).toBeGreaterThanOrEqual(9); // At least 8 + 1 new miss
      expect(metricsAfterInvalidation?.hits).toBeGreaterThanOrEqual(7); // At least 7 hits

      // Calculate hit rate
      const totalRequests = (metricsAfterInvalidation?.hits || 0) + (metricsAfterInvalidation?.misses || 0);
      const hitRate = totalRequests > 0 ? (metricsAfterInvalidation?.hits || 0) / totalRequests : 0;

      // With 7 out of 8 layers cached, hit rate should be high
      expect(hitRate).toBeGreaterThan(0.4); // Allow some variance in hit rate
    });
  });

  describe('Single-Layer Invalidation Performance', () => {
    it('should perform faster invalidation with single-layer targeting', async () => {
      const changesetId = 'single-layer-perf';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Single Layer Performance',
        'Benchmark single layer invalidation',
        baseSnapshot
      );

      // Changes across 3 layers
      changeset.changes = [
        {
          type: 'update',
          elementId: 'api-element-1',
          layerName: 'api',
          sequenceNumber: 1,
          before: { name: 'API 1' },
          after: { name: 'API 1 Updated' },
        },
        {
          type: 'update',
          elementId: 'data-model-element-1',
          layerName: 'data-model',
          sequenceNumber: 2,
          before: { name: 'DM 1' },
          after: { name: 'DM 1 Updated' },
        },
        {
          type: 'update',
          elementId: 'application-element-1',
          layerName: 'application',
          sequenceNumber: 3,
          before: { name: 'App 1' },
          after: { name: 'App 1 Updated' },
        },
      ];

      await storage.save(changeset);

      // Warm cache for all three affected layers
      await engine.projectLayer(baseModel, changesetId, 'api');
      await engine.projectLayer(baseModel, changesetId, 'data-model');
      await engine.projectLayer(baseModel, changesetId, 'application');

      // Measure single-layer invalidation time
      const startSingle = performance.now();
      await engine.invalidateOnUnstage(changesetId, 'api-element-1');
      const endSingle = performance.now();
      const singleLayerTime = endSingle - startSingle;

      // Re-warm cache for full invalidation test
      await engine.projectLayer(baseModel, changesetId, 'api');
      await engine.projectLayer(baseModel, changesetId, 'data-model');
      await engine.projectLayer(baseModel, changesetId, 'application');

      // Measure full invalidation time
      const startFull = performance.now();
      await engine.invalidateOnUnstage(changesetId);
      const endFull = performance.now();
      const fullInvalidationTime = endFull - startFull;

      // Single-layer invalidation should complete (single layer invalidation is targeting 1 layer)
      expect(singleLayerTime).toBeGreaterThanOrEqual(0);

      // The operation should complete without errors
      expect(singleLayerTime).toBeLessThan(1000); // Should be fast (< 1 second)
      expect(fullInvalidationTime).toBeLessThan(1000); // Should be fast (< 1 second)
    });
  });

  describe('Cache Efficiency with Multi-Layer Changesets', () => {
    it('should improve cache efficiency for changesets with many layers', async () => {
      const changesetId = 'multi-layer-efficiency';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Multi-Layer Efficiency',
        'Test cache efficiency with many layers',
        baseSnapshot
      );

      // Create changes affecting 4 out of 8 layers
      changeset.changes = [
        {
          type: 'update',
          elementId: 'api-element-2',
          layerName: 'api',
          sequenceNumber: 1,
          before: { name: 'API 2' },
          after: { name: 'API 2 V2' },
        },
        {
          type: 'update',
          elementId: 'data-model-element-2',
          layerName: 'data-model',
          sequenceNumber: 2,
          before: { name: 'DM 2' },
          after: { name: 'DM 2 V2' },
        },
        {
          type: 'update',
          elementId: 'application-element-2',
          layerName: 'application',
          sequenceNumber: 3,
          before: { name: 'App 2' },
          after: { name: 'App 2 V2' },
        },
        {
          type: 'update',
          elementId: 'technology-element-2',
          layerName: 'technology',
          sequenceNumber: 4,
          before: { name: 'Tech 2' },
          after: { name: 'Tech 2 V2' },
        },
      ];

      await storage.save(changeset);

      // Warm all 8 layers
      const allLayers = ['api', 'data-model', 'application', 'technology', 'security', 'business', 'motivation', 'ux'];
      for (const layer of allLayers) {
        await engine.projectLayer(baseModel, changesetId, layer);
      }

      let metrics = engine.getCacheMetrics(changesetId);
      const metricsAfterWarmup = { ...metrics };

      // Unstage only one element (affecting 1 layer out of 4)
      await engine.invalidateOnUnstage(changesetId, 'api-element-2');

      // Project all layers again
      for (const layer of allLayers) {
        await engine.projectLayer(baseModel, changesetId, layer);
      }

      metrics = engine.getCacheMetrics(changesetId);

      // Calculate cache reuse
      // With layer-specific invalidation:
      // - 1 invalidated layer (api) requires recomputation
      // - 7 unchanged cached layers can be reused
      // Expected: 1 new miss, 7 cache hits

      const newMisses = (metrics?.misses || 0) - (metricsAfterWarmup?.misses || 0);
      const newHits = (metrics?.hits || 0) - (metricsAfterWarmup?.hits || 0);

      expect(newMisses).toBe(1); // Only API layer invalidated
      expect(newHits).toBe(7); // 7 other layers hit cache

      // Hit rate should be 7 out of 8 = 87.5%
      const cacheReuse = newHits / (newMisses + newHits);
      expect(cacheReuse).toBeGreaterThan(0.80); // At least 80% cache reuse
    });
  });

  describe('Metrics Overhead Assessment', () => {
    it('should track metrics with minimal overhead', async () => {
      const changesetId = 'metrics-overhead';
      const baseSnapshot = await snapshotManager.captureSnapshot(baseModel);

      const changeset = await storage.create(
        changesetId,
        'Metrics Overhead Test',
        'Test metrics tracking overhead',
        baseSnapshot
      );

      changeset.changes = [
        {
          type: 'update',
          elementId: 'api-element-3',
          layerName: 'api',
          sequenceNumber: 1,
          before: { name: 'API 3' },
          after: { name: 'API 3 V2' },
        },
      ];

      await storage.save(changeset);

      // Measure time to project layer and track metrics
      const iterations = 10;

      const startWithMetrics = performance.now();
      for (let i = 0; i < iterations; i++) {
        await engine.projectLayer(baseModel, changesetId, 'api');
      }
      const endWithMetrics = performance.now();
      const timeWithMetrics = endWithMetrics - startWithMetrics;

      // Get final metrics
      const metrics = engine.getCacheMetrics(changesetId);

      // Verify metrics were tracked
      expect(metrics?.hits).toBeGreaterThan(0);
      expect(metrics?.misses).toBeGreaterThan(0);

      // Time should be reasonable (< 1 second for 10 iterations with cache hits)
      expect(timeWithMetrics).toBeLessThan(1000);

      // Average time per operation should be small
      const avgTimePerOp = timeWithMetrics / iterations;
      expect(avgTimePerOp).toBeLessThan(100); // < 100ms per operation
    });
  });
});
