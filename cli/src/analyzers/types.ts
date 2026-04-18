/**
 * Shared types for analyzer adapters
 *
 * These types define the contract between:
 * - The analyzer backend implementations
 * - The registry and commands
 * - The mapping loader
 */

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
 * An API endpoint candidate discovered from code analysis
 * 13 fields as specified in FR-4.3
 */
export interface EndpointCandidate {
  /** Relative path from project root */
  source_file: string;
  /** Confidence in the detection */
  confidence: ConfidenceLevel;
  /** Suggested fragment for element ID (kebab-case) */
  suggested_id_fragment: string;
  /** Operation ID from the code */
  operationId: string;
  /** One-line summary (e.g., "GET /users/{id}") */
  summary: string;
  /** Longer description if available */
  description?: string;
  /** Tags/categories for the endpoint */
  tags?: string[];
  /** HTTP method if applicable */
  method?: string;
  /** URL path or resource identifier */
  path?: string;
  /** Parameters (query, path, header) */
  parameters?: Record<string, unknown>;
  /** Request body schema if applicable */
  request_body?: Record<string, unknown>;
  /** Response schemas by status code */
  responses?: Record<string, unknown>;
  /** Security requirements */
  security?: Record<string, unknown>;
}

/**
 * Index metadata - tracks when a project was indexed and freshness
 */
export interface IndexMeta {
  git_head: string;
  timestamp: string;
  node_count?: number;
  edge_count?: number;
}

/**
 * Result of an index operation
 */
export interface IndexResult {
  success: boolean;
  node_count: number;
  edge_count: number;
  git_head: string;
  timestamp: string;
}

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
 * Discovery result - list of available analyzers and selection
 */
export interface DiscoveryResult {
  found: Array<{
    name: string;
    display_name: string;
    description: string;
    homepage: string;
    version: string;
    installed: boolean;
  }>;
  selected?: string;
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

/**
 * Inference rule for mapping transformations
 */
export interface InferenceRule {
  name: string;
  description: string;
  pattern: string;
  confidence: ConfidenceLevel;
  enabled: boolean;
}
