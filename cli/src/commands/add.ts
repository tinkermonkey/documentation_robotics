/**
 * Add an element to a layer
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { Layer } from "../core/layer.js";
import { Element } from "../core/element.js";
import { MutationHandler } from "../core/mutation-handler.js";
import {
  validateSourceReferenceOptions,
  resolveSourceReferenceOptions,
  buildSourceReference,
} from "../utils/source-reference.js";
import { schemaLookupHint } from "../utils/error-hints.js";
import { SchemaValidator } from "../validators/schema-validator.js";
import { getActiveSpan } from "../telemetry/index.js";
import { compactId, deriveElementId, generateUUID, nearDuplicateId } from "../utils/id-generator.js";
import { getAllLayerIds, isValidLayer } from "../generated/layer-registry.js";
import { isValidNodeType, getNodeTypesForLayer, normalizeNodeType } from "../generated/node-types.js";
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


export interface AddOptions {
  model?: string;
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

    // Resolve abbreviated type names to their canonical spec names
    // e.g., "service" → "applicationservice" for the application layer
    const resolvedType = normalizeNodeType(layer, type);

    // Generate slug path: {layer}.{resolvedType}.{kebab-name}, by the rules model_add and
    // extraction share (utils/id-generator.ts)
    const derived = deriveElementId(layer, resolvedType, name);
    const elementPath = derived.id;                             // slug
    const elementUUID = generateUUID();                         // UUIDv4

    // Validate the generated slug is non-empty (name may collapse to empty after stripping special chars)
    if (!derived.slug) {
      throw new CLIError(
        `Cannot generate a valid element ID from name "${name}"`,
        ErrorCategory.USER,
        [
          "Element names must contain at least one letter or digit",
          `Generated ID would be: ${elementPath}`,
        ]
      );
    }

    const span = getActiveSpan();
    span?.setAttribute("layer.name", layer);
    span?.setAttribute("element.type", resolvedType);
    span?.setAttribute("element.id", elementPath);

    // Validate source reference options: a file without a provenance gets 'manual'; an
    // 'extracted' or 'manual' provenance without a file is ignored with a warning.
    validateSourceReferenceOptions(options);
    const source = resolveSourceReferenceOptions(options);
    source.warnings.forEach((warning) => console.warn(ansis.yellow(`Warning: ${warning}`)));

    // Load model (with error handling for missing models)
    let model: Model;
    try {
      model = await Model.load(options.model, { layers: [layer] });
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
      path: elementPath,        // slug: {layer}.{resolvedType}.{kebab-name}
      spec_node_id: `${layer}.${resolvedType}`,
      layer_id: layer,
      type: resolvedType,
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
    const sourceRef = buildSourceReference(source.options);
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
        // Say "attributes" only when that is where the schema failed: an id the schema refuses
        // is a problem with the name (#1212).
        const inAttributes = attrValidation.errors.some((e) => (e.location ?? "").startsWith("/attributes"));
        const idRefused = !inAttributes && attrValidation.errors.some((e) => e.location === "/path");
        throw new CLIError(
          inAttributes
            ? `Element ${elementPath} has invalid attributes:\n${errorMessages}`
            : idRefused
              ? `The name "${name}" gives the id ${elementPath}, which is not a valid element id:\n${errorMessages}`
              : `Element ${elementPath} is not valid:\n${errorMessages}`,
          ErrorCategory.USER,
          [
            idRefused
              ? "An id is lowercase letters, digits and hyphens, and each part starts with a letter: change the name so its id does"
              : schemaLookupHint("cli", layer, resolvedType),
          ]
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

    // An element with this name under an id that differs only by hyphens is the same element,
    // its id derived by an earlier rule: refuse, as when the ids were equal. Another name there
    // is worth a warning.
    const key = compactId(elementPath);
    const near = nearDuplicateId(
      elementPath,
      options.name || name,
      layerObj
        .listElements()
        .map((e) => ({ id: e.path || e.id, name: e.name }))
        .filter((e) => compactId(e.id) === key)
    );
    if (near.existing) {
      throw new CLIError(
        `Element ${near.existing} already exists with this name (the name gives ${elementPath} today; the element keeps its id)`,
        ErrorCategory.USER,
        [`Use "dr show ${near.existing}" to view it`, `Use "dr update ${near.existing}" to modify it`],
        { operation: "add", context: `Duplicate element under an earlier id` }
      );
    }
    if (near.warning) console.warn(ansis.yellow(`Warning: ${near.warning}`));
    derived.notes.forEach((note) => console.warn(ansis.yellow(`Note: ${note}`)));

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
            elementId: elementPath,
            layer,
            type: resolvedType,
            name: options.name || name,
            changesetStatus: "staged",
            changeset: activeChangeset.name,
          },
          { verbose: options.verbose }
        );
      } else {
        // Base model path
        handleSuccess(`Added element ${ansis.bold(elementPath)} to ${ansis.bold(layer)} layer`, {
          elementId: elementPath,
          layer,
          type: resolvedType,
          name: options.name || name,
          description: options.description || "(none)",
        }, { verbose: true });
      }
    }
  } catch (error) {
    handleError(error);
  }
}
