/**
 * Unified validator orchestrating the 4-stage validation pipeline
 */

import { ValidationResult } from "./types.js";
import { SchemaValidator } from "./schema-validator.js";
import { NamingValidator } from "./naming-validator.js";
import { ReferenceValidator } from "./reference-validator.js";
import { SemanticValidator } from "./semantic-validator.js";
import type { Model } from "../core/model.js";
import { startSpan, endSpan } from "../telemetry/index.js";

// Fallback for runtime environments where TELEMETRY_ENABLED is not defined by esbuild
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

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
    const rootSpan = isTelemetryEnabled
      ? startSpan("model.validate", {
          "model.path": model.rootPath,
        })
      : null;

    const result = new ValidationResult();

    try {
      // Stage 1: Schema validation
      const schemaStageSpan = isTelemetryEnabled ? startSpan("validation.stage.schema") : null;
      try {
        for (const layer of model.layers.values()) {
          const schemaResult = await this.schemaValidator.validateLayer(layer);
          result.merge(schemaResult, `[Schema/${layer.name}]`);
        }

        if (isTelemetryEnabled && schemaStageSpan) {
          schemaStageSpan.setAttribute("validation.error_count", result.errors.length);
        }
      } finally {
        endSpan(schemaStageSpan);
      }

      // Stage 2: Naming validation
      const namingStageSpan = isTelemetryEnabled ? startSpan("validation.stage.naming") : null;
      try {
        for (const layer of model.layers.values()) {
          const namingResult = this.namingValidator.validateLayer(layer);
          result.merge(namingResult, `[Naming/${layer.name}]`);
        }

        if (isTelemetryEnabled && namingStageSpan) {
          namingStageSpan.setAttribute("validation.error_count", result.errors.length);
        }
      } finally {
        endSpan(namingStageSpan);
      }

      // Stage 3: Reference validation
      const refStageSpan = isTelemetryEnabled ? startSpan("validation.stage.reference") : null;
      try {
        const referenceResult = this.referenceValidator.validateModel(model);
        result.merge(referenceResult, "[References]");

        if (isTelemetryEnabled && refStageSpan) {
          refStageSpan.setAttribute("validation.error_count", result.errors.length);
        }
      } finally {
        endSpan(refStageSpan);
      }

      // Stage 4: Semantic validation
      const semanticStageSpan = isTelemetryEnabled ? startSpan("validation.stage.semantic") : null;
      try {
        const semanticResult = await this.semanticValidator.validateModel(model);
        result.merge(semanticResult, "[Semantic]");

        if (isTelemetryEnabled && semanticStageSpan) {
          semanticStageSpan.setAttribute("validation.error_count", result.errors.length);
        }
      } finally {
        endSpan(semanticStageSpan);
      }

      if (isTelemetryEnabled && rootSpan) {
        rootSpan.setAttribute("validation.valid", result.isValid());
        rootSpan.setAttribute("validation.error_count", result.errors.length);
      }

      return result;
    } finally {
      endSpan(rootSpan);
    }
  }
}
