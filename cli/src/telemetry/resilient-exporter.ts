/**
 * Resilient OTLP exporter with circuit-breaker pattern.
 * Gracefully handles missing Jaeger collectors by silently discarding spans
 * instead of blocking CLI execution.
 */

import type {
  SpanExporter,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import type { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

/**
 * OTLP exporter with circuit-breaker pattern for graceful failure.
 * Silently discards spans when collector is unavailable instead of blocking.
 *
 * Circuit breaker behavior:
 * - Initial state: Attempts export to configured OTLP endpoint
 * - On failure: Sets 30-second backoff window, silently discards spans
 * - Backoff expired: Retries export, resets on success or extends on failure
 * - Timeout: 500ms aggressive timeout prevents blocking CLI execution
 */
export class ResilientOTLPExporter implements SpanExporter {
  private delegate: OTLPTraceExporter;
  private retryAfter = 0;

  constructor(
    config?: Record<string, unknown> & {
      url?: string;
      timeoutMillis?: number;
    }
  ) {
    // Using require() is intentional for tree-shaking when TELEMETRY_ENABLED is false
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPTraceExporter: ExporterClass } = require('@opentelemetry/exporter-trace-otlp-http');

    this.delegate = new ExporterClass({
      ...config,
      url: config?.url || 'http://localhost:4318/v1/traces',
      timeoutMillis: config?.timeoutMillis ?? 500, // Aggressive timeout for local dev
    });
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    // Circuit breaker: skip export if recently failed.
    // Boundary: when Date.now() === this.retryAfter, retry immediately (intended behavior).
    if (Date.now() < this.retryAfter) {
      // Pretend success and silently discard spans
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    this.delegate.export(spans, (result: ExportResult) => {
        if (result.code === ExportResultCode.FAILED) {
          // Set 30-second backoff window after first failure
          this.retryAfter = Date.now() + 30000;
          // Report success to SDK so it doesn't queue/retry internally
          // The backoff mechanism prevents further export attempts
          resultCallback({ code: ExportResultCode.SUCCESS });
        } else {
          // Clear backoff on successful export
          this.retryAfter = 0;
          resultCallback(result);
        }
      });
  }

  async forceFlush(): Promise<void> {
    // Circuit breaker open: skip flush to avoid wasting resources
    if (Date.now() < this.retryAfter) {
      return;
    }

    try {
      await this.delegate.forceFlush?.();
    } catch {
      // Silently ignore flush failures - don't block shutdown
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.delegate.shutdown();
    } catch {
      // Silently ignore shutdown failures - don't let telemetry block process exit
    }
  }
}
