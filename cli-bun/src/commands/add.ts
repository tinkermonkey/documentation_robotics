/**
 * Add an element to a layer
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { Layer } from '../core/layer.js';
import { Element } from '../core/element.js';
import { fileExists } from '../utils/file-io.js';

export interface AddOptions {
  name?: string;
  description?: string;
  properties?: string;
  verbose?: boolean;
  debug?: boolean;
}

export async function addCommand(
  layer: string,
  type: string,
  id: string,
  options: AddOptions
): Promise<void> {
  try {
    const rootPath = process.cwd();

    // Check if model exists
    if (!(await fileExists(`${rootPath}/.dr/manifest.json`))) {
      console.error(ansis.red('Error: No model found. Run "dr init" first.'));
      process.exit(1);
    }

    // Load model
    const model = await Model.load(rootPath, { lazyLoad: false });

    // Get or create layer
    let layerObj = await model.getLayer(layer);
    if (!layerObj) {
      layerObj = new Layer(layer);
      model.addLayer(layerObj);
    }

    // Parse properties if provided
    let properties: Record<string, unknown> = {};
    if (options.properties) {
      try {
        properties = JSON.parse(options.properties);
      } catch (e) {
        console.error(ansis.red('Error: Invalid JSON in --properties'));
        process.exit(1);
      }
    }

    // Create element
    const element = new Element({
      id,
      type,
      name: options.name || id,
      description: options.description,
      properties,
    });

    // Check if element already exists
    if (layerObj.getElement(id)) {
      console.error(ansis.red(`Error: Element ${id} already exists in ${layer} layer`));
      process.exit(1);
    }

    // Add to layer
    layerObj.addElement(element);

    // Save
    await model.saveLayer(layer);
    await model.saveManifest();

    console.log(ansis.green(`✓ Added element ${ansis.bold(id)} to ${ansis.bold(layer)} layer`));
    if (options.verbose) {
      console.log(ansis.dim(`  Type: ${type}`));
      console.log(ansis.dim(`  Name: ${options.name || id}`));
      if (options.description) {
        console.log(ansis.dim(`  Description: ${options.description}`));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
