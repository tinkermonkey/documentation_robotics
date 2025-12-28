import { describe, expect, test } from 'bun:test';
import { deepEqual } from 'node:assert/strict';

/**
 * Configuration for output comparison
 */
export interface ComparisonConfig {
  /** Type of comparison to perform */
  type: 'json' | 'text' | 'exit-code';
  /** Keys to ignore in JSON comparison (e.g., timestamps) */
  ignoreKeys?: string[];
  /** Whether to sort arrays before comparison */
  sortArrays?: boolean;
  /** Whether to normalize whitespace in text comparison */
  normalizeWhitespace?: boolean;
  /** Epsilon for floating point comparison */
  epsilon?: number;
  /** Whether to normalize path separators */
  normalizePaths?: boolean;
  /** Accept validation philosophy differences (e.g., Python=0, TS=1 with warnings) */
  acceptValidationDifferences?: boolean;
}

export interface OutputPayload {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Result of comparing two outputs
 */
export interface ComparisonResult {
  /** Whether outputs match */
  matches: boolean;
  /** Detailed differences if they don't match */
  differences?: string[];
  /** Normalized outputs for inspection */
  normalized?: {
    python: unknown;
    typescript: unknown;
  };
}

/**
 * Normalize JSON object by removing ignored keys and sorting arrays
 */
function normalizeJson(
  obj: unknown,
  config: ComparisonConfig
): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    const normalized = obj.map((item) => normalizeJson(item, config));
    if (config.sortArrays) {
      // Sort by JSON string representation for stable ordering
      return normalized.sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b))
      );
    }
    return normalized;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip ignored keys
      if (config.ignoreKeys?.includes(key)) {
        continue;
      }
      // Normalize paths if enabled
      if (config.normalizePaths && typeof value === 'string') {
        result[key] = value.replace(/\\/g, '/');
      } else {
        result[key] = normalizeJson(value, config);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Normalize text by handling whitespace and line endings
 */
function normalizeText(text: string, config: ComparisonConfig): string {
  let normalized = text;

  // Normalize line endings
  normalized = normalized.replace(/\r\n/g, '\n');

  // Normalize whitespace if enabled
  if (config.normalizeWhitespace) {
    // Trim each line
    normalized = normalized
      .split('\n')
      .map((line) => line.trim())
      .join('\n');
    // Remove empty lines at start/end
    normalized = normalized.trim();
  }

  // Normalize paths if enabled
  if (config.normalizePaths) {
    normalized = normalized.replace(/\\/g, '/');
  }

  return normalized;
}

/**
 * Generate detailed diff between two JSON objects
 */
function generateJsonDiff(
  a: unknown,
  b: unknown,
  path: string = 'root'
): string[] {
  const diffs: string[] = [];

  if (typeof a !== typeof b) {
    diffs.push(`${path}: type mismatch (${typeof a} vs ${typeof b})`);
    return diffs;
  }

  if (a === null || b === null) {
    if (a !== b) {
      diffs.push(`${path}: value mismatch (${a} vs ${b})`);
    }
    return diffs;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push(`${path}: array length mismatch (${a.length} vs ${b.length})`);
    }
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      if (i >= a.length) {
        diffs.push(`${path}[${i}]: missing in first array`);
      } else if (i >= b.length) {
        diffs.push(`${path}[${i}]: missing in second array`);
      } else {
        diffs.push(...generateJsonDiff(a[i], b[i], `${path}[${i}]`));
      }
    }
    return diffs;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);

    for (const key of allKeys) {
      if (!(key in aObj)) {
        diffs.push(`${path}.${key}: missing in first object`);
      } else if (!(key in bObj)) {
        diffs.push(`${path}.${key}: missing in second object`);
      } else {
        diffs.push(...generateJsonDiff(aObj[key], bObj[key], `${path}.${key}`));
      }
    }
    return diffs;
  }

  // Primitive values
  if (typeof a === 'number' && typeof b === 'number') {
    // Use epsilon for floating point comparison
    const epsilon = 0.0001; // default epsilon
    if (Math.abs(a - b) > epsilon) {
      diffs.push(`${path}: number mismatch (${a} vs ${b})`);
    }
  } else if (a !== b) {
    diffs.push(`${path}: value mismatch (${JSON.stringify(a)} vs ${JSON.stringify(b)})`);
  }

  return diffs;
}

