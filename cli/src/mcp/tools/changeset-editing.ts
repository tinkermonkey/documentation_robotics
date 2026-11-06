/**
 * changeset_update, changeset_unstage, changeset_discard — revise a staged changeset while
 * planning a change. Mirror `dr changeset unstage|discard` and add the rename / re-describe step
 * the CLI has no command for, all through StagingAreaManager.
 *
 * Every mutation reloads the cached model afterwards, like changeset-lifecycle.ts: the model
 * projects the active changeset's elements at load time, and the projection cache is keyed by
 * what is staged.
 *
 * Commit and apply stay off the MCP surface (landing a change is the human's step). Discard is
 * exposed because an agent must be able to abandon its own plan, but it clears the staged changes
 * for good, so it needs `confirm: true`. See docs/CHANGE_MODELING.md.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import type { Changeset, StagedChange } from "../../core/changeset.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { stagedRelationshipChangesAtEnds, stagedRelationshipTriple } from "../../core/relationship-staging.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { resolveChangeset } from "./changeset-shared.js";

const changesetIdSchema = z
  .string()
  .optional()
  .describe("Changeset ID or name. Defaults to the active changeset.");

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

function summarize(change: StagedChange): Record<string, unknown> {
  const triple = change.type.startsWith("relationship-") ? stagedRelationshipTriple(change) : null;
  return {
    type: change.type,
    elementId: change.elementId,
    layer: change.layerName,
    ...(triple ? { relationship: triple } : {}),
  };
}

// ---------------------------------------------------------------------------
// changeset_update
// ---------------------------------------------------------------------------

const updateInputSchema = {
  changesetId: changesetIdSchema,
  name: z.string().min(1).optional().describe("New name. Must not be another changeset's name."),
  description: z
    .string()
    .optional()
    .describe("New description: the change's intent and what done looks like. An empty string clears it."),
  rootPath: rootPathSchema,
};

export type ChangesetUpdateArgs = z.infer<z.ZodObject<typeof updateInputSchema>>;

export async function changesetUpdateHandler(args: ChangesetUpdateArgs): Promise<CallToolResult> {
  return runTool(async () => {
    if (args.name === undefined && args.description === undefined) {
      throw new CLIError("Nothing to update", ErrorCategory.USER, ['Pass "name" and/or "description"']);
    }
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const changeset = await resolveChangeset(manager, args.changesetId);

    const updated = await asUserError(
      () => manager.update(changeset.id!, { name: args.name, description: args.description }),
      ['Use "changeset_list" to see the names already taken']
    );
    await reloadModel(args.rootPath);

    return jsonResult({
      id: updated.id,
      name: updated.name,
      ...(changeset.name !== updated.name ? { previousName: changeset.name } : {}),
      description: updated.description ?? null,
      status: updated.status,
      changes: updated.changes.length,
    });
  });
}

export const changesetUpdateTool: McpToolDefinition<typeof updateInputSchema> = {
  name: "changeset_update",
  description:
    "Rename a changeset or change its description (the change's intent). Staged changes are untouched. " +
    "Defaults to the active changeset.",
  inputSchema: updateInputSchema,
  handler: changesetUpdateHandler,
};

// ---------------------------------------------------------------------------
// changeset_unstage
// ---------------------------------------------------------------------------

const unstageInputSchema = {
  changesetId: changesetIdSchema,
  elementId: z
    .string()
    .optional()
    .describe("Drop every staged change to this element (its add, updates or delete). ID or path."),
  source: z
    .string()
    .optional()
    .describe(
      "Drop staged relationship changes (adds and deletes) from this element: to target when given, otherwise to " +
        "any element. The element's own changes are not touched."
    ),
  target: z
    .string()
    .optional()
    .describe(
      "Drop staged relationship changes (adds and deletes) to this element: from source when given, otherwise from " +
        "any element. The element's own changes are not touched."
    ),
  predicate: z.string().optional().describe("Only relationship changes with this predicate. Omit for any."),
  keepRelationships: z
    .boolean()
    .optional()
    .describe(
      "With elementId: keep the staged relationship changes that depend on the element's change. By default, " +
        "unstaging an element's add also drops staged relationships to it (they would dangle), and unstaging its " +
        "delete also drops the relationship removals its cascade staged (removals staged before the delete are kept)."
    ),
  rootPath: rootPathSchema,
};

export type ChangesetUnstageArgs = z.infer<z.ZodObject<typeof unstageInputSchema>>;

function describeEnds(args: { source?: string; target?: string }): string {
  if (args.source && args.target) return `from ${args.source} to ${args.target}`;
  return args.source ? `from ${args.source}` : `to ${args.target}`;
}

export async function changesetUnstageHandler(args: ChangesetUnstageArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const byElement = args.elementId !== undefined;
    const byRelationship = args.source !== undefined || args.target !== undefined;
    if (byElement === byRelationship) {
      throw new CLIError("Name either an element or a relationship to unstage", ErrorCategory.USER, [
        'Pass "elementId" to drop an element\'s staged changes',
        'Or pass "source" and/or "target" (and optionally "predicate") to drop staged relationship changes',
      ]);
    }
    if (byRelationship && !args.source && !args.target) {
      throw new CLIError('"source" or "target" must not be empty', ErrorCategory.USER);
    }

    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const changeset = await resolveChangeset(manager, args.changesetId);
    requireStaged(changeset, "unstage changes");
    const graph = await ChangesetGraph.build(model, changeset);
    const changes = changeset.changes as StagedChange[];

    const keys = new Set<string>();
    const notes: string[] = [];

    if (byElement) {
      const element = graph.getElement(args.elementId!);
      const ids = new Set([args.elementId!, ...(element ? [element.id, element.uuid ?? element.id] : [])]);
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
          `${deliberate.length} relationship removal(s) on ${args.elementId} staged before its delete were kept ` +
            `(${deliberate.map((c) => c.elementId).join(", ")}); unstage them by source and target if they should go too`
        );
      }
      if (dependent.length > 0) {
        if (args.keepRelationships) {
          notes.push(
            `${dependent.length} staged relationship change(s) on ${args.elementId} were kept (keepRelationships)` +
              (dependentType === "relationship-add" ? "; they will dangle unless the element is staged again" : "")
          );
        } else {
          for (const change of dependent) keys.add(change.elementId);
        }
      }
    } else {
      const matched = stagedRelationshipChangesAtEnds(graph, changeset, {
        source: args.source || undefined,
        target: args.target || undefined,
        predicate: args.predicate,
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
      const bothEnds = !!args.source && !!args.target;
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
    }

    const removed = changes.filter((c) => keys.has(c.elementId));
    if (removed.length === 0) {
      return jsonResult({
        status: "not-staged",
        changeset: changeset.name,
        message: byElement
          ? `No staged change to ${args.elementId} in '${changeset.name}'`
          : `No staged relationship change ${describeEnds(args)}` +
            `${args.predicate ? ` (${args.predicate})` : ""} in '${changeset.name}'`,
        suggestions: ['Use "changeset_show" to list the staged changes'],
        ...(notes.length > 0 ? { notes } : {}),
      });
    }

    for (const key of keys) {
      await manager.unstage(changeset.id!, key);
    }
    await reloadModel(args.rootPath);

    return jsonResult({
      status: "unstaged",
      changeset: changeset.name,
      unstaged: removed.map(summarize),
      remainingChanges: changes.length - removed.length,
      ...(notes.length > 0 ? { notes } : {}),
    });
  });
}

export const changesetUnstageTool: McpToolDefinition<typeof unstageInputSchema> = {
  name: "changeset_unstage",
  description:
    "Undo part of a staged changeset: drop the staged changes to one element (elementId), or the staged " +
    "relationship adds/deletes between source and target, or every one from source alone or to target alone " +
    "(optionally one predicate). The base model is not touched. " +
    "Defaults to the active changeset. Use changeset_show to see what is staged.",
  inputSchema: unstageInputSchema,
  handler: changesetUnstageHandler,
};

// ---------------------------------------------------------------------------
// changeset_discard
// ---------------------------------------------------------------------------

const discardInputSchema = {
  changesetId: z.string().describe("Changeset ID or name to discard. Required: discard is never implied."),
  confirm: z
    .boolean()
    .describe(
      "Must be true. Discarding deletes the changeset's staged changes permanently (only its name, description and " +
        "a 'discarded' status remain), so confirm only when the plan is to be abandoned."
    ),
  rootPath: rootPathSchema,
};

export type ChangesetDiscardArgs = z.infer<z.ZodObject<typeof discardInputSchema>>;

export async function changesetDiscardHandler(args: ChangesetDiscardArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const changeset = await resolveChangeset(manager, args.changesetId);
    requireStaged(changeset, "discard it");

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
    await manager.discard(changeset.id!);
    if (wasActive) {
      await manager.clearActive();
    }
    await reloadModel(args.rootPath);

    return jsonResult({
      id: changeset.id,
      name: changeset.name,
      status: "discarded",
      discardedChanges,
      deactivated: wasActive,
    });
  });
}

export const changesetDiscardTool: McpToolDefinition<typeof discardInputSchema> = {
  name: "changeset_discard",
  description:
    "Abandon a staged changeset: PERMANENTLY deletes its staged changes and marks it discarded (deactivating it if " +
    "active). Not recoverable, so it requires confirm: true. The base model is not touched. To undo part of a " +
    "plan use changeset_unstage; to pause it use changeset_deactivate.",
  inputSchema: discardInputSchema,
  handler: changesetDiscardHandler,
};
