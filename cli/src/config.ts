/**
 * Shared DR CLI configuration loader
 *
 * Reads and writes `~/.dr-config.yaml` (overridable via DR_CONFIG_PATH, primarily for
 * tests). This is the single source of truth for the config file's shape and I/O —
 * feature-specific loaders (telemetry, MCP, ...) should read their section from the
 * object returned by `loadDRConfig()` rather than parsing the file themselves.
 *
 * Configuration file format (~/.dr-config.yaml):
 * ```yaml
 * telemetry:
 *   otlp:
 *     endpoint: 'http://localhost:4318/v1/traces'
 * mcp:
 *   api_key_path: '/home/user/.dr-mcp-key'
 * ```
 */

import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";

/**
 * Configuration structure parsed from ~/.dr-config.yaml
 */
export interface DRConfig {
  telemetry?: {
    otlp?: {
      endpoint?: string;
      logs_endpoint?: string;
      service_name?: string;
    };
  };
  mcp?: {
    api_key_path?: string;
  };
}

const CONFIG_FILENAME = ".dr-config.yaml";

/**
 * Resolve the path to the DR config file.
 * Supports DR_CONFIG_PATH override for testing; defaults to ~/.dr-config.yaml.
 */
export function getDRConfigPath(): string {
  return process.env.DR_CONFIG_PATH ?? join(homedir(), CONFIG_FILENAME);
}

/**
 * Load the DR config file, returning an empty object if it does not exist or
 * cannot be parsed. Errors are reported to stderr but never thrown, since a
 * malformed config file should degrade to defaults rather than crash the CLI.
 */
export async function loadDRConfig(): Promise<DRConfig> {
  const configPath = getDRConfigPath();

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = parse(content);
    return (parsed ?? {}) as DRConfig;
  } catch (error) {
    reportConfigLoadError(configPath, error);
    return {};
  }
}

/**
 * Persist the given config object to the DR config file, creating the parent
 * directory if necessary. Callers are responsible for merging with any existing
 * config (typically via `loadDRConfig()`) before calling this.
 */
export async function saveDRConfig(config: DRConfig): Promise<void> {
  const configPath = getDRConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, stringify(config), "utf-8");
}

function reportConfigLoadError(configPath: string, error: unknown): void {
  if (!(error instanceof Error)) {
    process.stderr.write(`Warning: Failed to parse ${configPath}, using defaults\n`);
    return;
  }

  const errorMsg = error.message;

  if (errorMsg.includes("EACCES") || errorMsg.includes("permission denied")) {
    process.stderr.write(`Error: Cannot read config file ${configPath} - permission denied\n`);
    process.stderr.write("Suggestions:\n");
    process.stderr.write(`  • Check file permissions with: ls -l ${configPath}\n`);
    process.stderr.write("  • Ensure you have read access to the file\n");
    process.stderr.write(`  • Try: chmod 644 ${configPath}\n`);
  } else if (
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
  } else {
    process.stderr.write(`Error: Failed to load config file ${configPath}\n`);
    process.stderr.write(`Details: ${errorMsg}\n`);
    process.stderr.write("Suggestions:\n");
    process.stderr.write("  • Verify the file is valid UTF-8 encoded text\n");
    process.stderr.write("  • Check if the file system is accessible\n");
    process.stderr.write("  • Try recreating the file if it may be corrupted\n");
  }
  process.stderr.write(`Using default configuration due to config file error\n`);
}
