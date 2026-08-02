/**
 * changeset_show — show a single changeset's full detail, including its list
 * of changes. Mirrors the REST `GET /api/changesets/:changesetId` endpoint
 * (see `ChangesetDetailSchema` in `cli/src/server/schemas.ts`).
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

export interface ChangesetShowArgs {
  changesetId: string;
  rootPath?: string;
}

const inputSchema = {
  changesetId: z.string().describe("Changeset ID or name."),
  rootPath: rootPathSchema,
};

export async function changesetShowHandler(args: ChangesetShowArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const changeset = await manager.load(args.changesetId);

    if (!changeset) {
      throw new CLIError(`Changeset ${args.changesetId} not found`, ErrorCategory.NOT_FOUND, [
        'Use "changeset_list" to see all available changesets',
      ]);
    }

    return jsonResult({
      id: changeset.id,
      name: changeset.name,
      description: changeset.description,
      status: changeset.status,
      created: changeset.created,
      modified: changeset.modified,
      baseSnapshot: changeset.baseSnapshot,
      stats: changeset.stats,
      changes: changeset.changes,
    });
  });
}

export const changesetShowTool: McpToolDefinition<ChangesetShowArgs> = {
  name: "changeset_show",
  description: "Show a single changeset's full detail including its description, stats, and list of changes.",
  inputSchema,
  handler: changesetShowHandler,
};
