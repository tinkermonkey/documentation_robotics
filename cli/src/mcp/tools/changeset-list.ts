/**
 * changeset_list — list all staged changesets. Mirrors the REST
 * `GET /api/changesets` endpoint (see `ChangesetsListSchema` in
 * `cli/src/server/schemas.ts`).
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { allowedActions, type ChangesetAction, type ChangesetPurpose } from "../../core/changeset-purpose.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  rootPath: rootPathSchema,
};

export type ChangesetListArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function changesetListHandler(args: ChangesetListArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const changesets = await manager.list();
    const activeChangesetId = await manager.getActiveId();

    const changesetsById: Record<
      string,
      {
        name: string;
        status: string;
        created: string;
        changes_count: number;
        purpose: ChangesetPurpose;
        verifies?: string;
        actions: ChangesetAction[];
      }
    > = {};
    for (const changeset of changesets) {
      // What it is for, and so the moves it allows now: a verification record is never committed.
      const { purpose, verifies } = await manager.purposeOf(changeset);
      changesetsById[changeset.id] = {
        name: changeset.name,
        status: changeset.status,
        created: changeset.created,
        changes_count: changeset.changes.length,
        purpose,
        ...(verifies ? { verifies } : {}),
        actions: allowedActions(purpose, changeset.status),
      };
    }

    return jsonResult({
      version: "1.0.0",
      changesets: changesetsById,
      activeChangesetId,
    });
  });
}

export const changesetListTool: McpToolDefinition<typeof inputSchema> = {
  name: "changeset_list",
  description:
    "List all staged changesets, mirroring the REST GET /api/changesets endpoint. Each has its purpose (plan, " +
    "chat, bootstrap, reconcile or verification; a verification record names the plan it verifies) and the " +
    "actions its state allows (commit, discard): a verification record is never committed.",
  inputSchema,
  handler: changesetListHandler,
};
