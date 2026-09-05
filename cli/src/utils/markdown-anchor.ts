/**
 * Markdown anchor utilities for heading links
 */

/**
 * Create a markdown anchor from text by converting to lowercase and replacing non-alphanumeric characters with hyphens
 * @param text The text to convert to an anchor
 * @returns Anchor string suitable for markdown heading links
 */
export function createAnchor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
