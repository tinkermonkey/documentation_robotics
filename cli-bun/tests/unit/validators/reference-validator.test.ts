import { describe, it, expect } from 'bun:test';
import { ReferenceValidator } from '@/validators/reference-validator';
import { Model } from '@/core/model';
import { Manifest } from '@/core/manifest';
import { Layer } from '@/core/layer';
import { Element } from '@/core/element';

describe('ReferenceValidator', () => {
  function createTestModel(): Model {
    const manifest = new Manifest({
      name: 'Test Model',
      version: '1.0.0',
    });
    return new Model('/test', manifest);
  }

  it('should validate valid references', () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    // Higher layer (motivation) references lower layer (business)
    const motivationLayer = new Layer('motivation', [
      new Element({
        id: 'motivation-goal-revenue',
        type: 'Goal',
        name: 'Increase Revenue',
        references: [{ target: 'business-process-sales', type: 'implements' }],
      }),
    ]);

    const businessLayer = new Layer('business', [
      new Element({
        id: 'business-process-sales',
        type: 'Process',
        name: 'Sales Process',
      }),
    ]);

    model.addLayer(motivationLayer);
    model.addLayer(businessLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect broken references', () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    const motivationLayer = new Layer('motivation', [
      new Element({
        id: 'motivation-goal-revenue',
        type: 'Goal',
        name: 'Increase Revenue',
        references: [{ target: 'business-process-nonexistent', type: 'implements' }],
      }),
    ]);

    model.addLayer(motivationLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Broken reference');
    expect(result.errors[0].message).toContain('business-process-nonexistent');
  });

  it('should enforce directional constraint (higher to lower)', () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    // Lower layer (business) incorrectly references higher layer (motivation)
    const businessLayer = new Layer('business', [
      new Element({
        id: 'business-process-sales',
        type: 'Process',
        name: 'Sales Process',
        references: [{ target: 'motivation-goal-revenue', type: 'implements' }],
      }),
    ]);

    const motivationLayer = new Layer('motivation', [
      new Element({
        id: 'motivation-goal-revenue',
        type: 'Goal',
        name: 'Increase Revenue',
      }),
    ]);

    model.addLayer(businessLayer);
    model.addLayer(motivationLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Invalid reference direction');
  });

  it('should allow same-layer references', () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    const businessLayer = new Layer('business', [
      new Element({
        id: 'business-process-sales',
        type: 'Process',
        name: 'Sales Process',
        references: [{ target: 'business-process-fulfillment', type: 'precedes' }],
      }),
      new Element({
        id: 'business-process-fulfillment',
        type: 'Process',
        name: 'Fulfillment Process',
      }),
    ]);

    model.addLayer(businessLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(true);
  });

  it('should handle multiple layers and references', () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    const motivationLayer = new Layer('motivation', [
      new Element({
        id: 'motivation-goal-revenue',
        type: 'Goal',
        name: 'Increase Revenue',
        references: [
          { target: 'business-process-sales', type: 'implements' },
          { target: 'security-policy-data-protection', type: 'subject-to' },
        ],
      }),
    ]);

    const businessLayer = new Layer('business', [
      new Element({
        id: 'business-process-sales',
        type: 'Process',
        name: 'Sales Process',
        references: [{ target: 'application-service-crm', type: 'uses' }],
      }),
    ]);

    const securityLayer = new Layer('security', [
      new Element({
        id: 'security-policy-data-protection',
        type: 'Policy',
        name: 'Data Protection',
      }),
    ]);

    const appLayer = new Layer('application', [
      new Element({
        id: 'application-service-crm',
        type: 'Service',
        name: 'CRM Service',
      }),
    ]);

    model.addLayer(motivationLayer);
    model.addLayer(businessLayer);
    model.addLayer(securityLayer);
    model.addLayer(appLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(true);
  });

  it('should detect multiple broken references in same element', () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    const motivationLayer = new Layer('motivation', [
      new Element({
        id: 'motivation-goal-revenue',
        type: 'Goal',
        name: 'Increase Revenue',
        references: [
          { target: 'business-process-nonexistent1', type: 'implements' },
          { target: 'business-process-nonexistent2', type: 'implements' },
        ],
      }),
    ]);

    model.addLayer(motivationLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('should handle empty reference list', () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    const motivationLayer = new Layer('motivation', [
      new Element({
        id: 'motivation-goal-revenue',
        type: 'Goal',
        name: 'Increase Revenue',
        references: [],
      }),
    ]);

    model.addLayer(motivationLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(true);
  });

  it('should detect reference to unknown layer', () => {
    const validator = new ReferenceValidator();
    const model = createTestModel();

    const motivationLayer = new Layer('motivation', [
      new Element({
        id: 'motivation-goal-revenue',
        type: 'Goal',
        name: 'Increase Revenue',
        references: [{ target: 'unknown-element-id', type: 'implements' }],
      }),
    ]);

    model.addLayer(motivationLayer);

    const result = validator.validateModel(model);

    expect(result.isValid()).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});
