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

import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { join } from 'node:path';

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

const CONFIG_FILENAME = '.dr-config.yaml';

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
    endpoint: 'http://localhost:4318/v1/traces',
    logsEndpoint: 'http://localhost:4318/v1/logs',
    serviceName: 'dr-cli',
  };

  // Load file configuration (Priority 2)
  let fileConfig: DRConfig = {};
  // Support DR_CONFIG_PATH override for testing; default to ~/.dr-config.yaml
  const configPath = process.env.DR_CONFIG_PATH ?? join(homedir(), CONFIG_FILENAME);

  if (existsSync(configPath)) {
    try {
      const content = await readFile(configPath, 'utf-8');
      fileConfig = parse(content) as DRConfig;
    } catch (error) {
      // Provide specific error messages based on error type
      if (error instanceof Error) {
        const errorMsg = error.message;

        // File permission errors
        if (errorMsg.includes('EACCES') || errorMsg.includes('permission denied')) {
          console.error(`Error: Cannot read config file ${configPath} - permission denied`);
          console.error('Suggestions:');
          console.error('  • Check file permissions with: ls -l ${configPath}');
          console.error('  • Ensure you have read access to the file');
          console.error('  • Try: chmod 644 ${configPath}');
        }
        // YAML parse errors
        else if (errorMsg.includes('YAMLException') || error.name === 'YAMLException' || errorMsg.includes('bad indentation') || errorMsg.includes('unexpected')) {
          console.error(`Error: Invalid YAML syntax in ${configPath}`);
          console.error(`Details: ${errorMsg}`);
          console.error('Suggestions:');
          console.error('  • Validate your YAML syntax at https://www.yamllint.com/');
          console.error('  • Check for proper indentation (use spaces, not tabs)');
          console.error('  • Verify colons have spaces after them');
        }
        // File encoding or other I/O errors
        else {
          console.error(`Error: Failed to load config file ${configPath}`);
          console.error(`Details: ${errorMsg}`);
          console.error('Suggestions:');
          console.error('  • Verify the file is valid UTF-8 encoded text');
          console.error('  • Check if the file system is accessible');
          console.error('  • Try recreating the file if it may be corrupted');
        }
        console.warn(`Using default OTLP configuration due to config file error`);
      } else {
        console.warn(`Warning: Failed to parse ${configPath}, using defaults`);
      }
    }
  }

  const otlp = fileConfig?.telemetry?.otlp;

  // Helper to check if env var is effectively set (not empty after trim)
  const getEnvVar = (value: string | undefined) => {
    return value !== undefined && value.trim().length > 0 ? value : undefined;
  };

  // Helper to validate URL and return if valid, undefined if invalid
  const getValidUrl = (url: string | undefined, fieldName: string = 'URL') => {
    if (!url) return undefined;
    const trimmed = url.trim();
    if (trimmed.length === 0) return undefined;

    try {
      const parsedUrl = new URL(trimmed);

      // Only accept http and https protocols
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        console.error(`Error: Invalid protocol "${parsedUrl.protocol}" in ${fieldName}`);
        console.error(`  Provided: ${trimmed}`);
        console.error(`  Expected: URL must start with http:// or https://`);
        console.error(`  Using fallback configuration for this field`);
        return undefined;
      }

      return trimmed;
    } catch (error) {
      console.error(`Error: Invalid URL in ${fieldName}: "${trimmed}"`);
      if (error instanceof Error) {
        console.error(`  Reason: ${error.message}`);
      }
      console.error('Suggestions:');
      console.error('  • Ensure URL starts with http:// or https://');
      console.error('  • Check for typos in hostname');
      console.error('  • Verify port number if specified (e.g., :4318)');
      console.error('  • Example: http://localhost:4318/v1/traces');
      console.error(`  Using fallback configuration for this field`);
      return undefined;
    }
  };

  // Merge configuration with precedence: env vars > file config > defaults
  // Note: Empty or whitespace-only strings are treated as not set (fall back to next priority)
  // Invalid URLs are also rejected and fall back to next priority
  return {
    endpoint:
      getValidUrl(getEnvVar(process.env.OTEL_EXPORTER_OTLP_ENDPOINT), 'OTEL_EXPORTER_OTLP_ENDPOINT') ??
      getValidUrl(otlp?.endpoint, 'telemetry.otlp.endpoint') ??
      defaults.endpoint,
    logsEndpoint:
      getValidUrl(getEnvVar(process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT), 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT') ??
      getValidUrl(otlp?.logs_endpoint, 'telemetry.otlp.logs_endpoint') ??
      defaults.logsEndpoint,
    serviceName:
      getEnvVar(process.env.OTEL_SERVICE_NAME) ??
      otlp?.service_name ??
      defaults.serviceName,
  };
}
