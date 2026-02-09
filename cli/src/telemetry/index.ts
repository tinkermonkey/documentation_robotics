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

import type { Span } from "@opentelemetry/api";
import type { NodeSDK } from "@opentelemetry/sdk-node";
import type { Tracer } from "@opentelemetry/api";
import type { Logger as OTelLogger } from "@opentelemetry/api-logs";

// Re-export SeverityNumber for convenience
export { SeverityNumber } from "@opentelemetry/api-logs";

// Fallback for runtime environments where TELEMETRY_ENABLED is not defined by esbuild
// This ensures tests and non-bundled code don't crash
declare const TELEMETRY_ENABLED: boolean | undefined;
export const isTelemetryEnabled =
  typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

// Module-level state: SDK and tracer instances
// Only initialized when TELEMETRY_ENABLED is true
let sdk: NodeSDK | null = null;
let tracer: Tracer | null = null;
let loggerProvider: any = null; // LoggerProvider type
let logger: OTelLogger | null = null;
let spanProcessor: any = null; // SimpleSpanProcessor type - stored for explicit forceFlush

// Cache OpenTelemetry API imports for synchronous access
let cachedContext: any = null;
let cachedTrace: any = null;

/**
 * Initialize OpenTelemetry SDK. Must be called before creating spans.
 * No-op when TELEMETRY_ENABLED is false.
 *
 * Initializes both TracerProvider and LoggerProvider with:
 * - Service name: from environment/config (default "dr-cli")
 * - Service version: from package.json
 * - Project name: from model manifest (if available)
 * - Processors: SimpleSpanProcessor and SimpleLogRecordProcessor
 * - Exporters: ResilientOTLPExporter with circuit-breaker pattern
 *
 * OTLP configuration is loaded from multiple sources with precedence:
 * 1. Environment variables (OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, OTEL_SERVICE_NAME)
 * 2. ~/.dr-config.yaml telemetry.otlp section
 * 3. Hard-coded defaults (http://localhost:4318/v1/traces and /v1/logs)
 *
 * See: cli/src/telemetry/config.ts for configuration loading details
 */
