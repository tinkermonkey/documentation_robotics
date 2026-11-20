/**
 * The warnings `dr validate` adds after the validation pipeline: orphaned elements, and elements
 * with no source reference. The Validator doesn't raise them, so a caller that wants the same
 * warning count as `dr validate` adds them with this.
 *
 * `model_validate` passes `exemptIntentLayers` (#1215): an element of an intent layer (motivation,
 * business, product) states why the system exists and has no implementation to point at, so it is
 * not asked for one. Under `strict` it is asked for the document that states it instead.
 */

import { INTENT_LAYERS } from "../core/changeset-analysis.js";
import type { Model } from "../core/model.js";
import { ValidationFormatter } from "./validation-formatter.js";
import type { ValidationIssue, ValidationResult } from "./types.js";

export interface ModelWarningOptions {
  /**
   * Leave intent-layer elements out of the source-reference check. Default false: every element
   * is checked, as `dr validate` does.
   */
  exemptIntentLayers?: boolean;
  /**
   * Also warn about elements with no description and, with `exemptIntentLayers`, about
   * intent-layer elements with no reference to the document that states them.
   */
  strict?: boolean;
}

/**
 * What a warning is about, for counting and listing warnings by kind: one of the kinds added here,
 * else the category the validator gave it, else `other`.
 */
export type WarningKind =
  | "orphan"
  | "no-source-reference"
  | "no-document-reference"
  | "no-description"
  | "schema"
  | "semantic"
  | "reference"
  | "expected"
  | "other";

export function warningKind(issue: Pick<ValidationIssue, "category">): WarningKind {
  return issue.category ?? "other";
}

export function addModelWarnings(result: ValidationResult, model: Model, options: ModelWarningOptions = {}): void {
  const stats = ValidationFormatter.calculateStats(model);
  for (const orphanId of stats.orphanedElements) {
    result.addWarning({
      message: `Element '${orphanId}' is orphaned (no cross-layer references or intra-layer relationships)`,
      layer: orphanId.split(".")[0] ?? "",
      elementId: orphanId,
      category: "orphan",
      fixSuggestion: "Add cross-layer references or relationships to connect this element to the rest of the model",
    });
  }
  for (const [layerName, layer] of model.layers) {
    const intent = options.exemptIntentLayers === true && INTENT_LAYERS.has(layerName);
    for (const element of layer.listElements()) {
      const elementId = element.path || element.id;
      if (!element.source_reference) {
        if (!intent) {
          result.addWarning({
            message: `Element '${elementId}' has no source reference`,
            layer: layerName,
            elementId,
            category: "no-source-reference",
            fixSuggestion: "Add a source_reference with provenance to link this element to its implementation",
          });
        } else if (options.strict) {
          result.addWarning({
            message: `Element '${elementId}' has no document reference`,
            layer: layerName,
            elementId,
            category: "no-document-reference",
            fixSuggestion:
              `A ${layerName} element has no implementation to point at. If a document states it, add a ` +
              "source_reference to that document",
          });
        }
      }
      if (options.strict && (!element.description || element.description.trim() === "")) {
        result.addWarning({
          message: `Element '${elementId}' has no description`,
          layer: layerName,
          elementId,
          category: "no-description",
          fixSuggestion: "Add a description to document what this element represents",
        });
      }
    }
  }
}
