/**
 * ChangesetValidator - Validates staged changes against projected model
 *
 * Runs the complete 4-stage validation pipeline against a merged view
 * of the base model with staged changes applied.
 */

import { VirtualProjectionEngine } from "./virtual-projection.js";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";
import { Validator } from "../validators/validator.js";
import { ValidationResult } from "../validators/types.js";
import type { Model } from "./model.js";

/**
 * Validates changesets by running validation pipeline on projected models
 */
export class ChangesetValidator {
  private projectionEngine: VirtualProjectionEngine;
  private storage: StagedChangesetStorage;
  private validator: Validator;

  constructor(rootPath: string) {
    this.projectionEngine = new VirtualProjectionEngine(rootPath);
    this.storage = new StagedChangesetStorage(rootPath);
    this.validator = new Validator();
  }

  /**
   * Validate a changeset by running the full 4-stage pipeline on its projected model.
   *
   * Only errors affecting elements touched by the changeset (add/update) block the
   * commit. Pre-existing errors in unchanged elements are demoted to warnings so that
   * incremental fixes can be committed without requiring the entire model to be valid
   * first.
   *
   * @param baseModel - The base model to project
   * @param changesetId - The changeset to validate
   * @returns ValidationResult from all 4 stages
   */
  async validateChangeset(baseModel: Model, changesetId: string): Promise<ValidationResult> {
    // Collect element IDs touched by this changeset (add/update only)
    const changeset = await this.storage.load(changesetId);
    const changedElementIds = new Set<string>();
    if (changeset) {
      for (const change of changeset.changes) {
        if (change.type === "add" || change.type === "update") {
          changedElementIds.add(change.elementId);
        }
      }
    }

    // Project the model with staged changes applied
    const projectedModel = await this.projectionEngine.projectModel(baseModel, changesetId);

    // Run unified validator on projected model
    const fullResult = await this.validator.validateModel(projectedModel as unknown as Model);

    if (changedElementIds.size === 0) {
      return fullResult;
    }

    // Partition errors: block on errors for changed elements; demote pre-existing
    // errors in unchanged elements to warnings so they don't block this commit.
    const filtered = new ValidationResult();
    for (const error of fullResult.errors) {
      if (!error.elementId || changedElementIds.has(error.elementId)) {
        filtered.errors.push(error);
      } else {
        filtered.warnings.push({ ...error, severity: "warning" });
      }
    }
    filtered.warnings.push(...fullResult.warnings);

    return filtered;
  }
}
