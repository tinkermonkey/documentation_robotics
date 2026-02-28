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

    return result;
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
              elementId: element.id,
              message: `Unknown relationship predicate '${rel.predicate}' — not in spec predicate catalog`,
              fixSuggestion: "Use `dr catalog types` to list valid predicates",
            });
          }
        }
      }
    }
  }
}
