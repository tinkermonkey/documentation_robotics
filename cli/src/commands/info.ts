/**
 * Show information about a model or layer
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';

export interface InfoOptions {
  layer?: string;
  verbose?: boolean;
  debug?: boolean;
}

export async function infoCommand(options: InfoOptions): Promise<void> {
  try {
    // Load model
    const model = await Model.load();
    const manifest = model.manifest;

    console.log('');
    console.log(ansis.bold(`${ansis.blue('Model:')} ${manifest.name}`));
    console.log(ansis.dim('─'.repeat(80)));

    console.log(`${ansis.gray('Name:')}          ${manifest.name}`);
    console.log(`${ansis.gray('Version:')}       ${manifest.version}`);
    console.log(`${ansis.gray('Spec Version:')}  ${manifest.specVersion}`);

    if (manifest.description) {
      console.log(`${ansis.gray('Description:')}   ${manifest.description}`);
    }

    if (manifest.author) {
      console.log(`${ansis.gray('Author:')}        ${manifest.author}`);
    }

    console.log(`${ansis.gray('Created:')}       ${manifest.created}`);
    console.log(`${ansis.gray('Modified:')}      ${manifest.modified}`);

    // Show layer information
    const layerNames = model.getLayerNames();
    if (layerNames.length > 0) {
      console.log('');
      console.log(ansis.bold('Layers:'));
      console.log(ansis.dim('─'.repeat(80)));

      if (options.layer) {
        // Show specific layer info
        const layer = await model.getLayer(options.layer);
        if (!layer) {
          console.error(ansis.red(`Error: Layer ${options.layer} not found`));
          process.exit(1);
        }

        const elements = layer.listElements();
        console.log(`${ansis.cyan(options.layer)}`);
        console.log(`  ${ansis.gray('Elements:')} ${elements.length}`);

        if (options.verbose && elements.length > 0) {
          console.log(`  ${ansis.gray('Details:')}`);
          const types = new Set(elements.map((e) => e.type));
          for (const type of types) {
            const count = elements.filter((e) => e.type === type).length;
            console.log(`    - ${type}: ${count}`);
          }
        }
      } else {
        // Show all layers summary
        const idWidth = 20;
        const countWidth = 10;

        for (const layerName of layerNames) {
          const layer = await model.getLayer(layerName);
          if (!layer) continue;

          const count = layer.listElements().length;
          const paddedName = layerName.padEnd(idWidth);
          const paddedCount = String(count).padEnd(countWidth);

          console.log(`${ansis.cyan(paddedName)} ${paddedCount} elements`);
        }
      }
    } else {
      console.log('');
      console.log(ansis.yellow('No layers found'));
    }

    console.log('');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
