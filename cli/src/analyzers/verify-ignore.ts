/**
 * Ignore file loader for verify operations
 *
 * Parses .dr-verify-ignore.yaml and provides pattern matching for routes/elements
 * to exclude from verification reports.
 */

import { readFile } from "fs/promises";
import yaml from "yaml";
import { minimatch } from "minimatch";

/**
 * A pattern within an ignore rule
 *
 * Each pattern object contains one or more matching criteria.
 */
export interface IgnorePattern {
  handler?: string;
  path?: string;
  element_ids?: string[];
}

/**
 * A single ignore rule from the ignore file
 *
 * Rules must specify:
 * - patterns: list of matching criteria (OR semantics - any match applies the rule)
 * - reason: explanation for why the rule exists
 * - match: scope of the rule (graph_only for routes, model_only for elements)
 */
export interface IgnoreRule {
  patterns: IgnorePattern[];
  reason: string;
  match: "graph_only" | "model_only";
}

/**
 * Loader for .dr-verify-ignore.yaml files
 *
 * Supports:
 * - Glob patterns for handler names (e.g., "*HealthHandler*")
 * - Exact matching for paths (e.g., "/health")
 * - Exact matching for element IDs (e.g., "api.operation.get-health")
 * - Bucket scoping via match field (graph_only for routes, model_only for elements)
 *
 * Expected YAML format:
 * ```yaml
 * version: 1
 * ignore:
 *   - patterns:
 *       - handler: "*HealthHandler*"
 *       - path: "/health"
 *     reason: "Health check endpoints"
 *     match: "graph_only"
 *   - patterns:
 *       - element_ids: ["api.operation.get-status"]
 *     reason: "Status endpoint ignored"
 *     match: "model_only"
 * ```
 */
