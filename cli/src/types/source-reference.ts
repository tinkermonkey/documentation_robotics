/**
 * Source Reference Type Definitions
 *
 * TypeScript interfaces for linking architecture elements to source code locations.
 * These types correspond to the JSON Schema definitions in spec/schemas/common/source-references.schema.json
 */

/**
 * How the source reference was created
 */
export type ProvenanceType = "extracted" | "manual" | "inferred" | "generated";

/**
 * Location of source code implementing this element
 */
export interface SourceLocation {
  /** Relative path from repository root using forward slashes */
  file: string;
  /** Optional symbol name (class, function, variable) */
  symbol?: string;
}

/**
 * Git repository context for source reference
 */
export interface RepositoryContext {
  /** Git remote URL */
  url?: string;
  /** Full 40-character commit SHA */
  commit?: string;
}

/**
 * Complete source reference linking element to implementation
 */
export interface SourceReference {
  /** How this reference was created */
  provenance: ProvenanceType;
  /** One or more source file locations */
  locations: SourceLocation[];
  /** Optional repository context */
  repository?: RepositoryContext;
}
