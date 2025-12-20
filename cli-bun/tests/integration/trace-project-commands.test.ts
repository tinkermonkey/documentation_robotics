import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'fs/promises';
import { Model } from '@/core/model';
import { Layer } from '@/core/layer';
import { Element } from '@/core/element';
import { ReferenceRegistry } from '@/core/reference-registry';
import { DependencyTracker } from '@/core/dependency-tracker';
import { ProjectionEngine } from '@/core/projection-engine';

describe('Integration: Trace and Project Commands', () => {
  let testDir: string;
  let model: Model;

  beforeEach(async () => {
    testDir = `/tmp/test-model-${Date.now()}`;
    await mkdir(testDir, { recursive: true });

    // Create a simple test model
    await Model.init(
      testDir,
      {
        name: 'Integration Test Model',
        version: '1.0.0',
        specVersion: '0.6.0',
      },
      { lazyLoad: false }
    );

    model = await Model.load(testDir);
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('Trace Command Integration', () => {
    it('should trace simple dependency chain', async () => {
      // Build: 01 → 02 → 03
      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');
      const layer03 = new Layer('03-security');

      const elem01 = new Element({
        id: '01-motivation-goal-create-customer',
        type: 'goal',
        name: 'Create Customer Goal',
        references: [
          {
            source: '01-motivation-goal-create-customer',
            target: '02-business-process-create-order',
            type: 'realizes',
          },
        ],
      });

      const elem02 = new Element({
        id: '02-business-process-create-order',
        type: 'process',
        name: 'Create Order Process',
        references: [
          {
            source: '02-business-process-create-order',
            target: '03-security-policy-access-control',
            type: 'requires',
          },
        ],
      });

      const elem03 = new Element({
        id: '03-security-policy-access-control',
        type: 'policy',
        name: 'Access Control Policy',
      });

      layer01.addElement(elem01);
      layer02.addElement(elem02);
      layer03.addElement(elem03);

      model.addLayer(layer01);
      model.addLayer(layer02);
      model.addLayer(layer03);

      await model.saveDirtyLayers();
      await model.saveManifest();

      // Load fresh model
      const loadedModel = await Model.load(testDir, { lazyLoad: false });

      // Build registry
      const registry = new ReferenceRegistry();
      for (const layer of loadedModel.layers.values()) {
        for (const element of layer.listElements()) {
          registry.registerElement(element);
        }
      }

      // Get graph and tracker
      const graph = registry.getDependencyGraph();
      const tracker = new DependencyTracker(graph);

      // Verify upward trace (dependents)
      const dependents = tracker.getTransitiveDependents(
        '03-security-policy-access-control'
      );
      expect(dependents).toContain('01-motivation-goal-create-customer');
      expect(dependents).toContain('02-business-process-create-order');

      // Verify downward trace (dependencies)
      const dependencies = tracker.getTransitiveDependencies(
        '01-motivation-goal-create-customer'
      );
      expect(dependencies).toContain('02-business-process-create-order');
      expect(dependencies).toContain('03-security-policy-access-control');
    });

    it('should detect cycles in dependency graph', async () => {
      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');

      // Create circular reference: 01 ↔ 02
      const elem01 = new Element({
        id: '01-motivation-goal-test',
        type: 'goal',
        name: 'Goal',
        references: [
          {
            source: '01-motivation-goal-test',
            target: '02-business-process-test',
            type: 'realizes',
          },
        ],
      });

      const elem02 = new Element({
        id: '02-business-process-test',
        type: 'process',
        name: 'Process',
        references: [
          {
            source: '02-business-process-test',
            target: '01-motivation-goal-test',
            type: 'requires',
          },
        ],
      });

      layer01.addElement(elem01);
      layer02.addElement(elem02);

      model.addLayer(layer01);
      model.addLayer(layer02);

      await model.saveDirtyLayers();
      await model.saveManifest();

      const loadedModel = await Model.load(testDir, { lazyLoad: false });

      const registry = new ReferenceRegistry();
      for (const layer of loadedModel.layers.values()) {
        for (const element of layer.listElements()) {
          registry.registerElement(element);
        }
      }

      const graph = registry.getDependencyGraph();
      const tracker = new DependencyTracker(graph);

      const cycles = tracker.detectCycles();
      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should calculate impact radius', async () => {
      // Build: 01 → 02 → 03 and 01 → 04
      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');
      const layer03 = new Layer('03-security');
      const layer04 = new Layer('04-application');

      const elem01 = new Element({
        id: '01-motivation-goal-test',
        type: 'goal',
        name: 'Goal',
        references: [
          {
            source: '01-motivation-goal-test',
            target: '02-business-process-test',
            type: 'realizes',
          },
          {
            source: '01-motivation-goal-test',
            target: '04-application-service-test',
            type: 'implements',
          },
        ],
      });

      const elem02 = new Element({
        id: '02-business-process-test',
        type: 'process',
        name: 'Process',
        references: [
          {
            source: '02-business-process-test',
            target: '03-security-policy-test',
            type: 'requires',
          },
        ],
      });

      const elem03 = new Element({
        id: '03-security-policy-test',
        type: 'policy',
        name: 'Policy',
      });

      const elem04 = new Element({
        id: '04-application-service-test',
        type: 'service',
        name: 'Service',
      });

      layer01.addElement(elem01);
      layer02.addElement(elem02);
      layer03.addElement(elem03);
      layer04.addElement(elem04);

      model.addLayer(layer01);
      model.addLayer(layer02);
      model.addLayer(layer03);
      model.addLayer(layer04);

      await model.saveDirtyLayers();
      await model.saveManifest();

      const loadedModel = await Model.load(testDir, { lazyLoad: false });

      const registry = new ReferenceRegistry();
      for (const layer of loadedModel.layers.values()) {
        for (const element of layer.listElements()) {
          registry.registerElement(element);
        }
      }

      const graph = registry.getDependencyGraph();
      const tracker = new DependencyTracker(graph);

      // Impact radius of 01 = 3 (02, 03, 04)
      const impactRadius = tracker.getImpactRadius('01-motivation-goal-test');
      expect(impactRadius).toBe(3);
    });
  });

  describe('Project Command Integration', () => {
    it('should project dependencies across layers', async () => {
      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');

      const elem01 = new Element({
        id: '01-motivation-goal-create-customer',
        type: 'goal',
        name: 'Create Customer Goal',
        references: [
          {
            source: '01-motivation-goal-create-customer',
            target: '02-business-process-create-order',
            type: 'realizes',
          },
        ],
      });

      const elem02 = new Element({
        id: '02-business-process-create-order',
        type: 'process',
        name: 'Create Order Process',
      });

      layer01.addElement(elem01);
      layer02.addElement(elem02);

      model.addLayer(layer01);
      model.addLayer(layer02);

      await model.saveDirtyLayers();
      await model.saveManifest();

      const loadedModel = await Model.load(testDir, { lazyLoad: false });

      const engine = new ProjectionEngine();
      engine.addRule({ sourceLayer: '01', targetLayer: '02' });

      const results = await engine.project(
        loadedModel,
        '01-motivation-goal-create-customer',
        '02-business'
      );

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('02-business-process-create-order');
    });

    it('should project through multiple layers', async () => {
      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');
      const layer03 = new Layer('03-security');

      const elem01 = new Element({
        id: '01-motivation-goal-test',
        type: 'goal',
        name: 'Goal',
        references: [
          {
            source: '01-motivation-goal-test',
            target: '02-business-process-test',
            type: 'realizes',
          },
        ],
      });

      const elem02 = new Element({
        id: '02-business-process-test',
        type: 'process',
        name: 'Process',
        references: [
          {
            source: '02-business-process-test',
            target: '03-security-policy-test',
            type: 'requires',
          },
        ],
      });

      const elem03 = new Element({
        id: '03-security-policy-test',
        type: 'policy',
        name: 'Policy',
      });

      layer01.addElement(elem01);
      layer02.addElement(elem02);
      layer03.addElement(elem03);

      model.addLayer(layer01);
      model.addLayer(layer02);
      model.addLayer(layer03);

      await model.saveDirtyLayers();
      await model.saveManifest();

      const loadedModel = await Model.load(testDir, { lazyLoad: false });

      const engine = new ProjectionEngine();
      engine.addRule({ sourceLayer: '01', targetLayer: '02' });
      engine.addRule({ sourceLayer: '02', targetLayer: '03' });

      const results = await engine.project(
        loadedModel,
        '01-motivation-goal-test',
        '03-security'
      );

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('03-security-policy-test');
    });

    it('should return multiple projected elements', async () => {
      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');

      const elem01 = new Element({
        id: '01-motivation-goal-test',
        type: 'goal',
        name: 'Goal',
        references: [
          {
            source: '01-motivation-goal-test',
            target: '02-business-process-test1',
            type: 'realizes',
          },
          {
            source: '01-motivation-goal-test',
            target: '02-business-process-test2',
            type: 'realizes',
          },
        ],
      });

      const elem02a = new Element({
        id: '02-business-process-test1',
        type: 'process',
        name: 'Process 1',
      });

      const elem02b = new Element({
        id: '02-business-process-test2',
        type: 'process',
        name: 'Process 2',
      });

      layer01.addElement(elem01);
      layer02.addElement(elem02a);
      layer02.addElement(elem02b);

      model.addLayer(layer01);
      model.addLayer(layer02);

      await model.saveDirtyLayers();
      await model.saveManifest();

      const loadedModel = await Model.load(testDir, { lazyLoad: false });

      const engine = new ProjectionEngine();
      engine.addRule({ sourceLayer: '01', targetLayer: '02' });

      const results = await engine.project(
        loadedModel,
        '01-motivation-goal-test',
        '02-business'
      );

      expect(results.length).toBe(2);
      const ids = results.map(r => r.id);
      expect(ids).toContain('02-business-process-test1');
      expect(ids).toContain('02-business-process-test2');
    });

    it('should find reachable elements with depth information', async () => {
      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');
      const layer03 = new Layer('03-security');

      const elem01 = new Element({
        id: '01-motivation-goal-test',
        type: 'goal',
        name: 'Goal',
        references: [
          {
            source: '01-motivation-goal-test',
            target: '02-business-process-test',
            type: 'realizes',
          },
        ],
      });

      const elem02 = new Element({
        id: '02-business-process-test',
        type: 'process',
        name: 'Process',
        references: [
          {
            source: '02-business-process-test',
            target: '03-security-policy-test',
            type: 'requires',
          },
        ],
      });

      const elem03 = new Element({
        id: '03-security-policy-test',
        type: 'policy',
        name: 'Policy',
      });

      layer01.addElement(elem01);
      layer02.addElement(elem02);
      layer03.addElement(elem03);

      model.addLayer(layer01);
      model.addLayer(layer02);
      model.addLayer(layer03);

      await model.saveDirtyLayers();
      await model.saveManifest();

      const loadedModel = await Model.load(testDir, { lazyLoad: false });

      const engine = new ProjectionEngine();
      engine.addRule({ sourceLayer: '01', targetLayer: '02' });
      engine.addRule({ sourceLayer: '02', targetLayer: '03' });

      const reachable = await engine.getReachable(
        loadedModel,
        '01-motivation-goal-test'
      );

      expect(reachable.size).toBe(2);
      expect(reachable.get('02-business-process-test')).toBe(1);
      expect(reachable.get('03-security-policy-test')).toBe(2);
    });
  });

  describe('Combined Trace and Project Workflows', () => {
    it('should trace and project the same model', async () => {
      // Create a realistic model
      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');
      const layer04 = new Layer('04-application');

      const goal = new Element({
        id: '01-motivation-goal-sales',
        type: 'goal',
        name: 'Increase Sales',
        references: [
          {
            source: '01-motivation-goal-sales',
            target: '02-business-process-order',
            type: 'realizes',
          },
        ],
      });

      const process = new Element({
        id: '02-business-process-order',
        type: 'process',
        name: 'Order Process',
        references: [
          {
            source: '02-business-process-order',
            target: '04-application-service-order',
            type: 'implements',
          },
        ],
      });

      const service = new Element({
        id: '04-application-service-order',
        type: 'service',
        name: 'Order Service',
      });

      layer01.addElement(goal);
      layer02.addElement(process);
      layer04.addElement(service);

      model.addLayer(layer01);
      model.addLayer(layer02);
      model.addLayer(layer04);

      await model.saveDirtyLayers();
      await model.saveManifest();

      const loadedModel = await Model.load(testDir, { lazyLoad: false });

      // Test trace
      const registry = new ReferenceRegistry();
      for (const layer of loadedModel.layers.values()) {
        for (const element of layer.listElements()) {
          registry.registerElement(element);
        }
      }

      const graph = registry.getDependencyGraph();
      const tracker = new DependencyTracker(graph);

      const dependencies = tracker.getTransitiveDependencies('01-motivation-goal-sales');
      expect(dependencies).toContain('02-business-process-order');
      expect(dependencies).toContain('04-application-service-order');

      // Test project
      const engine = new ProjectionEngine();
      engine.addRule({ sourceLayer: '01', targetLayer: '02' });
      engine.addRule({ sourceLayer: '02', targetLayer: '04' });

      const projected = await engine.project(
        loadedModel,
        '01-motivation-goal-sales',
        '04-application'
      );

      expect(projected.length).toBe(1);
      expect(projected[0].id).toBe('04-application-service-order');
    });
  });
});
