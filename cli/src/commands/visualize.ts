/**
 * Visualize command - Launch visualization server
 */

import ansis from "ansis";
import { spawn } from "child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Model } from "../core/model.js";
import { logVerbose, logDebug } from "../utils/globals.js";
import { CLIError } from "../utils/errors.js";
import { getSpecReferencePath, getModelPath } from "../utils/project-paths.js";
import { getErrorMessage } from "../utils/errors.js";

// Conditional telemetry import based on compile-time flag
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

export interface VisualizeOptions {
  port?: number;
  noBrowser?: boolean;
  noAuth?: boolean;
  token?: string;
  verbose?: boolean;
  debug?: boolean;
  withDanger?: boolean;
  viewerPath?: string;
}

export async function visualizeCommand(
  options: VisualizeOptions & { port?: string }
): Promise<void> {
  try {
    logDebug("Loading model for validation...");

    // Load model to validate it exists (without full content to be quick)
    const model = await Model.load(process.cwd(), { lazyLoad: true });

    logVerbose(`Model validated: ${model.manifest.name}`);

    // Parse and validate port
    let port = 8080;
    if (options.port) {
      const portNum = parseInt(String(options.port), 10);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        throw new Error(`Invalid port number: ${options.port}. Port must be between 1 and 65535.`);
      }
      port = portNum;
    }

    // Determine auth settings
    const authEnabled = !options.noAuth; // Auth enabled by default unless --no-auth flag
    const authToken = options.token; // Optional token for testing
    const withDanger = options.withDanger || false; // Danger mode disabled by default

    logDebug(`Starting visualization server on port ${port}`);
    logDebug(`Authentication: ${authEnabled ? "enabled" : "disabled"}`);
    if (authEnabled && authToken) {
      logDebug(`Using provided token for authentication`);
    } else if (authEnabled) {
      logDebug(`Token will be auto-generated`);
    }
    if (withDanger) {
      logDebug(`Danger mode enabled - chat permissions will be skipped`);
    }

    // Get the directory where this command file is located (dist/commands/)
    const commandDir = dirname(fileURLToPath(import.meta.url));
    const distDir = dirname(commandDir); // Go up to dist/
    const serverEntryPath = `${distDir}/server-entry.js`;

    logDebug(`Server entry path: ${serverEntryPath}`);

    // Create telemetry span for server startup
    let serverStartupSpan: any = null;
    if (isTelemetryEnabled) {
      logDebug("[Telemetry] Creating visualize.server.startup span");
      const { startSpan } = await import("../telemetry/index.js");
      serverStartupSpan = startSpan("visualize.server.startup", {
        "server.port": port,
        "server.auth_enabled": authEnabled,
        "server.with_danger": withDanger,
      });
      logDebug(`[Telemetry] Span created: ${serverStartupSpan ? "success" : "failed"}`);
    } else {
      logDebug("[Telemetry] TELEMETRY_ENABLED is false - no spans will be created");
    }

    // Spawn server in Bun subprocess with environment variables
    const env: Record<string, string> = {
      ...process.env,
      DR_VISUALIZE_PORT: String(port),
      DR_PROJECT_PATH: process.cwd(),
      DR_AUTH_ENABLED: String(authEnabled),
      DR_WITH_DANGER: String(withDanger),
    };

    // Pass debug/verbose flags to subprocess
    // The CLI --debug flag sets globalOptions.debug, but subprocess checks process.env.DEBUG
    const { isDebug: getDebugState, isVerbose } = await import("../utils/globals.js");
    if (getDebugState()) {
      env.DEBUG = "1";
      env.DR_TELEMETRY_DEBUG = "1"; // Enable telemetry exporter debug logging
      logDebug("Passing DEBUG=1 and DR_TELEMETRY_DEBUG=1 to subprocess");
    }
    if (isVerbose()) {
      env.VERBOSE = "1";
      logDebug("Passing VERBOSE=1 to subprocess");
    }

    // Only set auth token if provided
    if (authToken) {
      env.DR_AUTH_TOKEN = authToken;
    }

    // Set custom viewer path if provided
    if (options.viewerPath) {
      env.DR_VIEWER_PATH = options.viewerPath;
      logDebug(`Using custom viewer from: ${options.viewerPath}`);
    }

    const serverProcess = spawn("bun", ["run", serverEntryPath], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    let authTokenFromServer = "";
    let serverOutput = "";
    let serverStartupShown = false;

    // Capture output from server process
    if (serverProcess.stdout) {
      serverProcess.stdout.on("data", async (data) => {
        const output = data.toString().trim();
        serverOutput += output + "\n";

        // Extract token from output
        if (output.startsWith("TOKEN:")) {
          authTokenFromServer = output.substring(6);
          logDebug(`Received auth token from server: ${authTokenFromServer.substring(0, 8)}...`);

          // If we haven't shown startup info yet and now have the token, show it
          if (serverStartupShown && authEnabled && authTokenFromServer) {
            // Update the URL display with actual token
            console.log(
              ansis.cyan(`   Access URL: http://localhost:${port}?token=${authTokenFromServer}`)
            );
            console.log(ansis.dim(`   Auth token: ${authTokenFromServer}`));

            // Now that we have the token, open browser if needed
            if (!options.noBrowser) {
              try {
                const command = getOpenCommand();
                const url = `http://localhost:${port}?token=${authTokenFromServer}`;
                logDebug(`Opening browser with command: ${command} ${url}`);
                spawn(command, [url], {
                  detached: true,
                  stdio: "ignore",
                });
              } catch (error) {
                logVerbose("Could not auto-open browser (not critical)");
              }
            }
          }
        }

        // Server started message - defer detailed output if auth enabled
        if (output.includes("running at http://localhost")) {
          serverStartupShown = true;

          // End telemetry span for server startup
          if (isTelemetryEnabled && serverStartupSpan) {
            logDebug(
              "[Telemetry] Ending visualize.server.startup span (server started successfully)"
            );
            const { endSpan } = await import("../telemetry/index.js");
            endSpan(serverStartupSpan);
            serverStartupSpan = null;
            logDebug("[Telemetry] Span ended");
          }

          console.log(ansis.green(`✓ Visualization server started`));

          // Display access information (but may be incomplete if auth enabled and token not yet received)
          if (authEnabled) {
            const token = authTokenFromServer || authToken || "(pending)";
            if (authTokenFromServer) {
              // Token already received, show full info
              console.log(ansis.cyan(`   Access URL: http://localhost:${port}?token=${token}`));
              console.log(ansis.dim(`   Auth token: ${token}`));
            } else {
              // Token not yet received, just show port for now
              console.log(ansis.dim(`   Open http://localhost:${port} in your browser`));
              logDebug(`   (waiting for auth token...)`);
            }
          } else {
            console.log(ansis.dim(`   Open http://localhost:${port} in your browser`));
            console.log(ansis.yellow(`   ⚠ Authentication disabled`));
          }

          if (withDanger) {
            console.log(
              ansis.yellow(`   ⚠ Danger mode enabled - chat permissions will be skipped`)
            );
          }

          console.log(ansis.blueBright(`Model name: ${model.manifest.name}`));
          console.log(
            `Spec path:    ${ansis.cyan((await getSpecReferencePath()) || "Not found")}/spec`
          );
          console.log(`Model path:   ${ansis.cyan((await getModelPath()) || "Not found")}`);

          // Optionally open browser
          // If auth is enabled, delay opening until we have the token
          const shouldOpenBrowser = !options.noBrowser;
          logDebug(
            `Browser auto-open: ${shouldOpenBrowser ? "enabled" : "disabled"} (noBrowser=${options.noBrowser})`
          );

          if (shouldOpenBrowser && !authEnabled) {
            // Auth disabled: open immediately
            try {
              const command = getOpenCommand();
              const url = `http://localhost:${port}`;
              logDebug(`Opening browser with command: ${command} ${url}`);
              spawn(command, [url], {
                detached: true,
                stdio: "ignore",
              });
            } catch (error) {
              logVerbose("Could not auto-open browser (not critical)");
            }
          } else if (shouldOpenBrowser && authEnabled && !authTokenFromServer) {
            // Auth enabled but token not ready: will open when token arrives
            logDebug("Browser auto-open deferred until token is received");
          } else {
            logDebug("Browser auto-open disabled");
          }
        }

        // Log other output
        if (!output.startsWith("TOKEN:")) {
          logDebug(`[server] ${output}`);
        }
      });
    }

    // Capture stderr
    if (serverProcess.stderr) {
      serverProcess.stderr.on("data", (data) => {
        const output = data.toString().trim();
        if (output) {
          serverOutput += output + "\n";
          // Log stderr at debug level so --debug flag shows telemetry exporter logs
          logDebug(`[server stderr] ${output}`);
        }
      });
    }

    // Handle process close (fires after all stdio streams have closed)
    let rejectKeepAlive: ((reason: Error) => void) | null = null;

    serverProcess.on("close", (code) => {
      if (code !== 0) {
        // Include server output in error message if available (avoid separate logDebug to prevent minification issues)
        const message = serverOutput
          ? `Server exited with code ${code}\nServer output:\n${serverOutput}`
          : `Server exited with code ${code}`;

        // Record error in startup span if still active
        if (isTelemetryEnabled && serverStartupSpan) {
          (async () => {
            const { endSpan } = await import("../telemetry/index.js");
            if ("recordException" in serverStartupSpan) {
              (serverStartupSpan as any).recordException(new Error(message));
              (serverStartupSpan as any).setStatus({ code: 2, message }); // ERROR
            }
            endSpan(serverStartupSpan);
            serverStartupSpan = null;
          })();
        }

        // Print error before rejecting (CLI wrapper expects CLIError messages to be pre-printed)
        console.error(message);
        const error = new CLIError(message, code || 1);
        if (rejectKeepAlive) {
          rejectKeepAlive(error);
        }
      }
    });

    // Handle process errors
    serverProcess.on("error", (error) => {
      const message = `Failed to start visualization server: ${error.message}`;

      // Record error in startup span if still active
      if (isTelemetryEnabled && serverStartupSpan) {
        (async () => {
          const { endSpan } = await import("../telemetry/index.js");
          if ("recordException" in serverStartupSpan) {
            (serverStartupSpan as any).recordException(error);
            (serverStartupSpan as any).setStatus({ code: 2, message }); // ERROR
          }
          endSpan(serverStartupSpan);
          serverStartupSpan = null;
        })();
      }

      // Print error before throwing (CLI wrapper expects CLIError messages to be pre-printed)
      console.error(message);
      const cliError = new CLIError(message, 1);
      if (rejectKeepAlive) {
        rejectKeepAlive(cliError);
      }
    });

    // Setup periodic telemetry flushing for long-running command
    // Since the visualize command never completes (keep-alive pattern),
    // the cli.execute span would never end and export. We flush periodically
    // to ensure active spans are exported to the telemetry backend.
    let flushInterval: NodeJS.Timeout | null = null;
    if (isTelemetryEnabled) {
      logDebug("[Telemetry] Setting up periodic flush (every 15 seconds)");
      const { flushTelemetry } = await import("../telemetry/index.js");

      flushInterval = setInterval(async () => {
        logDebug("[Telemetry] Periodic flush: flushing pending spans...");
        try {
          await flushTelemetry();
          logDebug("[Telemetry] Periodic flush complete");
        } catch (error) {
          // Silently ignore flush errors - telemetry should never break the app
          logDebug(`[Telemetry] Periodic flush failed: ${error}`);
        }
      }, 15000); // Flush every 15 seconds
    }

    // Handle graceful shutdown on SIGINT (Ctrl-C) and SIGTERM
    const handleShutdown = async (signal: string) => {
      logDebug(`\n[${signal}] Shutting down visualization server gracefully...`);

      // Clear periodic flush interval
      if (flushInterval) {
        logDebug("[Telemetry] Stopping periodic flush");
        clearInterval(flushInterval);
        flushInterval = null;
      }

      // Forward signal to server process for graceful shutdown
      if (serverProcess && !serverProcess.killed) {
        logDebug("Sending termination signal to server process...");
        serverProcess.kill(signal as NodeJS.Signals);

        // Wait for server to exit (with timeout)
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            logDebug("Server shutdown timeout, forcing exit...");
            if (!serverProcess.killed) {
              serverProcess.kill("SIGKILL");
            }
            resolve();
          }, 3000); // 3 second timeout

          serverProcess.on("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }

      logDebug("Visualization server stopped");
      process.exit(0);
    };

    // Register signal handlers
    process.on("SIGINT", () => handleShutdown("SIGINT"));
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));

    // Keep parent process alive - reject promise if server fails
    await new Promise((_, reject) => {
      rejectKeepAlive = reject;
    });
  } catch (error) {
    // Throw CLIError instead of process.exit to allow telemetry shutdown
    // Note: Avoid side effects (like logDebug) before throw to prevent minification issues
    if (error instanceof CLIError) {
      // CLIError should have already printed its message
      throw error;
    }
    // Non-CLIError needs to be printed and wrapped
    const message = getErrorMessage(error);
    console.error(message);
    throw new CLIError(message, 1);
  }
}

/**
 * Get the appropriate command to open a URL
 */
function getOpenCommand(): string {
  const platform = process.platform;

  if (platform === "darwin") {
    return "open";
  }
  if (platform === "win32") {
    return "start";
  }
  // Linux and others
  return "xdg-open";
}
