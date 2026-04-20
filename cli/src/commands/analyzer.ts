/**
 * Analyzer Commands - CLI surface for analyzer discovery, status, indexing, and querying
 *
 * Implements ten subcommands:
 * - discover: Scan for installed analyzers and select active analyzer
 * - status: Report analyzer detection and project index state
 * - index: Index the current project with the active analyzer
 * - endpoints: List discovered API endpoints from indexed project
 * - services: Query for services/components in the indexed project
 * - datastores: Query for datastores/databases inferred from code analysis
 * - callers: Query for callers of a specific function or symbol
 * - callees: Query for callees of a specific function or symbol
 * - query: Execute a raw query against the analyzer's graph
 * - verify: Verify that graph-discovered routes align with model endpoints
 */

import { Command } from "commander";
import { intro, outro, select, isCancel } from "@clack/prompts";
import ansis from "ansis";
import { promises as fs } from "fs";
import * as path from "path";
import { AnalyzerRegistry } from "../analyzers/registry.js";
import { MappingLoader } from "../analyzers/mapping-loader.js";
import { readSession, writeSession, writeStatus, readIndexMeta } from "../analyzers/session-state.js";
import { CLIError, ModelNotFoundError, ErrorCategory, categorizeError } from "../utils/errors.js";
import { findProjectRoot } from "../utils/project-paths.js";
import { performDiscover } from "./discover-logic.js";
import { formatVerifyReport } from "../export/verify-formatters.js";
import type { SessionState, AnalyzerStatus } from "../analyzers/types.js";

/**
 * Register all analyzer subcommands
 */
