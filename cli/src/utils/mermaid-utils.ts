/**
 * Mermaid diagram utilities
 */

/**
 * Sanitize text for use as a Mermaid diagram node ID
 * Replaces all non-alphanumeric characters with underscores
 * @param text The text to sanitize
 * @returns Sanitized ID safe for use in Mermaid diagrams
 */
export function sanitizeMermaidId(text: string): string {
  return text.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Escape special characters for use in Mermaid diagram labels
 *
 * Mermaid labels use double quotes as delimiters, so we escape:
 * - `"` → `\"` (double quote: the label delimiter)
 * - `\` → `\\` (backslash: prevents unintended escape sequences)
 *
 * Note: Unlike markdown, Mermaid renders special chars like |, *, [, ], {, } literally
 * (they don't need escaping), so we don't escape them. Using escapeMarkdown() on Mermaid
 * labels would produce visual artifacts like \| and \{ in the diagram.
 *
 * @param text The text to escape for use in a Mermaid label
 * @returns Escaped text safe for use in Mermaid diagram node/edge labels
 */
export function escapeMermaidLabel(text: string): string {
  return text
    .replace(/\\/g, "\\\\")  // Escape backslash first to avoid double-escaping
    .replace(/"/g, '\\"');   // Escape double quotes (label delimiter)
}
