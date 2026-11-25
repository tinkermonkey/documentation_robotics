/**
 * Unified validator orchestrating the 5-stage validation pipeline
 */

import { ValidationResult } from "./types.js";
import { SchemaValidator } from "./schema-validator.js";
import { NamingValidator } from "./naming-validator.js";
import { ReferenceValidator } from "./reference-validator.js";
import { SemanticValidator } from "./semantic-validator.js";
import { RelationshipValidator } from "./relationship-schema-validator.js";
import { typeNotInDeclaredSpec } from "../core/declared-spec.js";
import { isValidNodeType, normalizeNodeType } from "../generated/node-types.js";
import type { Model } from "../core/model.js";
import { startActiveSpan } from "../telemetry/index.js";


/**
 * Unified validator implementing the 5-stage validation pipeline:
 * 1. Schema validation (AJV)
 * 2. Naming validation (element ID format)
 * 3. Reference validation (cross-layer integrity)
 * 4. Semantic validation (business rules)
 * 5. Relationship schema validation (cardinality constraints)
 */
export class Validator {
  private schemaValidator: SchemaValidator;
  private namingValidator: NamingValidator;
  private referenceValidator: ReferenceValidator;
  private semanticValidator: SemanticValidator;
  private relationshipValidator: RelationshipValidator;

  constructor() {
    this.schemaValidator = new SchemaValidator();
    this.namingValidator = new NamingValidator();
    this.referenceValidator = new ReferenceValidator();
    this.semanticValidator = new SemanticValidator();
    this.relationshipValidator = new RelationshipValidator();
  }

  /**
   * Validate a complete model through all 5 stages
   */
  async validateModel(model: Model): Promise<ValidationResult> {
    return startActiveSpan("model.validate", async (rootSpan) => {
      const result = new ValidationResult();

      // Stage 1: Schema validation — layers are independent, run in parallel
      await startActiveSpan("validation.stage.schema", async (stageSpan) => {
        await Promise.all(
          Array.from(model.layers.values()).map(async (layer) => {
            const schemaResult = await this.schemaValidator.validateLayer(layer);
            result.merge(schemaResult, `[Schema/${layer.name}]`);
          })
        );
        // A type this CLI's catalog has but the spec the model declares does not (#1411). A type
        // the catalog doesn't know is the schema validator's to report; a legacy short id
        // (business.service) is checked as the type it names.
        for (const layer of model.layers.values()) {
          const declared = new ValidationResult();
          for (const element of layer.listElements()) {
            if (!isValidNodeType(layer.name, element.type)) continue;
            const specNodeId = `${layer.name}.${normalizeNodeType(layer.name, element.type)}`;
            const gap = typeNotInDeclaredSpec(model.manifest, specNodeId);
            if (!gap) continue;
            const issue = {
              layer: layer.name,
              elementId: element.path || element.id,
              message: `Element '${element.path || element.id}': ${gap.message}`,
              category: "schema" as const,
            };
            // A manifest with no spec_version declares nothing: warn
            if (gap.assumed) declared.addWarning(issue);
            else declared.addError(issue);
          }
          result.merge(declared, `[Schema/${layer.name}]`);
        }
        stageSpan.setAttribute("validation.error_count", result.errors.length);
      });

      // Stage 2: Naming validation
      await startActiveSpan("validation.stage.naming", async (stageSpan) => {
        for (const layer of model.layers.values()) {
          const namingResult = this.namingValidator.validateLayer(layer);
          result.merge(namingResult, `[Naming/${layer.name}]`);
        }
        stageSpan.setAttribute("validation.error_count", result.errors.length);
      });

      // Stage 3: Reference validation
      await startActiveSpan("validation.stage.reference", async (stageSpan) => {
        const referenceResult = this.referenceValidator.validateModel(model);
        result.merge(referenceResult, "[References]");
        stageSpan.setAttribute("validation.error_count", result.errors.length);
      });

      // Stage 4: Semantic validation
      await startActiveSpan("validation.stage.semantic", async (stageSpan) => {
        const semanticResult = await this.semanticValidator.validateModel(model);
        result.merge(semanticResult, "[Semantic]");
        stageSpan.setAttribute("validation.error_count", result.errors.length);
      });

      // Stage 5: Relationship schema validation (cardinality enforcement)
      await startActiveSpan("validation.stage.relationship-schema", async (stageSpan) => {
        await this.relationshipValidator.initialize();
        const relationshipResult = await this.relationshipValidator.validateModel(model);
        result.merge(relationshipResult, "[Relationship Schema]");
        stageSpan.setAttribute("validation.error_count", result.errors.length);
      });

      rootSpan.setAttribute("validation.valid", result.isValid());
      rootSpan.setAttribute("validation.error_count", result.errors.length);

      return result;
    }, {
      "model.path": model.rootPath,
    });
  }
}
