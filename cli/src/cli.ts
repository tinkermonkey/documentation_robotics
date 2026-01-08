#!/usr/bin/env node

/**
 * Documentation Robotics CLI - Bun Implementation
 * Entry point for the command-line interface
 *
 * Instrumented with OpenTelemetry to create root spans for command execution.
 * Telemetry is controlled by the TELEMETRY_ENABLED build-time constant.
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
import { projectCommand, projectAllCommand } from './commands/project.js';
import { exportCommand } from './commands/export.js';
import { chatCommand } from './commands/chat.js';
import { upgradeCommand } from './commands/upgrade.js';
import { conformanceCommand } from './commands/conformance.js';
import { changesetCommands } from './commands/changeset.js';
import { claudeCommands } from './commands/claude.js';
import { copilotCommands } from './commands/copilot.js';
import { versionCommand } from './commands/version.js';
import { initTelemetry, startActiveSpan, shutdownTelemetry } from './telemetry/index.js';
import { installConsoleInterceptor } from './telemetry/console-interceptor.js';
import { readJSON, fileExists } from './utils/file-io.js';

// Declare TELEMETRY_ENABLED as a build-time constant (substituted by esbuild)
// Provide runtime fallback when not running through esbuild
declare const TELEMETRY_ENABLED: boolean;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;


// Get CLI version from package.json
async function getCliVersion(): Promise<string> {
  const possiblePaths = [
    `${process.cwd()}/package.json`,
    `${import.meta.url.replace('file://', '').split('/src/')[0]}/package.json`,
  ];

  for (const path of possiblePaths) {
    if (await fileExists(path)) {
      try {
        const data = await readJSON<{ version: string }>(path);
        return data.version;
      } catch {
        continue;
      }
    }
  }

  return '0.1.0';
}

const cliVersion = await getCliVersion();

const program = new Command();

// Handle --version and -V flags early, before commander processes them
if (process.argv.includes('--version') || process.argv.includes('-V')) {
  const { versionCommand } = await import('./commands/version.js');
  await versionCommand();
  process.exit(0);
}

program
  .name('dr')
  .description('Documentation Robotics CLI - Architecture Model Management')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--debug', 'Enable debug mode')
  .hook('preAction', async (thisCommand) => {
    // Set up global state (verbose/debug flags)
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
  $ dr init
  $ dr init --name "Enterprise Architecture" --author "Team A"
  $ dr init --description "12-layer federated model"`
  )
  .action(initCommand);

program
  .command('add <layer> <type> <id>')
  .description('Add an element to a layer')
  .option('--name <name>', 'Element name (defaults to ID)')
  .option('--description <desc>', 'Element description')
  .option('--properties <json>', 'Element properties as JSON object')
  .option('--source-file <path>', 'Source file path (relative from repository root)')
  .option('--source-symbol <name>', 'Symbol name (class, function, variable) in source file')
  .option('--source-provenance <type>', 'Provenance type: extracted, manual, inferred, generated')
  .option('--source-repo-remote <url>', 'Git remote URL for repository context')
  .option('--source-repo-commit <sha>', 'Git commit SHA (40 hex characters) for repository context')
  .addHelpText(
    'after',
    `
Examples:
  $ dr add business business-service customer-mgmt --name "Customer Management"
  $ dr add api endpoint create-customer --properties '{"method":"POST","path":"/customers"}'
  $ dr add application component customer-api --description "REST API for customer operations"
  $ dr add security policy auth-validate --source-file "src/auth/validator.ts" --source-symbol "validateToken" --source-provenance "extracted"`
  )
  .action(addCommand);

program
  .command('update <id>')
  .description('Update an element')
  .option('--name <name>', 'New element name')
  .option('--description <desc>', 'New description')
  .option('--properties <json>', 'Updated properties (JSON)')
  .option('--source-file <path>', 'Source file path (relative from repository root)')
  .option('--source-symbol <name>', 'Symbol name (class, function, variable) in source file')
  .option('--source-provenance <type>', 'Provenance type: extracted, manual, inferred, generated')
  .option('--source-repo-remote <url>', 'Git remote URL for repository context')
  .option('--source-repo-commit <sha>', 'Git commit SHA (40 hex characters) for repository context')
  .option('--clear-source-reference', 'Remove source reference from element')
  .addHelpText(
    'after',
    `
Examples:
  $ dr update api-endpoint-create-customer --name "Create Customer (v2)"
  $ dr update business-service-order --description "Updated description"
  $ dr update security-policy-auth --source-file "src/auth/policy.ts" --source-provenance "extracted"`
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
  $ dr delete api-endpoint-old-endpoint
  $ dr delete api-endpoint-old-endpoint --force`
  )
  .action(deleteCommand);

program
  .command('show <id>')
  .description('Display element details')
  .option('--model <path>', 'Path to model root (contains model/manifest.yaml)')
  .addHelpText(
    'after',
    `
Examples:
  $ dr show api-endpoint-create-customer
  $ dr show business-service-order-mgmt`
  )
  .action((id, options) => showCommand(id, options));

program
  .command('list <layer>')
  .description('List elements in a layer')
  .option('--type <type>', 'Filter by element type')
  .option('--json', 'Output as JSON')
  .option('--model <path>', 'Path to model root (contains model/manifest.yaml)')
  .addHelpText(
    'after',
    `
Examples:
  $ dr list api
  $ dr list business --type business-service
  $ dr list api --json`
  )
  .action(listCommand);

program
  .command('search <query>')
  .description('Search for elements by name or ID')
  .option('--layer <layer>', 'Limit search to specific layer')
  .option('--type <type>', 'Filter by element type')
  .option('--source-file <path>', 'Find elements referencing a source file (takes precedence over pattern matching)')
  .option('--json', 'Output as JSON')
  .addHelpText(
    'after',
    `
Examples:
  $ dr search customer
  $ dr search "order processing" --layer business
  $ dr search create-* --type endpoint
  $ dr search "" --source-file src/api/customer.ts`
  )
  .action(searchCommand);

program
  .command('validate')
  .description('Validate the architecture model')
  .option('--layers <layers...>', 'Specific layers to validate')
  .option('--strict', 'Treat warnings as errors')
  .option('--model <path>', 'Path to model root (contains model/manifest.yaml)')
  .option('--all', 'Run all validations (default behavior)')
  .option('--markdown', 'Validate markdown structure')
  .option('--schemas', 'Validate JSON schemas')
  .option('--schema', 'Validate JSON schemas (alias for --schemas)')
  .option('--relationships', 'Validate relationships')
  .option('--structure', 'Validate documentation structure')
  .option('--naming', 'Validate naming conventions')
  .option('--references', 'Validate cross-layer references')
  .addHelpText(
    'after',
    `
Examples:
  $ dr validate
  $ dr validate --all --strict
  $ dr validate --schemas
  $ dr validate --relationships
  $ dr validate --layers business api`
  )
  .action(validateCommand);

program
  .command('export <format>')
  .description('Export the architecture model to various formats')
  .option('--output <path>', 'Output file path (default: print to stdout)')
  .option('--layers <layers...>', 'Specific layers to export')
  .option('--model <path>', 'Path to model root directory or manifest.yaml file')
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
  $ dr export archimate --output model.xml
  $ dr export openapi --layers api
  $ dr export markdown --output docs/architecture.md`
  )
  .action(async (format, options) => {
    await exportCommand({
      format,
      output: options.output,
      layers: options.layers,
      model: options.model,
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
  $ dr info
  $ dr info --layer business`
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
  .option('--model <path>', 'Path to model root (contains model/manifest.yaml)')
  .addHelpText(
    'after',
    `
Examples:
  $ dr trace api-endpoint-create-customer
  $ dr trace business-service-order --direction down --metrics
  $ dr trace application-component-api --depth 3`
  )
  .action(async (elementId, options) => {
    await traceCommand(elementId, {
      direction: options.direction as 'up' | 'down' | 'both' | undefined,
      depth: options.depth ? parseInt(options.depth) : undefined,
      showMetrics: options.metrics,
      model: options.model,
    });
  });

program
  .command('project <elementId> <targetLayers>')
  .description('Project an element to other layers using projection rules')
  .option('--rule <name>', 'Specific projection rule to use')
  .option('--dry-run', 'Show what would be created without saving')
  .option('--force', 'Overwrite existing elements')
  .option('--model <path>', 'Path to model directory')
  .addHelpText(
    'after',
    `
Examples:
  $ dr project application.service.api-service "api,data-model"
  $ dr project business.process.order-fulfillment application --dry-run
  $ dr project api.endpoint.create-order data-model --rule api-to-data`
  )
  .action(async (elementId, targetLayers, options) => {
    await projectCommand(elementId, targetLayers, {
      rule: options.rule,
      dryRun: options.dryRun,
      force: options.force,
      model: options.model,
    });
  });

program
  .command('project-all')
  .description('Project all applicable elements based on rules')
  .option('--from <layer>', 'Source layer filter')
  .option('--to <layer>', 'Target layer filter')
  .option('--dry-run', 'Show what would be created without saving')
  .option('--model <path>', 'Path to model directory')
  .addHelpText(
    'after',
    `
Examples:
  $ dr project-all --from application --to api
  $ dr project-all --to data-model --dry-run
  $ dr project-all`
  )
  .action(async (options) => {
    await projectAllCommand({
      from: options.from,
      to: options.to,
      dryRun: options.dryRun,
      model: options.model,
    });
  });

program
  .command('visualize')
  .description('Launch visualization server with WebSocket support')
  .option('--port <num>', 'Server port (default: 8080)')
  .option('--no-browser', 'Do not auto-open browser')
  .option('--no-auth', 'Disable authentication (enabled by default)')
  .option('--token <token>', 'Custom auth token (auto-generated by default)')
  .addHelpText(
    'after',
    `
Examples:
  $ dr visualize
  $ dr visualize --port 3000
  $ dr visualize --no-browser
  $ dr visualize --no-auth
  $ dr visualize --token my-secret-token`
  )
  .action(async (options) => {
    const { visualizeCommand } = await import('./commands/visualize.js');
    await visualizeCommand({
      port: options.port,
      noBrowser: options.browser === false, // Commander sets 'browser' to false when --no-browser is used
      noAuth: options.auth === false, // Commander sets 'auth' to false when --no-auth is used
      token: options.token,
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
  $ dr chat

This launches an interactive chat interface where you can ask Claude questions
about your architecture model. Requires Claude Code CLI to be installed and authenticated.`
  )
  .action(async () => {
    await chatCommand();
  });

// Advanced commands
// Note: migrate command has been merged into upgrade command
program
  .command('version')
  .description('Show CLI and embedded spec version information')
  .addHelpText(
    'after',
    `
Examples:
  $ dr version`
  )
  .action(async () => {
    await versionCommand();
  });

program
  .command('upgrade')
  .description('Upgrade spec reference and migrate model to latest versions')
  .option('-y, --yes', 'Automatically upgrade without prompting')
  .option('--dry-run', 'Show what would be upgraded without making changes')
  .option('--force', 'Skip validation during migration')
  .addHelpText(
    'after',
    `
Examples:
  $ dr upgrade              # Scan, show plan, and prompt for upgrades
  $ dr upgrade --dry-run    # Preview available upgrades
  $ dr upgrade --yes        # Upgrade without prompting
  $ dr upgrade --force      # Skip validation during migration`
  )
  .action(async (options) => {
    await upgradeCommand({
      yes: options.yes,
      dryRun: options.dryRun,
      force: options.force,
    });
  });

program
  .command('conformance')
  .description('Check model conformance to layer specifications')
  .option('--layers <layers...>', 'Specific layers to check')
  .option('--json', 'Output as JSON')
  .option('--verbose', 'Verbose output')
  .addHelpText(
    'after',
    `
Examples:
  $ dr conformance
  $ dr conformance --layers business api application
  $ dr conformance --json
  $ dr conformance --verbose`
  )
  .action(async (options) => {
    await conformanceCommand({
      layers: options.layers,
      json: options.json,
      verbose: options.verbose,
    });
  });

// Changeset subcommands
changesetCommands(program);

// Claude Code integration subcommands
claudeCommands(program);

// GitHub Copilot integration subcommands
copilotCommands(program);

// Execute CLI with proper telemetry span wrapping
// This creates a root span that all child spans will be linked to
(async () => {
  try {
    if (isTelemetryEnabled) {
      // Initialize telemetry before execution
      await initTelemetry();
      await installConsoleInterceptor();

      const commandName = process.argv[2] || 'unknown';
      const args = process.argv.slice(3).join(' ');

      // Wrap entire CLI execution in active span for proper context propagation
      await startActiveSpan(
        'cli.execute',
        async (span) => {
          span.setAttributes({
            'cli.command': commandName,
            'cli.args': args,
            'cli.cwd': process.cwd(),
            'cli.version': cliVersion,
          });

          try {
            // Execute command - all child spans will now link to this root span
            await program.parseAsync(process.argv);

            // Set success status
            span.setStatus({ code: 0 }); // SpanStatusCode.OK
          } catch (error) {
            // Record exception and set error status
            span.recordException(error as Error);
            span.setStatus({
              code: 2, // SpanStatusCode.ERROR
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
        {
          'cli.command': commandName,
          'cli.args': args,
          'cli.cwd': process.cwd(),
          'cli.version': cliVersion,
        }
      );

      // Shutdown telemetry after execution completes
      await shutdownTelemetry();
    } else {
      // No telemetry - just parse normally
      await program.parseAsync(process.argv);
    }
  } catch (error) {
    // Re-throw to preserve CLI exit behavior
    throw error;
  }
})();
