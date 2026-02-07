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
  const isDebug = process.env.DEBUG || process.env.VERBOSE;

  // Log ALL incoming requests for debugging
  if (isDebug) {
    console.log(`[HTTP] ${method} ${path} (full URL: ${url})`);
  }

  if (!isTelemetryEnabled) {
    if (isDebug) {
      console.log(`[Telemetry] Skipping span creation - TELEMETRY_ENABLED is false`);
    }
    return next();
  }

  // Dynamic import for tree-shaking
  const { startActiveSpan } = await import('../telemetry/index.js');

  const route = c.req.routePath || path; // Use route pattern if available

  if (isDebug) {
    console.log(`[Telemetry] Creating active span for http.server.request`);
  }

  // Use startActiveSpan for proper context propagation and automatic span management
  return await startActiveSpan(
    'http.server.request',
    async (span) => {
      const requestStartTime = Date.now();

      // Set initial attributes
      span.setAttributes({
        'http.method': method,
        'http.route': route,
        'http.url': url,
        'http.target': path,
        'http.user_agent': c.req.header('user-agent') || '',
        'http.scheme': new URL(url).protocol.replace(':', ''),
      });

      if (isDebug) {
        console.log(`[Telemetry] Active span created successfully`);
      }

      try {
        // Process the request
        await next();

        // Add response attributes after request is processed
        const statusCode = c.res.status;
        const durationMs = Date.now() - requestStartTime;

        span.setAttribute('http.status_code', statusCode);
        span.setAttribute('http.duration_ms', durationMs);

        // Set span status based on HTTP status code
        if (statusCode >= 500) {
          span.setStatus({ code: 2, message: 'Server Error' }); // ERROR
        } else if (statusCode >= 400) {
          span.setStatus({ code: 2, message: 'Client Error' }); // ERROR
        } else {
          span.setStatus({ code: 1 }); // OK
        }
      } catch (error) {
        // Record exception in span
        span.recordException(error as Error);
        span.setStatus({ code: 2, message: (error as Error).message }); // ERROR
        throw error;
      }
      // Span is automatically ended when this async function completes
    },
    {
      'http.method': method,
      'http.route': route,
    }
  );
}
