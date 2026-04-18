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
} from "./types.js";
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

  constructor(mapper: MappingLoader) {
    this.mapper = mapper;
  }

  /**
   * Check if the MCP server is registered in .mcp.json
   *
   * Reads .mcp.json from the project root and checks if the analyzer's MCP server
   * is registered there. This is extracted into a separate method for easier testing.
   *
   * @returns True if the MCP server is registered, false otherwise
   */
  async checkMcpRegistration(): Promise<boolean> {
    try {
      const mcpJsonPath = path.join(process.cwd(), ".mcp.json");
      const mcpContent = await readFile(mcpJsonPath, "utf-8");
      const mcpConfig = JSON.parse(mcpContent);
      const metadata = this.mapper.getAnalyzerMetadata();
      const mcpServerName = metadata?.mcp_server_name ?? "codebase-memory-mcp";
      // Check if the analyzer's MCP server is registered in .mcp.json
      return (mcpConfig.mcpServers && mcpServerName in mcpConfig.mcpServers) || false;
    } catch {
      // .mcp.json not found or not valid JSON - that's OK, not an error
      return false;
    }
  }

  /**
   * Detect if the analyzer is installed and functional
   *
   * Checks for the presence of the analyzer binary, reads .mcp.json for registration info,
   * and validates the required tool contract by calling initialize.
   *
   * @returns Detection result with binary path, version, and MCP registration status
   */
  async detect(): Promise<DetectionResult> {
    // Get binary names from the analyzer metadata
    const metadata = this.mapper.getAnalyzerMetadata();
    const binaryNames = (metadata?.binary_names as string[] | undefined) ?? [
      "codebase-memory-mcp",
    ];

    // Check if .mcp.json exists at project root for registration status
    const mcpRegistered = await this.checkMcpRegistration();

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
    const detected = await this.detect();

    // Read index metadata if it exists
    const indexMeta = await readIndexMeta(projectRoot);

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
      }
    } catch (error) {
      // If git fails, assume not fresh
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
        node_count: meta.node_count ?? 0,
        edge_count: meta.edge_count ?? 0,
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

      // The CBM server handles idempotency via project path matching,
      // so we don't need to check list_projects before indexing

      // Index the repository
      const indexResponse = (await client.callTool("index_repository", {
        repo_path: projectRoot,
      })) as {
        node_count?: number;
        edge_count?: number;
        [key: string]: unknown;
      };

      // Get current git HEAD
      const headResult = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf-8",
      });

      const gitHead =
        headResult.status === 0 ? headResult.stdout.trim() : "unknown";

      const timestamp = new Date().toISOString();
      const nodeCount = (indexResponse.node_count as number) ?? 0;
      const edgeCount = (indexResponse.edge_count as number) ?? 0;

      // Write index metadata
      const meta: IndexMeta = {
        git_head: gitHead,
        timestamp,
        node_count: nodeCount,
        edge_count: edgeCount,
      };

      await writeIndexMeta(meta, projectRoot);

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
          "Run `dr analyze index` to index the project",
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
        project_root: projectRoot,
      })) as {
        nodes?: CbmGraphNode[];
        [key: string]: unknown;
      };

      const nodes = (searchResponse.nodes as CbmGraphNode[]) ?? [];

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
   * @param _projectRoot Absolute path to the project root (not yet used)
   * @param _rawQuery Query string in the analyzer's native language (not yet used)
   * @throws CLIError indicating not yet implemented
   */
  async query(_projectRoot: string, _rawQuery: string): Promise<unknown> {
    throw new CLIError(
      "Raw graph queries are not yet implemented",
      ErrorCategory.USER,
      [
        "The query command is planned for a future release",
        "Currently, use endpoints(), index(), and detect() for analysis",
      ]
    );
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

    // Required fields for dr add api operation
    const httpMethod = String(properties.method ?? "GET").toUpperCase();
    const httpPath = String(properties.path ?? "/");

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
      http_method: httpMethod,
      http_path: httpPath,
      handler_qualified_name: handlerQualifiedName,
      source_symbol: sourceSymbol,
      source_start_line: sourceStartLine,
      source_end_line: sourceEndLine,
    };
  }


  /**
   * Check if an endpoint candidate is in test code
   *
   * Applies the test_code_exclusion filtering rule from the analyzer mapping.
   *
   * @private
   */
  private isTestCode(candidate: EndpointCandidate): boolean {
    // Apply test code exclusion rule: filter out test files
    const testPatterns = [
      /\.test\./,
      /\.spec\./,
      /\/tests?\//,
      /\/__tests__\//,
      /\/test-/,
    ];

    return testPatterns.some((pattern) =>
      pattern.test(candidate.source_file)
    );
  }
}
