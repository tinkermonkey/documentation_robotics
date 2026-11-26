/**
 * changeset_update, changeset_unstage, changeset_discard — revise a staged changeset while
 * planning a change. Mirror `dr changeset unstage|discard` and add the rename / re-describe step
 * the CLI has no command for, all through StagingAreaManager.
 *
 * Every mutation reloads the cached model afterwards, like changeset-lifecycle.ts: the model
 * projects the active changeset's elements at load time, and the projection cache is keyed by
 * what is staged.
 *
 * Landing a change is the human's step: changeset_commit (changeset-commit.ts) asks a person to
 * confirm it. Discard is exposed because an agent must be able to abandon its own plan, but it
 * clears the staged changes for good, so it needs `confirm: true`. See docs/CHANGE_MODELING.md.
 */

import { z } from "zod";
import { strictItem } from "../strict-schema.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DRIFT_LIST_LIMIT, type ChangesetDrift } from "../../core/changeset-base-index.js";
import { ChangesetGraph, changesetRevision } from "../../core/changeset-graph.js";
import { Model } from "../../core/model.js";
import type { Changeset, StagedChange } from "../../core/changeset.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { stagedRelationshipChangesAtEnds, stagedRelationshipTriple } from "../../core/relationship-staging.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { changesetArg, changesetArgFields, intentArg, intentFields, resolveChangeset } from "./changeset-shared.js";
import { unstageDetailField, unstagedNotListedNote, unstagedReport } from "./unstage-report.js";

const changesetFields = changesetArgFields("Changeset ID or name. Defaults to the active changeset.");

function requireStaged(changeset: Changeset, action: string): void {
  if (changeset.status !== "staged") {
    throw new CLIError(`Changeset '${changeset.name}' is ${changeset.status}; cannot ${action}`, ErrorCategory.USER, [
      'Use "changeset_list" to find a staged changeset, or "changeset_create" to start a new one',
    ]);
  }
}

/** Wraps a StagingAreaManager error (plain Error) as a user error the agent can act on. */
async function asUserError<T>(fn: () => Promise<T>, suggestions: string[]): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof CLIError) throw error;
    throw new CLIError(getErrorMessage(error), ErrorCategory.USER, suggestions);
  }
}

// ---------------------------------------------------------------------------
// changeset_update
// ---------------------------------------------------------------------------

