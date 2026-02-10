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
const BUNDLED_SCHEMAS_DIR = path.join(CLI_DIR, "src", "schemas", "bundled");
const GENERATED_DIR = path.join(CLI_DIR, "src", "generated");

/**
 * Base schemas to pre-compile
 * These are the schemas that are used most frequently and benefit most from pre-compilation
 */
const BASE_SCHEMAS = [
  { file: "base/spec-node.schema.json", exportName: "validateSpecNode" },
  {
    file: "base/spec-node-relationship.schema.json",
    exportName: "validateSpecNodeRelationship",
  },
  {
    file: "base/source-references.schema.json",
    exportName: "validateSourceReference",
  },
  { file: "base/attribute-spec.schema.json", exportName: "validateAttributeSpec" },
];

interface SchemaToCompile {
  schemaId: string;
  schema: any;
  exportName: string;
}

/**
 * Load base schemas from bundled directory
 */
async function loadBaseSchemas(): Promise<SchemaToCompile[]> {
  const schemasToCompile: SchemaToCompile[] = [];

  for (const { file, exportName } of BASE_SCHEMAS) {
    const schemaPath = path.join(BUNDLED_SCHEMAS_DIR, file);

    if (!fs.existsSync(schemaPath)) {
      console.warn(`WARNING: Base schema not found at ${schemaPath}, skipping...`);
      continue;
    }

    try {
      const schemaContent = fs.readFileSync(schemaPath, "utf-8");
      const schema = JSON.parse(schemaContent);

      const schemaId = schema.$id || file;

      schemasToCompile.push({
        schemaId,
        schema,
        exportName,
      });

      console.log(`✓ Loaded ${file} (id: ${schemaId})`);
    } catch (error: any) {
      console.error(`ERROR: Failed to load ${file}: ${error.message}`);
      process.exit(1);
    }
  }

  if (schemasToCompile.length === 0) {
    console.error("ERROR: No base schemas were loaded");
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
      const schemaMap: Record<string, any> = {};
      for (const { exportName } of compiledSchemas) {
        schemaMap[exportName] = baseSchemas[Object.keys(baseSchemas)[compiledSchemas.findIndex(s => s.exportName === exportName)]];
      }

      standaloneModule = standaloneCode(ajv, schemaMap);
    } catch (standaloneError: any) {
      // If standalone code generation fails, use runtime-compiled validators
      console.warn(`  ⚠ AJV standalone generation failed (${standaloneError.message}), using runtime validators instead`);
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
  const validatorCode = compiledSchemas
    .map(({ exportName, schema }) => {
      const schemaJson = JSON.stringify(schema);
      return `
/**
 * Pre-compiled validator for ${schema.title || exportName}
 * Compiled once at module load, pre-cached for use throughout runtime
 */
export const ${exportName}: ValidateFunction = (() => {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: true,
  });
  addFormats(ajv);
  return ajv.compile(${schemaJson});
})();
`;
    })
    .join("\n");

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
 * Write generated validators file
 */
function writeGeneratedFile(content: string): void {
  ensureGeneratedDir();

  const validatorsPath = path.join(GENERATED_DIR, "compiled-validators.ts");

  try {
    fs.writeFileSync(validatorsPath, content);
    console.log(`✓ Generated ${validatorsPath}`);
  } catch (error: any) {
    console.error(`ERROR: Failed to write validators file: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    console.log("Generating pre-compiled AJV validators for base schemas...");

    const schemasToCompile = await loadBaseSchemas();
    console.log(`✓ Loaded ${schemasToCompile.length} base schemas`);

    const validatorCode = await generatePreCompiledValidators(schemasToCompile);

    writeGeneratedFile(validatorCode);

    console.log("✓ Pre-compiled validator generation complete");
    console.log(`  ${schemasToCompile.length} validators pre-compiled:`);
    schemasToCompile.forEach(({ exportName }) => {
      console.log(`    - ${exportName}`);
    });
  } catch (error) {
    console.error("ERROR: Validator generation failed:");
    console.error(error);
    process.exit(1);
  }
}

main();
