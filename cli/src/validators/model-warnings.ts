/**
 * The warnings `dr validate` adds after the validation pipeline: orphaned elements, and elements
 * with no source reference. The Validator doesn't raise them, so a caller that wants the same
 * warning count as `dr validate` adds them with this.
 */

import type { Model } from "../core/model.js";
import { ValidationFormatter } from "./validation-formatter.js";
import type { ValidationResult } from "./types.js";

export function addModelWarnings(result: ValidationResult, model: Model): void {
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
    for (const element of layer.listElements()) {
      if (element.source_reference) continue;
      const elementId = element.path || element.id;
      result.addWarning({
        message: `Element '${elementId}' has no source reference`,
        layer: layerName,
        elementId,
        fixSuggestion: "Add a source_reference with provenance to link this element to its implementation",
      });
    }
  }
}