const updateInputSchema = {
  ...changesetFields,
  name: z.string().min(1).optional().describe("New name. Must not be another changeset's name."),
  ...intentFields("The new intent: what the change is for and what done looks like. An empty string clears it."),
  rebaseline: z
    .union([z.boolean(), z.literal("preview")])
    .optional()
    .describe(
      "true: make the base model as it is now this changeset's base, and return what moved under it since its " +
        "previous base. \"preview\": return the same and write nothing; do this first when much has moved, since " +
        "what moved can't be read again after a re-baseline. Use it once you have read what the base changed and the " +
        "plan still stands. It clears the list of base changes, and nothing a landing would do: an overlap that is " +
        "true against the base as it is now stays until the plan resolves it (each one's resolve says how), and the " +
        "landing summary still lists it and says the changeset was re-baselined. Staged changes are untouched."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      `With rebaseline: how many entries of each list of what moved to return (default ${DRIFT_LIST_LIMIT}; no upper ` +
        "bound, so a large value returns everything). Counts, layers and overlaps are whole whatever the limit."
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("With rebaseline: \"preview\": where in each list of what moved to start (default 0); pass page.nextOffset to go on."),
  rootPath: rootPathSchema,
};

export type ChangesetUpdateArgs = z.infer<z.ZodObject<typeof updateInputSchema>>;

/** The overlaps of a drift description as one list, relationships named by their triple. */
function overlapList(drift: ChangesetDrift): Array<Record<string, unknown>> {
  return [
    ...drift.overlapping.elements.map((e) => ({ element: e.id, reason: e.reason, consequence: e.consequence, resolve: e.resolve })),
    ...drift.overlapping.relationships.map((r) => ({
      relationship: `${r.source} --${r.predicate}--> ${r.target}`,
      reason: r.reason,
      ...(r.endpoints ? { endpoints: r.endpoints } : {}),
      consequence: r.consequence,
      resolve: r.resolve,
    })),
  ];
}

/**
 * Re-baselines the changeset (StagingAreaManager.rebaseline), or previews it, and reports what
 * moved under it. The lists of what moved are a page (`moved.page`); the counts, the layers and
 * both overlap lists are whole.
 */
async function rebaseline(
  rootPath: string,
  changeset: Changeset,
  options: { preview: boolean; limit?: number; offset?: number }
): Promise<Record<string, unknown>> {
  requireStaged(changeset, "re-baseline it");
  if (!options.preview && options.offset !== undefined && options.offset > 0) {
    // A re-baseline can't be applied again to read the next page of what it moved past.
    throw new CLIError("offset pages a preview: applying a re-baseline from an offset would skip the first entries for good", ErrorCategory.USER, [
      'Read what moved with rebaseline: "preview" (limit, offset), then apply with rebaseline: true',
    ]);
  }
  // On the model as it is on disk, like a commit: the base to record is the one a landing reads.
  const model = await Model.load(rootPath, { lazyLoad: false });
  const result = await asUserError(
    () => new StagingAreaManager(model.rootPath, model).rebaseline(changeset.id!, options),
    ['Use "changeset_list" to find a staged plan; a verification record or an upgrade record has no base to move']
  );
  const key = (o: Record<string, unknown>): string => `${o.element ?? o.relationship}:${o.reason}`;
  const remaining = overlapList(result.after);
  const stillThere = new Set(remaining.map(key));
  const cleared = overlapList(result.before)
    .filter((o) => !stillThere.has(key(o)))
    .map((o) => `${o.element ?? o.relationship} (${o.reason})`);
  const moved = result.before.baseChanges;
  const nextOffset = moved?.page.nextOffset;
  const name = changeset.name;
  // Lists shortened to a page say so, with the call that reads on. After an applied re-baseline
  // there is no such call, and that is said instead of leaving the first page to pass for all of it.
  let more: string | undefined;
  if (moved && nextOffset !== undefined) {
    more = result.applied
      ? `moved lists the first ${moved.page.limit} entries of each list; moved.page.totals has the true counts. The ` +
        "rest can no longer be read: this changeset's base is now the base as it is. Before the next re-baseline, read " +
        'everything with rebaseline: "preview" (limit, offset), or pass a larger limit.'
      : `moved lists ${moved.page.limit} entries of each list from ${moved.page.offset}; moved.page.totals has the ` +
        `true counts. Read on with changeset_update, changeset: "${name}", rebaseline: "preview", offset: ${nextOffset}.`;
  }
  return {
    applied: result.applied,
    previousBaseSnapshot: result.previousBaseSnapshot,
    baseSnapshot: result.baseSnapshot,
    // What changed in the base between the previous base and this one.
    moved: moved ?? "No base index was recorded for the previous base, so what moved under the changeset cannot be listed.",
    ...(more ? { more } : {}),
    overlapsCleared: cleared,
    overlapsRemaining: remaining,
    next: !result.applied
      ? `Nothing was written. Call changeset_update with changeset: "${name}" and rebaseline: true to apply it` +
        (remaining.length > 0 ? "; the overlaps in overlapsRemaining will still be there, since they are true against the base as it is now." : ".")
      : remaining.length > 0
        ? "The base still overlaps the staged changes in overlapsRemaining. Resolve each as its resolve says, or tell " +
          "the user what landing will do about it: the landing summary lists them again."
        : "Nothing the changeset stages overlaps the base as it is now. Tell the user what moved before they land it.",
  };
}

export async function changesetUpdateHandler(args: ChangesetUpdateArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const intent = intentArg(args);
    const rename = args.name !== undefined || intent !== undefined;
    const rebaselining = args.rebaseline === true || args.rebaseline === "preview";
    if (!rename && !rebaselining) {
      throw new CLIError("Nothing to update", ErrorCategory.USER, ['Pass "name", "intent" or "rebaseline: true"']);
    }
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const changeset = await resolveChangeset(manager, changesetArg(args));

    const updated = rename
      ? await asUserError(
          () => manager.update(changeset.id!, { name: args.name, description: intent }),
          ['Use "changeset_list" to see the names already taken']
        )
      : changeset;
    const rebaselined = rebaselining
      ? await rebaseline(model.rootPath, updated, {
          preview: args.rebaseline === "preview",
          limit: args.limit,
          offset: args.offset,
        })
      : undefined;
    await reloadModel(args.rootPath);

    return jsonResult({
      id: updated.id,
      name: updated.name,
      ...(changeset.name !== updated.name ? { previousName: changeset.name } : {}),
      description: updated.description ?? null,
      status: updated.status,
      changes: updated.changes.length,
      ...(rebaselined ? { rebaselined } : {}),
    });
  });
}

