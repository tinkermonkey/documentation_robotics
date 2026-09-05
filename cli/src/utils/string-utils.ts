/**
 * String manipulation utilities for consistent formatting across CLI output
 */

/**
 * Truncates a string to a specified width, leaving room for padding
 * @param text - The text to truncate
 * @param width - The maximum width (reserves 1 character for padding)
 * @returns Truncated string padded to width
 */
export function truncateToWidth(text: string, width: number): string {
  const maxLength = width - 1;
  if (text.length >= width) {
    return text.substring(0, maxLength).padEnd(width);
  }
  return text.padEnd(width);
}

/**
 * Safely truncates text and returns the raw truncated value
 * @param text - The text to truncate
 * @param maxLength - Maximum number of characters to keep
 * @returns Truncated string
 */
export function safeTruncate(text: string, maxLength: number): string {
  if (text.length > maxLength) {
    return text.substring(0, maxLength - 1);
  }
  return text;
}