export class IgnoreFileLoader {
  /**
   * Load ignore rules from a YAML file
   *
   * Returns an empty array if the file doesn't exist (no error).
   * Throws if the file exists but contains structural errors:
   * - Invalid YAML syntax
   * - Parsed YAML is not an object with version and ignore fields
   * - version != 1
   * - ignore is not an array
   * - Rule missing required fields (patterns, reason, match)
   * - Rule has unknown fields
   * - Pattern objects with unsupported fields
   * - Invalid match values
   *
   * @param filePath Path to the .dr-verify-ignore.yaml file
   * @returns Array of validated ignore rules
   * @throws Error on structural issues with the ignore file
   */
  static async load(filePath: string): Promise<IgnoreRule[]> {
    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = yaml.parse(content);

      // Validate schema: expect version 1 and an ignore array
      if (!parsed || typeof parsed !== "object") {
        throw new Error(
          "Invalid ignore file: expected an object with 'version' and 'ignore' fields"
        );
      }

      const { version, ignore } = parsed as { version?: number; ignore?: unknown[] };

      if (version !== 1) {
        throw new Error(
          `Invalid ignore file version: expected 1, got ${version ?? "missing"}`
        );
      }

      if (!Array.isArray(ignore)) {
        throw new Error(
          "Invalid ignore file: 'ignore' field must be an array of rules"
        );
      }

      // Validate and collect rules
      const rules: IgnoreRule[] = [];
      for (let i = 0; i < ignore.length; i++) {
        const ruleObj = ignore[i];

        // Validate rule is an object
        if (!ruleObj || typeof ruleObj !== "object") {
          throw new Error(
            `Rule at index ${i} is not an object`
          );
        }

        const rule = ruleObj as any;
        const reason = rule.reason as string | undefined;
        const match = rule.match as string | undefined;
        const patterns = rule.patterns as unknown[] | undefined;

        // Validate required fields
        if (!reason || typeof reason !== "string") {
          throw new Error(
            `Rule at index ${i} missing required field: 'reason' (must be a string)`
          );
        }

        if (!match || typeof match !== "string") {
          throw new Error(
            `Rule at index ${i} missing required field: 'match' (must be a string)`
          );
        }

        if (match !== "graph_only" && match !== "model_only") {
          throw new Error(
            `Rule at index ${i} has invalid 'match' value: '${match}' (must be 'graph_only' or 'model_only')`
          );
        }

        if (!Array.isArray(patterns)) {
          throw new Error(
            `Rule at index ${i} missing required field: 'patterns' (must be an array of pattern objects)`
          );
        }

        if (patterns.length === 0) {
          throw new Error(
            `Rule at index ${i} has empty 'patterns' array (must contain at least one pattern)`
          );
        }

        // Check for unknown fields at rule level
        const validRuleFields = new Set(["patterns", "reason", "match"]);
        for (const field of Object.keys(rule)) {
          if (!validRuleFields.has(field)) {
            throw new Error(
              `Rule at index ${i}: unknown field '${field}' (valid fields: patterns, reason, match)`
            );
          }
        }

        // Validate and normalize patterns
        const normalizedPatterns: IgnorePattern[] = [];
        for (let j = 0; j < patterns.length; j++) {
          const patternObj = patterns[j];

          if (!patternObj || typeof patternObj !== "object") {
            throw new Error(
              `Rule at index ${i}, pattern at index ${j} is not an object`
            );
          }

          const pattern = patternObj as any;
          const normalizedPattern: IgnorePattern = {};

          // Extract handler if present
          if ("handler" in pattern) {
            if (typeof pattern.handler !== "string") {
              throw new Error(
                `Rule at index ${i}, pattern at index ${j}: 'handler' must be a string`
              );
            }
            normalizedPattern.handler = pattern.handler;
          }

          // Extract path if present
          if ("path" in pattern) {
            if (typeof pattern.path !== "string") {
              throw new Error(
                `Rule at index ${i}, pattern at index ${j}: 'path' must be a string`
              );
            }
            normalizedPattern.path = pattern.path;
          }

          // Extract element_ids if present
          if ("element_ids" in pattern) {
            if (!Array.isArray(pattern.element_ids)) {
              throw new Error(
                `Rule at index ${i}, pattern at index ${j}: 'element_ids' must be an array`
              );
            }
            if (!pattern.element_ids.every((id: unknown) => typeof id === "string")) {
              throw new Error(
                `Rule at index ${i}, pattern at index ${j}: 'element_ids' must contain only strings`
              );
            }
            normalizedPattern.element_ids = pattern.element_ids;
          }

          // Check for unknown fields
          const validFields = new Set(["handler", "path", "element_ids"]);
          for (const field of Object.keys(pattern)) {
            if (!validFields.has(field)) {
              throw new Error(
                `Rule at index ${i}, pattern at index ${j}: unknown field '${field}' (valid fields: handler, path, element_ids)`
              );
            }
          }

          // At least one matching criterion must be present
          if (Object.keys(normalizedPattern).length === 0) {
            throw new Error(
              `Rule at index ${i}, pattern at index ${j} has no matching criteria (must have at least one of: handler, path, element_ids)`
            );
          }

          normalizedPatterns.push(normalizedPattern);
        }

        rules.push({
          patterns: normalizedPatterns,
          reason,
          match,
        });
      }

      return rules;
    } catch (error) {
      // File not found is expected (return empty rules, no error)
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return [];
      }

      // YAML parse errors and validation errors should be thrown
      throw error;
    }
  }

  /**
   * Check if an entry matches any ignore rule and return the matching rule's reason
   *
   * Only considers rules that apply to the specified entry type:
   * - "route" entries: only rules with match: "graph_only"
   * - "element" entries: only rules with match: "model_only"
   *
   * A rule matches if ANY of its patterns match (OR semantics within patterns).
   *
   * @param entry Object with optional handler, path, and element_id properties
   * @param type Type of entry ("route" for graph entries, "element" for model entries)
   * @param rules Array of ignore rules
   * @returns The reason string from the matched rule, or null if no match
   */
  static matches(
    entry: { handler?: string; path?: string; element_id?: string },
    type: "route" | "element",
    rules: IgnoreRule[]
  ): string | null {
    for (const rule of rules) {
      // Filter by match bucket type
      if (type === "route" && rule.match !== "graph_only") {
        continue;
      }
      if (type === "element" && rule.match !== "model_only") {
        continue;
      }

      // Check if any pattern in this rule matches (OR semantics)
      for (const pattern of rule.patterns) {
        // Check handler glob pattern
        if (pattern.handler && entry.handler) {
          if (minimatch(entry.handler, pattern.handler)) {
            return rule.reason;
          }
        }

        // Check path exact match
        if (pattern.path && entry.path) {
          if (entry.path === pattern.path) {
            return rule.reason;
          }
        }

        // Check element_ids exact match
        if (pattern.element_ids && entry.element_id) {
          if (pattern.element_ids.includes(entry.element_id)) {
            return rule.reason;
          }
        }
      }
    }

    return null;
  }
}
