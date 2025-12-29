/**
 * JSON Content Normalizer
 *
 * Normalizes JSON content for deterministic comparison across CLIs.
 * Handles:
 * - Parsing JSON and re-serializing with sorted keys
 * - Ensures alphabetical key ordering for deterministic comparison
 * - Pretty-prints with consistent spacing (2-space indent)
 */

/**
 * Recursively sort object keys alphabetically
 * Handles nested objects, arrays, and primitives
 *
 * @param obj Object to sort (or primitive/array)
 * @returns Sorted object with keys in alphabetical order
 */
function sortObjectKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    // For arrays, recursively sort contents
    return obj.map(sortObjectKeys);
  } else if (obj !== null && typeof obj === 'object') {
    // For objects, sort keys and recursively sort nested values
    return Object.keys(obj as Record<string, unknown>)
      .sort()
      .reduce((sorted, key) => {
        (sorted as Record<string, unknown>)[key] = sortObjectKeys(
          (obj as Record<string, unknown>)[key]
        );
        return sorted;
      }, {} as Record<string, unknown>);
  } else {
    // For primitives, return as-is
    return obj;
  }
}

/**
 * Normalize JSON content for deterministic comparison
 * Parses JSON, sorts all keys alphabetically, and pretty-prints with 2-space indent
 *
 * @param content Raw JSON string
 * @returns Normalized JSON with alphabetically sorted keys and 2-space indentation
 *
 * @example
 * const input = '{"zebra":"value","apple":"value"}';
 * const output = normalizeJSON(input);
 * // output will have apple before zebra with proper indentation
 *
 * @remarks
 * If the content is not valid JSON, returns original content unchanged.
 * This graceful degradation prevents crashes on malformed files.
 */
export function normalizeJSON(content: string): string {
  try {
    // Parse JSON to object
    const data = JSON.parse(content);

    // Recursively sort object keys
    const sorted = sortObjectKeys(data);

    // Serialize back to JSON with 2-space indentation
    return JSON.stringify(sorted, null, 2);
  } catch (_error) {
    // If parsing fails, return original
    // This allows graceful handling of non-JSON content
    return content;
  }
}