export const changesetUpdateTool: McpToolDefinition<typeof updateInputSchema> = {
  name: "changeset_update",
  description:
    "Rename a changeset or change its intent (markdown, stored as its description), or re-baseline it (rebaseline: true): " +
    "take the base model as it is now as its base and get back what moved under it. rebaseline: \"preview\" returns " +
    `the same and writes nothing. What moved is listed ${DRIFT_LIST_LIMIT} entries per list by default (limit, offset; ` +
    "moved.page has the true totals). Staged changes are untouched. Defaults to the active changeset.",
  inputSchema: updateInputSchema,
  handler: changesetUpdateHandler,
};

// ---------------------------------------------------------------------------
// changeset_unstage
// ---------------------------------------------------------------------------

const elementIdField = z
  .string()
  .optional()
  .describe("Drop every staged change to this element (its add, updates or delete). ID or path.");
const sourceField = z
  .string()
  .optional()
  .describe(
    "Drop staged relationship changes (adds and deletes) from this element: to target when given, otherwise to " +
      "any element. The element's own changes are not touched."
  );
const targetField = z
  .string()
  .optional()
  .describe(
    "Drop staged relationship changes (adds and deletes) to this element: from source when given, otherwise from " +
      "any element. The element's own changes are not touched."
  );
const predicateField = z.string().optional().describe("Only relationship changes with this predicate. Omit for any.");
const keepRelationshipsField = z
  .boolean()
  .optional()
  .describe(
    "With elementId: keep the staged relationship changes that depend on the element's change. By default, " +
      "unstaging an element's add also drops staged relationships to it (they would dangle), and unstaging its " +
      "delete also drops the relationship removals its cascade staged (removals staged before the delete are kept)."
  );

const unstageItemSchema = strictItem("A changes[] item", {
  elementId: elementIdField,
  source: sourceField,
  target: targetField,
  predicate: predicateField,
  keepRelationships: keepRelationshipsField,
});

type UnstageSpec = z.infer<typeof unstageItemSchema>;

const unstageInputSchema = {
  ...changesetFields,
  elementId: elementIdField,
  source: sourceField,
  target: targetField,
  predicate: predicateField,
  keepRelationships: keepRelationshipsField,
  changes: z
    .array(unstageItemSchema)
    .min(1)
    .optional()
    .describe(
      "Several unstages at once, each {elementId} or {source, predicate?, target} or {source} or {target}, with the " +
        "same meaning as the single form. All are removed in one write, with a result per item: unstaged, " +
        "already-unstaged (an earlier item took its changes), not-staged, or invalid with the reason. Cannot be " +
        "combined with the single-form fields."
    ),
  detail: unstageDetailField,
  rootPath: rootPathSchema,
};

export type ChangesetUnstageArgs = z.infer<z.ZodObject<typeof unstageInputSchema>>;

