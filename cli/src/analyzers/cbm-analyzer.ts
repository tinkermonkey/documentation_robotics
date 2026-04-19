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
  HttpMethod,
} from "./types.js";
import { VALID_HTTP_METHODS } from "./types.js";
import { StdioClient } from "./stdio-client.js";
import { readIndexMeta, writeIndexMeta } from "./session-state.js";
import type { MappingLoader } from "./mapping-loader.js";
import { getCliVersion } from "./version.js";

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
   * and validates the required tool contract by calling initialize.
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

        // Successfully initialized
        return {
          installed: true,
          binary_path: binaryPath,
          version: undefined, // Version could be extracted from --version if needed
          mcp_registered: mcpRegistered,
          contract_ok: true,
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

      // Prevent re-indexing unless forced (mirroring freshness gate pattern)
      if (projectExists && !options?.force) {
        handleWarning(
          "Project already indexed in CBM backend.",
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
   * Execute a raw query against the analyzer's graph (stub - not yet implemented)
   *
   * Returns a defined placeholder stub response per FR-5.2. The feature is planned for
   * a future release and currently returns empty results rather than throwing an exception.
   *
   * @param _projectRoot Absolute path to the project root (not yet used)
   * @param _rawQuery Query string in the analyzer's native language (not yet used)
   * @returns Placeholder stub response with empty results
   */
  async query(_projectRoot: string, _rawQuery: string): Promise<unknown> {
    return {
      results: [],
      message: "Raw graph queries are not yet implemented",
      suggestion: "Use endpoints(), index(), or detect() for analysis",
    };
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
    // Validate that method is a string before using it, cast to HttpMethod
    const rawMethod =
      typeof properties.method === "string"
        ? properties.method.toUpperCase()
        : "GET";
    // Validate against valid HTTP methods using the constant
    const validMethods = new Set(VALID_HTTP_METHODS);
    const httpMethod: HttpMethod = validMethods.has(rawMethod as HttpMethod)
      ? (rawMethod as HttpMethod)
      : "GET";

    // Validate that path is a string before using it
    const httpPath =
      typeof properties.path === "string" ? properties.path : "/";

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
   * Check if an endpoint candidate is in test code
   *
   * Applies the test_code_exclusion filtering rule from the analyzer mapping.
   * If the configured regex pattern is invalid, warns the user once and falls back to defaults.
   * Uses a one-shot flag to ensure the warning is only emitted once even if called in a loop.
   *
   * @private
   */
  private isTestCode(candidate: EndpointCandidate): boolean {
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
}
