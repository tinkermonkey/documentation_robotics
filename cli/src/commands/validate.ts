/**
 * Validate the architecture model
 */

import ansis from "ansis";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Model } from "../core/model.js";
import { Validator } from "../validators/validator.js";
import { ValidationFormatter } from "../validators/validation-formatter.js";

export interface ValidateOptions {
  layers?: string[];
  strict?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  output?: string;
  debug?: boolean;
  model?: string;
  // Python CLI compatibility options
  all?: boolean;
  markdown?: boolean;
  schemas?: boolean;
  schema?: boolean; // Alias for schemas
  relationships?: boolean;
  structure?: boolean;
  naming?: boolean;
  references?: boolean;
}

/**
 * Validate schema synchronization between spec/ and cli/src/schemas/bundled/
 * @throws {Error} if schema synchronization validation fails
 */
/**
 * Recursively find all JSON schema files in a directory
 * Excludes 'layers' subdirectory since layer instances are not schemas
 */
async function findJsonFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    // Skip 'layers' directory - layer instances are synced but are not schemas
    if (entry.isDirectory() && entry.name !== "layers") {
      const subFiles = await findJsonFiles(fullPath, baseDir);
      files.push(...subFiles);
    } else if (entry.name.endsWith(".json") && entry.isFile()) {
      // Store relative path from base directory
      files.push(path.relative(baseDir, fullPath));
    }
  }

  return files;
}

async function validateSchemaSynchronization(): Promise<void> {
  console.log("");
  console.log(ansis.bold("Validating schema synchronization..."));
  console.log("");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Resolve paths relative to project root
  const projectRoot = path.resolve(__dirname, "../../..");
  const specSchemaDir = path.join(projectRoot, "spec", "schemas");
  const bundledSchemaDir = path.join(__dirname, "../schemas/bundled");

  // Find all JSON files recursively
  const specSchemaFiles = await findJsonFiles(specSchemaDir);
  const bundledSchemaFiles = await findJsonFiles(bundledSchemaDir);

  if (specSchemaFiles.length === 0) {
    throw new Error("No schema files found in spec/schemas/");
  }

  let mismatches: string[] = [];

  for (const schemaFile of specSchemaFiles) {
    const specPath = path.join(specSchemaDir, schemaFile);
    const bundledPath = path.join(bundledSchemaDir, schemaFile);

    try {
      const specContent = await fs.readFile(specPath, "utf-8");

      try {
        const bundledContent = await fs.readFile(bundledPath, "utf-8");

        // Normalize JSON to account for formatting differences
        const specParsed = JSON.parse(specContent);
        const bundledParsed = JSON.parse(bundledContent);
        const specNormalized = JSON.stringify(specParsed, null, 2);
        const bundledNormalized = JSON.stringify(bundledParsed, null, 2);

        if (specNormalized !== bundledNormalized) {
          mismatches.push(
            `  ${ansis.red("✗")} ${schemaFile} - Content differs between spec/ and cli/src/schemas/bundled/`
          );
        } else {
          console.log(`  ${ansis.green("✓")} ${schemaFile}`);
        }
      } catch (error) {
        if ((error as any).code === "ENOENT") {
          mismatches.push(
            `  ${ansis.red("✗")} ${schemaFile} - Missing in cli/src/schemas/bundled/`
          );
        } else {
          throw error;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mismatches.push(`  ${ansis.red("✗")} ${schemaFile} - Error reading spec schema: ${message}`);
    }
  }

  // Check for extra files in bundled that aren't in spec
  for (const bundledFile of bundledSchemaFiles) {
    if (!specSchemaFiles.includes(bundledFile)) {
      mismatches.push(
        `  ${ansis.red("✗")} ${bundledFile} - Extra file in cli/src/schemas/bundled/ (not in spec/)`
      );
    }
  }

  if (mismatches.length > 0) {
    console.log("");
    console.log(
      ansis.bold(ansis.red(`✗ Schema synchronization failed with ${mismatches.length} issue(s):`))
    );
    console.log("");
    for (const mismatch of mismatches) {
      console.log(mismatch);
    }
    console.log("");
    console.log(
      ansis.dim("To fix: Ensure spec/schemas/*.json matches cli/src/schemas/bundled/*.json")
    );
    console.log("");
    throw new Error(`Schema synchronization failed with ${mismatches.length} issue(s)`);
  } else {
    console.log("");
    console.log(ansis.green("✓ All schemas synchronized"));
    console.log("");
  }
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
  try {
    // Handle schema validation flag
    if (options.schemas || options.schema) {
      await validateSchemaSynchronization();
      return;
    }

    // Load model
    const model = await Model.load(options.model);

    // Validate
    const validator = new Validator();

    const result = await validator.validateModel(model);

    // Format and display output
    if (options.output) {
      // Export to file
      let content: string;

      if (options.output.endsWith(".md") || options.output.endsWith(".markdown")) {
        content = ValidationFormatter.toMarkdown(result, model);
      } else if (options.output.endsWith(".json")) {
        content = JSON.stringify(ValidationFormatter.toJSON(result, model), null, 2);
      } else {
        // Default to JSON
        content = JSON.stringify(ValidationFormatter.toJSON(result, model), null, 2);
      }

      await fs.writeFile(options.output, content, "utf-8");
      console.log(`\nValidation report exported to ${options.output}`);

      if (!result.isValid()) {
        throw new Error("Validation failed");
      }
      return;
    }

    // Display formatted output
    const formatted = ValidationFormatter.format(result, model, {
      verbose: options.verbose,
      quiet: options.quiet,
    });

    console.log(formatted);

    // Exit with appropriate code
    if (result.isValid()) {
      if (options.strict && result.warnings.length > 0) {
        console.log(ansis.red("Strict mode enabled: treating warnings as errors"));
        throw new Error("Validation failed (strict mode)");
      }
      return;
    } else {
      throw new Error("Validation failed");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));

    // Always preserve full error details in stderr for debugging
    if (error instanceof Error && error.stack) {
      console.error(ansis.dim("\nFull error details:"));
      console.error(ansis.dim(error.stack));
    }

    // Additional context for debugging
    if (process.env.DEBUG) {
      console.error(ansis.dim("\nDebug mode enabled. Additional context:"));
      if (error instanceof Error) {
        console.error(ansis.dim(`Error name: ${error.name}`));
        console.error(ansis.dim(`Error cause: ${(error as any).cause || "none"}`));
      }
    }
    throw error;
  }
}
