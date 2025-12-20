/**
 * Changeset Commands - Manage model change tracking and versioning
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { ChangesetManager } from '../core/changeset.js';
import { Command } from 'commander';
import * as prompts from '@clack/prompts';

/**
 * Create a new changeset
 */
export async function changesetCreateCommand(name: string, options: {
  description?: string;
}): Promise<void> {
  try {
    const manager = new ChangesetManager(process.cwd());

    // Check if changeset already exists
    const existing = await manager.load(name);
    if (existing) {
      console.error(ansis.red(`Error: Changeset '${name}' already exists`));
      process.exit(1);
    }

    // Get description if not provided
    let description = options.description;
    if (!description) {
      const result = await prompts.text({
        message: 'Changeset description (optional)',
      });

      if (typeof result === 'string') {
        description = result;
      }
    }

    const changeset = await manager.create(name, description || undefined);

    console.log(
      ansis.green(`✓ Created changeset: ${ansis.bold(name)}`)
    );
    if (changeset.description) {
      console.log(ansis.dim(`  ${changeset.description}`));
    }
    console.log(
      ansis.dim(`  Path: .dr/changesets/${name.toLowerCase().replace(/\s+/g, '-')}.json`)
    );
    console.log();
  } catch (error) {
    console.error(
      ansis.red(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }
}

/**
 * List all changesets
 */
export async function changesetListCommand(): Promise<void> {
  try {
    const manager = new ChangesetManager(process.cwd());
    const changesets = await manager.list();

    if (changesets.length === 0) {
      console.log(ansis.yellow('No changesets found'));
      console.log();
      return;
    }

    console.log(ansis.bold(`\nChangesets (${changesets.length}):\n`));

    for (const changeset of changesets) {
      const statusColor =
        changeset.status === 'applied'
          ? ansis.green
          : changeset.status === 'reverted'
            ? ansis.gray
            : ansis.yellow;

      console.log(
        `${statusColor(changeset.status.toUpperCase())} ${ansis.bold(
          changeset.name
        )}`
      );

      if (changeset.description) {
        console.log(ansis.dim(`  ${changeset.description}`));
      }

      console.log(
        ansis.dim(
          `  Changes: ${changeset.getChangeCount()} | Created: ${new Date(
            changeset.created
          ).toLocaleDateString()}`
        )
      );

      const changesByType = {
        add: changeset.getChangesByType('add').length,
        update: changeset.getChangesByType('update').length,
        delete: changeset.getChangesByType('delete').length,
      };

      const parts = [];
      if (changesByType.add > 0) parts.push(`+${changesByType.add}`);
      if (changesByType.update > 0) parts.push(`~${changesByType.update}`);
      if (changesByType.delete > 0) parts.push(`-${changesByType.delete}`);

      if (parts.length > 0) {
        console.log(ansis.dim(`  ${parts.join(' ')}`));
      }

      console.log();
    }
  } catch (error) {
    console.error(
      ansis.red(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }
}

/**
 * Apply a changeset to the model
 */
export async function changesetApplyCommand(name: string): Promise<void> {
  try {
    const manager = new ChangesetManager(process.cwd());
    const model = await Model.load(process.cwd(), { lazyLoad: false });

    const changeset = await manager.load(name);
    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${name}' not found`));
      process.exit(1);
    }

    console.log(
      ansis.bold(`\nApplying changeset: ${ansis.cyan(name)}\n`)
    );
    console.log(
      ansis.dim(`Changes: ${changeset.getChangeCount()}`)
    );

    const result = await manager.apply(model, name);

    console.log();
    if (result.applied > 0) {
      console.log(
        ansis.green(`✓ Applied ${result.applied} change(s)`)
      );
    }

    if (result.failed > 0) {
      console.log(ansis.red(`✗ Failed to apply ${result.failed} change(s):`));
      for (const error of result.errors) {
        console.log(
          ansis.dim(
            `  - ${error.change.elementId} (${error.change.type}): ${
              error.error
            }`
          )
        );
      }
    }

    if (result.failed === 0) {
      // Save the model
      await model.saveManifest();
      await model.saveDirtyLayers();

      console.log(ansis.dim(`Changeset marked as applied`));
    }

    console.log();
  } catch (error) {
    console.error(
      ansis.red(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }
}

/**
 * Revert a changeset from the model
 */
export async function changesetRevertCommand(name: string): Promise<void> {
  try {
    const manager = new ChangesetManager(process.cwd());
    const model = await Model.load(process.cwd(), { lazyLoad: false });

    const changeset = await manager.load(name);
    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${name}' not found`));
      process.exit(1);
    }

    console.log(
      ansis.bold(`\nReverting changeset: ${ansis.cyan(name)}\n`)
    );
    console.log(
      ansis.dim(`Changes to revert: ${changeset.getChangeCount()}`)
    );

    const result = await manager.revert(model, name);

    console.log();
    if (result.reverted > 0) {
      console.log(
        ansis.green(`✓ Reverted ${result.reverted} change(s)`)
      );
    }

    if (result.failed > 0) {
      console.log(ansis.red(`✗ Failed to revert ${result.failed} change(s):`));
      for (const error of result.errors) {
        console.log(
          ansis.dim(
            `  - ${error.change.elementId} (${error.change.type}): ${
              error.error
            }`
          )
        );
      }
    }

    if (result.failed === 0) {
      // Save the model
      await model.saveManifest();
      await model.saveDirtyLayers();

      console.log(ansis.dim(`Changeset marked as reverted`));
    }

    console.log();
  } catch (error) {
    console.error(
      ansis.red(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }
}

/**
 * Register changeset subcommands
 */
export function changesetCommands(program: Command): void {
  const changesetGroup = program
    .command('changeset')
    .description('Manage changesets');

  changesetGroup
    .command('create <name>')
    .description('Create a new changeset')
    .option('--description <desc>', 'Changeset description')
    .action((name, options) => {
      changesetCreateCommand(name, options);
    });

  changesetGroup
    .command('list')
    .description('List all changesets')
    .action(() => {
      changesetListCommand();
    });

  changesetGroup
    .command('apply <name>')
    .description('Apply a changeset to the model')
    .action((name) => {
      changesetApplyCommand(name);
    });

  changesetGroup
    .command('revert <name>')
    .description('Revert a changeset from the model')
    .action((name) => {
      changesetRevertCommand(name);
    });
}
