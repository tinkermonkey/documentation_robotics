/**
 * Naming validation for element IDs
 */

import { ValidationResult } from './types.js';
import type { Layer } from '../core/layer.js';

/**
 * Validator for element ID naming conventions
 */
export class NamingValidator {
  // Element ID format: {layer}.{type}.{name} (dot-separated, matching Python CLI)
  // Also accepts: {layer}-{type}-{kebab-case-name} (legacy kebab-case format)
  private readonly DOT_SEPARATED_PATTERN = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_-]*)+$/;
  private readonly KEBAB_CASE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*(-[a-z0-9]+)+$/;

  // Known layer names (including hyphenated and underscored ones)
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
    // Check if ID matches dot-separated format (primary) or kebab-case format (legacy)
    const isDotSeparated = this.DOT_SEPARATED_PATTERN.test(elementId);
    const isKebabCase = this.KEBAB_CASE_PATTERN.test(elementId);

    if (!isDotSeparated && !isKebabCase) {
      result.addError({
        layer: layerName,
        elementId,
        message: `Invalid element ID format: ${elementId}`,
        fixSuggestion: 'Use format: {layer}.{type}.{name} (e.g., motivation.goal.increase-revenue) or {layer}-{type}-{kebab-case-name}',
      });
      return;
    }

    const idLayer = this.extractLayerFromId(elementId, isDotSeparated);

    // Verify layer prefix matches the actual layer
    const normalizedLayerName = layerName.replace(/-/g, '_');
    const normalizedIdLayer = idLayer.replace(/-/g, '_');

    if (normalizedIdLayer !== normalizedLayerName) {
      result.addError({
        layer: layerName,
        elementId,
        message: `Element ID layer prefix '${idLayer}' does not match layer '${layerName}'`,
        fixSuggestion: `Change prefix to '${layerName}' (e.g., ${layerName}.type.name)`,
      });
      return;
    }

    // Extract remaining parts after layer
    const separator = isDotSeparated ? '.' : '-';
    const remainingParts = elementId.slice(idLayer.length + 1).split(separator);

    // Verify type is present and non-empty
    if (remainingParts.length < 2) {
      result.addError({
        layer: layerName,
        elementId,
        message: 'Element ID must have type and name components after layer',
        fixSuggestion: 'Use format: {layer}.{type}.{name}',
      });
      return;
    }
  }

  /**
   * Extract layer name from element ID, handling hyphenated/underscored layer names
   */
  private extractLayerFromId(elementId: string, isDotSeparated: boolean): string {
    // Try to match known layers in order of specificity (longest first)
    const sortedLayers = [...this.KNOWN_LAYERS].sort((a, b) => b.length - a.length);

    const separator = isDotSeparated ? '.' : '-';

    for (const layer of sortedLayers) {
      if (elementId.startsWith(layer + separator)) {
        return layer;
      }
    }

    // Fallback: take first component before separator
    return elementId.split(separator)[0];
  }
}
