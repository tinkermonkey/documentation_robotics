/**
 * Semantic validation for business rules
 */

import { ValidationResult } from "./types.js";
import type { Model } from "../core/model.js";
import { RELATIONSHIPS_BY_PREDICATE } from "../generated/relationship-index.js";
import { RECOMMENDED_INTERFACE_PROTOCOLS, recommendedProtocol } from "../core/interface-protocol.js";

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
    this.validateInterfaceProtocols(model, result);

    return result;
  }

  /**
   * Rule: an application interface's protocol is open text (spec 0.16.0) with a recommended
   * vocabulary (interface-protocol.ts). A value outside it is advice, never an error: REST and HTTPS
   * are written HTTP, a known protocol in another spelling gets its own, and an unknown one is named
   * so the modeller can check it is the highest-level protocol the interface speaks.
   */
  private validateInterfaceProtocols(model: Model, result: ValidationResult): void {
    const layer = model.layers.get("application");
    if (!layer) return;
    for (const element of layer.listElements()) {
      if (element.type !== "applicationinterface") continue;
      const protocol = element.attributes?.protocol;
      if (typeof protocol !== "string" || protocol.trim() === "") continue;
      const recommended = recommendedProtocol(protocol);
      if (recommended === protocol) continue;
      const elementId = element.path || element.id;
      result.addWarning({
        layer: "application",
        elementId,
        category: "semantic",
        message: recommended
          ? `Application interface protocol '${protocol}' is written '${recommended}' (REST is a style over HTTP, HTTPS is HTTP plus TLS, and a protocol is spelled as its own documentation spells it)`
          : `Application interface protocol '${protocol}' is not in the recommended vocabulary (${RECOMMENDED_INTERFACE_PROTOCOLS.join(", ")})`,
        fixSuggestion: recommended
          ? `dr update ${elementId} --attribute-patch '{"protocol":"${recommended}"}' (or model_update with attributePatch)`
          : "Name the highest-level protocol the interface speaks (MCP for an MCP server, not JSON-RPC or HTTP). " +
            "If it is a real protocol the list lacks, keep it; leave protocol unset where interfaceType says all there is.",
      });
    }
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
