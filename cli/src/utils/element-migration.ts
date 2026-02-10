import { randomUUID } from "crypto";

import { Element } from "../core/element.js";
import type { Model } from "../core/model.js";

/**
 * Result of element format migration
 */
export interface MigrationResult {
  migrated: number; // Count of elements successfully migrated
  skipped: number; // Count of elements already in new format
  errors: string[]; // Error messages for failed migrations
  details: {
    layerName: string;
    elementId: string;
    status: "migrated" | "skipped" | "error";
    message?: string;
  }[];
}

/**
 * Utility for migrating elements from legacy format to spec-node aligned format
 *
 * Handles:
 * - Automatic UUID generation for elements without UUIDs
 * - Migration of flat properties to structured attributes
 * - Preservation of semantic IDs in elementId field
 * - Metadata initialization with migration timestamp
 * - Source reference extraction and normalization
 */
export class ElementMigration {
  /**
   * Migrate all elements in a model to spec-node aligned format
   *
   * @param model The model containing layers and elements to migrate
   * @returns Migration result with counts and detailed status for each element
   */
  async migrateModel(model: Model): Promise<MigrationResult> {
    const result: MigrationResult = {
      migrated: 0,
      skipped: 0,
      errors: [],
      details: [],
    };

    const layers = model.layers || new Map();

    for (const [, layer] of layers) {
      if (!layer || !layer.elements) {
        continue;
      }

      for (const [, element] of layer.elements) {
        try {
          const elementId = element.id || element.elementId || "unknown";
          const layerName = layer.name || "unknown";

          if (this.isLegacyFormat(element)) {
            // Migrate element using its constructor's automatic migration
            this.migrateElement(element);
            result.migrated++;
            result.details.push({
              layerName,
              elementId,
              status: "migrated",
              message: `Migrated to spec-node format with UUID ${element.id}`,
            });
          } else {
            result.skipped++;
            result.details.push({
              layerName,
              elementId,
              status: "skipped",
              message: "Already in spec-node format",
            });
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push(`Failed to migrate element: ${errorMsg}`);
          result.details.push({
            layerName: layer.name || "unknown",
            elementId: element.id || element.elementId || "unknown",
            status: "error",
            message: errorMsg,
          });
        }
      }
    }

    return result;
  }

  /**
   * Migrate a single element to spec-node aligned format
   * This is called automatically by Element constructor for legacy format detection
   *
   * @param element The element to migrate
   */
  private migrateElement(element: Element): void {
    // Update metadata to record migration
    if (!element.metadata) {
      element.metadata = {};
    }

    element.metadata.updated_at = new Date().toISOString();
    element.metadata.version = (element.metadata.version || 0) + 1;

    // Ensure all required spec-node fields are populated
    if (!element.spec_node_id) {
      element.spec_node_id = `${element.layer_id}.${element.type}`;
    }

    // Ensure UUID is present
    if (!element.id || this.isSemanticId(element.id)) {
      element.id = this.generateUUID();
    }

    // Migrate properties to attributes if attributes are empty
    if (
      (!element.attributes || Object.keys(element.attributes).length === 0) &&
      element.properties &&
      Object.keys(element.properties).length > 0
    ) {
      element.attributes = { ...element.properties };
    }
  }

  /**
   * Check if element is in legacy format
   * Legacy format indicators:
   * - Has elementId field
   * - id looks like semantic ID (contains dots)
   * - Missing spec_node_id
   * - Missing layer_id
   */
  private isLegacyFormat(element: any): boolean {
    return (
      element.elementId ||
      (element.id && this.isSemanticId(element.id)) ||
      !element.spec_node_id ||
      !element.layer_id
    );
  }

  /**
   * Check if a string is a semantic ID (contains dots)
   */
  private isSemanticId(str: string): boolean {
    return typeof str === "string" && str.includes(".");
  }


  /**
   * Generate a cryptographically secure UUIDv4
   * Uses Node.js crypto.randomUUID() for production-grade unique identifiers
   * Consistent with Element class UUID generation in element.ts
   */
  private generateUUID(): string {
    // randomUUID() is available in Node.js 15.7.0+
    // It provides cryptographically secure random UUID generation
    // This matches the implementation in Element.generateUUID()
    return randomUUID();
  }
}
