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
 * Records element mutations with before/after snapshots for audit purposes.
 */
export interface Change {
  type: "add" | "update" | "delete" | "relationship-add" | "relationship-delete";
  elementId: string; // For relationships: composite key "source::predicate::target"
  layerName: string; // For relationships: source element's layer
  before?: Record<string, unknown>; // Element/relationship state before change
  after?: Record<string, unknown>;  // Element/relationship state after change
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
 * - 'discarded': Changes were discarded without committing
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
  changes: Change[] | StagedChange[]; // Changes (with optional sequence numbers)
  stats?: {
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
    const additions = this.changes.filter((c) => c.type === "add" || c.type === "relationship-add").length;
    const modifications = this.changes.filter((c) => c.type === "update").length;
    const deletions = this.changes.filter((c) => c.type === "delete" || c.type === "relationship-delete").length;

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
    // Store changes; preserve sequenceNumber if present from storage
    this.changes = (data.changes || []).map((change) => {
      const { type, elementId, layerName, before, after, timestamp, sequenceNumber } = change as any;
      const result: any = { type, elementId, layerName, before, after, timestamp };
      // Preserve sequenceNumber if it exists (from loaded StagedChange)
      if (typeof sequenceNumber === "number") {
        result.sequenceNumber = sequenceNumber;
      }
      return result as Change;
    });
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
   * @param id - Unique changeset ID (required)
   * @param baseSnapshot - SHA256 hash of base model at creation (required)
   * @returns New Changeset instance in staged status
   */
  static create(
    name: string,
    description: string | undefined,
    id: string,
    baseSnapshot: string
  ): Changeset {
    const now = new Date().toISOString();
    return new Changeset({
      name,
      description,
      created: now,
      modified: now,
      changes: [],
      status: "staged",
      id,
      baseSnapshot,
    });
  }

  /**
   * Add a change to the changeset.
   * Records element mutation with before/after snapshots for audit purposes.
   *
   * Note: Only accepts "add", "update", "delete" types. Relationship changes
   * ("relationship-add", "relationship-delete") are added directly via the changes
   * array by the staging workflow to maintain temporal ordering with element changes.
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
   * @returns Number of changes (add + update + delete + relationship-add + relationship-delete)
   */
  getChangeCount(): number {
    return this.changes.length;
  }

  /**
   * Get all changes of a specific type.
   *
   * @param type - Type of changes to filter for (automatically stays in sync with Change.type union)
   * @returns Array of changes matching the type
   */
  getChangesByType(type: Change["type"]): Change[] {
    return this.changes.filter((c) => c.type === type);
  }

  /**
   * Mark changeset as staged.
   * Enables the changeset to accept new changes via staging operations.
   * Updates status and modified timestamp.
   */
  markStaged(): void {
    this.status = "staged";
    this.updateModified();
  }

  /**
   * Mark changeset as committed.
   * Indicates changes have been committed to the base model.
   * Updates status and modified timestamp.
   */
  markCommitted(): void {
    this.status = "committed";
    this.updateModified();
  }

  /**
   * Mark changeset as discarded.
   * Indicates changes have been discarded without committing.
   * Updates status and modified timestamp.
   */
  markDiscarded(): void {
    this.status = "discarded";
    this.updateModified();
  }

  /**
   * Serialize changeset to JSON.
   * Always returns StagedChangesetData format with sequenceNumbers added.
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
      changes: this.changes.map((change, idx) => ({
        ...change,
        sequenceNumber: idx,
      })),
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
