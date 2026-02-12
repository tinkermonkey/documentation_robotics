/**
 * Shared markdown utilities for exporters
 */

/**
 * Layer descriptions for documentation
 */
export const LAYER_DESCRIPTIONS = {
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
 * Escape markdown special characters for safe display in markdown documents
 *
 * Escapes the following characters:
 * - `\` → `\\` (backslash: prevents escape sequences)
 * - `|` → `\|` (pipe: prevents table syntax interpretation)
 * - `*` → `\*` (asterisk: prevents bold/italic formatting)
 * - `[` → `\[` (bracket: prevents link syntax)
 * - `]` → `\]` (bracket: prevents link syntax)
 * - `{` → `\{` (brace: prevents code interpolation)
 * - `}` → `\}` (brace: prevents code interpolation)
 * - `<` → `&lt;` (less-than: HTML entity for safety)
 * - `>` → `&gt;` (greater-than: HTML entity for safety)
 *
 * Note: Backticks (`) and underscores (_) are intentionally NOT escaped to allow
 * inline code and emphasis formatting in natural text output.
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
 * Convert any value to a safely escaped string representation for markdown display
 *
 * Handles different types with type-specific formatting:
 * - **Strings**: Fully escaped via escapeMarkdown() to prevent markdown interpretation
 * - **Numbers**: Rendered as plain numeric strings (no formatting needed)
 * - **Booleans**: Rendered as "true" or "false" strings
 * - **Arrays**: Rendered as `[item1, item2, ...]` with recursive escaping of elements
 * - **Objects**: Rendered as inline code block with JSON stringification: `{...}`
 * - **Null/Undefined**: Rendered as string representation
 */
export function valueToMarkdown(value: unknown): string {
  if (typeof value === "string") return escapeMarkdown(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => valueToMarkdown(v)).join(", ")}]`;
  }
  if (value && typeof value === "object") {
    return `\`${JSON.stringify(value)}\``;
  }
  return String(value);
}

/**
 * Get layer description by layer name
 */
export function getLayerDescription(layer: string): string {
  return LAYER_DESCRIPTIONS[layer] || "Architecture layer";
}
