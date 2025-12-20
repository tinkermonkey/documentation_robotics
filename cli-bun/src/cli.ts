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
import { visualizeCommand } from './commands/visualize.js';
import { chatCommand } from './commands/chat.js';
import { migrateCommand } from './commands/migrate.js';
import { upgradeCommand } from './commands/upgrade.js';
import { conformanceCommand } from './commands/conformance.js';
import { changesetCommands } from './commands/changeset.js';

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
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun init
  $ dr-bun init --name "Enterprise Architecture" --author "Team A"
  $ dr-bun init --description "12-layer federated model"`
  )
  .action(initCommand);

program
  .command('add <layer> <type> <id>')
  .description('Add an element to a layer')
  .option('--name <name>', 'Element name (defaults to ID)')
  .option('--description <desc>', 'Element description')
  .option('--properties <json>', 'Element properties as JSON object')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun add business business-service customer-mgmt --name "Customer Management"
  $ dr-bun add api endpoint create-customer --properties '{"method":"POST","path":"/customers"}'
  $ dr-bun add application component customer-api --description "REST API for customer operations"`
  )
  .action(addCommand);

program
  .command('update <id>')
  .description('Update an element')
  .option('--name <name>', 'New element name')
  .option('--description <desc>', 'New description')
  .option('--properties <json>', 'Updated properties (JSON)')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun update api-endpoint-create-customer --name "Create Customer (v2)"
  $ dr-bun update business-service-order --description "Updated description"`
  )
  .action(updateCommand);

program
  .command('delete <id>')
  .description('Delete an element')
  .option('--force', 'Skip confirmation prompt')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun delete api-endpoint-old-endpoint
  $ dr-bun delete api-endpoint-old-endpoint --force`
  )
  .action(deleteCommand);

program
  .command('show <id>')
  .description('Display element details')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun show api-endpoint-create-customer
  $ dr-bun show business-service-order-mgmt`
  )
  .action(showCommand);

program
  .command('list <layer>')
  .description('List elements in a layer')
  .option('--type <type>', 'Filter by element type')
  .option('--json', 'Output as JSON')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun list api
  $ dr-bun list business --type business-service
  $ dr-bun list api --json`
  )
  .action(listCommand);

program
  .command('search <query>')
  .description('Search for elements by name or ID')
  .option('--layer <layer>', 'Limit search to specific layer')
  .option('--type <type>', 'Filter by element type')
  .option('--json', 'Output as JSON')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun search customer
  $ dr-bun search "order processing" --layer business
  $ dr-bun search create-* --type endpoint`
  )
  .action(searchCommand);

program
  .command('validate')
  .description('Validate the architecture model')
  .option('--layers <layers...>', 'Specific layers to validate')
  .option('--strict', 'Treat warnings as errors')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun validate
  $ dr-bun validate --layers business api
  $ dr-bun validate --strict`
  )
  .action(validateCommand);

program
  .command('export <format>')
  .description('Export the architecture model to various formats')
  .option('--output <path>', 'Output file path (default: print to stdout)')
  .option('--layers <layers...>', 'Specific layers to export')
  .addHelpText(
    'after',
    `
Supported formats:
  archimate    Export to ArchiMate XML (layers 1, 2, 4, 5)
  openapi      Export to OpenAPI 3.0 specification (layer 6)
  jsonschema   Export to JSON Schema (layer 7)
  plantuml     Export to PlantUML diagram
  graphml      Export to GraphML (graph visualization)
  markdown     Export to Markdown documentation

Examples:
  $ dr-bun export archimate --output model.xml
  $ dr-bun export openapi --layers api
  $ dr-bun export markdown --output docs/architecture.md`
  )
  .action(async (format, options) => {
    await exportCommand({
      format,
      output: options.output,
      layers: options.layers,
    });
  });

program
  .command('info')
  .description('Show model information')
  .option('--layer <layer>', 'Show specific layer details')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun info
  $ dr-bun info --layer business`
  )
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
  .option('--direction <dir>', 'Trace direction: up (dependencies), down (dependents), both (default)')
  .option('--depth <num>', 'Maximum traversal depth')
  .option('--metrics', 'Show graph and element metrics')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun trace api-endpoint-create-customer
  $ dr-bun trace business-service-order --direction down --metrics
  $ dr-bun trace application-component-api --depth 3`
  )
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
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun project api-endpoint-create-customer business
  $ dr-bun project business-service-order motivation --reverse
  $ dr-bun project application-component-api data-model --reachability`
  )
  .action(async (elementId, targetLayer, options) => {
    await projectCommand(elementId, targetLayer, {
      reverse: options.reverse,
      maxDepth: options.maxDepth ? parseInt(options.maxDepth) : undefined,
      showReachability: options.reachability,
    });
  });

program
  .command('visualize')
  .description('Launch visualization server with WebSocket support')
  .option('--port <num>', 'Server port (default: 8080)')
  .option('--no-browser', 'Do not auto-open browser')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun visualize
  $ dr-bun visualize --port 3000
  $ dr-bun visualize --no-browser`
  )
  .action(async (options) => {
    await visualizeCommand({
      port: options.port,
      noBrowser: options.noBrowser,
    });
  });

// AI Integration command
program
  .command('chat')
  .description('Interactive chat with Claude about the architecture model')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun chat

This launches an interactive chat interface where you can ask Claude questions
about your architecture model. Requires ANTHROPIC_API_KEY to be set.`
  )
  .action(async () => {
    await chatCommand();
  });

// Advanced commands
program
  .command('migrate')
  .description('Migrate the model to a different spec version')
  .option('--to <version>', 'Target spec version')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--force', 'Skip validation checks')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun migrate --to 1.0.0
  $ dr-bun migrate --to 1.0.0 --dry-run
  $ dr-bun migrate --to 1.0.0 --force`
  )
  .action(async (options) => {
    await migrateCommand({
      to: options.to,
      dryRun: options.dryRun,
      force: options.force,
    });
  });

program
  .command('upgrade')
  .description('Check for available CLI and spec version upgrades')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun upgrade`
  )
  .action(async () => {
    await upgradeCommand();
  });

program
  .command('conformance')
  .description('Check model conformance to layer specifications')
  .option('--layers <layers...>', 'Specific layers to check')
  .addHelpText(
    'after',
    `
Examples:
  $ dr-bun conformance
  $ dr-bun conformance --layers business api application`
  )
  .action(async (options) => {
    await conformanceCommand({
      layers: options.layers,
    });
  });

// Changeset subcommands
changesetCommands(program);

program.parse();
