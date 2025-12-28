/**
 * Delete an element
 */

import { confirm } from '@clack/prompts';
import ansis from 'ansis';
import { Model } from '../core/model.js';
import { fileExists } from '../utils/file-io.js';
import { findElementLayer } from '../utils/element-utils.js';

export interface DeleteOptions {
  force?: boolean;
  verbose?: boolean;
  debug?: boolean;
}

export async function deleteCommand(id: string, options: DeleteOptions): Promise<void> {
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

    // Confirm deletion unless --force
    if (!options.force) {
      const confirmed = await confirm({
        message: `Delete element ${ansis.bold(id)}? This cannot be undone.`,
        initialValue: false,
      });

      if (!confirmed) {
        console.log(ansis.dim('Cancelled'));
        process.exit(0);
      }
    }

    const layer = (await model.getLayer(layerName))!;

    // Delete element
    const deleted = layer.deleteElement(id);
    if (!deleted) {
      console.error(ansis.red(`Error: Failed to delete element ${id}`));
      process.exit(1);
    }

    // Save
    await model.saveLayer(layerName);
    await model.saveManifest();

    console.log(ansis.green(`✓ Deleted element ${ansis.bold(id)}`));
    if (options.verbose) {
      console.log(ansis.dim(`  Layer: ${layerName}`));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
