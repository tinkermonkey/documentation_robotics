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
import type { LoggerProvider } from '@opentelemetry/sdk-logs';
import type { Logger } from '@opentelemetry/api-logs';

// Fallback for runtime environments where TELEMETRY_ENABLED is not defined by esbuild
// This ensures tests and non-bundled code don't crash
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;

// Module-level state: SDK and tracer instances
// Only initialized when TELEMETRY_ENABLED is true
let sdk: NodeSDK | null = null;
let tracer: Tracer | null = null;

// Module-level state for logging
// Only initialized when TELEMETRY_ENABLED is true
let loggerProvider: LoggerProvider | null = null;
let logger: Logger | null = null;

/**
 * Initialize OpenTelemetry SDK. Must be called before creating spans.
 * No-op when TELEMETRY_ENABLED is false.
 *
 * Initializes both trace and log providers with:
 * - Service name: "dr-cli"
 * - Span processor: SimpleSpanProcessor (ensures synchronous export on shutdown)
 * - Exporter: ResilientOTLPExporter for traces, ResilientLogExporter for logs
 * - Circuit-breaker pattern for graceful failure
 * - Project context from manifest (if available)
 *
 * Trace exporter targets http://localhost:4320/v1/traces by default.
 * Log exporter targets http://localhost:4320/v1/logs by default.
 * Both configurable via OTEL_EXPORTER_OTLP_ENDPOINT environment variable.
 * Log endpoint can be overridden via OTEL_EXPORTER_OTLP_LOGS_ENDPOINT.
 */
export async function initTelemetry(modelPath?: string): Promise<void> {
  if (isTelemetryEnabled) {
    // Dynamic imports ensure tree-shaking when TELEMETRY_ENABLED is false
    // These imports are completely eliminated from production builds
    const [
      { NodeSDK },
      { SimpleSpanProcessor },
      { trace },
      { ResilientOTLPExporter },
      { LoggerProvider, SimpleLogRecordProcessor },
      { ResilientLogExporter },
      { Resource },
      packageJson
    ] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/sdk-trace-base'),
      import('@opentelemetry/api'),
      import('./resilient-exporter.js'),
      import('@opentelemetry/sdk-logs'),
      import('./resilient-log-exporter.js'),
      import('@opentelemetry/resources'),
      import('../../package.json', { with: { type: 'json' } }).then(m => m.default)
    ]);

    // Get CLI version from package.json
    const cliVersion = packageJson.version;

    // Attempt to load project name from manifest
    let projectName = 'unknown';
    try {
      const [{ default: path }, { default: fs }] = await Promise.all([
        import('path'),
        import('fs')
      ]);
      const manifestPath = modelPath
        ? path.join(modelPath, '.dr', 'manifest.json')
        : path.join(process.cwd(), '.dr', 'manifest.json');

      if (fs.existsSync(manifestPath)) {
        const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestContent);
        projectName = manifest.name || 'unknown';
      }
    } catch {
      // No manifest found or unable to parse - use 'unknown'
    }

    // Create resource with service and project attributes
    const resource = new Resource({
      'service.name': process.env.OTEL_SERVICE_NAME || 'dr-cli',
      'service.version': cliVersion,
      'dr.project.name': projectName,
    });

    // Create resilient trace exporter with circuit-breaker pattern
    const traceExporter = new ResilientOTLPExporter({
      url:
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
        'http://localhost:4320/v1/traces',
      timeoutMillis: 500,
    });

    // Initialize NodeSDK with SimpleSpanProcessor for immediate export
    const nodeSdk = new NodeSDK({
      serviceName: 'dr-cli',
      spanProcessor: new SimpleSpanProcessor(traceExporter),
      resource,
    });

    // Start the SDK
    nodeSdk.start();
    sdk = nodeSdk;

    // Get tracer instance for span creation
    tracer = trace.getTracer('dr-cli', cliVersion);

    // Initialize log provider
    const logEndpoint =
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
      (process.env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/v1\/traces$/, '/v1/logs')
        : 'http://localhost:4320/v1/logs');

    const logExporter = new ResilientLogExporter({
      url: logEndpoint,
      timeoutMillis: 500,
    });

    loggerProvider = new LoggerProvider({
      resource,
    });

    loggerProvider!.addLogRecordProcessor(new SimpleLogRecordProcessor(logExporter));

    // Get logger instance
    logger = loggerProvider!.getLogger('dr-cli', cliVersion);
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
  if (isTelemetryEnabled && tracer) {
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
  if (isTelemetryEnabled && span) {
    span.end();
  }
}

/**
 * Emit a log record with optional severity level and attributes.
 *
 * Automatically attaches traceId and spanId from the active span context (if present).
 * Safe to call when telemetry is disabled (no-op).
 *
 * ```typescript
 * if (TELEMETRY_ENABLED) {
 *   const { SeverityNumber } = require('@opentelemetry/api-logs');
 *   emitLog(SeverityNumber.INFO, 'Operation started', { operation: 'my-op' });
 * }
 * ```
 */
export async function emitLog(
  severity: number,
  message: string,
  attributes?: Record<string, any>
): Promise<void> {
  if (!isTelemetryEnabled || !logger) return;

  const { trace } = await import('@opentelemetry/api');

  const span = trace.getActiveSpan();
  const context = span?.spanContext();

  logger.emit({
    severityNumber: severity,
    body: message,
    attributes: {
      ...attributes,
      ...(context && {
        'trace.id': context.traceId,
        'span.id': context.spanId,
      }),
    },
  });
}

/**
 * Shutdown the OpenTelemetry SDK gracefully.
 * Should be called on process exit to ensure all pending spans are exported.
 *
 * Ignores shutdown failures to avoid blocking process exit.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (isTelemetryEnabled) {
    try {
      await sdk?.shutdown();
    } catch {
      // Silently ignore shutdown failures - don't block process exit
    }

    try {
      await loggerProvider?.shutdown();
    } catch {
      // Silently ignore shutdown failures - don't block process exit
    }
  }
}
