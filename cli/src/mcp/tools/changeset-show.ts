/**
 * changeset_show — show a single changeset: its description, purpose and review, counts of its
 * changes, and the changes themselves. Mirrors the REST `GET /api/changesets/:changesetId` endpoint
 * (see `ChangesetDetailSchema` in `cli/src/server/schemas.ts`).
 *
 * Compact by default (#1257): counts per operation and per layer over the whole changeset, and one
 * line per change (`changeLine`). `layers`, `types` and `operations` narrow the changes listed
 * (#1294), and every form is a page (`limit`, `offset`) with the true total and the next call, so a
 * changeset of thousands of changes reads a page at a time and never as complete when it is not.
 * `detail: "summary"` gives one object per change; `detail: "full"` each change whole, with its
 * before and after snapshots. The answer is built by changesetShowView (core/changeset-show-view.ts),
 * which `dr changeset show --json` shares.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { changesetShowView, SHOW_LIMITS } from "../../core/changeset-show-view.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { changesetArg, changesetArgFields } from "./changeset-shared.js";

export { SHOW_LIMITS };

const OPERATIONS = ["add", "update", "delete", "relationship-add", "relationship-delete"] as const;

const inputSchema = {
  ...changesetArgFields("Changeset ID or name. Required."),
  detail: z
    .enum(["compact", "summary", "full"])
    .optional()
    .describe(
      '"compact" (default): one line per change, "#sequence operation id (changed fields)" for an element and ' +
        '"#sequence operation source --predicate--> target" for a relationship, with who decided it in brackets for ' +
        `the changes codebase_extract staged; ${SHOW_LIMITS.compact} a page. "summary": one object per change (sequence, ` +
        "operation, layer, element id and type or relationship source/predicate/target, and for updates the changed " +
        `field names such as attributes.summary), ${SHOW_LIMITS.summary} a page. "full": every change with its before/after ` +
        `snapshots and the changeset's stats and base snapshot, ${SHOW_LIMITS.full} a page. totals and byLayer count the ` +
        "whole changeset in every form."
    ),
  layers: z
    .array(z.string())
    .optional()
    .describe("Only the changes to elements in these layers (a relationship change when either end is in one)."),
  types: z
    .array(z.string())
    .optional()
    .describe(
      'Only the changes to elements of these types, as "applicationservice" or "application.applicationservice" ' +
        "(a relationship change when either end is one). With layers, both apply."
    ),
  operations: z
    .array(z.enum(OPERATIONS))
    .optional()
    .describe("Only these operations (add, update, delete, relationship-add, relationship-delete)."),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `The most changes to list in one call (default ${SHOW_LIMITS.compact} compact, ${SHOW_LIMITS.summary} summary, ` +
        `${SHOW_LIMITS.full} full). A page size, not a cut-off: page.total is the true count and page.nextOffset the next page.`
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Skip this many changes: repeat the call with the same arguments and the previous result's page.nextOffset."),
  rootPath: rootPathSchema,
};

export type ChangesetShowArgs = z.infer<z.ZodObject<typeof inputSchema>>;


export async function changesetShowHandler(args: ChangesetShowArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const named = changesetArg(args, { required: true });
    const changeset = await manager.load(named);

    if (!changeset) {
      throw new CLIError(`Changeset ${named} not found`, ErrorCategory.NOT_FOUND, [
        'Use "changeset_list" to see the staged changesets (status: "all" lists every one)',
      ]);
    }

    const view = await changesetShowView(manager, changeset, args);
    return jsonResult(view, { compact: (args.detail ?? "compact") === "compact" });
  });
}

export const changesetShowTool: McpToolDefinition<typeof inputSchema> = {
  name: "changeset_show",
  description:
    "Show a single changeset: its description, totals per operation and per layer, and its changes, compact by " +
    'default (one line per change: "#sequence operation id (changed fields)" or "#sequence operation source ' +
    '--predicate--> target"). detail: "summary" gives one object per change (operation, element or relationship, ' +
    'changed fields); detail: "full" every change with its before/after snapshots. layers, types and operations ' +
    "narrow the changes listed; every form is a page (limit, offset) with page.total the true count and more " +
    "naming the next call. Includes its purpose (plan, chat, bootstrap, reconcile, verification or upgrade-record, " +
    "with verifies and scope for a verification record) and the actions its state allows (commit, discard; a " +
    "verification record or an upgrade record is never committed). An upgrade record (written by project_upgrade " +
    "or dr upgrade) lists the relationships a spec migration dropped as staged relationship deletes, each with the " +
    "retired type and change record in origin; its description lists the types the catalog still has between the " +
    "same element types. Includes the revision and, when the reviewer has given verdicts in the viewer, " +
    "review.decisions: per change (sequence) keep, drop or ask with the reviewer's note; current is false when the " +
    "change was rewritten or unstaged since the verdict.",
  inputSchema,
  handler: changesetShowHandler,
};
