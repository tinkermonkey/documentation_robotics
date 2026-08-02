/**
 * changeset_list — list all staged changesets. Mirrors the REST
 * `GET /api/changesets` endpoint (see `ChangesetsListSchema` in
 * `cli/src/server/schemas.ts`).
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

export interface ChangesetListArgs {
  rootPath?: string;
}

const inputSchema = {
  rootPath: rootPathSchema,
};

export async function changesetListHandler(args: ChangesetListArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const changesets = await manager.list();
    const activeChangesetId = await manager.getActiveId();

    const changesetsById: Record<
      string,
      { name: string; status: string; created: string; changes_count: number }
    > = {};
    for (const changeset of changesets) {
      changesetsById[changeset.id] = {
        name: changeset.name,
        status: changeset.status,
        created: changeset.created,
        changes_count: changeset.changes.length,
      };
    }

    return jsonResult({
      version: "1.0.0",
      changesets: changesetsById,
      activeChangesetId,
    });
  });
}

export const changesetListTool: McpToolDefinition<ChangesetListArgs> = {
  name: "changeset_list",
  description: "List all staged changesets, mirroring the REST GET /api/changesets endpoint.",
  inputSchema,
  handler: changesetListHandler,
};
