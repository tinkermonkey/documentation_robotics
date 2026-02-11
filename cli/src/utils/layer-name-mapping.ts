/**
 * Layer name display mapping for consistent formatting across the CLI
 * Maps canonical layer names to display-friendly format
 */

export const LAYER_DISPLAY_NAMES: Record<string, string> = {
  motivation: "Motivation layer",
  business: "Business layer",
  security: "Security layer",
  application: "Application layer",
  technology: "Technology layer",
  api: "API layer",
  "data-model": "Data Model layer",
  "data-store": "Data Store layer",
  ux: "UX layer",
  navigation: "Navigation layer",
  apm: "APM layer",
  testing: "Testing layer",
} as const;

/**
 * Format a canonical layer name for display
 * @param layerName - The canonical layer name
 * @returns Formatted display name or the original name if not found
 */
export function formatLayerName(layerName: string): string {
  return LAYER_DISPLAY_NAMES[layerName] || layerName;
}
