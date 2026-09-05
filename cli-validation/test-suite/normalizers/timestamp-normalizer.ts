/**
 * Timestamp Normalizer
 *
 * Strips ISO-8601 timestamps from content to enable deterministic comparison
 * across CLIs that may generate output at different times.
 *
 * Patterns matched:
 * - 2025-12-29T10:30:45.123456Z (UTC with microseconds)
 * - 2025-12-29T10:30:45Z (UTC)
 * - 2025-12-29T10:30:45+02:00 (With timezone offset)
 * - 2025-12-29T10:30:45.123456+02:00 (With milliseconds and offset)
 */

/**
 * ISO-8601 timestamp pattern that matches:
 * - YYYY-MM-DDTHH:MM:SS with optional milliseconds
 * - Optional timezone (Z or ±HH:MM)
 */
const ISO8601_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g;

/**
 * Strip ISO-8601 timestamps from content
 * Replaces all ISO-8601 formatted timestamps with a placeholder
 *
 * @param content Raw content string potentially containing timestamps
 * @returns Content with all ISO-8601 timestamps replaced with <TIMESTAMP>
 *
 * @example
 * const input = 'updated_at: 2025-12-29T10:30:45.123456Z';
 * const output = stripTimestamps(input);
 * // output: 'updated_at: <TIMESTAMP>'
 */
export function stripTimestamps(content: string): string {
  return content.replace(ISO8601_PATTERN, '<TIMESTAMP>');
}
