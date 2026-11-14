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

import type { ChangesetOrigin, ChangesetReview } from "./changeset-review.js";
import { resolveModel } from "../analyzers/classifier/decision-model/registry.js";

/**
 * Who decided a staged change (docs/analyzers/TIER1_DESIGN.md section 7): codebase_extract sets it
 * on the adds and relationship-adds it stages. It sits beside `after`, never in it, so landing the
 * changeset never writes it into an element; it holds no secret.
 */
export interface ChangeOrigin {
  /** `tier0`: a Tier-0 rule or the node or edge mapping; `tier1`: a decision model; `agent`: the calling agent. */
  by: "tier0" | "tier1" | "agent";
  /**
   * Tier 0: the rule (`node-mapping:Route`; `edge:CALLS` for a relationship between elements the
   * run didn't add); Tier 1: `tier1:<question set>`.
   */
  rule?: string;
  /** Tier 1: the provider (`cloudflare-workers-ai`). */
  provider?: string;
  /** Tier 1: the model, as the response named it when it did. */
  model?: string;
  /** Tier 1 through OpenRouter: the upstream that served. */
  upstream?: string;
  /** Tier 1: the chosen layer's and type's probabilities. */
  p?: { layer: number; type: number | null };
  /** Tier 1: `auto` (stage mode) or `agent` (the agent passed acceptTier1). */
  confirmed?: "auto" | "agent";
}

/**
 * An origin in one short line, for the changeset views (`changeset_show`'s summary,
 * `changeset_brief`, `dr changeset staged`): `tier0 node-mapping:Route`, `agent`, or
 * `tier1 clef p=0.82/0.71` (the chosen layer's and type's probabilities, `-` for a type not asked),
 * with ` via <upstream>` for OpenRouter and ` confirmed=agent|auto` when it was confirmed. The
 * model is the short name users configure (`clef`): the stored `model` is the provider's id
 * (`@cf/cloudflare/clef`), mapped through the decision-model registry, else shown as stored.
 */
export function originLabel(origin: ChangeOrigin): string {
  // Read from changes.yaml, so a hand-edited origin may lack fields.
  const by = typeof origin.by === "string" ? origin.by : "unknown";
  if (by !== "tier1") return origin.rule ? `${by} ${origin.rule}` : by;
  const p = (n: number | null | undefined) => (typeof n === "number" ? n.toFixed(2) : "-");
  const model =
    typeof origin.model === "string" && typeof origin.provider === "string"
      ? (resolveModel(origin.provider, origin.model)?.name ?? origin.model)
      : origin.model;
  return [
    "tier1",
    model ?? origin.provider ?? origin.rule,
    origin.upstream ? `via ${origin.upstream}` : undefined,
    origin.p ? `p=${p(origin.p.layer)}/${p(origin.p.type)}` : undefined,
    origin.confirmed ? `confirmed=${origin.confirmed}` : undefined,
  ]
    .filter((part): part is string => !!part)
    .join(" ");
}

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
  /** Who decided it, on the adds and relationship-adds codebase_extract stages; absent elsewhere and in older changesets. */
  origin?: ChangeOrigin;
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
  /**
   * Set when the change was rewritten in place (an update folded into the add it updates), not
   * unstaged: the tombstone holds the version the change had before `removedAt`, and the change
   * itself is still staged under the same sequence number.
   */
  rewritten?: true;
}

/**
 * The change without what the plan's state does not depend on: an add's `before` (nothing was
 * there). Tombstones store this, and revision tokens hash it, so a change hashes the same staged
 * and unstaged. Its `origin` stays, so an unstaged change still says who decided it.
 */
export function compactChange(change: Change): Change {
  const { type, elementId, layerName, before, after, timestamp, origin } = change;
  const keepBefore = before !== undefined && before !== null && type !== "add" && type !== "relationship-add";
  return {
    type,
    elementId,
    layerName,
    ...(keepBefore ? { before } : {}),
    ...(after !== undefined && after !== null ? { after } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(origin ? { origin } : {}),
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
  /** Where the changeset came from (metadata.yaml). Absent on changesets made before it was recorded. */
  origin?: ChangesetOrigin;
  /** The reviewer's verdicts, read from review.yaml (never written by save; see updateReview). */
  review?: ChangesetReview;
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
  /** Where the changeset came from; absent on changesets made before it was recorded. */
  origin?: ChangesetOrigin;
  /**
   * The reviewer's verdicts as read from review.yaml when the changeset was loaded. Read-only here:
   * `save` never writes it; StagedChangesetStorage.updateReview does, under the changeset's lock.
   */
  review: ChangesetReview = { decisions: {} };

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
      const { type, elementId, layerName, before, after, timestamp, sequenceNumber, origin } = change as any;
      const result: any = { type, elementId, layerName, before, after, timestamp };
      // Preserve sequenceNumber if it exists (from loaded StagedChange)
      if (typeof sequenceNumber === "number") {
        result.sequenceNumber = sequenceNumber;
      }
      // Who decided it (codebase_extract's changes), kept through every load and save.
      if (origin && typeof origin === "object") result.origin = origin;
      return result as Change;
    });
    this.status = data.status || "staged";
    this.id = data.id;
    this.baseSnapshot = data.baseSnapshot;
    if (typeof data.lastSequence === "number") this.lastSequence = data.lastSequence;
    if (Array.isArray(data.unstaged)) this.unstaged = data.unstaged;
    if (typeof data.unstagedPrunedThrough === "number") this.unstagedPrunedThrough = data.unstagedPrunedThrough;
    if (data.origin) this.origin = data.origin;
    if (data.review) this.review = data.review;
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
      ...(this.origin ? { origin: this.origin } : {}),
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
