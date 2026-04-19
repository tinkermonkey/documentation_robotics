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
import { readFile } from "fs/promises";
import { CLIError, ErrorCategory, handleWarning } from "../utils/errors.js";
import type { AnalyzerBackend } from "./base-analyzer.js";
import type {
  AnalyzerStatus,
  DetectionResult,
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
import { StdioClient } from "./stdio-client.js";
import { readIndexMeta, writeIndexMeta } from "./session-state.js";
import type { MappingLoader } from "./mapping-loader.js";
import { getCliVersion } from "./version.js";
import { StagingAreaManager } from "../core/staging-area.js";

/**
 * Graph node from CBM search results
 */
interface CbmGraphNode {
  id: string;
  label: string;
  properties?: Record<string, unknown>;
  file_path?: string;
  [key: string]: unknown;
}

/**
 * CBM Analyzer implementation
 */
export class CbmAnalyzer implements AnalyzerBackend {
  private mapper: MappingLoader;
  private testCodePatternWarned = false;

  /**
   * Default regex patterns for test code detection
   */
  private static readonly DEFAULT_TEST_PATTERNS = [
    /\.test\./,
    /\.spec\./,
    /\/tests?\//,
    /\/__tests__\//,
    /\/test-/,
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
        await client.initialize({
          name: "dr-cli",
          version,
        });

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
          version: undefined, // Version could be extracted from --version if needed
          mcp_registered: mcpRegistered,
          contract_ok: contractOk,
        };
      } catch (error) {
        // Initialize failed - log diagnostic info and continue to next binary
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        handleWarning(
          `Binary ${binaryName} failed initialization: ${errorMessage}`,
          ["Check that the binary is properly installed and functional"]
        );
        continue;
      } finally {
        // Always close the client to prevent orphan processes
        try {
          client.close();
        } catch {
          // Ignore errors during cleanup
        }
      }
    }

    // No binary found or functional
    return {
      installed: false,
    };
  }

  /**
   * Get the current status of the analyzer for a project
   *
   * Checks if the project is indexed and whether the index is fresh relative to git HEAD.
   *
   * @param projectRoot Absolute path to the project root
   * @returns Current status including detection, index state, and freshness
   */
  async status(projectRoot: string): Promise<AnalyzerStatus> {
    const detected = await this.detect(projectRoot);

    // Read index metadata if it exists
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
    let fresh = false;
    try {
      const currentHeadResult = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf-8",
      });

      if (currentHeadResult.status === 0) {
        const currentHead = currentHeadResult.stdout.trim();
        fresh = currentHead === indexMeta.git_head;
      } else {
        // Git command failed - log diagnostic info
        const gitError = currentHeadResult.stderr?.trim() || "git returned non-zero status";
        handleWarning("Failed to check git freshness", [
          `Git error: ${gitError}`,
          "Index freshness cannot be determined - treating as stale",
        ]);
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
   * @param options Optional configuration
   * @returns Index result with counts and metadata
   */
  async index(
    projectRoot: string,
    options?: { force?: boolean }
  ): Promise<IndexResult> {
    // Get current status
    const status = await this.status(projectRoot);

    // Skip if fresh and not forced
    if (status.indexed && status.fresh && !options?.force) {
      handleWarning("Index is fresh. Use --force to reindex.", [
        `Last indexed: ${status.last_indexed}`,
      ]);

      // Return the existing metadata
      const meta = status.index_meta!;
      return {
        success: true,
        node_count: meta.node_count,
        edge_count: meta.edge_count,
        git_head: meta.git_head,
        timestamp: meta.timestamp,
      };
    }

    // Use detection result from status() instead of re-detecting
    const detection = status.detected;
    if (!detection.installed || !detection.binary_path) {
      throw new CLIError(
        "CBM analyzer not installed",
        ErrorCategory.NOT_FOUND,
        [
          "Install codebase-memory-mcp: npm install -g codebase-memory-mcp",
          "Ensure the binary is in your PATH",
        ]
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

      // Check if project is already indexed using list_projects
      // This validates the acceptance criterion and prevents duplicate project creation
      const listProjectsResponse = (await client.callTool(
        "list_projects"
      )) as {
        projects?: Array<{ path: string; indexed?: boolean }>;
        [key: string]: unknown;
      };

      // Validate response structure
      if (!listProjectsResponse || typeof listProjectsResponse !== "object") {
        throw new CLIError(
          "Invalid response from list_projects",
          ErrorCategory.SYSTEM,
          ["Ensure codebase-memory-mcp is properly installed and functional"]
        );
      }

      const projects = Array.isArray(listProjectsResponse.projects)
        ? (listProjectsResponse.projects as Array<{
            path: string;
            indexed?: boolean;
          }>)
        : [];
      const projectExists = projects.some((p) => p.path === projectRoot);

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
          success: true,
          node_count: meta.node_count,
          edge_count: meta.edge_count,
          git_head: meta.git_head,
          timestamp: meta.timestamp,
        };
      }

      // Get current git HEAD - fail if git is not available
      // This must happen before index_repository to avoid inconsistent state
      const headResult = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf-8",
      });

      if (headResult.status !== 0) {
        throw new CLIError(
          "Failed to get git HEAD",
          ErrorCategory.SYSTEM,
          [
            "Ensure the project is a git repository",
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

      // Index the repository
      const indexResponse = (await client.callTool("index_repository", {
        repo_path: projectRoot,
      })) as {
        node_count?: number;
        edge_count?: number;
        [key: string]: unknown;
      };

      // Validate response structure
      if (!indexResponse || typeof indexResponse !== "object") {
        throw new CLIError(
          "Invalid response from index_repository",
          ErrorCategory.SYSTEM,
          ["Ensure codebase-memory-mcp is properly installed and functional"]
        );
      }

      const timestamp = new Date().toISOString();
      const nodeCount =
        typeof indexResponse.node_count === "number"
          ? indexResponse.node_count
          : 0;
      const edgeCount =
        typeof indexResponse.edge_count === "number"
          ? indexResponse.edge_count
          : 0;

      // Warn if counts were not numbers and defaulted to zero
      if (typeof indexResponse.node_count !== "number") {
        handleWarning(
          "Invalid node_count from index_repository",
          [
            `Expected number, got ${typeof indexResponse.node_count}: ${String(
              indexResponse.node_count
            )}`,
            "Defaulting to 0 - index may be incomplete or corrupted",
          ]
        );
      }

      if (typeof indexResponse.edge_count !== "number") {
        handleWarning(
          "Invalid edge_count from index_repository",
          [
            `Expected number, got ${typeof indexResponse.edge_count}: ${String(
              indexResponse.edge_count
            )}`,
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
      };

      const analyzerName = this.mapper.getAnalyzerName();
      await writeIndexMeta(meta, projectRoot, analyzerName);

      return {
        success: true,
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
   * Query for API endpoints/routes in the indexed project
   *
   * Searches the indexed graph for Route nodes, applies field mappings from
   * the analyzer's mapping, and filters based on test code exclusion rules.
   *
   * @param projectRoot Absolute path to the project root
   * @returns Array of endpoint candidates with confidence and source info
   * @throws CLIError if the project is not indexed
   */
  async endpoints(projectRoot: string): Promise<EndpointCandidate[]> {
    // Check that the project is indexed
    const status = await this.status(projectRoot);
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
    if (!detection.installed || !detection.binary_path) {
      throw new CLIError(
        "CBM analyzer not installed",
        ErrorCategory.NOT_FOUND,
        ["Install codebase-memory-mcp: npm install -g codebase-memory-mcp"]
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

      // Search for Route nodes
      const searchResponse = (await client.callTool("search_graph", {
        label: "Route",
        project: projectRoot,
      })) as {
        nodes?: CbmGraphNode[];
        [key: string]: unknown;
      };

      // Validate response structure
      if (!searchResponse || typeof searchResponse !== "object") {
        throw new CLIError(
          "Invalid response from search_graph",
          ErrorCategory.SYSTEM,
          ["Ensure codebase-memory-mcp is properly installed and functional"]
        );
      }

      const nodes = Array.isArray(searchResponse.nodes)
        ? (searchResponse.nodes as CbmGraphNode[])
        : [];

      // Get the Route mapping
      const routeMapping = this.mapper.getNodeMapping("Route");
      if (!routeMapping) {
        throw new CLIError(
          "Route mapping not found in analyzer",
          ErrorCategory.VALIDATION,
          ["Run `npm run build:spec` to recompile the analyzer artifacts"]
        );
      }

      // Transform nodes to endpoint candidates
      const candidates: EndpointCandidate[] = [];

      for (const node of nodes) {
        const candidate = await this.transformNodeToEndpoint(
          node,
          routeMapping,
          projectRoot
        );

        // Apply test code exclusion filter
        if (!this.isTestCode(candidate)) {
          candidates.push(candidate);
        }
      }

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
   * @returns Raw result from query_graph tool
   * @throws CLIError if project not indexed or query_graph tool unavailable
   */
  async query(projectRoot: string, rawQuery: string): Promise<unknown> {
    // Check that the project is indexed (same pre-flight checks as endpoints)
    const status = await this.status(projectRoot);
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
    if (!detection.installed || !detection.binary_path) {
      throw new CLIError(
        "CBM analyzer not installed",
        ErrorCategory.NOT_FOUND,
        ["Install codebase-memory-mcp: npm install -g codebase-memory-mcp"]
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

      // Call query_graph tool
      try {
        const queryResponse = await client.callTool("query_graph", {
          query: rawQuery,
          project: projectRoot,
        });

        return queryResponse;
      } catch (error) {
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
    projectRoot: string
  ): Promise<EndpointCandidate> {
    const properties = node.properties ?? {};

    // Extract base fields
    let confidence = mapping.confidence as "high" | "medium" | "low";

    // Suggested name in kebab-case (from node name or id)
    let suggestedName = String(properties.name ?? node.id).toLowerCase();
    suggestedName = suggestedName.replace(/[^a-z0-9-]/g, "-");

    // Suggested ID fragment (same as name for endpoints)
    const suggestedIdFragment = suggestedName;

    // Required fields for dr add api operation
    // Validate and assign HTTP method
    let rawMethod: string;
    if (typeof properties.method !== "string") {
      handleWarning(
        `Node ${node.id}: Missing or invalid HTTP method`,
        [
          `Expected string, got ${typeof properties.method}`,
          "Defaulting to GET - endpoint may be incomplete",
        ]
      );
      rawMethod = "GET";
    } else {
      rawMethod = properties.method.toUpperCase();
    }

    // Validate against valid HTTP methods using the constant
    const validMethods = new Set(VALID_HTTP_METHODS);
    const isValidMethod = validMethods.has(rawMethod as HttpMethod);
    const httpMethod: HttpMethod = isValidMethod
      ? (rawMethod as HttpMethod)
      : "GET";

    if (!isValidMethod) {
      handleWarning(
        `Node ${node.id}: Invalid HTTP method`,
        [
          `Method '${rawMethod}' is not a valid HTTP method`,
          `Valid methods: ${Array.from(validMethods).join(", ")}`,
          "Defaulting to GET - endpoint documentation may be inaccurate",
        ]
      );
    }

    // Validate and assign HTTP path
    let httpPath: string;
    if (typeof properties.path !== "string") {
      handleWarning(
        `Node ${node.id}: Missing or invalid HTTP path`,
        [
          `Expected string, got ${typeof properties.path}`,
          "Defaulting to / - endpoint may be incomplete",
        ]
      );
      httpPath = "/";
    } else {
      httpPath = properties.path;
    }

    // Handler information (from node properties)
    const handlerQualifiedName = String(properties.handler_name ?? "");
    const sourceSymbol = String(properties.symbol ?? "");
    const sourceStartLine = Number(properties.start_line ?? 0);
    const sourceEndLine = Number(properties.end_line ?? 0);

    // Downgrade confidence if handler information is missing
    if (!handlerQualifiedName || !sourceSymbol) {
      confidence = confidence === "high" ? "medium" : confidence;
    }

    // Extract source file (relative to project root)
    let sourceFile = node.file_path ?? "";
    if (sourceFile && projectRoot) {
      try {
        sourceFile = path.relative(projectRoot, sourceFile);
      } catch (error) {
        // If relative path fails, keep absolute
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
   * Check if a candidate (endpoint or service) is in test code
   *
   * Applies the test_code_exclusion filtering rule from the analyzer mapping.
   * If the configured regex pattern is invalid, warns the user once and falls back to defaults.
   * Uses a one-shot flag to ensure the warning is only emitted once even if called in a loop.
   *
   * @private
   */
  private isTestCode(candidate: EndpointCandidate | ServiceCandidate): boolean {
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
   * qualifying_heuristics. Drops candidates with zero qualifying heuristics unless
   * is_entry_point is true. Caps confidence at "medium" and excludes test files.
   *
   * @param projectRoot Absolute path to the project root
   * @returns Array of service candidates with qualifying heuristics populated
   * @throws CLIError if the project is not indexed
   */
  async services(projectRoot: string): Promise<ServiceCandidate[]> {
    // Check that the project is indexed
    const status = await this.status(projectRoot);
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
    if (!detection.installed || !detection.binary_path) {
      throw new CLIError(
        "CBM analyzer not installed",
        ErrorCategory.NOT_FOUND,
        ["Install codebase-memory-mcp: npm install -g codebase-memory-mcp"]
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

      // Get application-layer node labels from the mapping (pattern from endpoints())
      const nodeLabels = this.mapper.getNodeLabels();
      const applicationLabels: string[] = [];

      // Filter to only application-layer labels by checking their mapping
      for (const label of nodeLabels) {
        const mapping = this.mapper.getNodeMapping(label);
        if (mapping && mapping.dr_layer === "application") {
          applicationLabels.push(label);
        }
      }

      // If no application-layer labels found, return empty list
      if (applicationLabels.length === 0) {
        return [];
      }

      const candidates: ServiceCandidate[] = [];

      // Search for each application-layer label
      for (const label of applicationLabels) {
        const searchResponse = (await client.callTool("search_graph", {
          label,
          project: projectRoot,
        })) as {
          nodes?: CbmGraphNode[];
          [key: string]: unknown;
        };

        // Validate response structure
        if (!searchResponse || typeof searchResponse !== "object") {
          throw new CLIError(
            "Invalid response from search_graph",
            ErrorCategory.SYSTEM,
            ["Ensure codebase-memory-mcp is properly installed and functional"]
          );
        }

        const nodes = Array.isArray(searchResponse.nodes)
          ? (searchResponse.nodes as CbmGraphNode[])
          : [];

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
            projectRoot,
            promotionHeuristicNames
          );

          // Filter out candidates with zero qualifying heuristics (unless is_entry_point is true)
          // and apply test code exclusion filter
          if (candidate.qualifying_heuristics.length > 0 && !this.isTestCode(candidate)) {
            candidates.push(candidate);
          }
        }
      }

      return candidates;
    } finally {
      client.close();
    }
  }

  /**
   * Transform a CBM graph node to a service candidate
   *
   * Evaluates all promotion heuristics against the node's properties and records
   * which heuristics fire. Drops candidates where no heuristics fire unless
   * is_entry_point is true. Caps confidence at "medium".
   *
   * @private
   */
  private async transformNodeToService(
    node: CbmGraphNode,
    mapping: AnalyzerNodeMapping,
    projectRoot: string,
    promotionHeuristicNames: string[]
  ): Promise<ServiceCandidate> {
    const properties = node.properties ?? {};

    // Suggested name in kebab-case (from node name or id)
    let suggestedName = String(properties.name ?? node.id).toLowerCase();
    suggestedName = suggestedName.replace(/[^a-z0-9-]/g, "-");

    // Suggested ID fragment (same as name for services)
    const suggestedIdFragment = suggestedName;

    // Extract source file (relative to project root)
    let sourceFile = node.file_path ?? "";
    if (sourceFile && projectRoot) {
      try {
        sourceFile = path.relative(projectRoot, sourceFile);
      } catch (error) {
        // If relative path fails, keep absolute
      }
    }

    // Extract qualified name
    const qualifiedName = String(properties.qualified_name ?? node.id);

    // Extract fan-in and fan-out metrics
    const fanIn = typeof properties.fan_in === "number" ? properties.fan_in : 0;
    const fanOut = typeof properties.fan_out === "number" ? properties.fan_out : 0;

    // Evaluate all promotion heuristics and collect which ones fire
    const qualifyingHeuristics: string[] = [];
    let isEntryPoint = false;

    for (const heuristicName of promotionHeuristicNames) {
      const heuristic = this.mapper.getHeuristic(heuristicName);
      if (!heuristic) {
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
      return {
        suggested_layer: "application",
        suggested_element_type: mapping.dr_element_type_promoted || "applicationservice",
        suggested_id_fragment: suggestedIdFragment,
        suggested_name: suggestedName,
        source_file: sourceFile,
        source_symbol: String(properties.name ?? node.id),
        qualified_name: qualifiedName,
        qualifying_heuristics: [],
        confidence: "low",
        fan_in: fanIn,
        fan_out: fanOut,
      };
    }

    // Cap confidence at "medium" (from mapping or default to medium)
    let confidence = mapping.confidence as "high" | "medium" | "low";
    if (confidence === "high") {
      confidence = "medium";
    }

    return {
      suggested_layer: "application",
      suggested_element_type: mapping.dr_element_type_promoted || "applicationservice",
      suggested_id_fragment: suggestedIdFragment,
      suggested_name: suggestedName,
      source_file: sourceFile,
      source_symbol: String(properties.name ?? node.id),
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
   * @private
   */
  private evaluateHeuristic(
    heuristic: AnalyzerHeuristic,
    node: CbmGraphNode,
    sourceFile: string
  ): boolean {
    const properties = node.properties ?? {};

    switch (heuristic.name) {
      case "min_fan_in": {
        const threshold = (heuristic.parameters?.threshold as number) ?? 5;
        const fanIn = typeof properties.fan_in === "number" ? properties.fan_in : 0;
        return fanIn >= threshold;
      }

      case "directory_match": {
        const patterns = (heuristic.parameters?.patterns as string[]) ?? [];
        return patterns.some((pattern) => this.matchPattern(sourceFile, pattern));
      }

      case "naming_patterns": {
        const suffixes = (heuristic.parameters?.service_suffixes as string[]) ?? [];
        const name = String(properties.name ?? "").toLowerCase();
        return suffixes.some((suffix) => name.endsWith(suffix.toLowerCase()));
      }

      case "class_is_service": {
        // Check for service-like class indicators
        const hasInterfaceImpl = properties.implements_interface === true;
        const hasDependencyInjection = properties.dependency_injection === true;
        const publicMethodsCount = Number(properties.public_methods_count ?? 0);
        // Read threshold from parameters instead of hardcoding
        const threshold = (heuristic.parameters?.threshold as number) ?? 3;
        return (
          hasInterfaceImpl ||
          hasDependencyInjection ||
          publicMethodsCount >= threshold
        );
      }

      case "service_class_naming": {
        const prefixes = (heuristic.parameters?.service_method_prefixes as string[]) ?? [];
        const name = String(properties.name ?? "").toLowerCase();
        return prefixes.some((prefix) => name.startsWith(prefix.toLowerCase()));
      }

      case "is_entry_point": {
        const patterns = (heuristic.parameters?.entry_point_patterns as string[]) ?? [];
        const name = String(properties.name ?? "").toLowerCase();
        return patterns.some((pattern) => name.includes(pattern.toLowerCase()));
      }

      case "handles_route": {
        // Check if this function/method has route handling decoration
        return properties.has_route_handler === true || properties.is_decorated === true;
      }

      default:
        // For unknown heuristics, log a warning rather than silently returning false
        // This supports dynamic heuristics added to cbm.json without code changes
        handleWarning(
          `Unknown heuristic type: ${heuristic.name}`,
          [
            "The heuristic is defined in cbm.json but not implemented in cbm-analyzer.ts",
            "This heuristic will be treated as not met (returning false)",
            "Add support for this heuristic to evaluateHeuristic() if it should fire",
          ]
        );
        return false;
    }
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
    // Handle **/ prefix (matches any number of directories)
    if (pattern.startsWith("**/")) {
      const suffix = pattern.slice(3);
      // Remove trailing /** from suffix if present
      const suffixToMatch = suffix.endsWith("/**") ? suffix.slice(0, -3) : suffix;
      return (
        filePath.includes("/" + suffixToMatch + "/") ||
        filePath.includes(suffixToMatch + "/") ||
        filePath.endsWith(suffixToMatch)
      );
    }

    // Handle trailing /** (matches anything under this directory)
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      return (
        filePath.includes(prefix + "/") || filePath.startsWith(prefix + "/")
      );
    }

    // Handle *.ext patterns (file extensions)
    if (pattern.startsWith("*.")) {
      return filePath.endsWith(pattern.slice(1));
    }

    // Handle *pattern patterns (ends with pattern)
    if (pattern.startsWith("*") && !pattern.includes("/")) {
      return filePath.endsWith(pattern.slice(1));
    }

    // Exact match or substring match
    return filePath.includes(pattern) || filePath.endsWith(pattern);
  }

  /**
   * Query for datastores/databases inferred from code analysis
   *
   * Applies datastore_detection heuristic rules to aggregate signals by file/module.
   * Matches file paths against import_patterns and function/symbol names against
   * naming_indicators from the heuristic parameters. All candidates have confidence "low".
   *
   * @param projectRoot Absolute path to the project root
   * @returns Array of datastore candidates aggregated by inferred datastore
   * @throws CLIError if the project is not indexed
   */
  async datastores(projectRoot: string): Promise<DatastoreCandidate[]> {
    // Check that the project is indexed
    const status = await this.status(projectRoot);
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
    if (!detection.installed || !detection.binary_path) {
      throw new CLIError(
        "CBM analyzer not installed",
        ErrorCategory.NOT_FOUND,
        ["Install codebase-memory-mcp: npm install -g codebase-memory-mcp"]
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

      // Load the datastore_detection heuristic
      const datastoreHeuristic = this.mapper.getHeuristic("datastore_detection");
      if (!datastoreHeuristic) {
        return [];
      }

      const importPatterns = (datastoreHeuristic.parameters?.patterns as string[]) ?? [];
      const namingIndicators = (datastoreHeuristic.parameters?.naming_indicators as string[]) ?? [];

      // Map to track signals by datastore name
      const datastoreSignals = new Map<
        string,
        Array<{
          sourceFile: string;
          importPattern?: string;
          functionPatterns: string[];
        }>
      >();

      // Search for nodes that match datastore-related naming patterns
      const nodeLabels = this.mapper.getNodeLabels();

      for (const label of nodeLabels) {
        const searchResponse = (await client.callTool("search_graph", {
          label,
          project: projectRoot,
        })) as {
          nodes?: CbmGraphNode[];
          [key: string]: unknown;
        };

        if (!searchResponse || typeof searchResponse !== "object") {
          continue;
        }

        const nodes = Array.isArray(searchResponse.nodes) ? searchResponse.nodes : [];

        for (const node of nodes) {
          const filePath = node.file_path ?? "";

          // Check if file matches datastore-related patterns
          let matchedImportPattern: string | undefined;
          for (const pattern of importPatterns) {
            if (this.matchPattern(filePath, pattern)) {
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

          // Extract datastore name from file path or node properties
          let datastoreName = this.inferDatastoreName(
            filePath,
            node,
            matchedImportPattern
          );
          if (!datastoreName) {
            continue;
          }

          // Normalize to lowercase and replace special chars
          datastoreName = datastoreName.toLowerCase().replace(/[^a-z0-9-]/g, "-");

          // Get or create entry for this datastore
          if (!datastoreSignals.has(datastoreName)) {
            datastoreSignals.set(datastoreName, []);
          }

          const signals = datastoreSignals.get(datastoreName)!;

          // Convert file path to relative
          let relativeFile = filePath;
          if (filePath && projectRoot) {
            try {
              relativeFile = path.relative(projectRoot, filePath);
            } catch {
              // Keep absolute if relative fails
            }
          }

          // Add signal for this source file
          signals.push({
            sourceFile: relativeFile,
            importPattern: matchedImportPattern,
            functionPatterns: matchedIndicators,
          });
        }
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
        const inferredFromMapEntries = Array.from(inferredFromMap.entries());
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

      return candidates;
    } finally {
      client.close();
    }
  }

  /**
   * Infer a datastore name from file path, node properties, or import pattern
   *
   * @private
   */
  private inferDatastoreName(
    filePath: string,
    node: CbmGraphNode,
    matchedPattern?: string
  ): string | undefined {
    // Try to extract from import pattern (e.g., "mongodb" from pattern)
    if (matchedPattern) {
      // Extract database name from pattern like "mongodb", "pg", etc.
      const match = matchedPattern.match(/[a-z]+/i);
      if (match) {
        return match[0];
      }
    }

    // Try to extract from file name (e.g., "users.migration.ts" -> "users")
    const fileName = path.basename(filePath);
    if (fileName.includes("migration") || fileName.includes("schema")) {
      const match = fileName.match(/^([a-z0-9_-]+)/i);
      if (match && match[1]) {
        return match[1];
      }
    }

    // Try to extract from node name or label
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
   * Delegates to trace_call_path MCP tool with direction="backward" to find
   * all functions that call the specified qualified name. Applies depth clamping
   * (default 3, max 10) and transforms CBM response nodes into CallGraphNode objects
   * using edge-type mappings from the analyzer.
   *
   * @param projectRoot Absolute path to the project root
   * @param qualifiedName Fully qualified symbol name (e.g., "com.example.UserService.getUser")
   * @param depth Maximum traversal depth (default 3, clamped to max 10)
   * @returns Array of callers in the call graph
   * @throws CLIError if project not indexed or analyzer not installed
   */
  async callers(
    projectRoot: string,
    qualifiedName: string,
    depth?: number
  ): Promise<CallGraphNode[]> {
    return this.traceCallPath(projectRoot, qualifiedName, depth, "backward");
  }

  /**
   * Query for callees of a specific function or symbol
   *
   * Delegates to trace_call_path MCP tool with direction="forward" to find
   * all functions called by the specified qualified name. Applies depth clamping
   * (default 3, max 10) and transforms CBM response nodes into CallGraphNode objects
   * using edge-type mappings from the analyzer.
   *
   * @param projectRoot Absolute path to the project root
   * @param qualifiedName Fully qualified symbol name (e.g., "com.example.UserService.getUser")
   * @param depth Maximum traversal depth (default 3, clamped to max 10)
   * @returns Array of callees in the call graph
   * @throws CLIError if project not indexed or analyzer not installed
   */
  async callees(
    projectRoot: string,
    qualifiedName: string,
    depth?: number
  ): Promise<CallGraphNode[]> {
    return this.traceCallPath(projectRoot, qualifiedName, depth, "forward");
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
    direction: "forward" | "backward"
  ): Promise<CallGraphNode[]> {
    // Check that the project is indexed (same pre-flight checks as endpoints)
    const status = await this.status(projectRoot);
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
    if (!detection.installed || !detection.binary_path) {
      throw new CLIError(
        "CBM analyzer not installed",
        ErrorCategory.NOT_FOUND,
        ["Install codebase-memory-mcp: npm install -g codebase-memory-mcp"]
      );
    }

    // Clamp depth: default 3, max 10
    const clampedDepth = Math.min(depth ?? 3, 10);

    const client = new StdioClient();

    try {
      client.spawn(detection.binary_path);

      const version = await getCliVersion();
      await client.initialize({
        name: "dr-cli",
        version,
      });

      // Call trace_call_path with the clamped depth
      const traceResponse = (await client.callTool("trace_call_path", {
        qualified_name: qualifiedName,
        direction,
        depth: clampedDepth,
        project: projectRoot,
      })) as {
        nodes?: Array<{
          id: string;
          qualified_name?: string;
          source_file?: string;
          source_symbol?: string;
          file_path?: string;
          depth?: number;
          [key: string]: unknown;
        }>;
        edges?: Array<{
          from_node: string;
          to_node: string;
          type?: string;
          [key: string]: unknown;
        }>;
        [key: string]: unknown;
      };

      // Validate response structure
      if (!traceResponse || typeof traceResponse !== "object") {
        throw new CLIError(
          "Invalid response from trace_call_path",
          ErrorCategory.SYSTEM,
          ["Ensure codebase-memory-mcp is properly installed and functional"]
        );
      }

      const nodes = Array.isArray(traceResponse.nodes)
        ? (traceResponse.nodes as Array<{
            id: string;
            qualified_name?: string;
            source_file?: string;
            source_symbol?: string;
            file_path?: string;
            depth?: number;
            [key: string]: unknown;
          }>)
        : [];

      const edges = Array.isArray(traceResponse.edges)
        ? (traceResponse.edges as Array<{
            from_node: string;
            to_node: string;
            type?: string;
            [key: string]: unknown;
          }>)
        : [];

      // Get valid edge types from the mapping loader (don't hardcode)
      const validEdgeTypes = this.mapper.getEdgeTypes();
      const defaultEdgeType =
        validEdgeTypes.length > 0 ? validEdgeTypes[0] : "CALLS";

      // Transform nodes to CallGraphNode objects
      const callGraphNodes: CallGraphNode[] = [];

      for (const node of nodes) {
        // Extract qualified name from node
        const nodeQualifiedName = node.qualified_name || node.id;

        // Extract source file (relative to project root)
        let sourceFile = node.file_path || node.source_file || "";
        if (sourceFile && projectRoot) {
          try {
            sourceFile = path.relative(projectRoot, sourceFile);
          } catch {
            // If relative path fails, keep absolute
          }
        }

        // Extract source symbol
        const sourceSymbol = node.source_symbol || node.id || "";

        // Extract depth (default 0 if not provided)
        const nodeDepth = typeof node.depth === "number" ? node.depth : 0;

        // Determine edge type by finding the edge that connects to this node
        // For depth 0 (root), look for edges from root to this node
        // For depth > 0, look for edges from any parent to this node
        let edgeType = defaultEdgeType;
        if (nodeDepth > 0) {
          // Find the incoming edge to this node
          const incomingEdge = edges.find(
            (edge) => edge.to_node === nodeQualifiedName
          );
          if (incomingEdge && incomingEdge.type) {
            // Validate that this edge type is in our valid types
            if (validEdgeTypes.includes(incomingEdge.type)) {
              edgeType = incomingEdge.type;
            }
          }
        }

        callGraphNodes.push({
          qualified_name: nodeQualifiedName,
          source_file: sourceFile,
          source_symbol: sourceSymbol,
          depth: nodeDepth,
          edge_type: edgeType as "CALLS" | "HTTP_CALLS" | "HANDLES",
        });
      }

      return callGraphNodes;
    } finally {
      client.close();
    }
  }

  /**
   * Verify that graph-discovered routes align with model endpoints (stub - not yet implemented)
   *
   * @param _projectRoot Absolute path to the project root
   * @param _options Verification options
   * @returns Placeholder stub response
   */
  async verify(
    _projectRoot: string,
    _options: VerifyOptions
  ): Promise<VerifyReport> {
    throw new Error("not implemented");
  }
}
