/**
 * Visualize command - Launch visualization server
 */

import ansis from 'ansis';
import { spawn } from 'child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { Model } from '../core/model.js';
import { logVerbose, logDebug } from '../utils/globals.js';

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

          // Optionally open browser (use pending URL if token not ready yet)
          const shouldOpenBrowser = !options.noBrowser;
          logDebug(`Browser auto-open: ${shouldOpenBrowser ? 'enabled' : 'disabled'} (noBrowser=${options.noBrowser})`);
          if (shouldOpenBrowser) {
            try {
              const command = getOpenCommand();
              const url = authEnabled && authTokenFromServer
                ? `http://localhost:${port}?token=${authTokenFromServer}`
                : `http://localhost:${port}`;
              logDebug(`Opening browser with command: ${command} ${url}`);
              spawn(command, [url], {
                detached: true,
                stdio: 'ignore',
              });
            } catch (error) {
              logVerbose('Could not auto-open browser (not critical)');
            }
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
        console.error(
          ansis.red(`Visualization server exited with code ${code}`)
        );
        if (serverOutput) {
          logDebug(`Server output:\n${serverOutput}`);
        }
        process.exit(code || 1);
      }
    });

    // Handle process errors
    serverProcess.on('error', (error) => {
      throw new Error(
        `Failed to start visualization server: ${error.message}`
      );
    });

    // Keep parent process alive
    await new Promise(() => {
      // Never resolves - keeps process alive
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    logDebug(`Stack: ${error instanceof Error ? error.stack : 'N/A'}`);
    process.exit(1);
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
