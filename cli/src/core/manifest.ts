import type { ManifestData } from "../types/index.js";

/**
 * Manifest class representing model metadata
 */
export class Manifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  created: string;
  modified: string;
  specVersion?: string;
  layers?: Record<string, any>;  // Python CLI layer configuration
  statistics?: {
    total_elements: number;
    total_relationships: number;
    completeness?: number;
    last_validation?: string;
    validation_status?: string;
  };
  cross_references?: {
    total: number;
    by_type: Record<string, number>;
  };
  conventions?: any;  // Python CLI conventions
  upgrade_history?: any[];  // Python CLI upgrade tracking

  constructor(data: ManifestData) {
    this.name = data.name;
    this.version = data.version;
    this.description = data.description;
    this.author = data.author;
    this.created = data.created ?? new Date().toISOString();
    this.modified = data.modified ?? new Date().toISOString();
    this.specVersion = data.specVersion;
    // Python CLI compatibility fields
    this.layers = (data as any).layers;
    this.statistics = (data as any).statistics;
    this.cross_references = (data as any).cross_references;
    this.conventions = (data as any).conventions;
    this.upgrade_history = (data as any).upgrade_history;
  }

  /**
   * Update the modified timestamp to current time
   */
  updateModified(): void {
    this.modified = new Date().toISOString();
  }

  /**
   * Serialize to JSON representation
   */
  toJSON(): ManifestData {
    const result: any = {
      name: this.name,
      version: this.version,
      created: this.created,
      modified: this.modified,
    };

    if (this.description) {
      result.description = this.description;
    }

    if (this.author) {
      result.author = this.author;
    }

    if (this.specVersion) {
      result.specVersion = this.specVersion;
    }

    // Include Python CLI compatibility fields
    if (this.layers) {
      result.layers = this.layers;
    }

    if (this.statistics) {
      result.statistics = this.statistics;
    }

    if (this.cross_references) {
      result.cross_references = this.cross_references;
    }

    if (this.conventions) {
      result.conventions = this.conventions;
    }

    if (this.upgrade_history) {
      result.upgrade_history = this.upgrade_history;
    }

    return result;
  }

  /**
   * Create Manifest from JSON string
   */
  static fromJSON(json: string): Manifest {
    const data = JSON.parse(json) as ManifestData;
    return new Manifest(data);
  }

  /**
   * String representation
   */
  toString(): string {
    return `Manifest(${this.name} v${this.version})`;
  }
}
