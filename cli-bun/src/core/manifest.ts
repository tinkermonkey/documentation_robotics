import type { ManifestData } from "@/types/index";

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

  constructor(data: ManifestData) {
    this.name = data.name;
    this.version = data.version;
    this.description = data.description;
    this.author = data.author;
    this.created = data.created ?? new Date().toISOString();
    this.modified = data.modified ?? new Date().toISOString();
    this.specVersion = data.specVersion;
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
    const result: ManifestData = {
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
