/**
 * ChangesetValidator - Validates staged changes against projected model
 *
 * Runs the complete 4-stage validation pipeline against a merged view
 * of the base model with staged changes applied.
 */

import { VirtualProjectionEngine } from './virtual-projection.js';
import { Validator } from '../validators/validator.js';
import { ValidationResult } from '../validators/types.js';
import type { Model } from './model.js';

/**
 * Validates changesets by running validation pipeline on projected models
 */
export class ChangesetValidator {
  private projectionEngine: VirtualProjectionEngine;
  private validator: Validator;

  constructor(rootPath: string) {
    this.projectionEngine = new VirtualProjectionEngine(rootPath);
    this.validator = new Validator();
  }

  /**
   * Validate a changeset by running the full 4-stage pipeline on its projected model
   *
   * @param baseModel - The base model to project
   * @param changesetId - The changeset to validate
   * @returns ValidationResult from all 4 stages
   */
  async validateChangeset(
    baseModel: Model,
    changesetId: string
  ): Promise<ValidationResult> {
    // Project the model with staged changes applied
    const projectedModel = await this.projectionEngine.projectModel(
      baseModel,
      changesetId
    );

    // Run unified validator on projected model
    // ProjectedModel has the same structure as Model (manifest + layers)
    // so it works with the existing validator pipeline
    const result = await this.validator.validateModel(
      projectedModel as unknown as Model
    );

    return result;
  }
}