export function analyzerCommands(program: Command): void {
  const analyzer = program.command("analyzer").description("Manage analyzer discovery and indexing");

  /**
   * Discover subcommand - scan for installed analyzers
   *
   * Iterates through all registered analyzers, detects which are installed,
   * and prompts for selection if needed. Persists selection to session.json.
   */
  analyzer
    .command("discover")
    .description("Discover and select an analyzer")
    .option("--json", "Output as JSON")
    .option("--reselect", "Force re-selection even if analyzer already selected")
    .addHelpText(
      "after",
      `
Examples:
  $ dr analyzer discover                    # Scan and select analyzer
  $ dr analyzer discover --reselect         # Force re-selection
  $ dr analyzer discover --json             # Output discovery results as JSON`
    )
    .action(async (options) => {
      try {
        // Resolve project root for consistent session state path
        const projectRoot = (await findProjectRoot()) || process.cwd();

        // Initialize registry
        const registry = AnalyzerRegistry.getInstance();
        await registry.initialize();

        // Check if session already exists and not reselecting
        if (!options.reselect) {
          const session = await readSession(projectRoot);
          if (session) {
            if (options.json) {
              // JSON mode: return discovery results with existing session as selected
              const analyzerNames = await registry.getAnalyzerNames();
              const analyzerOptions: any[] = [];

              for (const name of analyzerNames) {
                try {
                  const backend = await registry.getAnalyzer(name);
                  if (!backend) continue;
                  const detection = await backend.detect();
                  const mapper = await MappingLoader.load(name);
                  const metadata = mapper.getAnalyzerMetadata();
                  analyzerOptions.push({ backend, detection, metadata });
                } catch (error) {
                  // Log error but continue discovering other analyzers
                  const errorMsg = error instanceof Error ? error.message : String(error);
                  console.error(`Failed to discover analyzer "${name}": ${errorMsg}`);
                }
              }

              const installed = analyzerOptions.filter((a) => a.detection.installed);
              const discoveryResult: any = {
                found: analyzerOptions.map((a) => ({
                  name: a.backend.name,
                  display_name: a.backend.displayName,
                  description: a.metadata?.description || "",
                  homepage: a.metadata?.homepage || "",
                  installed: a.detection.installed,
                })),
                installed_count: installed.length,
                selected: session.active_analyzer,
              };

              console.log(JSON.stringify(discoveryResult, null, 2));
              return;
            } else {
              // Text mode: show message and return
              console.log(
                ansis.green(`✓ Using analyzer: ${session.active_analyzer} (use --reselect to change)`)
              );
              return;
            }
          }
        }

        // Run core discover logic
        const discoverResult = await performDiscover(registry, {
          json: options.json,
          reselect: options.reselect,
          isTTY: process.stdin.isTTY,
        });

        const { discoveryResult, installed, analyzerOptions, selectedAnalyzer, shouldWriteSession } = discoverResult;

        // JSON output mode
        if (options.json) {
          // Only write session if an analyzer was actually selected
          // (selectedAnalyzer is only set if analyzers are installed)
          if (selectedAnalyzer && shouldWriteSession) {
            const state: SessionState = {
              active_analyzer: selectedAnalyzer,
              selected_at: new Date().toISOString(),
            };
            await writeSession(state, projectRoot);
            discoveryResult.selected = selectedAnalyzer;
          }

          console.log(JSON.stringify(discoveryResult, null, 2));
          return;
        }

        // Text output mode - show all analyzers with install status
        if (installed.length === 0) {
          intro(ansis.blue("📊 Analyzer Discovery"));
          console.log("");
          console.log(ansis.yellow("No analyzers installed. Install one of the following:"));
          console.log("");

          for (const opt of analyzerOptions) {
            const name = ansis.bold(opt.backend.displayName);
            const homepage = opt.metadata?.homepage || "(homepage not available)";
            console.log(`  ${name} ${ansis.dim(`(${homepage})`)}`);
          }

          console.log("");
          outro(ansis.dim("To install: follow the links above or use your package manager"));

          return;
        }

        // Prompt for selection
        intro(ansis.blue("📊 Analyzer Selection"));

        if (process.stdin.isTTY) {
          const selectedName = await select({
            message: "Select an analyzer",
            options: installed.map((a) => ({
              value: a.backend.name,
              label: a.backend.displayName,
              hint: a.metadata?.description || "",
            })),
          });

          if (isCancel(selectedName)) {
            outro(ansis.dim("Cancelled"));
            return;
          }

          // Write session
          const state: SessionState = {
            active_analyzer: selectedName as string,
            selected_at: new Date().toISOString(),
          };
          await writeSession(state, projectRoot);

          outro(
            ansis.green(
              `✓ Selected analyzer: ${selectedName} (saved to .dr/analyzers/session.json)`
            )
          );
        } else {
          // Non-TTY: auto-select first installed analyzer
          if (selectedAnalyzer) {
            const state: SessionState = {
              active_analyzer: selectedAnalyzer,
              selected_at: new Date().toISOString(),
            };
            await writeSession(state, projectRoot);

            console.log(
              ansis.green(`✓ Selected analyzer: ${selectedAnalyzer} (non-interactive mode)`)
            );
            outro(ansis.dim("Saved to .dr/analyzers/session.json"));
          }
        }
      } catch (error) {
        if (error instanceof CLIError) throw error;

        const category = categorizeError(error);
        const cliError = new CLIError(
          error instanceof Error ? error.message : String(error),
          category
        );
        if (error instanceof Error) {
          cliError.cause = error;
        }
        throw cliError;
      }
    });

  /**
   * Status subcommand - report analyzer detection and project index state
   */
  analyzer
    .command("status")
    .description("Check analyzer detection and project index status")
    .option("--name <n>", "Analyzer name (defaults to active from session.json)")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ dr analyzer status              # Show status of active analyzer
  $ dr analyzer status --name cbm   # Show status of specific analyzer
  $ dr analyzer status --json       # Output as JSON`
    )
    .action(async (options) => {
      try {
        // Resolve project root for consistent session state path
        const projectRoot = (await findProjectRoot()) || process.cwd();

        // Resolve analyzer name
        let analyzerName = options.name;
        if (!analyzerName) {
          const session = await readSession(projectRoot);
          if (!session) {
            throw new CLIError(
              "No analyzer selected. Run `dr analyzer discover` first.",
              ErrorCategory.USER
            );
          }
          analyzerName = session.active_analyzer;
        }

        // Get analyzer
        const registry = AnalyzerRegistry.getInstance();
        await registry.initialize();
        const backend = await registry.getAnalyzer(analyzerName);

        if (!backend) {
          throw new CLIError(
            `Analyzer not found: ${analyzerName}`,
            ErrorCategory.NOT_FOUND,
            ["Check the analyzer name with `dr analyzer discover`"]
          );
        }

        // Get status (use project root from findProjectRoot for backend operations)
        const actualProjectRoot = await findProjectRoot();
        let status: AnalyzerStatus;
        if (actualProjectRoot) {
          status = await backend.status(actualProjectRoot);
        } else {
          const detected = await backend.detect();
          status = {
            detected,
            indexed: false,
            fresh: false,
          } as AnalyzerStatus;
        }

        // JSON output
        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          if (actualProjectRoot) {
            await writeStatus(status, actualProjectRoot, analyzerName);
          }
          return;
        }

        // Text output
        console.log("");
        console.log(ansis.bold("Analyzer Status"));
        console.log(ansis.dim("─".repeat(40)));

        console.log(
          `Installed: ${status.detected.installed ? ansis.green("✓ Yes") : ansis.red("✗ No")}`
        );

        if (status.detected.binary_path) {
          console.log(`Binary: ${ansis.dim(status.detected.binary_path)}`);
        }

        if (status.detected.version) {
          console.log(`Version: ${ansis.dim(status.detected.version)}`);
        }

        console.log(
          `MCP Registered: ${status.detected.mcp_registered ? ansis.green("✓ Yes") : ansis.yellow("✗ No")}`
        );

        console.log(
          `Contract Valid: ${status.detected.contract_ok ? ansis.green("✓ Yes") : ansis.yellow("✗ No")}`
        );

        if (actualProjectRoot) {
          console.log(
            `Indexed: ${status.indexed ? ansis.green("✓ Yes") : ansis.yellow("✗ No")}`
          );

          if (status.indexed) {
            console.log(
              `Fresh: ${status.fresh ? ansis.green("✓ Yes") : ansis.yellow("✗ No (use --force to reindex)")}`
            );

            if (status.last_indexed) {
              console.log(`Last indexed: ${ansis.dim(status.last_indexed)}`);
            }
          } else {
            console.log(ansis.dim("Run `dr analyzer index` to index the project"));
          }
        }

        console.log("");

        // Write status file
        if (actualProjectRoot) {
          await writeStatus(status, actualProjectRoot, analyzerName);
        }
      } catch (error) {
        if (error instanceof CLIError) throw error;

        const category = categorizeError(error);
        const cliError = new CLIError(
          error instanceof Error ? error.message : String(error),
          category
        );
        if (error instanceof Error) {
          cliError.cause = error;
        }
        throw cliError;
      }
    });

  /**
   * Index subcommand - index the current project
   */
  analyzer
    .command("index")
    .description("Index the current project with the analyzer")
    .option("--name <n>", "Analyzer name (defaults to active from session.json)")
    .option("--force", "Force re-indexing even if index is fresh")
    .addHelpText(
      "after",
      `
Examples:
  $ dr analyzer index              # Index with active analyzer
  $ dr analyzer index --force      # Force re-index
  $ dr analyzer index --name cbm   # Index with specific analyzer`
    )
    .action(async (options) => {
      try {
        // Find project root - required for indexing
        const projectRoot = await findProjectRoot();
        if (!projectRoot) {
          throw new ModelNotFoundError();
        }

        // Resolve analyzer name
        let analyzerName = options.name;
        if (!analyzerName) {
          const session = await readSession(projectRoot);
          if (!session) {
            throw new CLIError(
              "No analyzer selected. Run `dr analyzer discover` first.",
              ErrorCategory.USER
            );
          }
          analyzerName = session.active_analyzer;
        }

        // Get analyzer
        const registry = AnalyzerRegistry.getInstance();
        await registry.initialize();
        const backend = await registry.getAnalyzer(analyzerName);

        if (!backend) {
          throw new CLIError(
            `Analyzer not found: ${analyzerName}`,
            ErrorCategory.NOT_FOUND,
            ["Check the analyzer name with `dr analyzer discover`"]
          );
        }

        // Check if installed
        const detection = await backend.detect();
        if (!detection.installed) {
          // Get analyzer metadata for suggestions
          const mapper = await MappingLoader.load(analyzerName);
          const metadata = mapper.getAnalyzerMetadata();
          const homepageUrl = metadata?.homepage || "https://github.com/search?q=codebase-memory";

          throw new CLIError(
            `Analyzer not installed: ${analyzerName}`,
            ErrorCategory.USER,
            [
              "Run `dr analyzer discover` to find available analyzers and installation instructions",
              `Visit: ${homepageUrl}`,
            ]
          );
        }

        // Index the project
        console.log(`Indexing project with ${analyzerName}...`);
        const result = await backend.index(projectRoot, { force: options.force });

        console.log(ansis.green(`✓ Indexing complete`));
        console.log(`  Nodes: ${result.node_count}`);
        console.log(`  Edges: ${result.edge_count}`);
        console.log(`  Git HEAD: ${result.git_head}`);
      } catch (error) {
        if (error instanceof CLIError || error instanceof ModelNotFoundError) throw error;
        const cliError = new CLIError(
          error instanceof Error ? error.message : String(error),
          ErrorCategory.SYSTEM
        );
        if (error instanceof Error) {
          cliError.cause = error;
        }
        throw cliError;
      }
    });

  /**
   * Endpoints subcommand - list API endpoints from indexed project
   */
  analyzer
    .command("endpoints")
    .description("List discovered API endpoints from indexed project")
    .option("--name <n>", "Analyzer name (defaults to active from session.json)")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ dr analyzer endpoints              # List endpoints from active analyzer
  $ dr analyzer endpoints --json       # Output as JSON
  $ dr analyzer endpoints --name cbm   # List endpoints from specific analyzer`
    )
    .action(async (options) => {
      try {
        // Find project root
        const projectRoot = await findProjectRoot();
        if (!projectRoot) {
          throw new ModelNotFoundError();
        }

        // Resolve analyzer name
        let analyzerName = options.name;
        if (!analyzerName) {
          const session = await readSession(projectRoot);
          if (!session) {
            throw new CLIError(
              "No analyzer selected. Run `dr analyzer discover` first.",
              ErrorCategory.USER
            );
          }
          analyzerName = session.active_analyzer;
        }

        // Get analyzer
        const registry = AnalyzerRegistry.getInstance();
        await registry.initialize();
        const backend = await registry.getAnalyzer(analyzerName);

        if (!backend) {
          throw new CLIError(
            `Analyzer not found: ${analyzerName}`,
            ErrorCategory.NOT_FOUND
          );
        }

        // Check if project is indexed
        const status = await backend.status(projectRoot);
        if (!status.indexed) {
          throw new CLIError(
            "Project not indexed",
            ErrorCategory.USER,
            ["Run `dr analyzer index` to index the project first"]
          );
        }

        // Query for endpoints
        const endpoints = await backend.endpoints(projectRoot);

        // JSON output
        if (options.json) {
          console.log(JSON.stringify(endpoints, null, 2));
          return;
        }

        // Table output
        if (endpoints.length === 0) {
          console.log(ansis.yellow("No endpoints found"));
          return;
        }

        console.log("");
        console.log(ansis.bold(`API Endpoints (${endpoints.length} found):`));
        console.log(ansis.dim("─".repeat(135)));

        // Print header
        const methodWidth = 8;
        const pathWidth = 20;
        const nameWidth = 18;
        const idFragmentWidth = 18;
        const symbolWidth = 18;
        const confidenceWidth = 12;
        const fileWidth = 25;

        console.log(
          ansis.cyan(
            `${"Method".padEnd(methodWidth)} ${"Path".padEnd(pathWidth)} ${"Name".padEnd(nameWidth)} ${"ID Fragment".padEnd(idFragmentWidth)} ${"Symbol".padEnd(symbolWidth)} ${"Confidence".padEnd(confidenceWidth)} File`
          )
        );
        console.log(ansis.dim("─".repeat(135)));

        // Print each endpoint
        for (const endpoint of endpoints) {
          const method = endpoint.http_method.padEnd(methodWidth);
          const path = endpoint.http_path.substring(0, pathWidth).padEnd(pathWidth);
          const name = endpoint.suggested_name.substring(0, nameWidth).padEnd(nameWidth);
          const idFragment = endpoint.suggested_id_fragment.substring(0, idFragmentWidth).padEnd(idFragmentWidth);
          const symbol = endpoint.source_symbol.substring(0, symbolWidth).padEnd(symbolWidth);
          const confidence = endpoint.confidence.toUpperCase().padEnd(confidenceWidth);
          const file = endpoint.source_file.substring(0, fileWidth);

          console.log(`${method} ${path} ${name} ${idFragment} ${symbol} ${confidence} ${ansis.dim(file)}`);
        }

        console.log(ansis.dim("─".repeat(135)));
        console.log(ansis.dim(`Total: ${endpoints.length} endpoint(s)`));
        console.log("");
      } catch (error) {
        if (error instanceof CLIError || error instanceof ModelNotFoundError) throw error;
        const cliError = new CLIError(
          error instanceof Error ? error.message : String(error),
          categorizeError(error)
        );
        if (error instanceof Error) {
          cliError.cause = error;
        }
        throw cliError;
      }
    });

  /**
   * Services subcommand - query for services/components in indexed project
   */
  analyzer
    .command("services")
    .description("Query for services/components in the indexed project")
    .option("--name <n>", "Analyzer name (defaults to active from session.json)")
    .option("--layer <layer>", "Filter by layer (e.g., 'application')")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ dr analyzer services              # List all services
  $ dr analyzer services --layer application
  $ dr analyzer services --json       # Output as JSON`
    )
    .action(async (options) => {
      try {
        // Find project root
        const projectRoot = await findProjectRoot();
        if (!projectRoot) {
          throw new ModelNotFoundError();
        }

        // Resolve analyzer name
        let analyzerName = options.name;
        if (!analyzerName) {
          const session = await readSession(projectRoot);
          if (!session) {
            throw new CLIError(
              "No analyzer selected. Run `dr analyzer discover` first.",
              ErrorCategory.USER
            );
          }
          analyzerName = session.active_analyzer;
        }

        // Get analyzer
        const registry = AnalyzerRegistry.getInstance();
        await registry.initialize();
        const backend = await registry.getAnalyzer(analyzerName);

        if (!backend) {
          throw new CLIError(
            `Analyzer not found: ${analyzerName}`,
            ErrorCategory.NOT_FOUND
          );
        }

        // Check if project is indexed
        const indexMeta = await readIndexMeta(projectRoot, analyzerName);
        if (!indexMeta) {
          throw new CLIError(
            "Project not indexed",
            ErrorCategory.USER,
            ["Run `dr analyzer index` first"]
          );
        }

        // Query for services
        let services = await backend.services(projectRoot);

        // Filter by layer if specified
        if (options.layer) {
          services = services.filter(s => s.suggested_layer === options.layer);
        }

        // JSON output
        if (options.json) {
          console.log(JSON.stringify(services, null, 2));
          return;
        }

        // Table output
        if (services.length === 0) {
          console.log(ansis.yellow("No services found"));
          return;
        }

        console.log("");
        console.log(ansis.bold(`Services (${services.length} found):`));
        console.log(ansis.dim("─".repeat(120)));

        // Print header
        const nameWidth = 20;
        const layerWidth = 15;
        const typeWidth = 18;
        const symbolWidth = 20;
        const confidenceWidth = 12;
        const fileWidth = 25;

        console.log(
          ansis.cyan(
            `${"Name".padEnd(nameWidth)} ${"Layer".padEnd(layerWidth)} ${"Type".padEnd(typeWidth)} ${"Symbol".padEnd(symbolWidth)} ${"Confidence".padEnd(confidenceWidth)} File`
          )
        );
        console.log(ansis.dim("─".repeat(120)));

        // Print each service
        for (const service of services) {
          const name = service.suggested_name.substring(0, nameWidth).padEnd(nameWidth);
          const layer = service.suggested_layer.substring(0, layerWidth).padEnd(layerWidth);
          const type = service.suggested_element_type.substring(0, typeWidth).padEnd(typeWidth);
          const symbol = service.source_symbol.substring(0, symbolWidth).padEnd(symbolWidth);
          const confidence = service.confidence.toUpperCase().padEnd(confidenceWidth);
          const file = service.source_file.substring(0, fileWidth);

          console.log(`${name} ${layer} ${type} ${symbol} ${confidence} ${ansis.dim(file)}`);
        }

        console.log(ansis.dim("─".repeat(120)));
        console.log(ansis.dim(`Total: ${services.length} service(s)`));
        console.log("");
      } catch (error) {
        if (error instanceof CLIError || error instanceof ModelNotFoundError) throw error;
        const cliError = new CLIError(
          error instanceof Error ? error.message : String(error),
          categorizeError(error)
        );
        if (error instanceof Error) {
          cliError.cause = error;
        }
        throw cliError;
      }
    });

  /**
   * Datastores subcommand - query for datastores/databases inferred from code
   */
  analyzer
    .command("datastores")
    .description("Query for datastores/databases inferred from code analysis")
    .option("--name <n>", "Analyzer name (defaults to active from session.json)")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ dr analyzer datastores        # List all inferred datastores
  $ dr analyzer datastores --json # Output as JSON`
    )
    .action(async (options) => {
      try {
        // Find project root
        const projectRoot = await findProjectRoot();
        if (!projectRoot) {
          throw new ModelNotFoundError();
        }

        // Resolve analyzer name
        let analyzerName = options.name;
        if (!analyzerName) {
          const session = await readSession(projectRoot);
          if (!session) {
            throw new CLIError(
              "No analyzer selected. Run `dr analyzer discover` first.",
              ErrorCategory.USER
            );
          }
          analyzerName = session.active_analyzer;
        }

        // Get analyzer
        const registry = AnalyzerRegistry.getInstance();
        await registry.initialize();
        const backend = await registry.getAnalyzer(analyzerName);

        if (!backend) {
          throw new CLIError(
            `Analyzer not found: ${analyzerName}`,
            ErrorCategory.NOT_FOUND
          );
        }

        // Check if project is indexed
        const indexMeta = await readIndexMeta(projectRoot, analyzerName);
        if (!indexMeta) {
          throw new CLIError(
            "Project not indexed",
            ErrorCategory.USER,
            ["Run `dr analyzer index` first"]
          );
        }

        // Query for datastores
        const datastores = await backend.datastores(projectRoot);

        // JSON output
        if (options.json) {
          console.log(JSON.stringify(datastores, null, 2));
          return;
        }

        // Table output
        if (datastores.length === 0) {
          console.log(ansis.yellow("No datastores found"));
          return;
        }

        console.log("");
        console.log(ansis.bold(`Datastores (${datastores.length} found):`));
        console.log(ansis.dim("─".repeat(100)));

        // Print each datastore
        for (const ds of datastores) {
          console.log(`  ${ansis.cyan(ds.suggested_name)}`);
          console.log(`    Inferred from:`);
          for (const evidence of ds.inferred_from) {
            console.log(`      - ${evidence.source_file}: ${evidence.import_pattern}`);
          }
          if (ds.notes) {
            console.log(`    Notes: ${ds.notes}`);
          }
          console.log("");
        }

        console.log(ansis.dim(`Total: ${datastores.length} datastore(s)`));
        console.log("");
      } catch (error) {
        if (error instanceof CLIError || error instanceof ModelNotFoundError) throw error;
        const cliError = new CLIError(
          error instanceof Error ? error.message : String(error),
          categorizeError(error)
        );
        if (error instanceof Error) {
          cliError.cause = error;
        }
        throw cliError;
      }
    });

  /**
   * Callers subcommand - query for callers of a specific symbol
   */
  analyzer
    .command("callers <qualified-name>")
    .description("Query for callers of a specific function or symbol")
    .option("--name <n>", "Analyzer name (defaults to active from session.json)")
    .option("--depth <n>", "Maximum depth for call graph traversal (default: 3, max: 10)", "3")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ dr analyzer callers com.example.Service.handleRequest
  $ dr analyzer callers com.example.Service.handleRequest --depth 5
  $ dr analyzer callers com.example.Service.handleRequest --json`
    )
    .action(async (qualifiedName, options) => {
      try {
        // Validate depth
        const depth = parseInt(options.depth, 10);
        if (isNaN(depth) || depth < 1) {
          throw new CLIError(
            "Invalid --depth value: must be a positive integer",
            ErrorCategory.USER
          );
        }

        // Find project root
        const projectRoot = await findProjectRoot();
        if (!projectRoot) {
          throw new ModelNotFoundError();
        }

        // Resolve analyzer name
        let analyzerName = options.name;
        if (!analyzerName) {
          const session = await readSession(projectRoot);
          if (!session) {
            throw new CLIError(
              "No analyzer selected. Run `dr analyzer discover` first.",
              ErrorCategory.USER
            );
          }
          analyzerName = session.active_analyzer;
        }

        // Get analyzer
        const registry = AnalyzerRegistry.getInstance();
        await registry.initialize();
        const backend = await registry.getAnalyzer(analyzerName);

        if (!backend) {
          throw new CLIError(
            `Analyzer not found: ${analyzerName}`,
            ErrorCategory.NOT_FOUND
          );
        }

        // Check if project is indexed
        const indexMeta = await readIndexMeta(projectRoot, analyzerName);
        if (!indexMeta) {
          throw new CLIError(
            "Project not indexed",
            ErrorCategory.USER,
            ["Run `dr analyzer index` first"]
          );
        }

        // Query for callers
        const callers = await backend.callers(projectRoot, qualifiedName, depth);

        // JSON output
        if (options.json) {
          console.log(JSON.stringify(callers, null, 2));
          return;
        }

        // Table output
        if (callers.length === 0) {
          console.log(ansis.yellow(`No callers found for ${qualifiedName}`));
          return;
        }

        console.log("");
        console.log(ansis.bold(`Callers of ${ansis.cyan(qualifiedName)} (${callers.length} found):`));
        console.log(ansis.dim("─".repeat(100)));

        // Print each caller
        for (const caller of callers) {
          console.log(`  ${ansis.bold(caller.qualified_name)}`);
          console.log(`    File: ${caller.source_file}`);
          console.log(`    Symbol: ${caller.source_symbol}`);
          console.log(`    Depth: ${caller.depth}`);
          console.log(`    Edge: ${caller.edge_type}`);
          console.log("");
        }

        console.log(ansis.dim(`Total: ${callers.length} caller(s)`));
        console.log("");
      } catch (error) {
        if (error instanceof CLIError || error instanceof ModelNotFoundError) throw error;
        const cliError = new CLIError(
          error instanceof Error ? error.message : String(error),
          categorizeError(error)
        );
        if (error instanceof Error) {
          cliError.cause = error;
        }
        throw cliError;
      }
    });

  /**
   * Callees subcommand - query for callees of a specific symbol
   */
  analyzer
    .command("callees <qualified-name>")
    .description("Query for callees of a specific function or symbol")
    .option("--name <n>", "Analyzer name (defaults to active from session.json)")
    .option("--depth <n>", "Maximum depth for call graph traversal (default: 3, max: 10)", "3")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ dr analyzer callees com.example.Service.handleRequest
  $ dr analyzer callees com.example.Service.handleRequest --depth 5
  $ dr analyzer callees com.example.Service.handleRequest --json`
    )
    .action(async (qualifiedName, options) => {
      try {
        // Validate depth
        const depth = parseInt(options.depth, 10);
        if (isNaN(depth) || depth < 1) {
          throw new CLIError(
            "Invalid --depth value: must be a positive integer",
            ErrorCategory.USER
          );
        }

        // Find project root
        const projectRoot = await findProjectRoot();
        if (!projectRoot) {
          throw new ModelNotFoundError();
        }

        // Resolve analyzer name
        let analyzerName = options.name;
        if (!analyzerName) {
          const session = await readSession(projectRoot);
          if (!session) {
            throw new CLIError(
              "No analyzer selected. Run `dr analyzer discover` first.",
              ErrorCategory.USER
            );
          }
          analyzerName = session.active_analyzer;
        }

        // Get analyzer
        const registry = AnalyzerRegistry.getInstance();
        await registry.initialize();
        const backend = await registry.getAnalyzer(analyzerName);

        if (!backend) {
          throw new CLIError(
            `Analyzer not found: ${analyzerName}`,
            ErrorCategory.NOT_FOUND
          );
        }

        // Check if project is indexed
        const indexMeta = await readIndexMeta(projectRoot, analyzerName);
        if (!indexMeta) {
          throw new CLIError(
            "Project not indexed",
            ErrorCategory.USER,
            ["Run `dr analyzer index` first"]
          );
        }

        // Query for callees
        const callees = await backend.callees(projectRoot, qualifiedName, depth);

        // JSON output
        if (options.json) {
          console.log(JSON.stringify(callees, null, 2));
          return;
        }

        // Table output
        if (callees.length === 0) {
          console.log(ansis.yellow(`No callees found for ${qualifiedName}`));
          return;
        }

        console.log("");
        console.log(ansis.bold(`Callees of ${ansis.cyan(qualifiedName)} (${callees.length} found):`));
        console.log(ansis.dim("─".repeat(100)));

        // Print each callee
        for (const callee of callees) {
          console.log(`  ${ansis.bold(callee.qualified_name)}`);
          console.log(`    File: ${callee.source_file}`);
          console.log(`    Symbol: ${callee.source_symbol}`);
          console.log(`    Depth: ${callee.depth}`);
          console.log(`    Edge: ${callee.edge_type}`);
          console.log("");
        }

        console.log(ansis.dim(`Total: ${callees.length} callee(s)`));
        console.log("");
      } catch (error) {
        if (error instanceof CLIError || error instanceof ModelNotFoundError) throw error;
        const cliError = new CLIError(
          error instanceof Error ? error.message : String(error),
          categorizeError(error)
        );
        if (error instanceof Error) {
          cliError.cause = error;
        }
        throw cliError;
      }
    });

  /**
   * Query subcommand - execute a raw query against the analyzer's graph
   */
  analyzer
    .command("query <cypher>")
    .description("Execute a raw query (advanced escape hatch for graph queries)")
    .option("--name <n>", "Analyzer name (defaults to active from session.json)")
    .option("--json", "Output as JSON (default format for query results)")
    .addHelpText(
      "after",
      `
Advanced escape hatch for executing raw graph queries.
Query syntax depends on the analyzer backend (e.g., Cypher for graph analyzers).

Examples:
  $ dr analyzer query "MATCH (n) RETURN n LIMIT 10"
  $ dr analyzer query "MATCH (n:Service) RETURN n.name"
  $ dr analyzer query "MATCH (n) RETURN n LIMIT 10" --json`
    )
    .action(async (cypher, options) => {
      try {
        // Find project root
        const projectRoot = await findProjectRoot();
        if (!projectRoot) {
          throw new ModelNotFoundError();
        }

        // Resolve analyzer name
        let analyzerName = options.name;
        if (!analyzerName) {
          const session = await readSession(projectRoot);
          if (!session) {
            throw new CLIError(
              "No analyzer selected. Run `dr analyzer discover` first.",
              ErrorCategory.USER
            );
          }
          analyzerName = session.active_analyzer;
        }

        // Get analyzer
        const registry = AnalyzerRegistry.getInstance();
        await registry.initialize();
        const backend = await registry.getAnalyzer(analyzerName);

        if (!backend) {
          throw new CLIError(
            `Analyzer not found: ${analyzerName}`,
            ErrorCategory.NOT_FOUND
          );
        }

        // Check if project is indexed
        const indexMeta = await readIndexMeta(projectRoot, analyzerName);
        if (!indexMeta) {
          throw new CLIError(
            "Project not indexed",
            ErrorCategory.USER,
            ["Run `dr analyzer index` first"]
          );
        }

        // Execute query
        const result = await backend.query(projectRoot, cypher);

        // Output format: JSON is the only reasonable format for arbitrary query results
        // The --json flag is accepted for consistency, but JSON is always the output format
        // (the flag currently has no effect as all query output is JSON)
        if (options.json === false) {
          // Explicit no-op: --json flag or its absence doesn't change behavior
          // Query results are always output as JSON regardless of flag
        }
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        if (error instanceof CLIError || error instanceof ModelNotFoundError) throw error;
        const cliError = new CLIError(
          error instanceof Error ? error.message : String(error),
          categorizeError(error)
        );
        if (error instanceof Error) {
          cliError.cause = error;
        }
        throw cliError;
      }
    });

  /**
   * Verify subcommand - verify that graph-discovered routes align with model endpoints
   */
  analyzer
    .command("verify")
    .description("Verify that graph-discovered routes align with model endpoints")
    .option("--name <n>", "Analyzer name (defaults to active from session.json)")
    .option("--layer <layer>", "Layer(s) to verify (can be used multiple times)", (value, previous: string[] | undefined) => {
      return previous ? [...previous, value] : [value];
    })
    .option("--output <path>", "Write report to file")
    .option("--json", "Output as JSON (instead of text)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr analyzer verify                       # Verify api layer (default)
  $ dr analyzer verify --layer api           # Explicitly specify api layer
  $ dr analyzer verify --output report.json  # Save report to file (format inferred as JSON)
  $ dr analyzer verify --output report.txt   # Save report as text
  $ dr analyzer verify --json                # Output as JSON to stdout`
    )
    .action(async (options) => {
      try {
        // Determine output format from --json flag or --output file extension
        let format: "text" | "json" | "markdown" = "text";
        if (options.json) {
          format = "json";
        } else if (options.output) {
          const ext = path.extname(options.output).toLowerCase();
          if (ext === ".json") {
            format = "json";
          } else if (ext === ".md") {
            format = "markdown";
          }
        }

        // Find project root
        const projectRoot = await findProjectRoot();
        if (!projectRoot) {
          throw new ModelNotFoundError();
        }

        // Validate layers - only api is supported in v1
        const requestedLayers = options.layer || ["api"];
        const apiLayers = requestedLayers.filter((layer: string) => layer === "api");
        const nonApiLayers = requestedLayers.filter((layer: string) => layer !== "api");

        // Report non-api layers with v1 scope constraint
        for (const layer of nonApiLayers) {
          console.log(ansis.dim(`Verify scope v1 only supports api layer; '${layer}' is not supported.`));
        }

        // If no api layers to verify, throw error
        if (apiLayers.length === 0) {
          throw new CLIError(`No supported layers to verify. Verify scope v1 only supports api layer.`);
        }

        // Resolve analyzer name
        let analyzerName = options.name;
        if (!analyzerName) {
          const session = await readSession(projectRoot);
          if (!session) {
            throw new CLIError(
              "No analyzer selected. Run `dr analyzer discover` first.",
              ErrorCategory.USER
            );
          }
          analyzerName = session.active_analyzer;
        }

        // Get analyzer
        const registry = AnalyzerRegistry.getInstance();
        await registry.initialize();
        const backend = await registry.getAnalyzer(analyzerName);

        if (!backend) {
          throw new CLIError(
            `Analyzer not found: ${analyzerName}`,
            ErrorCategory.NOT_FOUND
          );
        }

        // Check if project is indexed
        const indexMeta = await readIndexMeta(projectRoot, analyzerName);
        if (!indexMeta) {
          throw new CLIError(
            "Project not indexed",
            ErrorCategory.USER,
            ["Run `dr analyzer index` first"]
          );
        }

        // Execute verification with changeset awareness enabled by default
        const report = await backend.verify(projectRoot, {
          layers: apiLayers,
          changesetAware: true,
        });

        const formatted = formatVerifyReport(report, { format });

        // Write to file if --output specified
        if (options.output) {
          const outputPath = path.resolve(options.output);
          await fs.writeFile(outputPath, formatted, "utf-8");
          console.log(ansis.green(`✓ Report written to ${outputPath}`));
          return;
        }

        // Print to stdout
        console.log(formatted);
      } catch (error) {
        if (error instanceof CLIError || error instanceof ModelNotFoundError) throw error;
        const cliError = new CLIError(
          error instanceof Error ? error.message : String(error),
          categorizeError(error)
        );
        if (error instanceof Error) {
          cliError.cause = error;
        }
        throw cliError;
      }
    });
}
