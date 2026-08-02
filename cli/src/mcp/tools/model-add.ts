/**
 * model_add — add an element to a layer. Mirrors `dr add`, operating through
 * the shared MutationHandler so staging and base-model persistence stay
 * consistent with the CLI.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Element } from "../../core/element.js";
import { Layer } from "../../core/layer.js";
import { MutationHandler } from "../../core/mutation-handler.js";
import { getAllLayerIds, isValidLayer } from "../../generated/layer-registry.js";
import { getNodeTypesForLayer, isValidNodeType, normalizeNodeType } from "../../generated/node-types.js";
import { generateElementId, generateUUID } from "../../utils/id-generator.js";
import { buildSourceReference, validateSourceReferenceOptions } from "../../utils/source-reference.js";
import { SchemaValidator } from "../../validators/schema-validator.js";
import { CLIError, ErrorCategory, findSimilar, formatValidOptions } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

export interface ModelAddArgs {
  layer: string;
  type: string;
  name: string;
  description?: string;
  attributes?: Record<string, unknown>;
  sourceFile?: string;
  sourceSymbol?: string;
  sourceProvenance?: "extracted" | "manual" | "inferred" | "generated";
  sourceRepoRemote?: string;
  sourceRepoCommit?: string;
  rootPath?: string;
}

const inputSchema = {
  layer: z.string().describe("Canonical layer name (e.g. 'api', 'data-model')."),
  type: z.string().describe("Element type within the layer (e.g. 'operation', 'entity')."),
  name: z.string().describe("Human-readable element name; used to derive the element ID."),
  description: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()).optional().describe("Type-specific attributes, validated against the element's spec schema."),
  sourceFile: z.string().optional().describe("Source file path relative to the repository root."),
  sourceSymbol: z.string().optional(),
  sourceProvenance: z.enum(["extracted", "manual", "inferred", "generated"]).optional(),
  sourceRepoRemote: z.string().optional(),
  sourceRepoCommit: z.string().optional().describe("Full 40-character Git commit SHA."),
  rootPath: rootPathSchema,
};

export async function modelAddHandler(args: ModelAddArgs): Promise<CallToolResult> {
  return runTool(async () => {
    if (!isValidLayer(args.layer)) {
      const validLayers = getAllLayerIds();
      const similar = findSimilar(args.layer, validLayers, 3);
      const suggestions: string[] = [`Use a valid layer name: ${formatValidOptions(validLayers)}`];
      if (similar.length > 0) suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
      throw new CLIError(`Unknown layer "${args.layer}"`, ErrorCategory.USER, suggestions);
    }

    if (!isValidNodeType(args.layer, args.type)) {
      const validNodeTypes = getNodeTypesForLayer(args.layer);
      const typeNames = validNodeTypes.map((t) => t.type).sort();
      const similar = findSimilar(args.type, typeNames, 3);
      const suggestions: string[] = [`Valid types for ${args.layer}: ${formatValidOptions(typeNames)}`];
      if (similar.length > 0) suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
      throw new CLIError(`Invalid element type "${args.type}" for layer "${args.layer}"`, ErrorCategory.USER, suggestions);
    }

    const resolvedType = normalizeNodeType(args.layer, args.type);
    const elementPath = generateElementId(args.layer, resolvedType, args.name);
    const elementUUID = generateUUID();

    const slugPart = elementPath.split(".")[2];
    if (!slugPart) {
      throw new CLIError(`Cannot generate a valid element ID from name "${args.name}"`, ErrorCategory.USER, [
        "Element names must contain at least one letter or digit",
      ]);
    }

    validateSourceReferenceOptions(args);

    const model = await loadModel(args.rootPath);

    let layerObj = await model.getLayer(args.layer);
    if (!layerObj) {
      layerObj = new Layer(args.layer);
      model.addLayer(layerObj);
    }

    const now = new Date().toISOString();
    const element = new Element({
      id: elementUUID,
      path: elementPath,
      spec_node_id: `${args.layer}.${resolvedType}`,
      layer_id: args.layer,
      type: resolvedType,
      name: args.name,
      description: args.description,
      attributes: args.attributes ?? {},
      metadata: {
        created_at: now,
        updated_at: now,
        version: 1,
      },
      layer: args.layer,
    });

    const sourceRef = buildSourceReference(args);
    if (sourceRef) {
      element.setSourceReference(sourceRef);
    }

    {
      const schemaValidator = new SchemaValidator();
      const tempLayer = new Layer(args.layer);
      tempLayer.addElement(element);
      const attrValidation = await schemaValidator.validateLayer(tempLayer);
      if (!attrValidation.isValid()) {
        const errorMessages = attrValidation.errors.map((e) => `  ${e.message}`).join("\n");
        throw new CLIError(`Element ${elementPath} has invalid attributes:\n${errorMessages}`, ErrorCategory.USER, [
          `Use "model_info" with layer "${args.layer}" and the spec resource for "${args.type}" to see the required attributes`,
        ]);
      }
    }

    if (layerObj.getElement(elementPath)) {
      throw new CLIError(`Element ${elementPath} already exists in ${args.layer} layer`, ErrorCategory.USER, [
        `Use "model_show" to view the existing element`,
        `Use "model_update" to modify it`,
        `Use "model_delete" to remove it first if you want to recreate it`,
      ]);
    }

    const mutationHandler = new MutationHandler(model, elementPath, args.layer);
    await mutationHandler.executeAdd(element, (elem) => {
      layerObj!.addElement(elem);
    });

    const stagingManager = mutationHandler.getStagingManager();
    const activeChangeset = await stagingManager.getActive();
    const staged = !!(activeChangeset && activeChangeset.status === "staged");

    return jsonResult({
      status: staged ? "staged" : "added",
      changeset: staged ? activeChangeset!.name : undefined,
      id: elementPath,
      layer: args.layer,
      type: resolvedType,
      name: args.name,
    });
  });
}

export const modelAddTool: McpToolDefinition<ModelAddArgs> = {
  name: "model_add",
  description: "Add a new element to a layer, validated against its spec schema.",
  inputSchema,
  handler: modelAddHandler,
};