function describeEnds(args: { source?: string; target?: string }): string {
  if (args.source && args.target) return `from ${args.source} to ${args.target}`;
  return args.source ? `from ${args.source}` : `to ${args.target}`;
}

/** Refuses a spec that names neither or both of an element and a relationship. */
function checkUnstageSpec(spec: UnstageSpec): void {
  const byElement = spec.elementId !== undefined;
  const byRelationship = spec.source !== undefined || spec.target !== undefined;
  if (byElement === byRelationship) {
    throw new CLIError("Name either an element or a relationship to unstage", ErrorCategory.USER, [
      'Pass "elementId" to drop an element\'s staged changes',
      'Or pass "source" and/or "target" (and optionally "predicate") to drop staged relationship changes',
    ]);
  }
  if (byRelationship && !spec.source && !spec.target) {
    throw new CLIError('"source" or "target" must not be empty', ErrorCategory.USER);
  }
}

/** The change keys one unstage spec selects, and what it kept or should say. */
function selectUnstage(
  spec: UnstageSpec,
  graph: ChangesetGraph,
  changeset: Changeset
): { keys: Set<string>; notes: string[] } {
  const changes = changeset.changes as StagedChange[];
  const keys = new Set<string>();
  const notes: string[] = [];

  if (spec.elementId !== undefined) {
    const element = graph.getElement(spec.elementId);
    const ids = new Set([spec.elementId, ...(element ? [element.id, element.uuid ?? element.id] : [])]);
    const own = changes.filter((c) => !c.type.startsWith("relationship-") && ids.has(c.elementId));
    for (const change of own) keys.add(change.elementId);

    // Relationship changes that only make sense with the element's change.
    const dependentType = own.some((c) => c.type === "add")
      ? "relationship-add"
      : own.some((c) => c.type === "delete")
        ? "relationship-delete"
        : null;
    const touching = dependentType
      ? changes.filter((c) => {
          if (c.type !== dependentType) return false;
          const triple = stagedRelationshipTriple(c);
          return (
            !!triple &&
            (ids.has(triple.source) ||
              ids.has(triple.target) ||
              (element && (graph.resolve(triple.source) === element.id || graph.resolve(triple.target) === element.id)))
          );
        })
      : [];
    // A delete cascades into relationship removals staged right after it. Removals staged before the
    // delete were the agent's own decisions, not the cascade's, so they stay.
    const seq = (c: StagedChange): number => c.sequenceNumber ?? changes.indexOf(c);
    const deleteSeqs = own.filter((c) => c.type === "delete").map(seq);
    const firstDelete = deleteSeqs.length > 0 ? Math.min(...deleteSeqs) : -1;
    const dependent =
      dependentType === "relationship-delete" ? touching.filter((c) => seq(c) > firstDelete) : touching;
    const deliberate = touching.filter((c) => !dependent.includes(c));
    if (deliberate.length > 0) {
      notes.push(
        `${deliberate.length} relationship removal(s) on ${spec.elementId} staged before its delete were kept ` +
          `(${deliberate.map((c) => c.elementId).join(", ")}); unstage them by source and target if they should go too`
      );
    }
    if (dependent.length > 0) {
      if (spec.keepRelationships) {
        notes.push(
          `${dependent.length} staged relationship change(s) on ${spec.elementId} were kept (keepRelationships)` +
            (dependentType === "relationship-add" ? "; they will dangle unless the element is staged again" : "")
        );
      } else {
        for (const change of dependent) keys.add(change.elementId);
      }
    }
    return { keys, notes };
  }

  const matched = stagedRelationshipChangesAtEnds(graph, changeset, {
    source: spec.source || undefined,
    target: spec.target || undefined,
    predicate: spec.predicate,
  });
  // A relationship removal staged after the delete of one of its ends is that delete's cascade:
  // without it the deleted element's relationship dangles and the changeset no longer commits.
  const seq = (c: StagedChange): number => c.sequenceNumber ?? changes.indexOf(c);
  const deleteSeq = new Map<string, number>();
  for (const change of changes) {
    if (change.type !== "delete") continue;
    const id = graph.resolve(change.elementId);
    deleteSeq.set(id, Math.min(deleteSeq.get(id) ?? Infinity, seq(change)));
  }
  const deletedEndOf = (change: StagedChange): string | undefined => {
    if (change.type !== "relationship-delete") return undefined;
    const triple = stagedRelationshipTriple(change);
    if (!triple) return undefined;
    return [graph.resolve(triple.source), graph.resolve(triple.target)].find(
      (end) => deleteSeq.has(end) && deleteSeq.get(end)! < seq(change)
    );
  };
  const cascaded = matched.filter((c) => deletedEndOf(c) !== undefined);
  const deletedEnds = [...new Set(cascaded.map((c) => deletedEndOf(c)!))].join(", ");
  const cascadeList = cascaded.map((c) => c.elementId).join(", ");
  // One end sweeps every relationship there, so it leaves a delete's cascade alone. Naming both
  // ends asks for those relationships specifically, so they go, with a warning.
  const bothEnds = !!spec.source && !!spec.target;
  for (const change of matched) {
    if (!bothEnds && cascaded.includes(change)) continue;
    keys.add(change.elementId);
  }
  if (cascaded.length > 0 && bothEnds) {
    notes.push(
      `Unstaged ${cascaded.length} relationship removal(s) cascaded from the staged delete of ${deletedEnds} ` +
        `(${cascadeList}): those relationships now dangle, so the changeset will not commit until they are ` +
        `removed again or the delete is unstaged ("changeset_unstage" with elementId)`
    );
  } else if (cascaded.length > 0) {
    notes.push(
      `Kept ${cascaded.length} relationship removal(s) cascaded from the staged delete of ${deletedEnds} ` +
        `(${cascadeList}): dropping them would leave those relationships dangling. Unstage the delete ` +
        `("changeset_unstage" with elementId) to restore them, or name both source and target to drop one anyway`
    );
  }
  return { keys, notes };
}

