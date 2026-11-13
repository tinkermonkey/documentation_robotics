/**
 * MutationHandler - Unified mutation execution strategy
 *
 * Eliminates duplicate code paths by centralizing all element mutations.
 * Ensures consistency between staging and base model operations through
 * a single execution path that supports both.
 *
 * This fixes data corruption risk from divergent code paths in add/update/delete commands.
 */

import { Model } from "./model.js";
import { Element } from "./element.js";
import { elementIdentifiers } from "./relationships.js";
import { StagingAreaManager } from "./staging-area.js";
import { isValidLayerName } from "./layers.js";
import { CLIError } from "../utils/errors.js";
import { ChangesetOnlyError } from "./changeset-only-guard.js";
import { trackModelWrite } from "./model-write-tracker.js";
import { getErrorMessage } from "../utils/errors.js";
import { ModelReportOrchestrator } from "../reports/model-report-orchestrator.js";
import { emitLog, SeverityNumber } from "../telemetry/index.js";
import type { Changeset, StagedChange } from "./changeset.js";
import { changedFields } from "./changeset-summary.js";

/**
 * An element snapshot staged by an add, with an update applied: the top-level keys the update
 * changed (before vs after) take their new value, and a key the update cleared is removed. Keys the
 * update did not touch keep the add's own value, so the add's shape is preserved.
 */
export function foldIntoSnapshot(
  addAfter: Record<string, unknown>,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined
): Record<string, unknown> {
  const folded = { ...addAfter };
  const b = before ?? {};
  const a = after ?? {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[key]) === JSON.stringify(a[key])) continue;
    if (a[key] === undefined) {
      delete folded[key];
    } else {
      folded[key] = a[key];
    }
  }
  // A cleared source reference is written as `source_reference: null`; drop the legacy camelCase key
  // so it cannot shadow it.
  if ("source_reference" in a && JSON.stringify(b.source_reference) !== JSON.stringify(a.source_reference)) {
    delete folded.sourceReference;
  }
  return folded;
}

export type MutationType = "add" | "update" | "delete";

export interface MutationContext {
  model: Model;
  elementId: string;
  layerName: string;
  element?: Element;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface MutationStep {
  execute: (context: MutationContext) => void | Promise<void>;
  stageable: boolean; // Can this step be executed in staging?
  description: string;
}

/**
 * Unified mutation executor
 *
 * Single point of mutation execution that:
 * 1. Builds complete before/after states
 * 2. Validates mutations
 * 3. Executes consistently for both staging and base model
 * 4. Handles all persistence atomically
 * 5. Tracks changes in legacy changeset context
 */
export class MutationHandler {
  private context: MutationContext;
  private steps: MutationStep[] = [];
  private stagingManager: StagingAreaManager;
  private changedFields: string[] = [];
  private foldedIntoAdd = false;

  constructor(model: Model, elementId: string, layerName: string) {
    this.context = { model, elementId, layerName };
    this.stagingManager = new StagingAreaManager(model.rootPath, model);
  }

  /**
   * Set the element being mutated
   */
  setElement(element: Element): this {
    this.context.element = element;
    return this;
  }

  /**
   * Add a mutation step
   */
  addStep(step: MutationStep): this {
    this.steps.push(step);
    return this;
  }

  /**
   * Get before state (snapshot before mutations)
   */
  getBeforeState(): Record<string, unknown> | undefined {
    return this.context.before;
  }

  /**
   * Get after state (result of mutations)
   */
  getAfterState(): Record<string, unknown> | undefined {
    return this.context.after;
  }

  /**
   * Get staging manager for accessing changeset information
   */
  getStagingManager(): StagingAreaManager {
    return this.stagingManager;
  }

  /**
   * The fields the last executeUpdate changed (`attributes.x` for attribute keys), sorted.
   * Empty before an update runs or when it changed nothing.
   */
  getChangedFields(): string[] {
    return this.changedFields;
  }

  /** Whether the last executeUpdate rewrote the changeset's staged add of the element in place. */
  wasFoldedIntoAdd(): boolean {
    return this.foldedIntoAdd;
  }

  /**
   * The active changeset's add of this element, when an update should be folded into it: the
   * add is the element's only staged element change (an update staged after it by an earlier
   * build keeps the old append behaviour, so it is not overridden), and the base model does not
   * already hold the element (commit skips such an add; a staged update still applies).
   */
  private async stagedAddToFoldInto(changeset: Changeset, element: Element): Promise<StagedChange | null> {
    const ids = new Set(elementIdentifiers(element, this.context.elementId));
    const own = (changeset.changes as StagedChange[]).filter(
      (c) => !c.type.startsWith("relationship-") && ids.has(c.elementId)
    );
    if (own.length !== 1 || own[0].type !== "add" || !own[0].after) return null;
    const baseLayer = await this.context.model.getBaseLayer(this.context.layerName);
    if ([...ids].some((id) => baseLayer?.getElement(id))) return null;
    return own[0];
  }

