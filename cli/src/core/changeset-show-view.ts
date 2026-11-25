/**
 * One changeset as changeset_show answers it (#1257, #1294): its head, purpose and review, the
 * counts over all its changes per operation and per layer, and a page of the changes, narrowed by
 * layers, types and operations, as one line each (compact), one object each (summary) or whole
 * (full). `dr changeset show --json` returns the same object (#1219), so the CLI and the tool
 * answer alike.
 */

import type { Change, Changeset, StagedChange } from "./changeset.js";
import type { StagingAreaManager } from "./staging-area.js";
import { changeLine, summarizeChange, summarizeChangeset, type ChangeSummaryEntry } from "./changeset-summary.js";
import { reviewForAgent, reviewRevision } from "./changeset-review.js";
import { allowedActions } from "./changeset-purpose.js";
import { elementFilter, unknownFilterNote } from "./element-filter.js";
import { nextPageHint, pageOf } from "./paging.js";

/** Changes listed per page by default, per detail: about 20 KB of lines, objects or snapshots. */
export const SHOW_LIMITS = { compact: 200, summary: 100, full: 25 } as const;

/** Changes per operation, for each layer that has any, in the order layers first appear. */
function countsByLayer(entries: ChangeSummaryEntry[]): Record<string, Record<string, number>> {
  const byLayer: Record<string, Record<string, number>> = {};
  for (const entry of entries) {
    const layer = (byLayer[entry.layer] ??= {});
    layer[entry.operation] = (layer[entry.operation] ?? 0) + 1;
  }
  return byLayer;
}

/**
 * What changesetShowView reads from a call: the detail, the filters and the page. The rest of the
 * call's arguments (the changeset, rootPath) are named again in the next-page hint.
 */
export interface ChangesetShowViewArgs {
  detail?: "compact" | "summary" | "full";
  layers?: string[];
  types?: string[];
  operations?: string[];
  limit?: number;
  offset?: number;
  [argument: string]: unknown;
}

/**
 * changeset_show's answer for one changeset, as an object: its head, purpose and review, the
 * counts over all its changes, and a page of them in the form `detail` asks for. `dr changeset
 * show --json` returns the same object (detail "summary", every change on one page), so the CLI
 * and the tool answer alike (#1219).
 */
export async function changesetShowView(
  manager: StagingAreaManager,
  changeset: Changeset,
  args: ChangesetShowViewArgs
): Promise<Record<string, unknown>> {
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
    return {
      ...head,
      baseSnapshot: changeset.baseSnapshot,
      stats: changeset.stats,
      ...reviewFields,
      ...counts,
      changes: items.map((r) => r.change),
      ...tail,
    };
  }
  return {
    ...head,
    detail,
    ...reviewFields,
    ...counts,
    changes: detail === "summary" ? items.map((r) => r.entry) : items.map((r) => changeLine(r.entry)),
    ...tail,
  };
}
