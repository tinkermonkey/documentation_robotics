/**
 * Telemetry Detection
 *
 * Determines if the CLI was built with telemetry (OTLP sender) enabled
 * and if telemetry is configured via ~/.dr-config.yaml.
 * This is a build-time constant that gets dead-code eliminated in production builds.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { join } from "node:path";
import { homedir } from "node:os";

// Declare TELEMETRY_ENABLED as a build-time constant (substituted by esbuild)
declare const TELEMETRY_ENABLED: boolean;

/**
 * Check if the CLI was built with telemetry enabled
 * @returns true if telemetry is enabled, false otherwise
 */
export function isTelemetryBuiltIn(): boolean {
  return typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;
}

/**
 * Check if telemetry is configured via ~/.dr-config.yaml
 * @returns true if config file exists with telemetry.otlp section, false otherwise
 */
export async function isTelemetryConfigured(): Promise<boolean> {
  const configPath = process.env.DR_CONFIG_PATH ?? join(homedir(), ".dr-config.yaml");

  if (!existsSync(configPath)) {
    return false;
  }

  try {
    const content = await readFile(configPath, "utf-8");
    const config = parse(content) as any;

    // Check if config has telemetry.otlp.endpoint (minimum required)
    return !!(config?.telemetry?.otlp?.endpoint);
  } catch {
    return false;
  }
}
