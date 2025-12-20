#!/usr/bin/env bun

/**
 * Documentation Robotics CLI - Bun Implementation
 * Entry point for the command-line interface
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { addCommand } from './commands/add.js';
import { updateCommand } from './commands/update.js';
import { deleteCommand } from './commands/delete.js';
import { showCommand } from './commands/show.js';
import { listCommand } from './commands/list.js';
import { searchCommand } from './commands/search.js';
import { validateCommand } from './commands/validate.js';
import { elementCommands } from './commands/element.js';
import { relationshipCommands } from './commands/relationship.js';

const program = new Command();

program
  .name('dr')
  .description('Documentation Robotics CLI - Architecture Model Management')
  .version('0.1.0')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--debug', 'Enable debug mode');

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

program.parse();
