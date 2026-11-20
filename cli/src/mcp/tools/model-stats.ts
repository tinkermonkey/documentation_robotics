/**
 * model_stats — aggregate statistics about the architecture model. Mirrors `dr stats`.
 *
 * Its validation counts are model_validate's: the same pipeline over the same view (the base
 * model, or the active changeset's projection), with the view named (#1214). Orphans are counted
 * by layer and type; model_validate with orphans: true and model_list with orphans: true list them.
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Model } from "../../core/model.js";
import { StatsCollector, type ValidationInfo } from "../../core/stats-collector.js";
import { getErrorMessage } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { countByLayerAndType, modelView, orphanIds, validateView, type ModelViewName } from "./model-view.js";

const inputSchema = {
  rootPath: rootPathSchema,
};

export type ModelStatsArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function modelStatsHandler(args: ModelStatsArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const lastValidated = new Date().toISOString();

    // A view that can't be built or validated (a changeset that fails to project, a validator that
    // throws) must not cost the caller the statistics: they are returned with the sentinel
    // `errors: -1`, as StatsCollector reports a validation it could not run, and the reason.
    let validated: Model | null = null;
    let view: ModelViewName | { model: "unknown"; note: string };
    let validation: ValidationInfo & { error?: string };
    try {
      const built = await modelView(model);
      const result = await validateView(built.model);
      validated = built.model;
      view = built.view;
      validation = {
        isValid: result.isValid(),
        lastValidated,
        errors: result.errors.length,
        warnings: result.warnings.length,
      };
    } catch (error) {
      const reason = getErrorMessage(error);
      console.error(`[mcp] model_stats: validation could not run: ${reason}`);
      view = { model: "unknown", note: "The model's view could not be built or validated; the statistics are as loaded." };
      validation = { isValid: false, lastValidated, errors: -1, warnings: 0, error: reason };
    }

    const { orphanedElements, ...stats } = await new StatsCollector(model).collect({ validation });
    // The same orphans model_validate reports; StatsCollector's own when the view is unknown.
    const orphans = validated ? orphanIds(validated) : orphanedElements;
    return jsonResult(
      {
        view,
        ...stats,
        orphans: {
          count: orphans.length,
          byLayer: countByLayerAndType(orphans),
          ...(orphans.length > 0
            ? {
                more:
                  "Counts of all of them. model_list with orphans: true lists them with names and descriptions, and " +
                  "model_validate with orphans: true by id; both page with limit and offset, and layer narrows them.",
              }
            : {}),
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
    "counts are model_validate's (errors: -1 with an error when validation could not run).",
  inputSchema,
  handler: modelStatsHandler,
};
