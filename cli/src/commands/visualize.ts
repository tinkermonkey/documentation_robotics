/**
 * Visualize command - Launch visualization server
 */

import ansis from 'ansis';
import { spawn } from 'child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { Model } from '../core/model.js';
import { logVerbose, logDebug } from '../utils/globals.js';
import { CLIError } from '../utils/errors.js';

export interface VisualizeOptions {
  port?: number;
  noBrowser?: boolean;
  noAuth?: boolean;
  token?: string;
  verbose?: boolean;
  debug?: boolean;
  withDanger?: boolean;
}

export async function visualizeCommand(
  options: VisualizeOptions & { port?: string }
): Promise<void> {
  try {
    logDebug('Loading model for validation...');

    // Load model to validate it exists (without full content to be quick)
    const model = await Model.load(process.cwd(), { lazyLoad: true });

    logVerbose(`Model validated: ${model.manifest.name}`);

    // Parse and validate port
    let port = 8080;
    if (options.port) {
      const portNum = parseInt(String(options.port), 10);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        throw new Error(
          `Invalid port number: ${options.port}. Port must be between 1 and 65535.`
        );
      }
      port = portNum;
    }

    // Determine auth settings
    const authEnabled = !options.noAuth; // Auth enabled by default unless --no-auth flag
    const authToken = options.token; // Optional token for testing
    const withDanger = options.withDanger || false; // Danger mode disabled by default

    logDebug(`Starting visualization server on port ${port}`);
    logDebug(`Authentication: ${authEnabled ? 'enabled' : 'disabled'}`);
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

    // Spawn server in Bun subprocess with environment variables
    const env: Record<string, string> = {
      ...process.env,
      DR_VISUALIZE_PORT: String(port),
      DR_PROJECT_PATH: process.cwd(),
      DR_AUTH_ENABLED: String(authEnabled),
      DR_WITH_DANGER: String(withDanger),
    };

    // Only set auth token if provided
    if (authToken) {
      env.DR_AUTH_TOKEN = authToken;
    }

    const serverProcess = spawn(
      'bun',
      ['run', serverEntryPath],
      {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      }
    );

    let authTokenFromServer = '';
    let serverOutput = '';
    let serverStartupShown = false;

    // Capture output from server process
    if (serverProcess.stdout) {
      serverProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        serverOutput += output + '\n';

        // Extract token from output
        if (output.startsWith('TOKEN:')) {
          authTokenFromServer = output.substring(6);
          logDebug(`Received auth token from server: ${authTokenFromServer.substring(0, 8)}...`);

          // If we haven't shown startup info yet and now have the token, show it
          if (serverStartupShown && authEnabled && authTokenFromServer) {
            // Update the URL display with actual token
            console.log(ansis.cyan(`   Access URL: http://localhost:${port}?token=${authTokenFromServer}`));
            console.log(ansis.dim(`   Auth token: ${authTokenFromServer}`));

            // Now that we have the token, open browser if needed
            if (!options.noBrowser) {
              try {
                const command = getOpenCommand();
                const url = `http://localhost:${port}?token=${authTokenFromServer}`;
                logDebug(`Opening browser with command: ${command} ${url}`);
                spawn(command, [url], {
                  detached: true,
                  stdio: 'ignore',
                });
              } catch (error) {
                logVerbose('Could not auto-open browser (not critical)');
              }
            }
          }
        }

        // Server started message - defer detailed output if auth enabled
        if (output.includes('running at http://localhost')) {
          serverStartupShown = true;
          console.log(ansis.green(`✓ Visualization server started`));

          // Display access information (but may be incomplete if auth enabled and token not yet received)
          if (authEnabled) {
            const token = authTokenFromServer || authToken || '(pending)';
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
            console.log(ansis.yellow(`   ⚠ Danger mode enabled - chat permissions will be skipped`));
          }

          logVerbose(`   Model: ${model.manifest.name}`);

          // Optionally open browser
          // If auth is enabled, delay opening until we have the token
          const shouldOpenBrowser = !options.noBrowser;
          logDebug(`Browser auto-open: ${shouldOpenBrowser ? 'enabled' : 'disabled'} (noBrowser=${options.noBrowser})`);

          if (shouldOpenBrowser && !authEnabled) {
            // Auth disabled: open immediately
            try {
              const command = getOpenCommand();
              const url = `http://localhost:${port}`;
              logDebug(`Opening browser with command: ${command} ${url}`);
              spawn(command, [url], {
                detached: true,
                stdio: 'ignore',
              });
            } catch (error) {
              logVerbose('Could not auto-open browser (not critical)');
            }
          } else if (shouldOpenBrowser && authEnabled && !authTokenFromServer) {
            // Auth enabled but token not ready: will open when token arrives
            logDebug('Browser auto-open deferred until token is received');
          } else {
            logDebug('Browser auto-open disabled');
          }
        }

        // Log other output
        if (!output.startsWith('TOKEN:')) {
          logDebug(`[server] ${output}`);
        }
      });
    }

    // Capture stderr
    if (serverProcess.stderr) {
      serverProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          logVerbose(`[server stderr] ${output}`);
        }
      });
    }

    // Handle process exit
    serverProcess.on('exit', (code) => {
      if (code !== 0) {
        // Include server output in error message if available (avoid separate logDebug to prevent minification issues)
        const message = serverOutput
          ? `Server exited with code ${code}\nServer output:\n${serverOutput}`
          : `Server exited with code ${code}`;
        throw new CLIError(message, code || 1);
      }
    });

    // Handle process errors
    serverProcess.on('error', (error) => {
      throw new CLIError(
        `Failed to start visualization server: ${error.message}`,
        1
      );
    });

    // Keep parent process alive
    await new Promise(() => {
      // Never resolves - keeps process alive
    });
  } catch (error) {
    // Throw CLIError instead of process.exit to allow telemetry shutdown
    // Note: Avoid side effects (like logDebug) before throw to prevent minification issues
    if (error instanceof CLIError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CLIError(message, 1);
  }
}

/**
 * Get the appropriate command to open a URL
 */
function getOpenCommand(): string {
  const platform = process.platform;

  if (platform === 'darwin') {
    return 'open';
  }
  if (platform === 'win32') {
    return 'start';
  }
  // Linux and others
  return 'xdg-open';
}
