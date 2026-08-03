/**
 * model_reload — force a full, non-lazy reload of the architecture model from
 * disk and report a summary of what was read.
 *
 * Per the architecture design's Model Lifecycle, `loadModel()` (shared.ts) loads
 * the model once per rootPath and holds it in memory for reuse across tool calls,
 * the same way the REST/visualization server holds a long-lived `this.model` field
 * (see `setupFileWatcher()` in `cli/src/server/server.ts`). That cache can go stale
 * after edits made outside this MCP session (e.g. the CLI or another process editing
 * files on disk), so this tool exists to force a fresh read and refresh the cache —
 * the MCP equivalent of that server's file-watcher-triggered reload.
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { jsonResult, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  rootPath: rootPathSchema,
};

export type ModelReloadArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function modelReloadHandler(args: ModelReloadArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await reloadModel(args.rootPath);

    const layers: Array<{ name: string; elementCount: number }> = [];
    for (const layerName of model.getLayerNames()) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;
      layers.push({ name: layerName, elementCount: layer.listElements().length });
    }

    return jsonResult({
      status: "reloaded",
      model: {
        name: model.manifest.name,
        version: model.manifest.version,
        modified: model.manifest.modified,
      },
      layers,
      totalElements: layers.reduce((sum, layer) => sum + layer.elementCount, 0),
    });
  });
}

export const modelReloadTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_reload",
  description: "Force a full reload of the architecture model from disk and report a summary of its current state.",
  inputSchema,
  handler: modelReloadHandler,
};
