/**
 * Canonical layer names and ordering for the 12-layer architecture model.
 * This is the source of truth for layer naming and ordering.
 */

export const CANONICAL_LAYER_NAMES = [
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
  'testing'
] as const;

export type CanonicalLayerName = (typeof CANONICAL_LAYER_NAMES)[number];

/**
 * Map of layer names to their numeric order (1-12).
 * Derived from CANONICAL_LAYER_NAMES as the single source of truth.
 */
export const LAYER_MAP: Record<CanonicalLayerName, number> = Object.fromEntries(
  CANONICAL_LAYER_NAMES.map((name, index) => [name, index + 1])
) as Record<CanonicalLayerName, number>;

/**
 * Array of all layer names in order.
 * Derived from CANONICAL_LAYER_NAMES.
 */
export const LAYER_NAMES: readonly CanonicalLayerName[] = CANONICAL_LAYER_NAMES;

/**
 * Get the numeric order of a layer (1-12)
 */
export function getLayerOrder(layerName: string): number {
  const index = CANONICAL_LAYER_NAMES.indexOf(layerName as CanonicalLayerName);
  return index >= 0 ? index + 1 : -1;
}

/**
 * Get layer name by numeric order (1-12)
 */
export function getLayerByOrder(order: number): string | undefined {
  if (order < 1 || order > CANONICAL_LAYER_NAMES.length) {
    return undefined;
  }
  return CANONICAL_LAYER_NAMES[order - 1];
}

/**
 * Check if a layer name is valid
 */
export function isValidLayerName(name: string): boolean {
  return CANONICAL_LAYER_NAMES.includes(name as CanonicalLayerName);
}

/**
 * Extract layer name from an element ID using robust longest-prefix matching.
 *
 * Element IDs follow the format: {layer}.{elementType}.{kebab-case-name}
 * Handles both dot-separated and hyphenated formats.
 * Uses longest-prefix matching to correctly handle multi-word layer names like "data-model".
 *
 * @param elementId - Full element ID
 * @returns Layer name or null if ID format is invalid
 *
 * @example
 * ```typescript
 * extractLayerFromId("api.endpoint.create-order") // => "api"
 * extractLayerFromId("data-model.entity.customer") // => "data-model"
 * extractLayerFromId("invalid-id") // => null
 * ```
 */
export function extractLayerFromId(elementId: string): string | null {
  // Determine if using dot-separated format (e.g., motivation.goal.name) or hyphenated (e.g., motivation-goal-name)
  const isDotSeparated = elementId.includes(".");
  const separator = isDotSeparated ? "." : "-";

  // Try to match known layers in order of specificity (longest first)
  const sortedLayers = LAYER_NAMES.slice().sort((a, b) => b.length - a.length);

  for (const layer of sortedLayers) {
    const prefix = layer + separator;
    if (elementId.startsWith(prefix)) {
      const remainder = elementId.slice(prefix.length);
      // Ensure remainder has at least type + separator + name (i.e., contains at least one separator)
      if (remainder.includes(separator)) {
        return layer;
      }
      // If remainder doesn't have proper structure, this isn't a valid element ID
      return null;
    }
  }

  // Return null if no valid layer prefix found
  return null;
}

/**
 * Get the numeric layer number from an element ID using robust layer extraction.
 *
 * Element IDs follow the format: {layer}.{elementType}.{kebab-case-name}
 * Uses extractLayerFromId for validation against known layer names.
 *
 * @param elementId - Full element ID
 * @returns Layer number (1-12) or null if layer cannot be extracted or is unknown
 *
 * @example
 * ```typescript
 * getLayerNumber("api.endpoint.create-order") // => 6
 * getLayerNumber("data-model.entity.customer") // => 7
 * getLayerNumber("invalid-id") // => null
 * ```
 */
export function getLayerNumber(elementId: string): number | null {
  const layerName = extractLayerFromId(elementId);
  if (!layerName) {
    return null;
  }
  return LAYER_MAP[layerName] ?? null;
}