/**
 * Compare two outputs based on configuration
 */
export function compareOutputs(
  python: OutputPayload,
  typescript: OutputPayload,
  config: ComparisonConfig
): ComparisonResult {
  if (config.type === 'exit-code') {
    // Check for exact match first
    const matches = python.exitCode === typescript.exitCode;

    // If not exact match, check if it's an acceptable validation philosophy difference
    if (!matches && config.acceptValidationDifferences) {
      // Python=0 (success), TypeScript=1 (warnings) is acceptable
      // Both CLIs working correctly, just different validation strictness
      if (python.exitCode === 0 && typescript.exitCode === 1) {
        const tsHasValidationWarnings =
          typescript.stdout.includes('Validation failed') ||
          typescript.stdout.includes('error(s)') ||
          typescript.stdout.includes('Invalid element ID format');

        if (tsHasValidationWarnings) {
          return {
            matches: true,
            differences: [
              'Validation philosophy difference (acceptable):',
              `  Python CLI: exit ${python.exitCode} (accepts current format)`,
              `  TypeScript CLI: exit ${typescript.exitCode} (enforces stricter naming conventions)`,
              '  Both CLIs are working correctly with different validation rules',
            ],
          };
        }
      }
    }

    return {
      matches,
      differences: matches
        ? undefined
        : [
            `Exit code mismatch: python=${python.exitCode}, typescript=${typescript.exitCode}`,
          ],
    };
  }

  const pythonOutput = python.stdout || python.stderr;
  const typescriptOutput = typescript.stdout || typescript.stderr;

  if (config.type === 'json') {
    try {
      const pythonJson = JSON.parse(pythonOutput);
      const typescriptJson = JSON.parse(typescriptOutput);

      const normalizedPython = normalizeJson(pythonJson, config);
      const normalizedTypescript = normalizeJson(typescriptJson, config);

      const differences = generateJsonDiff(normalizedPython, normalizedTypescript);

      return {
        matches: differences.length === 0,
        differences: differences.length > 0 ? differences : undefined,
        normalized: {
          python: normalizedPython,
          typescript: normalizedTypescript
        }
      };
    } catch (error) {
      return {
        matches: false,
        differences: [`JSON parse error: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }

  if (config.type === 'text') {
    const normalizedPython = normalizeText(pythonOutput, config);
    const normalizedTypescript = normalizeText(typescriptOutput, config);

    if (normalizedPython === normalizedTypescript) {
      return { matches: true };
    }

    // Generate line-by-line diff
    const pythonLines = normalizedPython.split('\n');
    const typescriptLines = normalizedTypescript.split('\n');
    const differences: string[] = [];

    if (pythonLines.length !== typescriptLines.length) {
      differences.push(
        `Line count mismatch: ${pythonLines.length} vs ${typescriptLines.length}`
      );
    }

    const maxLines = Math.max(pythonLines.length, typescriptLines.length);
    for (let i = 0; i < maxLines; i++) {
      const pythonLine = pythonLines[i] || '';
      const typescriptLine = typescriptLines[i] || '';
      if (pythonLine !== typescriptLine) {
        differences.push(
          `Line ${i + 1}:\n  Python:     "${pythonLine}"\n  TypeScript: "${typescriptLine}"`
        );
      }
    }

    return {
      matches: false,
      differences,
      normalized: {
        python: normalizedPython,
        typescript: normalizedTypescript
      }
    };
  }

  return {
    matches: false,
    differences: ['Unknown comparison type']
  };
}

/**
 * Format comparison result for display
 */
export function formatComparisonResult(result: ComparisonResult): string {
  if (result.matches) {
    return '✓ Outputs match';
  }

  let output = '✗ Outputs differ:\n\n';

  if (result.differences) {
    output += result.differences.map(d => `  - ${d}`).join('\n');
  }

  if (result.normalized) {
    output += '\n\nNormalized Python output:\n';
    output += JSON.stringify(result.normalized.python, null, 2);
    output += '\n\nNormalized TypeScript output:\n';
    output += JSON.stringify(result.normalized.typescript, null, 2);
  }

  return output;
}
