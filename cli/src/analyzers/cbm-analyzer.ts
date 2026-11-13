/**
 * CBM (Codebase Memory) Analyzer Backend
 *
 * Implements the AnalyzerBackend interface for the codebase-memory-mcp analyzer.
 * Handles detection, indexing, and querying of code-based metadata using the CBM MCP server.
 *
 * Key responsibilities:
 * - Detect CBM binary availability and MCP registration
 * - Manage project indexing with freshness tracking
 * - Query for endpoints and other code artifacts
 * - Transform CBM nodes to DR elements using mapping templates
 */

import { spawnSync } from "child_process";
import * as path from "path";
import { readFile, writeFile } from "fs/promises";
import { CLIError, ErrorCategory, handleWarning } from "../utils/errors.js";
import type { AnalyzerBackend, AnalyzerCodebaseOptions } from "./base-analyzer.js";
import type {
  AnalyzerStatus,
  DetectionResult,
  DetectedChanges,
  EndpointCandidate,
  IndexResult,
  IndexMeta,
  AnalyzerNodeMapping,
  AnalyzerHeuristic,
  HttpMethod,
  ServiceCandidate,
  DatastoreCandidate,
  CallGraphNode,
  VerifyOptions,
  VerifyReport,
} from "./types.js";
import { VALID_HTTP_METHODS } from "./types.js";
import { START_FAILURE_SUGGESTIONS, StdioClient, resolveInitTimeoutMs } from "./stdio-client.js";
import { readIndexMeta, writeIndexMeta } from "./session-state.js";
import type { MappingLoader } from "./mapping-loader.js";
import { analyzerChanged, binaryVersion, getCliVersion, parseVersion } from "./version.js";
import { StagingAreaManager } from "../core/staging-area.js";
import { DR_OWN_DIRS } from "./code-changes.js";
import { VerifyEngine, apiLayerReport } from "./verify-engine.js";
import { LAYER_CHECKS, readRecordedDecisions, verifyLayers } from "./layer-verify.js";
import { IgnoreFileLoader } from "./verify-ignore.js";
import { Model } from "../core/model.js";
import { Changeset } from "../core/changeset.js";
import { ChangesetGraph } from "../core/changeset-graph.js";
import { catalogHasTriple, loadExtractionCoverage } from "../core/extraction-observability.js";
import { existsSync, readFileSync } from "fs";
import { clampDepth, shapeCallGraphNode, determineEdgeType } from "./call-graph-utils.js";
import { evaluateHeuristic, capConfidence, matchPattern, getKnownHeuristicNames } from "./heuristic-utils.js";
import { toKebabCase } from "../utils/id-generator.js";
import {
  CbmTools,
  CbmToolError,
  ROUTE_FIELDS,
  ROUTE_HANDLERS_QUERY,
  attachRouteHandlers,
  isServedRoute,
  nodeColumns,
  nodesFromQuery,
  relativeToRoot,
  routeHandlersFromQuery,
} from "./cbm-responses.js";
import type { CbmGraphNode } from "./cbm-responses.js";
import { cbmCardGraph } from "./cards/graph.js";
import { TEST_CARD_LABELS, classifyTier0, defaultLabels, type ClassifyOptions, type ClassifyReport } from "./cards/classify.js";
import { CARD_FIELDS } from "./cards/build.js";
import { tier0RulesFrom } from "./tier0-rules.js";
import { callGateFrom } from "./call-evidence.js";
import { collectExtraction, extractionConfigFrom, type ExtractOptions, type ExtractionConfig, type ExtractionGraph } from "./cards/extract.js";
import {
  attachTargetRoutes,
  handlerRoutes,
  linkCrossRepoTargets,
} from "./cross-model.js";

/** Each handler's route in a cross-repo target project, with the route's stored (named-parameter) path. */
const TARGET_HANDLERS_QUERY = "MATCH (f)-[:HANDLES]->(r:Route) RETURN f.name, f.file_path, r.qualified_name, r.name";

/**
 * The message for a failed detection: "not installed", or why a binary that was found
 * could not be used (such as an initialize timeout, whose message names DR_CBM_INIT_TIMEOUT_MS).
 */
export function cbmNotInstalledMessage(detection: DetectionResult): string {
  return !detection.installed && detection.error
    ? `CBM analyzer could not be started: ${detection.error}`
    : "CBM analyzer not installed";
}

/**
 * The error for a failed detection. A binary that was found but could not be started gets
 * start-up advice (raise DR_CBM_INIT_TIMEOUT_MS, check `codebase-memory-mcp --version`),
 * not advice to install what is already installed.
 */
export function cbmNotInstalledError(detection: DetectionResult): CLIError {
  const message = cbmNotInstalledMessage(detection);
  if (!detection.installed && detection.error) {
    return new CLIError(message, ErrorCategory.USER, [...START_FAILURE_SUGGESTIONS]);
  }
  return new CLIError(message, ErrorCategory.NOT_FOUND, [
    "Install codebase-memory-mcp: npm install -g codebase-memory-mcp",
    "Ensure the binary is in your PATH",
  ]);
}

/** Per-call timeout for extraction's graph reads (the stdio client's default is 30s). */
const EXTRACT_CALL_TIMEOUT_MS = 120_000;

// Source-code file extensions that CBM sometimes mislabels as Route nodes when it
// encounters string literals that look like paths (e.g. "/src/app.ts").
// Only source-code extensions are listed — .json, .xml, .csv, .html etc. are
// legitimate HTTP route suffixes and must NOT be filtered out.
export const SOURCE_CODE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|py|go|rb|java|rs|php|cs|cpp|c|h|kt|swift|sh|bash)$/i;

/**
 * Returns true when a qualified_name looks like a real HTTP route rather than
 * a source-file path that the CBM indexer mislabelled as a Route node.
 */
function isLikelyHttpRoute(qualifiedName: string): boolean {
  const httpPath = qualifiedName.replace(/^__route__[A-Z]+__/, "");
  // Reject source-code file paths, internal DR paths, and spec artifact paths
  // (e.g. /schemas/motivation/goal from test fixtures or openapi schema refs)
  return !SOURCE_CODE_EXT_RE.test(httpPath)
    && !httpPath.startsWith("/.dr/")
    && !httpPath.startsWith("/schemas/");
}

/**
 * Infer HTTP method from a function name using naming conventions.
 * Returns "GET" by default for ambiguous names.
 */
function inferHttpMethodFromFunctionName(name: string): HttpMethod {
  const lower = name.toLowerCase();
  if (/^(create|add|post|submit|send)/.test(lower)) return "POST";
  if (/^(update|put|save|replace|set)/.test(lower)) return "PUT";
  if (/^(patch|merge)/.test(lower)) return "PATCH";
  if (/^(delete|remove|destroy)/.test(lower)) return "DELETE";
  return "GET";
}

/**
 * Infer an HTTP path from a function name by stripping the verb prefix and
 * converting the remainder to kebab-case.
 */
function inferHttpPathFromFunctionName(name: string): string {
  const stripped = name.replace(/^(fetch|get|list|create|add|update|put|delete|remove|patch|merge|load|save|replace|post|submit|send|destroy)/i, "");
  const segment = toKebabCase(stripped || name);
  return segment ? `/${segment}` : "/";
}

/** Element types whose CBM labels can yield service candidates in services(). */
const SERVICE_SOURCE_TYPES = new Set(["applicationfunction", "applicationcomponent", "applicationservice"]);

/**
 * CBM Analyzer implementation
 */
export class CbmAnalyzer implements AnalyzerBackend {
  private mapper: MappingLoader;
  private testCodePatternWarned = false;
  private warnedHeuristics = new Set<string>();

  /**
   * Test code detection when the mapping has no test_code_exclusion rule: the same test-file
   * pattern as the mapping's rule and its tier0_test_file rule.
   */
  private static readonly DEFAULT_TEST_PATTERNS = [
    /((^|\/)(tests?|__tests__|__fixtures__|fixtures?)\/|(^|\/)test_[^/]*\.py$|(^|\/)conftest\.py$|_test\.(go|py)$|\.(test|spec)\.[cm]?[jt]sx?$|Tests?\.(java|kt)$)/,
  ];

  constructor(mapper: MappingLoader) {
    this.mapper = mapper;
  }

  /**
   * Get the analyzer name
   */
  get name(): string {
    return this.mapper.getAnalyzerName();
  }

  /**
   * Get the analyzer display name
   */
  get displayName(): string {
    const metadata = this.mapper.getAnalyzerMetadata();
    return metadata?.display_name || this.mapper.getAnalyzerName();
  }

