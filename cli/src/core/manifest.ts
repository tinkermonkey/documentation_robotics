import type { ManifestData, ModelStatistics, CrossReferenceStatistics, ChangesetHistoryEntry } from "../types/index.js";

/**
 * Manifest representing model metadata and configuration
 *
 * The Manifest class manages all metadata about a Documentation Robotics model,
 * including project information, statistics, changeset history, and Python CLI
 * compatibility fields for migration scenarios.
 *
 * This class handles:
 * - Project metadata (name, version, description, author)
 * - Model statistics and cross-reference tracking
 * - Changeset application history
 * - Chat client preferences
 * - Backward compatibility with Python CLI format
 */
export class Manifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  created: string;
  modified: string;
  specVersion?: string;
  statistics?: ModelStatistics;
  cross_references?: CrossReferenceStatistics;
  changeset_history?: ChangesetHistoryEntry[];
  preferred_chat_client?: string;

  /**
   * Python CLI compatibility field - layer configuration mapping
   *
   * Used when loading models that were created by Python CLI.
   * Contains path information for layer directories in old format.
   *
   * @deprecated Only used during migration from Python CLI format
   */
  layers?: Record<string, unknown>;

  /**
   * Python CLI compatibility field - conventions metadata
   *
   * @deprecated Only used during migration from Python CLI format
   */
  conventions?: unknown;

  /**
   * Python CLI compatibility field - upgrade history tracking
   *
   * @deprecated Only used during migration from Python CLI format
   */
  upgrade_history?: unknown[];

  constructor(data: ManifestData & { layers?: Record<string, unknown>; conventions?: unknown; upgrade_history?: unknown[] }) {
    this.name = data.name;
    this.version = data.version;
    this.description = data.description;
    this.author = data.author;
    this.created = data.created ?? new Date().toISOString();
    this.modified = data.modified ?? new Date().toISOString();
    this.specVersion = data.specVersion;
    this.statistics = data.statistics;
    this.cross_references = data.cross_references;
    this.changeset_history = data.changeset_history || [];
    this.preferred_chat_client = data.preferred_chat_client;

    // Python CLI compatibility fields
    this.layers = data.layers;
    this.conventions = data.conventions;
    this.upgrade_history = data.upgrade_history;
  }

  /**
   * Update the modified timestamp to current time
   */
  updateModified(): void {
    this.modified = new Date().toISOString();
  }

  /**
   * Get the coding agent preference
   * @returns The coding agent name or undefined
   */
  getCodingAgent(): string | undefined {
    return this.preferred_chat_client;
  }

  /**
   * Set the coding agent preference
   * @param agentName The coding agent name (e.g., "Claude Code", "GitHub Copilot")
   */
  setCodingAgent(agentName: string | undefined): void {
    this.preferred_chat_client = agentName;
  }

  /**
   * Serialize to JSON representation
   *
   * Converts the Manifest to a JSON-serializable object that includes all
   * populated fields and Python CLI compatibility data for migration scenarios.
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

    if (this.statistics) {
      result.statistics = this.statistics;
    }

    if (this.cross_references) {
      result.cross_references = this.cross_references;
    }

    if (this.changeset_history && this.changeset_history.length > 0) {
      result.changeset_history = this.changeset_history;
    }

    if (this.preferred_chat_client) {
      result.preferred_chat_client = this.preferred_chat_client;
    }

    // Include Python CLI compatibility fields for migration scenarios
    if (this.layers) {
      result.layers = this.layers;
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
