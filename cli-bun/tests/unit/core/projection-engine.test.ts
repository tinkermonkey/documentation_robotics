import { describe, it, expect, beforeEach } from 'bun:test';
import { ProjectionEngine } from '@/core/projection-engine';
import { Model } from '@/core/model';
import { Layer } from '@/core/layer';
import { Element } from '@/core/element';
import type { Reference } from '@/types/index';

describe('ProjectionEngine', () => {
  let engine: ProjectionEngine;

  beforeEach(() => {
    engine = new ProjectionEngine();
  });

  describe('addRule', () => {
    it('should add a projection rule', () => {
      engine.addRule({ sourceLayer: '01', targetLayer: '02' });
      const rules = engine.getRules();
      expect(rules.length).toBe(1);
      expect(rules[0].sourceLayer).toBe('01');
      expect(rules[0].targetLayer).toBe('02');
    });

    it('should add multiple rules', () => {
      engine.addRule({ sourceLayer: '01', targetLayer: '02' });
      engine.addRule({ sourceLayer: '02', targetLayer: '03' });
      const rules = engine.getRules();
      expect(rules.length).toBe(2);
    });

    it('should support optional predicate filter', () => {
      engine.addRule({
        sourceLayer: '01',
        targetLayer: '02',
        predicate: 'realizes',
      });
      const rules = engine.getRules();
      expect(rules[0].predicate).toBe('realizes');
    });
  });

  describe('removeRule', () => {
    it('should remove a projection rule', () => {
      engine.addRule({ sourceLayer: '01', targetLayer: '02' });
      engine.addRule({ sourceLayer: '02', targetLayer: '03' });

      engine.removeRule('01', '02');

      const rules = engine.getRules();
      expect(rules.length).toBe(1);
      expect(rules[0].sourceLayer).toBe('02');
    });

    it('should do nothing if rule does not exist', () => {
      engine.addRule({ sourceLayer: '01', targetLayer: '02' });

      engine.removeRule('03', '04');

      const rules = engine.getRules();
      expect(rules.length).toBe(1);
    });
  });

  describe('getRules', () => {
    it('should return a copy of rules', () => {
      engine.addRule({ sourceLayer: '01', targetLayer: '02' });
      const rules1 = engine.getRules();
      const rules2 = engine.getRules();

      expect(rules1).not.toBe(rules2);
      expect(rules1).toEqual(rules2);
    });

    it('should return empty array initially', () => {
      expect(engine.getRules()).toEqual([]);
    });
  });

  describe('clearRules', () => {
    it('should clear all rules', () => {
      engine.addRule({ sourceLayer: '01', targetLayer: '02' });
      engine.addRule({ sourceLayer: '02', targetLayer: '03' });

      engine.clearRules();

      expect(engine.getRules()).toEqual([]);
    });
  });

  describe('project', () => {
    it('should project dependencies across layers', async () => {
      // Create a simple model with references
      const manifest = {
        name: 'Test Model',
        version: '1.0.0',
      };

      const model = new Model('/tmp', { name: 'Test Model', version: '1.0.0' });

      // Create layers
      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');

      // Create elements with references
      const elem01: Element = new Element({
        id: '01-motivation-goal-test',
        type: 'goal',
        name: 'Test Goal',
        references: [
          {
            source: '01-motivation-goal-test',
            target: '02-business-process-test',
            type: 'realizes',
          },
        ],
      });

      const elem02: Element = new Element({
        id: '02-business-process-test',
        type: 'process',
        name: 'Test Process',
      });

      layer01.addElement(elem01);
      layer02.addElement(elem02);

      model.addLayer(layer01);
      model.addLayer(layer02);

      // Add projection rule
      engine.addRule({ sourceLayer: '01', targetLayer: '02' });

      // Project
      const results = await engine.project(model, '01-motivation-goal-test', '02-business');

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('02-business-process-test');
    });

    it('should follow multiple reference chains', async () => {
      const model = new Model('/tmp', { name: 'Test Model', version: '1.0.0' });

      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');
      const layer03 = new Layer('03-security');

      // Build chain: 01 → 02 → 03
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

      // Add rules for both transitions
      engine.addRule({ sourceLayer: '01', targetLayer: '02' });
      engine.addRule({ sourceLayer: '02', targetLayer: '03' });

      // Project to layer 03
      const results = await engine.project(model, '01-motivation-goal-test', '03-security');

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('03-security-policy-test');
    });

    it('should not follow references without matching rule', async () => {
      const model = new Model('/tmp', { name: 'Test Model', version: '1.0.0' });

      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');

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
      });

      layer01.addElement(elem01);
      layer02.addElement(elem02);

      model.addLayer(layer01);
      model.addLayer(layer02);

      // No projection rule added

      const results = await engine.project(model, '01-motivation-goal-test', '02-business');

      expect(results.length).toBe(0);
    });

    it('should return empty array if no matching elements', async () => {
      const model = new Model('/tmp', { name: 'Test Model', version: '1.0.0' });

      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');

      const elem01 = new Element({
        id: '01-motivation-goal-test',
        type: 'goal',
        name: 'Goal',
      });

      layer01.addElement(elem01);
      model.addLayer(layer01);
      model.addLayer(layer02);

      engine.addRule({ sourceLayer: '01', targetLayer: '02' });

      const results = await engine.project(model, '01-motivation-goal-test', '02-business');

      expect(results.length).toBe(0);
    });

    it('should prevent infinite recursion with circular references', async () => {
      const model = new Model('/tmp', { name: 'Test Model', version: '1.0.0' });

      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');

      // Create circular reference: 01 → 02 → 01
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

      engine.addRule({ sourceLayer: '01', targetLayer: '02' });
      engine.addRule({ sourceLayer: '02', targetLayer: '01' });

      // Should not hang or throw
      const results = await engine.project(
        model,
        '01-motivation-goal-test',
        '02-business'
      );

      // Should handle circular ref gracefully
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('getReachable', () => {
    it('should find all reachable elements', async () => {
      const model = new Model('/tmp', { name: 'Test Model', version: '1.0.0' });

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

      engine.addRule({ sourceLayer: '01', targetLayer: '02' });
      engine.addRule({ sourceLayer: '02', targetLayer: '03' });

      const reachable = await engine.getReachable(
        model,
        '01-motivation-goal-test'
      );

      expect(reachable.size).toBe(2);
      expect(reachable.has('02-business-process-test')).toBe(true);
      expect(reachable.has('03-security-policy-test')).toBe(true);
      expect(reachable.has('01-motivation-goal-test')).toBe(false);
    });

    it('should respect maxDepth parameter', async () => {
      const model = new Model('/tmp', { name: 'Test Model', version: '1.0.0' });

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

      engine.addRule({ sourceLayer: '01', targetLayer: '02' });
      engine.addRule({ sourceLayer: '02', targetLayer: '03' });

      // With maxDepth=1, should only find direct dependencies (depth 1)
      const reachable = await engine.getReachable(
        model,
        '01-motivation-goal-test',
        1
      );

      expect(reachable.size).toBe(1);
      expect(reachable.has('02-business-process-test')).toBe(true);
      expect(reachable.has('03-security-policy-test')).toBe(false);
    });

    it('should return empty map for element with no dependencies', async () => {
      const model = new Model('/tmp', { name: 'Test Model', version: '1.0.0' });

      const layer01 = new Layer('01-motivation');

      const elem01 = new Element({
        id: '01-motivation-goal-test',
        type: 'goal',
        name: 'Goal',
      });

      layer01.addElement(elem01);
      model.addLayer(layer01);

      const reachable = await engine.getReachable(
        model,
        '01-motivation-goal-test'
      );

      expect(reachable.size).toBe(0);
    });
  });

  describe('projectReverse', () => {
    it('should project dependencies in reverse', async () => {
      const model = new Model('/tmp', { name: 'Test Model', version: '1.0.0' });

      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');

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
      });

      layer01.addElement(elem01);
      layer02.addElement(elem02);

      model.addLayer(layer01);
      model.addLayer(layer02);

      engine.addRule({ sourceLayer: '01', targetLayer: '02' });

      const results = await engine.projectReverse(
        model,
        '02-business-process-test',
        '01-motivation'
      );

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('01-motivation-goal-test');
    });

    it('should return empty array if no reverse projection exists', async () => {
      const model = new Model('/tmp', { name: 'Test Model', version: '1.0.0' });

      const layer01 = new Layer('01-motivation');
      const layer02 = new Layer('02-business');

      const elem01 = new Element({
        id: '01-motivation-goal-test',
        type: 'goal',
        name: 'Goal',
      });

      const elem02 = new Element({
        id: '02-business-process-test',
        type: 'process',
        name: 'Process',
      });

      layer01.addElement(elem01);
      layer02.addElement(elem02);

      model.addLayer(layer01);
      model.addLayer(layer02);

      // No reverse rule
      const results = await engine.projectReverse(
        model,
        '02-business-process-test',
        '01-motivation'
      );

      expect(results.length).toBe(0);
    });
  });
});
