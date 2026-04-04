/**
 * Markdown link text utilities
 */

/**
 * Format node type name for display by splitting on capital letters and title-casing
 * @param type The node type string (e.g., "CustomEndpoint")
 * @returns Formatted display name (e.g., "Custom Endpoint")
 */
function formatNodeTypeName(type: string): string {
  return type
    .split(/(?=[A-Z])/)
    .join(" ")
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Create descriptive link text that avoids markdownlint MD059 prohibited texts
 * Prohibited texts: "click here", "here", "link", "more"
 * @param type The node type to create link text for
 * @returns Descriptive link text safe for markdownlint MD059
 */
export function createDescriptiveLinkText(type: string): string {
  const prohibited = ["click here", "here", "link", "more"];
  const formatted = formatNodeTypeName(type);

  if (prohibited.includes(formatted.toLowerCase())) {
    // Add "node" suffix to make it descriptive
    return `${formatted} node`;
  }

  return formatted;
}
