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
