/**
 * Unified validator orchestrating the 4-stage validation pipeline
 */

import { ValidationResult } from './types.js';
import { SchemaValidator } from './schema-validator.js';
import { NamingValidator } from './naming-validator.js';
import { ReferenceValidator } from './reference-validator.js';
import { SemanticValidator } from './semantic-validator.js';
import type { Model } from '../core/model.js';

/**
 * Unified validator implementing the 4-stage validation pipeline:
 * 1. Schema validation (AJV)
 * 2. Naming validation (element ID format)
 * 3. Reference validation (cross-layer integrity)
 * 4. Semantic validation (business rules)
 */
export class Validator {
  private schemaValidator: SchemaValidator;
  private namingValidator: NamingValidator;
  private referenceValidator: ReferenceValidator;
  private semanticValidator: SemanticValidator;

  constructor() {
    this.schemaValidator = new SchemaValidator();
    this.namingValidator = new NamingValidator();
    this.referenceValidator = new ReferenceValidator();
    this.semanticValidator = new SemanticValidator();
  }

  /**
   * Validate a complete model through all 4 stages
   */
  async validateModel(model: Model): Promise<ValidationResult> {
    const result = new ValidationResult();

    // Stage 1: Schema validation
    for (const layer of model.layers.values()) {
      const schemaResult = await this.schemaValidator.validateLayer(layer);
      result.merge(schemaResult, `[Schema/${layer.name}]`);
    }

    // Stage 2: Naming validation
    for (const layer of model.layers.values()) {
      const namingResult = this.namingValidator.validateLayer(layer);
      result.merge(namingResult, `[Naming/${layer.name}]`);
    }

    // Stage 3: Reference validation
    const referenceResult = this.referenceValidator.validateModel(model);
    result.merge(referenceResult, '[References]');

    // Stage 4: Semantic validation
    const semanticResult = await this.semanticValidator.validateModel(model);
    result.merge(semanticResult, '[Semantic]');

    return result;
  }
}