function notStagedMessage(spec: UnstageSpec, changesetName: string): string {
  return spec.elementId !== undefined
    ? `No staged change to ${spec.elementId} in '${changesetName}'`
    : `No staged relationship change ${describeEnds(spec)}` +
        `${spec.predicate ? ` (${spec.predicate})` : ""} in '${changesetName}'`;
}

const SINGLE_FORM_FIELDS = ["elementId", "source", "target", "predicate", "keepRelationships"] as const;

export async function changesetUnstageHandler(args: ChangesetUnstageArgs): Promise<CallToolResult> {
  return runTool(async () => {
    if (args.changes) {
      const mixed = SINGLE_FORM_FIELDS.filter((field) => args[field] !== undefined);
      if (mixed.length > 0) {
        throw new CLIError(`"changes" cannot be combined with ${mixed.map((f) => `"${f}"`).join(", ")}`, ErrorCategory.USER, [
          'Put those fields on the items of the "changes" list',
        ]);
      }
      return unstageBatch(args.changes, changesetArg(args), args.rootPath, args.detail);
    }

    checkUnstageSpec(args);

    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const changeset = await resolveChangeset(manager, changesetArg(args));
    requireStaged(changeset, "unstage changes");
    const graph = await ChangesetGraph.build(model, changeset);
    const changes = changeset.changes as StagedChange[];
    const { keys, notes } = selectUnstage(args, graph, changeset);

    const removed = changes.filter((c) => keys.has(c.elementId));
    if (removed.length === 0) {
      return jsonResult({
        status: "not-staged",
        changeset: changeset.name,
        message: notStagedMessage(args, changeset.name),
        suggestions: ['Use "changeset_show" to list the staged changes'],
        ...(notes.length > 0 ? { notes } : {}),
      });
    }

    // The revision before the write: the delta since it lists every change this unstage removes.
    const revisionBefore = changesetRevision(changeset);
    // Each key is a revision of its own, as before the list form: briefs count unstages by revision.
    for (const key of keys) {
      await manager.unstage(changeset.id!, key);
    }
    await reloadModel(args.rootPath);

    const report = unstagedReport(removed, args.detail);
    const notListed = unstagedNotListedNote(report.unstagedNotListed ?? 0, {
      changesetId: changeset.id!,
      revision: revisionBefore,
      removed: removed.length,
    });
    return jsonResult({
      status: "unstaged",
      changeset: changeset.name,
      ...report,
      remainingChanges: changes.length - removed.length,
      ...(notes.length > 0 || notListed ? { notes: [...notes, ...(notListed ? [notListed] : [])] } : {}),
    });
  });
}

