/**
 * Import architecture model from various formats
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { ImportManager } from "../import/index.js";
import { readFile } from "../utils/file-io.js";
import * as path from "path";
import { startSpan, endSpan } from "../telemetry/index.js";
import { getErrorMessage } from "../utils/errors.js";

declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

export interface ImportOptions {
  format: string;
  input: string;
  model?: string;
  mergeStrategy?: "add" | "update" | "skip";
}

export async function importCommand(options: ImportOptions): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("import.execute", {
        "import.format": options.format,
        "import.merge_strategy": options.mergeStrategy || "add",
      })
    : null;

  try {
    // Validate required options
    if (!options.input) {
      console.error(ansis.red("Error: --input path is required"));
      process.exit(1);
    }

    if (!options.format) {
      console.error(ansis.red("Error: --format is required (archimate, openapi)"));
      process.exit(1);
    }

    // Validate format BEFORE attempting any I/O operations
    const supportedFormats = ["archimate", "openapi"];
    const normalizedFormat = options.format.toLowerCase();
    if (!supportedFormats.includes(normalizedFormat)) {
      console.error(ansis.red(`Error: Unsupported import format "${options.format}"`));
      console.error(`  Supported formats: ${supportedFormats.join(", ")}`);
      process.exit(1);
    }

    // Check if input file exists
    const inputPath = path.resolve(options.input);
    let fileContent: string;
    try {
      fileContent = await readFile(inputPath);
    } catch (error) {
      console.error(ansis.red(`Error: Could not read input file: ${inputPath}`));
      if (isTelemetryEnabled && span) {
        (span as any).recordException(error as Error);
        (span as any).setStatus({ code: 2, message: `File read error: ${String(error)}` });
      }
      process.exit(1);
    }

    // Load model
    const model = await Model.load(options.model);

    // Initialize ImportManager
    const manager = new ImportManager();

    // Perform import
    console.log(`Importing from ${ansis.blue(options.format)} format...`);

    const result = await manager.import(normalizedFormat, fileContent, model, {
      mergeStrategy: options.mergeStrategy || "add",
      validateSchema: true,
    });

    if (!result.success) {
      console.error(ansis.red(`\nImport failed with ${result.errorsCount} error(s):`));
      for (const error of result.errors) {
        const element = error.element ? ` (${error.element})` : "";
        console.error(`  - ${error.message}${element}`);
      }
      process.exit(1);
    }

    // Report success
    console.log(ansis.green(`\n✓ Import successful!`));
    console.log(`  Nodes added: ${ansis.cyan(String(result.nodesAdded))}`);
    console.log(`  Edges added: ${ansis.cyan(String(result.edgesAdded))}`);

    if (result.errorsCount > 0) {
      console.log(ansis.yellow(`  Warnings: ${result.errorsCount}`));
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("import.success", true);
      (span as any).setAttribute("import.nodesAdded", result.nodesAdded);
      (span as any).setAttribute("import.edgesAdded", result.edgesAdded);
      (span as any).setAttribute("import.errors", result.errorsCount);
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));

    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({ code: 2, message: String(error) });
    }

    process.exit(1);
  } finally {
    endSpan(span);
  }
}
