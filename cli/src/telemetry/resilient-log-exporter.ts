import { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

/**
 * ResilientLogExporter implements the LogRecordExporter interface with circuit-breaker pattern.
 *
 * Features:
 * - 500ms timeout to prevent blocking CLI execution
 * - 30-second circuit-breaker backoff for resilience against missing OTLP collector
 * - Graceful degradation: failures don't block CLI or produce user-visible errors
 */
export class ResilientLogExporter implements LogRecordExporter {
  private delegate: OTLPLogExporter;
  private retryAfter = 0; // Circuit-breaker timestamp
  private readonly backoffMs = 30000; // 30 seconds

  constructor(config?: { url?: string; timeoutMillis?: number }) {
    const url = config?.url || 'http://localhost:4320/v1/logs';
    const timeoutMillis = config?.timeoutMillis || 500;

    this.delegate = new OTLPLogExporter({
      url,
      timeoutMillis,
    });
  }

  /**
   * Export log records with circuit-breaker protection.
   *
   * If the circuit-breaker is active (30s backoff after failure), silently
   * discards records and returns success to prevent SDK retries.
   */
  export(
    records: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void
  ): void {
    // Circuit-breaker check
    if (Date.now() < this.retryAfter) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return; // Silently discard during backoff
    }

    this.delegate.export(records, (result) => {
      if (result.code === ExportResultCode.FAILED) {
        // Activate circuit-breaker
        this.retryAfter = Date.now() + this.backoffMs;
        // Return success to prevent SDK retries
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
