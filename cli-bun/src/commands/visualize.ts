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
  verbose?: boolean;
  debug?: boolean;
}

export async function visualizeCommand(
  options: VisualizeOptions & { port?: string }
): Promise<void> {
  try {
    logDebug('Loading model for visualization...');

    // Load model with full content (no lazy loading)
    const model = await Model.load(process.cwd(), { lazyLoad: false });

    logVerbose(`Model loaded: ${model.manifest.name}`);

    // Create and start server
    const server = new VisualizationServer(model);
    const port = options.port ? parseInt(String(options.port), 10) : 8080;

    logDebug(`Starting visualization server on port ${port}`);
    await server.start(port);

    console.log(ansis.green(`✓ Visualization server started`));
    console.log(ansis.dim(`   Open http://localhost:${port} in your browser`));
    logVerbose(`   Model: ${model.manifest.name} (${model.getLayerNames().length} layers)`);

    // Optionally open browser
    if (!options.noBrowser) {
      try {
        const command = getOpenCommand();
        logDebug(`Opening browser with command: ${command}`);
        Bun.spawn([command, `http://localhost:${port}`]);
      } catch (error) {
        logVerbose('Could not auto-open browser (not critical)');
      }
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
