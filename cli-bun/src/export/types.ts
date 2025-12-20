import type { Model } from "../core/model.js";

/**
 * Options for export operations
 */
export interface ExportOptions {
  layers?: string[];
  outputPath?: string;
  format?: string;
}

/**
 * Interface for format-specific exporters
 */
export interface Exporter {
  /** Display name of the exporter */
  name: string;

  /** Layers this exporter supports */
  supportedLayers: string[];

  /**
   * Export model or subset to the format
   */
  export(model: Model, options: ExportOptions): Promise<string>;
}

/**
 * Metadata about a registered export format
 */
export interface ExportFormatInfo {
  format: string;
  name: string;
  description: string;
  supportedLayers: string[];
  mimeType: string;
}
