/**
 * Shared types for analyzer adapters
 *
 * These types define the contract between:
 * - The analyzer backend implementations
 * - The registry and commands
 * - The mapping loader
 */

import type { SourceReference } from "../types/source-reference.js";

/**
 * Binary detection result - whether an analyzer is installed and functional
 * Discriminated union on `installed` field to make binary_path required when installed
 */
export type DetectionResult =
  | {
      installed: true;
      binary_path: string;
      version?: string;
      mcp_registered?: boolean;
      contract_ok?: boolean;
    }
  | {
      installed: false;
      binary_path?: never;
      version?: never;
      mcp_registered?: never;
      contract_ok?: never;
    };

/**
 * Information about an available analyzer
 * Used in discovery results to report analyzer availability and installation status
 */
export interface AvailableAnalyzer {
  name: string;
  display_name: string;
  description: string;
  homepage: string;
  installed: boolean;
}

/**
 * Result of analyzer discovery
 * Lists all available analyzers and their installation status
 */
export interface DiscoveryResult {
  found: AvailableAnalyzer[];
  installed_count: number;
  selected?: string | null;
}

/**
 * Confidence level for mappings and detections
 */
export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * Valid HTTP methods - single source of truth for both type and runtime validation
 */
export const VALID_HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
] as const;

/**
 * Heuristic parameters - shape depends on heuristic type
 * Known parameter types:
 * - min_fan_in: { threshold: number }
 * - directory_match: { patterns: string[] }
 * - naming_patterns: { service_suffixes: string[] }
 * - class_is_service: { threshold: number }
 * - service_class_naming: { service_method_prefixes: string[] }
 * - is_entry_point: { entry_point_patterns: string[] }
 * - infer_datastores: { patterns: string[], naming_indicators: string[] }
 */
export interface HeuristicParameters {
  threshold?: number;
  patterns?: string[];
  service_suffixes?: string[];
  service_method_prefixes?: string[];
  entry_point_patterns?: string[];
  naming_indicators?: string[];
  [key: string]: unknown;
}

// TODO: MappingConditions currently remain untyped as Record<string, unknown> because the
// mapping schema defines conditions as a flexible object without known fields. If specific
// condition properties are identified in future mapping iterations, define them here.

/**
 * HTTP method type derived from VALID_HTTP_METHODS constant
 */
export type HttpMethod = (typeof VALID_HTTP_METHODS)[number];

/**
 * An API endpoint candidate discovered from code analysis
 * Maps to `dr add api operation` command arguments
 *
 * These 13 fields directly support the downstream extraction workflow:
 * - Layer: api
 * - Element type: operation
 * - Name: constructed from suggested_name
 * - ID fragment: suggested_id_fragment (kebab-case for element ID)
 * - HTTP method/path: required for OpenAPI compliance
 * - Source information: for traceability and provenance
 */
export interface EndpointCandidate {
  /** Relative path from project root */
  source_file: string;
  /** Confidence in the detection (high, medium, low) */
  confidence: ConfidenceLevel;
  /** Suggested DR layer for this endpoint (must be "api") */
  suggested_layer: "api";
  /** Suggested element type for this endpoint (must be "operation") */
  suggested_element_type: "operation";
  /** Suggested kebab-case name for the endpoint */
  suggested_name: string;
  /** Suggested kebab-case ID fragment for constructing element ID */
  suggested_id_fragment: string;
  /** HTTP method (GET, POST, PUT, DELETE, etc.) - REQUIRED */
  http_method: HttpMethod;
  /** HTTP path or resource identifier - REQUIRED */
  http_path: string;
  /** Qualified name of the handler/implementation */
  handler_qualified_name: string;
  /** Source symbol or identifier where handler is defined */
  source_symbol: string;
  /** Starting line number of handler in source file */
  source_start_line: number;
  /** Ending line number of handler in source file */
  source_end_line: number;
  /** Source reference linking this endpoint to its implementation */
  source_reference: SourceReference;
}

/**
 * Index metadata - tracks when a project was indexed and freshness
 */
export interface IndexMeta {
  git_head: string;
  timestamp: string;
  node_count: number;
  edge_count: number;
}

/**
 * Result of an index operation
 * Contains counts and metadata from indexing.
 * Failures are signaled by throwing CLIError, not by success: false.
 */
export interface IndexResult {
  git_head: string;
  timestamp: string;
  node_count: number;
  edge_count: number;
}

