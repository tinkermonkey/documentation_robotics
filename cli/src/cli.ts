#!/usr/bin/env node

/**
 * Documentation Robotics CLI - Bun Implementation
 * Entry point for the command-line interface
 *
 * Instrumented with OpenTelemetry to create root spans for command execution.
 * Telemetry is controlled by the TELEMETRY_ENABLED build-time constant.
 */

import { Command } from "commander";
import { setGlobalOptions } from "./utils/globals.js";
import { initCommand } from "./commands/init.js";
import { addCommand } from "./commands/add.js";
import { updateCommand } from "./commands/update.js";
import { deleteCommand } from "./commands/delete.js";
import { showCommand } from "./commands/show.js";
import { listCommand } from "./commands/list.js";
import { searchCommand } from "./commands/search.js";
import { validateCommand } from "./commands/validate.js";
import { infoCommand } from "./commands/info.js";
import { relationshipCommands } from "./commands/relationship.js";
import { schemaCommands } from "./commands/schema.js";
import { catalogCommands } from "./commands/catalog.js";
import { docsCommands } from "./commands/docs.js";
import { traceCommand } from "./commands/trace.js";
import { exportCommand } from "./commands/export.js";
import { importCommand } from "./commands/import.js";
import { migrateElementsCommand } from "./commands/migrate-elements.js";
import { chatCommand } from "./commands/chat.js";
import { upgradeCommand } from "./commands/upgrade.js";
import { conformanceCommand } from "./commands/conformance.js";
import { changesetCommands } from "./commands/changeset.js";
import { claudeCommands } from "./commands/claude.js";
import { copilotCommands } from "./commands/copilot.js";
import { versionCommand } from "./commands/version.js";
import { statsCommand } from "./commands/stats.js";
import { reportCommand } from "./commands/report.js";
import { auditCommand } from "./commands/audit.js";
import { auditDiffCommand } from "./commands/audit-diff.js";
import { auditSnapshotsCommand } from "./commands/audit-snapshots.js";
import { initTelemetry, startActiveSpan, shutdownTelemetry } from "./telemetry/index.js";
import { installConsoleInterceptor } from "./telemetry/console-interceptor.js";
import { readJSON, fileExists } from "./utils/file-io.js";
import { getErrorMessage } from "./utils/errors.js";

// Declare TELEMETRY_ENABLED as a build-time constant (substituted by esbuild)
// Provide runtime fallback when not running through esbuild
declare const TELEMETRY_ENABLED: boolean;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

/**
 * Extract exit code from an error object.
 * Handles CLIError instances and duck-typed objects with exitCode property.
 */
async function extractExitCode(error: unknown): Promise<number> {
  const { CLIError } = await import("./utils/errors.js");

  if (error instanceof CLIError) {
    return error.exitCode;
  }

  // Fallback for duck-typing (handles bundling/module issues)
  if (error && typeof error === "object" && "exitCode" in error) {
    const errorObj = error as any;
    if (typeof errorObj.exitCode === "number") {
      // Validate this looks like a CLIError before accepting
      if (errorObj.name === "CLIError" || errorObj.message) {
        console.warn(
          "[DEBUG] Using duck-typed error object as fallback - this may indicate a module loading issue"
        );
        return errorObj.exitCode;
      }
    }
  }

  return 1;
}

