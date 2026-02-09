/**
 * Graph Representation Mapping Layer
 *
 * This module provides utilities for mapping between different graph representations
 * with inconsistent field naming. It documents and standardizes the mapping between:
 *
 * 1. GraphNode/GraphEdge - Internal representation (graph-model.ts)
 * 2. MigrationGraphNode/MigrationGraphEdge - Export format (graph-migration.ts)
 * 3. Element/Relationship/Reference - Core types (types/index.ts)
 *
 * CURRENT STATUS: This module serves as foundational infrastructure documenting
 * field naming inconsistencies (Issue #11 from PR #324). The utilities are available
 * for use by export handlers and migration code, but are currently referenced
 * (not actively used) as a foundation for future refactoring phases.
 *
 * See: cli/src/export/model-migration.ts (references this module)
 *
 * FIELD NAMING INCONSISTENCIES:
 * - Edge destination: GraphEdge.destination vs MigrationGraphEdge.target vs Relationship.target
 * - Edge type: GraphEdge.predicate vs MigrationGraphEdge.relationship
 * - Node type: GraphNode.type vs MigrationGraphNode.labels[] (array vs single value)
 */

import type { GraphNode, GraphEdge } from "./graph-model.js";
import type { MigrationGraphNode, MigrationGraphEdge } from "../export/graph-migration.js";
import type { Relationship, Reference } from "../types/index.js";

/**
 * Unified edge representation that abstracts away naming differences
 * Internal use only - converts between different representations
 */
export interface UnifiedEdge {
  id: string;
  source: string;
  destination: string; // Standard name for target node
  type: string; // Standard name for edge type/predicate/relationship
  properties?: Record<string, unknown>;
  category?: "structural" | "behavioral";
}

/**
 * Convert GraphEdge (internal representation) to UnifiedEdge
 * GraphEdge uses: source, destination, predicate
 */
export function graphEdgeToUnified(edge: GraphEdge): UnifiedEdge {
  return {
    id: edge.id,
    source: edge.source,
    destination: edge.destination,
    type: edge.predicate,
    properties: edge.properties,
    category: edge.category,
  };
}

/**
 * Convert UnifiedEdge back to GraphEdge
 */
export function unifiedToGraphEdge(unified: UnifiedEdge): GraphEdge {
  return {
    id: unified.id,
    source: unified.source,
    destination: unified.destination,
    predicate: unified.type,
    properties: unified.properties,
    category: unified.category,
  };
}

/**
 * Convert MigrationGraphEdge to UnifiedEdge
 * MigrationGraphEdge uses: source, target, relationship
 */
export function migrationEdgeToUnified(edge: MigrationGraphEdge): UnifiedEdge {
  return {
    id: edge.id,
    source: edge.source,
    destination: edge.target,
    type: edge.relationship,
    properties: edge.properties,
  };
}

/**
 * Convert UnifiedEdge to MigrationGraphEdge
 */
export function unifiedToMigrationEdge(unified: UnifiedEdge): MigrationGraphEdge {
  return {
    id: unified.id,
    source: unified.source,
    target: unified.destination,
    relationship: unified.type,
    properties: unified.properties,
  };
}

/**
 * Convert Relationship (core type) to UnifiedEdge
 * Relationship uses: source, target, predicate
 */
export function relationshipToUnified(rel: Relationship, edgeId: string): UnifiedEdge {
  return {
    id: edgeId,
    source: rel.source,
    destination: rel.target,
    type: rel.predicate,
    properties: rel.properties,
  };
}

/**
 * Convert Reference (core type) to UnifiedEdge
 * Reference uses: source, target, type (for reference type)
 */
export function referenceToUnified(ref: Reference, edgeId: string): UnifiedEdge {
  return {
    id: edgeId,
    source: ref.source,
    destination: ref.target,
    type: `REFERENCES_${ref.type.toUpperCase()}`,
    properties: ref.description ? { description: ref.description } : undefined,
  };
}

/**
 * NAMING REFERENCE GUIDE
 *
 * Use this table when converting between representations:
 *
 * Field        | GraphNode/GraphEdge | MigrationGraph* | Core Types
 * -------------|-------------------|-----------------|--------------------
 * Source       | source            | source          | source
 * Destination  | destination       | target          | target
 * Type/Pred    | predicate         | relationship    | predicate/type
 * Node Type    | type (string)     | labels (array)  | type (string)
 *
 * CONVERSION EXAMPLES:
 *
 * 1. GraphEdge → MigrationGraphEdge:
 *    - destination → target
 *    - predicate → relationship
 *
 * 2. MigrationGraphNode → GraphNode:
 *    - labels[1] → type (use last label for element type)
 *    - Keep: id, properties
 *    - Add: layer (from labels[0]), name, description
 *
 * 3. Relationship → GraphEdge:
 *    - target → destination
 *    - predicate → predicate (same)
 *
 * 4. Reference → GraphEdge:
 *    - target → destination
 *    - type → used in relationship format
 */

/**
 * Safe field accessor that works across different representations
 * Returns the destination field regardless of representation type
 */
export function getEdgeDestination(edge: GraphEdge | MigrationGraphEdge): string {
  if ("destination" in edge) {
    return (edge as GraphEdge).destination;
  }
  if ("target" in edge) {
    return (edge as MigrationGraphEdge).target;
  }
  throw new Error("Invalid edge representation: no destination or target field");
}

/**
 * Safe field accessor for edge type/predicate/relationship
 */
export function getEdgeType(edge: GraphEdge | MigrationGraphEdge): string {
  if ("predicate" in edge) {
    return (edge as GraphEdge).predicate;
  }
  if ("relationship" in edge) {
    return (edge as MigrationGraphEdge).relationship;
  }
  throw new Error("Invalid edge representation: no predicate or relationship field");
}

/**
 * Safe field accessor for node type
 * GraphNode has type: string
 * MigrationGraphNode has labels: string[]
 */
export function getNodeType(node: GraphNode | MigrationGraphNode): string {
  if ("type" in node) {
    return (node as GraphNode).type;
  }
  if ("labels" in node && Array.isArray((node as MigrationGraphNode).labels)) {
    const labels = (node as MigrationGraphNode).labels;
    // Return the last label (typically the specific type, not the layer)
    return labels[labels.length - 1] || "Unknown";
  }
  throw new Error("Invalid node representation: no type or labels field");
}

/**
 * IMPLEMENTATION NOTES:
 *
 * This layer exists to prevent the current field naming inconsistencies from
 * cascading through the codebase. Instead of refactoring all existing code,
 * we document the mappings and provide safe accessors.
 *
 * Future refactoring should consider:
 * 1. Standardizing on "target" for all edge destinations
 * 2. Standardizing on "type" or "predicate" for edge types
 * 3. Using a consistent representation throughout the codebase
 * 4. Adding strict type checking to catch field access errors
 *
 * DEPRECATION PATH:
 * - Add GraphQL-style aliases to interfaces (TypeScript only)
 * - Gradually migrate code to use standardized names
 * - Update tests to use UnifiedEdge for assertions
 * - Remove old field names in a major version bump
 */
