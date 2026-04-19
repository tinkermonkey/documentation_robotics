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
}