interface UnstageBatchResult {
  index: number;
  status: "unstaged" | "already-unstaged" | "not-staged" | "invalid";
  elementId?: string;
  source?: string;
  target?: string;
  predicate?: string;
  unstaged?: Array<string | Record<string, unknown>>;
  unstagedCount?: number;
  byOperation?: Record<string, number>;
  unstagedNotListed?: number;
  message?: string;
  reason?: string;
  suggestions?: string[];
  notes?: string[];
}

/**
 * changeset_unstage's list form: select each item's changes against the changeset as it stands,
 * then remove them all in one write. A change two items select is reported under the first.
 */
async function unstageBatch(
  specs: UnstageSpec[],
  changesetId: string | undefined,
  rootPath: string | undefined,
  detail: "compact" | "full" | undefined
) {
  const model = await loadModel(rootPath);
  const manager = new StagingAreaManager(model.rootPath, model);
  const changeset = await resolveChangeset(manager, changesetId);
  requireStaged(changeset, "unstage changes");
  const graph = await ChangesetGraph.build(model, changeset);
  const changes = changeset.changes as StagedChange[];

  const claimed = new Set<string>();
  const results: UnstageBatchResult[] = [];
  for (const [index, spec] of specs.entries()) {
    const asSent: UnstageBatchResult = {
      index,
      status: "unstaged",
      ...(spec.elementId !== undefined ? { elementId: spec.elementId } : {}),
      ...(spec.source !== undefined ? { source: spec.source } : {}),
      ...(spec.target !== undefined ? { target: spec.target } : {}),
      ...(spec.predicate !== undefined ? { predicate: spec.predicate } : {}),
    };
    let selection: { keys: Set<string>; notes: string[] };
    try {
      checkUnstageSpec(spec);
      selection = selectUnstage(spec, graph, changeset);
    } catch (error) {
      results.push({
        ...asSent,
        status: "invalid",
        reason: getErrorMessage(error),
        ...(error instanceof CLIError && error.suggestions?.length ? { suggestions: error.suggestions } : {}),
      });
      continue;
    }
    const notes = [...selection.notes];
    const fresh = [...selection.keys].filter((key) => !claimed.has(key));
    const earlier = selection.keys.size - fresh.length;
    for (const key of fresh) claimed.add(key);
    const removed = changes.filter((c) => fresh.includes(c.elementId));
    const status: UnstageBatchResult["status"] =
      removed.length > 0 ? "unstaged" : earlier > 0 ? "already-unstaged" : "not-staged";
    if (earlier > 0) notes.push(`${earlier} of its change(s) were already unstaged by an earlier item`);
    results.push({
      ...asSent,
      status,
      ...(removed.length > 0 ? unstagedReport(removed, detail) : {}),
      ...(status === "not-staged" ? { message: notStagedMessage(spec, changeset.name) } : {}),
      ...(notes.length > 0 ? { notes } : {}),
    });
  }

  const revisionBefore = changesetRevision(changeset);
  if (claimed.size > 0) {
    await manager.unstageMany(changeset.id!, [...claimed]);
    await reloadModel(rootPath);
  }

  const counts: Record<string, number> = {};
  for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1;
  const removedCount = changes.filter((c) => claimed.has(c.elementId)).length;
  const notListed = unstagedNotListedNote(results.reduce((sum, r) => sum + (r.unstagedNotListed ?? 0), 0), {
    changesetId: changeset.id!,
    revision: revisionBefore,
    removed: removedCount,
  });
  return jsonResult({
    changeset: changeset.name,
    counts,
    results,
    unstagedChanges: removedCount,
    remainingChanges: changes.length - removedCount,
    ...(results.some((r) => r.status === "not-staged")
      ? { suggestions: ['Use "changeset_show" to list the staged changes'] }
      : {}),
    ...(notListed ? { more: notListed } : {}),
  });
}

