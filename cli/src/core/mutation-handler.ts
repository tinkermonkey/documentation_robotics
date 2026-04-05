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
import { StagingAreaManager } from "./staging-area.js";
import { isValidLayerName } from "./layers.js";
import { CLIError } from "../utils/errors.js";
import { getErrorMessage } from "../utils/errors.js";
import { ModelReportOrchestrator } from "../reports/model-report-orchestrator.js";
import { emitLog, SeverityNumber } from "../telemetry/index.js";

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

    // Check if we're in staging mode
    const activeChangeset = await this.stagingManager.getActive();
    if (activeChangeset && activeChangeset.status === "staged") {
      // Staging path: stage the deletion only
      await this.stagingManager.stage(activeChangeset.id, {
        type: "delete",
        elementId: this.context.elementId,
        layerName: this.context.layerName,
        before: this.context.before,
        timestamp: new Date().toISOString(),
      });
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

    // Delete relationships
    this.context.model.relationships.deleteForElement(this.context.elementId);

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

    // Persist atomically
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
    try {
      // Save layer
      await this.context.model.saveLayer(this.context.layerName);

      // Save relationships if modified (for deletes)
      if (type === "delete" && this.context.model.relationships.isDirty()) {
        await this.context.model.saveRelationships();
      }

      // Save manifest
      await this.context.model.saveManifest();
    } catch (error) {
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
