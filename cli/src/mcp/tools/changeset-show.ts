/**
 * changeset_show — show a single changeset's full detail, including its list
 * of changes. Mirrors the REST `GET /api/changesets/:changesetId` endpoint
 * (see `ChangesetDetailSchema` in `cli/src/server/schemas.ts`).
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { summarizeChangeset } from "../../core/changeset-summary.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  changesetId: z.string().describe("Changeset ID or name."),
  detail: z
    .enum(["full", "summary"])
    .optional()
    .describe(
      '"full" (default): every change with its before/after snapshots. "summary": one entry per change ' +
        "(sequence, operation, element id and type or relationship source/predicate/target, and for updates the " +
        "changed field names such as attributes.summary), plus totals per operation, without snapshots."
    ),
  rootPath: rootPathSchema,
};

export type ChangesetShowArgs = z.infer<z.ZodObject<typeof inputSchema>>;

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

    if (args.detail === "summary") {
      const summary = summarizeChangeset(changeset.changes);
      return jsonResult({
        id: changeset.id,
        name: changeset.name,
        description: changeset.description,
        status: changeset.status,
        created: changeset.created,
        modified: changeset.modified,
        detail: "summary",
        totals: summary.totals,
        changes: summary.changes,
      });
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

export const changesetShowTool: McpToolDefinition<typeof inputSchema> = {
  name: "changeset_show",
  description:
    "Show a single changeset's detail including its description, stats, and list of changes. Pass " +
    'detail: "summary" for one compact line per change (operation, element or relationship, changed fields) ' +
    "and totals per operation, without the before/after snapshots.",
  inputSchema,
  handler: changesetShowHandler,
};
