/**
 * Documentation Generation Commands
 *
 * Implements schema-driven documentation generation:
 * - `dr docs generate` - Generate markdown documentation from spec instances
 * - `dr docs validate` - Validate that documentation is in sync with schemas
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { fileExists, ensureDir } from "../utils/file-io.js";
import { existsSync } from "fs";

interface GenerateOptions {
  output?: string;
  layer?: string;
}

interface ValidateOptions {
  strict?: boolean;
}

/**
 * Generate documentation from schema definitions
 */
export async function docsGenerateCommand(options: GenerateOptions): Promise<void> {
  const projectRoot = process.cwd();
  const specDir = path.join(projectRoot, "spec");

  // Validate spec directory exists
  if (!existsSync(specDir)) {
    throw new Error(
      `Specification directory not found at ${specDir}. Are you in a Documentation Robotics project?`
    );
  }

  // Determine output directory
  const outputDir = options.output ? path.resolve(options.output) : specDir;

  // Ensure output directory exists
  await ensureDir(outputDir);

  try {
    // Run the generation script
    let command = `bun run scripts/generate-layer-docs.ts`;

    if (options.layer) {
      command += ` --layer ${options.layer}`;
    }

    if (outputDir !== specDir) {
      command += ` --output ${outputDir}`;
    }

    console.log(`📚 Generating documentation...`);
    execSync(command, { cwd: projectRoot, stdio: "inherit" });
    console.log(`\n✅ Documentation generation complete at: ${outputDir}`);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Documentation generation failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate that documentation is in sync with schemas
 */
export async function docsValidateCommand(options: ValidateOptions): Promise<void> {
  const projectRoot = process.cwd();
  const specDir = path.join(projectRoot, "spec");
  const layersDir = path.join(specDir, "layers");

  // Validate spec directory exists
  if (!existsSync(specDir)) {
    throw new Error(
      `Specification directory not found at ${specDir}. Are you in a Documentation Robotics project?`
    );
  }

  console.log(`🔍 Validating documentation sync with schemas...`);

  // Create temporary directory for generated docs
  const tempDir = path.join(projectRoot, ".tmp-doc-validation");
  await ensureDir(tempDir);

  try {
    // Generate documentation to temp directory
    const command = `bun run scripts/generate-layer-docs.ts --output ${tempDir}`;

    try {
      execSync(command, { cwd: projectRoot, stdio: "pipe" });
    } catch (error) {
      const stderr = (error as any).stderr?.toString() || (error as Error).message || String(error);
      throw new Error(`Failed to generate documentation for validation: ${stderr}`);
    }

    // Compare generated docs with existing docs
    const generatedFiles = fs.readdirSync(tempDir).filter((f) => f.endsWith(".md"));

    let hasDiscrepancies = false;
    const discrepancies: string[] = [];

    // Check for missing files
    for (const file of generatedFiles) {
      if (file === "INDEX.md") continue; // Skip index file in validation

      const existingPath = path.join(layersDir, file);
      const generatedPath = path.join(tempDir, file);

      if (!(await fileExists(existingPath))) {
        discrepancies.push(`❌ Missing file: ${file}`);
        hasDiscrepancies = true;
        continue;
      }

      // Compare content
      const existingContent = fs.readFileSync(existingPath, "utf-8");
      const generatedContent = fs.readFileSync(generatedPath, "utf-8");

      if (existingContent !== generatedContent) {
        discrepancies.push(
          `❌ File out of sync: ${file} (generated content differs from existing)`
        );
        hasDiscrepancies = true;
      }
    }

    // Report results
    if (hasDiscrepancies) {
      console.log(`\n❌ Documentation is out of sync with schemas:\n`);
      discrepancies.forEach((d) => console.log(`  ${d}`));
      console.log(`\nRun 'dr docs generate' to update documentation.`);

      if (options.strict) {
        process.exit(1);
      }
    } else {
      console.log(`\n✅ Documentation is in sync with schemas!`);
    }
  } finally {
    // Clean up temporary directory
    if (existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  }
}

/**
 * Register docs commands with Commander
 */
export function docsCommands(program: any): void {
  const docsCommand = program
    .command("docs")
    .description("Manage documentation generation and validation");

  docsCommand
    .command("generate")
    .description("Generate markdown documentation from schema definitions")
    .option("--layer <layer>", "Generate specific layer (optional)")
    .option("--output <dir>", "Output directory (defaults to spec/layers/)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr docs generate                       # Generate all layer docs
  $ dr docs generate --layer motivation    # Generate motivation layer only
  $ dr docs generate --output ./docs/      # Output to custom directory

Note: Requires spec/layers/*.layer.json and spec/nodes/**/*.node.json files.
The generation script reads these spec instances and creates markdown documentation.`
    )
    .action(docsGenerateCommand);

  docsCommand
    .command("validate")
    .description("Validate that documentation is in sync with schema definitions")
    .option("--strict", "Exit with error code if documentation is out of sync")
    .addHelpText(
      "after",
      `
Examples:
  $ dr docs validate           # Check if docs are in sync
  $ dr docs validate --strict  # Exit with error if out of sync (for CI)

This command generates documentation from schemas and compares it with existing
documentation to ensure they are in sync.`
    )
    .action(docsValidateCommand);
}
