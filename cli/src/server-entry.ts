/**
 * Visualization Server Entry Point
 * This is a Bun-specific entry point for running the visualization server
 * It receives configuration via environment variables and starts the server
 */

import { Model } from './core/model.js';
import { VisualizationServer } from './server/server.js';

// Get configuration from environment variables
const port = parseInt(process.env.DR_VISUALIZE_PORT || '8080', 10);
const projectPath = process.env.DR_PROJECT_PATH || process.cwd();
const authEnabled = process.env.DR_AUTH_ENABLED !== 'false';
// Only pass authToken if it's a non-empty string, otherwise let server generate one
const authToken = process.env.DR_AUTH_TOKEN && process.env.DR_AUTH_TOKEN.length > 0
  ? process.env.DR_AUTH_TOKEN
  : undefined;
const withDanger = process.env.DR_WITH_DANGER === 'true';
const viewerPath = process.env.DR_VIEWER_PATH;

// Conditional telemetry import based on compile-time flag
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;

let serverInstance: VisualizationServer | null = null;
let isShuttingDown = false;

async function main() {
  try {
    // CRITICAL: Initialize telemetry SDK in subprocess
    // Without this, no spans will be created or exported even though TELEMETRY_ENABLED=true
    if (isTelemetryEnabled) {
      try {
        const { initTelemetry } = await import('./telemetry/index.js');
        await initTelemetry();

        // Verify tracer was initialized
        const { isTelemetryEnabled: checkEnabled } = await import('./telemetry/index.js');

        if (process.env.DEBUG || process.env.VERBOSE) {
          console.log(`[Telemetry] SDK initialized in server subprocess`);
          console.log(`[Telemetry] OTLP traces endpoint: ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces (default)'}`);
          console.log(`[Telemetry] OTLP logs endpoint: ${process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || 'http://localhost:4318/v1/logs (default)'}`);
          console.log(`[Telemetry] Enabled: ${checkEnabled}`);
        }
      } catch (error) {
        // Log telemetry initialization errors but don't fail the server
        console.error('[Telemetry] Failed to initialize telemetry:', error);
        console.error('[Telemetry] Server will continue without telemetry');
      }
    } else if (process.env.DEBUG || process.env.VERBOSE) {
      console.log(`[Telemetry] TELEMETRY_ENABLED is false - telemetry disabled`);
    }

    // Load model with full content
    const model = await Model.load(projectPath, { lazyLoad: false });

    // Create and start server
    const server = new VisualizationServer(model, { authEnabled, authToken, withDanger, viewerPath });
    serverInstance = server; // Store for signal handlers
    await server.start(port);

    // Output token for parent process to read
    if (authEnabled) {
      console.log(`TOKEN:${server.getAuthToken()}`);
    }

    // Setup graceful shutdown handlers
    setupShutdownHandlers();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    if (error instanceof Error) {
      console.error(`Stack: ${error.stack}`);
    }
    await gracefulShutdown(1);
  }
}

/**
 * Gracefully shutdown the server and flush telemetry
 */
async function gracefulShutdown(exitCode: number = 0): Promise<void> {
  if (isShuttingDown) {
    return; // Prevent multiple shutdown attempts
  }
  isShuttingDown = true;

  try {
    // Stop the visualization server
    if (serverInstance) {
      serverInstance.stop();
      serverInstance = null;
    }

    // Flush telemetry spans before exit
    if (isTelemetryEnabled) {
      console.log('[Telemetry] Shutting down telemetry and flushing spans...');
      const { shutdownTelemetry } = await import('./telemetry/index.js');
      await shutdownTelemetry();
      console.log('[Telemetry] Telemetry shutdown complete');
    } else {
      if (process.env.DEBUG) {
        console.log('[Telemetry] Telemetry is disabled (TELEMETRY_ENABLED=false at build time)');
      }
    }
  } catch (error) {
    // Don't block shutdown on errors
    if (process.env.DEBUG) {
      console.error('Error during shutdown:', error);
    }
  } finally {
    process.exit(exitCode);
  }
}

/**
 * Setup handlers for graceful shutdown on signals
 */
function setupShutdownHandlers(): void {
  // Handle Ctrl-C (SIGINT)
  process.on('SIGINT', async () => {
    console.log('\n[SIGINT] Shutting down visualization server...');
    await gracefulShutdown(0);
  });

  // Handle termination signal (SIGTERM)
  process.on('SIGTERM', async () => {
    console.log('\n[SIGTERM] Shutting down visualization server...');
    await gracefulShutdown(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await gracefulShutdown(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason) => {
    console.error('Unhandled rejection:', reason);
    await gracefulShutdown(1);
  });
}

main();
