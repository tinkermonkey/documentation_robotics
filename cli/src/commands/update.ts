/**
 * Update an element
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { MutationHandler } from "../core/mutation-handler.js";
import { setStagedSourceReference, stagedSourceReference } from "../core/staged-source-reference.js";
import { StagingAreaManager } from "../core/staging-area.js";
import { StagedChangesetStorage } from "../core/staged-changeset-storage.js";
import { changedFields as snapshotChangedFields } from "../core/changeset-summary.js";
import { findElementLayer } from "../utils/element-utils.js";
import { CLIError, handleError, handleSuccess, handleInfo, handleWarning, findSimilar, formatValidOptions } from "../utils/errors.js";
import { isValidNodeType, getNodeTypesForLayer, normalizeNodeType } from "../generated/node-types.js";
import { Element } from "../core/element.js";
import { Layer } from "../core/layer.js";
import { SchemaValidator, suggestNodeTypes } from "../validators/schema-validator.js";
import { resolveSourceReferenceOptions, buildSourceReference } from "../utils/source-reference.js";
import { schemaLookupHint, undefinedTypeWarning } from "../utils/error-hints.js";
import { effectiveAttributePatch, parseJsonObjectOption, resolveAttributeUpdate } from "../utils/attribute-patch.js";

/**
 * When the element's type (after any requested type change) is one the spec does not define, the
 * warning and type-change hint to give instead of refusing the update; undefined when the type is
 * valid.
 */
function undefinedTypeCheck(
  layer: string,
  elementId: string,
  type: string
): { message: string; hint: string } | undefined {
  if (isValidNodeType(layer, type)) return undefined;
  return undefinedTypeWarning("cli", layer, elementId, type, suggestNodeTypes(layer, type));
}
import { startSpan, endSpan } from "../telemetry/index.js";

declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

export interface UpdateOptions {
  model?: string;
  name?: string;
  description?: string;
  type?: string;
  attributes?: string;
  /** JSON object merged into the element's current attributes; a null value removes a key. */
  attributePatch?: string;
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

  // Refuse what cannot be settled; the partial forms are settled against the element's current
  // reference once it is found.
  if (hasSourceOptions) {
    resolveSourceReferenceOptions(options);
  }
}

