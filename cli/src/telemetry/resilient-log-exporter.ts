/**
 * Resilient OTLP log exporter with circuit-breaker pattern.
 * Gracefully handles missing OTLP collectors by silently discarding log records
 * instead of blocking CLI execution.
 */

import type {
  LogRecordExporter,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

/**
 * OTLP log exporter with circuit-breaker pattern for graceful failure.
 * Silently discards log records when collector is unavailable instead of blocking.
 *
 * Circuit breaker behavior:
 * - Initial state: Attempts export to configured OTLP endpoint
 * - On failure: Sets 30-second backoff window, silently discards log records
 * - Backoff expired: Retries export, resets on success or extends on failure
 * - Timeout: 5000ms timeout to accommodate network latency
 */
export class ResilientLogExporter implements LogRecordExporter {
  private delegate: OTLPLogExporter;
  private retryAfter = 0;  // Circuit-breaker timestamp
  private readonly url: string;
  private readonly debug: boolean;

  constructor(
    config?: Record<string, unknown> & {
      url?: string;
      timeoutMillis?: number;
    }
  ) {
    this.url = config?.url || 'http://localhost:4318/v1/logs';
    this.debug = process.env.DR_TELEMETRY_DEBUG === '1';

    this.delegate = new OTLPLogExporter({
      ...config,
      url: this.url,
      timeoutMillis: config?.timeoutMillis ?? 5000,  // 5s timeout to allow for network latency
    });

    if (this.debug) {
      process.stderr.write(`[TELEMETRY] Log exporter initialized: ${this.url}\n`);
    }
  }

  export(
    records: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void
  ): void {
    // Circuit breaker: skip export if recently failed.
    // Boundary: when Date.now() === this.retryAfter, retry immediately (intended behavior).
    if (Date.now() < this.retryAfter) {
      // Pretend success and silently discard log records
      if (this.debug) {
        process.stderr.write(`[TELEMETRY] Circuit breaker OPEN - discarding ${records.length} log(s)\n`);
      }
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    if (this.debug) {
      process.stderr.write(`[TELEMETRY] Exporting ${records.length} log(s) to ${this.url}\n`);
    }

    this.delegate.export(records, (result: ExportResult) => {
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
          process.stderr.write(`[TELEMETRY] Export SUCCESS - ${records.length} log(s) sent\n`);
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
