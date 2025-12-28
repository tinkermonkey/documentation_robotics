import { describe, it, expect, beforeEach } from 'bun:test';
import { ProjectionEngine, type ProjectionRule } from '@/core/projection-engine';
import { Model } from '@/core/model';
import { Manifest } from '@/core/manifest';

/**
 * Unit tests for ProjectionEngine
 *
 * Note: ProjectionEngine now implements YAML-based projection rules matching Python CLI spec.
 * See tests/integration/projection-engine-yaml.test.ts for comprehensive integration tests.
 *
 * These unit tests cover basic rule management only.
 */
describe('ProjectionEngine', () => {
  let model: Model;
  let engine: ProjectionEngine;

  beforeEach(() => {
    const manifest = new Manifest({
      name: 'Test Model',
      description: 'Test',
      version: '1.0.0',
    });
    model = new Model('/tmp/test-model', manifest);
    engine = new ProjectionEngine(model);
  });

  describe('addRule', () => {
    it('should add a projection rule', () => {
      const rule: ProjectionRule = {
        name: 'Test Rule',
        from_layer: 'business',
        from_type: 'service',
        to_layer: 'application',
        to_type: 'component',
        name_template: '{source.name} Component',
        property_mappings: [],
      };

      engine.addRule(rule);
      const rules = engine.getRules();
      expect(rules.length).toBe(1);
      expect(rules[0].name).toBe('Test Rule');
      expect(rules[0].from_layer).toBe('business');
      expect(rules[0].to_layer).toBe('application');
    });

    it('should add multiple rules', () => {
      const rule1: ProjectionRule = {
        name: 'Rule 1',
        from_layer: 'business',
        from_type: 'service',
        to_layer: 'application',
        to_type: 'component',
        name_template: '{source.name}',
        property_mappings: [],
      };

      const rule2: ProjectionRule = {
        name: 'Rule 2',
        from_layer: 'application',
        from_type: 'component',
        to_layer: 'technology',
        to_type: 'node',
        name_template: '{source.name}',
        property_mappings: [],
      };

      engine.addRule(rule1);
      engine.addRule(rule2);
      const rules = engine.getRules();
      expect(rules.length).toBe(2);
    });
  });

  describe('getRules', () => {
    it('should return a copy of rules', () => {
      const rule: ProjectionRule = {
        name: 'Test Rule',
        from_layer: 'business',
        from_type: 'service',
        to_layer: 'application',
        to_type: 'component',
        name_template: '{source.name}',
        property_mappings: [],
      };

      engine.addRule(rule);
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
      const rule1: ProjectionRule = {
        name: 'Rule 1',
        from_layer: 'business',
        from_type: 'service',
        to_layer: 'application',
        to_type: 'component',
        name_template: '{source.name}',
        property_mappings: [],
      };

      const rule2: ProjectionRule = {
        name: 'Rule 2',
        from_layer: 'application',
        from_type: 'component',
        to_layer: 'technology',
        to_type: 'node',
        name_template: '{source.name}',
        property_mappings: [],
      };

      engine.addRule(rule1);
      engine.addRule(rule2);

      engine.clearRules();

      expect(engine.getRules()).toEqual([]);
    });
  });

  // Note: Tests for projectElement(), projectAll(), findApplicableRules() etc.
  // are covered in integration tests (tests/integration/projection-engine-yaml.test.ts)
  // where we can test with real YAML rules and model data.
});
