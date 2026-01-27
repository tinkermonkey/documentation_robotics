/**
 * Show detailed information about an element
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { findElementLayer } from '../utils/element-utils.js';
import { CLIError, ErrorCategory, handleError } from '../utils/errors.js';

export async function showCommand(id: string, options: { model?: string } = {}): Promise<void> {
  try {
    // Load model (optionally from specified path)
    const model = await Model.load(options.model);

    // Find element
    const layerName = await findElementLayer(model, id);
    if (!layerName) {
      throw new CLIError(
        `Element ${id} not found`,
        ErrorCategory.NOT_FOUND,
        [
          `Use "dr search ${id}" to find similar elements`,
          'Use "dr list <layer>" to list all elements in a layer',
        ]
      );
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

    // Display source code location if present
    const sourceRef = element.getSourceReference();
    if (sourceRef) {
      console.log('');
      console.log(ansis.bold('Source Code Location:'));
      console.log(`  ${ansis.gray('Provenance:')} ${sourceRef.provenance}`);

      sourceRef.locations.forEach((loc, idx) => {
        console.log(`  ${ansis.gray('Location ' + (idx + 1) + ':')}`);
        console.log(`    File: ${ansis.cyan(loc.file)}`);
        if (loc.symbol) {
          console.log(`    Symbol: ${ansis.cyan(loc.symbol)}`);
        }
      });

      if (sourceRef.repository) {
        console.log(`  ${ansis.gray('Repository Context:')}`);
        if (sourceRef.repository.url) {
          console.log(`    Remote: ${ansis.cyan(sourceRef.repository.url)}`);
        }
        if (sourceRef.repository.commit) {
          console.log(`    Commit: ${ansis.cyan(sourceRef.repository.commit)}`);
        }
      }
    }

    console.log('');
  } catch (error) {
    handleError(error);
  }
}
