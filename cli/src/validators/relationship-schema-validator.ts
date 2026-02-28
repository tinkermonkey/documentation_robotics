/**
 * Relationship Schema Validation with Cardinality Enforcement
 *
 * Validates relationships against their spec relationship schemas, including:
 * - Schema compliance (source/destination node types)
 * - Cardinality constraints (one-to-one, one-to-many, many-to-one, many-to-many)
 * - Predicate validity
 * - Relationship attributes against schema
 */

import { ValidationResult } from "./types.js";
import type { Model } from "../core/model.js";
import type { Relationship } from "../core/relationships.js";
import { fileURLToPath } from "url";
import path from "path";
import { readFile } from "../utils/file-io.js";
import { existsSync } from "fs";
import { startSpan, endSpan } from "../telemetry/index.js";

interface ManifestDistFile {
  layers: Array<{ id: string }>;
}

interface LayerDistFile {
  relationshipSchemas: Record<string, {
    id: string;
    source_spec_node_id: string;
    source_layer: string;
    destination_spec_node_id: string;
    destination_layer: string;
    predicate: string;
    cardinality: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
    strength: string;
    required?: boolean;
    attributes?: Record<string, unknown>;
  }>;
}

declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

export interface RelationshipSchema {
  id: string;
  source_spec_node_id: string;
  source_layer: string;
  destination_spec_node_id: string;
  destination_layer: string;
  predicate: string;
  cardinality: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  strength: string;
  required?: boolean;
  attributes?: Record<string, unknown>;
}

/**
 * Validator for relationship schema compliance and cardinality constraints
 *
 * Validates that relationships:
 * 1. Conform to their spec relationship schemas
 * 2. Respect cardinality constraints (e.g., one-to-one means max 1 relationship of that type)
 * 3. Reference valid predicates
 * 4. Have valid source/destination element types
 */
export class RelationshipValidator {
  private schemasDir: string;
  private relationshipSchemas: Map<string, RelationshipSchema> = new Map();

  constructor() {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    this.schemasDir = path.join(__dirname, "..", "schemas", "bundled");
  }

  /**
   * Initialize and load relationship schemas
   */
  async initialize(): Promise<void> {
    await this.loadRelationshipSchemas();
  }

  /**
   * Load relationship schemas from compiled bundled spec (manifest.json + per-layer JSON files)
   */
  private async loadRelationshipSchemas(): Promise<void> {
    try {
      const manifestPath = path.join(this.schemasDir, "manifest.json");

      if (!existsSync(manifestPath)) {
        console.warn(`Bundled manifest not found at ${manifestPath}`);
        return;
      }

      const manifestContent = await readFile(manifestPath);
      const manifest = JSON.parse(manifestContent) as ManifestDistFile;

      for (const { id: layerId } of manifest.layers) {
        const layerPath = path.join(this.schemasDir, `${layerId}.json`);
        if (!existsSync(layerPath)) {
          continue;
        }

        try {
          const layerContent = await readFile(layerPath);
          const layerData = JSON.parse(layerContent) as LayerDistFile;

          for (const [relId, relSchema] of Object.entries(layerData.relationshipSchemas || {})) {
            this.relationshipSchemas.set(relId, {
              id: relSchema.id || relId,
              source_spec_node_id: relSchema.source_spec_node_id || "",
              source_layer: relSchema.source_layer || "",
              destination_spec_node_id: relSchema.destination_spec_node_id || "",
              destination_layer: relSchema.destination_layer || "",
              predicate: relSchema.predicate || "",
              cardinality: relSchema.cardinality || "many-to-many",
              strength: relSchema.strength || "medium",
              required: relSchema.required || false,
              attributes: relSchema.attributes,
            });
          }
        } catch (error: any) {
          console.warn(`Failed to load relationship schemas for layer '${layerId}': ${error.message}`);
        }
      }
    } catch (error: any) {
      console.warn(`Failed to load relationship schemas: ${error.message}`);
    }
  }

  /**
   * Validate relationships in a model with cardinality enforcement
   */
  async validateModel(model: Model): Promise<ValidationResult> {
    const span = isTelemetryEnabled
      ? startSpan("relationship-schema.validate-model", {
          "relationship.layer_count": model.layers.size,
        })
      : null;

    try {
      // Ensure schemas are loaded
      if (this.relationshipSchemas.size === 0) {
        await this.initialize();
      }

      const result = new ValidationResult();
      const allRelationships = model.relationships.getAll();

      if (allRelationships.length === 0) {
        return result;
      }

      // Group relationships for cardinality validation
      const relationshipsBySource = this.groupRelationshipsBySourceTarget(
        allRelationships,
        "source"
      );
      const relationshipsByTarget = this.groupRelationshipsBySourceTarget(
        allRelationships,
        "target"
      );

      // Validate each relationship
      for (const relationship of allRelationships) {
        const relErrors = await this.validateRelationship(
          relationship,
          model,
          relationshipsBySource,
          relationshipsByTarget
        );

        if (relErrors.length > 0) {
          for (const error of relErrors) {
            result.addError(error);
          }
        }
      }

      if (isTelemetryEnabled && span) {
        span.setAttribute("relationship.error_count", result.errors.length);
        span.setAttribute("relationship.warning_count", result.warnings.length);
        span.setAttribute("relationship.validated_count", allRelationships.length);
      }

      return result;
    } finally {
      endSpan(span);
    }
  }

