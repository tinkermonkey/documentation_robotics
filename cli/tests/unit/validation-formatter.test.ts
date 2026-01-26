import { describe, it, expect } from 'bun:test';
import { ValidationFormatter } from '../../src/validators/validation-formatter.js';
import { ValidationResult } from '../../src/validators/types.js';
import { Model } from '../../src/core/model.js';
import { Layer } from '../../src/core/layer.js';
import { Element } from '../../src/core/element.js';

/**
 * Strip ANSI escape codes from a string
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('ValidationFormatter', () => {
  let model: Model;
  let result: ValidationResult;

  async function setupModel(): Promise<Model> {
    const model = new Model();

    // Add some test layers and elements
    const motivationLayer = new Layer('motivation');
    motivationLayer.addElement(new Element({
      id: 'motivation-goal-increase-sales',
      name: 'Increase Sales',
      type: 'goal',
    }));
    motivationLayer.addElement(new Element({
      id: 'motivation-goal-reduce-costs',
      name: 'Reduce Costs',
      type: 'goal',
    }));

    const businessLayer = new Layer('business');
    businessLayer.addElement(new Element({
      id: 'business-process-sales',
      name: 'Sales Process',
      type: 'process',
      references: [{ target: 'motivation-goal-increase-sales' }],
    }));

    const apiLayer = new Layer('api');
    apiLayer.addElement(new Element({
      id: 'api-endpoint-list-products',
      name: 'List Products',
      type: 'endpoint',
      references: [{ target: 'business-process-sales' }],
    }));

    model.addLayer(motivationLayer);
    model.addLayer(businessLayer);
    model.addLayer(apiLayer);

    return model;
  }

  it('should format valid model with standard output', async () => {
    model = await setupModel();
    result = new ValidationResult();

    const output = ValidationFormatter.format(result, model);

    expect(output).toContain('Validating Documentation Robotics Model');
    expect(output).toContain('Schema Validation:');
    expect(output).toContain('Motivation layer');
    expect(output).toContain('Business layer');
    expect(output).toContain('API layer');
    expect(output).toContain('Cross-Layer Validation:');
    expect(output).toContain('Summary:');
  });

  it('should format errors in output', async () => {
    model = await setupModel();
    result = new ValidationResult();
    result.addError({
      layer: 'business',
      elementId: 'business-process-sales',
      message: 'Invalid element ID format',
      fixSuggestion: 'Use format {layer}.{type}.{name}',
    });

    const output = ValidationFormatter.format(result, model);
    const cleanOutput = stripAnsi(output);

    expect(cleanOutput).toContain('✗ Business layer');
    expect(cleanOutput).toContain('1. Invalid element ID format');
    expect(cleanOutput).toContain('Element: business-process-sales');
    expect(cleanOutput).toContain('Suggestion: Use format {layer}.{type}.{name}');
  });

  it('should format warnings in output', async () => {
    model = await setupModel();
    result = new ValidationResult();
    result.addWarning({
      layer: 'motivation',
      elementId: 'motivation-goal-reduce-costs',
      message: 'Potentially orphaned element',
      fixSuggestion: 'Add relationships or verify element is intentional',
    });

    const output = ValidationFormatter.format(result, model);

    expect(output).toContain('Warnings:');
    expect(output).toContain('1. Potentially orphaned element');
    expect(output).toContain('Element: motivation-goal-reduce-costs');
  });

  it('should format quiet output', async () => {
    model = await setupModel();
    result = new ValidationResult();

    const output = ValidationFormatter.format(result, model, { quiet: true });

    expect(output).toContain('✓ Validation passed');
    expect(output).not.toContain('Validating Documentation Robotics Model');
    expect(output).not.toContain('Schema Validation:');
  });

  it('should format quiet output with errors', async () => {
    model = await setupModel();
    result = new ValidationResult();
    result.addError({
      layer: 'business',
      elementId: 'business-process-sales',
      message: 'Invalid element ID format',
    });

    const output = ValidationFormatter.format(result, model, { quiet: true });

    expect(output).toContain('✗');
    expect(output).toContain('1 error(s)');
  });

  it('should include relationship statistics in verbose output', async () => {
    model = await setupModel();
    result = new ValidationResult();

    const output = ValidationFormatter.format(result, model, { verbose: true });

    expect(output).toContain('Relationship breakdown:');
  });

  it('should export validation result as JSON', async () => {
    model = await setupModel();
    result = new ValidationResult();
    result.addError({
      layer: 'business',
      elementId: 'business-process-sales',
      message: 'Invalid element ID format',
    });

    const json = ValidationFormatter.toJSON(result, model);

    expect(json.valid).toBe(false);
    expect(json.summary).toBeDefined();
    expect(json.summary.totalElements).toBeGreaterThan(0);
    expect(json.summary.errorCount).toBe(1);
    expect(Array.isArray(json.errors)).toBe(true);
  });

  it('should export validation result as Markdown', async () => {
    model = await setupModel();
    result = new ValidationResult();
    result.addError({
      layer: 'business',
      elementId: 'business-process-sales',
      message: 'Invalid element ID format',
      fixSuggestion: 'Use format {layer}.{type}.{name}',
    });

    const markdown = ValidationFormatter.toMarkdown(result, model);

    expect(markdown).toContain('# Validation Report');
    expect(markdown).toContain('## Summary');
    expect(markdown).toContain('## Errors');
    expect(markdown).toContain('Invalid element ID format');
  });

  it('should count elements per layer correctly', async () => {
    model = await setupModel();
    result = new ValidationResult();

    const json = ValidationFormatter.toJSON(result, model);

    expect(json.summary.totalElements).toBe(4); // 2 motivation + 1 business + 1 api
  });

  it('should count relationships correctly', async () => {
    model = await setupModel();
    result = new ValidationResult();

    const json = ValidationFormatter.toJSON(result, model);

    expect(json.summary.totalRelationships).toBeGreaterThanOrEqual(2); // At least business->motivation and api->business
  });

  it('should show orphaned elements in JSON export', async () => {
    model = await setupModel();
    result = new ValidationResult();

    const json = ValidationFormatter.toJSON(result, model);

    expect(json.orphanedElements).toBeDefined();
    expect(Array.isArray(json.orphanedElements)).toBe(true);
    // motivation-goal-reduce-costs has no relationships
    expect(json.orphanedElements).toContain('motivation-goal-reduce-costs');
  });

  it('should include layer statistics in JSON export', async () => {
    model = await setupModel();
    result = new ValidationResult();

    const json = ValidationFormatter.toJSON(result, model);

    expect(json.layerStats).toBeDefined();
    expect(json.layerStats.motivation).toBe(2);
    expect(json.layerStats.business).toBe(1);
    expect(json.layerStats.api).toBe(1);
  });

  it('should format element IDs with file locations', async () => {
    model = await setupModel();
    result = new ValidationResult();
    result.addError({
      layer: 'business',
      elementId: 'business-process-sales',
      message: 'Invalid element ID format',
      location: 'documentation-robotics/model/02_business/processes.yaml:2',
      fixSuggestion: 'Use format {layer}.{type}.{name}',
    });

    const output = ValidationFormatter.format(result, model);

    expect(output).toContain('File: documentation-robotics/model/02_business/processes.yaml:2');
  });

  it('should handle models with no errors or warnings gracefully', async () => {
    model = await setupModel();
    result = new ValidationResult();

    const output = ValidationFormatter.format(result, model);
    const json = ValidationFormatter.toJSON(result, model);
    const markdown = ValidationFormatter.toMarkdown(result, model);

    expect(output).toContain('Model is valid and ready for use');
    expect(json.valid).toBe(true);
    expect(markdown).toContain('✓ Valid');
  });

  it('should show summary statistics correctly', async () => {
    model = await setupModel();
    result = new ValidationResult();
    result.addError({
      layer: 'business',
      elementId: 'business-process-sales',
      message: 'Invalid element ID format',
    });
    result.addWarning({
      layer: 'motivation',
      elementId: 'motivation-goal-reduce-costs',
      message: 'Potentially orphaned element',
    });

    const output = ValidationFormatter.format(result, model);

    expect(output).toContain('1 error(s), 1 warning(s)');
  });
});
