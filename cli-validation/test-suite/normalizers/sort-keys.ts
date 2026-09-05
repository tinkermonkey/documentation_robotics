/**
 * Utility for recursively sorting object keys
 *
 * Used by both YAML and JSON normalizers to ensure consistent
 * alphabetical key ordering across all nesting levels.
 */

/**
 * Recursively sort object keys alphabetically
 * Handles nested objects, arrays, and primitives
 *
 * @param obj Object to sort (or primitive/array)
 * @returns Sorted object with keys in alphabetical order
 */
export function sortObjectKeys(obj: unknown): unknown {
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
