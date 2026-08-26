/**
 * model_stats — aggregate statistics about the architecture model. Mirrors `dr stats`.
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StatsCollector } from "../../core/stats-collector.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  rootPath: rootPathSchema,
};

export type ModelStatsArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function modelStatsHandler(args: ModelStatsArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const collector = new StatsCollector(model);
    const stats = await collector.collect();
    return jsonResult(stats);
  });
}

export const modelStatsTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_stats",
  description: "Get aggregate statistics about the architecture model: element counts, relationships, coverage, and orphans.",
  inputSchema,
  handler: modelStatsHandler,
};
