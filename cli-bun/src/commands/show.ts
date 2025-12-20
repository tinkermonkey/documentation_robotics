/**
 * Show detailed information about an element
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { fileExists } from '../utils/file-io.js';

/**
 * Find which layer contains an element by ID
 */
async function findElementLayer(model: Model, elementId: string): Promise<string | undefined> {
  for (const layerName of model.getLayerNames()) {
    const layer = await model.getLayer(layerName);
    if (layer && layer.getElement(elementId)) {
      return layerName;
    }
  }
  return undefined;
}

export async function showCommand(id: string): Promise<void> {
  try {
    const rootPath = process.cwd();

    // Check if model exists
    if (!(await fileExists(`${rootPath}/.dr/manifest.json`))) {
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

    // Display element information
    console.log('');
    console.log(ansis.bold(`${ansis.blue('Element:')} ${id}`));
    console.log(ansis.dim('─'.repeat(60)));
    console.log(`${ansis.gray('Layer:')}       ${layerName}`);
    console.log(`${ansis.gray('Type:')}        ${element.type}`);
    console.log(`${ansis.gray('Name:')}        ${element.name}`);

    if (element.description) {
      console.log(`${ansis.gray('Description:')} ${element.description}`);
    }

    // Display properties
    if (Object.keys(element.properties).length > 0) {
      console.log('');
      console.log(ansis.bold('Properties:'));
      for (const [key, value] of Object.entries(element.properties)) {
        const displayValue =
          typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        console.log(`  ${ansis.cyan(key)}: ${displayValue}`);
      }
    }

    // Display references
    if (element.references && element.references.length > 0) {
      console.log('');
      console.log(ansis.bold('References:'));
      for (const ref of element.references) {
        console.log(`  → ${ansis.yellow(ref.target)} (${ref.type})`);
        if (ref.description) {
          console.log(`    ${ansis.dim(ref.description)}`);
        }
      }
    }

    // Display relationships
    if (element.relationships && element.relationships.length > 0) {
      console.log('');
      console.log(ansis.bold('Relationships:'));
      for (const rel of element.relationships) {
        console.log(`  ${ansis.magenta(rel.predicate)}: ${rel.target}`);
        if (rel.properties) {
          const propStr = Object.entries(rel.properties)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
          console.log(`    ${ansis.dim(propStr)}`);
        }
      }
    }

    console.log('');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
