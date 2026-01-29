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
    // Eager loading required: Test traces dependencies across all layers
    // which requires all layers loaded upfront for complete tracing capability
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

      // Eager loading required: Test traces transitive dependencies across all layers
      // which requires all layers loaded to verify complete trace paths
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

      // Eager loading required: Test detects cycles across all layers
      // which requires all layers loaded to detect complete cyclic paths
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

  });
});
