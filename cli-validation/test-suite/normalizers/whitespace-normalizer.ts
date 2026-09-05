/**
 * Whitespace Normalizer
 *
 * Normalizes whitespace differences that don't affect semantic meaning.
 * Removes trailing spaces on each line and trailing newlines at end of file.
 *
 * This ensures that editors with different whitespace handling rules
 * don't cause spurious test failures.
 */

/**
 * Normalize whitespace in content
 * - Removes trailing whitespace from each line
 * - Removes trailing newlines at end of file
 *
 * @param content Raw content string potentially with trailing whitespace
 * @returns Content with trailing whitespace and newlines removed
 *
 * @example
 * const input = 'line1:  \\nline2:  \\n\\n';
 * const output = trimWhitespace(input);
 * // output: 'line1:\\nline2:'
 */
export function trimWhitespace(content: string): string {
  return content
    .split('\n')
    .map((line) => line.trimEnd()) // Remove trailing whitespace per line
    .join('\n')
    .trimEnd(); // Remove trailing newlines at end of file
}
