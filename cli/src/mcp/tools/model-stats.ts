/**
 * model_stats — aggregate statistics about the architecture model. Mirrors `dr stats`.
 *
 * Its validation counts are model_validate's: the same pipeline over the same view (the base
 * model, or the active changeset's projection), with the view named (#1214). Orphans are counted
 * by layer and type; model_validate with orphans: true and model_list with orphans: true list them.
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StatsCollector } from "../../core/stats-collector.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { countByLayerAndType, modelView, orphanIds, validateView } from "./model-view.js";

const inputSchema = {
  rootPath: rootPathSchema,
};

export type ModelStatsArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function modelStatsHandler(args: ModelStatsArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const { model: validated, view } = await modelView(model);
    const result = await validateView(validated);
    const validation = {
      isValid: result.isValid(),
      lastValidated: new Date().toISOString(),
      errors: result.errors.length,
      warnings: result.warnings.length,
    };
    const { orphanedElements: _ids, ...stats } = await new StatsCollector(model).collect({ validation });
    const orphans = orphanIds(validated);
    return jsonResult(
      {
        view,
        ...stats,
        orphans: {
          count: orphans.length,
          byLayer: countByLayerAndType(orphans),
          ...(orphans.length > 0 ? { more: "model_validate with orphans: true lists them by id; model_list with orphans: true lists them with names and descriptions." } : {}),
        },
      },
      { compact: true }
    );
  });
}

export const modelStatsTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_stats",
  description:
    "Get aggregate statistics about the architecture model: element counts by layer and type, relationships by " +
    "predicate and layer pair, coverage, orphans counted by layer and type, and whether it validates. With a " +
    "changeset active the numbers are the model as the changeset leaves it (view says which); the validation " +
    "counts are model_validate's.",
  inputSchema,
  handler: modelStatsHandler,
};