  /**
   * Compute before and after states
   *
   * For add: before is undefined, after is the new element state
   * For update: before is original state, after is modified state
   * For delete: before is original state, after is undefined
   */
  async computeStates(element: Element): Promise<void> {
    this.context.element = element;
    this.context.before = element.toJSON() as unknown as Record<string, unknown>;
    this.context.after = { ...this.context.before };
  }

  /**
   * Execute mutation for add operation
   */
  async executeAdd(
    element: Element,
    mutator: (elem: Element) => void | Promise<void>
  ): Promise<void> {
    // For add, before is undefined, after is the new element
    this.context.element = element;
    this.context.before = undefined;

    // Check if we're in staging mode
    const activeChangeset = await this.stagingManager.getActive();
    if (activeChangeset && activeChangeset.status === "staged") {
      // Staging path: capture after state and stage
      this.context.after = element.toJSON() as unknown as Record<string, unknown>;

      await this.stagingManager.stage(activeChangeset.id, {
        type: "add",
        elementId: this.context.elementId,
        layerName: this.context.layerName,
        after: this.context.after,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Base model path: add element and persist
    await mutator(element);
    this.context.after = element.toJSON() as unknown as Record<string, unknown>;

    // Persist to base model
    await this._persistChanges("add");
  }

  /**
   * Execute mutation for update operation
   */
  async executeUpdate(
    element: Element,
    mutator: (elem: Element, after: Record<string, unknown>) => Promise<void>
  ): Promise<void> {
    // Compute before and after states
    this.context.element = element;
    this.context.before = element.toJSON() as unknown as Record<string, unknown>;
    this.context.after = { ...this.context.before };

    // Check if we're in staging mode
    const activeChangeset = await this.stagingManager.getActive();
    if (activeChangeset && activeChangeset.status === "staged") {
      // Staging path: apply mutations to after state, then stage
      await mutator(element, this.context.after);
      this.changedFields = changedFields(this.context.before, this.context.after);

      // An element this changeset adds: rewrite the add's snapshot rather than stacking an update.
      const add = await this.stagedAddToFoldInto(activeChangeset, element);
      if (add) {
        await this.stagingManager.restage(activeChangeset.id, add.elementId, {
          type: "add",
          elementId: add.elementId,
          layerName: add.layerName,
          ...(add.before !== undefined ? { before: add.before } : {}),
          after: foldIntoSnapshot(add.after!, this.context.before, this.context.after),
          timestamp: new Date().toISOString(),
        });
        this.foldedIntoAdd = true;
        return;
      }

      await this.stagingManager.stage(activeChangeset.id, {
        type: "update",
        elementId: this.context.elementId,
        layerName: this.context.layerName,
        before: this.context.before,
        after: this.context.after,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Base model path: apply mutations atomically
    await this._executeBasePath(mutator);
  }

  /**
   * Execute mutation for delete operation
   */
  async executeDelete(element: Element): Promise<void> {
    // For delete, before is the current state, after is undefined
    this.context.element = element;
    this.context.before = element.toJSON() as unknown as Record<string, unknown>;
    this.context.after = undefined;

    // Every identifier relationships.yaml may use for this element: UUID id, dotted
    // path, and whatever the caller addressed it by.
    const identifiers = elementIdentifiers(element, this.context.elementId);

    // Check if we're in staging mode
    const activeChangeset = await this.stagingManager.getActive();
    if (activeChangeset && activeChangeset.status === "staged") {
      // Staging path: stage the deletion, then stage the removal of every
      // relationship that names the element so the commit leaves no dangling rows
      // (and so commit validation does not reject the changeset for them).
      await this.stagingManager.stage(activeChangeset.id, {
        type: "delete",
        elementId: this.context.elementId,
        layerName: this.context.layerName,
        before: this.context.before,
        timestamp: new Date().toISOString(),
      });

      const ids = new Set(identifiers);
      // A cascade delete stages one handler per element; a row between two deleted
      // elements must not be staged for removal twice.
      const alreadyStaged = new Set(
        activeChangeset.changes
          .filter((change) => change.type === "relationship-delete")
          .map((change) => change.elementId)
      );
      const dangling = this.context.model.relationships
        .getAll()
        .filter((rel) => ids.has(rel.source) || ids.has(rel.target))
        .filter((rel) => !alreadyStaged.has(`${rel.source}::${rel.predicate}::${rel.target}`));
      for (const rel of dangling) {
        alreadyStaged.add(`${rel.source}::${rel.predicate}::${rel.target}`);
        await this.stagingManager.stage(activeChangeset.id, {
          type: "relationship-delete",
          elementId: `${rel.source}::${rel.predicate}::${rel.target}`,
          layerName: rel.layer,
          before: {
            source: rel.source,
            target: rel.target,
            predicate: rel.predicate,
            layer: rel.layer,
            ...(rel.targetLayer ? { targetLayer: rel.targetLayer } : {}),
            ...(rel.properties ? { properties: rel.properties } : {}),
          },
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    // Base model path: delete from model
    const layer = (await this.context.model.getLayer(this.context.layerName))!;
    const deleted = layer.deleteElement(element.path || element.id);

    if (!deleted) {
      throw new CLIError(`Failed to delete element ${this.context.elementId}`, 1, [
        "Element may have already been deleted",
      ]);
    }

    // Delete relationships that name the element by UUID or by path
    this.context.model.relationships.deleteForElement(identifiers);

    // Track and save atomically
    await this._persistChanges("delete");
  }

  /**
   * Execute all registered steps and persist
   */
  async execute(
    mutator: (elem: Element, after: Record<string, unknown>) => Promise<void>,
    type: "add" | "update" | "delete"
  ): Promise<void> {
    if (!this.context.element) {
      throw new CLIError("Element not set on MutationHandler", 1);
    }

    // Check if we're in staging mode
    const activeChangeset = await this.stagingManager.getActive();
    if (activeChangeset && activeChangeset.status === "staged") {
      // Staging path: build after state and stage
      if (this.context.before === undefined && type !== "add") {
        this.context.before = this.context.element.toJSON() as unknown as Record<string, unknown>;
      }

      this.context.after =
        type === "delete"
          ? undefined
          : {
              ...(this.context.before ||
                (this.context.element.toJSON() as unknown as Record<string, unknown>)),
            };

      if (type !== "delete" && this.context.after) {
        await mutator(this.context.element, this.context.after);
      }

      await this.stagingManager.stage(activeChangeset.id, {
        type,
        elementId: this.context.elementId,
        layerName: this.context.layerName,
        ...(this.context.before !== undefined && { before: this.context.before }),
        ...(this.context.after !== undefined && { after: this.context.after }),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Base model path: execute and persist atomically
    await this._executeBasePath(mutator, type);
  }

  /**
   * Base model path: execute mutations and persist atomically
   */
  private async _executeBasePath(
    mutator: (elem: Element, after: Record<string, unknown>) => Promise<void>,
    type?: string
  ): Promise<void> {
    if (!this.context.element) {
      throw new CLIError("Element not set", 1);
    }

    // Initialize before state if not already set
    if (this.context.before === undefined) {
      this.context.before = this.context.element.toJSON() as unknown as Record<string, unknown>;
    }

    // Initialize after state if not already set
    if (this.context.after === undefined) {
      this.context.after = { ...this.context.before };
    }

    // Apply mutations to element AND after state together
    // This ensures they stay in sync
    await mutator(this.context.element, this.context.after);
    this.changedFields = changedFields(this.context.before, this.context.after);

    // Persist changes to disk
    await this._persistChanges(type);
  }

  /**
   * Persist changes to disk
   *
   * Performs sequential writes to layer, relationships, and manifest files.
   * If any write fails, subsequent writes are skipped via error propagation.
   * Note: Not truly atomic—if a write succeeds then a later write fails,
   * earlier writes remain on disk. Use within transaction-like contexts only.
   */
  private async _persistChanges(type?: string): Promise<void> {
    const model = this.context.model;
    try {
      // One tracked write across the three files, so a reader in this process waits for all of them.
      await trackModelWrite(model.rootPath, model, async () => {
        // Save layer
        await model.saveLayer(this.context.layerName);

        // Save relationships if modified (for deletes)
        if (type === "delete" && model.relationships.isDirty()) {
          await model.saveRelationships();
        }

        // Save manifest
        await model.saveManifest();
      });
    } catch (error) {
      // A changeset-only refusal is not a disk failure: keep it recognisable for callers.
      if (error instanceof ChangesetOnlyError) throw error;
      throw new CLIError(
        `Failed to persist changes: ${getErrorMessage(error)}`,
        1,
        ["Check that the model directory is writable", "Verify the model is not corrupted"]
      );
    }

    // Post-persist: regenerate affected layer reports (non-blocking, FR-4)
    // This is a separate try/catch from the above to ensure report failures never cause mutations to fail
    try {
      const orchestrator = new ModelReportOrchestrator(
        this.context.model,
        this.context.model.rootPath
      );
      if (isValidLayerName(this.context.layerName)) {
        const affected = orchestrator.computeAffectedLayers(this.context.layerName);
        await orchestrator.regenerate(affected);
      } else {
        emitLog(SeverityNumber.WARN, "Report regeneration skipped: invalid layer name", {
          "layer.name": this.context.layerName,
          "elementId": this.context.elementId,
        });
      }
    } catch (error) {
      emitLog(SeverityNumber.WARN, "Failed to update layer reports after mutation", {
        "error": getErrorMessage(error),
        "layer.name": this.context.layerName,
        "elementId": this.context.elementId,
      });
    }
  }
}
