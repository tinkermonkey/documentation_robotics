/**
 * Changeset - Represents a collection of model changes.
 *
 * Changesets group related modifications to the architecture model for:
 * - Atomic application or reversion as a unit
 * - Staging changes before committing to the base model (new staging workflow)
 * - Audit trail of model changes with before/after snapshots
 * - Collaboration and change tracking across team members
 *
 * Supports both legacy (draft/applied/reverted) and new staging (staged/committed/discarded) workflows.
 */


/**
 * Represents a single change in a changeset.
 * Records element mutations with before/after snapshots for audit and reversion.
 */
export interface Change {
  type: 'add' | 'update' | 'delete';
  elementId: string;
  layerName: string;
  before?: Record<string, unknown>;  // Element state before change (for update/delete)
  after?: Record<string, unknown>;   // Element state after change (for add/update)
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
 * Status values for changesets (supports both legacy and new staging workflows).
 *
 * Legacy workflow (deprecated, still supported for compatibility):
 * - 'draft': Created but not yet applied
 * - 'applied': Changes have been applied to model
 * - 'reverted': Changes have been reverted from model
 *
 * New staging workflow (current approach):
 * - 'staged': Created and active for staging changes (can accept new changes)
 * - 'committed': Changes have been committed to base model
 * - 'discarded': Changes were discarded without applying
 */
export type ChangesetStatus = 'draft' | 'applied' | 'reverted' | 'staged' | 'committed' | 'discarded';

/**
 * Changeset metadata for legacy and staging workflows.
 * Base interface for both ChangesetData and StagedChangesetData.
 */
export interface ChangesetData {
  name: string;
  description?: string;
  created: string;       // ISO timestamp of creation
  modified: string;      // ISO timestamp of last modification
  changes: Change[];
  status: ChangesetStatus;
}

/**
 * Extended changeset data with staging semantics and metadata.
 * Includes base snapshot for drift detection and auto-computed stats.
 */
export interface StagedChangesetData {
  id: string;                     // Unique changeset ID
  name: string;
  description?: string;
  created: string;                // ISO timestamp of creation
  modified: string;               // ISO timestamp of last modification
  status: ChangesetStatus;
  baseSnapshot: string;           // SHA256 hash of base model at creation (for drift detection)
  changes: StagedChange[];        // Changes with sequence numbers
  stats: {
    additions: number;
    modifications: number;
    deletions: number;
  };
}

/**
 * Changeset class for managing model changes.
 * Represents either a legacy (draft/applied/reverted) or staging workflow (staged/committed/discarded) changeset.
 *
 * Stats are computed on-demand from the changes array, ensuring consistency.
 * Extended fields (id, baseSnapshot) are optional for backward compatibility.
 */
export class Changeset {
  name: string;
  description?: string;
  created: string;
  modified: string;
  changes: Change[] = [];
  status: ChangesetStatus = 'draft';

  // Extended staging fields (optional for backward compatibility with legacy changesets)
  id?: string;
  baseSnapshot?: string;

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
    const additions = this.changes.filter(c => c.type === 'add').length;
    const modifications = this.changes.filter(c => c.type === 'update').length;
    const deletions = this.changes.filter(c => c.type === 'delete').length;

    return { additions, modifications, deletions };
  }

  /**
   * Create changeset from data object.
   * Handles both legacy (ChangesetData) and staging (StagedChangesetData) formats.
   *
   * @param data - Changeset data from storage or API
   */
  constructor(data: ChangesetData | StagedChangesetData) {
    this.name = data.name;
    this.description = data.description;
    this.created = data.created;
    this.modified = data.modified;
    this.changes = data.changes || [];
    this.status = data.status || 'draft';

    // Load extended staging fields if present
    if ('id' in data) {
      this.id = (data as StagedChangesetData).id;
    }
    if ('baseSnapshot' in data) {
      this.baseSnapshot = (data as StagedChangesetData).baseSnapshot;
    }
    // Note: Stats are computed from changes array via getter; ignore any stored stats
  }

  /**
   * Create a new changeset with draft status.
   *
   * @param name - Human-readable name for the changeset
   * @param description - Optional description of changes
   * @returns New Changeset instance in draft status
   */
  static create(name: string, description?: string): Changeset {
    const now = new Date().toISOString();
    return new Changeset({
      name,
      description,
      created: now,
      modified: now,
      changes: [],
      status: 'draft',
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
    type: 'add' | 'update' | 'delete',
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
  getChangesByType(type: 'add' | 'update' | 'delete'): Change[] {
    return this.changes.filter((c) => c.type === type);
  }

  /**
   * Update changeset statistics (deprecated).
   * @deprecated Stats are now computed automatically from the changes array via the stats getter.
   * This method is kept for backward compatibility but performs no operation.
   */
  updateStats(): void {
    // No-op: stats are now computed on-demand via the stats getter
  }

  /**
   * Mark changeset as applied (legacy workflow).
   * Updates status and modified timestamp.
   */
  markApplied(): void {
    this.status = 'applied';
    this.updateModified();
  }

  /**
   * Mark changeset as reverted (legacy workflow).
   * Updates status and modified timestamp.
   */
  markReverted(): void {
    this.status = 'reverted';
    this.updateModified();
  }

  /**
   * Mark changeset as staged (new staging workflow).
   * Enables the changeset to accept new changes via staging operations.
   * Updates status and modified timestamp.
   */
  markStaged(): void {
    this.status = 'staged';
    this.updateModified();
  }

  /**
   * Mark changeset as committed (new staging workflow).
   * Indicates changes have been applied to the base model.
   * Updates status and modified timestamp.
   */
  markCommitted(): void {
    this.status = 'committed';
    this.updateModified();
  }

  /**
   * Mark changeset as discarded (new staging workflow).
   * Indicates changes have been discarded without applying.
   * Updates status and modified timestamp.
   */
  markDiscarded(): void {
    this.status = 'discarded';
    this.updateModified();
  }

  /**
   * Serialize changeset to JSON.
   * Returns StagedChangesetData if extended fields are present, otherwise ChangesetData.
   *
   * @returns Serialized changeset data suitable for storage
   */
  toJSON(): ChangesetData | StagedChangesetData {
    const base = {
      name: this.name,
      description: this.description,
      created: this.created,
      modified: this.modified,
      changes: this.changes,
      status: this.status,
    };

    // Include extended staging fields if present
    if (this.id && this.baseSnapshot) {
      return {
        ...base,
        id: this.id,
        baseSnapshot: this.baseSnapshot,
        stats: this.stats,
      } as StagedChangesetData;
    }

    return base as ChangesetData;
  }

  /**
   * Deserialize changeset from JSON data.
   * Handles both legacy (ChangesetData) and staging (StagedChangesetData) formats.
   *
   * @param data - Serialized changeset data
   * @returns New Changeset instance
   */
  static fromJSON(data: ChangesetData | StagedChangesetData): Changeset {
    return new Changeset(data);
  }
}