/**
 * Current status of an analyzer for a project
 * Discriminated union on `indexed` field to enforce index_meta presence when indexed: true
 */
export type AnalyzerStatus =
  | {
      detected: DetectionResult;
      indexed: true;
      index_meta: IndexMeta;
      fresh: boolean;
      last_indexed?: string;
    }
  | {
      detected: DetectionResult;
      indexed: false;
      index_meta?: never;
      fresh: boolean;
      last_indexed?: string;
    };

/**
 * Session state - tracks which analyzer is currently active
 */
export interface SessionState {
  active_analyzer: string;
  selected_at: string;
}

/**
 * Mapping for a single CBM node label to DR element type
 * Matches the structure in cbm.json nodes_by_label
 */
export interface AnalyzerNodeMapping {
  cbm_label: string;
  dr_layer: string;
  dr_element_type: string;
  confidence: ConfidenceLevel;
  description: string;
  source_reference: {
    provenance: string;
    file: {
      from: string;
    };
    symbol?: {
      from: string;
    };
  };
  dr_element_fields?: Record<
    string,
    {
      name_template?: string;
      template?: string;
      id_source?: string;
      id_transform?: string;
    }
  >;
  verify_role?: string;
  attribute_mappings?: Array<{
    from: string;
    dr_attribute: string;
  }>;
  dr_element_type_promoted?: string;
  promotion_heuristics?: string[];
  evidence_fields?: Record<string, { from: string }>;
  conditions?: Record<string, unknown>;
}

/**
 * Mapping for a single CBM edge type to DR relationship
 * Matches the structure in cbm.json edges_by_type
 */
export interface AnalyzerEdgeMapping {
  cbm_edge: string;
  dr_relationship: string | null;
  confidence: ConfidenceLevel;
  description: string;
  usage: string;
  dr_scope?: string;
  direction?: string;
  confidence_from_property?: string;
  dr_pattern?: string;
  implementation_note?: string;
  conditions?: Record<string, unknown>;
}

/**
 * Single heuristic rule from the mapping
 */
export interface AnalyzerHeuristic {
  name: string;
  description: string;
  applies_to?: string[];
  parameters?: HeuristicParameters;
  rule?: string;
  confidence_adjustment?: number;
  conditions?: Record<string, unknown>;
}

/**
 * Confidence rubric - threshold ranges for confidence levels
 */
export interface ConfidenceRubric {
  high: {
    min: number;
    max: number;
    description: string;
  };
  medium: {
    min: number;
    max: number;
    description: string;
  };
  low: {
    min: number;
    max: number;
    description: string;
  };
}

/**
 * Filtering rule to exclude mappings
 */
export interface FilteringRule {
  name: string;
  description: string;
  filter_type: string;
  threshold?: number;
  pattern?: string;
  enabled: boolean;
}

/**
 * A service candidate discovered from code analysis
 * Maps to `dr add application service` or similar command arguments
 */
export interface ServiceCandidate {
  /** Suggested DR layer for this service (always "application") */
  suggested_layer: "application";
  /** Suggested element type for this service */
  suggested_element_type: "applicationservice" | "applicationcomponent";
  /** Suggested kebab-case ID fragment for constructing element ID */
  suggested_id_fragment: string;
  /** Suggested name for the service */
  suggested_name: string;
  /** Relative path from project root */
  source_file: string;
  /** Source symbol or identifier where service is defined */
  source_symbol: string;
  /** Fully qualified name of the service */
  qualified_name: string;
  /** List of heuristics that qualified this as a service candidate */
  qualifying_heuristics: string[];
  /** Confidence in the detection (medium or low only) */
  confidence: "medium" | "low";
  /** Number of incoming calls/references */
  fan_in: number;
  /** Number of outgoing calls/references */
  fan_out: number;
}

/**
 * A datastore candidate inferred from code analysis
 */
export interface DatastoreCandidate {
  /** Suggested DR layer for this datastore (always "data-store") */
  suggested_layer: "data-store";
  /** Suggested name for the datastore */
  suggested_name: string;
  /** Array of evidence sources for this datastore inference */
  inferred_from: Array<{
    /** Relative path from project root */
    source_file: string;
    /** Pattern used to match imports (e.g., "mongodb", "pg") */
    import_pattern: string;
    /** Array of function/method call patterns that suggest datastore usage */
    function_patterns: string[];
  }>;
  /** Confidence in the detection (always "low") */
  confidence: "low";
  /** Additional notes about the inference */
  notes: string;
}

