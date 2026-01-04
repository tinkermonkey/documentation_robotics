/**
 * Console method interceptor for OpenTelemetry log emission.
 *
 * Wraps console.log, console.error, console.warn, and console.debug to emit
 * OpenTelemetry log records while preserving original console behavior.
 *
 * Log records inherit trace context from active spans and include stack traces
 * for errors. This module is only active when TELEMETRY_ENABLED is true.
 *
 * Pattern: All telemetry function calls must be directly guarded by
 * `if (TELEMETRY_ENABLED)` checks in calling code to enable tree-shaking
 * and zero-cost abstractions in production builds.
 */

// Fallback for runtime environments where TELEMETRY_ENABLED is not defined by esbuild
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;

// Store original console methods before any wrapping
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  debug: console.debug,
};

/**
 * Format console arguments into a single string.
 * Converts objects to JSON representation for readability in logs.
 */
function formatArgs(args: any[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');
}

/**
 * Extract error stack trace and message from console arguments.
 * Returns attributes suitable for log record enrichment.
 */
function extractStackTrace(args: any[]): Record<string, string> {
  const errorArg = args.find((arg) => arg instanceof Error);
  if (errorArg) {
    return {
      'error.message': errorArg.message,
      'error.stack': errorArg.stack || '',
    };
  }
  return {};
}

/**
 * Install console interceptor to emit OpenTelemetry log records.
 *
 * Maps console methods to OpenTelemetry severity levels:
 * - console.debug() → DEBUG
 * - console.log() → INFO
 * - console.warn() → WARN
 * - console.error() → ERROR
 *
 * Each log record includes the active trace and span identifiers
 * from the current OpenTelemetry context (if available).
 *
 * Original console behavior is preserved - all console output still appears.
 *
 * No-op when TELEMETRY_ENABLED is false.
 */
export async function installConsoleInterceptor(): Promise<void> {
  if (!isTelemetryEnabled) return;

  const [{ SeverityNumber }, { emitLog }] = await Promise.all([
    import('@opentelemetry/api-logs'),
    import('./index.js')
  ]);

  console.log = (...args: any[]): void => {
    emitLog(SeverityNumber.INFO, formatArgs(args));
    originalConsole.log.apply(console, args);
  };

  console.error = (...args: any[]): void => {
    const attrs = extractStackTrace(args);
    emitLog(SeverityNumber.ERROR, formatArgs(args), attrs);
    originalConsole.error.apply(console, args);
  };

  console.warn = (...args: any[]): void => {
    emitLog(SeverityNumber.WARN, formatArgs(args));
    originalConsole.warn.apply(console, args);
  };

  console.debug = (...args: any[]): void => {
    emitLog(SeverityNumber.DEBUG, formatArgs(args));
    originalConsole.debug.apply(console, args);
  };
}

/**
 * Uninstall console interceptor and restore original console methods.
 *
 * Useful for testing to prevent state pollution between tests.
 * Safe to call when telemetry is disabled (no-op).
 */
export function uninstallConsoleInterceptor(): void {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.debug = originalConsole.debug;
}
