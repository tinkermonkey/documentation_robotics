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
import type { Logger as OTelLogger } from '@opentelemetry/api-logs';

// Fallback for runtime environments where TELEMETRY_ENABLED is not defined by esbuild
// This ensures tests and non-bundled code don't crash
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;

// Module-level state: SDK and tracer instances
// Only initialized when TELEMETRY_ENABLED is true
let sdk: NodeSDK | null = null;
let tracer: Tracer | null = null;
let loggerProvider: any = null;  // LoggerProvider type
let logger: OTelLogger | null = null;

/**
 * Initialize OpenTelemetry SDK. Must be called before creating spans.
 * No-op when TELEMETRY_ENABLED is false.
 *
 * Initializes both TracerProvider and LoggerProvider with:
 * - Service name: "dr-cli"
 * - Service version: from package.json
 * - Project name: from model manifest (if available)
 * - Processors: SimpleSpanProcessor and SimpleLogRecordProcessor
 * - Exporters: ResilientOTLPExporter with circuit-breaker pattern
 *
 * The exporters target http://localhost:4318/v1/traces and /v1/logs by default,
 * configurable via OTEL_EXPORTER_OTLP_ENDPOINT environment variable.
 * Log endpoint can be overridden with OTEL_EXPORTER_OTLP_LOGS_ENDPOINT.
 */
export function initTelemetry(): void {
  if (isTelemetryEnabled) {
    // Dynamic imports ensure tree-shaking when TELEMETRY_ENABLED is false
    // These imports are completely eliminated from production builds
    // Using require() here is intentional for dead code elimination
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SimpleLogRecordProcessor } = require('@opentelemetry/sdk-logs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { trace } = require('@opentelemetry/api');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resource } = require('@opentelemetry/resources');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LoggerProvider } = require('@opentelemetry/sdk-logs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ResilientOTLPExporter } = require('./resilient-exporter');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ResilientLogExporter } = require('./resilient-log-exporter');

    // Attempt to get CLI version from package.json
    let cliVersion = '0.1.0';
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require('../../package.json');
      cliVersion = pkg.version || '0.1.0';
    } catch {
      // Use default version if package.json not accessible
    }

    // Attempt to load project name from model manifest
    let projectName = 'unknown';
    try {
      // Try to load manifest synchronously - this is a best-effort operation
      // If it fails, we just use 'unknown'
      const fs = require('fs');
      const yaml = require('yaml');

      // Synchronously resolve model root and load manifest
      const possiblePaths = [
        `${process.cwd()}/documentation-robotics/model/manifest.yaml`,
        `${process.cwd()}/model/manifest.yaml`,
      ];

      for (const manifestPath of possiblePaths) {
        try {
          if (fs.existsSync(manifestPath)) {
            const content = fs.readFileSync(manifestPath, 'utf-8');
            const data = yaml.parse(content);
            projectName = data.project?.name || 'unknown';
            break;
          }
        } catch {
          // Continue to next path
        }
      }
    } catch {
      // No manifest found or error loading - use 'unknown'
    }

    // Create resource with service attributes
    const resource = new Resource({
      'service.name': process.env.OTEL_SERVICE_NAME || 'dr-cli',
      'service.version': cliVersion,
      'dr.project.name': projectName,
    });

    // Create trace exporter with circuit-breaker pattern
    const traceExporter = new ResilientOTLPExporter({
      url:
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
        'http://localhost:4318/v1/traces',
      timeoutMillis: 500,
    });

    // Initialize NodeSDK with SimpleSpanProcessor for immediate export
    const nodeSdk = new NodeSDK({
      resource,
      spanProcessor: new SimpleSpanProcessor(traceExporter),
    });

    // Start the SDK
    nodeSdk.start();
    sdk = nodeSdk;

    // Get tracer instance for span creation
    tracer = trace.getTracer('dr-cli', cliVersion);

    // Create log exporter with circuit-breaker pattern
    const logEndpoint =
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/v1\/traces$/, '/v1/logs') ||
      'http://localhost:4318/v1/logs';

    const logExporter = new ResilientLogExporter({
      url: logEndpoint,
      timeoutMillis: 500,
    });

    // Initialize LoggerProvider
    loggerProvider = new LoggerProvider({
      resource,
    });
    loggerProvider.addLogRecordProcessor(
      new SimpleLogRecordProcessor(logExporter)
    );

    // Get logger instance for log emission
    logger = loggerProvider.getLogger('dr-cli', cliVersion);
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
 * Automatically correlates logs with active spans by attaching traceId and spanId.
 * Returns without emitting if telemetry is disabled.
 *
 * ```typescript
 * import { SeverityNumber } from '@opentelemetry/api-logs';
 * emitLog(SeverityNumber.INFO, 'User logged in', { 'user.id': '12345' });
 * ```
 */
export function emitLog(
  severity: number,
  message: string,
  attributes?: Record<string, any>
): void {
  if (!isTelemetryEnabled || !logger) {
    return;
  }

  // Dynamic import of trace API for getting active span
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { trace } = require('@opentelemetry/api');

  const span = trace.getActiveSpan();
  const context = span?.spanContext();

  // Map severity number to text representation
  // Reference: https://opentelemetry.io/docs/reference/specification/logs/data-model/#severity_number
  const severityMap: Record<number, string> = {
    0: 'UNSPECIFIED',
    1: 'TRACE',
    2: 'TRACE2',
    3: 'TRACE3',
    4: 'TRACE4',
    5: 'DEBUG',
    6: 'DEBUG2',
    7: 'DEBUG3',
    8: 'DEBUG4',
    9: 'INFO',
    10: 'INFO2',
    11: 'INFO3',
    12: 'INFO4',
    13: 'WARN',
    14: 'WARN2',
    15: 'WARN3',
    16: 'WARN4',
    17: 'ERROR',
    18: 'ERROR2',
    19: 'ERROR3',
    20: 'ERROR4',
    21: 'FATAL',
    22: 'FATAL2',
    23: 'FATAL3',
    24: 'FATAL4',
  };

  const severityText = severityMap[severity] || 'UNSPECIFIED';

  logger.emit({
    severityNumber: severity,
    severityText,
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
 * Should be called on process exit to ensure all pending spans and logs are exported.
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
