/**
 * Content Normalization Pipeline
 *
 * Orchestrates the application of multiple normalizers in a defined order
 * to prepare content for deterministic comparison across CLIs.
 *
 * Pipeline Order (important):
 * 1. stripTimestamps - Remove ISO-8601 timestamps (least destructive)
 * 2. canonicalizePaths - Normalize path separators (OS-independent)
 * 3. sortYamlKeys / sortJsonKeys - Canonicalize key ordering
 * 4. trimWhitespace - Clean up trailing spaces (most destructive)
 */

import { stripTimestamps } from './timestamp-normalizer';
import { canonicalizePaths } from './path-normalizer';
import { normalizeYAML } from './yaml-normalizer';
import { normalizeJSON } from './json-normalizer';
import { trimWhitespace } from './whitespace-normalizer';

/**
 * File type enumeration for content normalization
 */
export enum FileType {
  YAML = 'yaml',
  JSON = 'json',
  TEXT = 'text',
  UNKNOWN = 'unknown',
}

/**
 * Normalizer function type
 * Takes content and file type, returns normalized content
 */
type Normalizer = (content: string, fileType: FileType) => string;

/**
 * Format-specific normalizers applied based on file type
 */
const FORMAT_NORMALIZERS: Record<FileType, Normalizer[]> = {
  [FileType.YAML]: [
    // YAML-specific normalizations
    (content, _) => normalizeYAML(content),
  ],
  [FileType.JSON]: [
    // JSON-specific normalizations
    (content, _) => normalizeJSON(content),
  ],
  [FileType.TEXT]: [
    // Text files: no special formatting
  ],
  [FileType.UNKNOWN]: [
    // Unknown files: no special formatting
  ],
};

/**
 * Main normalization pipeline
 * Applies normalizers in a specific order to ensure correct behavior:
 * 1. Timestamp stripping (all formats)
 * 2. Path canonicalization (all formats)
 * 3. Format-specific normalizers (YAML/JSON key sorting)
 * 4. Whitespace trimming (all formats)
 *
 * @param content Raw content to normalize
 * @param fileType Type of file being normalized
 * @returns Normalized content suitable for comparison
 */
export function normalize(content: string, fileType: FileType): string {
  // Apply universal normalizers (non-format-specific)
  let normalized = stripTimestamps(content);
  normalized = canonicalizePaths(normalized);

  // Apply format-specific normalizers
  const formatNormalizers = FORMAT_NORMALIZERS[fileType] || [];
  for (const normalizer of formatNormalizers) {
    normalized = normalizer(normalized, fileType);
  }

  // Apply post-processing normalizers
  normalized = trimWhitespace(normalized);

  return normalized;
}

/**
 * Detect file type from file path
 * Uses extension-based detection
 *
 * @param filePath Path to the file (can be relative or absolute)
 * @returns Detected FileType
 *
 * @example
 * detectFileType('manifest.yaml')      // FileType.YAML
 * detectFileType('data.json')          // FileType.JSON
 * detectFileType('README.md')          // FileType.TEXT
 * detectFileType('unknown.xyz')        // FileType.UNKNOWN
 */
export function detectFileType(filePath: string): FileType {
  const lowerPath = filePath.toLowerCase();

  if (lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')) {
    return FileType.YAML;
  }
  if (lowerPath.endsWith('.json')) {
    return FileType.JSON;
  }
  if (
    lowerPath.endsWith('.md') ||
    lowerPath.endsWith('.txt') ||
    lowerPath.endsWith('.xml') ||
    lowerPath.endsWith('.html')
  ) {
    return FileType.TEXT;
  }

  return FileType.UNKNOWN;
}

/**
 * Normalize content with automatic file type detection
 * Convenience function that detects file type from path and applies normalization
 *
 * @param content Raw content to normalize
 * @param filePath Path to the file (for type detection)
 * @returns Normalized content
 *
 * @example
 * const normalized = normalizeContent(content, 'src/model/manifest.yaml');
 */
export function normalizeContent(content: string, filePath: string): string {
  const fileType = detectFileType(filePath);
  return normalize(content, fileType);
}

// Re-export individual normalizers for testing purposes
export { stripTimestamps } from './timestamp-normalizer';
export { canonicalizePaths } from './path-normalizer';
export { normalizeYAML } from './yaml-normalizer';
export { normalizeJSON } from './json-normalizer';
export { trimWhitespace } from './whitespace-normalizer';
