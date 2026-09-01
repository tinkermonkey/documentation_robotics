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
import { getErrorMessage } from "../utils/errors.js";
import { RELATIONSHIPS_BY_SOURCE, RELATIONSHIPS_BY_DESTINATION } from "../generated/relationship-index.js";
import { getActiveSpan } from "../telemetry/index.js";
import { StagedChangesetStorage } from "../core/staged-changeset-storage.js";


export interface ValidateOptions {
  layers?: string[];
  strict?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  output?: string;
  debug?: boolean;
  model?: string;
  orphans?: boolean;
  // Python CLI compatibility options
  all?: boolean;
  markdown?: boolean;
  schemas?: boolean;
  schema?: boolean; // Alias for schemas
  relationships?: boolean;
  structure?: boolean;
  naming?: boolean;
  references?: boolean;
  // Composed scope options
  scope?: string;
  modelPath?: string[]; // Raw array from CLI; will be parsed into modelPaths
  modelPaths?: Record<string, string>; // Parsed model-path overrides
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
  // Compare spec/dist/ (15 compiled flat files) vs dist/schemas/bundled/ (same 15 files)
  // spec/schemas/ contains individual source files; spec/dist/ is the compiled distribution
  const specSchemaDir = path.join(projectRoot, "spec", "dist");
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
      const message = getErrorMessage(error);
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
      ansis.dim("To fix: Run 'npm run build:spec' at repo root, then 'npm run build' in cli/ to sync spec/dist/ → cli/src/schemas/bundled/")
    );
    console.log("");
    throw new Error(`Schema synchronization failed with ${mismatches.length} issue(s)`);
  } else {
    console.log("");
    console.log(ansis.green("✓ All schemas synchronized"));
    console.log("");
  }
}

/**
 * Display structured orphan report grouped by layer, with dead-end detection.
 * For each orphan, checks whether valid relationship targets exist in the model.
 */
