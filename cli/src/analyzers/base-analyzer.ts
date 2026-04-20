/**
 * AnalyzerBackend interface
 *
 * Contract for all analyzer implementations. Each backend handles:
 * - Detection of analyzer binaries and MCP registration
 * - Project indexing and freshness tracking
 * - Querying the analyzer for specific evidence (endpoints, services, etc.)
 *
 * This is a pure TypeScript interface (not an abstract class) because
 * each analyzer has wholly different detection and protocol logic.
 */

import type {
  AnalyzerStatus,
  DetectionResult,
  EndpointCandidate,
  IndexResult,
  ServiceCandidate,
  DatastoreCandidate,
  CallGraphNode,
  VerifyOptions,
  VerifyReport,
} from "./types.js";

export interface AnalyzerBackend {
  /**
   * Unique identifier for this analyzer
   */
  readonly name: string;

  /**
   * Human-readable display name for this analyzer
   */
  readonly displayName: string;

  /**
   * Check if the analyzer is installed and functional
   *
   * @param projectRoot Optional absolute path to the project root (for MCP registration check)
   * @returns Detection result with binary path, version, and MCP registration status
   */
  detect(projectRoot?: string): Promise<DetectionResult>;

  /**
   * Get the current status of the analyzer for a project
   *
   * @param projectRoot Absolute path to the project root
   * @returns Current status including detection, index state, and freshness
   */
  status(projectRoot: string): Promise<AnalyzerStatus>;

  /**
   * Index a project or update the index
   *
   * @param projectRoot Absolute path to the project root
   * @param options Optional configuration
   * @returns Index result with counts and metadata
   */
  index(
    projectRoot: string,
    options?: { force?: boolean }
  ): Promise<IndexResult>;

  /**
   * Query for API endpoints/routes in the indexed project
   *
   * @param projectRoot Absolute path to the project root
   * @returns Array of endpoint candidates with confidence and source info
   */
  endpoints(projectRoot: string): Promise<EndpointCandidate[]>;

  /**
   * Execute a raw query against the analyzer's graph
   *
   * The query format is analyzer-specific (Cypher for CBM, GraphQL for others, etc.)
   * The backend interprets the language based on its capabilities.
   *
   * @param projectRoot Absolute path to the project root
   * @param rawQuery Query string in the analyzer's native language
   * @returns Query results (structure depends on analyzer)
   */
  query(projectRoot: string, rawQuery: string): Promise<unknown>;

  /**
   * Query for services/components in the indexed project
   *
   * @param projectRoot Absolute path to the project root
   * @returns Array of service candidates with confidence and heuristic evidence
   */
  services(projectRoot: string): Promise<ServiceCandidate[]>;

  /**
   * Query for datastores/databases inferred from code analysis
   *
   * @param projectRoot Absolute path to the project root
   * @returns Array of datastore candidates with inference evidence
   */
  datastores(projectRoot: string): Promise<DatastoreCandidate[]>;

  /**
   * Query for callers of a specific function or symbol
   *
   * @param projectRoot Absolute path to the project root
   * @param symbol Fully qualified symbol name to find callers of
   * @param depth Maximum depth for call graph traversal (default: 3, max: 10)
   * @returns Array of call graph nodes representing callers
   */
  callers(
    projectRoot: string,
    symbol: string,
    depth?: number
  ): Promise<CallGraphNode[]>;

  /**
   * Query for callees of a specific function or symbol
   *
   * @param projectRoot Absolute path to the project root
   * @param symbol Fully qualified symbol name to find callees of
   * @param depth Maximum depth for call graph traversal (default: 3, max: 10)
   * @returns Array of call graph nodes representing callees
   */
  callees(
    projectRoot: string,
    symbol: string,
    depth?: number
  ): Promise<CallGraphNode[]>;

  /**
   * Verify that graph-discovered routes align with model endpoints
   *
   * Compares routes found by analyzer with API operations defined in the model,
   * producing buckets of matched, in_graph_only, in_model_only, and ignored entries.
   *
   * @param projectRoot Absolute path to the project root
   * @param options Verification options (layer filtering, changeset awareness, ignore file)
   * @returns Detailed verification report with buckets and summary statistics
   */
  verify(projectRoot: string, options: VerifyOptions): Promise<VerifyReport>;
}
