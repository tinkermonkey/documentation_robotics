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
 * before and after snapshots.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Change, StagedChange } from "../../core/changeset.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { changeLine, summarizeChange, summarizeChangeset, type ChangeSummaryEntry } from "../../core/changeset-summary.js";
import { reviewForAgent, reviewRevision } from "../../core/changeset-review.js";
import { allowedActions } from "../../core/changeset-purpose.js";
import { elementFilter, unknownFilterNote } from "../../core/element-filter.js";
import { nextPageHint, pageOf } from "../../core/paging.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { changesetArg, changesetArgFields } from "./changeset-shared.js";

/** Changes listed per page by default, per detail: about 20 KB of lines, objects or snapshots. */
export const SHOW_LIMITS = { compact: 200, summary: 100, full: 25 } as const;

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

/** Changes per operation, for each layer that has any, in the order layers first appear. */
function countsByLayer(entries: ChangeSummaryEntry[]): Record<string, Record<string, number>> {
  const byLayer: Record<string, Record<string, number>> = {};
  for (const entry of entries) {
    const layer = (byLayer[entry.layer] ??= {});
    layer[entry.operation] = (layer[entry.operation] ?? 0) + 1;
  }
  return byLayer;
}

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

    // The reviewer's verdicts from the viewer: which changes to keep, drop, or ask about (with the
    // note), and whether each still applies to the change as staged now.
    const review = reviewForAgent(changeset, changeset.review);
    // What it is for (a verification record also names its plan and scope), and the moves it allows.
    const { purpose, verifies, scope } = await manager.purposeOf(changeset);
    const reviewFields = {
      revision: reviewRevision(changeset),
      ...(changeset.origin ? { origin: changeset.origin } : {}),
      purpose,
      ...(verifies ? { verifies } : {}),
      ...(scope ? { scope } : {}),
      actions: allowedActions(purpose, changeset.status),
      ...(review ? { review } : {}),
    };

    const detail = args.detail ?? "compact";
    // Every change with its summary, in sequence order; the filter reads the summary.
    const changes = changeset.changes as Array<Change | StagedChange>;
    const rows = changes
      .map((change, index) => ({ change, entry: summarizeChange(change, index) }))
      .sort((a, b) => a.entry.sequence - b.entry.sequence);
    const totals = summarizeChangeset(changes).totals;
    const byLayer = countsByLayer(rows.map((r) => r.entry));

    const filter = elementFilter({ layers: args.layers, types: args.types });
    const operations = args.operations?.length ? new Set<string>(args.operations) : undefined;
    const keepsEnd = (id: string | undefined) => id !== undefined && filter.keeps(id);
    const kept = rows.filter(({ entry }) => {
      if (operations && !operations.has(entry.operation)) return false;
      if (!filter.active) return true;
      if (entry.source !== undefined) return keepsEnd(entry.source) || keepsEnd(entry.target);
      const type = entry.elementType ?? entry.elementId?.split(".")[1] ?? "";
      return filter.keepsLayerType(entry.layer, type);
    });
    const narrowed = filter.active || !!operations;

    const { items, page } = pageOf(kept, { limit: args.limit, offset: args.offset }, SHOW_LIMITS[detail]);
    const notes: string[] = [];
    const unknown = unknownFilterNote(filter);
    if (unknown) notes.push(unknown);
    const next = nextPageHint("changeset_show", narrowed ? "matching changes" : "changes", page, { ...args });
    if (next) notes.push(next);
    if (detail === "compact") {
      notes.push(
        'One line per change. detail: "summary" gives each as an object, detail: "full" with its before and after ' +
          "snapshots; layers, types and operations narrow the list. changeset_brief is the plan's spec, with connections."
      );
    }

    const head = {
      id: changeset.id,
      name: changeset.name,
      description: changeset.description,
      status: changeset.status,
      created: changeset.created,
      modified: changeset.modified,
    };
    const counts = {
      totals,
      byLayer,
      ...(narrowed
        ? { filter: { ...filter.applied, ...(operations ? { operations: [...operations] } : {}) }, matched: kept.length }
        : {}),
    };
    const tail = { page, ...(notes.length > 0 ? { more: notes.join(" ") } : {}) };

    if (detail === "full") {
      return jsonResult({
        ...head,
        baseSnapshot: changeset.baseSnapshot,
        stats: changeset.stats,
        ...reviewFields,
        ...counts,
        changes: items.map((r) => r.change),
        ...tail,
      });
    }
    return jsonResult(
      {
        ...head,
        detail,
        ...reviewFields,
        ...counts,
        changes: detail === "summary" ? items.map((r) => r.entry) : items.map((r) => changeLine(r.entry)),
        ...tail,
      },
      { compact: detail === "compact" }
    );
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
