/**
 * List elements in a layer
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { fileExists } from '../utils/file-io.js';

export interface ListOptions {
  type?: string;
  json?: boolean;
  verbose?: boolean;
  debug?: boolean;
}

export async function listCommand(layer: string, options: ListOptions): Promise<void> {
  try {
    const rootPath = process.cwd();

    // Check if model exists
    if (!(await fileExists(`${rootPath}/.dr/manifest.json`))) {
      console.error(ansis.red('Error: No model found. Run "dr init" first.'));
      process.exit(1);
    }

    // Load model
    const model = await Model.load(rootPath, { lazyLoad: false });

    // Get layer
    const layerObj = await model.getLayer(layer);
    if (!layerObj) {
      console.error(ansis.red(`Error: Layer ${layer} not found`));
      process.exit(1);
    }

    // Get elements
    let elements = layerObj.listElements();

    // Filter by type if specified
    if (options.type) {
      elements = elements.filter((e) => e.type === options.type);
    }

    // Output as JSON if requested
    if (options.json) {
      console.log(JSON.stringify(elements.map((e) => e.toJSON()), null, 2));
      return;
    }

    // Display as table
    if (elements.length === 0) {
      console.log(ansis.yellow(`No elements in ${layer} layer`));
      return;
    }

    console.log('');
    console.log(ansis.bold(`Elements in ${ansis.cyan(layer)} layer:`));
    console.log(ansis.dim('─'.repeat(80)));

    // Print header
    const idWidth = 30;
    const typeWidth = 15;
    const nameWidth = 35;

    console.log(
      `${ansis.cyan('ID'.padEnd(idWidth))} ${ansis.cyan('TYPE'.padEnd(typeWidth))} ${ansis.cyan('NAME')}`
    );
    console.log(ansis.dim('─'.repeat(80)));

    // Print rows
    for (const element of elements) {
      const id = element.id.substring(0, idWidth - 1).padEnd(idWidth);
      const type = element.type.substring(0, typeWidth - 1).padEnd(typeWidth);
      const name = element.name.substring(0, nameWidth);

      console.log(`${id} ${type} ${name}`);

      if (options.verbose && element.description) {
        console.log(ansis.dim(`  └─ ${element.description}`));
      }
    }

    console.log(ansis.dim('─'.repeat(80)));
    console.log(ansis.dim(`Total: ${elements.length} element(s)`));
    console.log('');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
