/**
 * Relationship subcommands for managing intra-layer relationships
 */

import { Command } from 'commander';
import ansis from 'ansis';
import { Model } from '../core/model.js';
import { fileExists } from '../utils/file-io.js';
import { findElementLayer } from '../utils/element-utils.js';

export function relationshipCommands(program: Command): void {
  program
    .command('add <source> <target>')
    .description('Add a relationship between elements')
    .requiredOption('--predicate <predicate>', 'Relationship predicate (e.g., depends-on, implements)')
    .option('--properties <json>', 'Relationship properties (JSON)')
    .addHelpText(
      'after',
      `
Examples:
  $ dr relationship add business-service-a business-service-b --predicate depends-on
  $ dr relationship add api-endpoint-1 api-endpoint-2 --predicate "service-of"
  $ dr relationship add element-1 element-2 --predicate implements --properties '{"method":"REST"}'`
    )
    .action(async (source, target, options) => {
      try {
        const rootPath = process.cwd();

        if (!(await fileExists(`${rootPath}/model/manifest.yaml`))) {
          console.error(ansis.red('Error: No model found. Run "dr init" first.'));
          process.exit(1);
        }

        const model = await Model.load(rootPath, { lazyLoad: false });

        // Find source element
        const sourceLayerName = await findElementLayer(model, source);
        if (!sourceLayerName) {
          console.error(ansis.red(`Error: Source element ${source} not found`));
          process.exit(1);
        }

        // Find target element
        const targetLayerName = await findElementLayer(model, target);
        if (!targetLayerName) {
          console.error(ansis.red(`Error: Target element ${target} not found`));
          process.exit(1);
        }

        // Relationships are intra-layer only
        if (sourceLayerName !== targetLayerName) {
          console.error(
            ansis.red(
              'Error: Relationships must be within the same layer'
            )
          );
          process.exit(1);
        }

        const layer = (await model.getLayer(sourceLayerName))!;
        const sourceElement = layer.getElement(source)!;

        // Parse properties if provided
        let properties: Record<string, unknown> | undefined;
        if (options.properties) {
          try {
            properties = JSON.parse(options.properties);
          } catch (e) {
            console.error(ansis.red('Error: Invalid JSON in --properties'));
            process.exit(1);
          }
        }

        // Add relationship
        sourceElement.relationships.push({
          source,
          target,
          predicate: options.predicate,
          properties,
        });

        // Save
        await model.saveLayer(sourceLayerName);
        await model.saveManifest();

        console.log(
          ansis.green(
            `✓ Added relationship: ${ansis.bold(source)} ${options.predicate} ${ansis.bold(target)}`
          )
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(ansis.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  program
    .command('delete <source> <target>')
    .description('Delete a relationship')
    .option('--predicate <predicate>', 'Specific predicate to delete (optional, delete all if not specified)')
    .option('--force', 'Skip confirmation prompt')
    .addHelpText(
      'after',
      `
Examples:
  $ dr relationship delete element-1 element-2 --predicate depends-on
  $ dr relationship delete element-1 element-2 --force`
    )
    .action(async (source, target, options) => {
      try {
        const rootPath = process.cwd();

        if (!(await fileExists(`${rootPath}/model/manifest.yaml`))) {
          console.error(ansis.red('Error: No model found. Run "dr init" first.'));
          process.exit(1);
        }

        const model = await Model.load(rootPath, { lazyLoad: false });

        // Find source element
        const sourceLayerName = await findElementLayer(model, source);
        if (!sourceLayerName) {
          console.error(ansis.red(`Error: Source element ${source} not found`));
          process.exit(1);
        }

        const layer = (await model.getLayer(sourceLayerName))!;
        const sourceElement = layer.getElement(source)!;

        // Find relationships to delete
        const toDelete = sourceElement.relationships.filter(
          (rel) =>
            rel.target === target &&
            (!options.predicate || rel.predicate === options.predicate)
        );

        if (toDelete.length === 0) {
          console.error(ansis.red('Error: No matching relationships found'));
          process.exit(1);
        }

        // Confirm deletion unless --force
        if (!options.force) {
          const { confirm } = await import('@clack/prompts');
          const confirmed = await confirm({
            message: `Delete ${toDelete.length} relationship(s)? This cannot be undone.`,
            initialValue: false,
          });

          if (!confirmed) {
            console.log(ansis.dim('Cancelled'));
            process.exit(0);
          }
        }

        // Delete relationships
        sourceElement.relationships = sourceElement.relationships.filter(
          (rel) =>
            !(
              rel.target === target &&
              (!options.predicate || rel.predicate === options.predicate)
            )
        );

        // Save
        await model.saveLayer(sourceLayerName);
        await model.saveManifest();

        console.log(
          ansis.green(
            `✓ Deleted ${toDelete.length} relationship(s) from ${ansis.bold(source)} to ${ansis.bold(target)}`
          )
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(ansis.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  program
    .command('list <id>')
    .description('List relationships for an element')
    .option('--direction <dir>', 'Filter by direction (incoming/outgoing/all)', 'all')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ dr relationship list api-endpoint-create-customer
  $ dr relationship list business-service-order --direction outgoing
  $ dr relationship list element-1 --json`
    )
    .action(async (id, options) => {
      try {
        const rootPath = process.cwd();

        if (!(await fileExists(`${rootPath}/model/manifest.yaml`))) {
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

        // Collect outgoing relationships
        let outgoing = element.relationships;

        // Collect incoming relationships
        let incoming: typeof element.relationships = [];
        for (const other of layer.listElements()) {
          if (other.id !== id) {
            incoming.push(
              ...other.relationships.filter((rel) => rel.target === id)
            );
          }
        }

        // Filter by direction
        let relationships: typeof element.relationships = [];
        if (options.direction === 'outgoing' || options.direction === 'all') {
          relationships.push(...outgoing);
        }
        if (options.direction === 'incoming' || options.direction === 'all') {
          relationships.push(...incoming);
        }

        if (options.json) {
          console.log(JSON.stringify(relationships, null, 2));
          return;
        }

        if (relationships.length === 0) {
          console.log(ansis.yellow(`No ${options.direction} relationships for ${id}`));
          return;
        }

        console.log('');
        console.log(
          ansis.bold(
            `${options.direction === 'all' ? '' : options.direction + ' '}relationships for ${ansis.cyan(id)}:`
          )
        );
        console.log(ansis.dim('─'.repeat(80)));

        for (const rel of relationships) {
          const isOutgoing = rel.source === id;
          const direction = isOutgoing ? '→' : '←';
          const otherElement = isOutgoing ? rel.target : rel.source;

          console.log(
            `  ${direction} ${ansis.magenta(rel.predicate)}: ${ansis.yellow(otherElement)}`
          );

          if (rel.properties) {
            const propStr = Object.entries(rel.properties)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ');
            console.log(`    ${ansis.dim(propStr)}`);
          }
        }

        console.log(ansis.dim('─'.repeat(80)));
        console.log(ansis.dim(`Total: ${relationships.length} relationship(s)`));
        console.log('');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(ansis.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  program
    .command('show <source> <target>')
    .description('Show relationship details')
    .addHelpText(
      'after',
      `
Examples:
  $ dr relationship show api-endpoint-create-customer business-service-customer-mgmt
  $ dr relationship show application-component-api motivation-goal-sales-efficiency`
    )
    .action(async (source, target) => {
      try {
        const rootPath = process.cwd();

        if (!(await fileExists(`${rootPath}/model/manifest.yaml`))) {
          console.error(ansis.red('Error: No model found. Run "dr init" first.'));
          process.exit(1);
        }

        const model = await Model.load(rootPath, { lazyLoad: false });
        const sourceLayerName = await findElementLayer(model, source);

        if (!sourceLayerName) {
          console.error(ansis.red(`Error: Source element ${source} not found`));
          process.exit(1);
        }

        const layer = (await model.getLayer(sourceLayerName))!;
        const sourceElement = layer.getElement(source)!;

        // Find relationships
        const relationships = sourceElement.relationships.filter((rel) => rel.target === target);

        if (relationships.length === 0) {
          console.error(
            ansis.red(`Error: No relationships from ${source} to ${target}`)
          );
          process.exit(1);
        }

        console.log('');
        console.log(
          ansis.bold(
            `Relationship${relationships.length > 1 ? 's' : ''} from ${ansis.cyan(source)} to ${ansis.yellow(target)}:`
          )
        );
        console.log(ansis.dim('─'.repeat(60)));

        for (let i = 0; i < relationships.length; i++) {
          const rel = relationships[i];

          if (i > 0) {
            console.log('');
          }

          console.log(`Predicate: ${ansis.magenta(rel.predicate)}`);

          if (rel.properties && Object.keys(rel.properties).length > 0) {
            console.log('Properties:');
            for (const [key, value] of Object.entries(rel.properties)) {
              const displayValue =
                typeof value === 'string' ? value : JSON.stringify(value, null, 2);
              console.log(`  ${ansis.cyan(key)}: ${displayValue}`);
            }
          } else {
            console.log('Properties: none');
          }
        }

        console.log('');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(ansis.red(`Error: ${message}`));
        process.exit(1);
      }
    });
}
