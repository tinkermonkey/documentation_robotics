/**
 * Global type declarations for Documentation Robotics CLI
 */

/**
 * Build-time telemetry constant injected by esbuild via the `define` option.
 * - In production builds: TELEMETRY_ENABLED = false (all telemetry code eliminated)
 * - In debug builds: TELEMETRY_ENABLED = true (telemetry code included)
 *
 * Used to conditionally include OpenTelemetry instrumentation code that is
 * completely eliminated from production bundles via dead code elimination.
 */
declare const TELEMETRY_ENABLED: boolean;
