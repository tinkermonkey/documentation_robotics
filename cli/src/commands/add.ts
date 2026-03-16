/**
 * Add an element to a layer
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { Layer } from "../core/layer.js";
import { Element } from "../core/element.js";
import { MutationHandler } from "../core/mutation-handler.js";
import { validateSourceReferenceOptions, buildSourceReference } from "../utils/source-reference.js";
import { SchemaValidator } from "../validators/schema-validator.js";
import { startSpan, endSpan } from "../telemetry/index.js";
import { generateElementId, generateUUID } from "../utils/id-generator.js";
import { getAllLayerIds, isValidLayer } from "../generated/layer-registry.js";
import { isValidNodeType, getNodeTypesForLayer } from "../generated/node-types.js";
import {
  CLIError,
  ErrorCategory,
  InvalidJSONError,
  ModelNotFoundError,
  findSimilar,
  formatValidOptions,
  getErrorMessage,
  handleError,
  handleSuccess,
} from "../utils/errors.js";

// Telemetry flag check
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

export interface AddOptions {
  name?: string;
  description?: string;
  attributes?: string;
  sourceFile?: string;
  sourceSymbol?: string;
  sourceProvenance?: string;
  sourceRepoRemote?: string;
  sourceRepoCommit?: string;
  verbose?: boolean;
  debug?: boolean;
}

export async function addCommand(
  layer: string,
  type: string,
  name: string,
  options: AddOptions
): Promise<void> {
  let span = null;

  try {
    // Validate layer name
    if (!isValidLayer(layer)) {
      const validLayers = getAllLayerIds();
      const similar = findSimilar(layer, validLayers, 3);
      const suggestions: string[] = [`Use a valid layer name: ${formatValidOptions(validLayers)}`];
      if (similar.length > 0) {
        suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
      }
      throw new CLIError(`Unknown layer "${layer}"`, ErrorCategory.USER, suggestions, {
        operation: "add",
        context: `Layer: ${layer}, Type: ${type}, Name: ${name}`,
      });
    }

    // Validate element type for this layer
    if (!isValidNodeType(layer, type)) {
      const validNodeTypes = getNodeTypesForLayer(layer);
      const typeNames = validNodeTypes.map((t) => t.type).sort();
      const similar = findSimilar(type, typeNames, 3);
      const suggestions: string[] = [`Valid types for ${layer}: ${formatValidOptions(typeNames)}`];
      if (similar.length > 0) {
        suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
      }
      throw new CLIError(
        `Invalid element type "${type}" for layer "${layer}"`,
        ErrorCategory.USER,
        suggestions,
        {
          operation: "add",
          context: `Layer: ${layer}, Type: ${type}, Name: ${name}`,
        }
      );
    }

    // Generate slug path: {layer}.{type}.{kebab-name}
    // Use the user-provided type (abbreviated form like "service") for backwards compatibility
    // Type normalization for schema validation is handled by isValidNodeType() above
    // This matches Python CLI format for compatibility
    const elementPath = generateElementId(layer, type, name);  // slug
    const elementUUID = generateUUID();                         // UUIDv4

    // Validate the generated slug is non-empty (name may collapse to empty after stripping special chars)
    const slugPart = elementPath.split(".")[2];
    if (!slugPart) {
      throw new CLIError(
        `Cannot generate a valid element ID from name "${name}"`,
        ErrorCategory.USER,
        [
          "Element names must contain at least one letter or digit",
          `Generated ID would be: ${elementPath}`,
        ]
      );
    }

    span = isTelemetryEnabled
      ? startSpan("element.add", {
          "layer.name": layer,
          "element.type": type,
          "element.id": elementPath,
        })
      : null;

    // Validate source reference options
    validateSourceReferenceOptions(options);

    // Load model (with error handling for missing models)
    let model: Model;
    try {
      model = await Model.load();
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.includes("No DR project") || message.includes("Model not found")) {
        throw new ModelNotFoundError();
      }
      throw error;
    }

    // Get or create layer
    let layerObj = await model.getLayer(layer);
    if (!layerObj) {
      layerObj = new Layer(layer);
      model.addLayer(layerObj);
    }

    // Parse attributes if provided
    let attributes: Record<string, unknown> = {};
    if (options.attributes) {
      try {
        attributes = JSON.parse(options.attributes);
      } catch (e) {
        throw new InvalidJSONError(options.attributes, "--attributes");
      }
    }

    // Create element in spec-node format
    // id = UUIDv4 for schema compliance; path = slug for human-readable identifier
    const element = new Element({
      id: elementUUID,          // UUIDv4
      path: elementPath,        // slug: {layer}.{type}.{kebab-name}
      spec_node_id: `${layer}.${type}`,
      layer_id: layer,
      type: type,
      name: options.name || name,
      description: options.description,
      attributes: attributes,
      metadata: {
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
      },
      layer, // Set layer so setSourceReference can use it
    });


    // Add source reference if provided
    const sourceRef = buildSourceReference(options);
    if (sourceRef) {
      element.setSourceReference(sourceRef);
    }

    // Validate element attributes against spec schema before persisting
    {
      const schemaValidator = new SchemaValidator();
      const tempLayer = new Layer(layer);
      tempLayer.addElement(element);
      const attrValidation = await schemaValidator.validateLayer(tempLayer);
      if (!attrValidation.isValid()) {
        const errorMessages = attrValidation.errors
          .map((e) => `  ${e.message}`)
          .join("\n");
        throw new CLIError(
          `Element ${elementPath} has invalid attributes:\n${errorMessages}`,
          ErrorCategory.USER,
          [`Run "dr schema ${layer} ${type}" to see the required attributes`]
        );
      }
    }

    // Check if element already exists (look up by path)
    if (layerObj.getElement(elementPath)) {
      throw new CLIError(
        `Element ${elementPath} already exists in ${layer} layer`,
        ErrorCategory.USER,
        [
          `Use "dr show ${elementPath}" to view the existing element`,
          `Use "dr update ${elementPath}" to modify it`,
          `Use "dr delete ${elementPath}" to remove it first if you want to recreate it`,
        ],
        { operation: "add", context: `Duplicate element path` }
      );
    }

    // Unified mutation handler for add operation
    const handler = new MutationHandler(model, elementPath, layer);

    // Execute add through unified path (handles staging and base model consistently)
    await handler.executeAdd(element, (elem) => {
      // This mutator is called by executeAdd for base model path only
      layerObj.addElement(elem);
    });

    // Determine if operation was staged or applied to base model
    if (handler.getAfterState()) {
      // Check if we went through staging path
      const stagingManager = handler.getStagingManager();
      const activeChangeset = await stagingManager.getActive();
      if (activeChangeset && activeChangeset.status === "staged") {
        // Staging path
        handleSuccess(
          `Staged element ${ansis.bold(elementPath)} to ${ansis.bold(activeChangeset.name)}`,
          {
            status: "staged",
            changeset: activeChangeset.name,
            type,
            name: options.name || name,
          }
        );
      } else {
        // Base model path
        handleSuccess(`Added element ${ansis.bold(elementPath)} to ${ansis.bold(layer)} layer`, {
          type,
          name: options.name || name,
          description: options.description || "(none)",
        });
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
