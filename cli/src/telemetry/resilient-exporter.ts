/**
 * Resilient OTLP exporter with circuit-breaker pattern.
 * Gracefully handles missing OTLP collectors by silently discarding spans
 * instead of blocking CLI execution.
 */

import type { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { FetchOTLPExporter } from "./fetch-otlp-exporter.js";

/**
 * OTLP exporter with circuit-breaker pattern for graceful failure.
 * Silently discards spans when collector is unavailable instead of blocking.
 *
 * Circuit breaker behavior:
 * - Initial state: Attempts export to configured OTLP endpoint
 * - On failure: Sets 30-second backoff window, silently discards spans
 * - Backoff expired: Retries export, resets on success or extends on failure
 * - Timeout: 5000ms timeout to accommodate network latency
 */
export class ResilientOTLPExporter implements SpanExporter {
  private delegate: SpanExporter;
  private retryAfter = 0; // Circuit-breaker timestamp
  private readonly url: string;
  private readonly debug: boolean;

  constructor(
    config?: Record<string, unknown> & {
      url?: string;
      timeoutMillis?: number;
    }
  ) {
    this.url = config?.url || "http://localhost:4318/v1/traces";
    // Enable debug logging if any debug flag is set (consistent with telemetry/index.ts)
    this.debug =
      process.env.DR_TELEMETRY_DEBUG === "1" ||
      process.env.DEBUG === "1" ||
      process.env.VERBOSE === "1";

    // Detect if running in Bun and use fetch-based exporter for compatibility
    const isBun = typeof (globalThis as any).Bun !== "undefined";

    if (isBun) {
      // Use fetch-based exporter for Bun (avoids http module compatibility issues)
      this.delegate = new FetchOTLPExporter({
        url: this.url,
        timeoutMillis: config?.timeoutMillis ?? 10000,
      });
      if (this.debug) {
        process.stderr.write(`[TELEMETRY] Using fetch-based exporter for Bun compatibility\n`);
      }
    } else {
      // Use standard http-based exporter for Node.js
      this.delegate = new OTLPTraceExporter({
        ...config,
        url: this.url,
        timeoutMillis: config?.timeoutMillis ?? 5000,
      });
      if (this.debug) {
        process.stderr.write(`[TELEMETRY] Trace exporter initialized: ${this.url}\n`);
      }
    }
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    // Circuit breaker: skip export if recently failed.
    // Boundary: when Date.now() === this.retryAfter, retry immediately (intended behavior).
    if (Date.now() < this.retryAfter) {
      // Pretend success and silently discard spans
      if (this.debug) {
        process.stderr.write(
          `[TELEMETRY] Circuit breaker OPEN - discarding ${spans.length} span(s)\n`
        );
      }
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    if (this.debug) {
      process.stderr.write(`[TELEMETRY] Exporting ${spans.length} span(s) to ${this.url}\n`);
    }

    this.delegate.export(spans, (result: ExportResult) => {
      if (result.code === ExportResultCode.FAILED) {
        if (this.debug) {
          process.stderr.write(`[TELEMETRY] Export FAILED - circuit breaker opening for 30s\n`);
          if (result.error) {
            process.stderr.write(`[TELEMETRY] Error: ${result.error.message}\n`);
          }
        }
        // Set 30-second backoff window after first failure
        this.retryAfter = Date.now() + 30000;
        // Report success to SDK so it doesn't queue/retry internally
        // The backoff mechanism prevents further export attempts
        resultCallback({ code: ExportResultCode.SUCCESS });
      } else {
        if (this.debug) {
          process.stderr.write(`[TELEMETRY] Export SUCCESS - ${spans.length} span(s) sent\n`);
        }
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
