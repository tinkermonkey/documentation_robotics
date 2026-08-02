/**
 * model_reload — force a full, non-lazy reload of the architecture model from
 * disk and report a summary of what was read.
 *
 * Every other MCP tool already loads the model fresh from disk on each call
 * (see `loadModel()` in shared.ts — there is no cross-call cache), so this
 * tool cannot go stale the way the REST/visualization server's long-lived
 * `this.model` field can (see `setupFileWatcher()` in
 * `cli/src/server/server.ts`). It exists for parity with that server's
 * explicit reload behavior and as a way for an MCP client to confirm the
 * current on-disk state after external edits, without guessing which other
 * tool call would trigger a fresh read.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

export interface ModelReloadArgs {
  rootPath?: string;
}

const inputSchema = {
  rootPath: rootPathSchema,
};

export async function modelReloadHandler(args: ModelReloadArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath, { lazyLoad: false });

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

export const modelReloadTool: McpToolDefinition<ModelReloadArgs> = {
  name: "model_reload",
  description: "Force a full reload of the architecture model from disk and report a summary of its current state.",
  inputSchema,
  handler: modelReloadHandler,
};