// Get CLI version from package.json
async function getCliVersion(): Promise<string> {
  const possiblePaths = [
    `${process.cwd()}/package.json`,
    `${import.meta.url.replace("file://", "").split("/src/")[0]}/package.json`,
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

  return "0.1.0";
}

const cliVersion = await getCliVersion();

const program = new Command();

// Handle --version and -V flags by redirecting to version command
// This ensures they go through the telemetry wrapper
if (process.argv.includes("--version") || process.argv.includes("-V")) {
  process.argv = ["node", "dr", "version"];
}

// Store active command span for automatic instrumentation
let commandSpan: any = null;

program
  .name("dr")
  .description("Documentation Robotics CLI - Architecture Model Management")
  .option("-v, --verbose", "Enable verbose output")
  .option("--debug", "Enable debug mode")
  .exitOverride() // Prevent Commander from calling process.exit() - we handle exit ourselves
  .hook("preAction", async (thisCommand, actionCommand) => {
    // Set up global state (verbose/debug flags)
    const options = thisCommand.opts();
    setGlobalOptions({
      verbose: options.verbose as boolean | undefined,
      debug: options.debug as boolean | undefined,
    });

    // Automatic telemetry: Create span for every command
    if (isTelemetryEnabled) {
      const { startSpan } = await import("./telemetry/index.js");
      // Use actionCommand to get the actual command being executed
      const commandName = actionCommand.name();
      const commandArgs = actionCommand.args;

      commandSpan = startSpan(`${commandName}.execute`, {
        "command.name": commandName,
        "command.args": JSON.stringify(commandArgs),
      });
    }
  })
  .hook("postAction", async () => {
    // Automatic telemetry: End command span
    if (isTelemetryEnabled && commandSpan) {
      const { endSpan } = await import("./telemetry/index.js");
      endSpan(commandSpan);
      commandSpan = null;
    }
  });

// Model commands
program
  .command("init [name]")
  .description("Initialize a new architecture model")
  .option("--name <name>", "Model name (overrides positional argument)")
  .option("--author <author>", "Model author")
  .option("--description <desc>", "Model description")
  .addHelpText(
    "after",
    `
Examples:
  $ dr init
  $ dr init claudetoreum
  $ dr init "Enterprise Architecture" --author "Team A"
  $ dr init --name "My Project" --description "12-layer federated model"`
  )
  .action((name, options) => initCommand({ ...options, name: options.name || name }));

program
  .command("add <layer> <type> <name>")
  .description("Add an element to a layer")
  .option("--name <name>", "Element display name (defaults to the name argument)")
  .option("--description <desc>", "Element description")
  .option("--properties <json>", "Element properties as JSON object")
  .option("--source-file <path>", "Source file path (relative from repository root)")
  .option("--source-symbol <name>", "Symbol name (class, function, variable) in source file")
  .option("--source-provenance <type>", "Provenance type: extracted, manual, inferred, generated")
  .option("--source-repo-remote <url>", "Git remote URL for repository context")
  .option("--source-repo-commit <sha>", "Git commit SHA (40 hex characters) for repository context")
  .addHelpText(
    "after",
    `
Examples:
  $ dr add business service "Customer Management"
  $ dr add api operation "Create Customer" --properties '{"method":"POST","path":"/customers"}'
  $ dr add application component "Customer API" --description "REST API for customer operations"
  $ dr add security policy "Auth Validator" --source-file "src/auth/validator.ts" --source-symbol "validateToken" --source-provenance "extracted"

Note: Element IDs are generated automatically in format {layer}.{type}.{kebab-name}`
  )
  .action(addCommand);

program
  .command("update <id>")
  .description("Update an element")
  .option("--name <name>", "New element name")
  .option("--description <desc>", "New description")
  .option("--properties <json>", "Updated properties (JSON)")
  .option("--source-file <path>", "Source file path (relative from repository root)")
  .option("--source-symbol <name>", "Symbol name (class, function, variable) in source file")
  .option("--source-provenance <type>", "Provenance type: extracted, manual, inferred, generated")
  .option("--source-repo-remote <url>", "Git remote URL for repository context")
  .option("--source-repo-commit <sha>", "Git commit SHA (40 hex characters) for repository context")
  .option("--clear-source-reference", "Remove source reference from element")
  .addHelpText(
    "after",
    `
Note: Changes are written immediately to model files.
To track changes for review, activate a changeset first:
  $ dr changeset activate my-changeset

Examples:
  $ dr update api-endpoint-create-customer --name "Create Customer (v2)"
  $ dr update business-service-order --description "Updated description"
  $ dr update security-policy-auth --source-file "src/auth/policy.ts" --source-provenance "extracted"`
  )
  .action(updateCommand);

program
  .command("delete <id>")
  .description("Delete an element")
  .option("--force", "Skip confirmation prompt and dependency checks")
  .option("--cascade", "Remove dependent elements automatically")
  .option("--dry-run", "Show what would be removed without actually removing")
  .addHelpText(
    "after",
    `
Examples:
  $ dr delete api-endpoint-old-endpoint
  $ dr delete api-endpoint-old-endpoint --force
  $ dr delete api-endpoint-old-endpoint --cascade
  $ dr delete api-endpoint-old-endpoint --dry-run
  $ dr delete api-endpoint-old-endpoint --cascade --dry-run`
  )
  .action(deleteCommand);

program
  .command("show <id>")
  .description("Display element details")
  .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
  .addHelpText(
    "after",
    `
Examples:
  $ dr show api-endpoint-create-customer
  $ dr show business-service-order-mgmt`
  )
  .action((id, options) => showCommand(id, options));

program
  .command("list <layer>")
  .description("List elements in a layer")
  .option("--type <type>", "Filter by element type")
  .option("--json", "Output as JSON")
  .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
  .addHelpText(
    "after",
    `
Examples:
  $ dr list api
  $ dr list business --type business-service
  $ dr list api --json`
  )
  .action(listCommand);

program
  .command("search <query>")
  .description("Search for elements by name or ID")
  .option("--layer <layer>", "Limit search to specific layer")
  .option("--type <type>", "Filter by element type")
  .option(
    "--source-file <path>",
    "Find elements referencing a source file (takes precedence over pattern matching)"
  )
  .option("--json", "Output as JSON")
  .addHelpText(
    "after",
    `
Examples:
  $ dr search customer
  $ dr search "order processing" --layer business
  $ dr search create-* --type endpoint
  $ dr search "" --source-file src/api/customer.ts`
  )
  .action(searchCommand);

program
  .command("validate")
  .description("Validate the architecture model")
  .option("--layers <layers...>", "Specific layers to validate")
  .option("--strict", "Treat warnings as errors")
  .option("--verbose", "Show detailed validation output with relationship breakdown")
  .option("--quiet", "Show minimal output")
  .option("--output <path>", "Export validation report to file (JSON or Markdown)")
  .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
  .option("--all", "Run all validations (default behavior)")
  .option("--markdown", "Validate markdown structure")
  .option("--schemas", "Validate JSON schemas")
  .option("--schema", "Validate JSON schemas (alias for --schemas)")
  .option("--relationships", "Validate relationships")
  .option("--structure", "Validate documentation structure")
  .option("--naming", "Validate naming conventions")
  .option("--references", "Validate cross-layer references")
  .addHelpText(
    "after",
    `
Examples:
  $ dr validate
  $ dr validate --all --strict
  $ dr validate --verbose
  $ dr validate --quiet
  $ dr validate --output report.json
  $ dr validate --output report.md
  $ dr validate --schemas
  $ dr validate --relationships
  $ dr validate --layers business api`
  )
  .action(validateCommand);

program
  .command("export <format>")
  .description("Export the architecture model to various formats")
  .option("--output <path>", "Output file path (default: print to stdout)")
  .option("--layers <layers...>", "Specific layers to export")
  .option("--model <path>", "Path to model root directory or manifest.yaml file")
  .option("--include-sources", "Include source file paths in PlantUML diagrams as notes")
  .addHelpText(
    "after",
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
  $ dr export plantuml --include-sources --output diagram.puml
  $ dr export markdown --output docs/architecture.md`
  )
  .action(async (format, options) => {
    await exportCommand({
      format,
      output: options.output,
      layers: options.layers,
      model: options.model,
      includeSources: options.includeSources,
    });
  });

program
  .command("import <format>")
  .description("Import architecture model from various formats")
  .option("--input <path>", "Input file path (required)", undefined)
  .option("--model <path>", "Path to model root directory or manifest.yaml file")
  .option(
    "--merge-strategy <strategy>",
    "How to handle existing elements: add, update, skip (default: add)"
  )
  .addHelpText(
    "after",
    `
Supported formats:
  archimate    Import from ArchiMate XML (layers 1, 2, 4, 5)
  openapi      Import from OpenAPI 3.0 specification (layer 6)

Examples:
  $ dr import archimate --input model.xml
  $ dr import openapi --input api.json --merge-strategy add
  $ dr import archimate --input model.xml --model ./myproject`
  )
  .action(async (format, options) => {
    if (!options.input) {
      console.error("Error: --input path is required");
      process.exit(1);
    }
    await importCommand({
      format,
      input: options.input,
      model: options.model,
      mergeStrategy: options.mergeStrategy as "add" | "update" | "skip" | undefined,
    });
  });

program
  .command("info")
  .description("Show model information")
  .option("--layer <layer>", "Show specific layer details")
  .addHelpText(
    "after",
    `
Examples:
  $ dr info
  $ dr info --layer business`
  )
  .action(infoCommand);

program
  .command("stats")
  .description("Display model statistics and health metrics")
  .option("--model <path>", "Path to the model directory")
  .option("--format <format>", "Output format: text (default), json, markdown, compact")
  .option("--output <path>", "Output file path (auto-detects format from extension)")
  .option("--compact", "Show compact one-line summary")
  .option("--verbose", "Show detailed information")
  .addHelpText(
    "after",
    `
Output formats:
  text       Full formatted statistics (default)
  json       JSON output for automation
  markdown   Markdown report format
  compact    Single-line summary

Examples:
  $ dr stats                           # Show full statistics
  $ dr stats --compact                 # Show one-line summary
  $ dr stats --format json             # Output as JSON
  $ dr stats --output stats.md         # Save as markdown file
  $ dr stats --output stats.json       # Save as JSON file
  $ dr stats --verbose                 # Show detailed information`
  )
  .action((options) => statsCommand(options));

program
  .command("report")
  .description("Generate comprehensive architecture reports")
  .option("--model <path>", "Path to the model directory")
  .option("--type <type>", "Report type: comprehensive (default), statistics, relationships, data-model, quality")
  .option("--format <format>", "Output format: text (default), json, markdown")
  .option("--output <path>", "Output file path (auto-detects format from extension)")
  .option("--verbose", "Show detailed information")
  .option("--include-data-model", "Include data model analysis (default: true)")
  .option("--include-quality", "Include quality metrics (default: true)")
  .addHelpText(
    "after",
    `
Report types:
  comprehensive  Full report with statistics, relationships, and data model (default)
  statistics     Statistics and quality metrics
  relationships  Relationship analysis and classification
  data-model     Layer 7 data model analysis
  quality        Quality metrics and recommendations

Output formats:
  text       Full formatted report (default)
  json       JSON output for automation
  markdown   Markdown report format

Examples:
  $ dr report                                      # Show comprehensive report
  $ dr report --type relationships                 # Show relationship analysis
  $ dr report --format json                        # Output as JSON
  $ dr report --output report.md                   # Save as markdown file
  $ dr report --type data-model --output dm.md     # Data model report as markdown
  $ dr report --verbose                            # Show detailed information`
  )
  .action((options) => reportCommand(options));

// Audit command - Relationship analysis
program
  .command("audit [layer]")
  .description("Analyze relationship coverage, gaps, duplicates, and balance")
  .option("--type <type>", "Audit type: relationships (default), nodes, all")
  .option("--format <format>", "Output format: text (default), json, markdown")
  .option("--output <path>", "Output file path (auto-detects format from extension)")
  .option("--verbose", "Show detailed analysis")
  .option("--save-snapshot", "Save audit report as snapshot for differential analysis")
  .addHelpText(
    "after",
    `
Audit types:
  relationships  Relationship coverage, gaps, duplicates, balance (default)
  nodes          Node type usage distribution across model layers
  all            Both relationship and node audits

Output formats:
  text       Full formatted audit report (default)
  json       JSON output for automation
  markdown   Markdown audit report format

Examples:
  $ dr audit                           # Full relationship audit of all layers
  $ dr audit security                  # Audit security layer only
  $ dr audit --type nodes              # Node type distribution audit
  $ dr audit --type all                # Combined relationship + node audit
  $ dr audit --format json             # Output as JSON
  $ dr audit --output audit.md         # Save as markdown file
  $ dr audit --verbose                 # Show detailed analysis
  $ dr audit --save-snapshot           # Save snapshot for later comparison
  $ dr audit api --output api-audit.json  # API layer audit as JSON`
  )
  .action((layer, options) => auditCommand({ ...options, layer }));

// Audit diff command - Compare snapshots
program
  .command("audit:diff")
  .description("Compare before/after audit snapshots")
  .option("--before <id>", "Before snapshot ID or timestamp")
  .option("--after <id>", "After snapshot ID or timestamp")
  .option("--format <format>", "Output format: text (default), json, markdown")
  .option("--output <path>", "Output file path")
  .option("--verbose", "Show detailed comparison")
  .addHelpText(
    "after",
    `
Examples:
  $ dr audit:diff                                  # Compare latest two snapshots
  $ dr audit:diff --before 20260220-100000 --after 20260220-150000
  $ dr audit:diff --format markdown --output diff.md
  $ dr audit:diff --verbose                        # Show detailed changes`
  )
  .action((options) => auditDiffCommand(options));

// Audit snapshots command - Manage snapshots
program
  .command("audit:snapshots <action>")
  .description("Manage audit snapshots (list, delete, clear)")
  .option("--id <id>", "Snapshot ID (for delete action)")
  .addHelpText(
    "after",
    `
Actions:
  list     List all available snapshots
  delete   Delete a specific snapshot (requires --id)
  clear    Delete all snapshots

Examples:
  $ dr audit:snapshots list
  $ dr audit:snapshots delete --id 20260220-100000
  $ dr audit:snapshots clear`
  )
  .action((action, options) => auditSnapshotsCommand({ ...options, action }));

// Relationship subcommands
const relationshipGroup = program.command("relationship").description("Relationship operations");
relationshipCommands(relationshipGroup);

// Schema introspection subcommands
schemaCommands(program);

// Catalog subcommands (modern relationship catalog)
catalogCommands(program);

// Documentation subcommands (schema-driven generation)
docsCommands(program);

// Dependency analysis commands
program
  .command("trace <elementId>")
  .description("Trace dependencies for an element")
  .option(
    "--direction <dir>",
    "Trace direction: up (dependencies), down (dependents), both (default)"
  )
  .option("--depth <num>", "Maximum traversal depth")
  .option("--metrics", "Show graph and element metrics")
  .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
  .addHelpText(
    "after",
    `
Examples:
  $ dr trace api-endpoint-create-customer
  $ dr trace business-service-order --direction down --metrics
  $ dr trace application-component-api --depth 3`
  )
  .action(async (elementId, options) => {
    await traceCommand(elementId, {
      direction: options.direction as "up" | "down" | "both" | undefined,
      depth: options.depth ? parseInt(options.depth) : undefined,
      showMetrics: options.metrics,
      model: options.model,
    });
  });

program
  .command("visualize")
  .description("Launch visualization server with WebSocket support")
  .option("--port <num>", "Server port (default: 8080)")
  .option("--no-browser", "Do not auto-open browser")
  .option("--no-auth", "Disable authentication (enabled by default)")
  .option("--token <token>", "Custom auth token (auto-generated by default)")
  .option("--with-danger", "Enable dangerous mode for chat (skip permissions)")
  .option(
    "--viewer-path <path>",
    "Path to custom viewer build (e.g., ./dist/embedded/dr-viewer-bundle)"
  )
  .addHelpText(
    "after",
    `
Examples:
  $ dr visualize
  $ dr visualize --port 3000
  $ dr visualize --no-browser
  $ dr visualize --no-auth
  $ dr visualize --token my-secret-token
  $ dr visualize --with-danger
  $ dr visualize --viewer-path ./dist/embedded/dr-viewer-bundle

The --with-danger flag enables dangerous mode for chat functionality:
  - Claude Code: --dangerously-skip-permissions
  - GitHub Copilot: --allow-all-tools

The --viewer-path option allows loading a local build of the web UI:
  - Point to a directory containing index.html and supporting files
  - Useful for developing custom viewers or using bundled distributions`
  )
  .action(async (options) => {
    const { visualizeCommand } = await import("./commands/visualize.js");
    await visualizeCommand({
      port: options.port,
      noBrowser: options.browser === false, // Commander sets 'browser' to false when --no-browser is used
      noAuth: options.auth === false, // Commander sets 'auth' to false when --no-auth is used
      token: options.token,
      withDanger: options.withDanger,
      viewerPath: options.viewerPath,
    });
  });

// AI Integration command
program
  .command("chat [client] [withDanger]")
  .description("Interactive chat with AI about the architecture model")
  .addHelpText(
    "after",
    `
Arguments:
  client      Optional AI client to use: "claude-code" or "github-copilot"
  withDanger  Enable dangerous mode: "with-danger"

Examples:
  $ dr chat                           # Auto-detect or use saved preference
  $ dr chat claude-code               # Use Claude Code, save as preference
  $ dr chat github-copilot            # Use GitHub Copilot, save as preference
  $ dr chat with-danger               # Auto-detect with dangerous mode
  $ dr chat claude-code with-danger   # Use Claude Code with dangerous mode
  $ dr chat github-copilot with-danger # Use GitHub Copilot with dangerous mode

Dangerous mode enables:
  - Claude Code: --dangerously-skip-permissions
  - GitHub Copilot: --allow-all-tools

This launches an interactive chat interface where you can ask AI questions
about your architecture model. Supports Claude Code CLI and GitHub Copilot CLI.

Install instructions:
  - Claude Code: https://claude.ai
  - GitHub Copilot: gh extension install github/gh-copilot`
  )
  .action(async (client?: string, withDangerArg?: string) => {
    // Parse arguments - handle both "with-danger" as first or second arg
    let selectedClient: string | undefined;
    let withDanger = false;

    if (client === "with-danger") {
      // Format: dr chat with-danger
      withDanger = true;
      selectedClient = undefined;
    } else if (withDangerArg === "with-danger") {
      // Format: dr chat <client> with-danger
      withDanger = true;
      selectedClient = client;
    } else {
      // Format: dr chat <client>
      selectedClient = client;
    }

    await chatCommand(selectedClient, withDanger);
  });

// Advanced commands
program
  .command("version")
  .description("Show CLI and embedded spec version information")
  .addHelpText(
    "after",
    `
Examples:
  $ dr version`
  )
  .action(async () => {
    await versionCommand();
  });

program
  .command("upgrade")
  .description("Upgrade spec reference and migrate model to latest versions")
  .option("-y, --yes", "Automatically upgrade without prompting")
  .option("--dry-run", "Show what would be upgraded without making changes")
  .option("--force", "Skip validation during migration")
  .addHelpText(
    "after",
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
  .command("migrate-elements")
  .description("Migrate elements to spec-node aligned format")
  .option("--dry-run", "Preview migration without making changes")
  .addHelpText(
    "after",
    `
Migrates all elements in the model from legacy format to spec-node aligned format.
This ensures elements match the spec-node.schema.json structure for direct validation.

Changes made:
  - Generates UUIDs for elements lacking them
  - Migrates flat properties to structured attributes
  - Preserves semantic IDs in elementId field for backward compatibility
  - Initializes metadata with creation/update timestamps

Examples:
  $ dr migrate-elements              # Migrate all elements
  $ dr migrate-elements --dry-run    # Preview changes without saving`
  )
  .action(async (options) => {
    await migrateElementsCommand({
      dryRun: options.dryRun,
    });
  });

program
  .command("conformance")
  .description("Check model conformance to layer specifications")
  .option("--layers <layers...>", "Specific layers to check")
  .option("--json", "Output as JSON")
  .option("--verbose", "Verbose output")
  .addHelpText(
    "after",
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
  let exitCode = 0;
  try {
    if (isTelemetryEnabled) {
      // Initialize telemetry before execution
      await initTelemetry();
      await installConsoleInterceptor();

      const commandName = process.argv[2] || "unknown";
      const args = process.argv.slice(3).join(" ");

      // Wrap entire CLI execution in active span for proper context propagation
      await startActiveSpan(
        "cli.execute",
        async (span) => {
          span.setAttributes({
            "cli.command": commandName,
            "cli.args": args,
            "cli.cwd": process.cwd(),
            "cli.version": cliVersion,
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
              message: getErrorMessage(error),
            });

            // Print error message for CLIError instances
            const { CLIError } = await import("./utils/errors.js");
            if (error instanceof CLIError) {
              console.error(error.message);
            } else if (error instanceof Error) {
              console.error(error.message);
            } else {
              console.error(String(error));
            }

            // Extract exit code from CLIError if available
            exitCode = await extractExitCode(error);
            // Don't throw - let telemetry shutdown complete
          }
        },
        {
          "cli.command": commandName,
          "cli.args": args,
          "cli.cwd": process.cwd(),
          "cli.version": cliVersion,
        }
      );

      // Shutdown telemetry after execution completes
      await shutdownTelemetry();

      // Exit with appropriate code after telemetry shutdown
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    } else {
      // No telemetry - just parse normally with error handling
      try {
        await program.parseAsync(process.argv);
      } catch (error) {
        // Extract exit code from CLIError if available
        const { CLIError } = await import("./utils/errors.js");
        if (error instanceof CLIError) {
          // CLIError messages are already formatted, no need to print
        } else {
          // Non-CLIError exceptions need to be printed
          if (error instanceof Error) {
            console.error(error.message);
          } else {
            console.error(String(error));
          }
        }
        const exitCodeFromError = await extractExitCode(error);
        process.exit(exitCodeFromError);
      }
    }
  } catch (error) {
    // Error during telemetry init or shutdown
    if (!isTelemetryEnabled) {
      // No telemetry - exit immediately with error
      process.exit(1);
    }
    // Telemetry enabled - try to shutdown before exit
    await shutdownTelemetry();
    process.exit(1);
  }
})();
