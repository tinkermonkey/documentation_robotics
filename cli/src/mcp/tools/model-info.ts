/**
 * model_info — model or single-layer summary information. Mirrors `dr info`.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

export interface ModelInfoArgs {
  layer?: string;
  rootPath?: string;
}

const inputSchema = {
  layer: z.string().optional().describe("Show details for a single layer instead of the whole-model summary."),
  rootPath: rootPathSchema,
};

export async function modelInfoHandler(args: ModelInfoArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath, args.layer ? { layers: [args.layer] } : {});
    const manifest = model.manifest;

    const modelSummary = {
      name: manifest.name,
      version: manifest.version,
      specVersion: manifest.specVersion,
      description: manifest.description,
      author: manifest.author,
      created: manifest.created,
      modified: manifest.modified,
    };

    if (args.layer) {
      const layer = await model.getLayer(args.layer);
      if (!layer) {
        throw new CLIError(`Layer ${args.layer} not found`, ErrorCategory.NOT_FOUND, [
          'Use "model_info" (without a layer) to see all available layers',
        ]);
      }

      const elements = layer.listElements();
      const elementsByType: Record<string, number> = {};
      for (const element of elements) {
        elementsByType[element.type] = (elementsByType[element.type] || 0) + 1;
      }

      return jsonResult({
        model: modelSummary,
        layer: { name: args.layer, elementCount: elements.length, elementsByType },
      });
    }

    const layerNames = model.getLayerNames();
    const layers: Array<{ name: string; elementCount: number }> = [];
    for (const layerName of layerNames) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;
      layers.push({ name: layerName, elementCount: layer.listElements().length });
    }

    return jsonResult({ model: modelSummary, layers });
  });
}

export const modelInfoTool: McpToolDefinition<ModelInfoArgs> = {
  name: "model_info",
  description: "Get model metadata and a summary of layers (or a single layer's element type breakdown).",
  inputSchema,
  handler: modelInfoHandler,
};
