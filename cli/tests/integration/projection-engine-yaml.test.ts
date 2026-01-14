/**
 * Integration tests for ProjectionEngine with real YAML rules
 */

import { describe, expect, it, beforeAll } from 'bun:test';
import { ProjectionEngine } from '../../src/core/projection-engine.js';
import { Model } from '../../src/core/model.js';
import { Manifest } from '../../src/core/manifest.js';
import { fileExists } from '../../src/utils/file-io.js';

describe('ProjectionEngine - YAML Integration', () => {
  const testRulesPath = new URL('../../../cli-validation/test-project/projection-rules.yaml', import.meta.url).pathname;

  it('should have test rules file', async () => {
    const exists = await fileExists(testRulesPath);
    expect(exists).toBe(true);
  });

  it('should load projection rules from YAML', async () => {
    const manifest = new Manifest({
      name: 'Test Model',
      description: 'Test',
      version: '0.1.0',
    });
    const model = new Model('/tmp/test-model', manifest);
    const engine = new ProjectionEngine(model);

    await engine.loadRules(testRulesPath);

    const rules = engine.getRules();
    expect(rules.length).toBe(3);

    // Check first rule
    expect(rules[0].name).toBe('Business to Application');
    expect(rules[0].from_layer).toBe('business');
    expect(rules[0].from_type).toBe('service');
    expect(rules[0].to_layer).toBe('application');
    expect(rules[0].to_type).toBe('service');
    expect(rules[0].name_template).toBe('{source.name} Service');
    expect(rules[0].conditions?.length).toBe(1);
    expect(rules[0].conditions![0].field).toBe('properties.core');
    expect(rules[0].conditions![0].operator).toBe('equals');
    expect(rules[0].conditions![0].value).toBe(true);
  });

  it('should parse property mappings with transformations', async () => {
    const manifest = new Manifest({
      name: 'Test Model',
      description: 'Test',
      version: '0.1.0',
    });
    const model = new Model('/tmp/test-model', manifest);
    const engine = new ProjectionEngine(model);

    await engine.loadRules(testRulesPath);

    const rules = engine.getRules();
    const rule = rules[0]; // Business to Application

    expect(rule.property_mappings.length).toBeGreaterThan(0);

    // Check description mapping has uppercase transform
    const descMapping = rule.property_mappings.find((m) => m.target === 'description');
    expect(descMapping).toBeDefined();
    expect(descMapping?.transform).toEqual({ type: 'uppercase' });

    // Check realizes mapping
    const realizesMapping = rule.property_mappings.find((m) => m.target === 'realizes');
    expect(realizesMapping).toBeDefined();
    expect(realizesMapping?.source).toBe('id');
  });

  it('should parse API rule with template transform', async () => {
    const manifest = new Manifest({
      name: 'Test Model',
      description: 'Test',
      version: '0.1.0',
    });
    const model = new Model('/tmp/test-model', manifest);
    const engine = new ProjectionEngine(model);

    await engine.loadRules(testRulesPath);

    const rules = engine.getRules();
    const rule = rules[1]; // Application to API

    expect(rule.name).toBe('Application to API');

    // Check template transform
    const descMapping = rule.property_mappings.find((m) => m.target === 'description');
    expect(descMapping).toBeDefined();
    expect(descMapping?.transform).toEqual({
      type: 'template',
      value: 'API operation for {value}'
    });

    // Check default value
    const methodMapping = rule.property_mappings.find((m) => m.target === 'method');
    expect(methodMapping).toBeDefined();
    expect(methodMapping?.default).toBe('POST');
  });

  it('should parse kebab transform', async () => {
    const manifest = new Manifest({
      name: 'Test Model',
      description: 'Test',
      version: '0.1.0',
    });
    const model = new Model('/tmp/test-model', manifest);
    const engine = new ProjectionEngine(model);

    await engine.loadRules(testRulesPath);

    const rules = engine.getRules();
    const rule = rules[2]; // Business to Testing

    const nameMapping = rule.property_mappings.find((m) => m.target === 'name');
    expect(nameMapping).toBeDefined();
    expect(nameMapping?.transform).toEqual({ type: 'kebab' });
  });

  it('should handle conditional rules', async () => {
    const manifest = new Manifest({
      name: 'Test Model',
      description: 'Test',
      version: '0.1.0',
    });
    const model = new Model('/tmp/test-model', manifest);
    const engine = new ProjectionEngine(model);

    await engine.loadRules(testRulesPath);

    const rules = engine.getRules();
    const rule = rules[2]; // Business to Testing

    expect(rule.conditions).toBeDefined();
    expect(rule.conditions!.length).toBe(1);
    expect(rule.conditions![0].field).toBe('properties.automated');
    expect(rule.conditions![0].operator).toBe('equals');
    expect(rule.conditions![0].value).toBe(true);
    expect(rule.create_bidirectional).toBe(false);
  });
});
