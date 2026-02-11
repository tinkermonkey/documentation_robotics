import type { Model } from "../core/model.js";
import { getAllLayerIds } from "../generated/layer-registry.js";

/**
 * Options for export operations
 */
export interface ExportOptions {
  layers?: string[];
  outputPath?: string;
  format?: string;
  includeSources?: boolean; // For PlantUML: include source file paths as notes
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

/**
 * Shared layer colors for consistent visualization across exporters
 * Note: Color values do NOT include '#' prefix - exporters add it as needed
 */
export const LAYER_COLORS: Record<string, string> = {
  motivation: "FFE4E1",
  business: "E6F3FF",
  security: "FFE6E6",
  application: "E6FFE6",
  technology: "FFFFE6",
  api: "F0E6FF",
  "data-model": "E6F0FF",
  "data-store": "FFE6F0",
  ux: "FFCCCC",
  navigation: "CCFFCC",
  apm: "CCFFFF",
  testing: "FFCCFF",
};

/**
 * All 12 supported layers (from generated registry)
 */
export const ALL_LAYERS: string[] = getAllLayerIds();

/**
 * Escape XML special characters
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