  /**
   * Check if the MCP server is registered in .mcp.json
   *
   * Reads .mcp.json from the project root and checks if the analyzer's MCP server
   * is registered there. This is extracted into a separate method for easier testing.
   *
   * @param projectRoot Absolute path to the project root
   * @returns True if the MCP server is registered, false otherwise
   * @throws CLIError if .mcp.json exists but is unreadable or malformed
   */
  async checkMcpRegistration(projectRoot: string): Promise<boolean> {
    try {
      const mcpJsonPath = path.join(projectRoot, ".mcp.json");
      const mcpContent = await readFile(mcpJsonPath, "utf-8");
      const mcpConfig = JSON.parse(mcpContent);
      const metadata = this.mapper.getAnalyzerMetadata();
      const mcpServerName = metadata?.mcp_server_name ?? "codebase-memory-mcp";
      // Check if the analyzer's MCP server is registered in .mcp.json
      return (mcpConfig.mcpServers && mcpServerName in mcpConfig.mcpServers) || false;
    } catch (error) {
      // ENOENT (file not found) is expected - MCP registration is optional
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return false;
      }

      // Other errors indicate actionable problems
      if (err.code === "EACCES") {
        throw new CLIError(
          "Permission denied reading .mcp.json",
          ErrorCategory.SYSTEM,
          [
            `Cannot read ${path.join(projectRoot, ".mcp.json")}`,
            "Check file permissions",
          ]
        );
      }

      // SyntaxError during JSON.parse or other read/parse errors
      throw new CLIError(
        "Invalid .mcp.json format",
        ErrorCategory.VALIDATION,
        [
          `Check that ${path.join(projectRoot, ".mcp.json")} contains valid JSON`,
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ]
      );
    }
  }

  /**
   * Detect if the analyzer is installed and functional
   *
   * Checks for the presence of the analyzer binary, reads .mcp.json for registration info,
   * and validates the required tool contract by calling initialize and verifying required_tools.
   *
   * @param projectRoot Optional absolute path to project root (defaults to cwd)
   * @returns Detection result with binary path, version, and MCP registration status
   */
  async detect(projectRoot?: string): Promise<DetectionResult> {
    // Get binary names from the analyzer metadata
    const metadata = this.mapper.getAnalyzerMetadata();
    const binaryNames = (metadata?.binary_names as string[] | undefined) ?? [
      "codebase-memory-mcp",
    ];

    // Check if .mcp.json exists at project root for registration status
    // Use provided projectRoot or fallback to cwd
    let mcpRegistered = false;
    try {
      mcpRegistered = await this.checkMcpRegistration(projectRoot || process.cwd());
    } catch (error) {
      // CLIError from checkMcpRegistration indicates actionable problems (EACCES, syntax errors)
      // Surface these to the user via handleWarning(), but continue with detection
      if (error instanceof CLIError) {
        handleWarning(error.message, error.suggestions);
      } else {
        // Unexpected error - still continue with detection but warn
        const errorMsg = error instanceof Error ? error.message : String(error);
        handleWarning("Unexpected error checking MCP registration", [errorMsg]);
      }
      mcpRegistered = false;
    }

    // A bad DR_CBM_INIT_TIMEOUT_MS is a configuration error: raise it here, before any
    // spawn, instead of letting the per-binary catch report the analyzer as not installed.
    resolveInitTimeoutMs();

    // Why the last binary found could not be used, reported when none can be.
    let lastError: string | undefined;

    for (const binaryName of binaryNames) {
      // Check if binary is available using 'which'
      const whichResult = spawnSync("which", [binaryName], {
        stdio: "pipe",
        encoding: "utf-8",
      });

      if (whichResult.status !== 0) {
        continue;
      }

      const binaryPath = whichResult.stdout.trim();

      if (!binaryPath) {
        continue;
      }

      // Try to initialize the analyzer to validate the tool contract
      const client = new StdioClient();
      try {
        client.spawn(binaryPath);

        const version = await getCliVersion();
        const init = await client.initialize({
          name: "dr-cli",
          version,
        });
        // The server's version: from initialize's serverInfo, else from `--version`.
        const serverVersion =
          parseVersion((init as { serverInfo?: { version?: unknown } } | undefined)?.serverInfo?.version) ?? binaryVersion(binaryPath);

        // Verify required_tools from mapping are available on the server
        let contractOk = true;
        const requiredTools = (metadata?.supported_tool_contract as Record<string, unknown> | undefined)?.required_tools as string[] | undefined ?? [];

        if (requiredTools.length > 0) {
          try {
            // Verify all required tools are listed in supported tools
            // The MCP spec requires tools to be registered at initialization
            const response = await client.callTool("tools/list", {}) as { tools?: Array<{ name: string }> };

            const availableTools = new Set(
              (response.tools ?? []).map((tool) => tool.name)
            );

            for (const tool of requiredTools) {
              if (!availableTools.has(tool)) {
                contractOk = false;
                handleWarning(
                  `Required tool '${tool}' not available in ${binaryName}`,
                  ["Ensure the analyzer server exports all required tools"]
                );
              }
            }
          } catch (error) {
            // If tool listing fails, treat as verification failure
            contractOk = false;
            const errorMsg = error instanceof Error ? error.message : String(error);
            handleWarning(
              `Failed to verify required tools for ${binaryName}: ${errorMsg}`,
              ["Ensure all required tools are available in the analyzer server"]
            );
          }
        }

        // Successfully initialized and verified contract
        return {
          installed: true,
          binary_path: binaryPath,
          ...(serverVersion ? { version: serverVersion } : {}),
          mcp_registered: mcpRegistered,
          contract_ok: contractOk,
        };
      } catch (error) {
        // Initialize failed - log diagnostic info and continue to next binary
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        lastError = `${binaryName} was found at ${binaryPath} but failed to initialize: ${errorMessage}`;
        handleWarning(
          `Binary ${binaryName} failed initialization: ${errorMessage}`,
          ["Check that the binary is properly installed and functional"]
        );
        continue;
      } finally {
        // Always close the client to prevent orphan processes
        try {
          client.close();
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          handleWarning(
            `Failed to close MCP client for ${binaryName}: ${errorMessage}`,
            [
              "The MCP server process may still be running",
              "Try restarting your terminal or manually killing the process",
            ]
          );
        }
      }
    }

    // No binary found or functional
    return {
      installed: false,
      ...(lastError ? { error: lastError } : {}),
    };
  }

  /**
   * Get the current status of the analyzer for a project
   *
   * Checks if the project is indexed and whether the index is fresh relative to git HEAD.
   *
   * @param projectRoot Absolute path to the project root
   * @param options Optional codebase configuration
   * @returns Current status including detection, index state, and freshness
   */
  async status(projectRoot: string, options?: AnalyzerCodebaseOptions): Promise<AnalyzerStatus> {
    const detected = await this.detect(projectRoot);

    // Resolve the effective codebase root for git operations
    const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;

    // Read index metadata if it exists (keyed to model root)
    const analyzerName = this.mapper.getAnalyzerName();
    const indexMeta = await readIndexMeta(projectRoot, analyzerName);

    // Check if indexed
    const indexed = indexMeta !== null;

    if (!indexed) {
      return {
        detected,
        indexed: false,
        fresh: false,
      };
    }

    // Check freshness: compare stored git HEAD to current HEAD
    // Run git in the effective codebase root, not the model root
    let fresh = false;
    try {
      const currentHeadResult = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: effectiveCodebaseRoot,
        stdio: "pipe",
        encoding: "utf-8",
      });

      if (currentHeadResult.status === 0) {
        const currentHead = currentHeadResult.stdout.trim();
        fresh = currentHead === indexMeta.git_head && !analyzerChanged(indexMeta, detected);
      } else {
        // Git command failed - log diagnostic info but don't fail if codebaseRoot was provided
        const gitError = currentHeadResult.stderr?.trim() || "git returned non-zero status";
        if (options?.codebaseRoot) {
          handleWarning("Failed to check git freshness in codebase root", [
            `Codebase root: ${effectiveCodebaseRoot}`,
            `Git error: ${gitError}`,
            "Index freshness cannot be determined - treating as stale",
          ]);
        } else {
          handleWarning("Failed to check git freshness", [
            `Git error: ${gitError}`,
            "Index freshness cannot be determined - treating as stale",
          ]);
        }
        fresh = false;
      }
    } catch (error) {
      // Git spawn failed completely - log diagnostic info
      const errorMsg = error instanceof Error ? error.message : String(error);
      handleWarning("Failed to spawn git process", [
        `Error: ${errorMsg}`,
        "Index freshness cannot be determined - treating as stale",
      ]);
      fresh = false;
    }

    return {
      detected,
      indexed: true,
      index_meta: indexMeta,
      fresh,
      last_indexed: indexMeta.timestamp,
    };
  }

  /**
   * Index a project or update the index
   *
   * Creates a project entry in the CBM backend if it doesn't already exist,
   * indexes the repository, and writes freshness metadata.
   *
   * Skips indexing if the index is fresh (git HEAD matches) unless --force is set.
   *
   * @param projectRoot Absolute path to the project root
   * @param options Optional configuration including force flag and codebase root
   * @returns Index result with counts and metadata
   */
  async index(
    projectRoot: string,
    options?: { force?: boolean; timeoutMs?: number } & AnalyzerCodebaseOptions
  ): Promise<IndexResult> {
    // Resolve the effective codebase root for git and indexing operations
    const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;

    // Get current status (passing codebaseRoot option)
    const status = await this.status(projectRoot, { codebaseRoot: effectiveCodebaseRoot });

    // Skip if fresh and not forced
    if (status.indexed && status.fresh && !options?.force) {
      handleWarning("Index is fresh. Use --force to reindex.", [
        `Last indexed: ${status.last_indexed}`,
      ]);

      // Return the existing metadata
      const meta = status.index_meta;
      return {
        node_count: meta.node_count,
        edge_count: meta.edge_count,
        git_head: meta.git_head,
        timestamp: meta.timestamp,
      };
    }

    // Use detection result from status() instead of re-detecting
    const detection = status.detected;
    if (!detection.installed) {
      throw cbmNotInstalledError(detection);
    }

    const client = new StdioClient();

    try {
      client.spawn(detection.binary_path);

      const version = await getCliVersion();
      await client.initialize({
        name: "dr-cli",
        version,
      });

      const tools = new CbmTools(client);

      // Check if project is already indexed using list_projects
      // This validates the acceptance criterion and prevents duplicate project creation
      const projects = await tools.listProjects();
      const projectExists = projects.some((p) => p.root_path === effectiveCodebaseRoot);

      // Prevent duplicate CBM entries if project exists and index is fresh.
      // Per FR-3.3, --force is only needed to override a fresh index, not for stale re-indexing.
      // list_projects check prevents duplicate entries; freshness is already checked at line 313.
      if (projectExists && status.fresh && !options?.force) {
        handleWarning(
          "Project already indexed in CBM backend with fresh index.",
          ["Use --force to re-index the project"]
        );

        // Return actual index metadata instead of fabricated zeros
        // Guard against index_meta being undefined (can happen if metadata is corrupted or deleted)
        if (!status.index_meta) {
          throw new CLIError(
            "Project exists in CBM backend but local metadata is missing",
            ErrorCategory.VALIDATION,
            [
              "Use --force to re-index and regenerate metadata",
              "Or manually delete the project from CBM backend and re-index"
            ]
          );
        }

        const meta = status.index_meta;
        return {
          node_count: meta.node_count,
          edge_count: meta.edge_count,
          git_head: meta.git_head,
          timestamp: meta.timestamp,
        };
      }

      // Get current git HEAD from the effective codebase root
      // This must happen before index_repository to avoid inconsistent state
      const headResult = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: effectiveCodebaseRoot,
        stdio: "pipe",
        encoding: "utf-8",
      });

      if (headResult.status !== 0) {
        throw new CLIError(
          "Failed to get git HEAD",
          ErrorCategory.SYSTEM,
          [
            "Ensure the codebase root is a git repository",
            `Codebase root: ${effectiveCodebaseRoot}`,
            "Verify git is installed and functional",
            `Error: ${headResult.stderr?.trim() || "unknown error"}`,
          ]
        );
      }

      const gitHead = headResult.stdout.trim();

      // Read and log the active changeset for consistency tracking (v1: logging only, no branching)
      try {
        const stagingManager = new StagingAreaManager(projectRoot);
        const activeChangesetId = await stagingManager.getActiveId();
        if (activeChangesetId) {
          console.log(`Indexing with active changeset: ${activeChangesetId}`);
        }
      } catch (error) {
        // If reading active changeset fails, log a warning but continue indexing
        const errorMsg = error instanceof Error ? error.message : String(error);
        handleWarning(
          "Failed to read active changeset",
          [`Error: ${errorMsg}`, "Continuing with indexing"]
        );
      }

      // DR's own folders (the model, changesets, analyzer state) are not code; keep them out.
      try {
        const ignore = await ensureCbmIgnore(effectiveCodebaseRoot, projectRoot);
        if (ignore.added.length > 0) {
          console.log(`Added ${ignore.added.join(", ")} to ${ignore.path} so the index leaves DR's own files out`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        handleWarning("Could not update .cbmignore; DR's own files may be indexed", [`Error: ${errorMsg}`]);
      }

      // The index time is when the run started reading files: an edit made during the run is newer.
      const timestamp = new Date().toISOString();
      // Index the repository using the effective codebase root
      const indexResponse = await tools.indexRepository(
        effectiveCodebaseRoot,
        options?.timeoutMs ? { timeout: options.timeoutMs } : undefined
      );

      const nodeCount = typeof indexResponse.nodes === "number" ? indexResponse.nodes : 0;
      const edgeCount = typeof indexResponse.edges === "number" ? indexResponse.edges : 0;

      // Warn if counts were not numbers and defaulted to zero
      if (typeof indexResponse.nodes !== "number") {
        handleWarning(
          "Invalid node count from index_repository",
          [
            `Expected number, got ${typeof indexResponse.nodes}: ${String(indexResponse.nodes)}`,
            "Defaulting to 0 - index may be incomplete or corrupted",
          ]
        );
      }

      if (typeof indexResponse.edges !== "number") {
        handleWarning(
          "Invalid edge count from index_repository",
          [
            `Expected number, got ${typeof indexResponse.edges}: ${String(indexResponse.edges)}`,
            "Defaulting to 0 - index may be incomplete or corrupted",
          ]
        );
      }

      // Write index metadata
      const meta: IndexMeta = {
        git_head: gitHead,
        timestamp,
        node_count: nodeCount,
        edge_count: edgeCount,
        ...(detection.version ? { analyzer_version: detection.version } : {}),
      };

      const analyzerName = this.mapper.getAnalyzerName();
      await writeIndexMeta(meta, projectRoot, analyzerName);

      // Federation (opt-in): re-link to the configured repositories, since the index just replaced
      // this repository's CROSS_* edges. A project without cross-repo targets makes no extra call.
      // Only the targets whose model the manifest still declares are linked; the file keeps the rest,
      // and a pass with none left is recorded as skipped (cross-model.ts linkCrossRepoTargets).
      const link = await linkCrossRepoTargets(tools, projectRoot, analyzerName, effectiveCodebaseRoot, options?.timeoutMs ? { timeout: options.timeoutMs } : {});
      for (const w of link.warnings) handleWarning(w.message, w.suggestions);
      if (link.run?.ok) {
        console.log(`Linked to ${link.run.targets.filter((t) => t.project).map((t) => t.model).join(", ")}: ${link.run.counts?.total_cross_edges ?? 0} cross-repository edge(s)`);
      }

      return {
        node_count: nodeCount,
        edge_count: edgeCount,
        git_head: gitHead,
        timestamp,
      };
    } finally {
      client.close();
    }
  }

  /**
   * Fetch Route nodes with their HANDLES-edge handlers attached.
   *
   * CBM Route nodes carry only `{ method, source }` and often no file (every fastapi route,
   * for example); the handler function, its symbol, lines and file come from HANDLES edges.
   * If the handler query fails the routes are returned as they are.
   *
   * @private
   */
  private async fetchRoutes(tools: CbmTools, projectName: string, label: string): Promise<CbmGraphNode[]> {
    const routes = await tools.searchGraph({ label, project: projectName, fields: [...ROUTE_FIELDS] });
    try {
      const handlers = routeHandlersFromQuery(await tools.queryGraph(ROUTE_HANDLERS_QUERY, projectName));
      return attachRouteHandlers(routes, handlers);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      handleWarning("Could not read route handlers (HANDLES edges); routes lack handler details", [
        `Error: ${errorMsg}`,
      ]);
      return routes;
    }
  }

  /**
   * Resolve the internal project name used by codebase-memory-mcp for a given root path.
   *
   * list_projects returns { name, root_path } per entry. search_graph and other
   * query tools require the internal `name`, not the absolute `root_path`.
   * Falls back to the absolute path with a warning if the project is not found.
   */
  private async resolveProjectName(
    client: StdioClient | CbmTools,
    codebaseRoot: string
  ): Promise<string> {
    const tools = client instanceof CbmTools ? client : new CbmTools(client);
    const projects = await tools.listProjects();
    const match = projects.find((p) => p.root_path === codebaseRoot);
    if (!match) {
      handleWarning(
        "Project not found in CBM backend; using absolute path as project identifier",
        [
          `Codebase root: ${codebaseRoot}`,
          "Run `dr analyzer index` to ensure the project is indexed",
        ]
      );
      return codebaseRoot;
    }
    return match.name;
  }

  /**
   * Query for API endpoints/routes in the indexed project
   *
   * Searches the indexed graph for Route nodes, applies field mappings from
   * the analyzer's mapping, and filters based on test code exclusion rules.
   *
   * @param projectRoot Absolute path to the project root
   * @param options Optional codebase configuration
   * @returns Array of endpoint candidates with confidence and source info
   * @throws CLIError if the project is not indexed
   */
  async endpoints(projectRoot: string, options?: AnalyzerCodebaseOptions): Promise<EndpointCandidate[]> {
    // Resolve the effective codebase root
    const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;

    // Check that the project is indexed
    const status = await this.status(projectRoot, { codebaseRoot: effectiveCodebaseRoot });
    if (!status.indexed) {
      throw new CLIError(
        `Project not indexed: ${projectRoot}`,
        ErrorCategory.NOT_FOUND,
        [
          "Run `dr analyzer index` to index the project",
          "Ensure codebase-memory-mcp is installed and working",
        ]
      );
    }

    // Use detection result from status() instead of re-detecting
    const detection = status.detected;
    if (!detection.installed) {
      throw cbmNotInstalledError(detection);
    }

    // Get the Route mapping BEFORE initializing client to validate it exists
    const routeMapping = this.mapper.getNodeMapping("Route");
    if (!routeMapping) {
      throw new CLIError(
        "Route mapping not found in analyzer",
        ErrorCategory.VALIDATION,
        ["Run `npm run build:spec` to recompile the analyzer artifacts"]
      );
    }

    const client = new StdioClient();

    try {
      client.spawn(detection.binary_path);

      const version = await getCliVersion();
      await client.initialize({
        name: "dr-cli",
        version,
      });

      const tools = new CbmTools(client);

      // Resolve internal project name for search_graph (requires name, not absolute path)
      const projectName = await this.resolveProjectName(tools, effectiveCodebaseRoot);

      // Search for Route nodes using the CBM label from the mapping
      const allNodes = await this.fetchRoutes(tools, projectName, routeMapping.cbm_label);
      // Keep only nodes whose qualified_name follows the __route__METHOD__/path
      // convention. Nodes that don't match are graph artifacts (documentation
      // strings, base URLs, etc.) that were incidentally labelled Route by the
      // indexer — not actual HTTP routes.
      const nodes = allNodes
        .filter((n) => /^__route__[A-Z]+__\//.test(String(n.qualified_name ?? "")))
        .filter((n) => isLikelyHttpRoute(String(n.qualified_name ?? "")))
        // Served here: a file or handler, not on another host, not only declared in an OpenAPI file.
        .filter(isServedRoute);

      // Transform nodes to endpoint candidates
      const candidates: EndpointCandidate[] = [];

      for (const node of nodes) {
        const candidate = await this.transformNodeToEndpoint(
          node,
          routeMapping,
          effectiveCodebaseRoot
        );

        // Skip unattributable candidates — empty source_file means the graph
        // found a path string in non-route code (test assertions, fixture data)
        if (!candidate.source_file) {
          continue;
        }
        // Apply test code exclusion filter
        if (!this.isTestCode(candidate)) {
          candidates.push(candidate);
        }
      }

      // ISSUE-003: Client-side API consumer detection.
      // When no server-side Route nodes are found (e.g. React/frontend apps using fetch/axios),
      // fall back to querying Function nodes in API-client files whose names follow HTTP verb
      // conventions. These are low-confidence candidates — the user confirms and adds them.
      if (candidates.length === 0) {
        try {
          const clientQuery = `
            MATCH (n:Function)
            WHERE (n.file_path CONTAINS 'client' OR n.file_path CONTAINS 'Client'
                   OR n.file_path CONTAINS 'Api' OR n.file_path CONTAINS 'Service'
                   OR n.file_path CONTAINS 'service' OR n.file_path CONTAINS 'http'
                   OR n.file_path CONTAINS 'Http')
              AND (n.name STARTS WITH 'fetch' OR n.name STARTS WITH 'get'
                   OR n.name STARTS WITH 'post' OR n.name STARTS WITH 'put'
                   OR n.name STARTS WITH 'delete' OR n.name STARTS WITH 'patch'
                   OR n.name STARTS WITH 'create' OR n.name STARTS WITH 'update'
                   OR n.name STARTS WITH 'list')
            RETURN ${nodeColumns("n")}
          `;

          const clientNodes = nodesFromQuery(await tools.queryGraph(clientQuery, projectName));
          for (const node of clientNodes) {
            if (!node.file_path) continue;
            const candidate = this.shapeClientSideEndpoint(node, effectiveCodebaseRoot);
            if (candidate && !this.isTestCode(candidate)) {
              candidates.push(candidate);
            }
          }
        } catch (error) {
          // query_graph not available — skip the client-side fallback
          const errorMsg = error instanceof Error ? error.message : String(error);
          handleWarning("Client-side endpoint fallback skipped: query_graph failed", [`Error: ${errorMsg}`]);
        }
      }

      this.warnOnDuplicateIdFragments(
        candidates,
        (c) => c.suggested_id_fragment,
        (c) => c.source_symbol || c.source_file || "(unknown)"
      );
      return candidates;
    } finally {
      client.close();
    }
  }

  /**
   * Execute a raw Cypher query against the analyzer's graph
   *
   * Passes the raw Cypher string directly to the query_graph MCP tool.
   * The query_graph tool is optional (not in required_tools contract).
   * If the tool call fails, surfaces a clear error message.
   *
   * @param projectRoot Absolute path to the project root
   * @param rawQuery Raw Cypher query string
   * @param options Optional codebase configuration
   * @returns Raw result from query_graph tool
   * @throws CLIError if project not indexed or query_graph tool unavailable
   */
  async query(projectRoot: string, rawQuery: string, options?: AnalyzerCodebaseOptions): Promise<unknown> {
    // Resolve the effective codebase root
    const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;

    // Check that the project is indexed (same pre-flight checks as endpoints)
    const status = await this.status(projectRoot, { codebaseRoot: effectiveCodebaseRoot });
    if (!status.indexed) {
      throw new CLIError(
        `Project not indexed: ${projectRoot}`,
        ErrorCategory.NOT_FOUND,
        [
          "Run `dr analyzer index` to index the project",
          "Ensure codebase-memory-mcp is installed and working",
        ]
      );
    }

    // Use detection result from status() instead of re-detecting
    const detection = status.detected;
    if (!detection.installed) {
      throw cbmNotInstalledError(detection);
    }

    const client = new StdioClient();

    try {
      client.spawn(detection.binary_path);

      const version = await getCliVersion();
      await client.initialize({
        name: "dr-cli",
        version,
      });

      const tools = new CbmTools(client);

      // Resolve internal project name — query_graph requires the CBM name, not the absolute path
      const projectName = await this.resolveProjectName(tools, effectiveCodebaseRoot);

      // Call query_graph tool; all result pages are merged into one { columns, rows }
      try {
        const result = await tools.queryGraph(rawQuery, projectName);
        return { ...result, total: result.rows.length };
      } catch (error) {
        // CBM rejected the query (syntax error, unsupported clause): surface its message
        if (error instanceof CbmToolError) {
          throw new CLIError(`Query failed: ${error.detail}`, ErrorCategory.USER, error.suggestions);
        }

        // Check if the error is due to the tool not being available
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes("query_graph") || errorMessage.includes("Unknown method")) {
          throw new CLIError(
            "query_graph not supported by this analyzer",
            ErrorCategory.USER,
            [
              "The query_graph tool is optional in the CBM analyzer contract",
              "Ensure your codebase-memory-mcp version supports raw graph queries",
              "Contact the analyzer maintainers if you need this feature",
            ]
          );
        }

        // Re-throw other errors
        throw error;
      }
    } finally {
      client.close();
    }
  }

  private warnOnDuplicateIdFragments<T>(
    items: T[],
    getKey: (item: T) => string | undefined,
    getLabel: (item: T) => string
  ): void {
    const seen = new Map<string, string>();
    for (const item of items) {
      const key = getKey(item);
      if (!key) continue;
      const label = getLabel(item);
      if (seen.has(key)) {
        handleWarning(
          `Duplicate suggested ID "${key}" — multiple symbols map to the same element ID`,
          [
            `First: ${seen.get(key)!}`,
            `Conflict: ${label}`,
            `Rename one or use "dr add" with a custom name`,
          ]
        );
      } else {
        seen.set(key, label);
      }
    }
  }

  /**
   * Transform a CBM graph node to an endpoint candidate
   *
   * Maps CBM Route node properties to DR EndpointCandidate contract:
   * - suggested_layer: always "api" for endpoints
   * - suggested_element_type: always "operation" for routes
   * - suggested_name: from node properties or id (kebab-case)
   * - http_method: from properties.method or defaults to "GET"
   * - http_path: from properties.path or defaults to "/"
   * - handler_qualified_name: from properties.handler_name or empty string
   * - source_symbol: from properties.symbol or empty string
   * - source_start_line: from properties.start_line or 0
   * - source_end_line: from properties.end_line or 0
   *
   * Downgrades confidence if required fields are missing.
   *
   * @private
   */
  private async transformNodeToEndpoint(
    node: CbmGraphNode,
    mapping: AnalyzerNodeMapping,
    codebaseRoot: string
  ): Promise<EndpointCandidate> {
    const properties = node.properties ?? {};
    // Node identifier for display — actual codebase-memory-mcp nodes use 'name', not 'id'
    const nodeId = String(node.name ?? node.id ?? "(unknown)");

    // Extract base fields
    let confidence = mapping.confidence as "high" | "medium" | "low";

    // Suggested name in kebab-case: properties.name → node.name → node.id
    const suggestedName = toKebabCase(String(properties.name ?? node.name ?? node.id ?? ""));

    // Suggested ID fragment (same as name for endpoints)
    const suggestedIdFragment = suggestedName;

    // Required fields for dr add api operation
    // Extract HTTP method: properties first, then parse qualified_name pattern __route__METHOD__/path
    let rawMethod: string;
    if (typeof properties.method === "string") {
      rawMethod = properties.method.toUpperCase();
    } else {
      const qn = String(node.qualified_name ?? "");
      const methodMatch = qn.match(/^__route__([A-Z]+)__/);
      rawMethod = methodMatch?.[1] ?? "GET";
      if (rawMethod === "ANY") rawMethod = "GET";
    }

    // Validate against valid HTTP methods using the constant
    const validMethods = new Set(VALID_HTTP_METHODS);
    const isValidMethod = validMethods.has(rawMethod as HttpMethod);
    const httpMethod: HttpMethod = isValidMethod
      ? (rawMethod as HttpMethod)
      : "GET";

    if (!isValidMethod) {
      handleWarning(
        `Node ${nodeId}: Invalid HTTP method`,
        [
          `Method '${rawMethod}' is not a valid HTTP method`,
          `Valid methods: ${Array.from(validMethods).join(", ")}`,
          "Defaulting to GET - endpoint documentation may be inaccurate",
        ]
      );
    }

    // Extract HTTP path: properties first, then node.name (which IS the URL path for flat nodes)
    let httpPath: string;
    if (typeof properties.path === "string") {
      httpPath = properties.path;
    } else if (typeof node.name === "string" && node.name.startsWith("/")) {
      httpPath = node.name;
    } else {
      handleWarning(
        `Node ${nodeId}: Missing or invalid HTTP path`,
        [
          `Expected string, got ${typeof properties.path}`,
          "Defaulting to / - endpoint may be incomplete",
        ]
      );
      httpPath = "/";
    }

    // Handler information — try multiple property names because CBM indexers vary.
    // Do NOT fall back to properties.qualified_name — that is the route node's own QN.
    const handlerQualifiedName = String(
      properties.handler_name ??
      properties.handler_qualified_name ??
      ""
    );
    const sourceSymbol = String(properties.symbol ?? properties.source_symbol ?? "");
    const sourceStartLine = Number(properties.start_line ?? 0);
    const sourceEndLine = Number(properties.end_line ?? 0);

    // Downgrade confidence if handler information is missing
    if (!handlerQualifiedName || !sourceSymbol) {
      confidence = capConfidence(confidence);
    }

    // Extract source file — check both node-level and properties-level fields
    let sourceFile = String(node.file_path ?? properties.file_path ?? properties.source_file ?? "");
    if (sourceFile && codebaseRoot) {
      try {
        sourceFile = relativeToRoot(codebaseRoot, sourceFile);
      } catch (error) {
        // Log warning if relative path fails but continue with absolute path
        const errorMsg = error instanceof Error ? error.message : String(error);
        handleWarning(
          `Failed to compute relative path for ${nodeId}`,
          [
            `Error: ${errorMsg}`,
            "Using absolute file path instead of relative",
          ]
        );
        // sourceFile keeps its original absolute value
      }
    }

    return {
      source_file: sourceFile,
      confidence,
      suggested_layer: "api",
      suggested_element_type: "operation",
      suggested_name: suggestedName,
      suggested_id_fragment: suggestedIdFragment,
      http_method: httpMethod,
      http_path: httpPath,
      handler_qualified_name: handlerQualifiedName,
      source_symbol: sourceSymbol,
      source_start_line: sourceStartLine,
      source_end_line: sourceEndLine,
      source_reference: {
        provenance: "extracted",
        locations: sourceFile
          ? [
              {
                file: sourceFile,
                symbol: sourceSymbol || undefined,
              },
            ]
          : undefined,
      },
    };
  }


  /**
   * Check if a candidate (endpoint, service, or datastore) is in test code
   *
   * Applies the test_code_exclusion filtering rule from the analyzer mapping.
   * If the configured regex pattern is invalid, warns the user once and falls back to defaults.
   * Uses a one-shot flag to ensure the warning is only emitted once even if called in a loop.
   *
   * Accepts any object with a source_file property (structural typing), allowing it to work
   * with EndpointCandidate, ServiceCandidate, DatastoreCandidate, and temporary objects.
   *
   * @private
   */

  /**
   * Build a low-confidence EndpointCandidate from a client-side API function node.
   * Used as a fallback when no server-side Route nodes are found (ISSUE-003).
   */
  private shapeClientSideEndpoint(node: CbmGraphNode, codebaseRoot: string): EndpointCandidate | null {
    const name = String(node.name ?? node.id ?? "");
    if (!name) return null;

    let sourceFile = String(node.file_path ?? "");
    if (sourceFile && codebaseRoot) {
      try {
        sourceFile = relativeToRoot(codebaseRoot, sourceFile);
      } catch {
        // keep absolute path on failure
      }
    }
    if (!sourceFile) return null;

    const httpMethod = inferHttpMethodFromFunctionName(name);
    const httpPath = inferHttpPathFromFunctionName(name);
    const suggestedName = toKebabCase(name);

    return {
      source_file: sourceFile,
      confidence: "low",
      suggested_layer: "api",
      suggested_element_type: "operation",
      suggested_name: suggestedName,
      suggested_id_fragment: suggestedName,
      http_method: httpMethod,
      http_path: httpPath,
      handler_qualified_name: name,
      source_symbol: name,
      source_start_line: Number(node.properties?.start_line ?? 0),
      source_end_line: Number(node.properties?.end_line ?? 0),
      source_reference: {
        provenance: "inferred",
        locations: [{ file: sourceFile, symbol: name }],
      },
    };
  }

  private isTestCode(candidate: { source_file: string }): boolean {
    // Get filtering rules from the analyzer mapping
    const filteringRules = this.mapper.getFilteringRules();

    // Find the test_code_exclusion rule
    const testCodeRule = filteringRules.find(
      (rule) => rule.name === "test_code_exclusion" && rule.enabled
    );

    // If no test_code_exclusion rule found, apply default patterns as fallback
    if (!testCodeRule || !testCodeRule.pattern) {
      return CbmAnalyzer.DEFAULT_TEST_PATTERNS.some((pattern) =>
        pattern.test(candidate.source_file)
      );
    }

    // Apply the pattern from the filtering rule
    try {
      const testCodePattern = new RegExp(testCodeRule.pattern);
      return testCodePattern.test(candidate.source_file);
    } catch (error) {
      // If regex is invalid, warn user once (not on every invocation in the loop)
      // and fall back to default patterns
      if (!this.testCodePatternWarned) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        handleWarning(
          "Invalid test_code_exclusion regex pattern in analyzer mapping",
          [
            `Pattern: ${testCodeRule.pattern}`,
            `Error: ${errorMsg}`,
            "Falling back to default test code patterns",
          ]
        );
        this.testCodePatternWarned = true;
      }
      return CbmAnalyzer.DEFAULT_TEST_PATTERNS.some((pattern) =>
        pattern.test(candidate.source_file)
      );
    }
  }

  /**
   * Query for services/components in the indexed project
   *
   * Searches for application-layer nodes using the mapping-loader-driven pattern.
   * For each node, evaluates all promotion_heuristics and records which fire in
   * qualifying_heuristics. Drops candidates with zero qualifying heuristics (unless
   * is_entry_point heuristic fires, adding it to qualifying_heuristics). Caps confidence
   * at "medium" and excludes test files.
   *
   * @param projectRoot Absolute path to the project root
   * @param options Optional codebase configuration
   * @returns Array of service candidates with qualifying heuristics populated
   * @throws CLIError if the project is not indexed
   */
  async services(projectRoot: string, options?: AnalyzerCodebaseOptions): Promise<ServiceCandidate[]> {
    // Resolve the effective codebase root
    const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;

    // Check that the project is indexed
    const status = await this.status(projectRoot, { codebaseRoot: effectiveCodebaseRoot });
    if (!status.indexed) {
      throw new CLIError(
        `Project not indexed: ${projectRoot}`,
        ErrorCategory.NOT_FOUND,
        [
          "Run `dr analyzer index` to index the project",
          "Ensure codebase-memory-mcp is installed and working",
        ]
      );
    }

    // Use detection result from status() instead of re-detecting
    const detection = status.detected;
    if (!detection.installed) {
      throw cbmNotInstalledError(detection);
    }

    const client = new StdioClient();

    try {
      client.spawn(detection.binary_path);

      const version = await getCliVersion();
      await client.initialize({
        name: "dr-cli",
        version,
      });

      // Get application-layer node labels from the mapping (pattern from endpoints())
      const nodeLabels = this.mapper.getNodeLabels();
      const applicationLabels: string[] = [];

      // Filter to only application-layer labels by checking their mapping
      for (const label of nodeLabels) {
        const mapping = this.mapper.getNodeMapping(label);
        // Only behavioural and structural types are service sources; data-object labels
        // (Interface, Type, Enum, ...) never become service candidates.
        if (mapping && mapping.dr_layer === "application" && SERVICE_SOURCE_TYPES.has(mapping.dr_element_type)) {
          applicationLabels.push(label);
        }
      }

      // If no application-layer labels found, warn and return empty list
      if (applicationLabels.length === 0) {
        handleWarning(
          "No application-layer labels found in analyzer mapping",
          [
            "Check that the analyzer is properly configured with application-layer node mappings",
            "Services detection requires at least one mapped application-layer node type",
            "Returning empty services list"
          ]
        );
        return [];
      }

      const candidates: ServiceCandidate[] = [];

      const tools = new CbmTools(client);

      // Resolve internal project name once before the label search loop
      const projectName = await this.resolveProjectName(tools, effectiveCodebaseRoot);

      // Process high-fidelity node types first so the source_file dedup (below) retains
      // class/module level entries over method-level entries from the same file.
      const labelPriority: Record<string, number> = { Class: 0, Module: 1 };
      applicationLabels.sort((a, b) => (labelPriority[a] ?? 99) - (labelPriority[b] ?? 99));

      // Search for each application-layer label
      for (const label of applicationLabels) {
        const nodes = await tools.searchGraph({ label, project: projectName });

        // Get the node mapping for this label
        const nodeMapping = this.mapper.getNodeMapping(label);
        if (!nodeMapping) {
          continue;
        }

        // Get promotion heuristics from the mapping
        const promotionHeuristicNames = nodeMapping.promotion_heuristics || [];

        // Transform nodes to service candidates
        for (const node of nodes) {
          const candidate = await this.transformNodeToService(
            node,
            nodeMapping,
            effectiveCodebaseRoot,
            promotionHeuristicNames
          );

          // Filter out candidates with zero qualifying heuristics (unless is_entry_point is true)
          // and apply test code exclusion filter
          if (candidate.qualifying_heuristics.length > 0 && !this.isTestCode(candidate)) {
            candidates.push(candidate);
          }
        }
      }

      // Deduplicate by source_file — the model documents at class/file granularity;
      // method-level entries from the same file are noise.
      const seenFiles = new Set<string>();
      const deduped = candidates.filter((c) => {
        if (!c.source_file) return true;
        if (seenFiles.has(c.source_file)) return false;
        seenFiles.add(c.source_file);
        return true;
      });
      this.warnOnDuplicateIdFragments(
        deduped,
        (c) => c.suggested_id_fragment,
        (c) => c.source_symbol || c.source_file || "(unknown)"
      );
      return deduped;
    } finally {
      client.close();
    }
  }

  /**
   * Transform a CBM graph node to a service candidate
   *
   * Evaluates all promotion heuristics against the node's properties and records
   * which heuristics fire. Drops candidates where no heuristics fire (unless the
   * is_entry_point heuristic fires, which adds it to qualifying_heuristics).
   * Caps confidence at "medium".
   *
   * @private
   */
  private async transformNodeToService(
    node: CbmGraphNode,
    mapping: AnalyzerNodeMapping,
    codebaseRoot: string,
    promotionHeuristicNames: string[]
  ): Promise<ServiceCandidate> {
    const properties = node.properties ?? {};

    // Suggested name in kebab-case: properties.name → node.name → node.id
    const suggestedName = toKebabCase(String(properties.name ?? node.name ?? node.id ?? ""));

    // Suggested ID fragment (same as name for services)
    const suggestedIdFragment = suggestedName;

    // Extract source file (relative to codebase root)
    let sourceFile = node.file_path ?? "";
    if (sourceFile && codebaseRoot) {
      try {
        sourceFile = relativeToRoot(codebaseRoot, sourceFile);
      } catch (error) {
        // Log warning if relative path fails but continue with absolute path
        const errorMsg = error instanceof Error ? error.message : String(error);
        handleWarning(
          `Failed to compute relative path for ${String(node.name ?? node.id ?? "(unknown)")}`,
          [
            `Error: ${errorMsg}`,
            "Using absolute file path instead of relative",
          ]
        );
        // sourceFile keeps its original absolute value
      }
    }

    // Extract qualified name: properties first, then node.qualified_name, then node.id
    const qualifiedName = String(properties.qualified_name ?? node.qualified_name ?? node.name ?? node.id ?? "");

    // Extract fan-in and fan-out metrics
    const fanIn = typeof properties.fan_in === "number" ? properties.fan_in : 0;
    const fanOut = typeof properties.fan_out === "number" ? properties.fan_out : 0;

    // Evaluate all promotion heuristics and collect which ones fire
    const qualifyingHeuristics: string[] = [];
    let isEntryPoint = false;

    for (const heuristicName of promotionHeuristicNames) {
      const heuristic = this.mapper.getHeuristic(heuristicName);
      if (!heuristic) {
        // Warn about missing heuristic only once per heuristic name
        if (!this.warnedHeuristics.has(heuristicName)) {
          this.warnedHeuristics.add(heuristicName);
          handleWarning(
            `Promotion heuristic "${heuristicName}" not found in analyzer mapping`,
            [
              "Check the mapping configuration for typos",
              `Available heuristics: ${getKnownHeuristicNames().join(", ")}`,
              "This heuristic will be skipped for service promotion",
            ]
          );
        }
        continue;
      }

      // Evaluate the heuristic against the node
      const fires = this.evaluateHeuristic(heuristic, node, sourceFile);
      if (fires) {
        qualifyingHeuristics.push(heuristicName);
        // Track if is_entry_point heuristic fired
        if (heuristicName === "is_entry_point") {
          isEntryPoint = true;
        }
      }
    }

    // Drop candidates where zero heuristics fire AND is_entry_point is not true
    const shouldKeep = qualifyingHeuristics.length > 0 || isEntryPoint;
    if (!shouldKeep) {
      // Return a minimal candidate with empty qualifying_heuristics
      // The services() method will filter this out based on qualifying_heuristics.length > 0 check
      const elementType: "applicationservice" | "applicationcomponent" =
        mapping.dr_element_type_promoted === "applicationcomponent"
          ? "applicationcomponent"
          : "applicationservice";
      return {
        suggested_layer: "application",
        suggested_element_type: elementType,
        suggested_id_fragment: suggestedIdFragment,
        suggested_name: suggestedName,
        source_file: sourceFile,
        source_symbol: String(properties.name ?? node.name ?? node.id ?? ""),
        qualified_name: qualifiedName,
        qualifying_heuristics: [],
        confidence: "low",
        fan_in: fanIn,
        fan_out: fanOut,
      };
    }

    // Cap confidence at "medium" (from mapping or default to medium)
    const confidence = capConfidence(
      mapping.confidence as "high" | "medium" | "low"
    );

    // Ensure element type is one of the valid values
    const elementType: "applicationservice" | "applicationcomponent" =
      mapping.dr_element_type_promoted === "applicationcomponent"
        ? "applicationcomponent"
        : "applicationservice";

    return {
      suggested_layer: "application",
      suggested_element_type: elementType,
      suggested_id_fragment: suggestedIdFragment,
      suggested_name: suggestedName,
      source_file: sourceFile,
      source_symbol: String(properties.name ?? node.name ?? node.id ?? ""),
      qualified_name: qualifiedName,
      qualifying_heuristics: qualifyingHeuristics,
      confidence,
      fan_in: fanIn,
      fan_out: fanOut,
    };
  }

  /**
   * Evaluate a single heuristic against a node
   *
   * Checks if the heuristic's conditions are met based on the node's properties
   * and file path. Unknown heuristics are logged with a warning rather than
   * silently ignored, to support dynamic heuristics from cbm.json.
   *
   * Warnings for unknown heuristics are deduplicated - each heuristic name is warned
   * about only once, even if evaluated against many nodes.
   *
   * @private
   */
  private evaluateHeuristic(
    heuristic: AnalyzerHeuristic,
    node: CbmGraphNode,
    sourceFile: string
  ): boolean {
    const properties = node.properties ?? {};

    // Use the heuristic utility function
    const result = evaluateHeuristic(heuristic, properties, sourceFile);

    // For unknown heuristics, log a warning (deduplicated by heuristic name)
    if (heuristic.name && !getKnownHeuristicNames().includes(heuristic.name)) {
      // Only warn once per heuristic name
      if (!this.warnedHeuristics.has(heuristic.name)) {
        handleWarning(
          `Unknown heuristic type: ${heuristic.name}`,
          [
            "The heuristic is defined in cbm.json but not implemented in heuristic-utils.ts",
            "This heuristic will be treated as not met (returning false)",
            "Add support for this heuristic to evaluateHeuristic() if it should fire",
          ]
        );
        this.warnedHeuristics.add(heuristic.name);
      }
    }

    return result;
  }

  /**
   * Match a file path against a glob-like pattern
   *
   * @param filePath The file path to match
   * @param pattern The glob pattern
   * @returns True if the pattern matches, false otherwise
   * @private
   */
  private matchPattern(filePath: string, pattern: string): boolean {
    return matchPattern(filePath, pattern);
  }

  /**
   * Query for datastores/databases inferred from code analysis
   *
   * Applies datastore_detection heuristic rules to aggregate signals by file/module.
   * Matches import target names against import_patterns and function/symbol names against
   * naming_indicators from the heuristic parameters. All candidates have confidence "low".
   *
   * @param projectRoot Absolute path to the project root
   * @param options Optional codebase configuration
   * @returns Array of datastore candidates aggregated by inferred datastore
   * @throws CLIError if the project is not indexed
   */
  async datastores(projectRoot: string, options?: AnalyzerCodebaseOptions): Promise<DatastoreCandidate[]> {
    // Resolve the effective codebase root
    const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;

    // Check that the project is indexed
    const status = await this.status(projectRoot, { codebaseRoot: effectiveCodebaseRoot });
    if (!status.indexed) {
      throw new CLIError(
        `Project not indexed: ${projectRoot}`,
        ErrorCategory.NOT_FOUND,
        [
          "Run `dr analyzer index` to index the project",
          "Ensure codebase-memory-mcp is installed and working",
        ]
      );
    }

    // Use detection result from status() instead of re-detecting
    const detection = status.detected;
    if (!detection.installed) {
      throw cbmNotInstalledError(detection);
    }

    const client = new StdioClient();

    try {
      client.spawn(detection.binary_path);

      const version = await getCliVersion();
      await client.initialize({
        name: "dr-cli",
        version,
      });

      // Load the datastore_detection heuristic
      const datastoreHeuristic = this.mapper.getHeuristic("datastore_detection");
      if (!datastoreHeuristic) {
        throw new CLIError(
          "datastore_detection heuristic not found in analyzer",
          ErrorCategory.VALIDATION,
          [
            "The analyzer configuration is missing the datastore_detection heuristic",
            "Run `npm run build:spec` to recompile the analyzer artifacts"
          ]
        );
      }

      const importPatterns = datastoreHeuristic.parameters?.patterns ?? [];
      const namingIndicators = datastoreHeuristic.parameters?.naming_indicators ?? [];

      // Map to track signals by datastore name
      const datastoreSignals = new Map<
        string,
        Array<{
          sourceFile: string;
          importPattern?: string;
          functionPatterns: string[];
        }>
      >();
      // Tracks the first import target that produced each normalized datastore name,
      // so we can warn when distinct imports collapse to the same element ID.
      const datastoreFirstSource = new Map<string, string>();

      const tools = new CbmTools(client);

      // Resolve internal project name once (search_graph and query_graph require name, not path)
      const projectName = await this.resolveProjectName(tools, effectiveCodebaseRoot);

      // Try to use query_graph to traverse IMPORTS edges (1 call instead of many)
      // This implements the spec algorithm requirement for IMPORTS edge traversal
      let allNodes: CbmGraphNode[] = [];
      try {
        // Query for all IMPORTS edges and their connected nodes
        const importsQuery = `
          MATCH (n1)-[r:IMPORTS]->(n2)
          RETURN DISTINCT ${nodeColumns("n1")}
          UNION
          MATCH (n1)-[r:IMPORTS]->(n2)
          RETURN DISTINCT ${nodeColumns("n2")}
        `;

        allNodes = nodesFromQuery(await tools.queryGraph(importsQuery, projectName));
      } catch (error) {
        // Fallback to search_graph if query_graph is unavailable
        // Warn the user that we're using degraded search semantics
        const errorMsg = error instanceof Error ? error.message : String(error);
        handleWarning(
          "query_graph tool failed; falling back to search_graph for datastore detection",
          [
            `Error: ${errorMsg}`,
            "Using search_graph will return ALL nodes instead of only IMPORTS-connected nodes",
            "Datastore detection results may include false positives or be less accurate",
            "Ensure query_graph is supported by your analyzer version for best results"
          ]
        );

        // This provides backward compatibility while still attempting IMPORTS traversal
        const nodeLabels = this.mapper.getNodeLabels();
        for (const label of nodeLabels) {
          allNodes.push(...(await tools.searchGraph({ label, project: projectName })));
        }
      }

      // Process all nodes to find datastore signals
      for (const node of allNodes) {
        const filePath = node.file_path ?? "";

        // For import target detection, check the node's import target name (from label/properties)
        // not the file path. IMPORTS edges connect to target nodes like "mongodb", "pg"
        const importTargetName = String(node.label ?? node.properties?.name ?? node.id ?? "").toLowerCase();

        // Check if import target matches datastore-related patterns
        let matchedImportPattern: string | undefined;
        for (const pattern of importPatterns) {
          if (this.matchPattern(importTargetName, pattern)) {
            matchedImportPattern = pattern;
            break;
          }
        }

        // Check if node name contains datastore naming indicators
        const nodeName = String(node.properties?.name ?? "").toLowerCase();
        const matchedIndicators = namingIndicators.filter((indicator) =>
          nodeName.includes(indicator.toLowerCase())
        );

        // Skip if no import pattern matched AND no naming indicators matched
        if (!matchedImportPattern && matchedIndicators.length === 0) {
          continue;
        }

        // Extract datastore name from import target name or node properties
        let datastoreName = this.inferDatastoreName(
          filePath,
          node,
          matchedImportPattern,
          importTargetName
        );
        if (!datastoreName) {
          continue;
        }

        // Normalize to lowercase and replace special chars
        datastoreName = toKebabCase(datastoreName);

        // Get or create entry for this datastore; warn when distinct import targets
        // normalize to the same name (merging is intentional, but the collision is surfaced)
        if (!datastoreSignals.has(datastoreName)) {
          datastoreSignals.set(datastoreName, []);
          datastoreFirstSource.set(datastoreName, importTargetName);
        } else if (datastoreFirstSource.get(datastoreName) !== importTargetName) {
          handleWarning(
            `Multiple imports normalize to datastore name "${datastoreName}"`,
            [
              `First: ${datastoreFirstSource.get(datastoreName)!}`,
              `Conflict: ${importTargetName}`,
              `Use "dr add" with a custom name to distinguish them`,
            ]
          );
        }

        const signals = datastoreSignals.get(datastoreName)!;

        // Convert file path to relative
        let relativeFile = filePath;
        if (filePath && effectiveCodebaseRoot) {
          try {
            relativeFile = relativeToRoot(effectiveCodebaseRoot, filePath);
          } catch (error) {
            // Log warning if relative path fails but continue with absolute path
            const errorMsg = error instanceof Error ? error.message : String(error);
            handleWarning(
              `Failed to compute relative path in datastore detection`,
              [
                `File: ${filePath}`,
                `Error: ${errorMsg}`,
                "Using absolute file path instead of relative",
              ]
            );
            // relativeFile keeps its original absolute value
          }
        }

        // Add signal for this source file
        signals.push({
          sourceFile: relativeFile,
          importPattern: matchedImportPattern,
          functionPatterns: matchedIndicators,
        });
      }

      // Transform collected signals into DatastoreCandidate objects
      const candidates: DatastoreCandidate[] = [];

      // Convert entries to array to avoid TypeScript MapIterator issues
      const entriesArray = Array.from(datastoreSignals.entries());
      for (const [datastoreName, signals] of entriesArray) {
        // Group by source file and aggregate evidence
        const inferredFromMap = new Map<
          string,
          {
            importPatterns: Set<string>;
            functionPatterns: Set<string>;
          }
        >();

        for (const signal of signals) {
          if (!inferredFromMap.has(signal.sourceFile)) {
            inferredFromMap.set(signal.sourceFile, {
              importPatterns: new Set(),
              functionPatterns: new Set(),
            });
          }

          const entry = inferredFromMap.get(signal.sourceFile)!;
          if (signal.importPattern) {
            entry.importPatterns.add(signal.importPattern);
          }
          signal.functionPatterns.forEach((fp) => entry.functionPatterns.add(fp));
        }

        // Create candidate with aggregated evidence
        let inferredFromMapEntries = Array.from(inferredFromMap.entries());

        // Apply test code exclusion filter: remove test files from inferred_from
        inferredFromMapEntries = inferredFromMapEntries.filter(([sourceFile]) => {
          // Create a temporary object with source_file to reuse isTestCode()
          const tempCandidate = {
            source_file: sourceFile,
          };
          return !this.isTestCode(tempCandidate);
        });

        // Skip candidates where all sources are test code
        if (inferredFromMapEntries.length === 0) {
          continue;
        }

        const inferredFrom = inferredFromMapEntries.map(
          ([sourceFile, evidence]) => ({
            source_file: sourceFile,
            import_pattern: Array.from(evidence.importPatterns).join(", ") || datastoreName,
            function_patterns: Array.from(evidence.functionPatterns),
          })
        );

        candidates.push({
          suggested_layer: "data-store",
          suggested_name: datastoreName,
          inferred_from: inferredFrom,
          confidence: "low",
          notes: `Inferred from ${inferredFrom.length} source file(s) based on datastore detection heuristics`,
        });
      }

      // ISSUE-003: Browser storage detection.
      // localStorage and sessionStorage are global browser APIs — they don't appear in the
      // IMPORTS graph. Query for Function nodes in files that are commonly associated with
      // browser-side state persistence (store files, auth files, preference files).
      const browserStorageTypes = ["local-storage", "session-storage"] as const;
      const browserStorageSignals = new Map<string, Set<string>>();

      try {
        const storageQuery = `
          MATCH (n:Function)
          WHERE n.file_path CONTAINS 'Store' OR n.file_path CONTAINS 'store'
             OR n.file_path CONTAINS 'storage' OR n.file_path CONTAINS 'Storage'
             OR n.file_path CONTAINS 'auth' OR n.file_path CONTAINS 'Auth'
             OR n.file_path CONTAINS 'preference' OR n.file_path CONTAINS 'Preference'
             OR n.file_path CONTAINS 'layout' OR n.file_path CONTAINS 'Layout'
             OR n.file_path CONTAINS 'settings' OR n.file_path CONTAINS 'Settings'
          RETURN ${nodeColumns("n")}
        `;

        const storageNodes = nodesFromQuery(await tools.queryGraph(storageQuery, projectName));
        for (const node of storageNodes) {
          if (!node.file_path) continue;

          const relFile = relativeToRoot(effectiveCodebaseRoot, node.file_path);

          // Heuristic: files with 'session' in name likely use sessionStorage;
          // otherwise assume localStorage (more common pattern).
          const storageKey = /session/i.test(relFile) ? "session-storage" : "local-storage";
          if (!browserStorageSignals.has(storageKey)) {
            browserStorageSignals.set(storageKey, new Set());
          }
          browserStorageSignals.get(storageKey)!.add(relFile);
        }
      } catch {
        // query_graph not available — skip browser storage detection silently
      }

      for (const storageType of browserStorageTypes) {
        const sourceFiles = browserStorageSignals.get(storageType);
        if (!sourceFiles || sourceFiles.size === 0) continue;

        const accessPattern = storageType === "local-storage" ? "localStorage" : "sessionStorage";
        const inferredFrom = Array.from(sourceFiles)
          .filter((f) => !this.isTestCode({ source_file: f }))
          .map((f) => ({
            source_file: f,
            import_pattern: accessPattern,
            function_patterns: [],
          }));

        if (inferredFrom.length > 0) {
          candidates.push({
            suggested_layer: "data-store",
            suggested_name: storageType,
            inferred_from: inferredFrom,
            confidence: "low",
            notes: `Inferred from ${inferredFrom.length} source file(s) using browser ${accessPattern} (global API, no import required)`,
          });
        }
      }

      return candidates;
    } finally {
      client.close();
    }
  }

  /**
   * Infer a datastore name from import target name, file path, node properties, or import pattern
   *
   * @private
   */
  private inferDatastoreName(
    filePath: string,
    node: CbmGraphNode,
    matchedPattern?: string,
    importTargetName?: string
  ): string | undefined {
    // Priority 1: Use import target name directly if it matched a pattern
    // This is the most reliable signal for import-based detection (e.g., "mongodb", "pg")
    if (importTargetName && matchedPattern) {
      // If the import target matches the pattern, use it as-is
      if (this.matchPattern(importTargetName, matchedPattern)) {
        return importTargetName;
      }
    }

    // Priority 2: Try to extract from import pattern (e.g., "mongodb" from pattern)
    if (matchedPattern) {
      // Extract database name from pattern like "mongodb", "pg", etc.
      const match = matchedPattern.match(/[a-z]+/i);
      if (match) {
        return match[0];
      }
    }

    // Priority 3: Try to extract from file name (e.g., "users.migration.ts" -> "users")
    const fileName = path.basename(filePath);
    if (fileName.includes("migration") || fileName.includes("schema")) {
      const match = fileName.match(/^([a-z0-9_-]+)/i);
      if (match && match[1]) {
        return match[1];
      }
    }

    // Priority 4: Try to extract from node name or label
    const nodeName = String(node.label ?? node.id ?? "");

    // Check if the label is a known datastore-related type by checking mapping
    // Generic structural labels like Function, Method, Class, Module, Route should be excluded
    if (nodeName) {
      const nodeMapping = this.mapper.getNodeMapping(nodeName);
      // If the label is in the mapping and NOT a generic structural type, use it
      if (nodeMapping && nodeMapping.dr_layer !== "api" && nodeMapping.dr_layer !== "application") {
        return nodeName;
      }

      // Also check if it explicitly looks like a datastore name (e.g., "Database", "Repository")
      if (nodeName.toLowerCase().includes("database") ||
          nodeName.toLowerCase().includes("repository") ||
          nodeName.toLowerCase().includes("datastore")) {
        return nodeName;
      }
    }

    // Fallback: use a generic name based on what was detected
    return undefined;
  }

  /**
   * Query for callers of a specific function or symbol
   *
   * Delegates to trace_path MCP tool with direction="inbound" to find
   * all functions that call the specified qualified name. Applies depth clamping
   * (default 3, max 10) and transforms CBM response nodes into CallGraphNode objects
   * using edge-type mappings from the analyzer.
   *
   * @param projectRoot Absolute path to the project root
   * @param qualifiedName Fully qualified symbol name (e.g., "com.example.UserService.getUser")
   * @param depth Maximum traversal depth (default 3, clamped to max 10)
   * @param options Optional codebase configuration
   * @returns Array of callers in the call graph
   * @throws CLIError if project not indexed or analyzer not installed
   */
  async callers(
    projectRoot: string,
    qualifiedName: string,
    depth?: number,
    options?: AnalyzerCodebaseOptions
  ): Promise<CallGraphNode[]> {
    return this.traceCallPath(projectRoot, qualifiedName, depth, "inbound", options);
  }

  /**
   * Query for callees of a specific function or symbol
   *
   * Delegates to trace_path MCP tool with direction="outbound" to find
   * all functions called by the specified qualified name. Applies depth clamping
   * (default 3, max 10) and transforms CBM response nodes into CallGraphNode objects
   * using edge-type mappings from the analyzer.
   *
   * @param projectRoot Absolute path to the project root
   * @param qualifiedName Fully qualified symbol name (e.g., "com.example.UserService.getUser")
   * @param depth Maximum traversal depth (default 3, clamped to max 10)
   * @param options Optional codebase configuration
   * @returns Array of callees in the call graph
   * @throws CLIError if project not indexed or analyzer not installed
   */
  async callees(
    projectRoot: string,
    qualifiedName: string,
    depth?: number,
    options?: AnalyzerCodebaseOptions
  ): Promise<CallGraphNode[]> {
    return this.traceCallPath(projectRoot, qualifiedName, depth, "outbound", options);
  }

  /**
   * Cypher fallback for call graph traversal when trace_path is unavailable.
   *
   * Uses query_graph directly with CALLS-edge Cypher when trace_path returns a
   * non-array nodes field (i.e. is not implemented in the binary).
   *
   * @private
   */
  private async callGraphViaCypher(
    binaryPath: string,
    projectName: string,
    qualifiedName: string,
    direction: "outbound" | "inbound",
    depth: number,
    codebaseRoot: string
  ): Promise<CallGraphNode[]> {
    // Escape single quotes for Cypher string literals (ISO SQL-style doubling)
    const safeQN = qualifiedName.replace(/'/g, "''");
    const limit = Math.min(depth * 20, 100);
    const cypher = direction === "inbound"
      ? `MATCH (caller)-[:CALLS]->(target) WHERE target.qualified_name = '${safeQN}' OR target.name = '${safeQN}' RETURN caller.id AS id, caller.qualified_name AS qualified_name, caller.file_path AS file_path LIMIT ${limit}`
      : `MATCH (source)-[:CALLS]->(callee) WHERE source.qualified_name = '${safeQN}' OR source.name = '${safeQN}' RETURN callee.id AS id, callee.qualified_name AS qualified_name, callee.file_path AS file_path LIMIT ${limit}`;

    if (depth > 1) {
      handleWarning(
        `Cypher CALLS fallback: depth ${depth} requested but fallback only traverses 1 hop`,
        ["Multi-hop traversal requires trace_path support in the analyzer binary"]
      );
    }

    // Spawn a fresh client — the binary closes the stdio pipe after an unimplemented
    // method call, so the caller's trace_path connection cannot be reused here.
    const client = new StdioClient();
    try {
      client.spawn(binaryPath);
      const version = await getCliVersion();
      await client.initialize({ name: "dr-cli", version });

      const queryResponse = await new CbmTools(client).queryGraph(cypher, projectName);

      const cols: string[] = queryResponse.columns;
      const tuples: unknown[][] = queryResponse.rows;
      return tuples.map((row) => {
        const obj: Record<string, unknown> = {};
        cols.forEach((col, i) => {
          // Strip table-alias prefix (e.g. "caller.id" → "id")
          const key = col.includes(".") ? col.slice(col.lastIndexOf(".") + 1) : col;
          obj[key] = row[i];
        });
        return shapeCallGraphNode(obj, codebaseRoot);
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      handleWarning(
        "Cypher CALLS fallback failed — returning empty call graph",
        [
          `Error: ${errorMsg}`,
          "Neither trace_path nor query_graph is available for call graph traversal",
        ]
      );
      return [];
    } finally {
      client.close();
    }
  }

  /**
   * Internal helper to trace call paths in either direction
   *
   * Handles common logic for callers() and callees(): pre-flight checks,
   * depth clamping, tool invocation, and response transformation.
   *
   * @private
   */
  private async traceCallPath(
    projectRoot: string,
    qualifiedName: string,
    depth: number | undefined,
    direction: "outbound" | "inbound",
    options?: AnalyzerCodebaseOptions
  ): Promise<CallGraphNode[]> {
    // Resolve the effective codebase root
    const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;

    // Check that the project is indexed (same pre-flight checks as endpoints)
    const status = await this.status(projectRoot, { codebaseRoot: effectiveCodebaseRoot });
    if (!status.indexed) {
      throw new CLIError(
        `Project not indexed: ${projectRoot}`,
        ErrorCategory.NOT_FOUND,
        [
          "Run `dr analyzer index` to index the project",
          "Ensure codebase-memory-mcp is installed and working",
        ]
      );
    }

    // Use detection result from status() instead of re-detecting
    const detection = status.detected;
    if (!detection.installed) {
      throw cbmNotInstalledError(detection);
    }

    // Clamp depth: default 3, max 10
    const clampedDepth = clampDepth(depth);

    const client = new StdioClient();

    try {
      client.spawn(detection.binary_path);

      const version = await getCliVersion();
      await client.initialize({
        name: "dr-cli",
        version,
      });

      const tools = new CbmTools(client);

      // Resolve internal project name — trace_path requires the CBM name, not the absolute path
      const projectName = await this.resolveProjectName(tools, effectiveCodebaseRoot);

      // Call trace_path with the clamped depth
      let trace;
      try {
        trace = await tools.tracePath({
          function_name: qualifiedName,
          direction,
          depth: clampedDepth,
          project: projectName,
        });
      } catch (error) {
        if (error instanceof CbmToolError && /not found/i.test(error.detail)) {
          throw new CLIError(
            `Symbol not found in the code graph: ${qualifiedName}`,
            ErrorCategory.NOT_FOUND,
            [
              ...(error.suggestions ?? []),
              "Pass the fully qualified name as CBM records it (see `dr analyzer services --json`)",
            ]
          );
        }
        throw error;
      }

      if (!trace) {
        // trace_path not implemented — fall back to Cypher CALLS query.
        // Pass binary_path (not client): the binary closes the pipe after an unimplemented call.
        return this.callGraphViaCypher(detection.binary_path, projectName, qualifiedName, direction, clampedDepth, effectiveCodebaseRoot);
      }

      const nodes = trace.nodes;
      const edges = trace.edges;

      // CBM 0.11+ trace rows carry qualified names and hops only; look up their files.
      if (trace.shape === "grouped" && nodes.length > 0) {
        try {
          const files = await tools.filePathsOf(
            nodes.map((n) => String(n.qualified_name ?? "")),
            projectName
          );
          for (const node of nodes) {
            node.file_path ??= files.get(String(node.qualified_name ?? ""));
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          handleWarning("Could not look up source files for the call graph", [`Error: ${errorMsg}`]);
        }
      }

      // Valid edge types come from the mapping; the first is the default for root nodes and
      // nodes without a typed incoming edge, which is CALLS regardless of the mapping's key order.
      const mappedEdgeTypes = this.mapper.getEdgeTypes();
      const validEdgeTypes = ["CALLS", ...mappedEdgeTypes.filter((t) => t !== "CALLS")];

      // Transform nodes to CallGraphNode objects
      const callGraphNodes: CallGraphNode[] = [];

      for (const node of nodes) {
        const nodeQualifiedName = String(node.qualified_name || node.id || "");

        // Shape the node using utility function
        let callGraphNode = shapeCallGraphNode(node, effectiveCodebaseRoot);

        // Determine edge type using utility function
        const nodeDepth = typeof node.depth === "number" ? node.depth : 0;
        const edgeType = determineEdgeType(
          nodeDepth,
          edges,
          nodeQualifiedName,
          validEdgeTypes
        );

        // Apply edge type to the shaped node
        callGraphNode.edge_type = edgeType;

        callGraphNodes.push(callGraphNode);
      }

      return callGraphNodes;
    } finally {
      client.close();
    }
  }

  /**
   * Shape a single CBM graph node into a route object with defaults applied
   *
   * This is extracted to be testable - applies the defaulting logic used in verify()
   * to ensure empty/missing properties are handled consistently.
   *
   * @param node Raw node from CBM graph search
   * @returns Shaped route object with defaults applied
   * @internal
   */
  shapeRoute(node: CbmGraphNode): {
    id: string;
    http_method: string;
    http_path: string;
    handler: string;
    source_file: string;
    source_symbol: string;
  } {
    const properties = node.properties ?? {};
    const nodeName = String(node.name ?? node.id ?? "");

    // Extract HTTP method: properties first, then parse from qualified_name
    // qualified_name format: __route__METHOD__/path (e.g. __route__GET__/users)
    let httpMethod = "GET";
    if (typeof properties.method === "string") {
      httpMethod = properties.method.toUpperCase();
    } else {
      const qn = String(node.qualified_name ?? "");
      const methodMatch = qn.match(/^__route__([A-Z]+)__/);
      const extracted = methodMatch?.[1] ?? "";
      if (extracted && (VALID_HTTP_METHODS as readonly string[]).includes(extracted)) {
        httpMethod = extracted;
      }
    }

    // Extract HTTP path: properties first, then node.name if it looks like a URL
    const httpPath = typeof properties.path === "string"
      ? properties.path
      : (typeof node.name === "string" && node.name.startsWith("/") ? node.name : "/");

    const handler = String(properties.handler_name ?? "");
    const sourceFile = node.file_path ?? "";
    // Fall back to source_symbol then handler_name if symbol is absent (e.g. Python route handlers)
    const sourceSymbol = String(properties.symbol ?? properties.source_symbol ?? properties.handler_name ?? "");

    // Construct route ID (use file:symbol as primary key for matching)
    const routeId = sourceFile && sourceSymbol
      ? `${sourceFile}:${sourceSymbol}`
      : (nodeName || node.id || "(unknown)");

    return {
      id: routeId,
      http_method: httpMethod,
      http_path: httpPath,
      handler,
      source_file: sourceFile,
      source_symbol: sourceSymbol,
    };
  }

  /**
   * Tier-0 classification of the indexed project (`dr analyzer classify --tier0-only`).
   *
   * Builds a card for every candidate symbol (src/analyzers/cards) and applies the Tier-0 rules
   * from this analyzer's extraction heuristics. Reads the graph only: no model calls, no writes.
   *
   * @throws CLIError if the project is not indexed or the mapping has no Tier-0 rules
   */
  async classify(projectRoot: string, options: ClassifyOptions & AnalyzerCodebaseOptions = {}): Promise<ClassifyReport> {
    const effectiveCodebaseRoot = options.codebaseRoot ?? projectRoot;
    const rules = tier0RulesFrom(this.mapper.getHeuristics());
    if (rules.length === 0) {
      throw new CLIError(`The ${this.name} analyzer mapping has no Tier-0 rules`, ErrorCategory.USER, [
        "Tier-0 rules are heuristics with a parameters.tier0 block in the analyzer's extraction-heuristics.json",
      ]);
    }

    if (options.labels?.length) {
      const known = new Set([...this.mapper.getNodeLabels(), ...defaultLabels(rules), ...Object.keys(CARD_FIELDS), ...TEST_CARD_LABELS]);
      const unknown = options.labels.filter((l) => !known.has(l));
      if (unknown.length) {
        throw new CLIError(`Unknown label${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`, ErrorCategory.USER, [
          `Labels are case-sensitive; known labels: ${[...known].sort().join(", ")}`,
        ]);
      }
    }

    const status = await this.status(projectRoot, { codebaseRoot: effectiveCodebaseRoot });
    if (!status.indexed) {
      throw new CLIError(`Project not indexed: ${projectRoot}`, ErrorCategory.NOT_FOUND, [
        "Run `dr analyzer index` to index the project",
        "Ensure codebase-memory-mcp is installed and working",
      ]);
    }
    const detection = status.detected;
    if (!detection.installed) {
      throw cbmNotInstalledError(detection);
    }

    const client = new StdioClient();
    try {
      client.spawn(detection.binary_path);
      await client.initialize({ name: "dr-cli", version: await getCliVersion() });
      const tools = new CbmTools(client);
      const projectName = await this.resolveProjectName(tools, effectiveCodebaseRoot);
      return await classifyTier0(cbmCardGraph(tools, projectName), rules, this.name, {
        sourceRoot: effectiveCodebaseRoot,
        ...options,
      });
    } finally {
      client.close();
    }
  }

  /** The Tier-0 rules, edge mappings and node-mapping decisions extraction runs with. */
  extractionConfig(): ExtractionConfig {
    const nodeMappings = this.mapper
      .getNodeLabels()
      .map((label) => this.mapper.getNodeMapping(label))
      .filter((m): m is NonNullable<typeof m> => !!m);
    const edgeMappings = this.mapper
      .getEdgeTypes()
      .map((type) => this.mapper.getEdgeMapping(type))
      .filter((m): m is NonNullable<typeof m> => !!m);
    const heuristics = this.mapper.getHeuristics();
    return extractionConfigFrom(tier0RulesFrom(heuristics), edgeMappings, nodeMappings, callGateFrom(heuristics));
  }

  /**
   * What `codebase_extract` reads from the index (src/analyzers/cards/extract.ts): cards with
   * their Tier-0 outcomes, the mapped edges and the symbols of the files asked about. Read-only.
   * Graph reads get two minutes each, past the client's 30s default, for large graphs.
   *
   * @throws CLIError if the project is not indexed or the mapping has no Tier-0 rules
   */
  async extract(projectRoot: string, options: ExtractOptions & AnalyzerCodebaseOptions = {}): Promise<ExtractionGraph> {
    const effectiveCodebaseRoot = options.codebaseRoot ?? projectRoot;
    const config = this.extractionConfig();
    if (config.rules.length === 0) {
      throw new CLIError(`The ${this.name} analyzer mapping has no Tier-0 rules`, ErrorCategory.USER);
    }
    const status = await this.status(projectRoot, { codebaseRoot: effectiveCodebaseRoot });
    if (!status.indexed) {
      throw new CLIError(`Project not indexed: ${projectRoot}`, ErrorCategory.NOT_FOUND, ["Run `dr analyzer index` to index the project"]);
    }
    if (!status.detected.installed) {
      throw cbmNotInstalledError(status.detected);
    }
    const client = new StdioClient();
    try {
      client.spawn(status.detected.binary_path);
      await client.initialize({ name: "dr-cli", version: await getCliVersion() });
      const tools = new CbmTools(client, { timeout: EXTRACT_CALL_TIMEOUT_MS });
      const projectName = await this.resolveProjectName(tools, effectiveCodebaseRoot);
      const extraction = await collectExtraction(cbmCardGraph(tools, projectName), config, this.name, {
        sourceRoot: effectiveCodebaseRoot,
        ...options,
      });
      if (extraction.crossEdges) {
        // Which repository each target project is, and the route each target handler serves there.
        const projects: Record<string, string> = {};
        for (const p of await tools.listProjects()) projects[p.name] = p.root_path;
        extraction.crossProjects = projects;
        for (const target of new Set(extraction.crossEdges.filter((e) => !e.served && projects[e.targetProject]).map((e) => e.targetProject))) {
          try {
            const rows = await tools.queryGraph(TARGET_HANDLERS_QUERY, target);
            attachTargetRoutes(extraction.crossEdges, target, handlerRoutes(rows.rows));
          } catch (error) {
            handleWarning(`Could not read the routes of ${target}; its references use the calling side's route`, [
              error instanceof Error ? error.message : String(error),
            ]);
          }
        }
      }
      return extraction;
    } finally {
      client.close();
    }
  }

  /**
   * CBM's `detect_changes` for a git range (CBM 0.12+): the changed symbols as the index places
   * them, and their callers. Read-only; the caller judges the index's freshness, not this.
   *
   * @throws CLIError if the project is not indexed or the analyzer not installed;
   *   CbmToolError when CBM answers with an error (an older CBM without the tool, a bad ref)
   */
  async detectChanges(projectRoot: string, options: { since: string } & AnalyzerCodebaseOptions): Promise<DetectedChanges> {
    const effectiveCodebaseRoot = options.codebaseRoot ?? projectRoot;
    const status = await this.status(projectRoot, { codebaseRoot: effectiveCodebaseRoot });
    if (!status.indexed) {
      throw new CLIError(`Project not indexed: ${projectRoot}`, ErrorCategory.NOT_FOUND, ["Run `dr analyzer index` to index the project"]);
    }
    if (!status.detected.installed) {
      throw cbmNotInstalledError(status.detected);
    }
    const client = new StdioClient();
    try {
      client.spawn(status.detected.binary_path);
      await client.initialize({ name: "dr-cli", version: await getCliVersion() });
      const tools = new CbmTools(client, { timeout: EXTRACT_CALL_TIMEOUT_MS });
      const projectName = await this.resolveProjectName(tools, effectiveCodebaseRoot);
      return await tools.detectChanges({ project: projectName, since: options.since });
    } finally {
      client.close();
    }
  }

  /**
   * Verify that graph-discovered routes align with model endpoints
   *
   * Queries the CBM graph for Route nodes, shapes them via the Route mapping,
   * and delegates comparison to VerifyEngine. Entirely read-only.
   *
   * @param projectRoot Absolute path to the project root
   * @param options Verification options including codebase root
   * @returns Comprehensive verification report
   * @throws CLIError if project not indexed or analyzer not installed
   */
  async verify(
    projectRoot: string,
    options: VerifyOptions & AnalyzerCodebaseOptions
  ): Promise<VerifyReport> {
    // Resolve the effective codebase root
    const effectiveCodebaseRoot = options?.codebaseRoot ?? projectRoot;

    // Check that the project is indexed
    const status = await this.status(projectRoot, { codebaseRoot: effectiveCodebaseRoot });
    if (!status.indexed) {
      throw new CLIError(
        `Project not indexed: ${projectRoot}`,
        ErrorCategory.NOT_FOUND,
        [
          "Run `dr analyzer index` to index the project",
          "Ensure codebase-memory-mcp is installed and working",
        ]
      );
    }

    // Use detection result from status() instead of re-detecting
    const detection = status.detected;
    if (!detection.installed) {
      throw cbmNotInstalledError(detection);
    }

    // Get the Route mapping BEFORE initializing client to validate it exists
    const routeMapping = this.mapper.getNodeMapping("Route");
    if (!routeMapping) {
      throw new CLIError(
        "Route mapping not found in analyzer",
        ErrorCategory.VALIDATION,
        ["Run `npm run build:spec` to recompile the analyzer artifacts"]
      );
    }

    const client = new StdioClient();

    try {
      client.spawn(detection.binary_path);

      const version = await getCliVersion();
      await client.initialize({
        name: "dr-cli",
        version,
      });

      // Layer checks read the graph the way extraction does: allow its longer reads.
      const tools = new CbmTools(client, { timeout: EXTRACT_CALL_TIMEOUT_MS });

      // Resolve internal project name for search_graph (requires name, not absolute path)
      const projectName = await this.resolveProjectName(tools, effectiveCodebaseRoot);

      // Search for Route nodes using the CBM label from the mapping
      const allNodes = await this.fetchRoutes(tools, projectName, routeMapping.cbm_label);
      // Keep only nodes whose qualified_name follows the __route__METHOD__/path
      // convention. Nodes that don't match are graph artifacts (documentation
      // strings, base URLs, etc.) that were incidentally labelled Route by the
      // indexer — not actual HTTP routes.
      const nodes = allNodes
        .filter((n) => /^__route__[A-Z]+__\//.test(String(n.qualified_name ?? "")))
        .filter((n) => isLikelyHttpRoute(String(n.qualified_name ?? "")))
        // Served here: a file or handler, not on another host, not only declared in an OpenAPI file.
        .filter(isServedRoute);

      // Shape routes via mapping; drop unattributed nodes (same filter as endpoints())
      const routes = nodes
        .map((node) => this.shapeRoute(node))
        .filter((r) => r.source_file);

      // Files the analyzer didn't index or parsed only in part: what's sourced only there is a
      // parse gap, not drift. check_index_coverage is optional; without it nothing is.
      const notIndexed = async (files: string[]): Promise<Map<string, string>> => {
        try {
          return await tools.indexCoverage(projectName, files);
        } catch (error) {
          handleWarning(`Could not read the index's coverage (check_index_coverage): ${error instanceof Error ? error.message : String(error)}`);
          return new Map();
        }
      };

      // Delegate to VerifyEngine
      const engine = new VerifyEngine();
      const indexMeta = status.index_meta;
      const analyzerName = this.name;
      const report = await engine.computeReport(projectRoot, routes, options, analyzerName, indexMeta, notIndexed);

      // The other layers: what extraction makes of the code's tables, infrastructure and test
      // cases against the model's elements of those types (layer-verify.ts).
      const requested = options?.layers && options.layers.length > 0 ? options.layers : ["api"];
      const others = requested.filter((l) => l !== "api" && LAYER_CHECKS[l]);
      const layers = requested.includes("api") && report.buckets ? [apiLayerReport(report)] : [];
      let layersNotVerified: Array<{ layer: string; reason: string }> = [];
      if (others.length > 0) {
        // A layer whose check fails is reported, not thrown: the API results (and the other
        // layers') survive it.
        try {
          const model = await Model.load(projectRoot);
          const manager = new StagingAreaManager(model.rootPath, model);
          const active = options?.changesetAware === false ? null : await manager.getActive();
          const now = new Date().toISOString();
          const base = new Changeset({ id: "verify-base", name: "base model", created: now, modified: now, status: "committed", baseSnapshot: "", changes: [] });
          const graph = await ChangesetGraph.build(model, active ?? base);
          // What codebase_extract was told is not an element or relationship, and the ignore file,
          // hold here as they do for extraction and the API check.
          const decisions = await readRecordedDecisions(projectRoot, await manager.list());
          const ignoreRules = await IgnoreFileLoader.load(options?.ignoreFilePath || path.join(projectRoot, ".dr-verify-ignore.yaml"));
          const result = await verifyLayers({
            graph: cbmCardGraph(tools, projectName),
            config: this.extractionConfig(),
            analyzer: this.name,
            sourceRoot: effectiveCodebaseRoot,
            model: graph,
            layers: others,
            coverage: await loadExtractionCoverage(this.name),
            notIndexed,
            fileExists: (file) => existsSync(path.join(effectiveCodebaseRoot, file)),
            fileText: (file) => {
              try {
                return readFileSync(path.join(effectiveCodebaseRoot, file), "utf-8");
              } catch {
                return null;
              }
            },
            hasTriple: catalogHasTriple,
            notElements: decisions.notElements,
            notRelationships: decisions.notRelationships,
            ignoreRules,
          });
          layers.push(...result.reports);
          layersNotVerified = result.notVerified;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          layersNotVerified = others.map((layer) => ({ layer, reason }));
        }
        for (const { layer, reason } of layersNotVerified) handleWarning(`Could not verify the ${layer} layer: ${reason}`);
      }
      // In the order asked.
      layers.sort((a, b) => requested.indexOf(a.layer) - requested.indexOf(b.layer));
      // A layer whose check failed was not verified: it is listed under layers_not_verified only.
      const failed = new Set(layersNotVerified.map((n) => n.layer));
      return {
        ...report,
        ...(report.layers_verified ? { layers_verified: report.layers_verified.filter((l) => !failed.has(l)) } : {}),
        layers,
        ...(layersNotVerified.length ? { layers_not_verified: layersNotVerified } : {}),
      };
    } finally {
      client.close();
    }
  }
}

/** The heading DR writes above the lines it adds to .cbmignore. */
const CBM_IGNORE_HEADING =
  "# Added by Documentation Robotics: its model, changesets and analyzer state are not code.";

/**
 * Makes sure codebase-memory-mcp leaves DR's own folders ({@link DR_OWN_DIRS}: documentation-robotics/
 * and .dr/) out of the index. codebase-memory-mcp has no exclude argument; it skips what .gitignore,
 * the repository's info/exclude and a `.cbmignore` at the indexed root list (gitignore syntax).
 * DR's folders are meant to be committed, so they can't go in the first two; `.cbmignore` is read
 * by the analyzer alone.
 *
 * Adds a line for each DR folder inside the codebase root that the file doesn't already list,
 * creating the file when needed; a folder outside the codebase root isn't indexed anyway, and a
 * folder the file negates (`!/documentation-robotics/`) is the developer's choice. Returns
 * the file's path and the lines it added (none when it already had them).
 */
export async function ensureCbmIgnore(
  codebaseRoot: string,
  projectRoot: string
): Promise<{ path: string; added: string[]; created: boolean }> {
  const file = path.join(codebaseRoot, ".cbmignore");
  let text = "";
  let created = true;
  try {
    text = await readFile(file, "utf-8");
    created = false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const folder = (line: string) => line.replace(/^\/+/, "").replace(/\/+$/, "");
  const listed = new Set(lines.filter((line) => !line.startsWith("!")).map(folder));
  // A negation (`!/documentation-robotics/`) is the developer asking for the folder to be
  // indexed: leave it alone.
  const negated = new Set(lines.filter((line) => line.startsWith("!")).map((line) => folder(line.slice(1))));
  const added: string[] = [];
  for (const dir of DR_OWN_DIRS) {
    const relative = path.relative(codebaseRoot, path.join(projectRoot, dir)).split(path.sep).join("/");
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    if (!listed.has(relative) && !negated.has(relative)) added.push(`/${relative}/`);
  }
  if (added.length === 0) return { path: file, added, created: false };

  const separator = text.length === 0 ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  const heading = text.includes(CBM_IGNORE_HEADING) ? "" : `${CBM_IGNORE_HEADING}\n`;
  await writeFile(file, `${text}${separator}${heading}${added.join("\n")}\n`);
  return { path: file, added, created };
}
