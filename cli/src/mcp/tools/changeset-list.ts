/**
 * changeset_list — list the changesets. Mirrors the REST `GET /api/changesets` endpoint (see
 * `ChangesetsListSchema` in `cli/src/server/schemas.ts`), with a status filter and paging.
 *
 * A project that lands every plan grows its list forever, so the default lists the staged
 * changesets only and counts every changeset by status (#1250); `status` lists the committed, the
 * discarded or all of them. A list longer than a page is paged (`limit`, `offset`) with its true
 * total and the call for the next page. Newest first.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Changeset } from "../../core/changeset.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { allowedActions, type ChangesetAction, type ChangesetPurpose } from "../../core/changeset-purpose.js";
import { nextPageHint, pageOf, pagingFields } from "../../core/paging.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

/** Changesets listed in one call by default. */
export const CHANGESET_LIST_LIMIT = 50;

const STATUSES = ["staged", "committed", "discarded", "recorded"] as const;

const inputSchema = {
  status: z
    .enum([...STATUSES, "all"])
    .optional()
    .describe(
      'Which changesets to list: "staged" (default: the ones still open), "committed", "discarded", "recorded" (verification records whose plan landed) or "all". ' +
        "counts always has every changeset by status."
    ),
  ...pagingFields("changesets", String(CHANGESET_LIST_LIMIT)),
  rootPath: rootPathSchema,
};

export type ChangesetListArgs = z.infer<z.ZodObject<typeof inputSchema>>;

interface ListedChangeset {
  name: string;
  status: string;
  created: string;
  changes_count: number;
  purpose: ChangesetPurpose;
  verifies?: string;
  actions: ChangesetAction[];
}

/** Newest first; the id breaks a tie, so the pages of one list never overlap. */
function newestFirst(a: Changeset, b: Changeset): number {
  return (b.created ?? "").localeCompare(a.created ?? "") || (a.id ?? "").localeCompare(b.id ?? "");
}

export async function changesetListHandler(args: ChangesetListArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const changesets = await manager.list();
    const activeChangesetId = await manager.getActiveId();
    const status = args.status ?? "staged";

    const counts: Record<string, number> = { staged: 0, committed: 0, discarded: 0, recorded: 0 };
    for (const changeset of changesets) counts[changeset.status] = (counts[changeset.status] ?? 0) + 1;

    const matching = changesets.filter((c) => status === "all" || c.status === status).sort(newestFirst);
    const { items, page } = pageOf(matching, { limit: args.limit, offset: args.offset }, CHANGESET_LIST_LIMIT);

    const changesetsById: Record<string, ListedChangeset> = {};
    for (const changeset of items) {
      // What it is for, and so the moves it allows now: a record (verification or upgrade) is never committed.
      const { purpose, verifies } = await manager.purposeOf(changeset);
      changesetsById[changeset.id!] = {
        name: changeset.name,
        status: changeset.status,
        created: changeset.created,
        changes_count: changeset.changes.length,
        purpose,
        ...(verifies ? { verifies } : {}),
        actions: allowedActions(purpose, changeset.status),
      };
    }

    const notes: string[] = [];
    const next = nextPageHint("changeset_list", `${status === "all" ? "" : `${status} `}changesets`, page, { ...args });
    if (next) notes.push(next);
    const others = STATUSES.filter((s) => status !== "all" && s !== status && counts[s] > 0);
    if (others.length > 0) {
      notes.push(
        `Not listed: ${others.map((s) => `${counts[s]} ${s}`).join(", ")} (counts has them all); ` +
          'status: "committed", "discarded", "recorded" or "all" lists them.'
      );
    }

    return jsonResult({
      version: "1.0.0",
      status,
      counts,
      changesets: changesetsById,
      activeChangesetId,
      page,
      ...(notes.length > 0 ? { more: notes.join(" ") } : {}),
    });
  });
}

export const changesetListTool: McpToolDefinition<typeof inputSchema> = {
  name: "changeset_list",
  description:
    "List the changesets, newest first: by default the staged ones (still open), with counts of every changeset " +
    'by status; status: "committed", "discarded", "recorded" (verification records whose plan landed: kept, not staged work) or "all" lists those. Each has its purpose (plan, chat, ' +
    "bootstrap, reconcile, verification or upgrade-record; a verification record names the plan it verifies; an " +
    "upgrade record lists the relationships a spec migration dropped) and the actions its state allows (commit, " +
    "discard): a verification record or an upgrade record is never committed. " +
    `${CHANGESET_LIST_LIMIT} a page (limit, offset): page.total is the true count and more names the next call.`,
  inputSchema,
  handler: changesetListHandler,
};
