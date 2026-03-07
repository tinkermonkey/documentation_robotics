import type {
  ManifestData,
  ChangesetHistoryEntry,
} from "../types/index.js";

/**
 * Manifest representing model metadata and configuration
 *
 * The Manifest class manages all metadata about a Documentation Robotics model,
 * including project information, changeset history, and layer configuration.
 *
 * This class handles:
 * - Project metadata (name, version, description, author)
 * - Changeset application history
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

  constructor(data: ManifestData) {
    this.name = data.name;
    this.version = data.version;
    this.description = data.description;
    this.author = data.author;
    this.created = data.created ?? new Date().toISOString();
    this.modified = data.modified ?? new Date().toISOString();
    this.specVersion = data.specVersion;

    // Migrate changeset history from legacy format (if present)
    this.changeset_history = this.migrateChangesetHistory(data.changeset_history);
  }

  /**
   * Migrate changeset history from legacy field names to new format
   * Legacy format: applied_at → committed_at, action: "applied" → action: "committed"
   *
   * @param history - Changeset history from manifest (may use legacy field names)
   * @returns Migrated changeset history using new field names
   * @throws Error if action value is unrecognized (not "committed", "discarded", "applied", or "reverted")
   */
  private migrateChangesetHistory(
    history: ChangesetHistoryEntry[] | undefined
  ): ChangesetHistoryEntry[] {
    if (!history || history.length === 0) {
      return [];
    }

    return history.map((entry: any) => {
      // Validate action value to prevent silent data corruption
      let action: "committed" | "discarded";
      if (entry.action === "applied" || entry.action === "committed") {
        action = "committed";
      } else if (entry.action === "reverted" || entry.action === "discarded") {
        action = "discarded";
      } else {
        throw new Error(
          `Invalid changeset history action '${entry.action}' for changeset '${entry.name}'. ` +
          `Expected: committed, discarded, applied (legacy), or reverted (legacy).`
        );
      }

      return {
        name: entry.name,
        // Handle legacy field name: applied_at → committed_at
        committed_at: entry.committed_at || entry.applied_at || new Date().toISOString(),
        action,
      };
    });
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
   * metadata and changeset history.
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
