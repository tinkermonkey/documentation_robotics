/**
 * Core type definitions for Documentation Robotics CLI
 */

// Export source reference types
export type { ProvenanceType, SourceLocation, RepositoryContext, SourceReference } from './source-reference.js';

/**
 * Reference across layers
 */
export interface Reference {
  source: string; // Element ID
  target: string; // Element ID
  type: string; // Reference type
  description?: string;
}

/**
 * Intra-layer relationship
 */
export interface Relationship {
  source: string;
  target: string;
  predicate: string; // e.g., "depends-on", "implements"
  properties?: Record<string, unknown>;
}


/**
 * Element representation
 */
export interface Element {
  id: string; // Format: {layer}-{type}-{kebab-case-name}
  type: string;
  name: string;
  description?: string;
  properties?: Record<string, unknown>;
  references?: Reference[];
  relationships?: Relationship[];
}

/**
 * Layer container
 */
export interface LayerData {
  elements: Element[];
  metadata?: {
    layer: string;
    version: string;
  };
}

/**
 * Manifest metadata
 */
export interface ManifestData {
  name: string;
  version: string;
  description?: string;
  author?: string;
  created?: string;
  modified?: string;
  specVersion?: string;
}

/**
 * Model options for customization
 */
export interface ModelOptions {
  enableCache?: boolean;
  lazyLoad?: boolean;
  referenceRegistry?: unknown; // Will be properly typed when implemented
}

/**
 * Backup manifest entry for a single file
 */
export interface BackupManifestFile {
  path: string;        // Relative path to the file in the backup directory
  checksum: string;    // SHA256 hash of the file contents
  size: number;        // File size in bytes
}

/**
 * Backup manifest tracking files and creation timestamp
 * Used for backup integrity validation and recovery
 */
export interface BackupManifest {
  files: BackupManifestFile[];  // Array of backed up files with metadata
  timestamp: string;             // ISO 8601 timestamp when backup was created
}
