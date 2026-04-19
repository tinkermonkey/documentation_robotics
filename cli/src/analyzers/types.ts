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
 */
export interface DetectionResult {
  installed: boolean;
  binary_path?: string;
  version?: string;
  mcp_registered?: boolean;
  contract_ok?: boolean;
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
 * Alias for IndexMeta - same structure with identical required fields
 */
export type IndexResult = IndexMeta;

/**
 * Current status of an analyzer for a project
 */
export interface AnalyzerStatus {
  detected: DetectionResult;
  indexed: boolean;
  index_meta?: IndexMeta;
  fresh: boolean;
  last_indexed?: string;
}

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
  parameters?: Record<string, unknown>;
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
