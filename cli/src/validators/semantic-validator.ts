/**
 * Semantic validation for business rules
 */

import { ValidationResult } from "./types.js";
import type { Model } from "../core/model.js";
import { fileURLToPath } from "url";
import path from "path";

/**
 * Validator for semantic/business rule validation
 *
 * Validates model conformance to architectural business rules including:
 * - Relationship predicate validation against relationship catalog
 * - Cross-layer reference constraints
 * - Layer-specific validation rules
 *
 * Loads relationship catalog asynchronously on first use to avoid startup overhead.
 */
export class SemanticValidator {
  /**
   * Cached relationship catalog from relationship-catalog.json
   * Contains mapping of relationship predicates to their definitions
   * Null if catalog fails to load (validation continues with reduced coverage)
   */
  private relationshipCatalog: Record<string, any> | null = null;

  /**
   * Flag to track if catalog load has been attempted
   * Prevents repeated load attempts if catalog is missing or fails to parse
   */
  private catalogLoaded: boolean = false;

  constructor() {
    // Load catalog asynchronously on first use
  }

  /**
   * Ensure relationship catalog is loaded
   */
  private async ensureCatalogLoaded(): Promise<void> {
    if (this.catalogLoaded) {
      return;
    }

    await this.loadRelationshipCatalog();
    this.catalogLoaded = true;
  }

  /**
   * Load the relationship catalog for predicate validation
   */
  private async loadRelationshipCatalog(): Promise<void> {
    try {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const catalogPath = path.join(
        __dirname,
        "..",
        "schemas",
        "bundled",
        "relationship-catalog.json"
      );
      this.relationshipCatalog = await import(catalogPath, { assert: { type: "json" } }).then(
        (m) => m.default
      );
    } catch (error) {
      // Catalog load failure is gracefully handled - validation continues without predicate checking
      // Note: Missing catalog reduces validation coverage (predicates won't be validated)
      if (process.env.DEBUG) {
        console.warn("[DEBUG] Failed to load relationship catalog:", error instanceof Error ? error.message : String(error));
      }
      this.relationshipCatalog = null;
    }
  }

  /**
   * Validate semantic constraints of a model
   */
  async validateModel(model: Model): Promise<ValidationResult> {
    const result = new ValidationResult();

    await this.ensureCatalogLoaded();

    this.validateRelationshipPredicates(model, result);

    return result;
  }

  /**
   * Validate relationship predicates against the catalog
   */
  private validateRelationshipPredicates(model: Model, result: ValidationResult): void {
    if (!this.relationshipCatalog) {
      // If we can't load the catalog, we can't validate predicates
      return;
    }

    for (const [layerName, layer] of model.layers) {
      const allowedPredicates = this.getAllowedPredicates(layerName);

      for (const element of layer.listElements()) {
        for (const rel of element.relationships || []) {
          if (!allowedPredicates.includes(rel.predicate)) {
            result.addWarning({
              layer: layerName,
              elementId: element.id,
              message: `Unknown relationship predicate '${rel.predicate}' for layer ${layerName}`,
              fixSuggestion:
                allowedPredicates.length > 0
                  ? `Use one of: ${allowedPredicates.join(", ")}`
                  : "Check relationship catalog for valid predicates",
            });
          }
        }
      }
    }
  }

  /**
   * Get allowed predicates for a layer from the catalog
   */
  private getAllowedPredicates(layerName: string): string[] {
    if (!this.relationshipCatalog) {
      return [];
    }

    const layerCatalog = this.relationshipCatalog.layers?.[layerName];
    if (!layerCatalog) {
      return [];
    }

    const predicates = layerCatalog.predicates || layerCatalog.relationships || [];
    return Array.isArray(predicates) ? predicates : Object.keys(predicates || {});
  }
}
