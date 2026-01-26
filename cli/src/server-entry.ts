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

async function main() {
  try {
    // Load model with full content
    const model = await Model.load(projectPath, { lazyLoad: false });

    // Create and start server
    const server = new VisualizationServer(model, { authEnabled, authToken, withDanger });
    await server.start(port);

    // Output token for parent process to read
    if (authEnabled) {
      console.log(`TOKEN:${server.getAuthToken()}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    if (error instanceof Error) {
      console.error(`Stack: ${error.stack}`);
    }
    process.exit(1);
  }
}

main();
