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
 * A single ignore rule from the ignore file
 */
export interface IgnoreRule {
  handler?: string;
  path?: string;
  element_ids?: string[];
  reason: string;
}

/**
 * Loader for .dr-verify-ignore.yaml files
 *
 * Supports:
 * - Glob patterns for handler names (e.g., "*HealthHandler*")
 * - Exact matching for paths (e.g., "/health")
 * - Exact matching for element IDs (e.g., "api.operation.get-health")
 */
export class IgnoreFileLoader {
  /**
   * Load ignore rules from a YAML file
   *
   * Returns an empty array if the file doesn't exist (no error).
   * Throws if the file exists but is malformed.
   *
   * @param filePath Path to the .dr-verify-ignore.yaml file
   * @returns Array of ignore rules
   */
  static async load(filePath: string): Promise<IgnoreRule[]> {
    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = yaml.parse(content);

      // Validate schema: expect version 1 and an ignore array
      if (!parsed || typeof parsed !== "object") {
        return [];
      }

      const { version, ignore } = parsed as { version?: number; ignore?: unknown[] };

      if (version !== 1) {
        // Silently ignore files with version != 1 (return empty rules)
        return [];
      }

      if (!Array.isArray(ignore)) {
        // Silently ignore files without ignore array
        return [];
      }

      // Validate and collect rules
      const rules: IgnoreRule[] = [];
      for (const rule of ignore) {
        if (!rule || typeof rule !== "object") {
          continue;
        }

        const ruleObj = rule as any;
        const reason = ruleObj.reason as string | undefined;

        if (!reason || typeof reason !== "string") {
          continue; // Skip rules without a reason
        }

        rules.push({
          handler: typeof ruleObj.handler === "string" ? ruleObj.handler : undefined,
          path: typeof ruleObj.path === "string" ? ruleObj.path : undefined,
          element_ids: Array.isArray(ruleObj.element_ids) ? ruleObj.element_ids : undefined,
          reason,
        });
      }

      return rules;
    } catch (error) {
      // File not found is expected (return empty rules, no error)
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return [];
      }

      // Other errors should be thrown (malformed YAML, permission issues, etc.)
      throw error;
    }
  }

  /**
   * Check if an entry matches any ignore rule and return the matching rule's reason
   *
   * @param entry Object with optional handler, path, and element_id properties
   * @param _type Type of entry ("route" or "element" for context)
   * @param rules Array of ignore rules
   * @returns The reason string from the matched rule, or null if no match
   */
  static matches(
    entry: { handler?: string; path?: string; element_id?: string },
    _type: "route" | "element",
    rules: IgnoreRule[]
  ): string | null {
    for (const rule of rules) {
      // Check handler glob pattern
      if (rule.handler && entry.handler) {
        if (minimatch(entry.handler, rule.handler)) {
          return rule.reason;
        }
      }

      // Check path exact match
      if (rule.path && entry.path) {
        if (entry.path === rule.path) {
          return rule.reason;
        }
      }

      // Check element_ids exact match
      if (rule.element_ids && entry.element_id) {
        if (rule.element_ids.includes(entry.element_id)) {
          return rule.reason;
        }
      }
    }

    return null;
  }
}