/**
 * A node in the call graph
 */
export interface CallGraphNode {
  /** Fully qualified name of the node */
  qualified_name: string;
  /** Relative path from project root */
  source_file: string;
  /** Source symbol or identifier */
  source_symbol: string;
  /** Depth in the call graph (0 = root node) */
  depth: number;
  /** Type of edge (CALLS, HTTP_CALLS, HANDLES) */
  edge_type: "CALLS" | "HTTP_CALLS" | "HANDLES";
}

/**
 * Options for the verify operation
 */
export interface VerifyOptions {
  /** Array of layer names to verify (empty = verify all layers) */
  layers?: string[];
  /** Whether to use changeset view if active (default: true) */
  changesetAware?: boolean;
  /** Optional path to custom ignore file */
  ignoreFilePath?: string;
}

/**
 * Entry for a matched route/element in verify report
 */
export interface MatchedEntry {
  /** Identifier for the matched entry */
  id: string;
  /** Type of the entry (e.g., "operation") */
  type: string;
  /** Source file where this entry is located */
  source_file: string;
  /** Source symbol */
  source_symbol: string;
}

/**
 * Entry for routes found in graph but not in model
 */
export interface GraphOnlyEntry {
  /** Identifier for the entry */
  id: string;
  /** HTTP method (GET, POST, etc.) */
  http_method?: string;
  /** HTTP path */
  http_path?: string;
  /** Source file where this route is located */
  source_file: string;
  /** Source symbol */
  source_symbol: string;
}

/**
 * Entry for elements in model but not found in graph
 */
export interface ModelOnlyEntry {
  /** Identifier for the model element */
  id: string;
  /** Type of the element (e.g., "operation") */
  type: string;
  /** Source file referenced in the model */
  source_file: string;
  /** Source symbol referenced in the model */
  source_symbol: string;
}

/**
 * Entry for matches that were ignored by rules
 */
export interface IgnoredEntry {
  /** Identifier for the ignored entry */
  id: string;
  /** Type of the entry (route or element) */
  entry_type: "route" | "element";
  /** Reason for ignoring */
  reason: string;
}

/**
 * Summary statistics for verify report
 */
export interface VerifySummary {
  /** Number of routes matched to model elements */
  matched_count: number;
  /** Number of routes found in graph only (gaps in model) */
  gap_count: number;
  /** Number of elements found in model only (drift from model) */
  drift_count: number;
  /** Number of entries ignored by rules */
  ignored_count: number;
  /** Total graph entries analyzed */
  total_graph_entries: number;
  /** Total model entries analyzed */
  total_model_entries: number;
}

/**
 * Changeset context information in verify report
 * Discriminated union to prevent impossible states like active_changeset: "cs-1" with verified_against: "base_model"
 */
export type VerifyChangesetContext =
  | {
      /** ID of the active changeset */
      active_changeset: string;
      /** Report was verified against changeset view */
      verified_against: "changeset_view";
    }
  | {
      /** No active changeset */
      active_changeset: null;
      /** Report was verified against base model */
      verified_against: "base_model";
    };

/**
 * Buckets of categorized entries from verify operation
 */
export interface VerifyBuckets {
  /** Routes matched to model elements */
  matched: MatchedEntry[];
  /** Routes found in graph only */
  in_graph_only: GraphOnlyEntry[];
  /** Elements in model only */
  in_model_only: ModelOnlyEntry[];
  /** Entries ignored by rules */
  ignored: IgnoredEntry[];
}

/**
 * Detailed verification report for a project
 *
 * This is a public API contract consumed by /dr-verify Claude Code command.
 * Treat as stable from issue #654 forward.
 */
export interface VerifyReport {
  /** ISO 8601 timestamp when report was generated */
  generated_at: string;
  /** Absolute path to the project root */
  project_root: string;
  /** Name of the analyzer used */
  analyzer: string;
  /** ISO 8601 timestamp when analyzer was indexed */
  analyzer_indexed_at: string;
  /** Changeset context information */
  changeset_context: VerifyChangesetContext;
  /** Array of layer names that were verified */
  layers_verified: string[];
  /** Buckets of categorized entries */
  buckets: VerifyBuckets;
  /** Summary statistics */
  summary: VerifySummary;
}
