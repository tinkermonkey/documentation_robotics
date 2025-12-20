#!/usr/bin/env node

/**
 * Documentation Robotics CLI - Bun Implementation
 * Entry point for the command-line interface
 */

import { Command } from 'commander';
import { setGlobalOptions } from './utils/globals.js';
import { initCommand } from './commands/init.js';
import { addCommand } from './commands/add.js';
import { updateCommand } from './commands/update.js';
import { deleteCommand } from './commands/delete.js';
import { showCommand } from './commands/show.js';
import { listCommand } from './commands/list.js';
import { searchCommand } from './commands/search.js';
import { validateCommand } from './commands/validate.js';
import { infoCommand } from './commands/info.js';
import { elementCommands } from './commands/element.js';
import { relationshipCommands } from './commands/relationship.js';
import { traceCommand } from './commands/trace.js';
import { projectCommand } from './commands/project.js';
import { exportCommand } from './commands/export.js';

const program = new Command();

program
  .name('dr')
  .description('Documentation Robotics CLI - Architecture Model Management')
  .version('0.1.0')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--debug', 'Enable debug mode')
  .hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();
    setGlobalOptions({
      verbose: options.verbose as boolean | undefined,
      debug: options.debug as boolean | undefined,
    });
  });

// Model commands
program
  .command('init')
  .description('Initialize a new architecture model')
  .option('--name <name>', 'Model name')
  .option('--author <author>', 'Model author')
  .option('--description <desc>', 'Model description')
  .action(initCommand);

program
  .command('add <layer> <type> <id>')
  .description('Add an element to a layer')
  .option('--name <name>', 'Element name')
  .option('--description <desc>', 'Element description')
  .option('--properties <json>', 'Element properties (JSON)')
  .action(addCommand);

program
  .command('update <id>')
  .description('Update an element')
  .option('--name <name>', 'New element name')
  .option('--description <desc>', 'New description')
  .option('--properties <json>', 'Updated properties (JSON)')
  .action(updateCommand);

program
  .command('delete <id>')
  .description('Delete an element')
  .option('--force', 'Skip confirmation prompt')
  .action(deleteCommand);

program
  .command('show <id>')
  .description('Display element details')
  .action(showCommand);

program
  .command('list <layer>')
  .description('List elements in a layer')
  .option('--type <type>', 'Filter by element type')
  .option('--json', 'Output as JSON')
  .action(listCommand);

program
  .command('search <query>')
  .description('Search for elements by name or ID')
  .option('--layer <layer>', 'Limit search to specific layer')
  .option('--type <type>', 'Filter by element type')
  .option('--json', 'Output as JSON')
  .action(searchCommand);

program
  .command('validate')
  .description('Validate the architecture model')
  .option('--layers <layers...>', 'Specific layers to validate')
  .option('--strict', 'Treat warnings as errors')
  .action(validateCommand);

program
  .command('export <format>')
  .description('Export the architecture model to various formats')
  .option('--output <path>', 'Output file path (default: print to stdout)')
  .option('--layers <layers...>', 'Specific layers to export')
  .action(async (format, options) => {
    await exportCommand({
      format,
      output: options.output,
      layers: options.layers,
      verbose: options.parent.verbose,
      debug: options.parent.debug,
    });
  });

program
  .command('info')
  .description('Show model information')
  .option('--layer <layer>', 'Show specific layer details')
  .action(infoCommand);

// Element subcommands
const elementGroup = program
  .command('element')
  .description('Element operations');
elementCommands(elementGroup);

// Relationship subcommands
const relationshipGroup = program
  .command('relationship')
  .description('Relationship operations');
relationshipCommands(relationshipGroup);

// Dependency analysis commands
program
  .command('trace <elementId>')
  .description('Trace dependencies for an element')
  .option('--direction <dir>', 'Trace direction: up, down, or both (default: both)')
  .option('--depth <num>', 'Maximum traversal depth')
  .option('--metrics', 'Show graph and element metrics')
  .action(async (elementId, options) => {
    await traceCommand(elementId, {
      direction: options.direction as 'up' | 'down' | 'both' | undefined,
      depth: options.depth ? parseInt(options.depth) : undefined,
      showMetrics: options.metrics,
    });
  });

program
  .command('project <elementId> <targetLayer>')
  .description('Project dependencies to a target layer')
  .option('--reverse', 'Perform reverse projection (impact analysis)')
  .option('--max-depth <num>', 'Maximum projection depth (default: 10)')
  .option('--reachability', 'Show reachability analysis')
  .action(async (elementId, targetLayer, options) => {
    await projectCommand(elementId, targetLayer, {
      reverse: options.reverse,
      maxDepth: options.maxDepth ? parseInt(options.maxDepth) : undefined,
      showReachability: options.reachability,
    });
  });

program.parse();
