/**
 * Update an element
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { resolveModelRoot } from '../utils/model-path.js';
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
    // Resolve model path (supports multiple layouts)
    const { rootPath } = await resolveModelRoot({ cwd: process.cwd() });

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

    // Capture before state for changeset tracking
    const beforeState = element.toJSON();

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

    // Track change in active changeset if present
    const activeChangeset = model.getActiveChangesetContext();
    await activeChangeset.trackChange(
      'update',
      id,
      layerName,
      beforeState as unknown as Record<string, unknown>,
      element.toJSON() as unknown as Record<string, unknown>
    );

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
