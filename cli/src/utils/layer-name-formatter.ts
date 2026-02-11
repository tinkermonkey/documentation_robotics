/**
 * Centralized layer name formatting
 * Ensures consistent layer name display across all CLI output
 */

/**
 * Format layer name for display with title case
 * Examples: "motivation" → "Motivation", "data-model" → "Data Model"
 */
export function formatLayerName(layerName: string): string {
  return layerName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Format layer name with " layer" suffix
 * Examples: "motivation" → "Motivation layer", "data-model" → "Data Model layer"
 */
export function formatLayerNameWithSuffix(layerName: string): string {
  return `${formatLayerName(layerName)} layer`;
}
