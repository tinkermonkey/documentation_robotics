/**
 * Path Normalizer
 *
 * Normalizes filesystem paths to enable deterministic comparison across
 * different operating systems (Windows, macOS, Linux).
 *
 * Converts Windows-style backslashes to Unix-style forward slashes,
 * ensuring consistent path representation regardless of the OS.
 */

/**
 * Canonicalize filesystem paths to Unix-style
 * Converts all backslashes to forward slashes.
 *
 * @param content Raw content string potentially containing Windows-style paths
 * @returns Content with all Windows-style paths converted to Unix-style
 *
 * @example
 * const input = 'path: C:\\Users\\test\\model\\file.yaml';
 * const output = canonicalizePaths(input);
 * // output: 'path: C:/Users/test/model/file.yaml'
 */
export function canonicalizePaths(content: string): string {
  // Replace all backslashes with forward slashes
  return content.replace(/\\/g, '/');
}
