/**
 * Fetch-based OTLP exporter for Bun compatibility.
 * Uses native fetch API instead of Node.js http module.
 */

import type { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import { getErrorMessage } from "../utils/errors.js";

/**
 * OTLP exporter using fetch API for Bun compatibility.
 * Bun's http module has compatibility issues with the standard OTLP exporter,
 * so we use fetch which is natively supported by Bun.
 */
export class FetchOTLPExporter implements SpanExporter {
  private readonly url: string;
  private readonly debug: boolean;
  private readonly timeoutMs: number;

  constructor(config?: { url?: string; timeoutMillis?: number }) {
    this.url = config?.url || "http://localhost:4318/v1/traces";
    this.timeoutMs = config?.timeoutMillis ?? 10000;
    this.debug =
      process.env.DR_TELEMETRY_DEBUG === "1" ||
      process.env.DEBUG === "1" ||
      process.env.VERBOSE === "1";

    if (this.debug) {
      process.stderr.write(`[TELEMETRY] Fetch-based trace exporter initialized: ${this.url}\n`);
    }
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (this.debug) {
      process.stderr.write(`[TELEMETRY] Exporting ${spans.length} span(s) to ${this.url}\n`);
    }

    // Convert spans to OTLP JSON format
    const payload = this.convertSpansToOTLP(spans);

    // Use AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(async (response) => {
        clearTimeout(timeoutId);

        if (response.ok) {
          if (this.debug) {
            process.stderr.write(`[TELEMETRY] Export SUCCESS - ${spans.length} span(s) sent\n`);
          }
          resultCallback({ code: ExportResultCode.SUCCESS });
        } else {
          const errorText = await response.text();
          if (this.debug) {
            process.stderr.write(
              `[TELEMETRY] Export FAILED - HTTP ${response.status}: ${errorText}\n`
            );
          }
          resultCallback({
            code: ExportResultCode.FAILED,
            error: new Error(`HTTP ${response.status}: ${errorText}`),
          });
        }
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        if (this.debug) {
          const errorMsg = getErrorMessage(error);
          process.stderr.write(`[TELEMETRY] Export FAILED - ${errorMsg}\n`);
        }
        resultCallback({
          code: ExportResultCode.FAILED,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
  }

  async forceFlush(): Promise<void> {
    // No-op for fetch-based exporter (no buffering)
  }

  async shutdown(): Promise<void> {
    // No-op for fetch-based exporter (no persistent connections)
  }

  /**
   * Convert OpenTelemetry spans to OTLP JSON format.
   * Simplified version that covers the essential fields.
   */
  private convertSpansToOTLP(spans: ReadableSpan[]): any {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: this.convertAttributes(spans[0]?.resource?.attributes || {}),
          },
          scopeSpans: [
            {
              scope: {
                name: spans[0]?.instrumentationLibrary?.name || "unknown",
                version: spans[0]?.instrumentationLibrary?.version || "",
              },
              spans: spans.map((span) => ({
                traceId: span.spanContext().traceId,
                spanId: span.spanContext().spanId,
                parentSpanId: span.parentSpanId || undefined,
                name: span.name,
                kind: span.kind,
                startTimeUnixNano: String(span.startTime[0] * 1e9 + span.startTime[1]),
                endTimeUnixNano: String(span.endTime[0] * 1e9 + span.endTime[1]),
                attributes: this.convertAttributes(span.attributes),
                status: span.status,
                events: span.events.map((event) => ({
                  timeUnixNano: String(event.time[0] * 1e9 + event.time[1]),
                  name: event.name,
                  attributes: this.convertAttributes(event.attributes || {}),
                })),
              })),
            },
          ],
        },
      ],
    };
  }

  /**
   * Convert attributes to OTLP format.
   */
  private convertAttributes(attrs: any): any[] {
    if (!attrs) return [];
    return Object.entries(attrs).map(([key, value]) => ({
      key,
      value: this.convertValue(value),
    }));
  }

  /**
   * Convert attribute value to OTLP format.
   */
  private convertValue(value: any): any {
    if (typeof value === "string") {
      return { stringValue: value };
    } else if (typeof value === "number") {
      if (Number.isInteger(value)) {
        return { intValue: String(value) };
      } else {
        return { doubleValue: value };
      }
    } else if (typeof value === "boolean") {
      return { boolValue: value };
    } else if (Array.isArray(value)) {
      return {
        arrayValue: {
          values: value.map((v) => this.convertValue(v)),
        },
      };
    } else {
      return { stringValue: String(value) };
    }
  }
}
