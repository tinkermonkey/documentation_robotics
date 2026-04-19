/**
 * Analyzer Commands - CLI surface for analyzer discovery, status, indexing, and querying
 *
 * Implements four subcommands:
 * - discover: Scan for installed analyzers and select active analyzer
 * - status: Report analyzer detection and project index state
 * - index: Index the current project with the active analyzer
 * - endpoints: List discovered API endpoints from indexed project
 */

import { Command } from "commander";
import { intro, outro, select, isCancel } from "@clack/prompts";
import ansis from "ansis";
import { AnalyzerRegistry } from "../analyzers/registry.js";
import { MappingLoader } from "../analyzers/mapping-loader.js";
import { readSession, writeSession, writeStatus } from "../analyzers/session-state.js";
import { CLIError, ModelNotFoundError, ErrorCategory, categorizeError } from "../utils/errors.js";
import { findProjectRoot } from "../utils/project-paths.js";
import type { SessionState } from "../analyzers/types.js";

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

        // Get all analyzer names
        const analyzerNames = registry.getAnalyzerNames();

        if (analyzerNames.length === 0) {
          throw new CLIError(
            "No analyzers registered in the specification",
            ErrorCategory.NOT_FOUND,
            ["Check that spec/analyzers/ contains analyzer definitions"]
          );
        }

        // Check if session already exists and not reselecting (but only for non-JSON output)
        if (!options.reselect && !options.json) {
          const session = await readSession(projectRoot);
          if (session) {
            // Already selected and not reselecting - text output
            console.log(
              ansis.green(`✓ Using analyzer: ${session.active_analyzer} (use --reselect to change)`)
            );
            return;
          }
        }

        // Get metadata for each analyzer
        const analyzerOptions = [];
        for (const name of analyzerNames) {
          try {
            const backend = await registry.getAnalyzer(name);
            if (!backend) continue;

            const detection = await backend.detect();
            const mapper = await MappingLoader.load(name);
            const metadata = mapper.getAnalyzerMetadata();

            analyzerOptions.push({
              backend,
              detection,
              metadata,
            });
          } catch (error) {
            // Log error but continue discovering other analyzers
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`Failed to discover analyzer "${name}": ${errorMsg}`);
          }
        }

        // Find installed analyzers
        const installed = analyzerOptions.filter((a) => a.detection.installed);

        // JSON output mode
        if (options.json) {
          const result: {
            found: Array<{
              name: string;
              display_name: string;
              description: string;
              homepage: string;
              installed: boolean;
            }>;
            installed_count: number;
            selected?: string;
          } = {
            found: analyzerOptions.map((a) => ({
              name: a.backend.name,
              display_name: a.backend.displayName,
              description: a.metadata?.description || "",
              homepage: a.metadata?.homepage || "",
              installed: a.detection.installed,
            })),
            installed_count: installed.length,
          };

          // If reselecting, auto-select first available analyzer in non-TTY mode
          if (options.reselect) {
            if (!process.stdin.isTTY && analyzerNames.length > 0) {
              const selectedName = analyzerNames[0];
              const state: SessionState = {
                active_analyzer: selectedName,
                selected_at: new Date().toISOString(),
              };
              await writeSession(state, projectRoot);
              result.selected = selectedName;
            }
          } else {
            // If not reselecting, check if session exists
            const session = await readSession(projectRoot);
            if (session) {
              result.selected = session.active_analyzer;
            } else if (!process.stdin.isTTY && analyzerNames.length > 0) {
              // Auto-select first registered analyzer in non-TTY mode if no session exists
              const selectedName = analyzerNames[0];
              const state: SessionState = {
                active_analyzer: selectedName,
                selected_at: new Date().toISOString(),
              };
              await writeSession(state, projectRoot);
              result.selected = selectedName;
            }
          }

          console.log(JSON.stringify(result, null, 2));
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
          // Non-TTY: use first installed analyzer
          const firstInstalled = installed[0];
          const state: SessionState = {
            active_analyzer: firstInstalled.backend.name,
            selected_at: new Date().toISOString(),
          };
          await writeSession(state, projectRoot);

          console.log(
            ansis.green(`✓ Selected analyzer: ${firstInstalled.backend.name} (non-interactive mode)`)
          );
          outro(ansis.dim("Saved to .dr/analyzers/session.json"));
        }
      } catch (error) {
        if (error instanceof CLIError) throw error;

        const category = categorizeError(error);
        throw new CLIError(
          error instanceof Error ? error.message : String(error),
          category
        );
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
        let status;
        if (actualProjectRoot) {
          status = await backend.status(actualProjectRoot);
        } else {
          const detected = await backend.detect();
          status = {
            detected,
            indexed: false,
            fresh: false,
          };
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
        throw new CLIError(
          error instanceof Error ? error.message : String(error),
          category
        );
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
        throw new CLIError(
          error instanceof Error ? error.message : String(error),
          ErrorCategory.SYSTEM
        );
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
        throw new CLIError(
          error instanceof Error ? error.message : String(error),
          categorizeError(error)
        );
      }
    });
}