  /**
   * Validate a single relationship
   */
  private async validateRelationship(
    relationship: Relationship,
    model: Model,
    relationshipsBySource: Map<string, Relationship[]>,
    relationshipsByTarget: Map<string, Relationship[]>
  ): Promise<Array<{ layer: string; message: string; elementId?: string }>> {
    const errors: Array<{ layer: string; message: string; elementId?: string }> = [];

    // Find source and destination elements
    const sourceElement = this.findElementInModel(model, relationship.source);
    const targetElement = this.findElementInModel(model, relationship.target);

    if (!sourceElement) {
      errors.push({
        layer: relationship.layer,
        elementId: relationship.source,
        message: `Relationship source element '${relationship.source}' not found`,
      });
      return errors;
    }

    if (!targetElement) {
      errors.push({
        layer: relationship.layer,
        elementId: relationship.target,
        message: `Relationship target element '${relationship.target}' not found`,
      });
      return errors;
    }

    // Extract element types AND layers (CRITICAL FIX for cross-layer relationships)
    // The source and target elements may be in different layers
    const sourceType = sourceElement.type;
    const targetType = targetElement.type;
    const sourceLayer = sourceElement.layer_id || sourceElement.layer || relationship.layer;
    const targetLayer = targetElement.layer_id || targetElement.layer || relationship.layer;

    // Find applicable relationship schema using actual source/target layers
    // (not relationship.layer for both, which assumes intra-layer relationships)
    const schemaKey = this.findRelationshipSchemaKey(
      sourceLayer,
      sourceType,
      targetLayer,
      targetType,
      relationship.predicate
    );

    if (!schemaKey) {
      errors.push({
        layer: relationship.layer,
        elementId: relationship.source,
        message: `No schema found for relationship: ${sourceLayer}.${sourceType} --[${relationship.predicate}]--> ${targetLayer}.${targetType}`,
      });
      return errors;
    }

    const schema = this.relationshipSchemas.get(schemaKey);
    if (!schema) {
      errors.push({
        layer: relationship.layer,
        elementId: relationship.source,
        message: `Failed to load schema for relationship: ${schemaKey}`,
      });
      return errors;
    }

    // Validate cardinality constraints
    const cardinalityErrors = this.validateCardinality(
      relationship,
      schema,
      relationshipsBySource,
      relationshipsByTarget
    );

    errors.push(...cardinalityErrors);

    // Validate relationship attributes if schema specifies them
    if (relationship.properties && schema.attributes) {
      const attrErrors = this.validateRelationshipAttributes(
        relationship,
        schema
      );
      errors.push(...attrErrors);
    }

    return errors;
  }

