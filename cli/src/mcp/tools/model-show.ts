/**
 * model_show — show a single element with its relationships. Mirrors `dr show`.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

export interface ModelShowArgs {
  id: string;
  rootPath?: string;
}

const inputSchema = {
  id: z.string().describe("Element ID or path (e.g. 'api.operation.create-order')."),
  rootPath: rootPathSchema,
};

export async function modelShowHandler(args: ModelShowArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);

    const layerName = await findElementLayer(model, args.id);
    if (!layerName) {
      throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, [
        'Use "model_search" to find similar elements',
        'Use "model_list" to list all elements in a layer',
      ]);
    }

    const layer = await model.getLayer(layerName);
    const element = layer?.getElement(args.id);
    if (!layer || !element) {
      throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, [
        'Use "model_search" to find similar elements',
        'Use "model_list" to list all elements in a layer',
      ]);
    }

    const elementId = element.path || element.id;
    const { outgoing, incoming } = model.relationships.getForElement(elementId);

    return jsonResult({
      layer: layerName,
      element: element.toJSON(),
      relationships: { outgoing, incoming },
    });
  });
}

export const modelShowTool: McpToolDefinition<ModelShowArgs> = {
  name: "model_show",
  description: "Show a single element's full details, attributes, and relationships.",
  inputSchema,
  handler: modelShowHandler,
};
