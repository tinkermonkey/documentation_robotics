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
   * Ensure base schemas are loaded before validation
   */
  private async ensureBaseSchemaLoaded(): Promise<void> {
    if (this.baseSchemaLoaded) {
      return;
    }

    // Load base spec-node schema
    try {
      const baseSchemaPath = path.join(this.schemasDir, "base", "spec-node.schema.json");
      const schemaContent = await readFile(baseSchemaPath);
      const schema = JSON.parse(schemaContent);

      if (schema.$id) {
        this.loadedSchemaIds.add(schema.$id);
        this.ajv.addSchema(schema);
      }
    } catch (error: any) {
      console.warn(`Warning: Failed to load base spec-node schema: ${error.message}`);
      // Non-fatal - individual schemas may still work with embedded definitions
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
        console.warn(`Warning: Failed to load common schema ${commonSchemaFile}: ${error.message}`);
      }
    }

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

    // Load the spec node schema for this element type
    const validate = await this.loadSpecNodeSchema(layerName, element.type);

    if (!validate) {
      // No schema found - skip validation
      // This is acceptable for custom types or types without schemas yet
      return result;
    }

    result.validated = true;

    // Validate element directly using spec node format
    // Element.toSpecNode() returns an object that matches spec-node.schema.json structure
    const valid = validate(element.toSpecNode());

    if (!valid && validate.errors) {
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
