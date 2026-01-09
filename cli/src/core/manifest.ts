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
  changeset_history?: Array<{
    name: string;
    applied_at: string;
    action: 'applied' | 'reverted';
  }>;  // Changeset application tracking
  preferred_chat_client?: string;  // Chat client preference (Claude Code, GitHub Copilot) - DEPRECATED: Use coding_agent instead
  coding_agent?: string;  // Coding agent configuration (Claude Code, GitHub Copilot)

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
    this.changeset_history = (data as any).changeset_history || [];
    this.preferred_chat_client = (data as any).preferred_chat_client;
    this.coding_agent = (data as any).coding_agent;
  }

  /**
   * Update the modified timestamp to current time
   */
  updateModified(): void {
    this.modified = new Date().toISOString();
  }

  /**
   * Get the coding agent preference
   * Falls back to preferred_chat_client for backward compatibility
   * @returns The coding agent name or undefined
   */
  getCodingAgent(): string | undefined {
    return this.coding_agent || this.preferred_chat_client;
  }

  /**
   * Set the coding agent preference
   * Sets both coding_agent (new) and preferred_chat_client (legacy) for compatibility
   * @param agentName The coding agent name (e.g., "Claude Code", "GitHub Copilot")
   */
  setCodingAgent(agentName: string | undefined): void {
    this.coding_agent = agentName;
    this.preferred_chat_client = agentName; // Maintain backward compatibility
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

    if (this.changeset_history && this.changeset_history.length > 0) {
      result.changeset_history = this.changeset_history;
    }

    if (this.preferred_chat_client) {
      result.preferred_chat_client = this.preferred_chat_client;
    }

    if (this.coding_agent) {
      result.coding_agent = this.coding_agent;
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
