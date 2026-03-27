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
import type { ScanConfig } from "./mcp-client.js";

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
  let fileConfig: Record<string, any> = {};
  const configPath = process.env.DR_CONFIG_PATH ?? join(homedir(), CONFIG_FILENAME);

  if (existsSync(configPath)) {
    try {
      const content = await readFile(configPath, "utf-8");
      const parsed = parse(content) as Record<string, any>;
      fileConfig = parsed?.scan ?? {};
    } catch (error) {
      // Provide specific error messages based on error type
      if (error instanceof Error) {
        const errorMsg = error.message;

        // File permission errors
        if (errorMsg.includes("EACCES") || errorMsg.includes("permission denied")) {
          process.stderr.write(
            `Error: Cannot read config file ${configPath} - permission denied\n`
          );
          process.stderr.write("Suggestions:\n");
          process.stderr.write(`  • Check file permissions with: ls -l ${configPath}\n`);
          process.stderr.write("  • Ensure you have read access to the file\n");
          process.stderr.write(`  • Try: chmod 644 ${configPath}\n`);
        }
        // YAML parse errors
        else if (
          errorMsg.includes("YAMLException") ||
          error.name === "YAMLException" ||
          errorMsg.includes("bad indentation") ||
          errorMsg.includes("unexpected")
        ) {
          process.stderr.write(`Error: Invalid YAML syntax in ${configPath}\n`);
          process.stderr.write(`Details: ${errorMsg}\n`);
          process.stderr.write("Suggestions:\n");
          process.stderr.write("  • Validate your YAML syntax at https://www.yamllint.com/\n");
          process.stderr.write("  • Check for proper indentation (use spaces, not tabs)\n");
          process.stderr.write("  • Verify colons have spaces after them\n");
        }
        // File encoding or other I/O errors
        else {
          process.stderr.write(`Error: Failed to load config file ${configPath}\n`);
          process.stderr.write(`Details: ${errorMsg}\n`);
          process.stderr.write("Suggestions:\n");
          process.stderr.write("  • Verify the file is valid UTF-8 encoded text\n");
          process.stderr.write("  • Check if the file system is accessible\n");
          process.stderr.write("  • Try recreating the file if it may be corrupted\n");
        }
        process.stderr.write(`Using default scan configuration due to config file error\n`);
      }
    }
  }

  // Merge file config and environment overrides into defaults
  const config: ScanConfig = {
    codeprism: {
      command: process.env.SCAN_CODEPRISM_COMMAND ?? fileConfig.codeprism?.command ?? defaults.codeprism?.command,
      args: fileConfig.codeprism?.args ?? defaults.codeprism?.args,
      timeout: fileConfig.codeprism?.timeout ?? defaults.codeprism?.timeout,
    },
    confidence_threshold:
      (!isNaN(parseFloat(process.env.SCAN_CONFIDENCE_THRESHOLD ?? ""))
        ? parseFloat(process.env.SCAN_CONFIDENCE_THRESHOLD!)
        : fileConfig.confidence_threshold) ?? defaults.confidence_threshold,
    disabled_patterns: fileConfig.disabled_patterns ?? defaults.disabled_patterns,
  };

  // Validate configuration
  validateScanConfig(config);

  return config;
}

/**
 * Validate scan configuration values
 *
 * @throws Error if configuration is invalid
 */
function validateScanConfig(config: ScanConfig): void {
  if (config.confidence_threshold !== undefined) {
    if (typeof config.confidence_threshold !== "number") {
      throw new Error("confidence_threshold must be a number");
    }
    if (config.confidence_threshold < 0 || config.confidence_threshold > 1) {
      throw new Error("confidence_threshold must be between 0.0 and 1.0");
    }
  }

  if (config.disabled_patterns !== undefined && !Array.isArray(config.disabled_patterns)) {
    throw new Error("disabled_patterns must be an array of strings");
  }
}
