export { type ImportOptions, type ImportResult, type Importer } from "./types.js";
export { ArchiMateImporter } from "./archimate-importer.js";
export { OpenAPIImporter } from "./openapi-importer.js";

/**
 * Import manager for registering and using format importers
 */
import type { Model } from "../core/model.js";
import type { Importer, ImportOptions, ImportResult } from "./types.js";
import { ArchiMateImporter } from "./archimate-importer.js";
import { OpenAPIImporter } from "./openapi-importer.js";

export class ImportManager {
  private importers: Map<string, Importer> = new Map();

  constructor() {
    this.registerImporter(new ArchiMateImporter());
    this.registerImporter(new OpenAPIImporter());
  }

  /**
   * Register an importer
   */
  registerImporter(importer: Importer): void {
    this.importers.set(importer.name.toLowerCase(), importer);
  }

  /**
   * Get an importer by name
   */
  getImporter(name: string): Importer | undefined {
    return this.importers.get(name.toLowerCase());
  }

  /**
   * Get all registered importers
   */
  getImporters(): Importer[] {
    return Array.from(this.importers.values());
  }

  /**
   * Import data using a specific format
   */
  async import(
    format: string,
    data: string,
    model: Model,
    options: ImportOptions = {}
  ): Promise<ImportResult> {
    const importer = this.getImporter(format);
    if (!importer) {
      return {
        success: false,
        nodesAdded: 0,
        edgesAdded: 0,
        errorsCount: 1,
        errors: [{ message: `No importer found for format: ${format}` }],
      };
    }

    return importer.import(data, model, options);
  }
}