async function validateOrphansOnly(model: Model, outputPath?: string): Promise<void> {
  const stats = ValidationFormatter.calculateStats(model);

  if (stats.orphanedElements.length === 0) {
    const msg = "No orphaned elements found. All elements are connected.";
    if (outputPath) {
      await fs.writeFile(outputPath, JSON.stringify({ total: 0, byLayer: {} }, null, 2), "utf-8");
      console.log(`\nOrphan report exported to ${outputPath}`);
    } else {
      console.log(ansis.green(`\n✓ ${msg}`));
    }
    return;
  }

  // Build set of element types currently present in the model
  const typesInModel = new Set<string>();
  for (const [, layer] of model.layers) {
    for (const element of layer.listElements()) {
      const id = element.path || element.id;
      const parts = id.split(".");
      if (parts.length >= 2) typesInModel.add(`${parts[0]}.${parts[1]}`);
    }
  }

  // Group orphans by layer, annotated with dead-end status
  const byLayer = new Map<string, Array<{
    id: string;
    type: string;
    status: "dead-end" | "connectable" | "no-schema";
    reachablePredicates: string[];
    reachableTargetTypes: string[];
    needsTypes: string[];
  }>>();

  for (const elementId of stats.orphanedElements.sort()) {
    const parts = elementId.split(".");
    const layer = parts[0] ?? "unknown";
    const specNodeType = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : elementId;

    // Outgoing: this element can point to others
    const outgoingRels = RELATIONSHIPS_BY_SOURCE.get(specNodeType) ?? [];
    const allDestTypes = [...new Set(outgoingRels.map(r => r.destinationSpecNodeId))];
    const reachableDestTypes = allDestTypes.filter(t => typesInModel.has(t));
    const reachablePredicates = [...new Set(
      outgoingRels.filter(r => reachableDestTypes.includes(r.destinationSpecNodeId)).map(r => r.predicate)
    )];

    // Incoming: other element types in the model can point to this element
    const incomingRels = RELATIONSHIPS_BY_DESTINATION.get(specNodeType) ?? [];
    const reachableIncomingSourceTypes = [...new Set(incomingRels.map(r => r.sourceSpecNodeId))]
      .filter(t => typesInModel.has(t));

    const hasOutgoingTargets = reachableDestTypes.length > 0;
    const hasIncomingSources = reachableIncomingSourceTypes.length > 0;
    const hasAnySchemas = outgoingRels.length > 0 || incomingRels.length > 0;

    let status: "dead-end" | "connectable" | "no-schema";
    if (!hasAnySchemas) {
      status = "no-schema";
    } else if (!hasOutgoingTargets && !hasIncomingSources) {
      status = "dead-end";
    } else {
      status = "connectable";
    }

    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push({
      id: elementId,
      type: specNodeType,
      status,
      reachablePredicates,
      reachableTargetTypes: reachableDestTypes,
      needsTypes: allDestTypes,
    });
  }

  if (outputPath) {
    const jsonOut: Record<string, unknown> = {
      total: stats.orphanedElements.length,
      byLayer: Object.fromEntries(
        [...byLayer.entries()].map(([layer, items]) => [layer, items])
      ),
    };
    await fs.writeFile(outputPath, JSON.stringify(jsonOut, null, 2), "utf-8");
    console.log(`\nOrphan report exported to ${outputPath}`);
    return;
  }

  console.log(ansis.bold(`\nOrphaned Elements (${stats.orphanedElements.length})`));
  console.log(ansis.dim("Elements with no intra-layer relationships and no cross-layer references\n"));

  let deadEndCount = 0;
  let connectableCount = 0;

  for (const [layerName, items] of byLayer) {
    console.log(ansis.bold(ansis.cyan(`  ${layerName} (${items.length})`)));
    for (const item of items) {
      if (item.status === "no-schema") {
        console.log(`    ${ansis.dim("○")} ${item.id}`);
        console.log(`      ${ansis.dim("No outgoing relationship schemas defined for type " + item.type)}`);
      } else if (item.status === "dead-end") {
        deadEndCount++;
        const needsPreview = item.needsTypes.slice(0, 4).join(", ") +
          (item.needsTypes.length > 4 ? ` +${item.needsTypes.length - 4} more` : "");
        console.log(`    ${ansis.red("✗")} ${item.id} ${ansis.dim("(dead-end)")}`);
        console.log(`      ${ansis.dim("Needs: " + needsPreview)}`);
      } else {
        connectableCount++;
        const predsPreview = item.reachablePredicates.slice(0, 3).join(", ");
        const targetsPreview = item.reachableTargetTypes.slice(0, 3).join(", ");
        console.log(`    ${ansis.yellow("○")} ${item.id}`);
        console.log(`      ${ansis.dim(`→ try: ${predsPreview} → ${targetsPreview}`)}`);
      }
    }
    console.log();
  }

  // Summary line
  const noSchemaCount = stats.orphanedElements.length - connectableCount - deadEndCount;
  const parts: string[] = [];
  if (connectableCount > 0) parts.push(`${connectableCount} connectable`);
  if (deadEndCount > 0) parts.push(`${deadEndCount} dead-end (valid target types missing from model)`);
  if (noSchemaCount > 0) parts.push(`${noSchemaCount} no-schema`);
  console.log(ansis.dim(`Summary: ${parts.length > 0 ? parts.join(", ") : "0 actionable"}`));
  if (connectableCount > 0) {
    console.log(ansis.dim("Run /dr-relate --orphans to wire connectable elements"));
  }
}

/**
 * Print a notice that staged changes from the active changeset were projected into the
 * model before validation, so users don't mistake correctly-projected staged state for
 * a validator bug. Scoped to the layers actually included in this validation run.
 */
