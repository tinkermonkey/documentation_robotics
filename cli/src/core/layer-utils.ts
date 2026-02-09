/**
 * Utilities for working with architecture layers
 * Consolidates layer name-to-number mappings and canonical names
 */

/**
 * Canonical layer names used throughout the CLI
 * Maps to their numeric position in the 12-layer model
 */
const LAYER_NAMES_TO_NUMBERS: Record<string, number> = {
  motivation: 1,
  business: 2,
  security: 3,
  application: 4,
  technology: 5,
  api: 6,
  "data-model": 7,
  "data-store": 8,
  ux: 9,
  navigation: 10,
  apm: 11,
  testing: 12,
};

const LAYER_NUMBERS_TO_NAMES: Record<number, string> = {
  1: "motivation",
  2: "business",
  3: "security",
  4: "application",
  5: "technology",
  6: "api",
  7: "data-model",
  8: "data-store",
  9: "ux",
  10: "navigation",
  11: "apm",
  12: "testing",
};

/**
 * Get the numeric position of a layer by its canonical name
 * @param layerName - The canonical layer name (e.g., 'motivation', 'data-model')
 * @returns The layer number (1-12), or 0 if not found
 */
export function getLayerNumber(layerName: string): number {
  return LAYER_NAMES_TO_NUMBERS[layerName] || 0;
}

/**
 * Get the canonical layer name by its numeric position
 * @param layerNumber - The layer number (1-12)
 * @returns The canonical layer name, or empty string if not found
 */
export function getLayerName(layerNumber: number): string {
  return LAYER_NUMBERS_TO_NAMES[layerNumber] || "";
}

/**
 * Get all canonical layer names in order
 * @returns Array of layer names in numeric order
 */
export function getAllLayerNames(): string[] {
  return Object.values(LAYER_NUMBERS_TO_NAMES).sort(
    (a, b) => getLayerNumber(a) - getLayerNumber(b)
  );
}

/**
 * Check if a layer name is valid
 * @param layerName - The layer name to validate
 * @returns True if the layer name is a valid canonical name
 */
export function isValidLayerName(layerName: string): boolean {
  return layerName in LAYER_NAMES_TO_NUMBERS;
}
