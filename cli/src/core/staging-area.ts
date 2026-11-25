/**
 * StagingAreaManager - Manages staged changesets and interception logic
 *
 * Provides:
 * - Changeset lifecycle management (create, load, list, delete)
 * - Staging operations (stage, unstage, discard)
 * - Commit operations with drift detection and validation
 * - Base snapshot tracking for drift detection
 */

import path from "path";
import ansis from "ansis";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";
import { clearActiveMarker, readActiveMarker, readLandedNote, writeActiveMarker, writeLandedNote } from "./active-changeset-marker.js";
import { changesetNotStagedError, landedActiveChangesetError, landingLockOwner } from "./changeset-write-refusal.js";
import { BaseSnapshotManager } from "./base-snapshot-manager.js";
import { Changeset, StagedChange, withSequenceNumbers, type ChangesetStatus } from "./changeset.js";
import { ChangesetValidator } from "./changeset-validator.js";
import { fileExists } from "../utils/file-io.js";
import { trackModelWrite } from "./model-write-tracker.js";
import type { Model } from "./model.js";
import type { VirtualProjectionEngine } from "./virtual-projection.js";
import { createSha256Hash } from "../types/index.js";
import type { BackupManifest, ReconciledStamp } from "../types/index.js";
import { reconciliationStamp } from "./reconciliation.js";
import { getErrorMessage } from "../utils/errors.js";
import { FileLock } from "../utils/file-lock.js";
import type { BaseRead, ChangesetDrift } from "./changeset-base-index.js";
import { Layer } from "./layer.js";
import type { CommitProgress } from "./commit-progress.js";
import { canonicalStagedSnapshot } from "./staged-source-reference.js";
import { elementIdentifiers, Relationships } from "./relationships.js";
import { isValidLayerName } from "./layers.js";
import {
  isTelemetryEnabled,
  startSpan,
  startActiveSpan,
  endSpan,
  emitLog,
  SeverityNumber,
} from "../telemetry/index.js";
import { ModelReportOrchestrator } from "../reports/model-report-orchestrator.js";
import type { ChangesetOrigin } from "./changeset-review.js";
import {
  creationPurpose,
  extractionOrigin,
  purposeOf,
  VerificationRecordLandingError,
  UpgradeRecordLandingError,
  UpgradeRecordActivationError,
  type RecordLandingError,
  type ChangesetPurposeInfo,
  type PurposeDeclaration,
} from "./changeset-purpose.js";

/**
 * Options for commit operation
 */
export interface CommitOptions {
  /**
   * @deprecated Ignored. Drift no longer refuses a commit (#1200), so there is nothing to force:
   * a drifted changeset lands and the result says what overlapped. Accepted for one release.
   */
  force?: boolean;
  validate?: boolean; // Run validation (default: true)
  dryRun?: boolean; // Preview without applying
  /**
   * Called with each step of a real commit (never a dry run): `validating` with the total, then
   * `applying` as each change starts (the changes before it handled, its layer) and once all are,
   * then `saving` (issue 1361). Wrap it in
   * a reporter (core/commit-progress.ts) to throttle it. A callback that throws is ignored.
   */
  onProgress?: (progress: CommitProgress) => void;
}

/**
 * Whether the base model moved under a changeset in a way that matters to it
 * (`StagingAreaManager.detectDrift`). A warning for the landing, never a refusal: what overlaps,
 * and what landing does about it, is `describeDrift`'s to say (changeset-base-index.ts).
 */
export interface DriftReport {
  /**
   * True when the base overlaps a staged change, or its hash changed and there is no base index to
   * tell whether it does. The landing goes ahead and reports it.
   */
  isDrifted: boolean;
  baseSnapshotId: string;
  /** The base's hash now, in the format `baseSnapshotId` was recorded in. */
  currentSnapshotId: string;
  warnings: string[];
  /**
   * Set when the base hash differs but the base overlaps nothing the changeset stages (see
   * `contentFreeDrift` in changeset-base-index.ts): isDrifted is false and the landing has no
   * drift warning.
   */
  contentFree?: true;
  /**
   * What the check read to decide: the staged changes the base overlaps and what changed in the
   * base (`describeDrift`, without its one-line summary of the overlaps). Present whenever the base
   * hash changed or the changeset was re-baselined, so a caller that wants the detail does not
   * describe the same drift a second time.
   */
  described?: ChangesetDrift;
}

/** What `StagingAreaManager.rebaseline` did: the changeset's drift before and after, and its base hashes. */
export interface RebaselineResult {
  changeset: { id: string; name: string };
  /** False for a preview: nothing was written, and the changeset's base is still the previous one. */
  applied: boolean;
  previousBaseSnapshot: string | null;
  /** The base hash the changeset has now, or would have (a preview). */
  baseSnapshot: string;
  /** The drift as it read before the re-baseline: what moved under the changeset since its previous base. */
  before: ChangesetDrift;
  /** The drift as it reads now. Its overlaps are true against the base as it is, and stay until the plan resolves them. */
  after: ChangesetDrift;
}

/**
 * Result of commit operation
 */
export interface CommitResult {
  changeset: string;
  committed: number;
  skipped?: number;
  skippedDetails?: string[];
  failed: number;
  validation: {
    passed: boolean;
    errors: string[];
    /** Whether validation ran (false when the caller passed validate: false). */
    ran?: boolean;
    /**
     * Errors the base model already had that the changeset leaves in place. They are
     * reported, not blocking: commit judges the change, not the base.
     */
    preExistingErrors?: number;
    /** A sample of the pre-existing errors' messages (first 10). */
    preExistingSample?: string[];
    /** Set when the base model could not be validated, so every error blocked. */
    baseValidationFailure?: string;
  };
  /** Set when the base drifted under the changeset (it lands all the same; see driftDetail). */
  driftWarning?: DriftReport;
  /**
   * With driftWarning: the staged changes the base overlapped when this landed (or would, on a dry
   * run), each with what landing does about it, and what changed in the base. Absent when the
   * drift could not be described.
   */
  driftDetail?: ChangesetDrift;
  /**
   * True when the landed changeset was the active one and its active marker was cleared. False
   * when it was not active, on a dry run, or when clearing failed (see deactivationError).
   */
  deactivated: boolean;
  /**
   * Set when the landed changeset was active and its on-disk marker could not be cleared. The model
   * passed to commit is already deactivated; only the marker remains, so a model loaded afterwards
   * still projects the changeset and writes through it still stage into it until it is deactivated.
   */
  deactivationError?: string;
  /**
   * Set when the landing reconciled the model with the code: an as-built changeset staged by
   * codebase_extract (a bootstrap or a keep-as-built catch-up). The stamp written to the manifest.
   * A plan's landing leaves it unset and the manifest's stamp as it was. See core/reconciliation.ts.
   */
  reconciled?: ReconciledStamp;
}

/**
 * How long a landing waits for a write in progress to finish before it gives up (a write holds the
 * changeset's lock for one load and save).
 */
const LANDING_LOCK_TIMEOUT_MS = 30_000;

/**
 * StagingAreaManager provides changeset and staging operations
 */
export class StagingAreaManager {
  private storage: StagedChangesetStorage;
  private snapshotManager: BaseSnapshotManager;
  private validator: ChangesetValidator;
  private projectionEngine: VirtualProjectionEngine | null = null;
  private rootPath: string;
  private model: Model | null = null;

  constructor(rootPath: string, model?: Model) {
    this.rootPath = rootPath;
    this.model = model || null;
    this.storage = new StagedChangesetStorage(rootPath);
    this.snapshotManager = new BaseSnapshotManager();
    this.validator = new ChangesetValidator(rootPath);
    this.projectionEngine = null; // Lazy loaded on first call to getProjectionEngine()
  }

