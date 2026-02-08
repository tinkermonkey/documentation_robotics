import type { Model } from "../core/model.js";

/**
 * Options for import operations
 */
export interface ImportOptions {
  mergeStrategy?: 'add' | 'update' | 'skip';  // How to handle existing elements
  validateSchema?: boolean;                     // Validate against JSON schema
}

/**
 * Result of an import operation
 */
export interface ImportResult {
  success: boolean;
  nodesAdded: number;
  edgesAdded: number;
  errorsCount: number;
  errors: Array<{ message: string; element?: string }>;
}

/**
 * Interface for format-specific importers
 */
export interface Importer {
  /** Display name of the importer */
  name: string;

  /** Supported import formats */
  supportedFormats: string[];

  /**
   * Import data into model
   */
  import(data: string, model: Model, options: ImportOptions): Promise<ImportResult>;
}
