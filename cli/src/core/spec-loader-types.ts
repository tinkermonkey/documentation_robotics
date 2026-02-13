/**
 * Type definitions for SpecDataLoader
 *
 * These types represent the specification metadata structure loaded from
 * spec/schemas/ directory. They are separate from the CLI's architecture model types.
 */

import type { Directionality } from "./relationship-catalog.js";

/**
 * Layer specification metadata
 */
export interface LayerSpec {
  id: string;
  number: number;
  name: string;
  description: string;
  inspired_by?: {
    standard: string;
    version: string;
    url?: string;
  };
  node_types: string[];
}

/**
 * Attribute specification for a node type
 */
export interface AttributeSpec {
  name: string;
  type: string;
  format?: string;
  required: boolean;
  description?: string;
}

/**
 * Node type specification metadata
 */
export interface NodeTypeSpec {
  spec_node_id: string;
  layer_id: string;
  type: string;
  title: string;
  description: string;
  attributes: AttributeSpec[];
  // Full JSON Schema kept for advanced use cases
  schema?: Record<string, unknown>;
}

/**
 * Relationship type specification metadata
 */
export interface RelationshipTypeSpec {
  id: string;
  source_spec_node_id: string;
  source_layer: string;
  destination_spec_node_id: string;
  destination_layer: string;
  predicate: string;
  cardinality: string;
  strength: string;
  required?: boolean;
}

/**
 * Semantic predicate definition
 */
export interface PredicateSpec {
  predicate: string;
  inverse: string;
  category: string;
  description: string;
  archimate_alignment: string | null;
  semantics: {
    directionality: Directionality;
    transitivity: boolean;
    symmetry: boolean;
    reflexivity?: boolean;
  };
}

/**
 * Complete specification data structure
 */
export interface SpecData {
  layers: LayerSpec[];
  nodeTypes: NodeTypeSpec[];
  relationshipTypes: RelationshipTypeSpec[];
  predicates: Map<string, PredicateSpec>;
}

/**
 * Statistics about loaded specification
 */
export interface SpecStatistics {
  layerCount: number;
  nodeTypeCount: number;
  relationshipTypeCount: number;
  predicateCount: number;
  totalAttributes: number;
  loadedAt: Date;
}

/**
 * Options for SpecDataLoader
 */
export interface SpecLoaderOptions {
  /**
   * Path to spec directory (defaults to spec/ relative to package root)
   */
  specDir?: string;

  /**
   * Whether to include full JSON schemas in loaded data (default: false)
   */
  includeSchemas?: boolean;

  /**
   * Whether to cache loaded data (default: true)
   */
  cache?: boolean;
}

/**
 * Query filters for finding node types
 */
export interface NodeTypeQueryFilter {
  layer?: string;
  type?: string;
  specNodeId?: string;
  title?: string;
}

/**
 * Query filters for finding relationship types
 */
export interface RelationshipTypeQueryFilter {
  sourceLayer?: string;
  sourceSpecNodeId?: string;
  destinationLayer?: string;
  destinationSpecNodeId?: string;
  predicate?: string;
}
