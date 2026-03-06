import type {
  ManifestData,
  ChangesetHistoryEntry,
} from "../types/index.js";

/**
 * Manifest representing model metadata and configuration
 *
 * The Manifest class manages all metadata about a Documentation Robotics model,
 * including project information, changeset history, and Python CLI compatibility
 * fields for migration scenarios.
 *
 * This class handles:
 * - Project metadata (name, version, description, author)
 * - Changeset application history
 * - Backward compatibility with Python CLI format for layer migration
 */
export class Manifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  created: string;
  modified: string;
  specVersion?: string;
  changeset_history?: ChangesetHistoryEntry[];

  /**
   * Python CLI compatibility field - layer configuration mapping
   *
   * Used when loading models that were created by Python CLI.
   * Contains path information for layer directories in old format.
   *
   * @deprecated Only used during migration from Python CLI format
   */
  layers?: Record<string, unknown>;


  constructor(
    data: ManifestData & {
      layers?: Record<string, unknown>;
    }
  ) {
    this.name = data.name;
    this.version = data.version;
    this.description = data.description;
    this.author = data.author;
    this.created = data.created ?? new Date().toISOString();
    this.modified = data.modified ?? new Date().toISOString();
    this.specVersion = data.specVersion;

    // Migrate changeset history from legacy format (if present)
    this.changeset_history = this.migrateChangesetHistory(data.changeset_history);

    // Python CLI compatibility field
    this.layers = data.layers;
  }

  /**
   * Migrate changeset history from legacy field names to new format
   * Legacy format: applied_at → committed_at, action: "applied" → action: "committed"
   *
   * @param history - Changeset history from manifest (may use legacy field names)
   * @returns Migrated changeset history using new field names
   */
  private migrateChangesetHistory(
    history: ChangesetHistoryEntry[] | undefined
  ): ChangesetHistoryEntry[] {
    if (!history || history.length === 0) {
      return [];
    }

    return history.map((entry: any) => ({
      name: entry.name,
      // Handle legacy field name: applied_at → committed_at
      committed_at: entry.committed_at || entry.applied_at || new Date().toISOString(),
      // Handle legacy action value: "applied" → "committed"
      action: (entry.action === "applied" ? "committed" : entry.action) as "committed" | "discarded",
    }));
  }

  /**
   * Update the modified timestamp to current time
   */
  updateModified(): void {
    this.modified = new Date().toISOString();
  }

  /**
   * Serialize to JSON representation
   *
   * Converts the Manifest to a JSON-serializable object that includes project
   * metadata, changeset history, and Python CLI compatibility data for migration scenarios.
   *
   * @returns ManifestData object suitable for JSON serialization
   */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {
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

    if (this.changeset_history && this.changeset_history.length > 0) {
      result.changeset_history = this.changeset_history;
    }

    // Include Python CLI compatibility fields for migration scenarios
    if (this.layers) {
      result.layers = this.layers;
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
