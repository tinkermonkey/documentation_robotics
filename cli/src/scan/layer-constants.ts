/**
 * Layer numbering constants used across scanning, validation, and inference.
 * This is the single source of truth for layer number mappings.
 */
export const LAYER_MAP: Record<string, number> = {
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

export const LAYER_NAMES = Object.keys(LAYER_MAP);

export function getLayerNumber(elementId: string): number | null {
  const layerName = elementId.split('.')[0];
  return LAYER_MAP[layerName] ?? null;
}
