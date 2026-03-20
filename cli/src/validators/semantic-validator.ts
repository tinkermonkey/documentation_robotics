/**
 * Semantic validation for business rules
 */

import { ValidationResult } from "./types.js";
import type { Model } from "../core/model.js";
import { fileURLToPath } from "url";
import path from "path";
import { readFile } from "../utils/file-io.js";

/**
 * Validator for semantic/business rule validation
 *
 * Validates model conformance to architectural business rules including:
 * - Relationship predicate validation against the 47 predicates in base.json
 * - Cross-layer reference constraints
 * - Layer-specific validation rules
 *
 * Loads predicates from base.json asynchronously on first use.
 */
export class SemanticValidator {
  /**
   * Set of valid predicate names loaded from base.json
   * Null if load has not been attempted yet
   */
  private validPredicates: Set<string> | null = null;

  /**
   * Flag to track if predicate load has been attempted
   */
  private predicatesLoaded: boolean = false;

  constructor() {
    // Load predicates asynchronously on first use
  }

  /**
   * Ensure predicates are loaded from base.json
   */
  private async ensurePredicatesLoaded(): Promise<void> {
    if (this.predicatesLoaded) {
      return;
    }

    await this.loadPredicates();
    this.predicatesLoaded = true;
  }

  /**
   * Load predicates from base.json (bundled spec distribution)
   * base.json stores predicates as a flat dict under the "predicates" key
   */
  private async loadPredicates(): Promise<void> {
    try {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const basePath = path.join(__dirname, "..", "schemas", "bundled", "base.json");
      const content = await readFile(basePath);
      const base = JSON.parse(content);
      const predicatesDict = base.predicates;
      if (predicatesDict && typeof predicatesDict === "object") {
        this.validPredicates = new Set(
          Object.values(predicatesDict as Record<string, { predicate: string }>)
            .map((p) => p.predicate)
            .filter(Boolean)
        );
      }
    } catch (error) {
      if (process.env.DEBUG) {
        console.warn(
          "[DEBUG] Failed to load predicates from base.json:",
          error instanceof Error ? error.message : String(error)
        );
      }
      this.validPredicates = null;
    }
  }

  /**
   * Validate semantic constraints of a model
   */
  async validateModel(model: Model): Promise<ValidationResult> {
    const result = new ValidationResult();

    await this.ensurePredicatesLoaded();

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
   * Validate relationship predicates against the known predicate set from base.json
   */
  private validateRelationshipPredicates(model: Model, result: ValidationResult): void {
    if (!this.validPredicates) {
      // If predicates failed to load, skip validation rather than false-positives
      return;
    }

    for (const [layerName, layer] of model.layers) {
      for (const element of layer.listElements()) {
        for (const rel of element.relationships || []) {
          if (!this.validPredicates.has(rel.predicate)) {
            result.addWarning({
              layer: layerName,
              elementId: element.path || element.id,
              message: `Unknown relationship predicate '${rel.predicate}' — not in spec predicate catalog`,
              fixSuggestion: "Use `dr catalog types` to list valid predicates",
            });
          }
        }
      }
    }
  }
}
