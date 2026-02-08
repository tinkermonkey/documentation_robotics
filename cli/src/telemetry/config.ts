/**
 * OTLP Configuration Loader
 *
 * Loads and merges OTLP configuration from multiple sources with the following precedence:
 * 1. Environment variables (highest priority)
 * 2. ~/.dr-config.yaml file configuration
 * 3. Hard-coded defaults (lowest priority)
 *
 * Configuration file format (~/.dr-config.yaml):
 * ```yaml
 * telemetry:
 *   otlp:
 *     endpoint: 'http://localhost:4318/v1/traces'
 *     logs_endpoint: 'http://localhost:4318/v1/logs'
 *     service_name: 'dr-cli'
 * ```
 */

import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { join } from "node:path";

/**
 * Configuration structure parsed from ~/.dr-config.yaml
 */
interface DRConfig {
  telemetry?: {
    otlp?: {
      endpoint?: string;
      logs_endpoint?: string;
      service_name?: string;
    };
  };
}

/**
 * Resolved OTLP configuration with all required fields
 */
export interface OTLPConfig {
  endpoint: string;
  logsEndpoint: string;
  serviceName: string;
}

const CONFIG_FILENAME = ".dr-config.yaml";

/**
 * Load OTLP configuration from multiple sources.
 *
 * Configuration precedence (each field resolved independently):
 * 1. Environment variables (OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, OTEL_SERVICE_NAME)
 * 2. File configuration (~/.dr-config.yaml)
 * 3. Hard-coded defaults
 *
 * All endpoint URLs are validated. Invalid URLs are treated as not set and fall back to next priority.
 *
 * @returns Resolved OTLP configuration with all required fields
 *
 * @example
 * ```typescript
 * const config = await loadOTLPConfig();
 * console.log(config.endpoint); // 'http://localhost:4318/v1/traces' (or from env/file)
 * ```
 */
export async function loadOTLPConfig(): Promise<OTLPConfig> {
  // Hard-coded defaults (Priority 3)
  const defaults: OTLPConfig = {
    endpoint: "http://localhost:4318/v1/traces",
    logsEndpoint: "http://localhost:4318/v1/logs",
    serviceName: "dr-cli",
  };

  // Load file configuration (Priority 2)
  let fileConfig: DRConfig = {};
  // Support DR_CONFIG_PATH override for testing; default to ~/.dr-config.yaml
  const configPath = process.env.DR_CONFIG_PATH ?? join(homedir(), CONFIG_FILENAME);

  if (existsSync(configPath)) {
    try {
      const content = await readFile(configPath, "utf-8");
      fileConfig = parse(content) as DRConfig;
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
          process.stderr.write("  • Check file permissions with: ls -l ${configPath}\n");
          process.stderr.write("  • Ensure you have read access to the file\n");
          process.stderr.write("  • Try: chmod 644 ${configPath}\n");
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
        process.stderr.write(`Using default OTLP configuration due to config file error\n`);
      } else {
        process.stderr.write(`Warning: Failed to parse ${configPath}, using defaults\n`);
      }
    }
  }

  const otlp = fileConfig?.telemetry?.otlp;

  // Helper to check if env var is effectively set (not empty after trim)
  const getEnvVar = (value: string | undefined) => {
    return value !== undefined && value.trim().length > 0 ? value : undefined;
  };

  // Helper to validate URL and return if valid, undefined if invalid
  const getValidUrl = (url: string | undefined, fieldName: string = "URL") => {
    if (!url) return undefined;
    const trimmed = url.trim();
    if (trimmed.length === 0) return undefined;

    try {
      const parsedUrl = new URL(trimmed);

      // Only accept http and https protocols
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        process.stderr.write(`Error: Invalid protocol "${parsedUrl.protocol}" in ${fieldName}\n`);
        process.stderr.write(`  Provided: ${trimmed}\n`);
        process.stderr.write(`  Expected: URL must start with http:// or https://\n`);
        process.stderr.write(`  Using fallback configuration for this field\n`);
        return undefined;
      }

      return trimmed;
    } catch (error) {
      process.stderr.write(`Error: Invalid URL in ${fieldName}: "${trimmed}"\n`);
      if (error instanceof Error) {
        process.stderr.write(`  Reason: ${error.message}\n`);
      }
      process.stderr.write("Suggestions:\n");
      process.stderr.write("  • Ensure URL starts with http:// or https://\n");
      process.stderr.write("  • Check for typos in hostname\n");
      process.stderr.write("  • Verify port number if specified (e.g., :4318)\n");
      process.stderr.write("  • Example: http://localhost:4318/v1/traces\n");
      process.stderr.write(`  Using fallback configuration for this field\n`);
      return undefined;
    }
  };

  // Merge configuration with precedence: env vars > file config > defaults
  // Note: Empty or whitespace-only strings are treated as not set (fall back to next priority)
  // Invalid URLs are also rejected and fall back to next priority
  return {
    endpoint:
      getValidUrl(
        getEnvVar(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
        "OTEL_EXPORTER_OTLP_ENDPOINT"
      ) ??
      getValidUrl(otlp?.endpoint, "telemetry.otlp.endpoint") ??
      defaults.endpoint,
    logsEndpoint:
      getValidUrl(
        getEnvVar(process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT),
        "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"
      ) ??
      getValidUrl(otlp?.logs_endpoint, "telemetry.otlp.logs_endpoint") ??
      defaults.logsEndpoint,
    serviceName:
      getEnvVar(process.env.OTEL_SERVICE_NAME) ?? otlp?.service_name ?? defaults.serviceName,
  };
}
