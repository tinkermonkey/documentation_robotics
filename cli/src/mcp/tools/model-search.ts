/**
 * model_search — search for elements across the model by name/ID substring or
 * source file reference. Mirrors `dr search`.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Element } from "../../core/element.js";
import { getAllLayerIds, isValidLayer } from "../../generated/layer-registry.js";
import { NODE_TYPES } from "../../generated/node-types.js";
import { CLIError, ErrorCategory, findSimilar, formatValidOptions } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

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

export type ModelSearchArgs = z.infer<z.ZodObject<typeof inputSchema>>;

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
    if (!args.query && !args.sourceFile && !args.layer && !args.type) {
      throw new CLIError(
        "At least one of query, sourceFile, layer, or type must be provided",
        ErrorCategory.USER,
        ['Use "model_list" to list all elements without filtering']
      );
    }

    if (args.layer && !isValidLayer(args.layer)) {
      const validLayers = getAllLayerIds();
      const similar = findSimilar(args.layer, validLayers, 3);
      const suggestions: string[] = [`Use a valid layer name: ${formatValidOptions(validLayers)}`];
      if (similar.length > 0) suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
      throw new CLIError(`Unknown layer "${args.layer}"`, ErrorCategory.USER, suggestions);
    }

    if (args.type) {
      const candidateTypes = args.layer
        ? Array.from(NODE_TYPES.values()).filter((t) => t.layer === args.layer)
        : Array.from(NODE_TYPES.values());
      const isKnownType = candidateTypes.some((t) => t.type === args.type);
      if (!isKnownType) {
        const validTypeNames = Array.from(new Set(candidateTypes.map((t) => t.type))).sort();
        const similar = findSimilar(args.type, validTypeNames, 3);
        const suggestions: string[] = [
          args.layer
            ? `Valid types for ${args.layer}: ${formatValidOptions(validTypeNames)}`
            : `Valid types: ${formatValidOptions(validTypeNames)}`,
        ];
        if (similar.length > 0) suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
        throw new CLIError(
          `Unknown element type "${args.type}"${args.layer ? ` for layer "${args.layer}"` : ""}`,
          ErrorCategory.USER,
          suggestions
        );
      }
    }

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

export const modelSearchTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_search",
  description: "Search for elements across the model by name/ID substring or by source file reference.",
  inputSchema,
  handler: modelSearchHandler,
};
