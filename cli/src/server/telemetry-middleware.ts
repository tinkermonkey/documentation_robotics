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
 */
export async function telemetryMiddleware(c: Context, next: Next): Promise<void> {
  if (!isTelemetryEnabled) {
    return next();
  }

  // Dynamic import for tree-shaking
  const { startSpan, endSpan } = await import('../telemetry/index.js');

  const method = c.req.method;
  const path = c.req.path;
  const route = c.req.routePath || path; // Use route pattern if available

  // Create span for the HTTP request
  const span = startSpan('http.server.request', {
    'http.method': method,
    'http.route': route,
    'http.url': c.req.url,
    'http.target': path,
    'http.user_agent': c.req.header('user-agent') || '',
    'http.scheme': new URL(c.req.url).protocol.replace(':', ''),
  });

  try {
    // Process the request
    await next();

    // Add response attributes after request is processed
    if (span && 'setAttribute' in span) {
      const statusCode = c.res.status;
      (span as any).setAttribute('http.status_code', statusCode);

      // Set span status based on HTTP status code
      if (statusCode >= 500) {
        (span as any).setStatus({ code: 2, message: 'Server Error' }); // ERROR
      } else if (statusCode >= 400) {
        (span as any).setStatus({ code: 2, message: 'Client Error' }); // ERROR
      } else {
        (span as any).setStatus({ code: 1 }); // OK
      }
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
