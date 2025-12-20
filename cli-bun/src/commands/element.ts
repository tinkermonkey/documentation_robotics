/**
 * Element subcommands
 */

import { Command } from 'commander';
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

export function elementCommands(program: Command): void {
  program
    .command('add <layer> <type> <id>')
    .description('Add an element to a layer')
    .option('--name <name>', 'Element name')
    .option('--description <desc>', 'Element description')
    .option('--properties <json>', 'Element properties (JSON)')
    .action(async (layer, type, id, options) => {
      try {
        const rootPath = process.cwd();

        if (!(await fileExists(`${rootPath}/.dr/manifest.json`))) {
          console.error(ansis.red('Error: No model found. Run "dr init" first.'));
          process.exit(1);
        }

        const model = await Model.load(rootPath, { lazyLoad: false });
        let layerObj = await model.getLayer(layer);

        if (!layerObj) {
          const { Layer } = await import('../core/layer.js');
          layerObj = new Layer(layer);
          model.addLayer(layerObj);
        }

        let properties: Record<string, unknown> = {};
        if (options.properties) {
          try {
            properties = JSON.parse(options.properties);
          } catch (e) {
            console.error(ansis.red('Error: Invalid JSON in --properties'));
            process.exit(1);
          }
        }

        const { Element } = await import('../core/element.js');
        const element = new Element({
          id,
          type,
          name: options.name || id,
          description: options.description,
          properties,
        });

        if (layerObj.getElement(id)) {
          console.error(ansis.red(`Error: Element ${id} already exists in ${layer} layer`));
          process.exit(1);
        }

        layerObj.addElement(element);
        await model.saveLayer(layer);
        await model.saveManifest();

        console.log(ansis.green(`✓ Added element ${ansis.bold(id)} to ${ansis.bold(layer)} layer`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(ansis.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  program
    .command('update <id>')
    .description('Update an element')
    .option('--name <name>', 'New element name')
    .option('--description <desc>', 'New description')
    .option('--properties <json>', 'Updated properties (JSON)')
    .action(async (id, options) => {
      try {
        const rootPath = process.cwd();

        if (!(await fileExists(`${rootPath}/.dr/manifest.json`))) {
          console.error(ansis.red('Error: No model found. Run "dr init" first.'));
          process.exit(1);
        }

        const model = await Model.load(rootPath, { lazyLoad: false });
        const layerName = await findElementLayer(model, id);

        if (!layerName) {
          console.error(ansis.red(`Error: Element ${id} not found`));
          process.exit(1);
        }

        const layer = (await model.getLayer(layerName))!;
        const element = layer.getElement(id)!;

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

        await model.saveLayer(layerName);
        await model.saveManifest();

        console.log(ansis.green(`✓ Updated element ${ansis.bold(id)}`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(ansis.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  program
    .command('delete <id>')
    .description('Delete an element')
    .option('--force', 'Skip confirmation prompt')
    .action(async (id, options) => {
      try {
        const rootPath = process.cwd();

        if (!(await fileExists(`${rootPath}/.dr/manifest.json`))) {
          console.error(ansis.red('Error: No model found. Run "dr init" first.'));
          process.exit(1);
        }

        const model = await Model.load(rootPath, { lazyLoad: false });
        const layerName = await findElementLayer(model, id);

        if (!layerName) {
          console.error(ansis.red(`Error: Element ${id} not found`));
          process.exit(1);
        }

        if (!options.force) {
          const { confirm } = await import('@clack/prompts');
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
        const deleted = layer.deleteElement(id);

        if (!deleted) {
          console.error(ansis.red(`Error: Failed to delete element ${id}`));
          process.exit(1);
        }

        await model.saveLayer(layerName);
        await model.saveManifest();

        console.log(ansis.green(`✓ Deleted element ${ansis.bold(id)}`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(ansis.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  program
    .command('show <id>')
    .description('Display element details')
    .action(async (id) => {
      try {
        const rootPath = process.cwd();

        if (!(await fileExists(`${rootPath}/.dr/manifest.json`))) {
          console.error(ansis.red('Error: No model found. Run "dr init" first.'));
          process.exit(1);
        }

        const model = await Model.load(rootPath, { lazyLoad: false });
        const layerName = await findElementLayer(model, id);

        if (!layerName) {
          console.error(ansis.red(`Error: Element ${id} not found`));
          process.exit(1);
        }

        const layer = (await model.getLayer(layerName))!;
        const element = layer.getElement(id)!;

        console.log('');
        console.log(ansis.bold(`${ansis.blue('Element:')} ${id}`));
        console.log(ansis.dim('─'.repeat(60)));
        console.log(`${ansis.gray('Layer:')}       ${layerName}`);
        console.log(`${ansis.gray('Type:')}        ${element.type}`);
        console.log(`${ansis.gray('Name:')}        ${element.name}`);

        if (element.description) {
          console.log(`${ansis.gray('Description:')} ${element.description}`);
        }

        if (Object.keys(element.properties).length > 0) {
          console.log('');
          console.log(ansis.bold('Properties:'));
          for (const [key, value] of Object.entries(element.properties)) {
            const displayValue =
              typeof value === 'string' ? value : JSON.stringify(value, null, 2);
            console.log(`  ${ansis.cyan(key)}: ${displayValue}`);
          }
        }

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
    });

  program
    .command('list <layer>')
    .description('List elements in a layer')
    .option('--type <type>', 'Filter by element type')
    .option('--json', 'Output as JSON')
    .action(async (layer, options) => {
      try {
        const rootPath = process.cwd();

        if (!(await fileExists(`${rootPath}/.dr/manifest.json`))) {
          console.error(ansis.red('Error: No model found. Run "dr init" first.'));
          process.exit(1);
        }

        const model = await Model.load(rootPath, { lazyLoad: false });
        const layerObj = await model.getLayer(layer);

        if (!layerObj) {
          console.error(ansis.red(`Error: Layer ${layer} not found`));
          process.exit(1);
        }

        let elements = layerObj.listElements();

        if (options.type) {
          elements = elements.filter((e) => e.type === options.type);
        }

        if (options.json) {
          console.log(JSON.stringify(elements.map((e) => e.toJSON()), null, 2));
          return;
        }

        if (elements.length === 0) {
          console.log(ansis.yellow(`No elements in ${layer} layer`));
          return;
        }

        console.log('');
        console.log(ansis.bold(`Elements in ${ansis.cyan(layer)} layer:`));
        console.log(ansis.dim('─'.repeat(80)));

        const idWidth = 30;
        const typeWidth = 15;
        const nameWidth = 35;

        console.log(
          `${ansis.cyan('ID'.padEnd(idWidth))} ${ansis.cyan('TYPE'.padEnd(typeWidth))} ${ansis.cyan('NAME')}`
        );
        console.log(ansis.dim('─'.repeat(80)));

        for (const element of elements) {
          const id = element.id.substring(0, idWidth - 1).padEnd(idWidth);
          const type = element.type.substring(0, typeWidth - 1).padEnd(typeWidth);
          const name = element.name.substring(0, nameWidth);

          console.log(`${id} ${type} ${name}`);
        }

        console.log(ansis.dim('─'.repeat(80)));
        console.log(ansis.dim(`Total: ${elements.length} element(s)`));
        console.log('');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(ansis.red(`Error: ${message}`));
        process.exit(1);
      }
    });
}