export async function updateCommand(id: string, options: UpdateOptions): Promise<void> {
  const changedFields: string[] = [];
  if (options.name) changedFields.push("name");
  if (options.description) changedFields.push("description");
  if (options.type) changedFields.push("type");
  if (options.attributes || options.attributePatch) changedFields.push("attributes");
  if (options.sourceFile || options.sourceProvenance || options.clearSourceReference) changedFields.push("sourceReference");

  const span = isTelemetryEnabled
    ? startSpan("element.update", {
        "element.id": id,
        "element.changed_fields": changedFields.join(","),
      })
    : null;

  try {
    // Validate source reference options
    validateUpdateSourceReferenceOptions(options);

    // --attribute-patch must be a JSON object, and cannot be combined with --attributes.
    const parsedPatch =
      options.attributePatch !== undefined ? parseJsonObjectOption(options.attributePatch, "--attribute-patch") : undefined;
    const attributeFlags = { attributes: "--attributes", attributePatch: "--attribute-patch" };
    if (options.attributes !== undefined && parsedPatch !== undefined) {
      resolveAttributeUpdate(undefined, { attributes: {}, attributePatch: parsedPatch }, attributeFlags);
    }
    // An empty patch names no key: it is not an update.
    const attributePatch = effectiveAttributePatch(parsedPatch);

    // Load model
    const model = await Model.load(options.model);

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
              attributePatch ||
              options.sourceFile ||
              options.sourceProvenance ||
              options.clearSourceReference ||
              options.type;

            if (!hasUpdates) {
              handleInfo(ansis.yellow("No fields specified for update"));
              return;
            }

            const after: Record<string, unknown> = { ...addChange.after };

            if (options.type) {
              const stagedLayerName = addChange.layerName;
              if (!isValidNodeType(stagedLayerName, options.type)) {
                const validNodeTypes = getNodeTypesForLayer(stagedLayerName);
                const typeNames = validNodeTypes.map((t) => t.type).sort();
                const similar = findSimilar(options.type, typeNames, 3);
                const suggestions: string[] = [`Valid types for ${stagedLayerName}: ${formatValidOptions(typeNames)}`];
                if (similar.length > 0) suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
                throw new CLIError(`Invalid element type "${options.type}" for layer "${stagedLayerName}"`, 1, suggestions);
              }
              const resolvedNewType = normalizeNodeType(stagedLayerName, options.type);
              after.type = resolvedNewType;
              after.spec_node_id = `${stagedLayerName}.${resolvedNewType}`;
            }
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
            } else if (attributePatch) {
              after.attributes = resolveAttributeUpdate(
                after.attributes as Record<string, unknown> | undefined,
                { attributePatch },
                attributeFlags
              );
            }
            if (options.clearSourceReference) {
              setStagedSourceReference(after, undefined);
            } else {
              const current = stagedSourceReference(after);
              const source = resolveSourceReferenceOptions(options, "cli", current);
              source.warnings.forEach((warning) => console.warn(ansis.yellow(`Warning: ${warning}`)));
              const newRef = buildSourceReference(source.options, current);
              if (newRef) setStagedSourceReference(after, newRef);
            }

            // Validate schema if type or attributes changed in staged element
            if (options.type || options.attributes || attributePatch) {
              const stagedLayerName = addChange.layerName;
              const tempElem = Element.fromSpecNode({
                id: String(after.id ?? addChange.elementId ?? "staged"),
                path: String(after.path ?? addChange.elementId ?? ""),
                spec_node_id: String(after.spec_node_id ?? ""),
                type: String(after.type ?? ""),
                layer_id: String(after.layer_id ?? stagedLayerName),
                name: String(after.name ?? ""),
                attributes: (after.attributes as Record<string, unknown>) || {},
              });
              const schemaValidator = new SchemaValidator();
              const tempLayer = new Layer(stagedLayerName);
              tempLayer.addElement(tempElem);
              const attrValidation = await schemaValidator.validateLayer(tempLayer);
              const undefinedTypeHint = undefinedTypeCheck(stagedLayerName, id, String(after.type ?? ""));
              const blocking = undefinedTypeHint
                ? attrValidation.errors.filter((e) => e.location !== "/type")
                : attrValidation.errors;
              if (blocking.length > 0) {
                const errorMessages = blocking
                  .map((e) => `  ${e.message}`)
                  .join("\n");
                throw new CLIError(
                  `Updated attributes fail schema validation:\n${errorMessages}`,
                  1,
                  [
                    undefinedTypeHint
                      ? undefinedTypeHint.hint
                      : (options.type
                          ? "Incompatible attributes must be manually cleaned up before changing type. "
                          : "") + schemaLookupHint("cli", stagedLayerName, String(after.type)),
                  ]
                );
              }
              if (undefinedTypeHint) handleWarning(undefinedTypeHint.message, [undefinedTypeHint.hint]);
            }

            await storage.updateChange(activeId, id, {
              type: addChange.type,
              elementId: addChange.elementId,
              layerName: addChange.layerName,
              before: addChange.before,
              after,
            });

            handleSuccess(`Updated staged element ${ansis.bold(id)}`, {
              elementId: id,
              layer: addChange.layerName,
              changesetStatus: "staged",
              changedFields: snapshotChangedFields(addChange.after, after),
            }, { verbose: options.verbose });
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
      options.type ||
      options.attributes ||
      attributePatch ||
      options.sourceFile ||
      options.sourceProvenance ||
      options.clearSourceReference;

    if (!hasUpdates) {
      handleInfo(ansis.yellow("No fields specified for update"));
      return;
    }

    const currentSource = element.getSourceReference();
    const source = resolveSourceReferenceOptions(options, "cli", currentSource);
    source.warnings.forEach((warning) => console.warn(ansis.yellow(`Warning: ${warning}`)));

    // Single unified mutation handler for update
    const handler = new MutationHandler(model, id, layerName);

    // Execute update through unified path (handles staging and base model consistently)
    // The mutator function applies all updates in a single pass with validated JSON parsing
    await handler.executeUpdate(element, async (elem, after) => {
      // Resolve new type (validate name only — don't mutate live elem yet)
      let resolvedNewType: string | undefined;
      if (options.type) {
        if (!isValidNodeType(layerName, options.type)) {
          const validNodeTypes = getNodeTypesForLayer(layerName);
          const typeNames = validNodeTypes.map((t) => t.type).sort();
          const similar = findSimilar(options.type, typeNames, 3);
          const suggestions: string[] = [`Valid types for ${layerName}: ${formatValidOptions(typeNames)}`];
          if (similar.length > 0) suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
          throw new CLIError(`Invalid element type "${options.type}" for layer "${layerName}"`, 1, suggestions);
        }
        resolvedNewType = normalizeNodeType(layerName, options.type);
      }

      // Parse attributes (don't mutate yet)
      let parsedAttributes: Record<string, unknown> | undefined;
      if (options.attributes) {
        try {
          parsedAttributes = JSON.parse(options.attributes) as Record<string, unknown>;
        } catch (e) {
          throw new CLIError("Invalid JSON in --attributes", 1, [
            "Ensure your JSON is valid and properly formatted",
          ]);
        }
      } else if (attributePatch) {
        // The element is the projected one when a changeset is active, so this merges over staged values.
        parsedAttributes = resolveAttributeUpdate(elem.attributes, { attributePatch }, attributeFlags);
      }

      // Validate against schema using a temp element BEFORE mutating the live elem
      if (resolvedNewType || parsedAttributes) {
        const candidateType = resolvedNewType ?? elem.type;
        const tempElem = new Element({
          ...elem.toJSON(),
          type: candidateType,
          spec_node_id: `${layerName}.${candidateType}`,
          attributes: parsedAttributes ?? elem.attributes,
        });
        const schemaValidator = new SchemaValidator();
        const tempLayer = new Layer(layerName);
        tempLayer.addElement(tempElem);
        const attrValidation = await schemaValidator.validateLayer(tempLayer);
        const undefinedTypeHint = undefinedTypeCheck(layerName, id, candidateType);
        const blocking = undefinedTypeHint
          ? attrValidation.errors.filter((e) => e.location !== "/type")
          : attrValidation.errors;
        if (blocking.length > 0) {
          const errorMessages = blocking
            .map((e) => `  ${e.message}`)
            .join("\n");
          throw new CLIError(
            `Updated attributes fail schema validation:\n${errorMessages}`,
            1,
            [
              undefinedTypeHint
                ? undefinedTypeHint.hint
                : resolvedNewType
                  ? "Incompatible attributes must be manually cleaned up before changing type. " +
                    schemaLookupHint("cli", layerName, candidateType)
                  : schemaLookupHint("cli", layerName, elem.type),
            ]
          );
        }
        if (undefinedTypeHint) handleWarning(undefinedTypeHint.message, [undefinedTypeHint.hint]);
      }

      // Validation passed — apply all mutations to live element
      if (resolvedNewType) {
        elem.type = resolvedNewType;
        after.type = resolvedNewType;
        elem.spec_node_id = `${layerName}.${resolvedNewType}`;
        after.spec_node_id = `${layerName}.${resolvedNewType}`;
      }

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
      }

      if (options.clearSourceReference) {
        elem.setSourceReference(undefined);
        setStagedSourceReference(after, undefined);
      } else if (source.options.sourceProvenance) {
        const newRef = buildSourceReference(source.options, currentSource);
        if (newRef) {
          elem.setSourceReference(newRef);
          setStagedSourceReference(after, newRef);
        }
      }

      // Update element in layer graph to persist mutations
      layer.updateElement(elem);
    });

    const changes: Record<string, unknown> = {};
    if (options.type) changes.type = options.type;
    if (options.name) changes.name = options.name;
    if (options.description !== undefined) changes.description = options.description;
    if (options.sourceFile) changes.source = options.sourceFile;
    if (options.clearSourceReference) changes.source = "cleared";

    const details: Record<string, unknown> = {
      elementId: id,
      layer: layerName,
      name: element.name,
      changes,
      changedFields: handler.getChangedFields(),
      // The active changeset adds this element: the update was folded into that add.
      ...(handler.wasFoldedIntoAdd() ? { foldedIntoAdd: true } : {}),
    };

    handleSuccess(
      `Updated ${handler.wasFoldedIntoAdd() ? "staged " : ""}element ${ansis.bold(id)}` +
        (handler.getChangedFields().length > 0 ? ` (${handler.getChangedFields().join(", ")})` : ""),
      details,
      { verbose: options.verbose }
    );
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
