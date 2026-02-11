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
