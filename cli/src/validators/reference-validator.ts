/**
 * Reference validation for cross-layer integrity
 */

import { ValidationResult } from './types.js';
import type { Model } from '../core/model.js';

/**
 * Validator for cross-layer references
 */
export class ReferenceValidator {
  // Layer hierarchy (lower numbers are "higher" in the architecture)
  private readonly LAYER_HIERARCHY: Record<string, number> = {
    motivation: 1,
    business: 2,
    security: 3,
    application: 4,
    technology: 5,
    api: 6,
    'data-model': 7,
    'data-store': 8,
    ux: 9,
    navigation: 10,
    apm: 11,
    testing: 12,
  };

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
   * Validate all references in a model
   */
  validateModel(model: Model): ValidationResult {
    const result = new ValidationResult();
    const allElementIds = this.collectAllElementIds(model);

    for (const [layerName, layer] of model.layers) {
      for (const element of layer.listElements()) {
        this.validateReferences(
          element.id,
          element.references || [],
          layerName,
          allElementIds,
          result
        );
      }
    }

    return result;
  }

  /**
   * Collect all element IDs across the model
   */
  private collectAllElementIds(model: Model): Set<string> {
    const ids = new Set<string>();

    for (const layer of model.layers.values()) {
      for (const element of layer.listElements()) {
        ids.add(element.id);
      }
    }

    return ids;
  }

  /**
   * Validate references for an element
   */
  private validateReferences(
    elementId: string,
    references: Array<{ target: string; type?: string }>,
    sourceLayerName: string,
    validIds: Set<string>,
    result: ValidationResult
  ): void {
    for (const ref of references) {
      // Check target exists
      if (!validIds.has(ref.target)) {
        result.addError({
          layer: sourceLayerName,
          elementId,
          message: `Broken reference: target '${ref.target}' does not exist`,
          fixSuggestion: `Remove reference or create element '${ref.target}'`,
        });
        continue;
      }

      // Check directional constraint (higher → lower only)
      const targetLayerName = this.extractLayerFromId(ref.target);
      const sourceLevel = this.LAYER_HIERARCHY[sourceLayerName];
      const targetLevel = this.LAYER_HIERARCHY[targetLayerName];

      if (sourceLevel === undefined) {
        result.addError({
          layer: sourceLayerName,
          elementId,
          message: `Unknown source layer: ${sourceLayerName}`,
          fixSuggestion: 'Use one of the valid layers: motivation, business, security, application, technology, api, data-model, data-store, ux, navigation, apm, testing',
        });
        continue;
      }

      if (targetLevel === undefined) {
        result.addError({
          layer: sourceLayerName,
          elementId,
          message: `Target element '${ref.target}' has unknown layer: ${targetLayerName}`,
          fixSuggestion: `Check that element ID '${ref.target}' uses a valid layer prefix (e.g., motivation-, business-, api-)`,
        });
        continue;
      }

      // References must go from higher layers (lower numbers) to lower layers (higher numbers)
      // or within the same layer
      if (sourceLevel > targetLevel) {
        result.addError({
          layer: sourceLayerName,
          elementId,
          message: `Invalid reference direction: ${sourceLayerName} (level ${sourceLevel}) cannot reference ${targetLayerName} (level ${targetLevel})`,
          fixSuggestion:
            'References must go from higher layers to lower layers (motivation → testing)',
        });
      }
    }
  }

  /**
   * Extract layer name from element ID, handling both dot-separated and hyphenated layer names
   */
  private extractLayerFromId(elementId: string): string {
    // Determine if using dot-separated format (e.g., motivation.goal.name) or hyphenated (e.g., motivation-goal-name)
    const isDotSeparated = elementId.includes('.');
    const separator = isDotSeparated ? '.' : '-';

    // Try to match known layers in order of specificity (longest first)
    const sortedLayers = [...this.KNOWN_LAYERS].sort((a, b) => b.length - a.length);

    for (const layer of sortedLayers) {
      if (elementId.startsWith(layer + separator)) {
        return layer;
      }
    }

    // Fallback: return first segment (shouldn't reach here with valid element IDs)
    return elementId.split(separator)[0] || '';
  }
}
