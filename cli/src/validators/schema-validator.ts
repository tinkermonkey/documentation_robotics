/**
 * Schema validation using AJV
 *
 * Validates model elements against their corresponding spec node schemas.
 * Each element type has a dedicated schema in spec/schemas/nodes/{layer}/{type}.node.schema.json
 */

import Ajv, { ValidateFunction, ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { ValidationResult } from "./types.js";
import type { Layer } from "../core/layer.js";
import type { Element } from "../core/element.js";
import { fileURLToPath } from "url";
import path from "path";
import { readFile } from "../utils/file-io.js";
import { startSpan, endSpan } from "../telemetry/index.js";
import { existsSync } from "fs";
import {
  validateSpecNode,
  validateSpecNodeRelationship,
  validateSourceReference,
  validateAttributeSpec,
} from "../generated/compiled-validators.js";

// Fallback for runtime environments where TELEMETRY_ENABLED is not defined by esbuild
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

/**
 * Validator for JSON Schema compliance
 *
 * Validates model elements against spec node schemas. Each element is validated
 * against its type-specific schema (e.g., motivation.goal elements validate against
 * spec/schemas/nodes/motivation/goal.node.schema.json).
 */
export class SchemaValidator {
  private ajv: Ajv;
  private compiledSchemas: Map<string, ValidateFunction> = new Map(); // Key: layer.type
  private baseSchemaLoaded: boolean = false;
  private loadedSchemaIds: Set<string> = new Set();
  private schemasDir: string;

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
      validateFormats: true,
    });
    addFormats(this.ajv);

    // Determine schemas directory (spec node schemas bundled with CLI)
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    this.schemasDir = path.join(__dirname, "..", "schemas", "bundled");
  }

  /**
   * Ensure base schemas are pre-compiled validators are initialized
   * Loads base schema files from disk and registers them with AJV for reference resolution.
   * This allows per-type schemas to resolve $ref to base schemas during compilation.
   */
  private async ensureBaseSchemaLoaded(): Promise<void> {
    if (this.baseSchemaLoaded) {
      return;
    }

    // Register pre-compiled validators with AJV
    this.compiledSchemas.set("spec-node", validateSpecNode);
    this.compiledSchemas.set("spec-node-relationship", validateSpecNodeRelationship);
    this.compiledSchemas.set("source-references", validateSourceReference);
    this.compiledSchemas.set("attribute-spec", validateAttributeSpec);

    // Load and register base schema objects with AJV for $ref resolution
    // This is required for type-specific schemas to resolve references to base schemas
    const baseSchemaNames = [
      "spec-node.schema.json",
      "spec-node-relationship.schema.json",
      "source-references.schema.json",
      "attribute-spec.schema.json",
      "model-node-relationship.schema.json",
      "predicate-catalog.schema.json",
    ];

    for (const schemaName of baseSchemaNames) {
      const schemaPath = path.join(this.schemasDir, "base", schemaName);
      try {
        const schemaContent = await readFile(schemaPath);
        const schema = JSON.parse(schemaContent);
        // Register schema with AJV using the file name as ID
        // This allows $ref to "filename.schema.json#/definitions/..." to be resolved
        this.ajv.addSchema(schema, schemaName);
      } catch (error: any) {
        console.warn(`Warning: Failed to load base schema ${schemaName}: ${error.message}`);
      }
    }

    // Mark base schemas as loaded
    this.baseSchemaLoaded = true;
  }

  /**
   * Load and compile a spec node schema for a specific element type
   */
  private async loadSpecNodeSchema(layer: string, type: string): Promise<ValidateFunction | null> {
    const cacheKey = `${layer}.${type}`;

    // Check cache first
    if (this.compiledSchemas.has(cacheKey)) {
      return this.compiledSchemas.get(cacheKey)!;
    }

    // Ensure base schemas are loaded
    await this.ensureBaseSchemaLoaded();

    try {
      // Try primary path: spec/schemas/nodes/{layer}/{type}.node.schema.json (from bundled schemas)
      const schemaPath = path.join(this.schemasDir, "nodes", layer, `${type}.node.schema.json`);

      if (!existsSync(schemaPath)) {
        // Schema file doesn't exist - this is acceptable for newer/custom types
        return null;
      }

      const schemaContent = await readFile(schemaPath);
      const schema = JSON.parse(schemaContent);

      // Compile and cache the schema
      const validate = this.ajv.compile(schema);
      this.compiledSchemas.set(cacheKey, validate);

      if (schema.$id) {
        this.loadedSchemaIds.add(schema.$id);
      }

      return validate;
    } catch (error: any) {
      console.warn(`Warning: Failed to load spec node schema for ${layer}.${type}: ${error.message}`);
      return null;
    }
  }

  /**
   * Validate a layer against its spec node schemas
   *
   * This validates each element in the layer against its corresponding spec node schema.
   */
  async validateLayer(layer: Layer): Promise<ValidationResult> {
    const span = isTelemetryEnabled
      ? startSpan("schema.validate", {
          "schema.layer": layer.name,
        })
      : null;

    try {
      const result = new ValidationResult();
      let validatedCount = 0;
      let skippedCount = 0;

      // Validate each element individually
      for (const element of layer.elements.values()) {
        const elementResult = await this.validateElement(element, layer.name);

        if (elementResult.hasErrors) {
          // Add element-specific errors to layer result
          for (const error of elementResult.errors) {
            result.addError({
              layer: layer.name,
              elementId: element.id,
              message: error.message,
              location: error.location,
              fixSuggestion: error.fixSuggestion,
            });
          }
        }

        if (elementResult.validated) {
          validatedCount++;
        } else {
          skippedCount++;
        }
      }

      if (isTelemetryEnabled && span) {
        span.setAttribute("schema.valid", result.isValid());
        span.setAttribute("schema.error_count", result.errors.length);
        span.setAttribute("schema.validated_count", validatedCount);
        span.setAttribute("schema.skipped_count", skippedCount);
      }

      return result;
    } finally {
      endSpan(span);
    }
  }

  /**
   * Validate a single element against its spec node schema
   */
  private async validateElement(element: Element, layerName: string): Promise<{
    validated: boolean;
    hasErrors: boolean;
    errors: Array<{ message: string; location: string; fixSuggestion?: string }>;
  }> {
    const result = {
      validated: false,
      hasErrors: false,
      errors: [] as Array<{ message: string; location: string; fixSuggestion?: string }>,
    };

    const specNode = element.toSpecNode();

    // First: Validate against base spec-node schema using pre-compiled validator
    // This ensures all elements conform to the base structure before type-specific validation
    await this.ensureBaseSchemaLoaded();
    const baseValid = validateSpecNode(specNode);

    if (!baseValid && validateSpecNode.errors) {
      result.hasErrors = true;
      result.validated = true;
      for (const error of validateSpecNode.errors) {
        result.errors.push({
          message: `Element '${element.id}': ${this.formatAjvError(error)}`,
          location: error.instancePath || "/",
          fixSuggestion: this.generateFixSuggestion(error),
        });
      }
      return result; // Fail fast on base schema violation
    }

    // Second: Load and validate against type-specific schema (lazy-loaded)
    const validate = await this.loadSpecNodeSchema(layerName, element.type);

    if (!validate) {
      // No type-specific schema found - base schema validation passed
      // This is acceptable for custom types or types without schemas yet
      result.validated = true;
      return result;
    }

    result.validated = true;

    // Validate element against type-specific schema
    const typeValid = validate(specNode);

    if (!typeValid && validate.errors) {
      result.hasErrors = true;
      for (const error of validate.errors) {
        result.errors.push({
          message: `Element '${element.id}': ${this.formatAjvError(error)}`,
          location: error.instancePath || "/",
          fixSuggestion: this.generateFixSuggestion(error),
        });
      }
    }

    return result;
  }

  /**
   * Format AJV error message
   */
  private formatAjvError(error: ErrorObject): string {
    const keyword = error.keyword;
    const dataPath = error.instancePath || "/";

    switch (keyword) {
      case "type":
        return `At ${dataPath}: expected ${error.params?.type}, got ${typeof error.data}`;
      case "required":
        return `At ${dataPath}: missing required property '${error.params?.missingProperty}'`;
      case "enum":
        return `At ${dataPath}: value must be one of [${error.params?.allowedValues?.join(", ")}]`;
      case "pattern":
        return `At ${dataPath}: value must match pattern ${error.params?.pattern}`;
      case "minLength":
        return `At ${dataPath}: string must be at least ${error.params?.limit} characters`;
      case "maxLength":
        return `At ${dataPath}: string must be at most ${error.params?.limit} characters`;
      case "minimum":
        return `At ${dataPath}: value must be >= ${error.params?.limit}`;
      case "maximum":
        return `At ${dataPath}: value must be <= ${error.params?.limit}`;
      case "additionalProperties":
        return `At ${dataPath}: unexpected property '${error.params?.additionalProperty}'`;
      case "const":
        return `At ${dataPath}: value must be ${JSON.stringify(error.params?.allowedValue)}`;
      default:
        return error.message || `Validation failed`;
    }
  }

  /**
   * Generate a fix suggestion based on the error
   */
  private generateFixSuggestion(error: ErrorObject): string | undefined {
    const keyword = error.keyword;

    switch (keyword) {
      case "required":
        return `Add required field: ${error.params?.missingProperty}`;
      case "type":
        return `Expected type ${error.params?.type}`;
      case "enum":
        return `Use one of: ${error.params?.allowedValues?.join(", ")}`;
      case "pattern":
        return `Value must match pattern: ${error.params?.pattern}`;
      case "additionalProperties":
        return `Remove unexpected property: ${error.params?.additionalProperty}`;
      case "const":
        return `Value must be exactly: ${JSON.stringify(error.params?.allowedValue)}`;
      default:
        return undefined;
    }
  }
}
