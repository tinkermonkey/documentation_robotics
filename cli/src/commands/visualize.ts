/**
 * Visualize command - Launch visualization server
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { VisualizationServer } from '../server/server.js';
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
    logDebug('Loading model for visualization...');

    // Load model with full content (no lazy loading)
    const model = await Model.load(process.cwd(), { lazyLoad: false });

    logVerbose(`Model loaded: ${model.manifest.name}`);

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

    // Create and start server
    const server = new VisualizationServer(model, { authEnabled, authToken, withDanger });

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

    await server.start(port);

    console.log(ansis.green(`✓ Visualization server started`));

    // Display access information
    if (authEnabled) {
      const token = server.getAuthToken();
      console.log(ansis.cyan(`   Access URL: http://localhost:${port}?token=${token}`));
      console.log(ansis.dim(`   Auth token: ${token}`));
    } else {
      console.log(ansis.dim(`   Open http://localhost:${port} in your browser`));
      console.log(ansis.yellow(`   ⚠ Authentication disabled`));
    }

    if (withDanger) {
      console.log(ansis.yellow(`   ⚠ Danger mode enabled - chat permissions will be skipped`));
    }

    logVerbose(`   Model: ${model.manifest.name} (${model.getLayerNames().length} layers)`);

    // Optionally open browser
    const shouldOpenBrowser = !options.noBrowser;
    logDebug(`Browser auto-open: ${shouldOpenBrowser ? 'enabled' : 'disabled'} (noBrowser=${options.noBrowser})`);
    if (shouldOpenBrowser) {
      // Only open browser if explicitly enabled (not in tests or CI)
      try {
        const command = getOpenCommand();
        // Include token in URL if auth is enabled
        const url = authEnabled
          ? `http://localhost:${port}?token=${server.getAuthToken()}`
          : `http://localhost:${port}`;
        logDebug(`Opening browser with command: ${command} ${url}`);
        Bun.spawn([command, url], {
          stdout: 'ignore',
          stderr: 'ignore'
        });
      } catch (error) {
        logVerbose('Could not auto-open browser (not critical)');
      }
    } else {
      logDebug('Browser auto-open disabled');
    }

    // Keep server running
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
