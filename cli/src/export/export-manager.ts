import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions, ExportFormatInfo } from "./types.js";

/**
 * ExportManager - Registry and dispatcher for format-specific exporters
 */
export class ExportManager {
  private exporters: Map<string, Exporter> = new Map();
  private formatInfo: Map<string, ExportFormatInfo> = new Map();

  /**
   * Register an exporter for a specific format
   */
  register(
    format: string,
    exporter: Exporter,
    info: Omit<ExportFormatInfo, "format" | "name" | "supportedLayers">
  ): void {
    this.exporters.set(format, exporter);
    this.formatInfo.set(format, {
      format,
      name: exporter.name,
      supportedLayers: exporter.supportedLayers,
      ...info,
    });
  }

  /**
   * Check if a format is registered
   */
  hasFormat(format: string): boolean {
    return this.exporters.has(format);
  }

  /**
   * Export model to specified format
   */
  async export(model: Model, format: string, options: ExportOptions = {}): Promise<string> {
    const exporter = this.exporters.get(format);
    if (!exporter) {
      throw new Error(`Unknown export format: ${format}`);
    }

    // Validate that requested layers are supported
    if (options.layers) {
      const unsupported = options.layers.filter(
        (layer) => !exporter.supportedLayers.includes(layer)
      );
      if (unsupported.length > 0) {
        throw new Error(
          `Format '${format}' does not support layers: ${unsupported.join(", ")}. ` +
            `Supported layers: ${exporter.supportedLayers.join(", ")}`
        );
      }
    }

    return await exporter.export(model, options);
  }

  /**
   * Get list of available formats
   */
  listFormats(): string[] {
    return Array.from(this.exporters.keys()).sort();
  }

  /**
   * Get metadata about a format
   */
  getFormatInfo(format: string): ExportFormatInfo | undefined {
    return this.formatInfo.get(format);
  }

  /**
   * Get supported layers for a format
   */
  getSupportedLayers(format: string): string[] {
    const exporter = this.exporters.get(format);
    return exporter?.supportedLayers ?? [];
  }

  /**
   * Get all registered formats with metadata
   */
  getAllFormats(): ExportFormatInfo[] {
    return Array.from(this.formatInfo.values()).sort((a, b) => a.format.localeCompare(b.format));
  }
}