export async function initTelemetry(): Promise<void> {
  if (isTelemetryEnabled) {
    // Dynamic imports ensure tree-shaking when TELEMETRY_ENABLED is false
    // These imports are completely eliminated from production builds
    const [
      { NodeSDK },
      { SimpleSpanProcessor },
      { SimpleLogRecordProcessor },
      otelApi,
      { Resource },
      { LoggerProvider },
      { ResilientOTLPExporter },
      { ResilientLogExporter },
      { loadOTLPConfig },
    ] = await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/sdk-trace-base"),
      import("@opentelemetry/sdk-logs"),
      import("@opentelemetry/api"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/sdk-logs"),
      import("./resilient-exporter.js"),
      import("./resilient-log-exporter.js"),
      import("./config.js"),
    ]);

    // Cache API imports for synchronous access in other functions
    const { trace, context } = otelApi;
    cachedTrace = trace;
    cachedContext = context;

    // Load OTLP configuration from environment variables, config file, and defaults
    const otlpConfig = await loadOTLPConfig();

    // Debug: Log loaded configuration
    if (process.env.DR_TELEMETRY_DEBUG) {
      process.stderr.write("[TELEMETRY] Configuration loaded:\n");
      process.stderr.write(`  - Traces endpoint: ${otlpConfig.endpoint}\n`);
      process.stderr.write(`  - Logs endpoint: ${otlpConfig.logsEndpoint}\n`);
      process.stderr.write(`  - Service name: ${otlpConfig.serviceName}\n`);
    }

    // Attempt to get CLI version from package.json
    let cliVersion = "0.1.0";
    try {
      const pkg = await import("../../package.json", { assert: { type: "json" } });
      cliVersion = pkg.default.version || "0.1.0";
    } catch {
      // Use default version if package.json not accessible
    }

    // Attempt to load project name from model manifest
    let projectName = "unknown";
    try {
      // Try to load manifest - this is a best-effort operation
      // If it fails, we just use 'unknown'
      const [{ readFileSync, existsSync }, { parse }] = await Promise.all([
        import("fs"),
        import("yaml"),
      ]);

      // Resolve model root and load manifest
      const possiblePaths = [
        `${process.cwd()}/documentation-robotics/model/manifest.yaml`,
        `${process.cwd()}/model/manifest.yaml`,
      ];

      for (const manifestPath of possiblePaths) {
        try {
          if (existsSync(manifestPath)) {
            const content = readFileSync(manifestPath, "utf-8");
            const data = parse(content);
            projectName = data.project?.name || "unknown";
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
      "service.name": otlpConfig.serviceName,
      "service.version": cliVersion,
      "dr.project.name": projectName,
    });

    // Create trace exporter with circuit-breaker pattern
    const traceExporter = new ResilientOTLPExporter({
      url: otlpConfig.endpoint,
      timeoutMillis: 10000, // 10s timeout for network requests (serialization + network latency)
    });

    // Create span processor and store reference for forceFlush during shutdown
    spanProcessor = new SimpleSpanProcessor(traceExporter);

    // Initialize NodeSDK with SimpleSpanProcessor for immediate export
    const nodeSdk = new NodeSDK({
      resource,
      spanProcessor,
    });

    // Start the SDK
    nodeSdk.start();
    sdk = nodeSdk;

    // Get tracer instance for span creation
    tracer = trace.getTracer("dr-cli", cliVersion);

    // Debug: Log SDK initialization
    if (process.env.DR_TELEMETRY_DEBUG || process.env.DEBUG || process.env.VERBOSE) {
      process.stderr.write("[TELEMETRY] SDK initialized successfully\n");
      process.stderr.write(`[TELEMETRY] Tracer initialized: ${tracer !== null}\n`);
    }

    // Create log exporter with circuit-breaker pattern
    const logExporter = new ResilientLogExporter({
      url: otlpConfig.logsEndpoint,
      timeoutMillis: 10000, // 10s timeout for network requests (serialization + network latency)
    });

    // Initialize LoggerProvider
    loggerProvider = new LoggerProvider({
      resource,
    });
    loggerProvider.addLogRecordProcessor(new SimpleLogRecordProcessor(logExporter));

    // Get logger instance for log emission
    logger = loggerProvider.getLogger("dr-cli", cliVersion);
  }
}

/**
 * Create and start a new span with the given name and optional attributes.
 * Returns null when telemetry is disabled.
 *
 * This function respects the active context - if there's an active span,
 * the new span will be created as a child of it. This enables proper
 * trace hierarchy.
 *
 * IMPORTANT: This function does NOT set the span as active in the context.
 * For automatic context propagation, use `startActiveSpan()` instead.
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
export function startSpan(name: string, attributes?: Record<string, any>): Span | null {
  if (isTelemetryEnabled && tracer && cachedContext) {
    // Start span with current context to respect parent-child relationships
    return tracer.startSpan(name, { attributes }, cachedContext.active());
  }

  // Debug: Log why span creation was skipped
  if (process.env.DR_TELEMETRY_DEBUG || process.env.DEBUG || process.env.VERBOSE) {
    if (!isTelemetryEnabled) {
      process.stderr.write(
        `[TELEMETRY] startSpan('${name}'): skipped - isTelemetryEnabled=false\n`
      );
    } else if (!tracer) {
      process.stderr.write(
        `[TELEMETRY] startSpan('${name}'): skipped - tracer is null (initTelemetry not called?)\n`
      );
    } else if (!cachedContext) {
      process.stderr.write(`[TELEMETRY] startSpan('${name}'): skipped - cachedContext is null\n`);
    }
  }

  return null;
}

/**
 * Execute a function with an active span that properly propagates context.
 * Child spans created within the callback will automatically be linked to this span.
 *
 * Returns the result of the callback function.
 * Returns the callback result directly when telemetry is disabled.
 *
 * ```typescript
 * const result = await startActiveSpan('operation', async (span) => {
 *   // Child spans here will be properly linked
 *   return doWork();
 * }, { 'attr.key': 'value' });
 * ```
 */
export async function startActiveSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, any>
): Promise<T> {
  if (!isTelemetryEnabled || !tracer) {
    // Create a no-op span for the callback
    const noopSpan = {
      end: () => {},
      setAttribute: () => noopSpan,
      setAttributes: () => noopSpan,
      addEvent: () => noopSpan,
      setStatus: () => noopSpan,
      updateName: () => noopSpan,
      isRecording: () => false,
      recordException: () => {},
      spanContext: () => ({
        traceId: "",
        spanId: "",
        traceFlags: 0,
      }),
    } as any;
    return fn(noopSpan);
  }

  // Use tracer.startActiveSpan for proper context propagation
  return new Promise<T>((resolve, reject) => {
    tracer!.startActiveSpan(name, { attributes }, async (span) => {
      try {
        const result = await fn(span);
        span.end();
        resolve(result);
      } catch (error) {
        span.recordException(error as Error);
        span.end();
        reject(error);
      }
    });
  });
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
export function emitLog(severity: number, message: string, attributes?: Record<string, any>): void {
  if (!isTelemetryEnabled || !logger || !cachedTrace) {
    return;
  }

  const span = cachedTrace.getActiveSpan();
  const context = span?.spanContext();

  // Map severity number to text representation
  // Reference: https://opentelemetry.io/docs/reference/specification/logs/data-model/#severity_number
  const severityMap: Record<number, string> = {
    0: "UNSPECIFIED",
    1: "TRACE",
    2: "TRACE2",
    3: "TRACE3",
    4: "TRACE4",
    5: "DEBUG",
    6: "DEBUG2",
    7: "DEBUG3",
    8: "DEBUG4",
    9: "INFO",
    10: "INFO2",
    11: "INFO3",
    12: "INFO4",
    13: "WARN",
    14: "WARN2",
    15: "WARN3",
    16: "WARN4",
    17: "ERROR",
    18: "ERROR2",
    19: "ERROR3",
    20: "ERROR4",
    21: "FATAL",
    22: "FATAL2",
    23: "FATAL3",
    24: "FATAL4",
  };

  const severityText = severityMap[severity] || "UNSPECIFIED";

  logger.emit({
    severityNumber: severity,
    severityText,
    body: message,
    attributes: {
      ...attributes,
      ...(context && {
        "trace.id": context.traceId,
        "span.id": context.spanId,
      }),
    },
  });
}

/**
 * Flush pending telemetry spans without blocking.
 * Safe to call during idle periods (e.g., between chat messages).
 * Failures are silently ignored to avoid disrupting the application.
 *
 * Use cases:
 * - Long-running chat sessions (call between messages)
 * - Periodic checkpoints in interactive commands
 * - After completing a batch of operations
 *
 * @returns Promise that resolves when flush completes (or immediately if telemetry disabled)
 */
export async function flushTelemetry(): Promise<void> {
  if (isTelemetryEnabled && spanProcessor) {
    try {
      // Non-blocking flush of pending spans
      // This exports any spans that haven't been sent yet
      await spanProcessor.forceFlush();
    } catch (error) {
      // Silently ignore flush failures - telemetry should never break the app
      // Spans will be retried on next flush or at shutdown
    }
  }
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
      // CRITICAL: Force flush span processor before SDK shutdown
      // This ensures all pending async span exports complete
      // See: https://github.com/open-telemetry/opentelemetry-js/issues/4249
      if (spanProcessor) {
        await spanProcessor.forceFlush();
      }

      // Shutdown SDK (will also flush, but forceFlush above ensures pending exports finish)
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
