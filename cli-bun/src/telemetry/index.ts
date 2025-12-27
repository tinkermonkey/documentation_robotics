/**
 * OpenTelemetry instrumentation module.
 *
 * This module wraps OpenTelemetry SDK initialization and provides span creation utilities.
 * It is completely no-op when TELEMETRY_ENABLED is false, allowing complete elimination
 * of telemetry code from production bundles via dead code elimination.
 *
 * Pattern: All telemetry function calls must be directly guarded by `if (TELEMETRY_ENABLED)` checks
 * in calling code to enable tree-shaking and zero-cost abstractions in production builds.
 */

import type { Span } from '@opentelemetry/api';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import type { Tracer } from '@opentelemetry/api';

// Module-level state: SDK and tracer instances
// Only initialized when TELEMETRY_ENABLED is true
let sdk: NodeSDK | null = null;
let tracer: Tracer | null = null;

/**
 * Initialize OpenTelemetry SDK. Must be called before creating spans.
 * No-op when TELEMETRY_ENABLED is false.
 *
 * Initializes NodeSDK with:
 * - Service name: "dr-cli"
 * - Span processor: SimpleSpanProcessor (ensures synchronous export on shutdown)
 * - Exporter: ResilientOTLPExporter (circuit-breaker pattern for graceful failure)
 *
 * The exporter targets http://localhost:4318/v1/traces by default,
 * configurable via OTEL_EXPORTER_OTLP_ENDPOINT environment variable.
 */
export function initTelemetry(): void {
  if (TELEMETRY_ENABLED) {
    // Dynamic imports ensure tree-shaking when TELEMETRY_ENABLED is false
    // These imports are completely eliminated from production builds
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
    const { trace } = require('@opentelemetry/api');
    const { ResilientOTLPExporter } = require('./resilient-exporter');

    // Create resilient exporter with circuit-breaker pattern
    const exporter = new ResilientOTLPExporter({
      url:
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
        'http://localhost:4318/v1/traces',
      timeoutMillis: 500,
    });

    // Initialize NodeSDK with SimpleSpanProcessor for immediate export
    const nodeSdk = new NodeSDK({
      serviceName: 'dr-cli',
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    // Start the SDK
    nodeSdk.start();
    sdk = nodeSdk;

    // Get tracer instance for span creation
    tracer = trace.getTracer('dr-cli');
  }
}

/**
 * Create and start a new span with the given name and optional attributes.
 * Returns null when telemetry is disabled.
 *
 * Must be called within an `if (TELEMETRY_ENABLED)` guard in calling code:
 *
 * ```typescript
 * if (TELEMETRY_ENABLED) {
 *   const span = startSpan('operation', { 'attr.key': 'value' });
 *   try {
 *     // ... operation ...
 *   } finally {
 *     endSpan(span);
 *   }
 * }
 * ```
 */
export function startSpan(
  name: string,
  attributes?: Record<string, any>
): Span | null {
  if (TELEMETRY_ENABLED && tracer) {
    return tracer.startSpan(name, { attributes });
  }
  return null;
}

/**
 * End a span. Safe to call with null (no-op).
 *
 * Should be called in a finally block to ensure proper cleanup:
 *
 * ```typescript
 * const span = startSpan('operation');
 * try {
 *   // ... operation ...
 * } finally {
 *   endSpan(span);
 * }
 * ```
 */
export function endSpan(span: Span | null): void {
  if (TELEMETRY_ENABLED && span) {
    span.end();
  }
}

/**
 * Shutdown the OpenTelemetry SDK gracefully.
 * Should be called on process exit to ensure all pending spans are exported.
 *
 * Ignores shutdown failures to avoid blocking process exit.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (TELEMETRY_ENABLED && sdk) {
    try {
      await sdk.shutdown();
    } catch {
      // Silently ignore shutdown failures - don't block process exit
    }
  }
}

/**
 * Re-export ResilientOTLPExporter for advanced use cases and testing.
 *
 * This allows users to:
 * - Unit test the circuit-breaker logic directly
 * - Create custom exporter configurations
 * - Inspect the exporter behavior in debug scenarios
 *
 * Note: Import is dynamic inside TELEMETRY_ENABLED guard in initTelemetry().
 * For direct imports, you may need to import from './resilient-exporter.ts'.
 */
export { ResilientOTLPExporter } from './resilient-exporter';
