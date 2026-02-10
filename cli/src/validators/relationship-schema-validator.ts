/**
 * Relationship Schema Validation with Cardinality Enforcement
 *
 * Validates relationships against their spec relationship schemas, including:
 * - Schema compliance (source/destination node types)
 * - Cardinality constraints (one-to-one, one-to-many, many-to-one, many-to-many)
 * - Predicate validity
 * - Relationship attributes against schema
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { ValidationResult } from "./types.js";
import type { Model } from "../core/model.js";
import type { Relationship } from "../core/relationships.js";
import { RelationshipCatalog } from "../core/relationship-catalog.js";
import { fileURLToPath } from "url";
import path from "path";
import { readFile } from "../utils/file-io.js";
import { existsSync } from "fs";
import { startSpan, endSpan } from "../telemetry/index.js";

declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

export interface CardinalityConstraint {
  cardinality: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  sourceSpec: string;
  destSpec: string;
  predicate: string;
}

export interface RelationshipSchema {
  id: string;
  source_spec_node_id: string;
  source_layer: string;
  destination_spec_node_id: string;
  destination_layer: string;
  predicate: string;
  cardinality: CardinalityConstraint["cardinality"];
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
export class RelationshipSchemaValidator {
  private ajv: Ajv;
  private baseSchemaLoaded: boolean = false;
  private loadedSchemaIds: Set<string> = new Set();
  private schemasDir: string;
  private relationshipCatalog: RelationshipCatalog | null = null;
  private relationshipSchemas: Map<string, RelationshipSchema> = new Map();

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
      validateFormats: true,
    });
    addFormats(this.ajv);

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    this.schemasDir = path.join(__dirname, "..", "schemas", "bundled");
  }

  /**
   * Ensure base schemas are loaded
   */
  private async ensureBaseSchemaLoaded(): Promise<void> {
    if (this.baseSchemaLoaded) {
      return;
    }

    try {
      const baseSchemaPath = path.join(
        this.schemasDir,
        "base",
        "spec-node-relationship.schema.json"
      );
      const schemaContent = await readFile(baseSchemaPath);
      const schema = JSON.parse(schemaContent);

      if (schema.$id) {
        this.loadedSchemaIds.add(schema.$id);
        this.ajv.addSchema(schema);
      }
    } catch (error: any) {
      console.warn(
        `Warning: Failed to load base spec-node-relationship schema: ${error.message}`
      );
    }

    // Load common schemas
    const commonSchemas = [
      "common/source-references.schema.json",
      "common/attribute-spec.schema.json",
    ];

    for (const commonSchemaFile of commonSchemas) {
      try {
        const schemaPath = path.join(this.schemasDir, commonSchemaFile);
        if (!existsSync(schemaPath)) {
          continue;
        }
        const schemaContent = await readFile(schemaPath);
        const schema = JSON.parse(schemaContent);

        if (schema.$id && !this.loadedSchemaIds.has(schema.$id)) {
          this.loadedSchemaIds.add(schema.$id);
          this.ajv.addSchema(schema);
        }
      } catch (error: any) {
        console.warn(
          `Warning: Failed to load common schema ${commonSchemaFile}: ${error.message}`
        );
      }
    }

    this.baseSchemaLoaded = true;
  }

  /**
   * Initialize relationship catalog and schemas
   */
  async initialize(): Promise<void> {
    this.relationshipCatalog = new RelationshipCatalog();
    await this.relationshipCatalog.load();
    await this.loadRelationshipSchemas();
  }

  /**
   * Load relationship schemas from bundled spec
   */
  private async loadRelationshipSchemas(): Promise<void> {
    try {
      const relationshipsPath = path.join(
        this.schemasDir,
        "relationships"
      );

      if (!existsSync(relationshipsPath)) {
        console.warn(`Relationship schemas directory not found at ${relationshipsPath}`);
        return;
      }

      // Dynamically import glob
      const { glob } = await import("glob");
      const schemaFiles = await glob(
        path.join(relationshipsPath, "**", "*.relationship.schema.json")
      );

      for (const schemaFile of schemaFiles) {
        try {
          const content = await readFile(schemaFile);
          const schema = JSON.parse(content);

          if (schema.properties?.id?.const) {
            const id = schema.properties.id.const;
            this.relationshipSchemas.set(id, {
              id,
              source_spec_node_id: schema.properties.source_spec_node_id?.const || "",
              source_layer: schema.properties.source_layer?.const || "",
              destination_spec_node_id:
                schema.properties.destination_spec_node_id?.const || "",
              destination_layer: schema.properties.destination_layer?.const || "",
              predicate: schema.properties.predicate?.const || "",
              cardinality: schema.properties.cardinality?.const || "many-to-many",
              strength: schema.properties.strength?.const || "medium",
              required: schema.properties.required?.default || false,
              attributes: schema.properties.attributes,
            });
          }
        } catch (error: any) {
          console.warn(`Failed to load relationship schema from ${schemaFile}: ${error.message}`);
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
      await this.ensureBaseSchemaLoaded();
      if (!this.relationshipCatalog) {
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

    // Extract element types
    const sourceType = sourceElement.type;
    const targetType = targetElement.type;

    // Find applicable relationship schema
    const schemaKey = this.findRelationshipSchemaKey(
      relationship.layer,
      sourceType,
      relationship.layer,
      targetType,
      relationship.predicate
    );

    if (!schemaKey) {
      errors.push({
        layer: relationship.layer,
        elementId: relationship.source,
        message: `No schema found for relationship: ${relationship.layer}.${sourceType} --[${relationship.predicate}]--> ${relationship.layer}.${targetType}`,
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
   */
  private validateCardinality(
    relationship: Relationship,
    schema: RelationshipSchema,
    relationshipsBySource: Map<string, Relationship[]>,
    relationshipsByTarget: Map<string, Relationship[]>
  ): Array<{ layer: string; message: string; elementId?: string }> {
    const errors: Array<{ layer: string; message: string; elementId?: string }> = [];
    const cardinality = schema.cardinality;

    // Count existing relationships for this predicate from source and to target
    const sourceRelCount =
      relationshipsBySource
        .get(relationship.source)
        ?.filter(
          (r) =>
            r.predicate === relationship.predicate &&
            r.target !== relationship.target
        ).length || 0;

    const targetRelCount =
      relationshipsByTarget
        .get(relationship.target)
        ?.filter(
          (r) =>
            r.predicate === relationship.predicate &&
            r.source !== relationship.source
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
   */
  private findRelationshipSchemaKey(
    sourceLayer: string,
    sourceType: string,
    destLayer: string,
    destType: string,
    predicate: string
  ): string | null {
    // Search for matching schema
    for (const [schemaId, schema] of this.relationshipSchemas.entries()) {
      if (
        schema.source_layer === sourceLayer &&
        schema.destination_layer === destLayer &&
        schema.predicate === predicate
      ) {
        // Check if source/dest types match the spec node IDs
        const sourceSpecId = `${sourceLayer}.${sourceType.toLowerCase()}`;
        const destSpecId = `${destLayer}.${destType.toLowerCase()}`;

        if (
          schema.source_spec_node_id === sourceSpecId &&
          schema.destination_spec_node_id === destSpecId
        ) {
          return schemaId;
        }
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
   * Find an element in the model by ID
   */
  private findElementInModel(model: Model, elementId: string) {
    for (const layer of model.layers.values()) {
      const element = layer.elements.get(elementId);
      if (element) {
        return element;
      }
    }
    return null;
  }

}
