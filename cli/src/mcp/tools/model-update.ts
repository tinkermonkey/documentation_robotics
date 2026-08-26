/**
 * model_update — update an existing element. Mirrors `dr update`, operating
 * through the shared MutationHandler.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Element } from "../../core/element.js";
import { Layer } from "../../core/layer.js";
import { MutationHandler } from "../../core/mutation-handler.js";
import { getNodeTypesForLayer, isValidNodeType, normalizeNodeType } from "../../generated/node-types.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { buildSourceReference, validateSourceReferenceOptions } from "../../utils/source-reference.js";
import { SchemaValidator } from "../../validators/schema-validator.js";
import { CLIError, ErrorCategory, findSimilar, formatValidOptions } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  id: z.string().describe("Element ID or path to update."),
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional().describe("New element type within the current layer."),
  attributes: z.record(z.string(), z.unknown()).optional().describe("Replaces the element's attributes, validated against its spec schema."),
  sourceFile: z.string().optional(),
  sourceSymbol: z.string().optional(),
  sourceProvenance: z.enum(["extracted", "manual", "inferred", "generated"]).optional(),
  sourceRepoRemote: z.string().optional(),
  sourceRepoCommit: z.string().optional().describe("Full 40-character Git commit SHA."),
  clearSourceReference: z.boolean().optional().describe("Remove the element's source reference. Cannot be combined with other source options."),
  rootPath: rootPathSchema,
};

export type ModelUpdateArgs = z.infer<z.ZodObject<typeof inputSchema>>;

function validateUpdateSourceReferenceOptions(args: ModelUpdateArgs): void {
  const hasSourceOptions =
    args.sourceFile || args.sourceSymbol || args.sourceProvenance || args.sourceRepoRemote || args.sourceRepoCommit;

  if (args.clearSourceReference && hasSourceOptions) {
    throw new CLIError("Cannot use clearSourceReference with other source reference options", ErrorCategory.USER, [
      "Specify either clearSourceReference or other source options, not both",
    ]);
  }

  if (hasSourceOptions) {
    validateSourceReferenceOptions(args);
  }
}

export async function modelUpdateHandler(args: ModelUpdateArgs): Promise<CallToolResult> {
  return runTool(async () => {
    validateUpdateSourceReferenceOptions(args);

    const model = await loadModel(args.rootPath);

    const layerName = await findElementLayer(model, args.id);
    if (!layerName) {
      throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, [
        'Use "model_search" to find similar elements',
      ]);
    }

    const layer = await model.getLayer(layerName);
    const element = layer?.getElement(args.id);
    if (!layer || !element) {
      throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, [
        'Use "model_search" to find similar elements',
      ]);
    }

    const hasUpdates =
      args.name ||
      args.description !== undefined ||
      args.type ||
      args.attributes ||
      args.sourceFile ||
      args.sourceSymbol ||
      args.sourceProvenance ||
      args.sourceRepoRemote ||
      args.sourceRepoCommit ||
      args.clearSourceReference;

    if (!hasUpdates) {
      return jsonResult({ status: "no-op", id: args.id, message: "No fields specified for update" });
    }

    const mutationHandler = new MutationHandler(model, args.id, layerName);

    await mutationHandler.executeUpdate(element, async (elem, after) => {
      let resolvedNewType: string | undefined;
      if (args.type) {
        if (!isValidNodeType(layerName, args.type)) {
          const validNodeTypes = getNodeTypesForLayer(layerName);
          const typeNames = validNodeTypes.map((t) => t.type).sort();
          const similar = findSimilar(args.type!, typeNames, 3);
          const suggestions: string[] = [`Valid types for ${layerName}: ${formatValidOptions(typeNames)}`];
          if (similar.length > 0) suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
          throw new CLIError(`Invalid element type "${args.type}" for layer "${layerName}"`, ErrorCategory.USER, suggestions);
        }
        resolvedNewType = normalizeNodeType(layerName, args.type);
      }

      if (resolvedNewType || args.attributes) {
        const candidateType = resolvedNewType ?? elem.type;
        const tempElem = new Element({
          ...elem.toJSON(),
          type: candidateType,
          spec_node_id: `${layerName}.${candidateType}`,
          attributes: args.attributes ?? elem.attributes,
        });
        const schemaValidator = new SchemaValidator();
        const tempLayer = new Layer(layerName);
        tempLayer.addElement(tempElem);
        const attrValidation = await schemaValidator.validateLayer(tempLayer);
        if (!attrValidation.isValid()) {
          const errorMessages = attrValidation.errors.map((e) => `  ${e.message}`).join("\n");
          throw new CLIError(`Updated attributes fail schema validation:\n${errorMessages}`, ErrorCategory.USER, [
            `Use the spec resource for "${candidateType}" to see the required attributes`,
          ]);
        }
      }

      if (resolvedNewType) {
        elem.type = resolvedNewType;
        after.type = resolvedNewType;
        elem.spec_node_id = `${layerName}.${resolvedNewType}`;
        after.spec_node_id = `${layerName}.${resolvedNewType}`;
      }

      if (args.name) {
        elem.name = args.name;
        after.name = args.name;
      }

      if (args.description !== undefined) {
        elem.description = args.description || undefined;
        after.description = args.description || undefined;
      }

      if (args.attributes) {
        elem.attributes = args.attributes;
        after.attributes = args.attributes;
      }

      const hasSourceReferenceUpdate =
        args.sourceFile || args.sourceSymbol || args.sourceProvenance || args.sourceRepoRemote || args.sourceRepoCommit;

      if (args.clearSourceReference) {
        elem.setSourceReference(undefined);
        after.sourceReference = undefined;
      } else if (hasSourceReferenceUpdate) {
        const newRef = buildSourceReference(args);
        if (newRef) {
          elem.setSourceReference(newRef);
          after.sourceReference = newRef;
        }
      }

      layer.updateElement(elem);
    });

    const stagingManager = mutationHandler.getStagingManager();
    const activeChangeset = await stagingManager.getActive();
    const staged = !!(activeChangeset && activeChangeset.status === "staged");

    return jsonResult({
      status: staged ? "staged" : "updated",
      changeset: staged ? activeChangeset!.name : undefined,
      id: args.id,
      layer: layerName,
    });
  });
}

export const modelUpdateTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_update",
  description: "Update an existing element's name, description, type, attributes, or source reference.",
  inputSchema,
  handler: modelUpdateHandler,
};
