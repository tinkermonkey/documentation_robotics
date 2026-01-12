/**
 * Changeset Commands - Manage model change tracking and versioning
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { ChangesetManager } from '../core/changeset.js';
import { StagingAreaManager } from '../core/staging-area.js';
import { ActiveChangesetContext } from '../core/active-changeset.js';
import { Command } from 'commander';
import * as prompts from '@clack/prompts';

/**
 * Create a new changeset
 */
export async function changesetCreateCommand(name: string, options: {
  description?: string;
}): Promise<void> {
  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
    const manager = new ChangesetManager(model.rootPath);

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
    const model = await Model.load(process.cwd(), { lazyLoad: true });
    const manager = new ChangesetManager(model.rootPath);
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
    const model = await Model.load(process.cwd(), { lazyLoad: false });
    const manager = new ChangesetManager(model.rootPath);

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

    // Always show applied message, even if 0 changes
    console.log(
      ansis.green(`✓ Applied ${result.applied} change(s) from changeset`)
    );

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

    // Add changeset to manifest history
    if (!model.manifest.changeset_history) {
      model.manifest.changeset_history = [];
    }
    model.manifest.changeset_history.push({
      name,
      applied_at: new Date().toISOString(),
      action: 'applied'
    });

    // Always save the model and manifest, even if 0 changes
    // This ensures manifest is updated with changeset metadata
    await model.saveDirtyLayers();
    await model.saveManifest();

    if (result.failed === 0) {
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
    const model = await Model.load(process.cwd(), { lazyLoad: false });
    const manager = new ChangesetManager(model.rootPath);

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

    // Always show reverted message, even if 0 changes
    console.log(
      ansis.green(`✓ Reverted ${result.reverted} change(s)`)
    );

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

    // Add changeset to manifest history
    if (!model.manifest.changeset_history) {
      model.manifest.changeset_history = [];
    }
    model.manifest.changeset_history.push({
      name,
      applied_at: new Date().toISOString(),
      action: 'reverted'
    });

    // Always save the model and manifest, even if 0 changes
    // This ensures manifest is updated with changeset metadata
    await model.saveDirtyLayers();
    await model.saveManifest();

    if (result.failed === 0) {
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
 * Activate a changeset for automatic tracking
 */
export async function changesetActivateCommand(name: string): Promise<void> {
  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
    const context = new ActiveChangesetContext(model.rootPath);
    await context.setActive(name);

    console.log(ansis.green(`✓ Activated changeset: ${ansis.bold(name)}`));
    console.log(ansis.dim('  All model changes will now be tracked in this changeset'));
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
 * Deactivate the current changeset
 */
export async function changesetDeactivateCommand(): Promise<void> {
  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
    const context = new ActiveChangesetContext(model.rootPath);
    const active = await context.getActive();

    if (!active) {
      console.log(ansis.yellow('No active changeset'));
      return;
    }

    await context.clearActive();
    console.log(ansis.green(`✓ Deactivated changeset: ${ansis.bold(active)}`));
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
 * Show the currently active changeset
 */
export async function changesetStatusCommand(): Promise<void> {
  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
    const context = new ActiveChangesetContext(model.rootPath);
    const active = await context.getActive();

    if (!active) {
      console.log(ansis.dim('No active changeset'));
      return;
    }

    console.log(ansis.bold(`Active changeset: ${ansis.cyan(active)}`));

    // Load and show changeset details
    const manager = new ChangesetManager(model.rootPath);
    const changeset = await manager.load(active);

    if (changeset) {
      console.log(ansis.dim(`  Changes tracked: ${changeset.getChangeCount()}`));
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
 * List all staged changes in the active changeset
 */
export async function changesetStagedCommand(options: {
  layer?: string;
}): Promise<void> {
  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
    const context = new ActiveChangesetContext(model.rootPath);
    const activeChangeset = await context.getActive();

    if (!activeChangeset) {
      console.error(ansis.red('Error: No active changeset'));
      return;
    }

    const manager = new ChangesetManager(model.rootPath);
    const changeset = await manager.load(activeChangeset);

    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${activeChangeset}' not found`));
      process.exit(1);
    }

    let changes = changeset.getChangesByType('add')
      .concat(changeset.getChangesByType('update'))
      .concat(changeset.getChangesByType('delete'));

    if (options.layer) {
      changes = changes.filter((c: any) => c.layerName === options.layer);
    }

    if (changes.length === 0) {
      console.log(ansis.yellow('No staged changes'));
      return;
    }

    console.log(ansis.bold(`\nStaged Changes (${changes.length}):\n`));

    const tableData = changes.map((c: any) => ({
      'Element ID': c.elementId,
      'Layer': c.layerName,
      'Type': c.type,
      'Timestamp': new Date(c.timestamp || Date.now()).toISOString(),
    }));

    console.table(tableData);
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
 * Remove specific element from staging area
 */
export async function changesetUnstageCommand(elementId: string): Promise<void> {
  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
    const context = new ActiveChangesetContext(model.rootPath);
    const activeChangeset = await context.getActive();

    if (!activeChangeset) {
      console.error(ansis.red('Error: No active changeset'));
      return;
    }

    const manager = new ChangesetManager(model.rootPath);
    const changeset = await manager.load(activeChangeset);

    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${activeChangeset}' not found`));
      process.exit(1);
    }

    // Check if element exists in changes
    const initialCount = changeset.getChangeCount();
    changeset.changes = changeset.changes.filter((c) => c.elementId !== elementId);

    if (changeset.getChangeCount() === initialCount) {
      console.error(ansis.yellow(`Warning: Element '${elementId}' not found in staged changes`));
      return;
    }

    // Save updated changeset
    changeset.updateModified();
    await manager.save(changeset);

    console.log(ansis.green(`✓ Unstaged element: ${ansis.bold(elementId)}`));
    console.log(
      ansis.dim(
        `  Remaining staged changes: ${changeset.getChangeCount()}`
      )
    );
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
 * Discard all or single staged changes
 */
export async function changesetDiscardCommand(elementId?: string): Promise<void> {
  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
    const context = new ActiveChangesetContext(model.rootPath);
    const activeChangeset = await context.getActive();

    if (!activeChangeset) {
      console.error(ansis.red('Error: No active changeset'));
      return;
    }

    const manager = new ChangesetManager(model.rootPath);
    const changeset = await manager.load(activeChangeset);

    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${activeChangeset}' not found`));
      process.exit(1);
    }

    if (elementId) {
      // Discard single element
      const initialCount = changeset.getChangeCount();
      changeset.changes = changeset.changes.filter((c) => c.elementId !== elementId);

      if (changeset.getChangeCount() === initialCount) {
        console.error(ansis.yellow(`Warning: Element '${elementId}' not found in staged changes`));
        return;
      }

      changeset.updateModified();
      await manager.save(changeset);
      console.log(ansis.green(`✓ Discarded changes for element: ${ansis.bold(elementId)}`));
    } else {
      // Discard all changes with confirmation
      const confirmed = await prompts.confirm({
        message: `Discard all ${changeset.getChangeCount()} staged changes? This cannot be undone.`,
      });

      if (!confirmed) {
        console.log(ansis.dim('Cancelled'));
        return;
      }

      // Clear all changes
      changeset.changes = [];
      changeset.markDiscarded();
      await manager.save(changeset);

      console.log(ansis.green(`✓ Discarded all staged changes`));
      console.log(ansis.dim(`  Changeset status: discarded`));
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
 * Preview the merged model state with staged changes applied
 */
export async function changesetPreviewCommand(options: {
  layer?: string;
}): Promise<void> {
  try {
    const model = await Model.load(process.cwd(), { lazyLoad: false });
    const context = new ActiveChangesetContext(model.rootPath);
    const activeChangeset = await context.getActive();

    if (!activeChangeset) {
      console.error(ansis.red('Error: No active changeset'));
      return;
    }

    const manager = new ChangesetManager(model.rootPath);
    const changeset = await manager.load(activeChangeset);

    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${activeChangeset}' not found`));
      process.exit(1);
    }

    console.log(
      ansis.bold(`\nPreview: Merged Model State (${ansis.cyan('with staged changes')})`)
    );
    console.log(ansis.dim(`Changeset: ${activeChangeset}`));
    console.log();

    // Show summary of changes
    const additions = changeset.getChangesByType('add').length;
    const modifications = changeset.getChangesByType('update').length;
    const deletions = changeset.getChangesByType('delete').length;

    if (additions > 0) {
      console.log(ansis.green(`+ ${additions} additions`));
    }
    if (modifications > 0) {
      console.log(ansis.yellow(`~ ${modifications} modifications`));
    }
    if (deletions > 0) {
      console.log(ansis.red(`- ${deletions} deletions`));
    }

    console.log();

    if (options.layer) {
      // Filter changes by layer
      const layerChanges = changeset.changes.filter(
        (c: any) => c.layerName === options.layer
      );

      if (layerChanges.length === 0) {
        console.log(ansis.dim(`No staged changes in layer '${options.layer}'`));
        return;
      }

      console.log(ansis.bold(`Layer: ${options.layer}`));
      const tableData = layerChanges.map((c: any) => ({
        'Element ID': c.elementId + ansis.dim(' (staged)'),
        'Type': c.type,
        'Status': c.type === 'add' ? 'new' : c.type === 'delete' ? 'removed' : 'updated',
      }));
      console.table(tableData);
    } else {
      // Show all layers with staged changes
      const layerMap = new Map<string, any[]>();
      changeset.changes.forEach((c: any) => {
        if (!layerMap.has(c.layerName)) {
          layerMap.set(c.layerName, []);
        }
        layerMap.get(c.layerName)!.push(c);
      });

      for (const [layerName, changes] of layerMap) {
        console.log(ansis.bold(`Layer: ${layerName}`));
        const tableData = changes.map((c: any) => ({
          'Element ID': c.elementId,
          'Type': c.type,
          'Status': c.type === 'add' ? 'new' : c.type === 'delete' ? 'removed' : 'updated',
        }));
        console.table(tableData);
        console.log();
      }
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
 * Show delta between base model and staged changes
 */
export async function changesetDiffCommand(options: {
  layer?: string;
}): Promise<void> {
  try {
    const model = await Model.load(process.cwd(), { lazyLoad: false });
    const context = new ActiveChangesetContext(model.rootPath);
    const activeChangeset = await context.getActive();

    if (!activeChangeset) {
      console.error(ansis.red('Error: No active changeset'));
      return;
    }

    const manager = new ChangesetManager(model.rootPath);
    const changeset = await manager.load(activeChangeset);

    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${activeChangeset}' not found`));
      process.exit(1);
    }

    console.log(ansis.bold('\nDiff: Base Model vs Staged Changes\n'));

    // Group changes by layer
    const layerMap = new Map<string, any[]>();
    changeset.changes.forEach((c: any) => {
      if (!options.layer || c.layerName === options.layer) {
        if (!layerMap.has(c.layerName)) {
          layerMap.set(c.layerName, []);
        }
        layerMap.get(c.layerName)!.push(c);
      }
    });

    if (layerMap.size === 0) {
      console.log(
        ansis.dim(
          options.layer
            ? `No changes in layer '${options.layer}'`
            : 'No staged changes'
        )
      );
      return;
    }

    // Display changes grouped by layer
    for (const [layerName, changes] of layerMap) {
      console.log(ansis.bold(`Layer: ${layerName}`));

      for (const change of changes) {
        if (change.type === 'add') {
          console.log(ansis.green(`+ ${change.elementId}`));
          console.log(ansis.dim(`  ${JSON.stringify(change.after || {}, null, 2)}`));
        } else if (change.type === 'delete') {
          console.log(ansis.red(`- ${change.elementId}`));
          console.log(ansis.dim(`  ${JSON.stringify(change.before || {}, null, 2)}`));
        } else if (change.type === 'update') {
          console.log(ansis.yellow(`~ ${change.elementId}`));
          console.log(ansis.dim(`  Before: ${JSON.stringify(change.before || {})}`));
          console.log(ansis.dim(`  After:  ${JSON.stringify(change.after || {})}`));
        }
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
 * Apply staged changes to the base model
 * Implements atomic commit with validation and rollback on failure
 * Options: validate (default true), force (override drift warnings)
 */
export async function changesetCommitCommand(options?: {
  validate?: boolean;
  force?: boolean;
}): Promise<void> {
  try {
    const model = await Model.load(process.cwd(), { lazyLoad: false });
    const context = new ActiveChangesetContext(model.rootPath);
    const activeChangeset = await context.getActive();

    if (!activeChangeset) {
      console.error(ansis.red('Error: No active changeset'));
      return;
    }

    const stagingManager = new StagingAreaManager(model.rootPath, model);
    const changeset = await stagingManager.load(activeChangeset);

    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${activeChangeset}' not found`));
      process.exit(1);
    }

    const changeCount = changeset.changes.length;

    if (changeCount === 0) {
      console.log(ansis.yellow('No staged changes to commit'));
      return;
    }

    console.log(ansis.bold(`\nCommitting changeset: ${ansis.cyan(activeChangeset)}`));
    console.log(ansis.dim(`Staged changes: ${changeCount}`));
    console.log();

    // Execute atomic commit with validation and rollback
    try {
      const result = await stagingManager.commit(model, activeChangeset, {
        validate: options?.validate !== false,
        force: options?.force === true,
      });

      // Show results
      console.log(ansis.green(`✓ Committed ${result.committed} change(s)`));

      if (result.driftWarning) {
        console.log(
          ansis.yellow(
            `⚠ Warning: Model had drifted since changeset creation (--force was used)`
          )
        );
      }

      console.log();
    } catch (error) {
      // Commit failed - error was thrown from StagingAreaManager
      // Model has been automatically rolled back
      console.log(
        ansis.red(`✗ Commit failed and rolled back: ${error instanceof Error ? error.message : String(error)}`)
      );
      throw error;
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
    .addHelpText(
      'after',
      `
Examples:
  $ dr changeset create "v1.1 migration"
  $ dr changeset create "api-refactoring" --description "Refactor API layer endpoints"`
    )
    .action(async (name, options) => {
      await changesetCreateCommand(name, options);
    });

  changesetGroup
    .command('list')
    .description('List all changesets')
    .addHelpText(
      'after',
      `
Examples:
  $ dr changeset list`
    )
    .action(async () => {
      await changesetListCommand();
    });

  changesetGroup
    .command('apply <name>')
    .description('Apply a changeset to the model')
    .addHelpText(
      'after',
      `
Examples:
  $ dr changeset apply "v1.1 migration"`
    )
    .action(async (name) => {
      await changesetApplyCommand(name);
    });

  changesetGroup
    .command('revert <name>')
    .description('Revert a changeset from the model')
    .addHelpText(
      'after',
      `
Examples:
  $ dr changeset revert "v1.1 migration"`
    )
    .action(async (name) => {
      await changesetRevertCommand(name);
    });

  changesetGroup
    .command('activate <name>')
    .description('Activate a changeset for automatic change tracking')
    .addHelpText(
      'after',
      `
Examples:
  $ dr changeset activate "v1.1 migration"`
    )
    .action(async (name) => {
      await changesetActivateCommand(name);
    });

  changesetGroup
    .command('deactivate')
    .description('Deactivate the currently active changeset')
    .addHelpText(
      'after',
      `
Examples:
  $ dr changeset deactivate`
    )
    .action(async () => {
      await changesetDeactivateCommand();
    });

  changesetGroup
    .command('status')
    .description('Show the currently active changeset')
    .addHelpText(
      'after',
      `
Examples:
  $ dr changeset status`
    )
    .action(async () => {
      await changesetStatusCommand();
    });

  // Staging operation commands
  changesetGroup
    .command('staged')
    .description('List all staged changes in the active changeset')
    .option('-l, --layer <layer>', 'Filter by layer name')
    .addHelpText(
      'after',
      `
Examples:
  $ dr changeset staged
  $ dr changeset staged --layer api`
    )
    .action(async (options) => {
      await changesetStagedCommand(options);
    });

  changesetGroup
    .command('unstage <element-id>')
    .description('Remove specific element from staging area')
    .addHelpText(
      'after',
      `
Examples:
  $ dr changeset unstage api-endpoint-create-customer`
    )
    .action(async (elementId) => {
      await changesetUnstageCommand(elementId);
    });

  changesetGroup
    .command('discard [element-id]')
    .description('Discard all or single staged changes')
    .addHelpText(
      'after',
      `
Examples:
  $ dr changeset discard
  $ dr changeset discard api-endpoint-create-customer`
    )
    .action(async (elementId) => {
      await changesetDiscardCommand(elementId);
    });

  changesetGroup
    .command('preview')
    .description('Preview the merged model state with staged changes applied')
    .option('-l, --layer <layer>', 'Preview specific layer only')
    .addHelpText(
      'after',
      `
Examples:
  $ dr changeset preview
  $ dr changeset preview --layer application`
    )
    .action(async (options) => {
      await changesetPreviewCommand(options);
    });

  changesetGroup
    .command('diff')
    .description('Show delta between base model and staged changes')
    .option('-l, --layer <layer>', 'Show diff for specific layer only')
    .addHelpText(
      'after',
      `
Examples:
  $ dr changeset diff
  $ dr changeset diff --layer api`
    )
    .action(async (options) => {
      await changesetDiffCommand(options);
    });

  changesetGroup
    .command('commit')
    .description('Apply staged changes to the base model')
    .option('--validate', 'Run validation before commit (default: true)', true)
    .option('--force', 'Commit despite drift warnings', false)
    .addHelpText(
      'after',
      `
Examples:
  $ dr changeset commit
  $ dr changeset commit --validate
  $ dr changeset commit --force`
    )
    .action(async (options) => {
      await changesetCommitCommand(options);
    });
}
