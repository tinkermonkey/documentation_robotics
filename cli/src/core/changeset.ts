/**
 * Changeset - Represents a collection of model changes.
 *
 * Changesets group related modifications to the architecture model for:
 * - Staging changes before committing to the base model
 * - Audit trail of model changes with before/after snapshots
 * - Collaboration and change tracking across team members
 *
 * Uses the staging workflow (staged/committed/discarded).
 */

/**
 * Represents a single change in a changeset.
 * Records element mutations with before/after snapshots for audit and reversion.
 */
export interface Change {
  type: "add" | "update" | "delete";
  elementId: string;
  layerName: string;
  before?: Record<string, unknown>; // Element state before change (for update/delete)
  after?: Record<string, unknown>; // Element state after change (for add/update)
  timestamp?: string; // ISO timestamp; optional in interface but always set before storage
}

/**
 * Represents a staged change with sequence number for ordered replay.
 * Used in the staging workflow to ensure changes are applied in order during commit.
 */
export interface StagedChange extends Change {
  readonly sequenceNumber: number; // 0-based index for ordering during commit replay
}

/**
 * Status values for changesets in the staging workflow.
 *
 * - 'staged': Created and active for staging changes (can accept new changes)
 * - 'committed': Changes have been committed to base model
 * - 'discarded': Changes were discarded without applying
 */
export type ChangesetStatus = "staged" | "committed" | "discarded";

/**
 * Changeset data with staging semantics and metadata.
 * Includes id and base snapshot for drift detection and auto-computed stats.
 */
export interface StagedChangesetData {
  id: string; // Unique changeset ID
  name: string;
  description?: string;
  created: string; // ISO timestamp of creation
  modified: string; // ISO timestamp of last modification
  status: ChangesetStatus;
  baseSnapshot: string; // SHA256 hash of base model at creation (for drift detection)
  changes: StagedChange[]; // Changes with sequence numbers
  stats: {
    additions: number;
    modifications: number;
    deletions: number;
  };
}

/**
 * Changeset class for managing model changes.
 * Represents a staging workflow changeset (staged/committed/discarded).
 *
 * Stats are computed on-demand from the changes array, ensuring consistency.
 */
export class Changeset {
  name: string;
  description?: string;
  created: string;
  modified: string;
  changes: Change[] = [];
  status: ChangesetStatus = "staged";

  // Staging workflow fields (required)
  id: string;
  baseSnapshot: string;

  /**
   * Get statistics derived from changes array.
   * Computed on-demand to ensure always accurate regardless of how changes were added.
   *
   * @returns Statistics object with count of additions, modifications, deletions
   */
  get stats(): {
    additions: number;
    modifications: number;
    deletions: number;
  } {
    // Compute stats from changes array on-demand (never stale)
    const additions = this.changes.filter((c) => c.type === "add").length;
    const modifications = this.changes.filter((c) => c.type === "update").length;
    const deletions = this.changes.filter((c) => c.type === "delete").length;

    return { additions, modifications, deletions };
  }

  /**
   * Create changeset from data object.
   * Accepts only StagedChangesetData format with id and baseSnapshot.
   *
   * @param data - Changeset data from storage or API
   */
  constructor(data: StagedChangesetData) {
    this.name = data.name;
    this.description = data.description;
    this.created = data.created;
    this.modified = data.modified;
    this.changes = data.changes || [];
    this.status = data.status || "staged";
    this.id = data.id;
    this.baseSnapshot = data.baseSnapshot;
    // Note: Stats are computed from changes array via getter; ignore any stored stats
  }

  /**
   * Create a new changeset with staged status.
   *
   * @param name - Human-readable name for the changeset
   * @param description - Optional description of changes
   * @param id - Unique changeset ID
   * @param baseSnapshot - SHA256 hash of base model at creation
   * @returns New Changeset instance in staged status
   */
  static create(
    name: string,
    description?: string,
    id?: string,
    baseSnapshot?: string
  ): Changeset {
    const now = new Date().toISOString();
    return new Changeset({
      name,
      description,
      created: now,
      modified: now,
      changes: [],
      status: "staged",
      id: id || "",
      baseSnapshot: baseSnapshot || "",
    });
  }

  /**
   * Add a change to the changeset.
   * Records element mutation with before/after snapshots for audit and reversion.
   *
   * @param type - Type of change (add, update, delete)
   * @param elementId - ID of the element being changed
   * @param layerName - Layer containing the element
   * @param before - Element state before change (for update/delete operations)
   * @param after - Element state after change (for add/update operations)
   * @throws No exceptions; updates modified timestamp on success
   */
  addChange(
    type: "add" | "update" | "delete",
    elementId: string,
    layerName: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>
  ): void {
    this.changes.push({
      type,
      elementId,
      layerName,
      before,
      after,
      timestamp: new Date().toISOString(),
    });
    this.updateModified();
  }

  /**
   * Update the modified timestamp to current time.
   */
  updateModified(): void {
    this.modified = new Date().toISOString();
  }

  /**
   * Get the total number of changes in this changeset.
   *
   * @returns Number of changes (add + update + delete)
   */
  getChangeCount(): number {
    return this.changes.length;
  }

  /**
   * Get all changes of a specific type.
   *
   * @param type - Type of changes to filter for
   * @returns Array of changes matching the type
   */
  getChangesByType(type: "add" | "update" | "delete"): Change[] {
    return this.changes.filter((c) => c.type === type);
  }

  /**
   * Mark changeset as staged (new staging workflow).
   * Enables the changeset to accept new changes via staging operations.
   * Updates status and modified timestamp.
   */
  markStaged(): void {
    this.status = "staged";
    this.updateModified();
  }

  /**
   * Mark changeset as committed (new staging workflow).
   * Indicates changes have been applied to the base model.
   * Updates status and modified timestamp.
   */
  markCommitted(): void {
    this.status = "committed";
    this.updateModified();
  }

  /**
   * Mark changeset as discarded (new staging workflow).
   * Indicates changes have been discarded without applying.
   * Updates status and modified timestamp.
   */
  markDiscarded(): void {
    this.status = "discarded";
    this.updateModified();
  }

  /**
   * Serialize changeset to JSON.
   * Always returns StagedChangesetData format.
   *
   * @returns Serialized changeset data suitable for storage
   */
  toJSON(): StagedChangesetData {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      created: this.created,
      modified: this.modified,
      baseSnapshot: this.baseSnapshot,
      status: this.status,
      changes: this.changes,
      stats: this.stats,
    };
  }

  /**
   * Deserialize changeset from JSON data.
   * Accepts StagedChangesetData format.
   *
   * @param data - Serialized changeset data
   * @returns New Changeset instance
   */
  static fromJSON(data: StagedChangesetData): Changeset {
    return new Changeset(data);
  }
}