export const changesetUnstageTool: McpToolDefinition<typeof unstageInputSchema> = {
  name: "changeset_unstage",
  description:
    "Undo part of a staged changeset: drop the staged changes to one element (elementId), or the staged " +
    "relationship adds/deletes between source and target, or every one from source alone or to target alone " +
    "(optionally one predicate). To drop several, send changes: [...] (one write, a result per item). The base " +
    "model is not touched. Defaults to the active changeset. The result counts what was removed per operation and " +
    'lists it one line per change (the first 25 of each unstage, the rest counted); detail: "full" lists each ' +
    "removed change as an object. Use changeset_show to see what is staged.",
  inputSchema: unstageInputSchema,
  handler: changesetUnstageHandler,
};

// ---------------------------------------------------------------------------
// changeset_discard
// ---------------------------------------------------------------------------

const discardInputSchema = {
  ...changesetArgFields("Changeset ID or name to discard. Required: discard is never implied."),
  confirm: z
    .boolean()
    .describe(
      "Must be true. Discarding deletes the changeset permanently: its staged changes and its folder under " +
        "documentation-robotics/changesets/ are removed, so confirm only when the plan is to be abandoned."
    ),
  rootPath: rootPathSchema,
};

export type ChangesetDiscardArgs = z.infer<z.ZodObject<typeof discardInputSchema>>;

export async function changesetDiscardHandler(args: ChangesetDiscardArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const named = changesetArg(args, { required: true, why: "discard is never implied" });
    const changeset = await resolveChangeset(manager, named);
    // A recorded verification record (its plan landed) is discarded by this explicit move too.
    if (changeset.status !== "recorded") requireStaged(changeset, "discard it");

    if (args.confirm !== true) {
      throw new CLIError(
        `Discarding '${changeset.name}' deletes its ${changeset.changes.length} staged change(s) permanently`,
        ErrorCategory.USER,
        [
          'Pass "confirm": true to discard it',
          'Use "changeset_unstage" to drop individual changes instead',
          'Use "changeset_deactivate" to stop staging into it and keep its changes',
        ]
      );
    }

    const wasActive = (await manager.getActiveId()) === changeset.id;
    const discardedChanges = changeset.changes.length;
    // Deletes the changeset's folder and clears the active marker if it named it.
    await manager.discard(changeset.id!);
    await reloadModel(args.rootPath);

    return jsonResult({
      id: changeset.id,
      name: changeset.name,
      status: "discarded",
      discardedChanges,
      deactivated: wasActive,
      removed: `documentation-robotics/changesets/${changeset.id}/`,
    });
  });
}

export const changesetDiscardTool: McpToolDefinition<typeof discardInputSchema> = {
  name: "changeset_discard",
  description:
    "Abandon a staged changeset: PERMANENTLY deletes it, its staged changes and its folder under " +
    "documentation-robotics/changesets/ (deactivating it if active); no record of it is kept. Not recoverable, so it " +
    "requires confirm: true. A verification record kept after its plan landed (status recorded) is discarded the same way. The base model is not touched. To undo part of a plan use changeset_unstage; to pause " +
    "it use changeset_deactivate.",
  inputSchema: discardInputSchema,
  handler: changesetDiscardHandler,
};
