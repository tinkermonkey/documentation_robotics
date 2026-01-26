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
  const configPath = join(homedir(), CONFIG_FILENAME);

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

  // Merge configuration with precedence: env vars > file config > defaults
  // Note: Empty or whitespace-only strings are treated as not set (fall back to next priority)
  return {
    endpoint:
      getEnvVar(process.env.OTEL_EXPORTER_OTLP_ENDPOINT) ??
      otlp?.endpoint ??
      defaults.endpoint,
    logsEndpoint:
      getEnvVar(process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT) ??
      otlp?.logs_endpoint ??
      defaults.logsEndpoint,
    serviceName:
      getEnvVar(process.env.OTEL_SERVICE_NAME) ??
      otlp?.service_name ??
      defaults.serviceName,
  };
}
