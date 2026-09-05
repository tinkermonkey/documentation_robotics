/**
 * Naming validation for element IDs
 */

import { ValidationResult } from "./types.js";
import type { Layer } from "../core/layer.js";
import { getAllLayerIds } from "../generated/layer-registry.js";

/**
 * UUID pattern for validating id field
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validator for element ID naming conventions
 */
export class NamingValidator {
  // Path format: {layer}.{type}.{name} (dot-separated, matching Python CLI)
  // Also accepts: {layer}-{type}-{kebab-case-name} (legacy kebab-case format)
  // Layer names can contain hyphens (e.g., data-model, data-store) or underscores
  private readonly DOT_SEPARATED_PATTERN = /^[a-z_][a-z0-9_-]*(\.[a-z_][a-z0-9_-]*)+$/;
  private readonly KEBAB_CASE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*(-[a-z0-9]+)+$/;

  // Known layer names from generated registry (including hyphenated and underscored ones)
  private readonly KNOWN_LAYERS = getAllLayerIds();

  /**
   * Validate all elements in a layer
   */
  validateLayer(layer: Layer): ValidationResult {
    const result = new ValidationResult();

    for (const element of layer.listElements()) {
      // Validate the path (slug identifier); fall back to id when path is absent
      const pathToValidate = element.path || element.id;
      this.validateElementPath(pathToValidate, layer.name, result);

      // Only validate id as UUID when id and path are distinct values
      // If id === path (legacy slug serving both roles), skip UUID check
      // If id !== path (proper separation), id must be a UUID
      if (element.id && element.path && element.id !== element.path && !UUID_PATTERN.test(element.id)) {
        result.addError({
          layer: layer.name,
          elementId: element.id,
          message: `Element id '${element.id}' is not a valid UUIDv4`,
          fixSuggestion: "The id field must be a UUIDv4 (e.g., 550e8400-e29b-41d4-a716-446655440000)",
        });
      }
    }

    return result;
  }

  /**
   * Validate an individual element path (slug)
   */
  private validateElementPath(elementId: string, layerName: string, result: ValidationResult): void {
    // Skip UUID values — they are not paths
    if (UUID_PATTERN.test(elementId)) {
      return;
    }

    // Check if path matches dot-separated format (primary) or kebab-case format (legacy)
    const isDotSeparated = this.DOT_SEPARATED_PATTERN.test(elementId);
    const isKebabCase = this.KEBAB_CASE_PATTERN.test(elementId);

    if (!isDotSeparated && !isKebabCase) {
      result.addError({
        layer: layerName,
        elementId,
        message: `Invalid element ID format: ${elementId}`,
        fixSuggestion:
          "Use format: {layer}.{type}.{name} (e.g., motivation.goal.increase-revenue) or {layer}-{type}-{kebab-case-name}",
      });
      return;
    }

    const idLayer = this.extractLayerFromId(elementId, isDotSeparated);

    // Verify layer prefix matches the actual layer
    const normalizedLayerName = layerName.replace(/-/g, "_");
    const normalizedIdLayer = idLayer.replace(/-/g, "_");

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
    const separator = isDotSeparated ? "." : "-";
    const remainingParts = elementId.slice(idLayer.length + 1).split(separator);

    // Verify type is present and non-empty
    if (remainingParts.length < 2) {
      result.addError({
        layer: layerName,
        elementId,
        message: "Element ID must have type and name components after layer",
        fixSuggestion: "Use format: {layer}.{type}.{name}",
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

    const separator = isDotSeparated ? "." : "-";

    for (const layer of sortedLayers) {
      if (elementId.startsWith(layer + separator)) {
        return layer;
      }
    }

    // Fallback: take first component before separator
    return elementId.split(separator)[0];
  }
}
