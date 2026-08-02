/**
 * model_search — search for elements across the model by name/ID substring or
 * source file reference. Mirrors `dr search`.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Element } from "../../core/element.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

export interface ModelSearchArgs {
  query?: string;
  layer?: string;
  type?: string;
  sourceFile?: string;
  rootPath?: string;
}

const inputSchema = {
  query: z
    .string()
    .optional()
    .describe("Text to match against element ID and name (case-insensitive substring). Ignored when sourceFile is set."),
  layer: z.string().optional().describe("Restrict search to a single layer."),
  type: z.string().optional().describe("Restrict search to a single element type."),
  sourceFile: z.string().optional().describe("Find elements whose source_reference points at this file path."),
  rootPath: rootPathSchema,
};

function normalizePath(filePath: string): string {
  return filePath.replace(/^\.\//, "").replace(/\\/g, "/");
}

function matchesSourceFile(element: Element, sourceFilePath: string): boolean {
  const sourceRef = element.getSourceReference();
  if (!sourceRef) return false;

  const normalizedQuery = normalizePath(sourceFilePath);
  return (sourceRef.locations ?? []).some((loc) => normalizePath(loc.file) === normalizedQuery);
}

export async function modelSearchHandler(args: ModelSearchArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const isSourceFileSearch = !!args.sourceFile;
    const queryLower = (args.query ?? "").toLowerCase();

    const results: Array<{
      layer: string;
      id: string;
      type: string;
      name: string;
      description?: string;
      sourceFile?: string;
      sourceSymbol?: string;
    }> = [];

    for (const layerName of model.getLayerNames()) {
      if (args.layer && layerName !== args.layer) continue;

      const layerObj = await model.getLayer(layerName);
      if (!layerObj) continue;

      for (const element of layerObj.listElements()) {
        if (args.type && element.type !== args.type) continue;

        if (isSourceFileSearch) {
          if (!matchesSourceFile(element, args.sourceFile!)) continue;
        } else {
          const displayId = element.path || element.id;
          const idMatch = displayId.toLowerCase().includes(queryLower);
          const nameMatch = element.name.toLowerCase().includes(queryLower);
          if (!idMatch && !nameMatch) continue;
        }

        let sourceFile: string | undefined;
        let sourceSymbol: string | undefined;
        const sourceRef = element.getSourceReference();
        if (sourceRef?.locations && sourceRef.locations.length > 0) {
          sourceFile = sourceRef.locations[0].file;
          sourceSymbol = sourceRef.locations[0].symbol;
        }

        results.push({
          layer: layerName,
          id: element.path || element.id,
          type: element.type,
          name: element.name,
          description: element.description,
          sourceFile,
          sourceSymbol,
        });
      }
    }

    return jsonResult({
      query: args.query ?? "",
      sourceFile: args.sourceFile,
      count: results.length,
      results,
    });
  });
}

export const modelSearchTool: McpToolDefinition<ModelSearchArgs> = {
  name: "model_search",
  description: "Search for elements across the model by name/ID substring or by source file reference.",
  inputSchema,
  handler: modelSearchHandler,
};