  /**
   * Validate cardinality constraints for a relationship
   *
   * Cardinality constraint semantics:
   * - "one-to-one": Each source can have at most 1 such relationship, and each target can be involved in at most 1
   * - "one-to-many": Source can have at most 1 such relationship, but target can have many
   * - "many-to-one": Source can have many such relationships, but each target can have at most 1
   * - "many-to-many": No cardinality constraints
   */
  private validateCardinality(
    relationship: Relationship,
    schema: RelationshipSchema,
    relationshipsBySource: Map<string, Relationship[]>,
    relationshipsByTarget: Map<string, Relationship[]>
  ): Array<{ layer: string; message: string; elementId?: string }> {
    const errors: Array<{ layer: string; message: string; elementId?: string }> = [];
    const cardinality = schema.cardinality;

    // Count OTHER relationships for this predicate from source and to target
    // (excluding the current relationship to get accurate violation detection)
    const sourceRelCount =
      relationshipsBySource
        .get(relationship.source)
        ?.filter(
          (r) =>
            r.predicate === relationship.predicate &&
            r.target !== relationship.target  // Exclude current relationship
        ).length || 0;

    const targetRelCount =
      relationshipsByTarget
        .get(relationship.target)
        ?.filter(
          (r) =>
            r.predicate === relationship.predicate &&
            r.source !== relationship.source  // Exclude current relationship
        ).length || 0;

    // Validate based on cardinality type
    switch (cardinality) {
      case "one-to-one":
        // Source can have at most 1 such relationship
        if (sourceRelCount > 0) {
          errors.push({
            layer: relationship.layer,
            elementId: relationship.source,
            message: `Cardinality violation: '${relationship.predicate}' has cardinality 'one-to-one', but source '${relationship.source}' already has this relationship`,
          });
        }
        // Target can be involved in at most 1 such relationship
        if (targetRelCount > 0) {
          errors.push({
            layer: relationship.layer,
            elementId: relationship.target,
            message: `Cardinality violation: '${relationship.predicate}' has cardinality 'one-to-one', but target '${relationship.target}' is already involved in this relationship`,
          });
        }
        break;

      case "one-to-many":
        // Source can have at most 1 such relationship
        if (sourceRelCount > 0) {
          errors.push({
            layer: relationship.layer,
            elementId: relationship.source,
            message: `Cardinality violation: '${relationship.predicate}' has cardinality 'one-to-many', but source '${relationship.source}' already has this relationship`,
          });
        }
        // Target can be involved in many such relationships (no limit)
        break;

      case "many-to-one":
        // Source can have many such relationships (no limit)
        // Target can have at most 1 such relationship
        if (targetRelCount > 0) {
          errors.push({
            layer: relationship.layer,
            elementId: relationship.target,
            message: `Cardinality violation: '${relationship.predicate}' has cardinality 'many-to-one', but target '${relationship.target}' is already involved in this relationship`,
          });
        }
        break;

      case "many-to-many":
        // No cardinality constraints
        break;
    }

    return errors;
  }

  /**
   * Validate relationship attributes against schema
   */
  private validateRelationshipAttributes(
    relationship: Relationship,
    schema: RelationshipSchema
  ): Array<{ layer: string; message: string; elementId?: string }> {
    const errors: Array<{ layer: string; message: string; elementId?: string }> = [];

    if (!schema.attributes || !relationship.properties) {
      return errors;
    }

    // Simple validation: check that properties match schema keys
    for (const key of Object.keys(relationship.properties)) {
      if (!(key in schema.attributes)) {
        errors.push({
          layer: relationship.layer,
          elementId: relationship.source,
          message: `Relationship property '${key}' not defined in schema for predicate '${relationship.predicate}'`,
        });
      }
    }

    return errors;
  }

  /**
   * Find relationship schema ID by source/dest specs and predicate
   *
   * Matches relationship schemas by:
   * 1. Predicate (must match exactly)
   * 2. Layer pair (source and destination layers must match)
   * 3. Element type pair (source and destination types must match spec node IDs)
   *
   * Supports both intra-layer (motivation -> motivation) and cross-layer
   * (motivation -> business) relationships.
   */
  private findRelationshipSchemaKey(
    sourceLayer: string,
    sourceType: string,
    destLayer: string,
    destType: string,
    predicate: string
  ): string | null {
    // Normalize type to lowercase for comparison (spec_node_ids use lowercase types)
    const normalizedSourceType = sourceType.toLowerCase();
    const normalizedDestType = destType.toLowerCase();

    // Search for matching schema
    for (const [schemaId, schema] of this.relationshipSchemas.entries()) {
      // First filter: predicate must match exactly
      if (schema.predicate !== predicate) {
        continue;
      }

      // Second filter: layer pair must match
      // (supports both intra-layer and cross-layer relationships)
      if (
        schema.source_layer !== sourceLayer ||
        schema.destination_layer !== destLayer
      ) {
        continue;
      }

      // Third filter: element type pair must match spec node IDs
      // Construct spec node IDs and compare against schema constraints
      const sourceSpecId = `${sourceLayer}.${normalizedSourceType}`;
      const destSpecId = `${destLayer}.${normalizedDestType}`;

      if (
        schema.source_spec_node_id === sourceSpecId &&
        schema.destination_spec_node_id === destSpecId
      ) {
        return schemaId;
      }
    }

    return null;
  }

  /**
   * Group relationships by source or target element
   */
  private groupRelationshipsBySourceTarget(
    relationships: Relationship[],
    by: "source" | "target"
  ): Map<string, Relationship[]> {
    const grouped = new Map<string, Relationship[]>();

    for (const rel of relationships) {
      const key = by === "source" ? rel.source : rel.target;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(rel);
    }

    return grouped;
  }

  /**
   * Find an element in the model by ID (supports both UUID and semantic ID)
   */
  private findElementInModel(model: Model, elementId: string) {
    for (const layer of model.layers.values()) {
      // First try direct lookup (UUID)
      const element = layer.elements.get(elementId);
      if (element) {
        return element;
      }

      // If not found, search by semantic ID (elementId field)
      for (const elem of layer.elements.values()) {
        if (elem.elementId === elementId) {
          return elem;
        }
      }
    }
    return null;
  }

}
