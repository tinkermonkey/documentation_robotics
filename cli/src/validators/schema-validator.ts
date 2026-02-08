/**
 * Schema validation using AJV
 */

import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { ValidationResult } from './types.js';
import type { Layer } from '../core/layer.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFile } from '../utils/file-io.js';
import { startSpan, endSpan } from '../telemetry/index.js';

// Fallback for runtime environments where TELEMETRY_ENABLED is not defined by esbuild
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;

/**
 * Validator for JSON Schema compliance
 *
 * This validator currently uses layer schemas for validation.
 * Future work will integrate SpecNode schema validation once SpecNode
 * definitions are fully available.
 *
 * See: https://github.com/tinkermonkey/documentation_robotics/discussions/317
 */
export class SchemaValidator {
  private ajv: Ajv;
  private compiledSchemas: Map<string, ValidateFunction> = new Map();
  private schemasLoaded: boolean = false;
  private loadedSchemaIds: Set<string> = new Set();

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
      validateFormats: true,
    });
    addFormats(this.ajv);
    // Note: schemas are loaded lazily on first validation
  }

  /**
   * Ensure schemas are precompiled before validation
   */
  private async ensureSchemasLoaded(): Promise<void> {
    if (this.schemasLoaded) {
      return;
    }

    await this.precompileSchemas();
    this.schemasLoaded = true;
  }

  /**
   * Precompile all layer schemas for efficient validation
   */
  private async precompileSchemas(): Promise<void> {
    const layerMappings = {
      motivation: '01-motivation-layer.schema.json',
      business: '02-business-layer.schema.json',
      security: '03-security-layer.schema.json',
      application: '04-application-layer.schema.json',
      technology: '05-technology-layer.schema.json',
      api: '06-api-layer.schema.json',
      'data-model': '07-data-model-layer.schema.json',
      'data-store': '08-data-store-layer.schema.json',
      ux: '09-ux-layer.schema.json',
      navigation: '10-navigation-layer.schema.json',
      apm: '11-apm-observability-layer.schema.json',
      testing: '12-testing-layer.schema.json',
    };

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const schemasDir = path.join(__dirname, '..', 'schemas', 'bundled');

    // Pre-load all common schemas that layer schemas reference
    // This avoids duplicate registration warnings when AJV auto-loads them
    // during layer schema compilation by pre-registering them with their $id
    const commonSchemas = [
      'common/source-references.schema.json',
      'common/predicates.schema.json',
      'common/relationships.schema.json',
      'common/layer-extensions.schema.json',
    ];

    const commonSchemaErrors: Array<{ file: string; error: Error }> = [];

    for (const commonSchemaFile of commonSchemas) {
      try {
        const schemaPath = path.join(schemasDir, commonSchemaFile);
        const schemaContent = await readFile(schemaPath);
        const schema = JSON.parse(schemaContent);
        // Track the $id to avoid duplicate registration
        if (schema.$id) {
          this.loadedSchemaIds.add(schema.$id);
          // Only add to AJV if not already present
          try {
            this.ajv.addSchema(schema);
          } catch (addError: any) {
            // Check if schema is already registered
            if (this.ajv.getSchema(schema.$id)) {
              // Schema already exists - this is acceptable
              continue;
            }
            // Re-throw actual errors
            throw addError;
          }
        }
      } catch (error: any) {
        // Track common schema loading errors but don't fail immediately
        // Some common schemas may be optional
        commonSchemaErrors.push({
          file: commonSchemaFile,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    // Load all layer schemas - these are REQUIRED
    const layerSchemaErrors: Array<{ layer: string; error: Error }> = [];

    for (const [layerName, schemaFileName] of Object.entries(layerMappings)) {
      try {
        // Try primary schema path first (development)
        let schemaPath = path.join(schemasDir, schemaFileName);

        let schemaContent: string;
        try {
          schemaContent = await readFile(schemaPath);
        } catch {
          // Fallback to alternative path for bundled deployments
          schemaPath = path.join(
            __dirname,
            'schemas',
            'bundled',
            schemaFileName
          );
          schemaContent = await readFile(schemaPath);
        }

        const schema = JSON.parse(schemaContent);

        // Compile the schema. This automatically registers it with AJV using its $id.
        // If it's already registered, compile() will handle it gracefully
        const validate = this.ajv.compile(schema);
        this.compiledSchemas.set(layerName, validate);

        // Track that this schema ID has been loaded
        if (schema.$id) {
          this.loadedSchemaIds.add(schema.$id);
        }
      } catch (error: any) {
        // Track layer schema loading errors
        layerSchemaErrors.push({
          layer: layerName,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    // If any required layer schemas failed to load, fail initialization
    if (layerSchemaErrors.length > 0) {
      const errorDetails = layerSchemaErrors
        .map((e) => `  - Layer "${e.layer}": ${e.error.message}`)
        .join('\n');
      throw new Error(
        `Failed to load required layer schemas:\n${errorDetails}`
      );
    }

    // Warn about common schema loading failures (these are not fatal)
    for (const { file, error } of commonSchemaErrors) {
      console.warn(
        `Warning: Failed to load common schema ${file}: ${error.message}`
      );
    }
  }

  /**
   * Validate a layer against its schema
   */
  async validateLayer(layer: Layer): Promise<ValidationResult> {
    const span = isTelemetryEnabled ? startSpan('schema.validate', {
      'schema.layer': layer.name,
    }) : null;

    try {
      const result = new ValidationResult();

      // Ensure schemas are loaded
      await this.ensureSchemasLoaded();

      const validate = this.compiledSchemas.get(layer.name);

      if (!validate) {
        // Schema not found - skip validation silently (matching Python CLI behavior)
        // Some layers may not have schemas yet, which is acceptable
        // Don't add warning - just return success
        if (isTelemetryEnabled && span) {
          span.setAttribute('schema.valid', true);
          span.setAttribute('schema.skipped', true);
        }

        return result;
      }

      const layerData = layer.toJSON();
      const valid = validate(layerData);

      if (!valid && validate.errors) {
        for (const error of validate.errors) {
          result.addError({
            layer: layer.name,
            message: `Schema validation failed: ${this.formatAjvError(error)}`,
            location: error.instancePath || '/',
            fixSuggestion: this.generateFixSuggestion(error),
          });
        }
      }

      if (isTelemetryEnabled && span) {
        span.setAttribute('schema.valid', valid);
        span.setAttribute('schema.error_count', validate.errors?.length || 0);
      }

      return result;
    } finally {
      endSpan(span);
    }
  }

  /**
   * Format AJV error message
   */
  private formatAjvError(error: ErrorObject): string {
    const keyword = error.keyword;
    const dataPath = error.instancePath || '/';

    switch (keyword) {
      case 'type':
        return `At ${dataPath}: expected ${error.params?.type}, got ${typeof error.data}`;
      case 'required':
        return `At ${dataPath}: missing required property '${error.params?.missingProperty}'`;
      case 'enum':
        return `At ${dataPath}: value must be one of [${error.params?.allowedValues?.join(', ')}]`;
      case 'pattern':
        return `At ${dataPath}: value must match pattern ${error.params?.pattern}`;
      case 'minLength':
        return `At ${dataPath}: string must be at least ${error.params?.limit} characters`;
      case 'maxLength':
        return `At ${dataPath}: string must be at most ${error.params?.limit} characters`;
      case 'minimum':
        return `At ${dataPath}: value must be >= ${error.params?.limit}`;
      case 'maximum':
        return `At ${dataPath}: value must be <= ${error.params?.limit}`;
      case 'additionalProperties':
        return `At ${dataPath}: unexpected property '${error.params?.additionalProperty}'`;
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
      case 'required':
        return `Add required field: ${error.params?.missingProperty}`;
      case 'type':
        return `Expected type ${error.params?.type}`;
      case 'enum':
        return `Use one of: ${error.params?.allowedValues?.join(', ')}`;
      case 'pattern':
        return `Value must match pattern: ${error.params?.pattern}`;
      case 'additionalProperties':
        return `Remove unexpected property: ${error.params?.additionalProperty}`;
      default:
        return undefined;
    }
  }
}
