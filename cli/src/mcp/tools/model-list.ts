/**
 * model_list — list elements in the architecture model, optionally scoped to
 * a single layer and/or element type. Mirrors `dr list`.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CANONICAL_LAYER_NAMES } from "../../core/layers.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

export interface ModelListArgs {
  layer?: string;
  type?: string;
  rootPath?: string;
}

const inputSchema = {
  layer: z
    .string()
    .optional()
    .describe("Canonical layer name to list (e.g. 'api', 'data-model'). Omit to list across all layers."),
  type: z.string().optional().describe("Restrict results to a single element type."),
  rootPath: rootPathSchema,
};

export async function modelListHandler(args: ModelListArgs): Promise<CallToolResult> {
  return runTool(async () => {
    if (args.layer) {
      const model = await loadModel(args.rootPath, { layers: [args.layer] });
      const layer = await model.getLayer(args.layer);
      if (!layer) {
        throw new CLIError(`Layer ${args.layer} not found`, ErrorCategory.NOT_FOUND, [
          'Use "model_info" to see all available layers',
        ]);
      }

      let elements = layer.listElements();
      if (args.type) {
        elements = elements.filter((e) => e.type === args.type);
      }

      return jsonResult({
        layer: args.layer,
        count: elements.length,
        elements: elements.map((e) => e.toJSON()),
      });
    }

    const model = await loadModel(args.rootPath);
    const layers: Array<{ layer: string; count: number; elements: unknown[] }> = [];

    for (const layerName of CANONICAL_LAYER_NAMES) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      let elements = layer.listElements();
      if (args.type) {
        elements = elements.filter((e) => e.type === args.type);
      }

      if (elements.length > 0) {
        layers.push({
          layer: layerName,
          count: elements.length,
          elements: elements.map((e) => e.toJSON()),
        });
      }
    }

    return jsonResult({
      layers,
      totalElements: layers.reduce((sum, l) => sum + l.count, 0),
    });
  });
}

export const modelListTool: McpToolDefinition<ModelListArgs> = {
  name: "model_list",
  description:
    "List elements in the architecture model, optionally scoped to a layer and/or element type.",
  inputSchema,
  handler: modelListHandler,
};
