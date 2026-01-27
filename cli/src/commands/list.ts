/**
 * List elements in a layer
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { CLIError, ErrorCategory, ModelNotFoundError, handleError } from '../utils/errors.js';

export interface ListOptions {
  type?: string;
  json?: boolean;
  verbose?: boolean;
  debug?: boolean;
  model?: string;
}

export async function listCommand(layer: string, options: ListOptions): Promise<void> {
  try {
    // Load model (with error handling for missing models)
    let model: Model;
    try {
      model = await Model.load(options.model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Check for any model-not-found error pattern
      if (message.includes('No DR project') ||
          message.includes('Model not found') ||
          message.includes('No model found') ||
          message.includes('Could not find documentation_robotics')) {
        throw new ModelNotFoundError();
      }
      throw error;
    }

    // Get layer
    const layerObj = await model.getLayer(layer);
    if (!layerObj) {
      throw new CLIError(
        `Layer ${layer} not found`,
        ErrorCategory.NOT_FOUND,
        [
          'Use "dr list" to see all available layers',
          'Use "dr add <layer> <type> <name>" to add an element to a new layer',
        ]
      );
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
    handleError(error);
  }
}
