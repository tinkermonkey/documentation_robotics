#!/usr/bin/env -S node --loader tsx

/**
 * generate-validators.ts
 *
 * Build-time code generation that pre-compiles AJV validators for base schemas.
 * Eliminates runtime schema loading and compilation overhead by generating standalone
 * TypeScript code during the build phase.
 *
 * Generates: cli/src/generated/compiled-validators.ts
 * Usage: npm run build (automatically runs as part of build pipeline)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import Ajv, { ValidateFunction } from "ajv";
import standaloneCode from "ajv/dist/standalone";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_DIR = path.join(__dirname, "..");
const BUNDLED_DIR = path.join(CLI_DIR, "src", "schemas", "bundled");
const GENERATED_DIR = path.join(CLI_DIR, "src", "generated");

/**
 * Base schema keys (in base.json) to pre-compile, mapped to export names
 * These are the schemas that are used most frequently and benefit most from pre-compilation
 */
const BASE_SCHEMAS = [
  { key: "spec-node", exportName: "validateSpecNode" },
  { key: "spec-node-relationship", exportName: "validateSpecNodeRelationship" },
  { key: "source-references", exportName: "validateSourceReference" },
  { key: "attribute-spec", exportName: "validateAttributeSpec" },
];

interface SchemaToCompile {
  schemaId: string;
  schema: any;
  exportName: string;
}

/**
 * Load base schemas from bundled base.json compiled dist file
 */
async function loadBaseSchemas(quiet: boolean = false): Promise<SchemaToCompile[]> {
  const baseJsonPath = path.join(BUNDLED_DIR, "base.json");

  if (!fs.existsSync(baseJsonPath)) {
    console.error(`ERROR: base.json not found at ${baseJsonPath}`);
    console.error("Run 'npm run sync-schemas' (which requires 'npm run build:spec' at repo root).");
    process.exit(1);
  }

  let baseData: { specVersion: string; schemas: Record<string, any>; predicates: unknown };
  try {
    baseData = JSON.parse(fs.readFileSync(baseJsonPath, "utf-8"));
  } catch (error: any) {
    console.error(`ERROR: Failed to parse base.json: ${error.message}`);
    process.exit(1);
  }

  const schemasToCompile: SchemaToCompile[] = [];

  for (const { key, exportName } of BASE_SCHEMAS) {
    const schema = baseData.schemas[key];

    if (!schema) {
      if (!quiet) {
        console.warn(`WARNING: Base schema '${key}' not found in base.json, skipping...`);
      }
      continue;
    }

    const schemaId = schema.$id || `urn:dr:spec:base:${key}`;

    schemasToCompile.push({
      schemaId,
      schema,
      exportName,
    });

    if (!quiet) {
      console.log(`[OK] Loaded base schema '${key}' (id: ${schemaId})`);
    }
  }

  if (schemasToCompile.length === 0) {
    console.error("ERROR: No base schemas were loaded from base.json");
    process.exit(1);
  }

  return schemasToCompile;
}

/**
 * Pre-compile schemas using AJV standalone code generation
 *
 * Loads all base schemas into AJV, compiles them, and generates validators.
 * If AJV standalone fails, falls back to runtime-compiled validators that are
 * still pre-compiled at build time (compiled once, cached for the lifetime of the process).
 */
