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
  /**
   * Orders the change for commit replay. Assigned once when the change is staged, as one past the
   * highest number the changeset has used (`nextSequenceNumber`), and never renumbered: unstaging a
   * change leaves a gap, so a revision always names the same prefix of the plan. Changesets staged
   * before this numbered their changes 0..n-1, which reads the same way.
   */
  readonly sequenceNumber: number;
}

/**
 * A change that was unstaged, kept so the plan as it stood before the unstage can be rebuilt (see
 * `changesAtRevision` in changeset-graph.ts). Stored in the changeset's metadata, never among its
 * changes: commit, apply, preview and the projection do not see it.
 */
export interface UnstagedChange {
  /** The sequence number the change had. */
  sequence: number;
  /** The revision the unstage made: the sequence number it took (no change carries it). */
  removedAt: number;
  /** A compact copy of the change (see `compactChange`). */
  change: Change;
}

/**
 * The change without what the plan's state does not depend on: an add's `before` (nothing was
 * there). Tombstones store this, and revision tokens hash it, so a change hashes the same staged
 * and unstaged.
 */
export function compactChange(change: Change): Change {
  const { type, elementId, layerName, before, after, timestamp } = change;
  const keepBefore = before !== undefined && before !== null && type !== "add" && type !== "relationship-add";
  return {
    type,
    elementId,
    layerName,
    ...(keepBefore ? { before } : {}),
    ...(after !== undefined && after !== null ? { after } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
  };
}

/** A change's sequence number, or its position when it carries none (older in-memory changes). */
export function sequenceOf(change: Change, index: number): number {
  const sequence = (change as Partial<StagedChange>).sequenceNumber;
  return typeof sequence === "number" ? sequence : index;
}

/**
 * The sequence number the changeset's next change or unstage takes: one past every number it has
 * used, staged changes, unstaged ones and their unstage events included.
 */
export function nextSequenceNumber(changeset: {
  changes: Change[];
  lastSequence?: number;
  unstaged?: UnstagedChange[];
  unstagedPrunedThrough?: number;
}): number {
  let max = Math.max(changeset.lastSequence ?? -1, changeset.unstagedPrunedThrough ?? -1);
  changeset.changes.forEach((change, index) => {
    max = Math.max(max, sequenceOf(change, index));
  });
  for (const tombstone of changeset.unstaged ?? []) {
    max = Math.max(max, tombstone.sequence, tombstone.removedAt);
  }
  return max + 1;
}

/**
 * Gives every change its sequence number, assigning numbers to any that carry none.
 *
 * With no numbers at all the position is the number (how older changesets were written). Otherwise
 * an unnumbered change takes the next unused number, never below `floor`: pass
 * `nextSequenceNumber(changeset)` so a number an unstaged change or unstage event used (recorded in
 * `lastSequence` and the tombstones) is not given out again.
 */
export function withSequenceNumbers(changes: Change[], floor = 0): StagedChange[] {
  const used = changes
    .map((change) => (change as Partial<StagedChange>).sequenceNumber)
    .filter((sequence): sequence is number => typeof sequence === "number");
  let next = Math.max(floor, used.length > 0 ? Math.max(...used) + 1 : 0);
  return changes.map((change, index) => {
    if (typeof (change as Partial<StagedChange>).sequenceNumber === "number") return change as StagedChange;
    const assigned = used.length === 0 ? index : next++;
    return { ...change, sequenceNumber: assigned } as StagedChange;
  });
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
  /** The highest sequence number used, unstage events included. Absent on older changesets. */
  lastSequence?: number;
  /** Recently unstaged changes, oldest first (bounded; see StagedChangesetStorage). */
  unstaged?: UnstagedChange[];
  /** Tombstones with `removedAt` at or below this were dropped to keep the list bounded. */
  unstagedPrunedThrough?: number;
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

  /** The highest sequence number used, unstage events included (see `nextSequenceNumber`). */
  lastSequence?: number;
  /** Recently unstaged changes, kept to rebuild earlier revisions; never committed or applied. */
  unstaged: UnstagedChange[] = [];
  /** Tombstones with `removedAt` at or below this were dropped to keep the list bounded. */
  unstagedPrunedThrough?: number;

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
    if (typeof data.lastSequence === "number") this.lastSequence = data.lastSequence;
    if (Array.isArray(data.unstaged)) this.unstaged = data.unstaged;
    if (typeof data.unstagedPrunedThrough === "number") this.unstagedPrunedThrough = data.unstagedPrunedThrough;
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
    // One past every number used, unstaged changes and unstage events included, as
    // StagedChangesetStorage.addChange does
    const sequenceNumber = nextSequenceNumber(this);
    this.changes.push({
      type,
      elementId,
      layerName,
      before,
      after,
      timestamp: new Date().toISOString(),
      sequenceNumber,
    } as StagedChange);
    this.lastSequence = sequenceNumber;
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
      // Sequence numbers are kept as staged: they may have gaps where changes were unstaged.
      changes: withSequenceNumbers(this.changes, nextSequenceNumber(this)),
      stats: this.stats,
      ...(this.lastSequence !== undefined ? { lastSequence: this.lastSequence } : {}),
      ...(this.unstaged.length > 0 ? { unstaged: this.unstaged } : {}),
      ...(this.unstagedPrunedThrough !== undefined ? { unstagedPrunedThrough: this.unstagedPrunedThrough } : {}),
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
