/**
 * Update an element
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { MutationHandler } from "../core/mutation-handler.js";
import { StagingAreaManager } from "../core/staging-area.js";
import { StagedChangesetStorage } from "../core/staged-changeset-storage.js";
import { findElementLayer } from "../utils/element-utils.js";
import { CLIError, handleError } from "../utils/errors.js";
import { Layer } from "../core/layer.js";
import { SchemaValidator } from "../validators/schema-validator.js";
import { validateSourceReferenceOptions, buildSourceReference } from "../utils/source-reference.js";
import { startSpan, endSpan } from "../telemetry/index.js";

declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

export interface UpdateOptions {
  name?: string;
  description?: string;
  attributes?: string;
  sourceFile?: string;
  sourceSymbol?: string;
  sourceProvenance?: string;
  sourceRepoRemote?: string;
  sourceRepoCommit?: string;
  clearSourceReference?: boolean;
  verbose?: boolean;
  debug?: boolean;
}

/**
 * Validate update-specific source reference options
 */
function validateUpdateSourceReferenceOptions(options: UpdateOptions): void {
  const hasSourceOptions =
    options.sourceFile ||
    options.sourceSymbol ||
    options.sourceProvenance ||
    options.sourceRepoRemote ||
    options.sourceRepoCommit;

  if (options.clearSourceReference && hasSourceOptions) {
    throw new CLIError(
      "Cannot use --clear-source-reference with other source reference options",
      1,
      ["Specify either --clear-source-reference or other source options, not both"]
    );
  }

  // Use shared validation for source reference options if any are provided
  if (hasSourceOptions) {
    validateSourceReferenceOptions(options);
  }
}

export async function updateCommand(id: string, options: UpdateOptions): Promise<void> {
  const changedFields: string[] = [];
  if (options.name) changedFields.push("name");
  if (options.description) changedFields.push("description");
  if (options.attributes) changedFields.push("attributes");
  if (options.sourceFile || options.clearSourceReference) changedFields.push("sourceReference");

  const span = isTelemetryEnabled
    ? startSpan("element.update", {
        "element.id": id,
        "element.changed_fields": changedFields.join(","),
      })
    : null;

  try {
    // Validate source reference options
    validateUpdateSourceReferenceOptions(options);

    // Load model
    const model = await Model.load();

    // Find element
    const layerName = await findElementLayer(model, id);
    if (!layerName) {
      // Not in committed model — check active changeset for a staged ADD
      const stagingManager = new StagingAreaManager(model.rootPath, model);
      const storage = new StagedChangesetStorage(model.rootPath);
      const activeId = await stagingManager.getActiveId();

      if (activeId) {
        const changeset = await storage.load(activeId);
        if (changeset) {
          const addChange = changeset.changes.find(
            (c) => c.type === "add" && c.elementId === id
          );
          if (addChange && addChange.after) {
            const hasUpdates =
              options.name ||
              options.description !== undefined ||
              options.attributes ||
              options.sourceFile ||
              options.clearSourceReference;

            if (!hasUpdates) {
              console.log(ansis.yellow("No fields specified for update"));
              return;
            }

            const after: Record<string, unknown> = { ...addChange.after };

            if (options.name) after.name = options.name;
            if (options.description !== undefined) {
              after.description = options.description || undefined;
            }
            if (options.attributes) {
              try {
                const parsed = JSON.parse(options.attributes);
                after.attributes = parsed;
              } catch {
                throw new CLIError("Invalid JSON in --attributes", 1, [
                  "Ensure your JSON is valid and properly formatted",
                ]);
              }
            }
            if (options.clearSourceReference) {
              delete after.source_reference;
            } else if (options.sourceFile) {
              const newRef = buildSourceReference(options);
              if (newRef) after.source_reference = newRef;
            }

            await storage.updateChange(activeId, id, {
              type: addChange.type,
              elementId: addChange.elementId,
              layerName: addChange.layerName,
              before: addChange.before,
              after,
            });

            console.log(ansis.green(`✓ Updated staged element ${ansis.bold(id)}`));
            return;
          }
        }
      }

      throw new CLIError(`Element ${id} not found`, 1);
    }

    const layer = await model.getLayer(layerName);
    if (!layer) {
      throw new CLIError(`Layer ${layerName} not found`, 1);
    }

    const element = layer.getElement(id);
    if (!element) {
      throw new CLIError(`Element ${id} not found`, 1);
    }

    // Validate that at least one field is specified
    const hasUpdates =
      options.name ||
      options.description !== undefined ||
      options.attributes ||
      options.sourceFile ||
      options.clearSourceReference;

    if (!hasUpdates) {
      console.log(ansis.yellow("No fields specified for update"));
      return;
    }

    // Single unified mutation handler for update
    const handler = new MutationHandler(model, id, layerName);

    // Execute update through unified path (handles staging and base model consistently)
    // The mutator function applies all updates in a single pass with validated JSON parsing
    await handler.executeUpdate(element, async (elem, after) => {
      // Parse JSON once here in the mutator - shared by both staging and base paths
      let parsedAttributes: Record<string, unknown> | undefined;
      if (options.attributes) {
        try {
          parsedAttributes = JSON.parse(options.attributes);
        } catch (e) {
          throw new CLIError("Invalid JSON in --attributes", 1, [
            "Ensure your JSON is valid and properly formatted",
          ]);
        }
      }

      // Apply updates to both element and after state
      if (options.name) {
        elem.name = options.name;
        after.name = options.name;
      }

      if (options.description !== undefined) {
        elem.description = options.description || undefined;
        after.description = options.description || undefined;
      }

      if (parsedAttributes) {
        elem.attributes = parsedAttributes;
        after.attributes = parsedAttributes;

        // Validate new attributes against spec schema before persisting
        const schemaValidator = new SchemaValidator();
        const tempLayer = new Layer(layerName);
        tempLayer.addElement(elem);
        const attrValidation = await schemaValidator.validateLayer(tempLayer);
        if (!attrValidation.isValid()) {
          const errorMessages = attrValidation.errors
            .map((e) => `  ${e.message}`)
            .join("\n");
          throw new CLIError(
            `Updated attributes fail schema validation:\n${errorMessages}`,
            1,
            [`Run "dr schema ${layerName} ${elem.type}" to see the required attributes`]
          );
        }
      }

      if (options.clearSourceReference) {
        elem.setSourceReference(undefined);
        after.sourceReference = undefined;
      } else if (options.sourceFile) {
        const newRef = buildSourceReference(options);
        if (newRef) {
          elem.setSourceReference(newRef);
          after.sourceReference = newRef;
        }
      }

      // Update element in layer graph to persist mutations
      layer.updateElement(elem);
    });

    console.log(ansis.green(`✓ Updated element ${ansis.bold(id)}`));
    if (options.verbose) {
      console.log(ansis.dim(`  Layer: ${layerName}`));
      if (options.name) {
        console.log(ansis.dim(`  Name: ${options.name}`));
      }
      if (options.description) {
        console.log(ansis.dim(`  Description: ${options.description}`));
      }
      if (options.sourceFile) {
        console.log(ansis.dim(`  Source: ${options.sourceFile}`));
      }
      if (options.clearSourceReference) {
        console.log(ansis.dim(`  Source: cleared`));
      }
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({ code: 2, message: (error as Error).message });
    }
    handleError(error);
  } finally {
    if (isTelemetryEnabled) {
      endSpan(span);
    }
  }
}
