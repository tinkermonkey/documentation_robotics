/**
 * OpenTelemetry middleware for Hono server
 * Instruments HTTP requests with spans and semantic attributes
 */

import type { Context, Next } from 'hono';

// Conditional imports based on telemetry flag
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;

/**
 * Hono middleware that creates a span for each HTTP request
 * Captures HTTP semantic attributes according to OpenTelemetry conventions:
 * - http.method: HTTP request method
 * - http.route: HTTP route pattern
 * - http.status_code: HTTP response status code
 * - http.url: Full request URL
 * - http.user_agent: User agent string
 *
 * Also emits logs at request start and completion per SigNoz integration guide
 * for request lifecycle tracking.
 */
export async function telemetryMiddleware(c: Context, next: Next): Promise<void> {
  const method = c.req.method;
  const path = c.req.path;
  const url = c.req.url;

  // Log ALL incoming requests for debugging
  console.log(`[HTTP] ${method} ${path} (full URL: ${url})`);

  if (!isTelemetryEnabled) {
    return next();
  }

  // Dynamic import for tree-shaking
  const { startSpan, endSpan, emitLog } = await import('../telemetry/index.js');
  const { SeverityNumber } = await import('@opentelemetry/api-logs');

  const route = c.req.routePath || path; // Use route pattern if available
  const requestStartTime = Date.now();

  // Create span for the HTTP request
  const span = startSpan('http.server.request', {
    'http.method': method,
    'http.route': route,
    'http.url': c.req.url,
    'http.target': path,
    'http.user_agent': c.req.header('user-agent') || '',
    'http.scheme': new URL(c.req.url).protocol.replace(':', ''),
  });

  // Log request received (per SigNoz integration guide: request lifecycle logging)
  await emitLog(SeverityNumber.INFO, 'Request received', {
    'http.method': method,
    'http.route': route,
    'http.target': path,
  });

  try {
    // Process the request
    await next();

    // Add response attributes after request is processed
    if (span && 'setAttribute' in span) {
      const statusCode = c.res.status;
      const durationMs = Date.now() - requestStartTime;

      (span as any).setAttribute('http.status_code', statusCode);
      (span as any).setAttribute('http.duration_ms', durationMs);

      // Set span status based on HTTP status code
      if (statusCode >= 500) {
        (span as any).setStatus({ code: 2, message: 'Server Error' }); // ERROR
      } else if (statusCode >= 400) {
        (span as any).setStatus({ code: 2, message: 'Client Error' }); // ERROR
      } else {
        (span as any).setStatus({ code: 1 }); // OK
      }

      // Log request completed (per SigNoz integration guide: request lifecycle logging)
      await emitLog(
        statusCode >= 400 ? SeverityNumber.ERROR : SeverityNumber.INFO,
        'Request completed',
        {
          'http.method': method,
          'http.route': route,
          'http.target': path,
          'http.status_code': statusCode,
          'duration_ms': durationMs,
        }
      );
    }
  } catch (error) {
    // Record exception in span
    if (span && 'recordException' in span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({ code: 2, message: (error as Error).message }); // ERROR
    }
    throw error;
  } finally {
    // End the span
    endSpan(span);
  }
}
