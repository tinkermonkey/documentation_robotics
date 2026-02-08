import { describe, it, expect } from 'bun:test';
import { Validator } from '@/validators/validator';
import { Model } from '@/core/model';
import { Manifest } from '@/core/manifest';
import { Layer } from '@/core/layer';
import { Element } from '@/core/element';

describe('Validator', () => {
  function createTestModel(): Model {
    const manifest = new Manifest({
      name: 'Test Model',
      version: '1.0.0',
    });
    return new Model('/test', manifest);
  }

  it('should create validator instance', () => {
    const validator = new Validator();
    expect(validator).toBeDefined();
  });

  it('should validate empty model', async () => {
    const validator = new Validator();
    const model = createTestModel();

    const result = await validator.validateModel(model);

    expect(result).toBeDefined();
    expect(result.toDict()).toBeDefined();
  });

  it('should pass 4-stage validation for valid model', async () => {
    const validator = new Validator();
    const model = createTestModel();

    // Create valid layers
    const motivationLayer = new Layer('motivation', [
      new Element({
        id: 'motivation.goal.increase-revenue',
        type: 'Goal',
        name: 'Increase Revenue',
        references: [{ source: 'motivation.goal.increase-revenue', target: 'business.process.sales', type: 'implements' }],
      }),
    ]);

    const businessLayer = new Layer('business', [
      new Element({
        id: 'business.process.sales',
        type: 'Process',
        name: 'Sales Process',
      }),
    ]);

    model.addLayer(motivationLayer);
    model.addLayer(businessLayer);

    const result = await validator.validateModel(model);

    expect(result.isValid()).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('should detect naming validation errors', async () => {
    const validator = new Validator();
    const model = createTestModel();

    // Create layer with invalid element ID (doesn't match {layer}.{type}.{name} or {layer}-{type}-{name} format)
    const motivationLayer = new Layer('motivation', [
      new Element({
        id: 'INVALID_ID',
        type: 'Goal',
        name: 'Test Goal',
      }),
    ]);

    model.addLayer(motivationLayer);

    const result = await validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.message.includes('Naming'))).toBe(true);
  });

  it('should detect reference validation errors', async () => {
    const validator = new Validator();
    const model = createTestModel();

    // Create layer with broken references
    const motivationLayer = new Layer('motivation', [
      new Element({
        id: 'motivation.goal.revenue',
        type: 'Goal',
        name: 'Test',
        references: [{ source: 'motivation.goal.revenue', target: 'business.process.nonexistent', type: 'implements' }],
      }),
    ]);

    model.addLayer(motivationLayer);

    const result = await validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Broken reference'))).toBe(true);
  });

  it('should detect semantic validation errors (duplicates)', async () => {
    const validator = new Validator();
    const model = createTestModel();

    // Create layers with duplicate IDs
    const layer1 = new Layer('motivation', [
      new Element({
        id: 'motivation.goal.duplicate-id',
        type: 'Goal',
        name: 'Goal 1',
      }),
    ]);

    const layer2 = new Layer('business', [
      new Element({
        id: 'motivation.goal.duplicate-id',
        type: 'Process',
        name: 'Process 1',
      }),
    ]);

    model.addLayer(layer1);
    model.addLayer(layer2);

    const result = await validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
  });

  it('should merge validation results with proper prefixes', async () => {
    const validator = new Validator();
    const model = createTestModel();

    // Create multiple validation issues
    const motivationLayer = new Layer('motivation', [
      new Element({
        id: 'INVALID-FORMAT',
        type: 'Goal',
        name: 'Test',
      }),
    ]);

    model.addLayer(motivationLayer);

    const result = await validator.validateModel(model);

    // Check that errors have proper prefixes
    expect(result.errors.some((e) => e.message.includes('[Naming'))).toBe(true);
  });

  it('should handle multiple validation stages', async () => {
    const validator = new Validator();
    const model = createTestModel();

    // Create layer with multiple issues
    const layer = new Layer('motivation', [
      new Element({
        id: 'INVALID_ID', // naming error
        type: 'Goal',
        name: 'Test Goal',
        references: [{ source: 'INVALID_ID', target: 'business.process.nonexistent', type: 'implements' }], // reference error
      }),
      new Element({
        id: 'motivation.goal.duplicate-id',
        type: 'Goal',
        name: 'Test 2',
      }),
    ]);

    const businessLayer = new Layer('business', [
      new Element({
        id: 'motivation.goal.duplicate-id', // semantic error (duplicate)
        type: 'Process',
        name: 'Process',
      }),
    ]);

    model.addLayer(layer);
    model.addLayer(businessLayer);

    const result = await validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it('should convert validation result to dictionary', async () => {
    const validator = new Validator();
    const model = createTestModel();

    const layer = new Layer('motivation', [
      new Element({
        id: 'motivation.goal.test',
        type: 'Goal',
        name: 'Test',
      }),
    ]);

    model.addLayer(layer);

    const result = await validator.validateModel(model);
    const dict = result.toDict();

    expect(dict.valid).toBeDefined();
    expect(dict.errorCount).toBeDefined();
    expect(dict.warningCount).toBeDefined();
    expect(dict.errors).toBeDefined();
    expect(dict.warnings).toBeDefined();
  });

  it('should allow mixed valid and invalid elements', async () => {
    const validator = new Validator();
    const model = createTestModel();

    const layer = new Layer('motivation', [
      new Element({
        id: 'motivation.goal.valid',
        type: 'Goal',
        name: 'Valid Goal',
      }),
      new Element({
        id: 'INVALID_FORMAT',
        type: 'Goal',
        name: 'Invalid Goal',
      }),
    ]);

    model.addLayer(layer);

    const result = await validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should validate directional references', async () => {
    const validator = new Validator();
    const model = createTestModel();

    // Business (lower) layer incorrectly references Motivation (higher) layer
    const businessLayer = new Layer('business', [
      new Element({
        id: 'business.process.sales',
        type: 'Process',
        name: 'Sales',
        references: [{ source: 'business.process.sales', target: 'motivation.goal.revenue', type: 'implements' }],
      }),
    ]);

    const motivationLayer = new Layer('motivation', [
      new Element({
        id: 'motivation.goal.revenue',
        type: 'Goal',
        name: 'Revenue',
      }),
    ]);

    model.addLayer(businessLayer);
    model.addLayer(motivationLayer);

    const result = await validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors.some((e) => e.message.includes('direction'))).toBe(true);
  });
});
