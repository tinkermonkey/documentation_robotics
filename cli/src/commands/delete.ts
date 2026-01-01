/**
 * Delete an element
 */

import { confirm } from '@clack/prompts';
import ansis from 'ansis';
import { Model } from '../core/model.js';
import { resolveModelRoot } from '../utils/model-path.js';
import { findElementLayer } from '../utils/element-utils.js';

export interface DeleteOptions {
  force?: boolean;
  verbose?: boolean;
  debug?: boolean;
}

export async function deleteCommand(id: string, options: DeleteOptions): Promise<void> {
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

    // Capture element state for changeset tracking before deletion
    const element = layer.getElement(id)!;
    const beforeState = element.toJSON();

    // Delete element
    const deleted = layer.deleteElement(id);
    if (!deleted) {
      console.error(ansis.red(`Error: Failed to delete element ${id}`));
      process.exit(1);
    }

    // Delete all relationships involving this element
    model.relationships.deleteForElement(id);

    // Track change in active changeset if present
    const activeChangeset = model.getActiveChangesetContext();
    await activeChangeset.trackChange(
      'delete',
      id,
      layerName,
      beforeState as unknown as Record<string, unknown>,
      undefined
    );

    // Save layer and manifest
    await model.saveLayer(layerName);

    // Only save relationships if they were modified
    if (model.relationships.isDirty()) {
      await model.saveRelationships();
    }

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
