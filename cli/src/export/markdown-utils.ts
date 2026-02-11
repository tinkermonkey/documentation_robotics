/**
 * Shared markdown utilities for exporters
 */

/**
 * Layer descriptions for documentation
 */
export const LAYER_DESCRIPTIONS: Record<string, string> = {
  motivation: "Goals, requirements, drivers, and strategic outcomes of the architecture.",
  business: "Business processes, functions, roles, and services.",
  security: "Authentication, authorization, security threats, and controls.",
  application: "Application components, services, and interactions.",
  technology: "Infrastructure, platforms, systems, and technology components.",
  api: "REST APIs, operations, endpoints, and API integrations.",
  "data-model": "Data entities, relationships, and data structure definitions.",
  "data-store": "Databases, data stores, and persistence mechanisms.",
  ux: "User interface components, screens, and user experience elements.",
  navigation: "Application routing, navigation flows, and page structures.",
  apm: "Observability, monitoring, metrics, logging, and tracing.",
  testing: "Test strategies, test cases, test data, and test coverage.",
};

/**
 * Escape markdown special characters
 */
export function escapeMarkdown(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert value to string for markdown display
 */
export function valueToMarkdown(value: unknown): string {
  if (typeof value === "string") return escapeMarkdown(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => valueToMarkdown(v)).join(", ")}]`;
  }
  if (value && typeof value === "object") {
    return `\`${escapeMarkdown(JSON.stringify(value))}\``;
  }
  return String(value);
}

/**
 * Get layer description by layer name
 */
export function getLayerDescription(layer: string): string {
  return LAYER_DESCRIPTIONS[layer] || "Architecture layer";
}
