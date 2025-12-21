/**
 * Naming validation for element IDs
 */

import { ValidationResult } from './types.js';
import type { Layer } from '../core/layer.js';

/**
 * Validator for element ID naming conventions
 */
export class NamingValidator {
  // Element ID format: {layer}-{type}-{kebab-case-name}
  private readonly ELEMENT_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*(-[a-z0-9]+)+$/;

  // Known layer names (including hyphenated ones)
  private readonly KNOWN_LAYERS = [
    'motivation',
    'business',
    'security',
    'application',
    'technology',
    'api',
    'data-model',
    'data-store',
    'ux',
    'navigation',
    'apm',
    'testing',
  ];

  /**
   * Validate all elements in a layer
   */
  validateLayer(layer: Layer): ValidationResult {
    const result = new ValidationResult();

    for (const element of layer.listElements()) {
      this.validateElementId(element.id, layer.name, result);
    }

    return result;
  }

  /**
   * Validate an individual element ID
   */
  private validateElementId(
    elementId: string,
    layerName: string,
    result: ValidationResult
  ): void {
    // Check overall format
    if (!this.ELEMENT_ID_PATTERN.test(elementId)) {
      result.addError({
        layer: layerName,
        elementId,
        message: `Invalid element ID format: ${elementId}`,
        fixSuggestion: 'Use format: {layer}-{type}-{kebab-case-name} (e.g., motivation-goal-increase-revenue)',
      });
      return;
    }

    const idLayer = this.extractLayerFromId(elementId);

    // Verify layer prefix matches the actual layer
    if (idLayer !== layerName) {
      result.addError({
        layer: layerName,
        elementId,
        message: `Element ID layer prefix '${idLayer}' does not match layer '${layerName}'`,
        fixSuggestion: `Change prefix to '${layerName}' (e.g., ${layerName}-type-name)`,
      });
      return;
    }

    // Extract remaining parts after layer
    const remainingParts = elementId.slice(idLayer.length + 1).split('-');

    // Verify type is present and non-empty
    if (remainingParts.length < 2) {
      result.addError({
        layer: layerName,
        elementId,
        message: 'Element ID must have type and name components after layer',
        fixSuggestion: 'Use format: {layer}-{type}-{kebab-case-name}',
      });
      return;
    }
  }

  /**
   * Extract layer name from element ID, handling hyphenated layer names
   */
  private extractLayerFromId(elementId: string): string {
    // Try to match known layers in order of specificity (longest first)
    const sortedLayers = [...this.KNOWN_LAYERS].sort((a, b) => b.length - a.length);

    for (const layer of sortedLayers) {
      if (elementId.startsWith(layer + '-')) {
        return layer;
      }
    }

    // Fallback: return first segment (shouldn't reach here with valid format)
    return elementId.split('-')[0] || '';
  }
}
