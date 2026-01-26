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
 * Validate that a string is a valid URL with http: or https: protocol.
 * Returns true if valid, false otherwise.
 *
 * @param urlString - The string to validate as a URL
 * @returns true if valid URL with http/https protocol, false otherwise
 */
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    // Only accept http and https protocols
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

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
    } catch {
      // Gracefully handle parse errors and fall back to defaults
      console.warn(`Warning: Failed to parse ${configPath}, using defaults`);
    }
  }

  const otlp = fileConfig?.telemetry?.otlp;

  // Helper to check if env var is effectively set (not empty after trim)
  const getEnvVar = (value: string | undefined) => {
    return value !== undefined && value.trim().length > 0 ? value : undefined;
  };

  // Helper to validate URL and return if valid, undefined if invalid
  const getValidUrl = (url: string | undefined) => {
    if (!url) return undefined;
    const trimmed = url.trim();
    if (trimmed.length === 0) return undefined;
    if (!isValidUrl(trimmed)) {
      console.warn(`Warning: Invalid URL "${trimmed}" in OTLP configuration, using fallback`);
      return undefined;
    }
    return trimmed;
  };

  // Merge configuration with precedence: env vars > file config > defaults
  // Note: Empty or whitespace-only strings are treated as not set (fall back to next priority)
  // Invalid URLs are also rejected and fall back to next priority
  return {
    endpoint:
      getValidUrl(getEnvVar(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)) ??
      getValidUrl(otlp?.endpoint) ??
      defaults.endpoint,
    logsEndpoint:
      getValidUrl(getEnvVar(process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT)) ??
      getValidUrl(otlp?.logs_endpoint) ??
      defaults.logsEndpoint,
    serviceName:
      getEnvVar(process.env.OTEL_SERVICE_NAME) ??
      otlp?.service_name ??
      defaults.serviceName,
  };
}
