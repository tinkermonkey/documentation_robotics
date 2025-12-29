/**
 * YAML Content Normalizer
 *
 * Normalizes YAML content for deterministic comparison across CLIs.
 * Handles:
 * - Parsing YAML and re-serializing with sorted keys
 * - Ensures alphabetical key ordering for deterministic comparison
 * - Preserves semantic structure and data types
 */

import YAML from 'yaml';
import { sortObjectKeys } from './sort-keys';

/**
 * Normalize YAML content for deterministic comparison
 * Parses YAML, sorts all keys alphabetically, and serializes back
 *
 * @param content Raw YAML string
 * @returns Normalized YAML with alphabetically sorted keys
 *
 * @example
 * const input = `
 * zebra: value
 * apple: value
 * `;
 * const output = normalizeYAML(input);
 * // output will have apple before zebra
 *
 * @remarks
 * If the content is not valid YAML, returns original content unchanged.
 * This graceful degradation prevents crashes on malformed files.
 */
export function normalizeYAML(content: string): string {
  try {
    // Parse YAML to object
    const data = YAML.parse(content);

    // Recursively sort object keys
    const sorted = sortObjectKeys(data);

    // Serialize back to YAML with deterministic key ordering
    return YAML.stringify(sorted, {
      lineWidth: 0, // Prevent line wrapping that might differ between versions
    });
  } catch (_error) {
    // If parsing fails, return original
    // This allows graceful handling of non-YAML content
    return content;
  }
}
