/**
 * Telemetry Detection
 *
 * Determines if the CLI was built with telemetry (OTLP sender) enabled.
 * This is a build-time constant that gets dead-code eliminated in production builds.
 */

// Declare TELEMETRY_ENABLED as a build-time constant (substituted by esbuild)
declare const TELEMETRY_ENABLED: boolean;

/**
 * Check if the CLI was built with telemetry enabled
 * @returns true if telemetry is enabled, false otherwise
 */
export function isTelemetryBuiltIn(): boolean {
  return typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;
}
