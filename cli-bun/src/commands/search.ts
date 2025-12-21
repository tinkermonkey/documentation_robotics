/**
 * Search for elements across the model
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { fileExists } from '../utils/file-io.js';

export interface SearchOptions {
  layer?: string;
  type?: string;
  json?: boolean;
  verbose?: boolean;
  debug?: boolean;
}

export async function searchCommand(query: string, options: SearchOptions): Promise<void> {
  try {
    const rootPath = process.cwd();

    // Check if model exists
    if (!(await fileExists(`${rootPath}/.dr/manifest.json`))) {
      console.error(ansis.red('Error: No model found. Run "dr init" first.'));
      process.exit(1);
    }

    // Load model
    const model = await Model.load(rootPath, { lazyLoad: false });

    // Collect all matching elements
    const results: Array<{
      layer: string;
      id: string;
      type: string;
      name: string;
      description?: string;
    }> = [];

    const queryLower = query.toLowerCase();

    for (const layerName of model.getLayerNames()) {
      // Skip if layer filter specified and doesn't match
      if (options.layer && layerName !== options.layer) {
        continue;
      }

      const layerObj = await model.getLayer(layerName);
      if (!layerObj) continue;

      for (const element of layerObj.listElements()) {
        // Apply filters
        if (options.type && element.type !== options.type) {
          continue;
        }

        // Match query against id and name
        const idMatch = element.id.toLowerCase().includes(queryLower);
        const nameMatch = element.name.toLowerCase().includes(queryLower);

        if (idMatch || nameMatch) {
          results.push({
            layer: layerName,
            id: element.id,
            type: element.type,
            name: element.name,
            description: element.description,
          });
        }
      }
    }

    // Output as JSON if requested
    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    // Display results
    if (results.length === 0) {
      console.log(ansis.yellow(`No elements matching "${query}"`));
      return;
    }

    console.log('');
    console.log(ansis.bold(`Found ${results.length} element(s) matching "${query}":`));
    console.log(ansis.dim('─'.repeat(80)));

    // Print header
    const layerWidth = 12;
    const idWidth = 28;
    const typeWidth = 12;
    const nameWidth = 28;

    console.log(
      `${ansis.cyan('LAYER'.padEnd(layerWidth))} ${ansis.cyan('ID'.padEnd(idWidth))} ${ansis.cyan('TYPE'.padEnd(typeWidth))} ${ansis.cyan('NAME')}`
    );
    console.log(ansis.dim('─'.repeat(80)));

    // Print rows
    for (const result of results) {
      const layer = result.layer.substring(0, layerWidth - 1).padEnd(layerWidth);
      const id = result.id.substring(0, idWidth - 1).padEnd(idWidth);
      const type = result.type.substring(0, typeWidth - 1).padEnd(typeWidth);
      const name = result.name.substring(0, nameWidth);

      console.log(`${ansis.blue(layer)} ${id} ${type} ${name}`);

      if (options.verbose && result.description) {
        console.log(ansis.dim(`  └─ ${result.description}`));
      }
    }

    console.log(ansis.dim('─'.repeat(80)));
    console.log('');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