  /**
   * Validate changeset ID format and content
   * Ensures ID is safe and provides early validation before file operations
   *
   * Validation rules:
   * - Must be a non-empty string
   * - Cannot contain path separators (.., /, \)
   * - Cannot contain special characters (<>:"|?*)
   * - During storage, the ID will be normalized: lowercase, spaces→hyphens, non-alphanumeric→stripped
   *
   * @param changesetId - The changeset ID to validate
   * @throws Error if ID contains invalid characters or structure
   */
  private validateChangesetId(changesetId: string): void {
    if (!changesetId || typeof changesetId !== "string") {
      throw new Error("Changeset ID must be a non-empty string");
    }

    if (changesetId.trim() === "") {
      throw new Error("Changeset ID cannot be empty or whitespace-only");
    }

    // Check for path traversal attempts
    if (changesetId.includes("..") || changesetId.includes("/") || changesetId.includes("\\")) {
      throw new Error("Changeset ID cannot contain path separators or traversal sequences (..)");
    }

    // Check for special characters that could cause issues
    // Note: sanitizeId() will normalize the ID by converting to lowercase, replacing spaces with hyphens,
    // and removing all non-alphanumeric characters (except hyphens)
    if (/[<>:"|?*]/.test(changesetId)) {
      throw new Error(
        'Changeset ID contains invalid special characters (<>:"|?*). ' +
          "Only alphanumeric characters and hyphens are preserved. " +
          "Spaces are converted to hyphens, and other characters are removed during storage."
      );
    }
  }

  /**
   * Get or create projection engine instance (lazy initialization).
   * Deferred initialization avoids circular dependency issues at module load time.
   * @returns VirtualProjectionEngine instance for computing merged model views
   */
  private async getProjectionEngine(): Promise<VirtualProjectionEngine> {
    // Share the model's engine when there is one: its cache is the one `model.getLayer()`
    // reads, so staging must invalidate that cache, not a private copy. Otherwise a model
    // held across calls (the MCP server's) serves pre-stage layers until the cache expires.
    if (!this.projectionEngine && typeof this.model?.getVirtualProjectionEngine === "function") {
      this.projectionEngine = this.model.getVirtualProjectionEngine();
    }
    if (!this.projectionEngine) {
      const { VirtualProjectionEngine } = await import("./virtual-projection.js");
      this.projectionEngine = new VirtualProjectionEngine(this.rootPath);
    }
    return this.projectionEngine;
  }

  /**
   * Create a new staged changeset. It declares its purpose (changeset-purpose.ts): the one given,
   * else the one creationPurpose gives for its origin (the extraction's when codebase_extract's
   * waiting cards name it, `chat` for DrBot, else `plan`).
   */
  async create(
    name: string,
    description?: string,
    origin?: ChangesetOrigin,
    purpose?: PurposeDeclaration
  ): Promise<Changeset> {
    if (!this.model) {
      throw new Error("Model required for creating changesets");
    }
    const id = this.generateChangesetId();
    // The base hash is the hash of the base index, so both come from one read of the base.
    const { captureBaseIndex, writeBaseIndex, snapshotOfIndex } = await import("./changeset-base-index.js");
    const baseIndex = await captureBaseIndex(this.model);
    const baseSnapshotId = snapshotOfIndex(baseIndex);
    const declared = purpose ?? (await creationPurpose(this.rootPath, name, origin));

    const changeset = await this.storage.create(id, name, description, baseSnapshotId, origin, declared);
    changeset.id = id;

    // Mark as 'staged' so it can accept changes immediately
    changeset.markStaged();
    await this.storage.save(changeset);

    // Record which elements and relationships the base has now, so verify and brief can tell what
    // predates the plan. Optional: without it they fall back and say so, so a failure is reported,
    // not fatal.
    try {
      await writeBaseIndex(this.rootPath, changeset.id, baseIndex);
    } catch (error) {
      console.warn(
        `Warning: could not record the base index for changeset '${name}': ${getErrorMessage(error)}. ` +
          "Verify and brief will fall back to what they can tell without it."
      );
    }

    return changeset;
  }

  /**
   * Load a changeset by name or ID
   */
  async load(name: string): Promise<Changeset | null> {
    // Try loading directly as ID first
    let changeset = await this.storage.load(name);
    if (changeset) {
      return changeset;
    }

    // If not found by ID, search by name in all changesets
    const all = await this.storage.list();
    return all.find((cs) => cs.name === name) || null;
  }

  /**
   * List all staged changesets
   */
  async list(): Promise<Changeset[]> {
    return this.storage.list();
  }

  /**
   * Delete a changeset
   * If the changeset being deleted is the currently active changeset,
   * this method will also clear the active changeset marker.
   */
  async delete(name: string): Promise<void> {
    const changeset = await this.load(name);
    if (!changeset) {
      throw new Error(`Changeset '${name}' not found`);
    }

    if (!changeset.id) {
      throw new Error(`Changeset '${name}' has no ID and cannot be deleted`);
    }

    // Check if this changeset is the active one and clear it if so
    if ((await this.readActiveMarker()) === changeset.id) {
      await this.clearActive();
    }

    await this.storage.delete(changeset.id);
  }

  /**
   * Rename a changeset and/or change its description (its stated intent). Staged changes,
   * status and the active marker are untouched. Names stay unique: renaming to a name another
   * changeset already has is refused.
   *
   * @param nameOrId - Changeset ID or current name
   * @param patch - Fields to change; an empty description clears it
   * @throws Error if the changeset is not found, or the new name is taken
   */
  async update(nameOrId: string, patch: { name?: string; description?: string }): Promise<Changeset> {
    const changeset = await this.load(nameOrId);
    if (!changeset || !changeset.id) {
      throw new Error(`Changeset '${nameOrId}' not found`);
    }
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) {
        throw new Error("Changeset name cannot be empty");
      }
      const clash = (await this.storage.list()).find((cs) => cs.name === name && cs.id !== changeset.id);
      if (clash) {
        throw new Error(`Another changeset (${clash.id}) is already named '${name}'`);
      }
      patch = { ...patch, name };
    }
    return this.storage.updateMetadata(changeset.id, patch);
  }

  /**
   * Declare a changeset's purpose, replacing the one declared before (codebase_extract, when it
   * stages into a changeset it didn't create, makes it extraction's).
   */
  async declarePurpose(nameOrId: string, declaration: PurposeDeclaration): Promise<Changeset> {
    const changeset = await this.load(nameOrId);
    if (!changeset || !changeset.id) {
      throw new Error(`Changeset '${nameOrId}' not found`);
    }
    return this.storage.declarePurpose(changeset.id, declaration);
  }

  /** The changeset's purpose: declared, or inferred for one made before purposes were declared. */
  async purposeOf(changeset: Changeset): Promise<ChangesetPurposeInfo> {
    return purposeOf(this.rootPath, changeset);
  }

  /**
   * The refusal to land this changeset for what it is, or null when its purpose lets it land. A
   * record is never landed, with force or without. A verification record (codebase_extract's
   * as-built reading of a branch, compared with a plan): landing it would add extraction's raw
   * reading of the branch to the model, and it read only the branch's changes, so it doesn't
   * reconcile drift. An upgrade record (the relationships a spec migration dropped): the model
   * no longer has them, so its staged deletes have nothing to delete.
   */
  async landingRefusal(changeset: Changeset): Promise<RecordLandingError | null> {
    const info = await purposeOf(this.rootPath, changeset);
    if (info.purpose === "upgrade-record") return new UpgradeRecordLandingError(changeset.name);
    if (info.purpose !== "verification") return null;
    let plan: { id: string; name: string } | undefined;
    if (info.verifies) {
      const loaded = await this.load(info.verifies).catch(() => null);
      if (loaded) plan = { id: info.verifies, name: loaded.name };
    }
    if (!plan) {
      // The plan is gone (discarded), or no plan is declared: the name the extraction record keeps.
      const origin = await extractionOrigin(this.rootPath, changeset);
      plan = origin.previousActive ?? (info.verifies ? { id: info.verifies, name: info.verifies } : undefined);
    }
    return new VerificationRecordLandingError(changeset.name, plan);
  }

  /**
   * Stage a change in the changeset.
   * Records the change in the staging area without applying to the base model.
   * The changeset must be in 'staged' status to accept new changes.
   *
   * @param changesetId - ID of the changeset to stage the change in
   * @param change - The change to stage (type, elementId, layerName, before/after snapshots)
   * @throws Error if changeset ID is invalid, changeset not found, or not in 'staged' status
   */
  async stage(changesetId: string, change: Omit<StagedChange, "sequenceNumber">): Promise<void> {
    this.validateChangesetId(changesetId);

    const changeset = await this.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    // Only allow staging when status is 'staged' (not 'committed' or 'discarded')
    if (changeset.status !== "staged") {
      throw changesetNotStagedError(changeset);
    }

    const stagedChange: Omit<StagedChange, "sequenceNumber"> = {
      ...change,
      timestamp: change.timestamp || new Date().toISOString(),
    };

    await this.storage.addChange(changesetId, stagedChange);

    // A model held across calls (the MCP server's) lists its layers from what was staged when it
    // loaded: tell it about an element change in a layer it may not have, so lookups find it.
    if (!change.type.startsWith("relationship-") && typeof this.model?.noteStagedLayer === "function") {
      this.model.noteStagedLayer(changesetId, change.layerName);
    }

    // Invalidate projection cache for this layer
    const engine = await this.getProjectionEngine();
    engine.invalidateOnStage(changesetId, change.layerName);
  }

  /**
   * Stage several changes in one write, in order (see {@link stage}), and rewrite staged ones in
   * place (see {@link restage}) in the same write. The changeset must be in 'staged' status.
   */
  async stageMany(
    changesetId: string,
    changes: Array<Omit<StagedChange, "sequenceNumber">>,
    rewrites: Array<{ elementId: string; change: Omit<StagedChange, "sequenceNumber"> }> = []
  ): Promise<void> {
    if (changes.length === 0 && rewrites.length === 0) return;
    this.validateChangesetId(changesetId);
    const changeset = await this.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }
    if (changeset.status !== "staged") {
      throw changesetNotStagedError(changeset);
    }
    const now = new Date().toISOString();
    await this.storage.addChanges(
      changesetId,
      changes.map((change) => ({ ...change, timestamp: change.timestamp || now })),
      rewrites.map((r) => ({ elementId: r.elementId, change: { ...r.change, timestamp: r.change.timestamp || now } }))
    );
    const engine = await this.getProjectionEngine();
    for (const layerName of new Set([...changes, ...rewrites.map((r) => r.change)].map((c) => c.layerName))) {
      engine.invalidateOnStage(changesetId, layerName);
    }
    if (typeof this.model?.noteStagedLayer === "function") {
      for (const change of changes) {
        if (!change.type.startsWith("relationship-")) this.model.noteStagedLayer(changesetId, change.layerName);
      }
    }
  }

  /**
   * Rewrite a staged change in place, keeping its sequence number: e.g. to fold an update of an
   * element into the changeset's add of it. The changeset must be in 'staged' status.
   *
   * @param elementId - The key (`elementId`) of the change to rewrite
   * @throws Error if the changeset is not found, not staged, or has no change with that key
   */
  async restage(
    changesetId: string,
    elementId: string,
    change: Omit<StagedChange, "sequenceNumber">
  ): Promise<void> {
    this.validateChangesetId(changesetId);

    const changeset = await this.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }
    if (changeset.status !== "staged") {
      throw changesetNotStagedError(changeset);
    }

    await this.storage.updateChange(changesetId, elementId, {
      ...change,
      timestamp: change.timestamp || new Date().toISOString(),
    });

    const engine = await this.getProjectionEngine();
    engine.invalidateOnStage(changesetId, change.layerName);
  }

  /**
   * Unstage a specific element from the changeset.
   * Removes all changes associated with the element.
   * The changeset must be in 'staged' status.
   *
   * @param changesetId - ID of the changeset to unstage from
   * @param elementId - ID of the element to remove all changes for
   * @throws Error if changeset ID is invalid, changeset not found, or not in 'staged' status
   */
  async unstage(changesetId: string, elementId: string): Promise<void> {
    this.validateChangesetId(changesetId);

    const changeset = await this.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    if (changeset.status !== "staged") {
      throw changesetNotStagedError(changeset);
    }

    // Remove the element's changes and resequence remaining changes
    await this.storage.removeChange(changesetId, elementId);

    // Invalidate projection cache for the removed element's layers
    const engine = await this.getProjectionEngine();
    await engine.invalidateOnUnstage(changesetId, elementId);
  }

  /**
   * Unstage several elements' changes in one write (one revision), e.g. a batch unstage.
   * The changeset must be in 'staged' status.
   *
   * @param changesetId - ID of the changeset to unstage from
   * @param elementIds - change keys (element IDs, or relationship change keys) to remove
   * @throws Error if changeset ID is invalid, changeset not found, or not in 'staged' status
   */
  async unstageMany(changesetId: string, elementIds: string[]): Promise<void> {
    if (elementIds.length === 0) return;
    if (elementIds.length === 1) return this.unstage(changesetId, elementIds[0]);
    this.validateChangesetId(changesetId);

    const changeset = await this.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }
    if (changeset.status !== "staged") {
      throw changesetNotStagedError(changeset);
    }

    await this.storage.removeChanges(changesetId, elementIds);

    // Several elements, possibly in several layers: drop every projection of this changeset.
    const engine = await this.getProjectionEngine();
    await engine.invalidateOnUnstage(changesetId);
  }

  /**
   * Unstage the changes with these sequence numbers in one write (one revision), leaving other
   * changes to the same elements staged: e.g. the changes a reviewer dropped before a commit.
   * The changeset must be in 'staged' status.
   *
   * @returns The revision the unstage took (its tombstones' `removedAt`), or undefined if nothing matched
   */
  async unstageSequences(changesetId: string, sequences: number[]): Promise<number | undefined> {
    if (sequences.length === 0) return undefined;
    this.validateChangesetId(changesetId);
    const changeset = await this.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }
    if (changeset.status !== "staged") {
      throw changesetNotStagedError(changeset);
    }
    const removedAt = await this.storage.removeChangesBySequence(changeset.id, sequences);
    const engine = await this.getProjectionEngine();
    await engine.invalidateOnUnstage(changeset.id);
    return removedAt;
  }

  /**
   * Discard a changeset: deletes it, its staged changes and its folder under
   * documentation-robotics/changesets/, and clears the active marker if it named it.
   * This operation is irreversible for the changeset but does not affect the base model.
   * Nothing is written to the manifest (a manifest write would drift every other staged changeset).
   *
   * @param changesetId - ID of the changeset to discard
   * @throws Error if changeset ID is invalid, changeset not found, or it is committed
   */
  async discard(changesetId: string): Promise<void> {
    this.validateChangesetId(changesetId);

    const changeset = await this.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }
    if (changeset.status === "committed") {
      throw new Error(`Changeset '${changeset.name}' is committed; only a staged changeset can be discarded`);
    }
    const id = changeset.id ?? changesetId;

    // The active marker must not name a folder that is gone: the model would stage into nothing.
    if ((await this.readActiveMarker()) === id) {
      await this.clearActive();
    }
    // No record is kept: a discarded changeset left as a folder is an artifact nothing owns.
    await this.storage.delete(id);

    // Invalidate all projection cache entries for this changeset
    const engine = await this.getProjectionEngine();
    engine.invalidateOnDiscard(changesetId);
  }

  /**
   * Capture a base snapshot of the current model state for drift detection.
   * Stores a hash of the model that can be compared later to detect changes.
   *
   * @param changesetId - ID of the changeset to capture snapshot for
   * @returns SHA256 hash of the current model state
   * @throws Error if changeset not found or model not available
   */
  async captureBaseSnapshot(changesetId: string): Promise<string> {
    this.validateChangesetId(changesetId);

    if (!this.model) {
      throw new Error("Model required for capturing base snapshot");
    }
    const changeset = await this.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    const snapshotId = await this.snapshotManager.captureSnapshot(this.model);
    changeset.baseSnapshot = snapshotId;
    changeset.updateModified();
    await this.storage.save(changeset);

    return snapshotId;
  }

  /**
   * Whether the base model moved under a changeset in a way that matters to it.
   *
   * @param changesetId - ID of the changeset to check for drift
   * @returns DriftReport with isDrifted flag, snapshot hashes, and warnings
   * @throws Error if changeset ID is invalid, changeset not found, or model not available
   *
   * @remarks
   * Compares the base hash recorded for the changeset with the base's hash now, made the same way
   * (a changeset created before CLI 0.7.0 recorded a hash of the whole model, manifest included;
   * see base-snapshot-manager.ts). When they differ, the changeset's base index decides whether
   * the base overlaps anything it stages: if not, the drift is content-free (isDrifted=false,
   * contentFree=true). Without a base index it stays drift, since the two can't be told apart.
   * Returns isDrifted=false and warnings if no base snapshot was captured.
   *
   * The answer never refuses a landing (#1200): commit reports it in its result.
   */
  async detectDrift(changesetOrId: string | Changeset, options: { base?: BaseRead } = {}): Promise<DriftReport> {
    if (!this.model) {
      throw new Error("Model required for drift detection");
    }
    // A caller that already holds the changeset passes it, and it is not read from disk again.
    let changeset: Changeset | null;
    if (typeof changesetOrId === "string") {
      this.validateChangesetId(changesetOrId);
      changeset = await this.load(changesetOrId);
      if (!changeset) {
        throw new Error(`Changeset '${changesetOrId}' not found`);
      }
    } else {
      changeset = changesetOrId;
    }

    if (!changeset.baseSnapshot) {
      return {
        isDrifted: false,
        baseSnapshotId: "unknown",
        currentSnapshotId: "unknown",
        warnings: ["No base snapshot available for drift detection"],
      };
    }

    // With a shared read of the base (readBase), the base is indexed and hashed once for every
    // changeset checked against it.
    const currentSnapshotId = options.base
      ? await options.base.snapshotLike(changeset.baseSnapshot)
      : await this.snapshotManager.captureSnapshotLike(this.model, changeset.baseSnapshot);
    const hashChanged = changeset.baseSnapshot !== currentSnapshotId;
    const warnings: string[] = [];

    // The base index tells a base change that overlaps a staged change from one that doesn't
    // (another changeset landing elsewhere in the model). With the hash unchanged there is nothing
    // to tell, except after a re-baseline: a staged change made on older content of an element
    // is still an overlap then, though the base is as the changeset last recorded it.
    let contentFree: string | undefined;
    let overlaps = false;
    let described: ChangesetDrift | undefined;
    try {
      const { describeDrift, contentFreeSentence, tryReadBaseIndex } = await import("./changeset-base-index.js");
      if (hashChanged || (await tryReadBaseIndex(this.rootPath, changeset.id!)).index?.rebaselined) {
        const { ChangesetGraph } = await import("./changeset-graph.js");
        described = await describeDrift(this.model, await ChangesetGraph.build(this.model, changeset), undefined, {
          overlapWarning: false,
          base: options.base,
        });
        // Something that could not be checked is never reported as no drift (review of PR 1272):
        // every confirmation states it.
        overlaps =
          described.overlapping.elements.length + described.overlapping.relationships.length > 0 ||
          described.notChecked !== undefined;
        if (hashChanged) contentFree = contentFreeSentence(described);
      }
    } catch (error) {
      warnings.push(`Could not compare the base with the changeset's base index: ${getErrorMessage(error)}`);
    }

    if (hashChanged && contentFree) {
      return {
        isDrifted: false,
        baseSnapshotId: changeset.baseSnapshot,
        currentSnapshotId,
        warnings: [contentFree],
        contentFree: true,
        ...(described ? { described } : {}),
      };
    }

    const isDrifted = hashChanged || overlaps;
    if (isDrifted) {
      warnings.push(
        described?.notChecked && described.overlapping.elements.length + described.overlapping.relationships.length === 0
          ? `Part of what this changeset stages could not be checked against the base. ${described.notChecked.sentence}`
          : overlaps
          ? "The base model overlaps what this changeset stages"
          : "The base model changed since this changeset was created, and it has no base index to tell whether that overlaps what it stages"
      );
    }

    return {
      isDrifted,
      baseSnapshotId: changeset.baseSnapshot,
      currentSnapshotId: currentSnapshotId,
      warnings,
      ...(described ? { described } : {}),
    };
  }

  /**
   * Reads the base model once, to share across the drift checks of several changesets
   * (`detectDrift`'s `base`, and `driftStatus` / `driftDetail`): the base is indexed and hashed
   * once instead of once per changeset. Good for as long as the model in hand is: read it again
   * after anything writes the model.
   */
  async readBase(): Promise<BaseRead> {
    if (!this.model) {
      throw new Error("Model required for reading the base");
    }
    const { BaseRead } = await import("./changeset-base-index.js");
    return BaseRead.of(this.model);
  }

  /**
   * Re-baseline a staged changeset: make the base model as it is now its base. Records the current
   * base hash and base index, and returns the drift as it read before (what moved under the
   * changeset since its previous base) and as it reads after.
   *
   * It changes no staged change. An overlap that is true against the base as it is now stays one:
   * a change made on older content of an element (`changed-in-base`), an add of what the base has,
   * a delete of what it lacks, a delete that would purge a relationship the plan stages no delete
   * for (`linked-in-base`), a link to an element it removed. Every element overlap is read from the
   * base as it is now and from what the staged change recorded, not from the base index, so no
   * re-baseline clears one. What it clears is what only the previous base could say: the list of
   * base changes since. It is a visible act: the base index records when it happened and from
   * which base hash to which, the drift detail carries that (`rebaselined`), and the landing
   * summary says so.
   *
   * What moved (`before.baseChanges`) cannot be read again once the re-baseline is applied, so
   * `preview` returns the same result and writes nothing, and `limit` and `offset` page its lists
   * (`before.baseChanges.page`). The counts and the overlaps are whole whatever the page.
   *
   * @throws Error for a changeset that is not staged, or a record (which never lands)
   */
  async rebaseline(
    changesetId: string,
    options: { preview?: boolean; limit?: number; offset?: number } = {}
  ): Promise<RebaselineResult> {
    this.validateChangesetId(changesetId);
    if (!this.model) {
      throw new Error("Model required for re-baselining a changeset");
    }
    const model = this.model;
    const { BaseRead, describeDrift, elementsWithoutRecordedBase, readBaseIndex, snapshotOfIndex, writeBaseIndex } =
      await import("./changeset-base-index.js");
    const { ChangesetGraph } = await import("./changeset-graph.js");

    const id = (await this.load(changesetId))?.id;
    if (!id) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }
    // Under the changeset's file lock, on a fresh read: nothing staged meanwhile is saved over.
    return new FileLock(this.storage.getChangesetPath(id)).withLock(async () => {
      const changeset = await this.storage.load(id);
      if (!changeset) {
        throw new Error(`Changeset '${changesetId}' not found`);
      }
      if (changeset.status !== "staged") {
        throw new Error(`Changeset '${changeset.name}' is ${changeset.status}; only a staged changeset can be re-baselined`);
      }
      const refusal = await this.landingRefusal(changeset);
      if (refusal) {
        throw new Error(`Changeset '${changeset.name}' is a record, which never lands, so it has no base to move`);
      }

      // One read of the base serves the description before, the new index and the description after.
      const base = await BaseRead.of(model);
      const graph = await ChangesetGraph.build(model, changeset);
      const before = await describeDrift(model, graph, undefined, {
        overlapWarning: false,
        base,
        limit: options.limit,
        offset: options.offset,
      });

      let previous: Awaited<ReturnType<typeof readBaseIndex>>;
      try {
        previous = await readBaseIndex(this.rootPath, id);
      } catch {
        // An unreadable index is replaced.
      }
      const previousBaseSnapshot = changeset.baseSnapshot || null;
      // A staged change that records no element it was made on is compared with the base through
      // the index alone. The new index keeps the old entry for such an element, so a base edit since
      // still reads as one; with no old entry it lists the element as unchecked. Either way a
      // re-baseline can't make it read as current (review of PR 1272, finding 1).
      const elements = { ...base.index.elements };
      const unchecked = new Set(previous?.unchecked ?? []);
      for (const id of elementsWithoutRecordedBase(changeset, (ref) => graph.resolve(ref))) {
        if (!(id in elements)) continue;
        // The earlier entry is kept whenever there is one, unchecked or not: it is the content seen
        // at the first re-baseline, so a base edit after it reads as changed-in-base, however many
        // re-baselines follow. With no earlier entry the content now is recorded, and the element is
        // listed as unchecked, since what the change was made on is unknown.
        if (previous && id in previous.elements) elements[id] = previous.elements[id];
        else unchecked.add(id);
      }
      const index = {
        ...base.index,
        elements,
        ...(unchecked.size > 0 ? { unchecked: [...unchecked].sort() } : {}),
        rebaselined: {
          at: base.index.captured,
          from: previousBaseSnapshot ?? "unknown",
          to: base.contentSnapshot,
          times: (previous?.rebaselined?.times ?? 0) + 1,
        },
      };
      const baseSnapshot = snapshotOfIndex(index);
      // The drift as it reads with the base as it is now for a base: what a re-baseline leaves.
      const after = await describeDrift(model, graph, undefined, { overlapWarning: false, base, since: index });

      if (options.preview !== true) {
        // The index first: if the hash's save fails, the changeset still reads as drifted, with an
        // index that says the base is as it is now.
        await writeBaseIndex(this.rootPath, id, index);
        changeset.baseSnapshot = baseSnapshot;
        changeset.updateModified();
        await this.storage.save(changeset);
      }

      return {
        changeset: { id, name: changeset.name },
        applied: options.preview !== true,
        previousBaseSnapshot,
        baseSnapshot,
        before,
        after,
      };
    });
  }

  /**
   * Commit a changeset to the base model with atomic guarantee.
   * Applies all staged changes and persists them to the base model.
   *
   * Implements atomic commit with the following steps:
   * 1. Detect drift in base model (reported in the result; never a refusal)
   * 2. Validate projected model (schema, references, semantics)
   * 3. Create backup of current model state
   * 4. Apply all changes in sequence order
   * 5. Save all modified layers to disk
   * 6. Update changeset status and manifest history
   * 7. Cleanup backup on success, restore on failure
   *
   * @param model - The model to commit changes to
   * @param changesetId - ID of the changeset to commit
   * @param options - Commit options (validate, dryRun; force is ignored)
   * @returns CommitResult with count of committed/failed changes, validation status and any drift
   * @throws Error if validation fails or the commit fails
   *
   * @remarks
   * Validation errors always block commit.
   * Drift never does (#1200): a drifted changeset lands, and the result's driftWarning and
   * driftDetail say what the base overlapped and what landing did about it.
   * A record (purpose `verification` or `upgrade-record`) is refused (landingRefusal).
   * Dry-run mode performs all checks but does not persist changes.
   * On commit failure, model state is restored from backup; rollback failure triggers CRITICAL error.
   */
  async commit(
    model: Model,
    changesetId: string,
    options: CommitOptions = {}
  ): Promise<CommitResult> {
    // The whole landing is one tracked write: a reader in this process doesn't read the model while
    // it is half landed (or being restored from the backup). A dry run writes nothing.
    if (options.dryRun === true) return this.commitUntracked(model, changesetId, options);
    return trackModelWrite(this.rootPath, undefined, () => this.commitLocked(model, changesetId, options));
  }

  /**
   * A real landing, under the changeset's file lock from the read of what it lands to the save that
   * marks it committed (#1437). Every stage, restage and unstage takes the same lock, so a write
   * either goes in before the landing reads the changeset, and lands with it, or is refused: at
   * once while the landing holds the lock (its owner says so), and as no longer staged after. None
   * is saved over. The lock is kept fresh for as long as the landing takes.
   */
  private async commitLocked(model: Model, changesetId: string, options: CommitOptions): Promise<CommitResult> {
    this.validateChangesetId(changesetId);
    const changeset = await this.load(changesetId);
    if (!changeset?.id) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }
    return new FileLock(this.storage.getChangesetPath(changeset.id)).withLock(
      () => this.commitUntracked(model, changeset.id!, options),
      { owner: landingLockOwner(changeset), heartbeat: true, timeout: LANDING_LOCK_TIMEOUT_MS }
    );
  }

  private async commitUntracked(
    model: Model,
    changesetId: string,
    options: CommitOptions
  ): Promise<CommitResult> {
    return startActiveSpan("staging.commit", async (span) => {
      this.validateChangesetId(changesetId);

      const changeset = await this.load(changesetId);
      if (!changeset) {
        throw new Error(`Changeset '${changesetId}' not found`);
      }

      (span as any).setAttribute("changeset.name", changeset.name);
      (span as any).setAttribute("changeset.changeCount", changeset.changes.length);

      // Landed (or discarded) meanwhile, by another landing that held the lock first: never twice.
      if (changeset.status !== "staged") {
        throw new Error(`Changeset '${changeset.name}' is ${changeset.status}; only a staged changeset can be committed`);
      }

      // Step 0: A record never lands, dry run or not.
      const refusal = await this.landingRefusal(changeset);
      if (refusal) {
        emitLog(SeverityNumber.ERROR, "Commit refused: the changeset is a record, which never lands", {
          "changeset.name": changeset.name,
        });
        throw refusal;
      }

      const isDryRun = options.dryRun === true;
      const shouldValidate = options.validate !== false;

      // Progress for a real commit (issue 1361): every staged change is handled once (applied, or
      // skipped as already in the base), so `total` is known before anything is written.
      const total = changeset.changes.length;
      const report = (progress: Omit<CommitProgress, "changesetId" | "total">) => {
        if (isDryRun || !options.onProgress) return;
        try {
          options.onProgress({ changesetId, total, ...progress });
        } catch {
          // Progress is advisory: a failing listener never fails the commit.
        }
      };
      report({ applied: 0, phase: "validating" });

      // Step 1: Detect drift. It is a warning, not a refusal (#1200): the landing goes ahead and
      // the result says what overlapped, read here, before the changes apply.
      const driftSpan = isTelemetryEnabled ? startSpan("staging.detectDrift") : null;
      const drift = await this.detectDrift(changesetId);
      if (isTelemetryEnabled && driftSpan) {
        (driftSpan as any).setAttribute("drift.detected", drift.isDrifted);
        (driftSpan as any).setAttribute("drift.baseSnapshotId", drift.baseSnapshotId);
        (driftSpan as any).setAttribute("drift.currentSnapshotId", drift.currentSnapshotId);
        (driftSpan as any).setStatus({ code: 0 });
      }
      endSpan(driftSpan);

      let driftDetail: ChangesetDrift | undefined;
      if (drift.isDrifted) {
        (span as any).setAttribute("commit.driftDetected", true);
        emitLog(SeverityNumber.WARN, "Drift detected; the changeset lands with a warning", {
          "drift.baseSnapshot": drift.baseSnapshotId,
          "drift.currentSnapshot": drift.currentSnapshotId,
        });
        try {
          // detectDrift described it to decide; without that (its comparison failed) describe it here.
          const { describeDrift, describedAsDrifted } = await import("./changeset-base-index.js");
          if (drift.described) {
            driftDetail = describedAsDrifted(drift.described);
          } else {
            const { ChangesetGraph } = await import("./changeset-graph.js");
            driftDetail = await describeDrift(model, await ChangesetGraph.build(model, changeset), drift, {
              overlapWarning: false,
            });
          }
        } catch (error) {
          emitLog(SeverityNumber.WARN, "Could not describe the drift a changeset lands over", {
            "changeset.id": changesetId,
            "error.message": getErrorMessage(error),
          });
        }
      }

      const result: CommitResult = {
        changeset: changeset.name,
        committed: 0,
        skipped: 0,
        skippedDetails: [],
        failed: 0,
        validation: {
          passed: true,
          errors: [],
          ran: shouldValidate,
        },
        deactivated: false,
        ...(drift.isDrifted ? { driftWarning: drift } : {}),
        ...(driftDetail ? { driftDetail } : {}),
      };

      // Step 2: Validate the change (nothing overrides validation). Only errors the
      // changeset introduces block; errors already in the base model are counted and
      // reported, so a model with old problems can still take a change.
      if (shouldValidate) {
        await startActiveSpan("staging.validate", async (validationSpan) => {
          const report = await this.validator.validateChangesetReport(model, changesetId);
          const validation = report.result;
          result.validation.preExistingErrors = report.preExistingErrors.length;
          if (report.preExistingErrors.length > 0) {
            result.validation.preExistingSample = report.preExistingErrors
              .slice(0, 10)
              .map((e) => e.message);
            emitLog(SeverityNumber.WARN, "Pre-existing validation errors not counted against the changeset", {
              "validation.preExistingErrorCount": report.preExistingErrors.length,
            });
          }
          if (report.baseValidationFailure) {
            result.validation.baseValidationFailure = report.baseValidationFailure;
            emitLog(SeverityNumber.WARN, "Base model could not be validated; every error counts", {
              "validation.baseValidationFailure": report.baseValidationFailure,
            });
          }

          (validationSpan as any).setAttribute("validation.passed", validation.isValid());
          (validationSpan as any).setAttribute("validation.errorCount", validation.errors.length);
          (validationSpan as any).setAttribute(
            "validation.preExistingErrorCount",
            report.preExistingErrors.length
          );
          (validationSpan as any).setStatus({ code: 0 });

          if (!validation.isValid()) {
            result.validation.passed = false;
            result.validation.errors = validation.errors.map((e) => e.message);

            emitLog(SeverityNumber.ERROR, "Validation failed", {
              "validation.errorCount": result.validation.errors.length,
              "validation.errors": result.validation.errors.slice(0, 10), // First 10 errors
            });

            const notes: string[] = [];
            if (report.preExistingErrors.length > 0) {
              notes.push(
                `${report.preExistingErrors.length} pre-existing error(s) in the base model were not counted against this changeset.`
              );
            }
            if (report.baseValidationFailure) {
              notes.push(
                `The base model could not be validated (${report.baseValidationFailure}), so every error was counted.`
              );
            }
            throw new Error(
              `Validation failed with ${result.validation.errors.length} error(s) introduced by this changeset:\n` +
                result.validation.errors.map((e) => `  - ${e}`).join("\n") +
                (notes.length > 0 ? `\n\n${notes.join("\n")}` : "") +
                `\n\nFix these validation errors before committing, or skip validation with --no-validate.`
            );
          }
        });
      }

      // Step 3: Dry run early exit (before making any changes)
      if (isDryRun) {
        result.committed = changeset.changes.length;
        // What the landing would stamp (nothing is written on a dry run).
        const wouldReconcile = await reconciliationStamp(model.rootPath, changeset, model.codebaseRoot ?? model.rootPath);
        if (wouldReconcile) result.reconciled = wouldReconcile;
        return result;
      }

      // Step 4: Backup model state for atomic rollback
      let backup: string;
      try {
        backup = await this.backupModel(model);
      } catch (backupError) {
        // Backup creation failed - cannot proceed safely
        throw new Error(
          `Failed to create backup before commit. No changes have been applied. ` +
            `${backupError instanceof Error ? backupError.message : String(backupError)}`
        );
      }

      // Step 5: Apply all changes sequentially by sequence number (numbers may have gaps where
      // changes were unstaged; unstage tombstones are never applied)
      const sortedChanges = withSequenceNumbers(changeset.changes).sort(
        (a, b) => a.sequenceNumber - b.sequenceNumber
      );
      // Set when applying an element delete removed rows from relationships.yaml
      let relationshipsPurged = false;

      // Model.load() merges the active changeset's staged relationship adds and deletes into
      // model.relationships so reads see them. The commit must write this changeset's changes onto
      // the committed relationships alone: starting from the merged set would land another active
      // changeset's staged relationships (or removals) in relationships.yaml too.
      if (model.getActiveChangesetId() !== null) {
        model.relationships = new Relationships(model.getBaseRelationships());
      }

      // The report layers, read before the changes apply: an element delete purges relationships
      // that have no staged relationship-delete (one landed in the base after the delete was
      // staged), and the report at their other end must be regenerated too. Read again afterwards
      // for what the changes add.
      let preCommitReportLayers = new Set<string>();
      try {
        preCommitReportLayers = reportLayersForChanges(
          new ModelReportOrchestrator(model, model.rootPath),
          model,
          sortedChanges
        );
      } catch (error) {
        emitLog(SeverityNumber.WARN, "Could not read report layers before changeset commit", {
          "changeset.id": changesetId,
          "error.message": getErrorMessage(error),
        });
      }

      try {
        const applySpan = isTelemetryEnabled
          ? startSpan("staging.apply", {
              "apply.changeCount": changeset.changes.length,
            })
          : null;

        try {
          for (const [index, change] of sortedChanges.entries()) {
            // The changes before this one are handled; `layer` is the one being written now.
            report({ applied: index, phase: "applying", layer: change.layerName });
            try {
              // Use getBaseLayer() so commit operates on the actual mutable base layer,
              // not a projected clone. getLayer() would return a projected (read-only clone)
              // which cannot be persisted via saveLayer().
              let layer = await model.getBaseLayer(change.layerName);
              if (!layer) {
                // Layer directory doesn't exist yet — this changeset introduces
                // the first elements for this layer. Create an empty layer and
                // register it so saveLayer() will create the directory on disk.
                layer = new Layer(change.layerName);
                model.addLayer(layer);
              }

              if (change.type === "relationship-add" && change.after) {
                // Relationship-add: the relationship was already injected into model.relationships
                // during Model.load() for transparent read-path visibility. Here we just need
                // saveRelationships() to persist it. Skip adding if it already exists.
                const rel = change.after as {
                  source: string;
                  target: string;
                  predicate: string;
                  layer: string;
                  targetLayer?: string;
                  category?: "structural" | "behavioral";
                  properties?: Record<string, unknown>;
                };
                const existing = model.relationships.find(rel.source, rel.target, rel.predicate);
                if (existing.length === 0) {
                  model.relationships.add({
                    source: rel.source,
                    target: rel.target,
                    predicate: rel.predicate,
                    layer: rel.layer,
                    ...(rel.targetLayer ? { targetLayer: rel.targetLayer } : {}),
                    category: rel.category ?? "structural",
                    ...(rel.properties ? { properties: rel.properties } : {}),
                  });
                }
                result.committed++;
                continue;
              }

              if (change.type === "relationship-delete" && change.before) {
                // Relationship-delete: the relationship was already removed from model.relationships
                // during Model.load(). Just ensure it's gone and count it.
                const rel = change.before as {
                  source: string;
                  target: string;
                  predicate?: string;
                };
                model.relationships.delete(rel.source, rel.target, rel.predicate);
                result.committed++;
                continue;
              }

              if (change.type === "add" && change.after) {
                const { Element } = await import("./element.js");
                const elementData = change.after as Record<string, unknown>;
                const elementId = elementData.id as string;

                // The base already has the element when it holds this UUID, or another element at
                // this path: one added there after this add was staged (another plan, or the
                // as-built changeset landing first) has its own UUID. Either way the add is
                // skipped and the base's element stands, as the brief and the drift warning say
                // (`already-in-base`); adding it again would replace the base's element.
                const elements = layer.listElements();
                const elementPath = typeof elementData.path === "string" ? elementData.path : change.elementId;
                const elementExists =
                  elements.some((e) => e.id === elementId) || (!!elementPath && !!layer.getElement(elementPath));

                if (!elementExists) {
                  // Pass the entire elementData to Element constructor - it already has all fields from toJSON()
                  const element = new Element(canonicalStagedSnapshot(elementData).data);
                  layer.addElement(element);
                  result.committed++;
                } else {
                  result.skipped = (result.skipped ?? 0) + 1;
                  result.skippedDetails = result.skippedDetails ?? [];
                  result.skippedDetails.push(
                    `'${elementId}' in '${change.layerName}' already exists — deduplicated`
                  );
                  emitLog(SeverityNumber.WARN, "Element deduplicated during commit", {
                    "change.elementId": change.elementId,
                    "change.layer": change.layerName,
                  });
                }
              } else if (change.type === "update" && change.after) {
                const element = layer.getElement(change.elementId);
                if (element) {
                  const { data: elementData, sourceReference } = canonicalStagedSnapshot(
                    change.after as Record<string, unknown>
                  );
                  Object.assign(element, elementData);
                  if (sourceReference.present) element.setSourceReference(sourceReference.value);
                  // Persist the mutation back to the underlying graph node.
                  // getElement() returns a new wrapper each time, so Object.assign
                  // alone is discarded; updateElement() writes through to the graph.
                  layer.updateElement(element);
                  result.committed++;
                } else {
                  result.failed++;
                  result.validation.passed = false;
                  result.validation.errors.push(
                    `Cannot update '${change.elementId}' in '${change.layerName}': element not found in base model`
                  );
                }
              } else if (change.type === "delete") {
                const element = layer.getElement(change.elementId);
                // Purge relationships that name the element by UUID or by path.
                // Deletes staged before relationship purging existed carry no
                // relationship-delete changes, so this is the safety net at commit.
                const before = (change.before ?? {}) as { id?: unknown; path?: unknown };
                const purged = model.relationships.deleteForElement(
                  elementIdentifiers(element ?? before, before.id as string | undefined,
                    before.path as string | undefined, change.elementId)
                );
                if (purged > 0) {
                  relationshipsPurged = true;
                }
                if (element) {
                  layer.deleteElement(element.path || element.id);
                  result.committed++;
                } else {
                  // Element was already removed — count as skipped, not failed
                  result.skipped = (result.skipped ?? 0) + 1;
                  result.skippedDetails = result.skippedDetails ?? [];
                  result.skippedDetails.push(
                    `'${change.elementId}' in '${change.layerName}' not found — already deleted`
                  );
                }
              } else {
                // Handles: unknown change types, and known types with missing payloads
                // (e.g. "add" with no change.after, "relationship-add" with no change.after).
                result.failed++;
                result.validation.passed = false;
                result.validation.errors.push(
                  `Cannot apply change '${change.type}' for '${change.elementId}': missing payload or unrecognised type`
                );
              }
            } catch (error) {
              result.failed++;
              result.validation.passed = false;
              result.validation.errors.push(
                `Failed to apply change to ${change.elementId}: ${getErrorMessage(error)}`
              );

              emitLog(SeverityNumber.ERROR, "Failed to apply change", {
                "change.elementId": change.elementId,
                "change.type": change.type,
                "change.layer": change.layerName,
                "error.message": getErrorMessage(error),
              });

              throw new Error(
                `Atomic commit failed at change ${sortedChanges.indexOf(change) + 1}/${sortedChanges.length}: ` +
                  `${getErrorMessage(error)}`
              );
            }
          }

          report({ applied: sortedChanges.length, phase: "applying" });

          if (isTelemetryEnabled && applySpan) {
            (applySpan as any).setAttribute("apply.committed", result.committed);
            (applySpan as any).setAttribute("apply.failed", result.failed);
            (applySpan as any).setStatus({ code: 0 });
          }
        } finally {
          endSpan(applySpan);
        }

        // Step 6: Save all modified layers and relationships atomically
        report({ applied: sortedChanges.length, phase: "saving" });
        const modifiedLayers = new Set<string>();
        let hasRelationshipChanges = false;
        for (const change of sortedChanges) {
          if (change.type === "relationship-add" || change.type === "relationship-delete") {
            hasRelationshipChanges = true;
          } else {
            modifiedLayers.add(change.layerName);
          }
        }

        for (const layerName of modifiedLayers) {
          try {
            await model.saveLayer(layerName);
          } catch (error) {
            throw new Error(
              `Failed to save layer '${layerName}': ${getErrorMessage(error)}`
            );
          }
        }

        // Persist staged relationship changes to relationships.yaml
        if (hasRelationshipChanges || relationshipsPurged) {
          try {
            await model.saveRelationships();
          } catch (error) {
            throw new Error(
              `Failed to save relationships after commit: ${getErrorMessage(error)}`
            );
          }
        }

        // Step 7: Update changeset status to committed ONLY AFTER successful saves
        changeset.status = "committed";
        changeset.updateModified();

        try {
          await this.storage.save(changeset);
        } catch (error) {
          // Changeset status is critical metadata - must be persisted with model changes
          throw new Error(
            `Failed to save changeset status after commit: ${getErrorMessage(error)}. ` +
              `This is a critical error that requires rollback to maintain consistency between model state and changeset metadata.`
          );
        }

        // Step 8: Add changeset to manifest history
        if (!model.manifest.changeset_history) {
          model.manifest.changeset_history = [];
        }
        const committedAt = new Date().toISOString();
        model.manifest.changeset_history.push({
          name: changeset.name,
          committed_at: committedAt,
          action: "committed",
        });

        // Step 8.5: A bootstrap or reconcile landing (a changeset codebase_extract staged from the
        // whole code, or from a branch's changes with no plan active) reconciles the model with the
        // code; stamp the manifest so code drift counts from the commit that brings this landing in.
        // A plan's landing doesn't, and leaves the stamp of the last such landing in place. See
        // core/reconciliation.ts and core/changeset-purpose.ts.
        const reconciled = await reconciliationStamp(
          model.rootPath,
          changeset,
          model.codebaseRoot ?? model.rootPath,
          committedAt
        );
        if (reconciled) {
          model.manifest.reconciled = reconciled;
          result.reconciled = reconciled;
        }

        // Step 9: Save manifest with updated changeset history
        try {
          await model.saveManifest();
        } catch (manifestError) {
          // Manifest save failed - this is CRITICAL and will trigger rollback
          // Don't log here - let the rollback handler provide comprehensive error output
          throw new Error(
            `Failed to save manifest with changeset history: ${manifestError instanceof Error ? manifestError.message : String(manifestError)}. ` +
              `Model will be rolled back to maintain consistency.`
          );
        }

        // The model in hand stops projecting the landed changeset before the reports are read
        // from it; the active marker on disk is cleared in Step 11.
        model.noteChangesetDeactivated(changeset.id);

        // Step 9.5: Regenerate reports for the layers this changeset changed: the layers of its
        // elements and of the other ends of their relationships, and both ends of each relationship
        // change. Not every layer related to a changed layer: those reports did not change.
        try {
          const orchestrator = new ModelReportOrchestrator(model, model.rootPath);
          const reportLayers = reportLayersForChanges(orchestrator, model, sortedChanges);
          for (const layer of preCommitReportLayers) reportLayers.add(layer);
          await orchestrator.regenerate(reportLayers);
        } catch (error) {
          emitLog(
            SeverityNumber.WARN,
            "Failed to regenerate layer reports after changeset commit",
            {
              "changeset.id": changesetId,
              "changeset.name": changeset.name,
              "changeset.changeCount": sortedChanges.length,
              "error.message": getErrorMessage(error),
            }
          );
        }

        // Step 10: Clean up backup directory after successful commit
        // Note: cleanupBackup handles its own errors and logs them with ERROR severity
        await this.cleanupBackup(backup);

        // Step 11: A landed changeset is no longer active, whoever landed it: left active, reads
        // would project it over the base and writes would stage into it. Another changeset's
        // active marker is left alone. The changes are already landed, so a failure here is
        // reported in the result (deactivationError) rather than rolled back.
        try {
          if ((await this.readActiveMarker()) === changeset.id) {
            await this.clearActive();
            result.deactivated = true;
            // A write still aimed at it refuses, naming it, instead of going to the base model.
            await writeLandedNote(this.rootPath, { id: changeset.id!, name: changeset.name, landedAt: committedAt }).catch(
              (error) =>
                emitLog(SeverityNumber.WARN, "Could not record the landed changeset for later writes", {
                  "changeset.id": changesetId,
                  "error.message": getErrorMessage(error),
                })
            );
          }
        } catch (error) {
          result.deactivationError = getErrorMessage(error);
          console.warn(
            `Warning: changeset '${changeset.name}' was committed, but its active-changeset marker could not be cleared ` +
              `(${result.deactivationError}). The marker is ignored: a committed changeset is never the active one.`
          );
          emitLog(SeverityNumber.ERROR, "Changeset committed but could not be deactivated", {
            "changeset.id": changesetId,
            "error.message": result.deactivationError,
          });
        }

        (span as any).setAttribute("commit.success", true);
        (span as any).setAttribute("commit.committed", result.committed);
        if (drift.isDrifted) {
          (span as any).setAttribute("commit.landedWithDrift", true);
        }
        (span as any).setStatus({ code: 0 });

        return result;
      } catch (commitError) {
        // Attempt rollback on any failure - restore from backup
        let rollbackSucceeded = false;
        let rollbackError: Error | null = null;

        const rollbackSpan = isTelemetryEnabled ? startSpan("staging.rollback") : null;

        try {
          emitLog(SeverityNumber.WARN, "Commit failed, attempting rollback", {
            "commit.error":
              commitError instanceof Error ? commitError.message : String(commitError),
          });

          await this.restoreModel(model, backup);
          rollbackSucceeded = true;

          if (isTelemetryEnabled && rollbackSpan) {
            (rollbackSpan as any).setAttribute("rollback.success", true);
            (rollbackSpan as any).setStatus({ code: 0 });
          }

          emitLog(SeverityNumber.INFO, "Rollback succeeded, model restored", {
            "backup.path": backup,
          });
        } catch (err) {
          rollbackError = err instanceof Error ? err : new Error(String(err));

          if (isTelemetryEnabled && rollbackSpan) {
            (rollbackSpan as any).setAttribute("rollback.success", false);
            (rollbackSpan as any).recordException(rollbackError);
            (rollbackSpan as any).setStatus({ code: 2, message: rollbackError.message });
          }

          emitLog(SeverityNumber.ERROR, "Rollback failed, model may be corrupted", {
            "rollback.error": rollbackError.message,
            "backup.path": backup,
          });
        } finally {
          endSpan(rollbackSpan);
        }

        // CRITICAL: Validate backup integrity BEFORE suggesting manual restoration
        let backupHealth: { isValid: boolean; filesChecked: number; errors: string[] };
        let backupValidationError: string | null = null;
        let validationProcessFailed = false;

        try {
          backupHealth = await this.validateBackupIntegrity(backup);
        } catch (validationErr) {
          validationProcessFailed = true;
          backupValidationError =
            validationErr instanceof Error ? validationErr.message : String(validationErr);
          backupHealth = {
            isValid: false,
            filesChecked: 0,
            errors: [
              `Validation process failed: ${backupValidationError}`,
              `This indicates a critical issue with the backup infrastructure, not the backup content.`,
              `Contact support before attempting manual restoration.`,
            ],
          };
        }

        // Build comprehensive error message
        let compositeMessage: string;
        const suggestions: string[] = [];

        if (rollbackSucceeded) {
          // Rollback succeeded - throw original commit error
          compositeMessage = `Commit failed but rollback succeeded. Model restored to pre-commit state.\n\n`;
          compositeMessage += `Error during commit:\n`;
          compositeMessage += `  ${commitError instanceof Error ? commitError.message : String(commitError)}\n\n`;
          compositeMessage += `Backup location (for reference): ${backup}`;

          // Clean up backup after successful rollback
          // Note: cleanupBackup handles its own errors and logs them with ERROR severity
          await this.cleanupBackup(backup);

          (span as any).setAttribute("commit.success", false);
          (span as any).setAttribute("commit.rollbackSuccess", true);
          (span as any).recordException(commitError as Error);
          (span as any).setStatus({
            code: 2,
            message: commitError instanceof Error ? commitError.message : String(commitError),
          });

          throw new Error(compositeMessage);
        } else {
          // Rollback failed - model may be corrupted
          compositeMessage =
            `Commit failed AND rollback failed. Model may be in corrupted state.\n` +
            `\n` +
            `Original commit error:\n` +
            `  ${commitError instanceof Error ? commitError.message : String(commitError)}\n` +
            `\n` +
            `Rollback error:\n` +
            `  ${rollbackError ? rollbackError.message : "Unknown error"}\n` +
            `\n` +
            `Backup location: ${backup}\n`;

          // Add backup health status (always show header for consistency with tests)
          compositeMessage += `Backup integrity check:\n`;
          if (validationProcessFailed) {
            compositeMessage += `  ✗ Backup integrity issues found:\n`;
            compositeMessage += `    - Validation process failed: ${backupValidationError}\n`;
            compositeMessage += `\n⚠ CRITICAL: Backup validation process crashed.\n`;
            compositeMessage += `This indicates a system-level issue (filesystem, memory, permissions).\n`;
            compositeMessage += `DO NOT attempt manual restoration until this is resolved.\n`;
          } else if (backupHealth.isValid) {
            compositeMessage += `  ✓ Backup is valid (${backupHealth.filesChecked} files checked)\n`;
          } else {
            compositeMessage += `  ✗ Backup integrity issues found:\n`;
            for (const error of backupHealth.errors) {
              compositeMessage += `    - ${error}\n`;
            }
          }

          compositeMessage += `\n`;

          if (backupHealth.isValid) {
            suggestions.push(
              `Backup is valid. Manually restore from backup: ${backup}`,
              `Copy manifest.json/manifest.yaml from backup to ${path.join(model.rootPath, "documentation-robotics")}`,
              `Copy layer files from ${path.join(backup, "layers")} to ${path.join(model.rootPath, "documentation-robotics", "layers")}`,
              `Run 'dr validate' after manual restoration`,
              `Contact support if issue persists`
            );
          } else {
            suggestions.push(
              `⚠ Backup integrity is compromised. Do NOT use this backup for recovery.`,
              `Check if backup files exist at: ${backup}`,
              `Verify disk space and file permissions`,
              `Contact support immediately - manual data recovery may be required`,
              `Do not attempt manual restoration with a corrupted backup`
            );
          }

          compositeMessage += `Manual recovery may be required.`;

          (span as any).setAttribute("commit.success", false);
          (span as any).setAttribute("commit.rollbackSuccess", false);
          (span as any).recordException(commitError as Error);
          (span as any).setStatus({ code: 2, message: "Commit and rollback both failed" });

          const { CLIError } = await import("../utils/errors.js");
          throw new CLIError(compositeMessage, 1, suggestions);
        }
      }
    }, {
      "changeset.id": changesetId,
      "commit.validate": options.validate !== false,
      "commit.force": options.force === true,
      "commit.dryRun": options.dryRun === true,
    });
  }

  /**
   * Check if a changeset is currently active.
   * Active changesets intercept mutations to stage changes instead of applying to base model.
   *
   * @param changesetId - ID of the changeset to check
   * @returns true if changeset is marked as active, false otherwise
   * @throws Error if changeset ID is invalid
   */
  async isActive(changesetId: string): Promise<boolean> {
    this.validateChangesetId(changesetId);

    return (await this.getActiveId()) === changesetId;
  }

  /**
   * Activate a changeset to intercept model mutations.
   * Marks the changeset as active and transitions status to 'staged'.
   * Only one changeset can be active at a time.
   *
   * @param changesetId - ID of the changeset to activate
   * @throws Error if changeset ID is invalid or changeset not found
   * @throws UpgradeRecordActivationError for an upgrade record, which never lands: writes staged
   *   into it would be stuck there
   *
   * @remarks
   * When a changeset is active, add/update/delete commands will stage changes
   * instead of applying them directly to the base model.
   */
  async setActive(changesetId: string): Promise<void> {
    return trackModelWrite(this.rootPath, undefined, () => this.writeActive(changesetId));
  }

  private async writeActive(changesetId: string): Promise<void> {
    this.validateChangesetId(changesetId);

    const changeset = await this.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }
    if (changeset.purpose === "upgrade-record") {
      throw new UpgradeRecordActivationError(changeset.name);
    }

    // Transition to 'staged' status to enable interception
    if (changeset.status !== "staged") {
      changeset.markStaged();
      await this.storage.save(changeset);
    }

    // Write the actual changeset ID (not the user-provided name)
    if (!changeset.id) {
      throw new Error(`Changeset has no ID, cannot activate`);
    }
    await writeActiveMarker(this.rootPath, changeset.id);
  }

  /**
   * Clear the active changeset marker.
   * Allows a new changeset to be activated or model mutations to proceed normally.
   */
  async clearActive(): Promise<void> {
    return trackModelWrite(this.rootPath, undefined, () => this.writeNoActive());
  }

  private async writeNoActive(): Promise<void> {
    await clearActiveMarker(this.rootPath);
  }

  /**
   * The id the active-changeset marker holds (active-changeset-marker.ts), whatever became of
   * that changeset: it may have been committed, discarded or deleted since. Only for clearing the
   * marker; everything else asks getActive or getActiveId.
   */
  private async readActiveMarker(): Promise<string | null> {
    return readActiveMarker(this.rootPath);
  }

  /**
   * Get the currently active changeset: the one the marker (`.dr/active-changeset`) names, while
   * it is staged.
   * A marker that names a changeset that is committed, discarded or gone is no active changeset
   * (#1218): Model.load reads it the same way, so writes go to the base model.
   *
   * @returns The active changeset or null if none is active
   */
  async getActive(): Promise<Changeset | null> {
    const id = await this.readActiveMarker();
    if (!id) {
      return null;
    }

    const changeset = await this.storage.load(id);
    return changeset && changeset.status === "staged" ? changeset : null;
  }

  /**
   * Where a write goes: the active changeset, or null for the base model. Refuses, naming the
   * changeset, when the checkout's active changeset was landed and nothing was activated, created
   * or deactivated since (the landed note, #1437): a write aimed at it is never made in the base
   * model in its place. Every write path asks this instead of getActive.
   *
   * @throws ChangesetClosedToWritesError when the active changeset was landed
   */
  async getWriteTarget(): Promise<Changeset | null> {
    const active = await this.getActive();
    if (active) return active;
    const landed = await readLandedNote(this.rootPath);
    if (landed) throw landedActiveChangesetError(landed);
    return null;
  }

  /** A changeset's folder (its file lock sits beside it). */
  changesetPath(changesetId: string): string {
    return this.storage.getChangesetPath(changesetId);
  }

  /** The landed note (see getWriteTarget), for status output and changeset_deactivate. */
  async landedNote() {
    return readLandedNote(this.rootPath);
  }

  /**
   * Get the ID of the active changeset, by the same rule as getActive.
   *
   * @returns The active changeset ID or null if no active changeset exists
   */
  async getActiveId(): Promise<string | null> {
    return (await this.getActive())?.id ?? null;
  }

  /**
   * A marker left behind: the name and status of the changeset the marker names when that
   * changeset is not staged (so it is not the active one), or `missing` when it is gone. Null
   * when there is no marker or it names the active changeset. For status output.
   */
  async staleActiveMarker(): Promise<{ id: string; name?: string; status: string } | null> {
    const id = await this.readActiveMarker();
    if (!id) {
      return null;
    }
    const changeset = await this.storage.load(id);
    if (!changeset) {
      return { id, status: "missing" };
    }
    return changeset.status === "staged" ? null : { id, name: changeset.name, status: changeset.status };
  }

  /**
   * Apply a changeset to the base model.
   * Alias for commit() to match legacy command terminology.
   *
   * @param model - The model to apply changes to
   * @param changesetId - ID of the changeset to apply
   * @param options - Commit options (force, validate, dryRun)
   * @returns CommitResult with count of applied changes and validation status
   * @throws Error if validation fails, drift detected without --force, or apply fails
   *
   * @remarks
   * This method provides backward compatibility with changeset commands that use
   * "apply" instead of "commit" terminology. All logic is delegated to commit().
   */
  async apply(
    model: Model,
    changesetId: string,
    options: CommitOptions = {}
  ): Promise<CommitResult> {
    return this.commit(model, changesetId, options);
  }

  /**
   * Revert a changeset: `dr changeset revert`. A staged changeset is discarded (discard()).
   *
   * A committed changeset is accepted too, as it was before discard() began to refuse one (#1173):
   * its record is kept with the status 'discarded' and no changes, and its side files are removed.
   * The base model is not touched, so what the changeset applied stays in the model. discard(), which
   * the MCP tool and the viewer use, still refuses a committed changeset.
   *
   * @param changesetId - ID of the changeset to revert
   * @returns The status the changeset had before the revert
   * @throws Error if changeset ID is invalid or changeset not found
   */
  async revert(changesetId: string): Promise<ChangesetStatus> {
    this.validateChangesetId(changesetId);

    const changeset = await this.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }
    const was = changeset.status;
    if (was !== "committed") {
      await this.discard(changesetId);
      return was;
    }
    const id = changeset.id ?? changesetId;

    changeset.changes = [];
    changeset.unstaged = [];
    changeset.status = "discarded";
    changeset.updateModified();
    await this.storage.save(changeset);
    // Only the record stays (name, description, status): nothing reads a base index after this.
    await this.storage.removeSideFiles(id);
    if ((await this.readActiveMarker()) === id) {
      await this.clearActive();
    }

    const engine = await this.getProjectionEngine();
    engine.invalidateOnDiscard(changesetId);
    return was;
  }

  /**
   * Backup the current model state for atomic rollback on commit failure.
   * Creates a temporary backup directory with copies of all layer files and manifest.
   * Validates backup completeness and calculates checksums for integrity verification.
   *
   * @param model - The model to backup
   * @returns Path to the backup directory
   * @throws Error if backup creation or validation fails
   *
   * @remarks
   * Backup includes:
   * - manifest.yaml or manifest.json
   * - All layer YAML files
   * - Backup manifest with checksums and metadata
   * Backup is removed after successful commit; retained if commit fails for recovery.
   */
  private async backupModel(model: Model): Promise<string> {
    const backupDir = path.join(
      this.rootPath,
      "documentation-robotics",
      ".backups",
      `backup-${Date.now()}`
    );

    const { ensureDir, readFile, atomicWrite } = await import("../utils/file-io.js");
    const { createHash } = await import("crypto");

    await ensureDir(backupDir);

    // Track what we're backing up for validation
    // Use mutable array during construction, then make readonly when creating BackupManifest
    const backupFiles: Array<{
      path: string;
      checksum: ReturnType<typeof createSha256Hash>;
      size: number;
    }> = [];
    const timestamp = new Date().toISOString();

    try {
      // Backup manifest - try both .yaml and .json formats
      let manifestPath = path.join(
        model.rootPath,
        "documentation-robotics",
        "model",
        "manifest.yaml"
      );
      if (!(await fileExists(manifestPath))) {
        manifestPath = path.join(model.rootPath, "documentation-robotics", "manifest.json");
      }
      if (!(await fileExists(manifestPath))) {
        throw new Error("Manifest file not found in expected locations");
      }

      const manifestContent = await readFile(manifestPath);
      const manifestChecksum = createSha256Hash(
        createHash("sha256").update(manifestContent).digest("hex")
      );
      const manifestFilename = path.basename(manifestPath);

      await atomicWrite(path.join(backupDir, manifestFilename), manifestContent);
      backupFiles.push({
        path: manifestFilename,
        checksum: manifestChecksum,
        size: manifestContent.length,
      });

      // Backup all layers - handle multiple YAML files per layer
      const layersDir = path.join(backupDir, "layers");
      await ensureDir(layersDir);

      const fs = await import("fs/promises");

      for (const layer of model.layers.values()) {
        const layerBackupDir = path.join(layersDir, layer.name);
        await ensureDir(layerBackupDir);

        // Find the layer directory in the model
        const layerDirPath = await this.findLayerDirectory(model.rootPath, layer.name);
        if (!layerDirPath) {
          continue;
        }

        // Backup all YAML files in the layer directory
        const files = await fs.readdir(layerDirPath);
        for (const file of files) {
          if (file.endsWith(".yaml") || file.endsWith(".yml")) {
            const filePath = path.join(layerDirPath, file);
            const fileContent = await readFile(filePath);
            const fileChecksum = createSha256Hash(
              createHash("sha256").update(fileContent).digest("hex")
            );

            await atomicWrite(path.join(layerBackupDir, file), fileContent);
            backupFiles.push({
              path: `layers/${layer.name}/${file}`,
              checksum: fileChecksum,
              size: fileContent.length,
            });
          }
        }
      }

      // Create the final immutable BackupManifest
      const backupManifest: BackupManifest = {
        files: backupFiles as ReadonlyArray<(typeof backupFiles)[0]>,
        timestamp,
      };

      // Write backup manifest for validation
      await atomicWrite(
        path.join(backupDir, ".backup-manifest.json"),
        JSON.stringify(backupManifest, null, 2)
      );

      // Validate backup completeness
      await this.validateBackup(backupDir, backupManifest);

      return backupDir;
    } catch (error) {
      // Clean up incomplete backup with detailed error handling
      const cleanupError = await this.forceRemoveBackupDir(backupDir);

      if (cleanupError) {
        // This is CRITICAL - orphaned backups accumulate
        throw new Error(
          `Backup creation failed AND cleanup failed.\n` +
            `Original error: ${getErrorMessage(error)}\n` +
            `Cleanup error: ${cleanupError}\n\n` +
            `Orphaned backup directory: ${backupDir}\n` +
            `This directory will accumulate and consume disk space.\n\n` +
            `REQUIRED ACTIONS:\n` +
            `  1. Manually remove: rm -rf "${backupDir}"\n` +
            `  2. Check disk space: df -h\n` +
            `  3. Check permissions: ls -la "${path.dirname(backupDir)}"\n\n` +
            `Cannot proceed with commit until this is resolved.`
        );
      }

      throw new Error(
        `Failed to create backup: ${getErrorMessage(error)}`
      );
    }
  }

  /**
   * Validate backup completeness and file integrity.
   * Verifies that all files in the manifest exist in the backup directory
   * with matching checksums and sizes.
   *
   * @param backupDir - Path to the backup directory
   * @param manifest - Backup manifest with file list and checksums
   * @throws Error if any file is missing, checksum mismatches, or size differs
   */
  private async validateBackup(backupDir: string, manifest: BackupManifest): Promise<void> {
    const { readFile, fileExists } = await import("../utils/file-io.js");
    const { createHash } = await import("crypto");

    for (const file of manifest.files) {
      const backupFilePath = path.join(backupDir, file.path);

      // Verify file exists
      if (!(await fileExists(backupFilePath))) {
        throw new Error(`Backup validation failed: ${file.path} not found in backup`);
      }

      // Verify checksum matches
      const content = await readFile(backupFilePath);
      const checksum = createHash("sha256").update(content).digest("hex");

      if (checksum !== file.checksum) {
        throw new Error(
          `Backup validation failed: ${file.path} checksum mismatch (expected ${file.checksum}, got ${checksum})`
        );
      }

      // Verify size matches
      if (content.length !== file.size) {
        throw new Error(
          `Backup validation failed: ${file.path} size mismatch (expected ${file.size}, got ${content.length})`
        );
      }
    }
  }

  /**
   * Validate backup integrity by checking manifest and file checksums.
   * This is called before suggesting manual restoration to ensure the backup is usable.
   * @param backupDir - Path to the backup directory
   * @returns Promise resolving to backup health status or throwing error with details
   * @throws Error with details about any integrity issues found
   */
  async validateBackupIntegrity(backupDir: string): Promise<{
    isValid: boolean;
    filesChecked: number;
    errors: string[];
  }> {
    const { readFile, fileExists } = await import("../utils/file-io.js");
    const { createHash } = await import("crypto");

    const errors: string[] = [];
    let filesChecked = 0;

    try {
      // Check if backup directory exists
      if (!(await fileExists(backupDir))) {
        throw new Error(`Backup directory not found: ${backupDir}`);
      }

      // Load and validate backup manifest
      const manifestPath = path.join(backupDir, ".backup-manifest.json");
      if (!(await fileExists(manifestPath))) {
        throw new Error(`Backup manifest not found at ${manifestPath}`);
      }

      // Read manifest content first (can throw for parse errors)
      let rawManifest;
      try {
        const manifestContent = await readFile(manifestPath);
        if (!manifestContent || manifestContent.length === 0) {
          throw new Error("Backup manifest is empty");
        }
        rawManifest = JSON.parse(manifestContent.toString());
      } catch (err) {
        // JSON parse errors should throw - these are critical errors
        throw new Error(
          `Failed to read backup manifest: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      // Validate manifest structure (can throw for missing required arrays)
      if (!rawManifest || typeof rawManifest !== "object") {
        throw new Error("Backup manifest must be an object");
      }

      if (!rawManifest.files || !Array.isArray(rawManifest.files)) {
        throw new Error("Backup manifest must have a files array");
      }

      // Validate each file entry in the manifest and collect errors gracefully
      for (let index = 0; index < rawManifest.files.length; index++) {
        const file = rawManifest.files[index];
        filesChecked++;

        // Validate file entry structure
        if (!file || typeof file !== "object") {
          errors.push(`Backup manifest file entry ${index} must be an object`);
          continue;
        }

        if (typeof file.path !== "string" || !file.path) {
          errors.push(`Backup manifest file entry ${index} must have a non-empty path string`);
          continue;
        }

        // Validate required metadata fields - these are validation errors, not critical
        if (typeof file.checksum !== "string") {
          errors.push(`Backup manifest file entry ${index} must have a checksum string`);
          continue;
        }

        if (typeof file.size !== "number" || file.size < 0) {
          errors.push(`Backup manifest file entry ${index} must have a non-negative size number`);
          continue;
        }

        // File validation: check file exists and integrity
        const backupFilePath = path.join(backupDir, file.path);

        // Check file exists
        if (!(await fileExists(backupFilePath))) {
          errors.push(`Missing: ${file.path}`);
          continue;
        }

        // Check checksum
        try {
          const content = await readFile(backupFilePath);
          const checksum = createHash("sha256").update(content).digest("hex");

          if (checksum !== file.checksum) {
            errors.push(
              `Checksum mismatch: ${file.path} (expected ${file.checksum}, got ${checksum})`
            );
            continue;
          }

          // Check size
          if (content.length !== file.size) {
            errors.push(
              `Size mismatch: ${file.path} (expected ${file.size}, got ${content.length})`
            );
          }
        } catch (err) {
          errors.push(
            `Failed to validate: ${file.path} (${err instanceof Error ? err.message : String(err)})`
          );
        }
      }

      return {
        isValid: errors.length === 0,
        filesChecked,
        errors,
      };
    } catch (err) {
      throw new Error(
        `Backup integrity check failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Clean up a backup directory after successful commit.
   * Removes the backup directory and all its contents to prevent disk space accumulation.
   *
   * @param backupDir - Path to the backup directory to remove
   *
   * @remarks
   * Failures during cleanup are logged with ERROR severity but do not throw.
   * Successful commits should not fail due to cleanup errors, but users need to
   * know about cleanup failures to avoid disk space accumulation.
   * Includes actionable guidance for common failure scenarios.
   */
  private async cleanupBackup(backupDir: string): Promise<void> {
    try {
      const { rm } = await import("node:fs/promises");
      await rm(backupDir, { recursive: true, force: true });
    } catch (error) {
      // Log cleanup failures with ERROR severity - these mask real problems
      const errorMsg = getErrorMessage(error);
      const errorCode = (error as NodeJS.ErrnoException)?.code;

      let suggestions = "";

      // Handle ENOENT specially - backup already deleted is not an error
      if (errorCode === "ENOENT") {
        // Backup was already deleted - directory removal goal is achieved
        return;
      }

      // ENOSPC is CRITICAL - orphaned backups will accumulate and fill disk
      if (errorCode === "ENOSPC") {
        throw new Error(
          `Backup cleanup failed due to disk full.\n` +
            `Original error: ${errorMsg}\n\n` +
            `Orphaned backup directory: ${backupDir}\n` +
            `This directory will accumulate and consume disk space.\n\n` +
            `REQUIRED ACTIONS:\n` +
            `  1. Manually remove: rm -rf "${backupDir}"\n` +
            `  2. Free up disk space: df -h\n` +
            `  3. Check disk usage: du -sh ${path.dirname(backupDir)}/*\n\n` +
            `Cannot proceed with future commits until disk space is freed.`
        );
      }

      // Provide specific guidance based on error type
      if (errorCode === "EACCES") {
        suggestions =
          "\n\n[PERMISSION ERROR] Cannot delete backup directory.\n" +
          `Directory: ${backupDir}\n` +
          "Check file permissions or try manual cleanup:\n" +
          `sudo rm -rf "${backupDir}"`;
      } else {
        suggestions =
          "\n\n[ACTION REQUIRED] Backup cleanup failed due to file system error.\n" +
          `Directory: ${backupDir}\n` +
          `Manual cleanup: rm -rf "${backupDir}"\n` +
          "Note: Backup directories accumulate over time and can fill disk space.";
      }

      console.error(
        `[ERROR] Failed to clean up backup directory after commit: ${errorMsg}` + suggestions
      );
    }
  }

  /**
   * Force remove a backup directory with enhanced error handling.
   * Attempts multiple strategies to ensure removal even with permission issues.
   *
   * @param backupDir - Path to the backup directory to remove
   * @returns Error message if removal failed, null if successful
   *
   * @remarks
   * This is used during backup creation failures to ensure cleanup of partial state.
   * Returns error details instead of throwing so caller can log and continue.
   */
  private async forceRemoveBackupDir(backupDir: string): Promise<string | null> {
    const fs = await import("fs/promises");

    try {
      // Try standard removal first
      await fs.rm(backupDir, { recursive: true, force: true });
      return null;
    } catch (error) {
      // If standard removal fails, try more aggressive approach
      try {
        // Accumulate removal failures for detailed error reporting
        const removalFailures: Array<{ path: string; error: string }> = [];

        // List directory contents and try to remove each item
        const entries = await fs.readdir(backupDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(backupDir, entry.name);
          try {
            if (entry.isDirectory()) {
              await fs.rm(fullPath, { recursive: true, force: true });
            } else {
              await fs.unlink(fullPath);
            }
          } catch (itemError) {
            removalFailures.push({
              path: fullPath,
              error: itemError instanceof Error ? itemError.message : String(itemError),
            });
          }
        }

        // Try to remove the directory itself
        try {
          await fs.rmdir(backupDir);
          return null;
        } catch {
          // Directory may not be empty due to removal failures
          if (removalFailures.length > 0) {
            const failureDetails = removalFailures
              .map((f) => `  - ${f.path}: ${f.error}`)
              .join("\n");

            return (
              `Could not remove ${removalFailures.length} items from backup directory:\n` +
              failureDetails +
              `\n\nManual cleanup required: rm -rf "${backupDir}"`
            );
          }

          return `Could not remove directory ${backupDir} - may contain leftover files`;
        }
      } catch (aggressiveError) {
        return `Backup cleanup failed: ${aggressiveError instanceof Error ? aggressiveError.message : String(aggressiveError)}`;
      }
    }
  }

  /**
   * Restore model state from backup after failed commit.
   * Restores manifest first (critical), then all layer files with defensive error handling.
   * Provides detailed reporting of restoration progress and failures.
   *
   * @param model - The model to restore
   * @param backupDir - Path to the backup directory
   * @throws Error with detailed restoration summary if restoration fails
   *
   * @remarks
   * Restoration strategy:
   * 1. Restore manifest first (critical for model integrity)
   * 2. Restore all layer files with per-file error handling
   * 3. Continue restoring remaining files even if some fail
   * 4. Throw detailed error if critical files fail to restore
   * Both manifest and layer restoration failures are critical and will throw errors.
   */
  private async restoreModel(model: Model, backupDir: string): Promise<void> {
    const { readFile, fileExists, atomicWrite } = await import("../utils/file-io.js");

    const restoredFiles: string[] = [];
    const failedFiles: Array<{ path: string; error: string; isCritical: boolean }> = [];
    const criticalLayers = new Set<string>(); // Track critical layer failures

    try {
      // Restore manifest first (most critical) - try both .yaml and .json
      let backupManifestFile = path.join(backupDir, "manifest.yaml");
      let manifestDestPath = path.join(
        model.rootPath,
        "documentation-robotics",
        "model",
        "manifest.yaml"
      );

      if (!(await fileExists(backupManifestFile))) {
        backupManifestFile = path.join(backupDir, "manifest.json");
        manifestDestPath = path.join(model.rootPath, "documentation-robotics", "manifest.json");
      }

      try {
        if (!(await fileExists(backupManifestFile))) {
          throw new Error("Backup manifest file not found (tried .yaml and .json)");
        }

        const manifestContent = await readFile(backupManifestFile);
        await atomicWrite(manifestDestPath, manifestContent);
        restoredFiles.push(path.basename(backupManifestFile));
      } catch (error) {
        failedFiles.push({
          path: path.basename(backupManifestFile),
          error: getErrorMessage(error),
          isCritical: true,
        });
        // Manifest is critical - throw immediately
        throw new Error(
          `Failed to restore ${path.basename(backupManifestFile)}: ${getErrorMessage(error)}`
        );
      }

      // Restore all layer files with defensive error handling
      const backupLayersDir = path.join(backupDir, "layers");
      const fs = await import("fs/promises");

      for (const layer of model.layers.values()) {
        const backupLayerDir = path.join(backupLayersDir, layer.name);

        try {
          if (!(await fileExists(backupLayerDir))) {
            // CRITICAL: Layer directory missing in backup - this is a data loss scenario
            const errorMsg = `Layer '${layer.name}' not found in backup (backup incomplete or corrupted)`;
            failedFiles.push({
              path: `layers/${layer.name}`,
              error: errorMsg,
              isCritical: true,
            });
            criticalLayers.add(layer.name);
            continue;
          }

          // Find the correct destination directory for this layer
          const layerDirPath = await this.findLayerDirectory(model.rootPath, layer.name);

          if (!layerDirPath) {
            // CRITICAL: Cannot find destination for layer - filesystem issue or permission problem
            const errorMsg = `Destination directory not found for layer '${layer.name}' (permissions issue or directory structure changed)`;
            failedFiles.push({
              path: `layers/${layer.name}`,
              error: errorMsg,
              isCritical: true,
            });
            criticalLayers.add(layer.name);
            continue;
          }

          // Restore all YAML files from backup
          const backupFiles = await fs.readdir(backupLayerDir);
          let filesRestoredInLayer = 0;

          for (const file of backupFiles) {
            if (file.endsWith(".yaml") || file.endsWith(".yml")) {
              const backupFilePath = path.join(backupLayerDir, file);
              const destFilePath = path.join(layerDirPath, file);
              try {
                const fileContent = await readFile(backupFilePath);
                await atomicWrite(destFilePath, fileContent);
                restoredFiles.push(`layers/${layer.name}/${file}`);
                filesRestoredInLayer++;
              } catch (fileError) {
                // Individual file restoration failure - still critical for data integrity
                const errorMsg = fileError instanceof Error ? fileError.message : String(fileError);

                // Log immediately with ERROR severity
                console.error(ansis.red(`✗ Failed to restore ${layer.name}/${file}: ${errorMsg}`));

                failedFiles.push({
                  path: `layers/${layer.name}/${file}`,
                  error: errorMsg,
                  isCritical: true,
                });
                criticalLayers.add(layer.name);
              }
            }
          }
        } catch (error) {
          // Unexpected error during layer restoration - treat as critical
          const errorMessage = getErrorMessage(error);
          failedFiles.push({
            path: `layers/${layer.name}`,
            error: errorMessage,
            isCritical: true,
          });
          criticalLayers.add(layer.name);
        }
      }

      // Reload model layers to reflect restored state
      model.layers.clear();

      // CRITICAL: If any critical layers failed to restore, throw error immediately
      if (criticalLayers.size > 0) {
        const failedLayersList = Array.from(criticalLayers).join(", ");
        const detailedErrors = failedFiles.map((f) => `  - ${f.path}: ${f.error}`).join("\n");

        const errorSummary =
          `Model restoration FAILED - ${failedFiles.length} critical layer(s) could not be restored:\n` +
          `  Failed layers: ${failedLayersList}\n` +
          `\n` +
          `Detailed errors:\n${detailedErrors}\n` +
          `\n` +
          `Successfully restored: ${restoredFiles.length} files\n` +
          `Failed to restore: ${failedFiles.length} files\n` +
          `\n` +
          `Possible causes:\n` +
          `  1. Backup directory corrupted or incomplete\n` +
          `  2. Insufficient permissions to write to model directory\n` +
          `  3. Disk full during restoration\n` +
          `  4. Layer directory structure changed since backup\n` +
          `\n` +
          `Backup location: ${backupDir}\n` +
          `\n` +
          `ACTION REQUIRED: Manually restore from backup or contact support.`;

        throw new Error(errorSummary);
      }
    } catch (error) {
      // Critical failure during restore
      const errorMessage = getErrorMessage(error);
      const summary =
        `Model restoration failed: ${errorMessage}\n` +
        `\n` +
        `Restoration progress:\n` +
        `  Successfully restored: ${restoredFiles.length} files\n` +
        `  Failed to restore: ${failedFiles.length} files (all critical)\n` +
        `\n` +
        `Restored files:\n${restoredFiles.map((f) => `  ✓ ${f}`).join("\n")}\n` +
        `\n` +
        `Failed files:\n${failedFiles.map((f) => `  ${f.isCritical ? "✗ [CRITICAL]" : "⚠ [WARNING]"} ${f.path}: ${f.error}`).join("\n")}\n` +
        `\n` +
        `Backup location: ${backupDir}`;

      throw new Error(summary);
    }
  }

  /**
   * Find the directory path for a layer in the model.
   * Uses same discovery logic as Model.loadLayer to locate layer directories.
   * Handles naming convention: `{PREFIX}_{layerName}` where PREFIX is numeric (01_motivation, etc).
   *
   * @param rootPath - Root path of the model
   * @param layerName - Name of the layer to find
   * @returns Path to the layer directory or null if not found
   */
  private async findLayerDirectory(rootPath: string, layerName: string): Promise<string | null> {
    const fs = await import("fs/promises");
    const modelDir = path.join(rootPath, "documentation-robotics", "model");

    try {
      const entries = await fs.readdir(modelDir, { withFileTypes: true });
      const layerDir = entries.find(
        (e) =>
          e.isDirectory() && e.name.match(/^\d{2}_/) && e.name.replace(/^\d{2}_/, "") === layerName
      );

      if (layerDir) {
        return path.join(modelDir, layerDir.name);
      }

      // Layer directory legitimately not found
      return null;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException)?.code;

      if (errorCode === "ENOENT") {
        // Model directory doesn't exist - this might be OK during restore
        return null;
      }

      // All other errors are CRITICAL during restore operations
      throw new Error(
        `Cannot access model directory for layer '${layerName}': ${getErrorMessage(error)}\n` +
          `Location: ${modelDir}\n` +
          `Error code: ${errorCode}\n` +
          `This indicates a filesystem or permissions issue. Check:\n` +
          `  1. Directory permissions: ls -la ${path.dirname(modelDir)}\n` +
          `  2. Disk health: df -h\n` +
          `  3. Filesystem errors: dmesg | tail`
      );
    }
  }

  /**
   * Generate a unique changeset ID.
   * Combines timestamp and random suffix to ensure uniqueness across concurrent operations.
   *
   * @returns A unique changeset ID in format `changeset-{timestamp}-{random}`
   */
  private generateChangesetId(): string {
    return `changeset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/** The layer an element ID names (`{layer}.{type}.{name}`), when it is a canonical layer. */
function layerOfId(id: string | undefined): string | undefined {
  const layer = id?.split(".")[0];
  return layer && isValidLayerName(layer) ? layer : undefined;
}

/** The layer an element is in, from the model or its ID. */
function layerOfElement(model: Model, id: string | undefined): string | undefined {
  if (!id) return undefined;
  const element = model.getElementById(id);
  return element?.layer_id || element?.layer || layerOfId(id);
}

/**
 * The layers whose reports a commit of `changes` can alter (round-2 friction: commit rewrote the
 * report of every layer related to a changed layer). An element change touches its own layer and
 * the layers at the other end of its relationships; a relationship change touches both its ends.
 */
function reportLayersForChanges(
  orchestrator: ModelReportOrchestrator,
  model: Model,
  changes: StagedChange[]
): Set<string> {
  const layers = new Set<string>();
  const add = (layer: unknown) => {
    if (typeof layer === "string" && isValidLayerName(layer)) layers.add(layer);
  };
  for (const change of changes) {
    if (change.type === "relationship-add" || change.type === "relationship-delete") {
      const data = (change.after ?? change.before ?? {}) as Record<string, unknown>;
      const [source, , target] =
        typeof data.source === "string"
          ? [data.source, data.predicate, data.target as string | undefined]
          : change.elementId.split("::");
      add(change.layerName);
      add(data.layer);
      add(data.targetLayer);
      add(layerOfElement(model, source));
      add(layerOfElement(model, target));
      continue;
    }
    const snapshot = (change.after ?? change.before ?? {}) as { id?: unknown; path?: unknown };
    const element = model.getElementById(change.elementId);
    const ids = elementIdentifiers(element ?? snapshot, change.elementId, element?.path || undefined);
    for (const layer of orchestrator.computeElementAffectedLayers(change.layerName, ids)) {
      layers.add(layer);
    }
  }
  return layers;
}
