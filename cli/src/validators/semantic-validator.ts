/**
 * Semantic validation for business rules
 */

import { ValidationResult } from "./types.js";
import type { Model } from "../core/model.js";
import { RELATIONSHIPS_BY_PREDICATE } from "../generated/relationship-index.js";

/**
 * Validator for semantic/business rule validation
 *
 * Validates model conformance to architectural business rules including:
 * - Relationship predicate validation against defined spec relationship schemas
 * - Cross-layer reference constraints
 * - Layer-specific validation rules
 */
export class SemanticValidator {
  /**
   * Validate semantic constraints of a model
   */
  async validateModel(model: Model): Promise<ValidationResult> {
    const result = new ValidationResult();

    this.validateRelationshipPredicates(model, result);
    this.validateApmInferredWithoutSdk(model, result);

    return result;
  }

  /**
   * Rule: apm_inferred_without_sdk
   *
   * When the APM layer contains MetricInstrument, Span, TraceConfiguration, or
   * ExporterConfig elements and ALL of them have source_reference.provenance = "inferred",
   * emit a WARNING suggesting OTel SDK verification.
   *
   * Rationale: The APM skill's checklist can cause Claude to add instrumentation
   * elements without verifying that an OTel SDK is present. This validator surfaces
   * the accuracy concern on every subsequent `dr validate` run.
   */
  private validateApmInferredWithoutSdk(model: Model, result: ValidationResult): void {
    const apmLayer = model.layers.get("apm");
    if (!apmLayer) {
      return;
    }

    const instrumentationTypes = new Set(["metricinstrument", "span", "traceconfiguration", "exporterconfig"]);
    const instrumentationElements = apmLayer.listElements().filter((e) =>
      instrumentationTypes.has(e.type)
    );

    if (instrumentationElements.length === 0) {
      return;
    }

    const allInferred = instrumentationElements.every(
      (e) => e.source_reference?.provenance === "inferred"
    );

    if (allInferred) {
      result.addWarning({
        layer: "apm",
        elementId: "apm.*",
        message:
          `All ${instrumentationElements.length} APM instrumentation element(s) have provenance: inferred. ` +
          "If no @opentelemetry SDK exists in package.json, these elements are aspirational rather than " +
          "implemented. Consider marking them as such in their descriptions.",
        fixSuggestion:
          "Run: grep '@opentelemetry' package.json — if absent, update element descriptions to note " +
          "that instrumentation is aspirational and no OTel export is implemented.",
      });
    }
  }

  /**
   * Validate relationship predicates against the generated spec relationship index.
   * RELATIONSHIPS_BY_PREDICATE is compiled from all spec relationship schema files,
   * so it is always consistent with the spec without manual synchronization.
   */
  private validateRelationshipPredicates(model: Model, result: ValidationResult): void {
    for (const [layerName, layer] of model.layers) {
      for (const element of layer.listElements()) {
        for (const rel of element.relationships || []) {
          if (!RELATIONSHIPS_BY_PREDICATE.has(rel.predicate)) {
            result.addWarning({
              layer: layerName,
              elementId: element.path || element.id,
              message: `Relationship predicate '${rel.predicate}' is not defined in any spec relationship schema`,
              fixSuggestion: `Run 'dr catalog types' to list valid predicates, or 'dr catalog search ${rel.predicate}' to find the correct predicate`,
            });
          }
        }
      }
    }
  }
}
