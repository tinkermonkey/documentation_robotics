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
  private readonly ELEMENT_ID_PATTERN = /^[a-z0-9]+\-[a-z0-9]+(\-[a-z0-9]+)*$/;

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

    const parts = elementId.split('-');

    // Must have at least 3 parts: layer, type, name
    if (parts.length < 3) {
      result.addError({
        layer: layerName,
        elementId,
        message: 'Element ID must have at least 3 parts: layer, type, and name',
        fixSuggestion: 'Use format: {layer}-{type}-{kebab-case-name}',
      });
      return;
    }

    const [idLayer, idType, ...nameParts] = parts;

    // Verify layer prefix matches the actual layer
    if (idLayer !== layerName) {
      result.addError({
        layer: layerName,
        elementId,
        message: `Element ID layer prefix '${idLayer}' does not match layer '${layerName}'`,
        fixSuggestion: `Change prefix to '${layerName}' (e.g., ${layerName}-${idType}-${nameParts.join('-')})`,
      });
      return;
    }

    // Verify type is present and non-empty
    if (!idType || idType.length === 0) {
      result.addError({
        layer: layerName,
        elementId,
        message: 'Element ID missing type component',
        fixSuggestion: 'Add type after layer prefix (e.g., motivation-goal-...)',
      });
      return;
    }

    // Verify name is present
    if (nameParts.length === 0) {
      result.addError({
        layer: layerName,
        elementId,
        message: 'Element ID missing name component',
        fixSuggestion: 'Add kebab-case name after type (e.g., motivation-goal-increase-revenue)',
      });
    }
  }
}
