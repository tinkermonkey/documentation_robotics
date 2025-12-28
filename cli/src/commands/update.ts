/**
 * Update an element
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { fileExists } from '../utils/file-io.js';
import { findElementLayer } from '../utils/element-utils.js';

export interface UpdateOptions {
  name?: string;
  description?: string;
  properties?: string;
  verbose?: boolean;
  debug?: boolean;
}

export async function updateCommand(id: string, options: UpdateOptions): Promise<void> {
  try {
    const rootPath = process.cwd();

    // Check if model exists
    if (!(await fileExists(`${rootPath}/model/manifest.yaml`))) {
      console.error(ansis.red('Error: No model found. Run "dr init" first.'));
      process.exit(1);
    }

    // Load model
    const model = await Model.load(rootPath, { lazyLoad: false });

    // Find element
    const layerName = await findElementLayer(model, id);
    if (!layerName) {
      console.error(ansis.red(`Error: Element ${id} not found`));
      process.exit(1);
    }

    const layer = (await model.getLayer(layerName))!;
    const element = layer.getElement(id)!;

    // Update fields
    let updated = false;

    if (options.name) {
      element.name = options.name;
      updated = true;
    }

    if (options.description !== undefined) {
      element.description = options.description || undefined;
      updated = true;
    }

    if (options.properties) {
      try {
        const newProperties = JSON.parse(options.properties);
        element.properties = { ...element.properties, ...newProperties };
        updated = true;
      } catch (e) {
        console.error(ansis.red('Error: Invalid JSON in --properties'));
        process.exit(1);
      }
    }

    if (!updated) {
      console.log(ansis.yellow('No fields specified for update'));
      process.exit(0);
    }

    // Save
    await model.saveLayer(layerName);
    await model.saveManifest();

    console.log(ansis.green(`✓ Updated element ${ansis.bold(id)}`));
    if (options.verbose) {
      console.log(ansis.dim(`  Layer: ${layerName}`));
      if (options.name) {
        console.log(ansis.dim(`  Name: ${options.name}`));
      }
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