async function generatePreCompiledValidators(
  schemasToCompile: SchemaToCompile[]
): Promise<string> {
  // Create AJV instance with code generation enabled
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: true,
    code: { source: true, esm: true },
  });

  addFormats(ajv);

  try {
    // First pass: Load all base schemas into AJV for reference resolution
    // This ensures schemas can reference each other (e.g., spec-node references source-references)
    const baseSchemas: Record<string, any> = {};
    for (const { schemaId, schema } of schemasToCompile) {
      const cleanSchema = { ...schema };
      delete cleanSchema.$id;
      baseSchemas[schemaId] = cleanSchema;
      ajv.addSchema(cleanSchema, schemaId);
    }

    // Second pass: Compile each schema now that all are loaded
    const compiledSchemas: Array<{ exportName: string; validate: ValidateFunction; schema: any }> = [];

    for (const { schemaId, exportName } of schemasToCompile) {
      // Compile the schema to get a validator
      const validate = ajv.getSchema(schemaId);
      if (!validate) {
        throw new Error(`Failed to compile schema: ${schemaId}`);
      }

      compiledSchemas.push({
        exportName,
        validate,
        schema: baseSchemas[schemaId],
      });
    }

    // Try AJV standalone generation, but fall back to runtime validation if it fails
    let standaloneModule = "";
    try {
      // Create a map for AJV standalone code generation
      // Build directly from compiledSchemas to avoid O(n²) lookups
      const schemaMap: Record<string, any> = {};
      for (const { exportName, schema } of compiledSchemas) {
        schemaMap[exportName] = schema;
      }

      standaloneModule = standaloneCode(ajv, schemaMap);
    } catch (standaloneError: any) {
      // If standalone code generation fails, use runtime-compiled validators
      console.warn(`  [WARN] AJV standalone generation failed (${standaloneError.message}), using runtime validators instead`);
      standaloneModule = "";
    }

    // Wrap the code in proper TypeScript with exports
    const generatedCode = generateValidatorModule(standaloneModule, compiledSchemas, baseSchemas);
    return generatedCode;
  } catch (error: any) {
    console.error(`ERROR: Failed to generate validators: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Detect circular references in an object
 *
 * Uses WeakSet to track visited objects and detect cycles during traversal.
 * Returns true if a circular reference is detected.
 */
function hasCircularReference(obj: any): boolean {
  const visited = new WeakSet<object>();

  function traverse(current: any): boolean {
    // Primitives and null cannot be circular
    if (current === null || typeof current !== "object") {
      return false;
    }

    // Already visited this object - circular reference detected
    if (visited.has(current)) {
      return true;
    }

    visited.add(current);

    // Check arrays and objects recursively
    if (Array.isArray(current)) {
      for (const item of current) {
        if (traverse(item)) {
          return true;
        }
      }
    } else {
      for (const value of Object.values(current)) {
        if (traverse(value)) {
          return true;
        }
      }
    }

    return false;
  }

  return traverse(obj);
}

/**
 * Safely stringify a schema with circular reference detection
 *
 * Validates that the schema can be serialized before attempting JSON.stringify.
 * Throws a descriptive error if circular references are detected.
 */
function safeStringifySchema(schema: any): string {
  // Check for circular references before serialization
  if (hasCircularReference(schema)) {
    throw new Error(
      "Schema contains circular references and cannot be serialized. " +
      "This typically indicates a schema $ref that creates a cycle."
    );
  }

  // Additional check: ensure the schema is JSON-serializable
  // by doing a test serialization first
  try {
    JSON.stringify(schema);
  } catch (error: any) {
    throw new Error(
      `Schema is not JSON-serializable: ${error.message}. ` +
      "This may indicate functions, symbols, or other non-serializable values in the schema."
    );
  }

  // Safe to stringify - we've validated the schema
  return JSON.stringify(schema);
}

/**
 * Generate a TypeScript module that exports the pre-compiled validators
 */
function generateValidatorModule(
  standaloneCode: string,
  compiledSchemas: Array<{ exportName: string; validate: ValidateFunction; schema: any }>,
  baseSchemas: Record<string, any>
): string {
  // Build the module with proper TypeScript types
  const moduleHeader = `/**
 * GENERATED FILE - DO NOT EDIT
 * This file is automatically generated by scripts/generate-validators.ts
 * during the build process. Changes will be overwritten.
 *
 * Pre-compiled AJV validators for base schemas
 * Eliminates runtime schema loading overhead by baking validators into the bundle
 *
 * Source: cli/src/schemas/bundled/base/
 * Build-time generation prevents runtime file I/O and schema compilation
 */

import Ajv from "ajv";
import { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

`;

  // If we have standalone code, use it; otherwise fall back to runtime validators
  if (standaloneCode.trim().length > 0) {
    return `${moduleHeader}
${standaloneCode}

// Export validators with proper typing
${compiledSchemas.map(({ exportName }) => `export { ${exportName} };`).join("\n")}
`;
  }

  // Fallback: runtime validators compiled once at module load
  // This ensures the validators are pre-compiled at build time and only compiled once
  // We must register all base schemas first to handle inter-schema $ref resolution
  const baseSchemasList = Object.entries(baseSchemas)
    .map(([id, schema]) => {
      try {
        const schemaStr = safeStringifySchema(schema);
        return `  ajv.addSchema(${schemaStr}, "${id}");`;
      } catch (error: any) {
        throw new Error(
          `Failed to serialize base schema "${id}": ${error.message}`
        );
      }
    })
    .join("\n");

  const validatorCode = `
// Shared AJV instance for all validators to handle schema references
const sharedAjv = (() => {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: true,
  });
  addFormats(ajv);

  // Register all base schemas for reference resolution
${baseSchemasList}

  return ajv;
})();

${compiledSchemas
  .map(({ exportName, schema }) => {
    try {
      const schemaJson = safeStringifySchema(schema);
      return `/**
 * Pre-compiled validator for ${schema.title || exportName}
 * Compiled once at module load, pre-cached for use throughout runtime
 */
export const ${exportName}: ValidateFunction = sharedAjv.compile(${schemaJson});`;
    } catch (error: any) {
      throw new Error(
        `Failed to serialize schema for validator ${exportName}: ${error.message}`
      );
    }
  })
  .join("\n")}
`;

  return `${moduleHeader}${validatorCode}`;
}

/**
 * Ensure generated directory exists
 */
function ensureGeneratedDir(): void {
  if (!fs.existsSync(GENERATED_DIR)) {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
  }
}

/**
 * Write generated validators file with atomic semantics
 *
 * Uses temp file + rename pattern to ensure safe writes:
 * 1. Write to temporary file in the target directory
 * 2. Atomically rename temp file to target (all-or-nothing on most filesystems)
 * 3. On failure, temp file is left behind for debugging; target file unchanged
 *
 * This prevents corruption if the write process fails partway through.
 */
function writeGeneratedFile(content: string, quiet: boolean = false): void {
  ensureGeneratedDir();

  const validatorsPath = path.join(GENERATED_DIR, "compiled-validators.ts");
  const tempPath = path.join(GENERATED_DIR, `.compiled-validators.tmp.${Date.now()}`);

  try {
    // Step 1: Write to temporary file
    fs.writeFileSync(tempPath, content, { encoding: "utf-8", flag: "w" });

    // Step 2: Atomically rename temp file to target
    // On POSIX systems, fs.renameSync is atomic at the filesystem level.
    // On Windows, this is atomic as long as source and target are on same drive.
    try {
      fs.renameSync(tempPath, validatorsPath);
    } catch (renameError: any) {
      // If rename fails, clean up temp file and re-throw
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw renameError;
    }

    if (!quiet) {
      console.log(`[OK] Generated ${validatorsPath}`);
    }
  } catch (error: any) {
    console.error(`ERROR: Failed to write validators file: ${error.message}`);
    console.error(`  Temp file may exist at: ${tempPath}`);
    console.error(`  Target file: ${validatorsPath}`);
    process.exit(1);
  }
}

/**
 * Main entry point
 *
 * Supports optional --quiet flag for CI environments:
 *   npm run build         # Development: all output
 *   npm run build --quiet # CI: errors only, no progress output
 */
async function main(): Promise<void> {
  try {
    const quiet = process.argv.includes("--quiet");

    if (!quiet) {
      console.log("Generating pre-compiled AJV validators for base schemas...");
    }

    const schemasToCompile = await loadBaseSchemas(quiet);
    if (!quiet) {
      console.log(`[OK] Loaded ${schemasToCompile.length} base schemas`);
    }

    const validatorCode = await generatePreCompiledValidators(schemasToCompile);

    writeGeneratedFile(validatorCode, quiet);

    if (!quiet) {
      console.log("[OK] Pre-compiled validator generation complete");
      console.log(`  ${schemasToCompile.length} validators pre-compiled:`);
      schemasToCompile.forEach(({ exportName }) => {
        console.log(`    - ${exportName}`);
      });
    }
  } catch (error) {
    console.error("ERROR: Validator generation failed:");
    console.error(error);
    process.exit(1);
  }
}

main();
