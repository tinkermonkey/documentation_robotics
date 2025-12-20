import { describe, it, expect } from 'bun:test';
import { NamingValidator } from '@/validators/naming-validator';
import { Layer } from '@/core/layer';
import { Element } from '@/core/element';

describe('NamingValidator', () => {
  it('should validate correct element IDs', () => {
    const validator = new NamingValidator();
    const layer = new Layer('motivation', [
      new Element({
        id: 'motivation-goal-increase-revenue',
        type: 'Goal',
        name: 'Increase Revenue',
      }),
      new Element({
        id: 'motivation-requirement-user-login',
        type: 'Requirement',
        name: 'User Login',
      }),
    ]);

    const result = validator.validateLayer(layer);

    expect(result.isValid()).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect invalid ID format (too few parts)', () => {
    const validator = new NamingValidator();
    const layer = new Layer('motivation', [
      new Element({
        id: 'invalid-id',
        type: 'Goal',
        name: 'Test',
      }),
    ]);

    const result = validator.validateLayer(layer);

    expect(result.isValid()).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('must have at least 3 parts');
  });

  it('should detect mismatched layer prefix', () => {
    const validator = new NamingValidator();
    const layer = new Layer('motivation', [
      new Element({
        id: 'business-goal-test',
        type: 'Goal',
        name: 'Test',
      }),
    ]);

    const result = validator.validateLayer(layer);

    expect(result.isValid()).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('does not match layer');
    expect(result.errors[0].fixSuggestion).toContain('motivation');
  });

  it('should detect missing type component', () => {
    const validator = new NamingValidator();
    const layer = new Layer('motivation', [
      new Element({
        id: 'motivation--test',
        type: 'Goal',
        name: 'Test',
      }),
    ]);

    const result = validator.validateLayer(layer);

    expect(result.isValid()).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('should detect missing name component', () => {
    const validator = new NamingValidator();
    const layer = new Layer('business', [
      new Element({
        id: 'business-process-',
        type: 'Process',
        name: 'Test',
      }),
    ]);

    const result = validator.validateLayer(layer);

    expect(result.isValid()).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should validate multi-word kebab-case names', () => {
    const validator = new NamingValidator();
    const layer = new Layer('technology', [
      new Element({
        id: 'technology-infrastructure-kubernetes-cluster',
        type: 'Infrastructure',
        name: 'Kubernetes Cluster',
      }),
    ]);

    const result = validator.validateLayer(layer);

    expect(result.isValid()).toBe(true);
  });

  it('should detect uppercase characters in ID', () => {
    const validator = new NamingValidator();
    const layer = new Layer('motivation', [
      new Element({
        id: 'motivation-Goal-test',
        type: 'Goal',
        name: 'Test',
      }),
    ]);

    const result = validator.validateLayer(layer);

    expect(result.isValid()).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('should validate multiple elements', () => {
    const validator = new NamingValidator();
    const layer = new Layer('api', [
      new Element({
        id: 'api-endpoint-get-users',
        type: 'Endpoint',
        name: 'Get Users',
      }),
      new Element({
        id: 'api-endpoint-create-user',
        type: 'Endpoint',
        name: 'Create User',
      }),
      new Element({
        id: 'invalid-format',
        type: 'Endpoint',
        name: 'Invalid',
      }),
    ]);

    const result = validator.validateLayer(layer);

    expect(result.isValid()).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].elementId).toBe('invalid-format');
  });

  it('should handle numeric characters in IDs', () => {
    const validator = new NamingValidator();
    const layer = new Layer('data-model', [
      new Element({
        id: 'data-model-entity-user-v2',
        type: 'Entity',
        name: 'User V2',
      }),
    ]);

    const result = validator.validateLayer(layer);

    expect(result.isValid()).toBe(true);
  });
});
