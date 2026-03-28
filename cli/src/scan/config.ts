/**
 * Scan Configuration Loader
 *
 * Loads and validates scan configuration from ~/.dr-config.yaml under the `scan:` key.
 *
 * Configuration structure:
 * ```yaml
 * scan:
 *   codeprism:
 *     command: codeprism      # CodePrism binary or path
 *     args: [--mcp]           # MCP server args
 *     timeout: 5000           # Connection timeout in ms
 *   confidence_threshold: 0.6 # Pattern matching confidence (0.0-1.0)
 *   disabled_patterns: []     # Pattern set names to skip
 * ```
 *
 * Supports environment variable override for testing:
 * - `DR_CONFIG_PATH` - Override default ~/.dr-config.yaml location
 * - `SCAN_CODEPRISM_COMMAND` - Override CodePrism command
 * - `SCAN_CONFIDENCE_THRESHOLD` - Override confidence threshold
 */

import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { join } from "node:path";
import { ScanConfigSchema, type ScanConfig } from "./mcp-client.js";

const CONFIG_FILENAME = ".dr-config.yaml";

/**
 * Load and validate scan configuration
 *
 * Configuration precedence:
 * 1. Environment variables (highest priority)
 * 2. ~/.dr-config.yaml `scan:` section
 * 3. Hard-coded defaults (lowest priority)
 *
 * @returns Validated scan configuration
 * @throws Error if configuration is invalid
 *
 * @example
 * ```typescript
 * const config = await loadScanConfig();
 * const client = await createMcpClient(config);
 * ```
 */
export async function loadScanConfig(): Promise<ScanConfig> {
  // Hard-coded defaults
  const defaults: ScanConfig = {
    codeprism: {
      command: "codeprism",
      args: ["--mcp"],
      timeout: 5000,
    },
    confidence_threshold: 0.7,
    disabled_patterns: [],
  };

  // Load file configuration
  let fileConfig: Record<string, unknown> = {};
  const configPath = process.env.DR_CONFIG_PATH ?? join(homedir(), CONFIG_FILENAME);

  if (existsSync(configPath)) {
    try {
      const content = await readFile(configPath, "utf-8");
      const parsed = parse(content) as Record<string, unknown>;
      fileConfig = (parsed?.scan ?? {}) as Record<string, unknown>;
    } catch (error) {
      // Build detailed error message for specific error types
      let errorMessage = "";
      let suggestions: string[] = [];

      if (error instanceof Error) {
        const errorMsg = error.message;

        // File permission errors
        if (errorMsg.includes("EACCES") || errorMsg.includes("permission denied")) {
          errorMessage = `Cannot read config file ${configPath} - permission denied`;
          suggestions = [
            `Check file permissions with: ls -l ${configPath}`,
            "Ensure you have read access to the file",
            `Try: chmod 644 ${configPath}`,
          ];
        }
        // YAML parse errors
        else if (
          errorMsg.includes("YAMLException") ||
          error.name === "YAMLException" ||
          errorMsg.includes("bad indentation") ||
          errorMsg.includes("unexpected")
        ) {
          errorMessage = `Invalid YAML syntax in ${configPath}: ${errorMsg}`;
          suggestions = [
            "Validate your YAML syntax at https://www.yamllint.com/",
            "Check for proper indentation (use spaces, not tabs)",
            "Verify colons have spaces after them",
          ];
        }
        // File encoding or other I/O errors
        else {
          errorMessage = `Failed to load config file ${configPath}: ${errorMsg}`;
          suggestions = [
            "Verify the file is valid UTF-8 encoded text",
            "Check if the file system is accessible",
            "Try recreating the file if it may be corrupted",
          ];
        }
      } else {
        errorMessage = `Unknown error reading config file ${configPath}`;
        suggestions = ["Check the config file for issues"];
      }

      const suggestionBlock = suggestions.length > 0
        ? `\n\nSuggestions:\n${suggestions.map((s) => `  • ${s}`).join("\n")}`
        : "";
      throw new Error(`${errorMessage}${suggestionBlock}`);
    }
  }

  // Merge file config and environment overrides into defaults
  const fileCodeprism = fileConfig.codeprism as Record<string, unknown> | undefined;
  const rawConfig: unknown = {
    codeprism: {
      command: process.env.SCAN_CODEPRISM_COMMAND ?? (fileCodeprism?.command as string | undefined) ?? defaults.codeprism?.command,
      args: (fileCodeprism?.args as string[] | undefined) ?? defaults.codeprism?.args,
      timeout: (fileCodeprism?.timeout as number | undefined) ?? defaults.codeprism?.timeout,
    },
    confidence_threshold:
      (!isNaN(parseFloat(process.env.SCAN_CONFIDENCE_THRESHOLD ?? ""))
        ? parseFloat(process.env.SCAN_CONFIDENCE_THRESHOLD!)
        : (fileConfig.confidence_threshold as number | undefined)) ?? defaults.confidence_threshold,
    disabled_patterns: (fileConfig.disabled_patterns as string[] | undefined) ?? defaults.disabled_patterns,
  };

  // Validate configuration on raw data before typing
  const config = validateScanConfig(rawConfig);

  return config;
}

/**
 * Validate raw scan configuration data using Zod schema
 *
 * @param rawConfig - Unvalidated configuration data from file/env
 * @returns Validated ScanConfig with correct types
 * @throws Error if configuration is invalid
 */
function validateScanConfig(rawConfig: unknown): ScanConfig {
  const result = ScanConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    // Build user-friendly error messages
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join(".");

      // Provide more helpful messages for common validation failures
      if (path === "confidence_threshold" && issue.code === "too_big") {
        return "confidence_threshold must be between 0.0 and 1.0";
      }
      if (path === "confidence_threshold" && issue.code === "too_small") {
        return "confidence_threshold must be between 0.0 and 1.0";
      }
      if (path === "codeprism.timeout" && issue.code === "too_small") {
        return "codeprism.timeout must be a positive number";
      }

      return `${path}: ${issue.message}`;
    });

    throw new Error(`Invalid scan configuration: ${errors.join("; ")}`);
  }

  return result.data;
}
