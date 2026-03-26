/**
 * Pattern Loader for Built-in and Project-Specific Pattern Files
 *
 * Loads curated pattern definition files that map CodePrism AST query results
 * to DR layer node types and relationships.
 *
 * Pattern files are YAML documents that declare:
 * - Target DR layer and element type
 * - CodePrism query/tool invocation
 * - Confidence score for matches
 * - Template-based ID and attribute mapping
 *
 * @example
 * ```typescript
 * const builtinPatterns = await loadBuiltinPatterns();
 * const projectPatterns = await loadProjectPatterns(projectRoot);
 * const merged = mergePatterns(builtinPatterns, projectPatterns);
 * const filtered = filterByConfidence(merged, confidenceThreshold);
 * ```
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

/**
 * Query specification for CodePrism MCP tools
 */
export const QuerySpecSchema = z.object({
  tool: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type QuerySpec = z.infer<typeof QuerySpecSchema>;

/**
 * Target element specification
 *
 * Note: `elementType` values (e.g., "endpoint", "dependency", "protection") are not validated
 * against spec layer node types in this schema. Validation occurs when candidates are processed
 * into actual DR elements. This allows patterns to declare structural intent independently of
 * the current spec version, avoiding coupling between pattern definitions and spec evolution.
 * A future enhancement could add optional spec-aware validation via a registry lookup.
 */
export const ProducesSchema = z.object({
  type: z.enum(["node", "relationship"]),
  layer: z.string(),
  elementType: z.string(),
  relationshipType: z.string().optional(),
});

export type Produces = z.infer<typeof ProducesSchema>;

/**
 * Template-based mapping for element ID and attributes
 *
 * Templates support:
 * - {match.*} - Access match properties (e.g., {match.decoratorArg})
 * - Kebab-case transformation: {match.className|kebab}
 * - Uppercase transformation: {match.method|upper}
 */
export const MappingSchema = z.record(z.string(), z.union([z.string(), z.record(z.string(), z.string())]));

export type Mapping = Record<string, string | Record<string, string>>;

/**
 * Individual pattern definition within a pattern set
 */
export const PatternDefinitionSchema = z.object({
  id: z.string(),
  produces: ProducesSchema,
  query: QuerySpecSchema,
  confidence: z.number().min(0).max(1),
  mapping: MappingSchema,
});

export type PatternDefinition = z.infer<typeof PatternDefinitionSchema>;

/**
 * Pattern set file representing patterns for a specific framework or concern
 */
export const PatternSetSchema = z.object({
  layer: z.string(),
  framework: z.string(),
  version: z.string().optional(),
  patterns: z.array(PatternDefinitionSchema),
});

export type PatternSet = z.infer<typeof PatternSetSchema>;

/**
 * Match result from CodePrism query execution
 *
 * Contains extracted data from AST query that can be used in template mapping.
 */
export interface PatternMatch {
  patternId: string;
  confidence: number;
  data: Record<string, any>;
  source?: {
    file: string;
    line?: number;
    column?: number;
  };
}

/**
 * Element candidate produced from a pattern match
 *
 * Contains all information needed to create or update an architecture element.
 */
export interface ElementCandidate {
  id: string;
  type: string;
  layer: string;
  name: string;
  confidence: number;
  attributes: Record<string, any>;
  source?: {
    file: string;
    line?: number;
    column?: number;
  };
}

/**
 * Load all built-in pattern files from the CLI package
 *
 * Pattern files are embedded in the CLI distribution at cli/src/scan/patterns/
 * and compiled into the final package. This function requires no configuration
 * from the user and always returns the same set of patterns.
 *
 * Dynamically discovers all *.yaml files under the patterns/ directory tree,
 * with no hardcoded file list required.
 *
 * @returns Array of pattern sets for all built-in frameworks and concerns
 * @throws Error if pattern files are missing or invalid YAML/schema
 *
 * @example
 * ```typescript
 * const patterns = await loadBuiltinPatterns();
 * console.log(`Loaded ${patterns.length} pattern sets`);
 * ```
 */
export async function loadBuiltinPatterns(): Promise<PatternSet[]> {
  // Get the directory containing this file
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const patternsDir = join(currentDir, "patterns");

  const patterns: PatternSet[] = [];

  // Recursively discover all .yaml files
  // Simple recursive walker using async fs API for consistency
  async function walkDir(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkDir(fullPath)));
      } else if (entry.name.endsWith(".yaml")) {
        files.push(fullPath);
      }
    }

    return files;
  }

  const patternFiles = await walkDir(patternsDir);

  if (patternFiles.length === 0) {
    throw new Error("No pattern files found. Check that the patterns/ directory exists and contains YAML files.");
  }

  for (const fullPath of patternFiles) {
    try {
      const content = await readFile(fullPath, "utf-8");
      const parsed = parse(content);

      // Validate against pattern set schema
      const patternSet = PatternSetSchema.parse(parsed);
      patterns.push(patternSet);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const messages = error.issues.map((issue) => `${issue.path.join(".")} - ${issue.message}`).join("; ");
        throw new Error(`Invalid pattern file ${fullPath}: ${messages}`);
      } else if (error instanceof Error && error.message.includes("ENOENT")) {
        throw new Error(`Pattern file not found: ${fullPath}`);
      } else {
        throw new Error(
          `Failed to load pattern file ${fullPath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  return patterns;
}

/**
 * Load pattern files from a project-specific directory
 *
 * Allows users to extend built-in patterns with project-specific pattern definitions.
 * Pattern files are discovered from `{projectRoot}/documentation-robotics/.scan-patterns/`.
 * Project patterns follow the same schema as built-in patterns and can override
 * built-in patterns with matching IDs via mergePatterns().
 *
 * Not required for basic functionality (built-in patterns are sufficient).
 * If the directory doesn't exist, returns an empty array.
 *
 * @param projectRoot - Root directory to search for pattern files
 * @param patternDir - Subdirectory within projectRoot (default: documentation-robotics/.scan-patterns)
 * @returns Array of pattern sets from project, or empty array if directory doesn't exist
 * @throws PatternValidationError if a project pattern file fails schema validation
 *
 * @example
 * ```typescript
 * const projectPatterns = await loadProjectPatterns(process.cwd());
 * ```
 */
export async function loadProjectPatterns(
  projectRoot: string,
  patternDir: string = "documentation-robotics/.scan-patterns"
): Promise<PatternSet[]> {
  const fullPath = join(projectRoot, patternDir);

  // Check if directory exists
  try {
    const stat = await readdir(fullPath, { withFileTypes: true });
    if (!stat || stat.length === 0) {
      return [];
    }
  } catch (error) {
    // ENOENT = directory doesn't exist, which is fine
    if (error instanceof Error && error.message.includes("ENOENT")) {
      return [];
    }
    // Other errors (permissions, etc.) should be thrown
    throw error;
  }

  const patterns: PatternSet[] = [];

  // Recursively discover all .yaml files
  async function walkDir(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkDir(entryPath)));
      } else if (entry.name.endsWith(".yaml")) {
        files.push(entryPath);
      }
    }

    return files;
  }

  const patternFiles = await walkDir(fullPath);

  // Load each pattern file, with detailed error reporting
  for (const filePath of patternFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = parse(content);

      // Validate against pattern set schema
      const patternSet = PatternSetSchema.parse(parsed);
      patterns.push(patternSet);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const messages = error.issues.map((issue) => `${issue.path.join(".")} - ${issue.message}`).join("; ");
        throw new Error(`Invalid project pattern file ${filePath}: ${messages}`);
      } else if (error instanceof Error && error.message.includes("ENOENT")) {
        throw new Error(`Project pattern file not found: ${filePath}`);
      } else {
        throw new Error(
          `Failed to load project pattern file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  return patterns;
}

/**
 * Merge builtin and project patterns
 *
 * Merges patterns with the following semantics:
 * - Start with all builtin patterns
 * - For each project pattern: if its ID matches a builtin pattern ID, replace it (override)
 * - Otherwise append the project pattern (new project-only frameworks/patterns)
 * - Merged set enforces pattern ID uniqueness
 *
 * Pattern ID uniqueness is enforced within the merged set. Duplicate IDs across
 * project patterns (same ID appearing in multiple project frameworks) are treated as errors.
 *
 * @param builtin - Built-in pattern sets
 * @param project - Project-specific pattern sets
 * @returns Merged array of pattern sets with override semantics applied
 * @throws Error if pattern IDs are not unique after merging
 *
 * @example
 * ```typescript
 * const builtinPatterns = await loadBuiltinPatterns();
 * const projectPatterns = await loadProjectPatterns(cwd);
 * const merged = mergePatterns(builtinPatterns, projectPatterns);
 * ```
 */
export function mergePatterns(builtin: PatternSet[], project: PatternSet[]): PatternSet[] {
  // Map of pattern ID to its definition for override detection
  // Also track which builtin pattern IDs exist
  const patternIdMap = new Map<string, PatternDefinition>();
  const builtinPatternIds = new Set<string>();

  // First pass: index all builtin patterns by ID
  for (const patternSet of builtin) {
    for (const pattern of patternSet.patterns) {
      patternIdMap.set(pattern.id, pattern);
      builtinPatternIds.add(pattern.id);
    }
  }

  // Second pass: index project patterns and apply overrides
  // Track which non-builtin project pattern IDs we've seen to catch duplicates
  const seenProjectOnlyIds = new Set<string>();

  for (const projectSet of project) {
    for (const pattern of projectSet.patterns) {
      const isBuiltinPattern = builtinPatternIds.has(pattern.id);

      // Check for duplicate IDs within project patterns (only for new/non-builtin patterns)
      if (!isBuiltinPattern && seenProjectOnlyIds.has(pattern.id)) {
        throw new Error(`Duplicate pattern ID after merge: ${pattern.id}`);
      }

      // Track this project-only ID
      if (!isBuiltinPattern) {
        seenProjectOnlyIds.add(pattern.id);
      }

      // Override builtin pattern if it exists, or add new pattern
      patternIdMap.set(pattern.id, pattern);
    }
  }

  // Third pass: rebuild pattern sets maintaining framework structure
  const resultSets: PatternSet[] = [];
  const processedFrameworks = new Set<string>();

  // Process builtin pattern sets first (maintain order)
  for (const builtinSet of builtin) {
    const setKey = `${builtinSet.framework}:${builtinSet.version || "default"}`;
    processedFrameworks.add(setKey);

    // Collect patterns for this framework (may include overrides from project)
    const mergedPatterns = builtinSet.patterns
      .map((p) => patternIdMap.get(p.id))
      .filter((p): p is PatternDefinition => p !== undefined);

    if (mergedPatterns.length > 0) {
      resultSets.push({
        ...builtinSet,
        patterns: mergedPatterns,
      });
    }
  }

  // Then add project frameworks that don't have a builtin counterpart
  for (const projectSet of project) {
    const setKey = `${projectSet.framework}:${projectSet.version || "default"}`;
    if (!processedFrameworks.has(setKey)) {
      resultSets.push(projectSet);
      processedFrameworks.add(setKey);
    }
  }

  return resultSets;
}

/**
 * Filter pattern matches by confidence threshold
 *
 * Removes any candidate whose confidence is below the threshold.
 * Used to discard low-confidence matches before they appear in output.
 *
 * @param candidates - Element candidates to filter
 * @param threshold - Confidence threshold (0.0-1.0, default 0.7)
 * @returns Candidates with confidence >= threshold
 *
 * @example
 * ```typescript
 * const allCandidates = await executePatterns(patterns, codebaseRoot);
 * const highConfidence = filterByConfidence(allCandidates, 0.7);
 * ```
 */
export function filterByConfidence(
  candidates: ElementCandidate[],
  threshold: number = 0.7
): ElementCandidate[] {
  if (threshold < 0 || threshold > 1) {
    throw new Error("Confidence threshold must be between 0.0 and 1.0");
  }

  return candidates.filter((candidate) => candidate.confidence >= threshold);
}

/**
 * Extract properties from template string
 *
 * Supports transformations:
 * - {match.field} - Direct field access
 * - {match.field|kebab} - Convert to kebab-case
 * - {match.field|upper} - Convert to UPPERCASE
 *
 * @param template - Template string with placeholders
 * @param data - Data object for substitution
 * @returns Rendered string
 *
 * @example
 * ```typescript
 * const id = renderTemplate("api.endpoint.{match.name|kebab}", { match: { name: "CreateUser" } });
 * // => "api.endpoint.create-user"
 * ```
 */
export function renderTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{([^}]+)\}/g, (match, key) => {
    const [path, ...transforms] = key.split("|");
    const parts = path.split(".");
    let value: any = data;

    // Navigate the object path
    for (const part of parts) {
      if (value === null || value === undefined) {
        return match;
      }
      value = value[part];
    }

    if (value === null || value === undefined) {
      return match;
    }

    // Apply transformations
    let result = String(value);
    for (const transform of transforms) {
      const t = transform.trim().toLowerCase();
      if (t === "kebab") {
        result = result
          .replace(/([a-z0-9])([A-Z])/g, "$1-$2") // camelCase to kebab-case
          .replace(/[_\s]+/g, "-") // underscores and spaces to hyphens
          .replace(/^-+|-+$/g, "") // remove leading/trailing hyphens
          .toLowerCase();
      } else if (t === "upper") {
        result = result.toUpperCase();
      } else if (t === "lower") {
        result = result.toLowerCase();
      }
    }

    return result;
  });
}