async function reportStagedChangesIncluded(
  rootPath: string,
  changesetId: string,
  validatedLayerNames: Iterable<string>
): Promise<void> {
  try {
    const changeset = await new StagedChangesetStorage(rootPath).load(changesetId);
    if (!changeset || changeset.changes.length === 0) {
      return;
    }

    const validatedLayers = new Set(validatedLayerNames);
    const relevantChangeCount = changeset.changes.filter((change) =>
      validatedLayers.has(change.layerName)
    ).length;

    if (relevantChangeCount === 0) {
      return;
    }

    console.log(
      ansis.cyan(
        `ℹ Including ${relevantChangeCount} staged change${relevantChangeCount === 1 ? "" : "s"} from changeset '${changesetId}'`
      )
    );
    console.log();
  } catch (error) {
    // Changeset is corrupted or unreadable, but this is purely informational.
    // Log a warning and continue validation rather than crashing.
    const message = getErrorMessage(error);
    console.warn(ansis.yellow(`⚠ Could not load changeset '${changesetId}': ${message}`));
    console.log();
  }
}

/**
 * Parse model-path option strings into a dictionary
 * Format: "model-name=/path/to/model" (can be repeated)
 */
function parseModelPaths(modelPathArray?: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  if (!modelPathArray || modelPathArray.length === 0) {
    return result;
  }

  for (const item of modelPathArray) {
    const [modelName, ...rest] = item.split("=");
    const modelPath = rest.join("="); // Handle paths with = in them

    if (!modelName || !modelPath) {
      throw new Error(
        `Invalid --model-path format: '${item}'. Expected format: 'model-name=/path/to/model'`
      );
    }

    result[modelName.trim()] = modelPath.trim();
  }

  return result;
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
  // Parse model-path options
  const modelPaths = parseModelPaths(options.modelPath);
  options.modelPaths = modelPaths;

  // Annotate the root cli.execute span with validate-specific attributes
  const activeSpan = getActiveSpan();
  if (activeSpan) {
    activeSpan.setAttribute("validate.layers", options.layers?.join(",") || "all");
    activeSpan.setAttribute("validate.strict", options.strict || false);
    activeSpan.setAttribute("validate.verbose", options.verbose || false);
    activeSpan.setAttribute("validate.orphans", options.orphans || false);
    activeSpan.setAttribute("validate.schemas", options.schemas || options.schema || false);
    activeSpan.setAttribute("validate.output", options.output || "console");
    activeSpan.setAttribute("validate.scope", options.scope || "local");
  }

  try {
    // Handle schema validation flag
    if (options.schemas || options.schema) {
      await validateSchemaSynchronization();

      if (activeSpan) {
        activeSpan.setAttribute("validate.mode", "schema-sync");
        activeSpan.setAttribute("validate.result", "success");
      }
      return;
    }

    // Load model (forward --layers filter so only requested layers are read from disk)
    const model = await Model.load(options.model, options.layers ? { layers: options.layers } : {});

    // --orphans mode: focused orphan report, skip full validation
    if (options.orphans) {
      if (activeSpan) {
        activeSpan.setAttribute("validate.mode", "orphans-only");
      }

      const activeChangesetId = model.getActiveChangesetId();
      const modelForOrphans = activeChangesetId
        ? (await model.getVirtualProjectionEngine().projectModel(model, activeChangesetId)) as unknown as typeof model
        : model;

      if (activeChangesetId) {
        await reportStagedChangesIncluded(
          model.rootPath,
          activeChangesetId,
          options.layers && options.layers.length > 0 ? options.layers : modelForOrphans.layers.keys()
        );
      }

      await validateOrphansOnly(modelForOrphans, options.output);

      if (activeSpan) {
        activeSpan.setAttribute("validate.result", "success");
      }
      return;
    }

    // Determine validation scope and create appropriate validator
    const scope = options.scope || "local";

    // If an active changeset exists, project staged elements into the model so validators see them
    const activeChangesetId = model.getActiveChangesetId();
    const modelToValidate = activeChangesetId
      ? (await model.getVirtualProjectionEngine().projectModel(model, activeChangesetId)) as unknown as typeof model
      : model;

    if (activeChangesetId) {
      await reportStagedChangesIncluded(
        model.rootPath,
        activeChangesetId,
        options.layers && options.layers.length > 0 ? options.layers : modelToValidate.layers.keys()
      );
    }

    let result;

    if (scope === "composed") {
      // Use composed validator for cross-model reference validation
      const { ComposedReferenceValidator } = await import("../validators/composed-reference-validator.js");
      const composedValidator = new ComposedReferenceValidator(options.modelPaths || {});
      result = await composedValidator.validateModel(modelToValidate);
    } else if (scope === "local") {
      // Use standard validator for local validation
      const validator = new Validator();
      result = await validator.validateModel(modelToValidate);
    } else {
      throw new Error(`Invalid validation scope: '${scope}'. Expected 'local' or 'composed'.`);
    }

    // Detect orphaned elements and add them as warnings so they appear in
    // the warning count and are surfaced consistently across all output formats.
    const stats = ValidationFormatter.calculateStats(modelToValidate);
    for (const orphanId of stats.orphanedElements) {
      result.addWarning({
        message: `Element '${orphanId}' is orphaned (no cross-layer references or intra-layer relationships)`,
        layer: orphanId.split(".")[0] ?? "",
        elementId: orphanId,
        category: "orphan",
        fixSuggestion: "Add cross-layer references or relationships to connect this element to the rest of the model",
      });
    }

    // Check source traceability in normal mode: elements without source_reference lack the
    // provenance link that dr-sync uses for drift detection. Surface this in every validate
    // run so users discover gaps without having to remember --strict.
    for (const [layerName, layer] of modelToValidate.layers) {
      for (const element of layer.listElements()) {
        const elementId = element.path || element.id;
        if (!element.source_reference) {
          result.addWarning({
            message: `Element '${elementId}' has no source reference`,
            layer: layerName,
            elementId,
            fixSuggestion:
              "Add a source_reference with provenance to link this element to its implementation",
          });
        }
      }
    }

    // Strict-mode additional checks: flag elements missing a description.
    if (options.strict) {
      for (const [layerName, layer] of modelToValidate.layers) {
        for (const element of layer.listElements()) {
          const elementId = element.path || element.id;

          if (!element.description || element.description.trim() === "") {
            result.addWarning({
              message: `Element '${elementId}' has no description`,
              layer: layerName,
              elementId,
              fixSuggestion: "Add a description to document what this element represents",
            });
          }
        }
      }
    }

    // Record validation results in span
    if (activeSpan) {
      activeSpan.setAttribute("validate.valid", result.isValid());
      activeSpan.setAttribute("validate.error_count", result.errors.length);
      activeSpan.setAttribute("validate.warning_count", result.warnings.length);
      activeSpan.setAttribute("validate.orphan_count", stats.orphanedElements.length);
    }

    // Format and display output
    if (options.output) {
      // Export to file
      let content: string;

      if (options.output.endsWith(".md") || options.output.endsWith(".markdown")) {
        content = ValidationFormatter.toMarkdown(result, modelToValidate);
      } else if (options.output.endsWith(".json")) {
        content = JSON.stringify(ValidationFormatter.toJSON(result, modelToValidate), null, 2);
      } else {
        // Default to JSON
        content = JSON.stringify(ValidationFormatter.toJSON(result, modelToValidate), null, 2);
      }

      await fs.writeFile(options.output, content, "utf-8");
      console.log(`\nValidation report exported to ${options.output}`);

      if (!result.isValid()) {
        throw new Error("Validation failed");
      }

      if (activeSpan) {
        activeSpan.setAttribute("validate.result", "success");
      }
      return;
    }

    // Display formatted output
    const formatted = ValidationFormatter.format(result, modelToValidate, {
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

      if (activeSpan) {
        activeSpan.setAttribute("validate.result", "success");
      }
      return;
    } else {
      throw new Error("Validation failed");
    }
  } catch (error) {
    activeSpan?.setAttribute("validate.result", "error");

    const message = getErrorMessage(error);
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

    // Re-throw to let root span handle exit
    throw error;
  }
}
