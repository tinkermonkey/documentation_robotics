/**
 * model_delete — delete an element (optionally cascading to dependents).
 * Mirrors `dr delete`, but since an MCP session has no interactive confirmation
 * channel, the caller must pass `force` or `cascade` explicitly when dependents
 * exist rather than being prompted; operates through the shared MutationHandler.
 *
 * It also takes a list (`ids`, inline or in a JSON `file`, #1426), with the same cascade, force and
 * dryRun for every element: each id is deleted on its own, a dependent the same list deletes does
 * not block its element, and the result is counts with failures grouped by cause (batch-result.ts).
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import { DependencyTracker, TraceDirection } from "../../core/dependency-tracker.js";
import type { Model } from "../../core/model.js";
import { MutationHandler } from "../../core/mutation-handler.js";
import { ReferenceRegistry } from "../../core/reference-registry.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import { BATCH_FILE_DESCRIPTION, readBatchFile } from "../batch-file.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, withProjectWriteLock, type McpToolDefinition } from "./shared.js";
import { writeTargetChangeset } from "./changeset-shared.js";
import {
  BATCH_RESULT_DESCRIPTION,
  BATCH_RESULT_LINE_WIDTH,
  batchReport,
  limitSchema,
  verboseSchema,
  type BatchItemResult,
} from "./batch-result.js";

const idsSchema = z.array(z.string().min(1));

const inputSchema = {
  id: z.string().optional().describe("Element ID or path to delete. Single form."),
  ids: idsSchema
    .optional()
    .describe(
      "Batch form, instead of id: element IDs to delete, each on its own with this call's cascade, force and dryRun. " +
        "An element another id in the list depends on is not blocked by it. One that can't be deleted is skipped and " +
        "reported; the rest are still deleted."
    ),
  file: z.string().optional().describe(`${BATCH_FILE_DESCRIPTION} The file is one JSON object: {"ids": [...]}.`),
  cascade: z.boolean().optional().describe("Also delete elements that depend on this one."),
  force: z.boolean().optional().describe("Skip the dependency check and delete only this element, even if others depend on it."),
  dryRun: z.boolean().optional().describe("Preview what would be deleted without making changes."),
  verbose: verboseSchema,
  limit: limitSchema,
  rootPath: rootPathSchema,
};

export type ModelDeleteArgs = z.infer<z.ZodObject<typeof inputSchema>>;
type DeleteOptions = Pick<ModelDeleteArgs, "cascade" | "force" | "dryRun">;

/** What deleting one element did. */
interface DeleteOutcome {
  status: "staged" | "deleted" | "dry-run";
  id: string;
  layer: string;
  elementsToRemove?: string[];
  cascadedDeletes?: number;
  skippedDependents?: string[];
}

/** The elements that depend on others across layers, read once per call (cascade follows cross-layer references only). */
function dependencyTracker(model: Model): DependencyTracker {
  // Cascade is scoped to cross-layer references only, matching `dr delete`. This is
  // narrower than "model_trace", which also follows intra-layer relationships.yaml
  // edges — a dependent found by model_trace may not be included in a cascade delete.
  const registry = new ReferenceRegistry();
  for (const l of model.layers.values()) {
    for (const el of l.listElements()) {
      registry.registerElement(el);
    }
  }
  return new DependencyTracker(registry, model);
}

/**
 * Deletes one element (and, with cascade, what depends on it); throws a CLIError saying why it
 * can't. `gone` holds the ids this call already deleted or is deleting: never a dependent that
 * blocks, never deleted twice.
 */
async function deleteElement(
  model: Model,
  id: string,
  options: DeleteOptions,
  tracker: DependencyTracker,
  gone: Set<string> = new Set()
): Promise<DeleteOutcome> {
  const layerName = await findElementLayer(model, id);
  const element = layerName ? (await model.getLayer(layerName))?.getElement(id) : undefined;
  if (!layerName || !element) {
    throw new CLIError(`Element ${id} not found`, ErrorCategory.NOT_FOUND, ['Use "model_search" to find similar elements']);
  }

  const dependents = tracker.traceDependencies(id, TraceDirection.DOWN, null).filter((dep) => !gone.has(dep));

  if (dependents.length > 0 && !options.cascade && !options.force) {
    throw new CLIError("Element has dependencies", ErrorCategory.USER, [
      "Use cascade=true to remove all dependent elements",
      "Use dryRun=true with cascade=true to preview what would be deleted",
      "Or use force=true to remove only this element (dependencies will reference a non-existent element)",
    ]);
  }

  const elementsToRemove = options.cascade ? [id, ...dependents] : [id];

  if (options.dryRun) {
    return { status: "dry-run", id, layer: layerName, elementsToRemove };
  }

  let deletedCount = 0;
  const skippedDependents: string[] = [];
  const cascadeDeleted: string[] = [];
  if (options.cascade && dependents.length > 0) {
    for (const depId of [...dependents].reverse()) {
      const depLayerName = await findElementLayer(model, depId);
      const depElement = depLayerName ? (await model.getLayer(depLayerName))?.getElement(depId) : undefined;
      if (!depLayerName || !depElement) {
        console.error(`[mcp] model_delete: cascade dependent "${depId}" not found, skipping`);
        skippedDependents.push(depId);
        continue;
      }

      const depHandler = new MutationHandler(model, depId, depLayerName);
      try {
        await depHandler.executeDelete(depElement);
      } catch (error) {
        throw new CLIError(
          `Failed to delete dependent element "${depId}": ${getErrorMessage(error)}`,
          ErrorCategory.SYSTEM,
          [
            `${cascadeDeleted.length} dependent element(s) were deleted before the error`,
            'Use "model_validate" to check the model for broken references',
            `"${id}" was not deleted — you can retry the operation once dependents are resolved`,
          ],
          {
            operation: "model_delete (cascade)",
            relatedElements: cascadeDeleted,
            partialProgress: { completed: cascadeDeleted.length, total: dependents.length },
          }
        );
      }
      cascadeDeleted.push(depId);
      gone.add(depId);
      deletedCount++;
    }
  }

  const mutationHandler = new MutationHandler(model, id, layerName);
  await mutationHandler.executeDelete(element);
  gone.add(id);

  const activeChangeset = await mutationHandler.getStagingManager().getActive();
  const staged = !!(activeChangeset && activeChangeset.status === "staged");
  return {
    status: staged ? "staged" : "deleted",
    id,
    layer: layerName,
    elementsToRemove: [id, ...cascadeDeleted],
    cascadedDeletes: deletedCount,
    ...(skippedDependents.length > 0 ? { skippedDependents } : {}),
  };
}

export async function modelDeleteHandler(args: ModelDeleteArgs): Promise<CallToolResult> {
  return runTool(() => withProjectWriteLock(args.rootPath, async () => {
    if (args.ids !== undefined || args.file !== undefined) {
      const list = args.ids !== undefined ? "ids" : "file";
      if (args.id !== undefined) {
        throw new CLIError(`Send either id or ${list}, not both`, ErrorCategory.USER, ["Put the single id in the ids list too"]);
      }
      if (args.ids !== undefined && args.file !== undefined) {
        throw new CLIError("Send either file or ids, not both", ErrorCategory.USER, [
          "Put every id in the file, or send them all inline",
        ]);
      }
      let ids = args.ids;
      if (ids === undefined) {
        const model = await loadModel(args.rootPath);
        ids = (await readBatchFile("model_delete", args.file!, model.rootPath, { ids: idsSchema })).ids ?? [];
      }
      return jsonResult(await deleteElementBatch(ids, args), { compact: true, lineWidth: BATCH_RESULT_LINE_WIDTH });
    }
    if (!args.id) {
      throw new CLIError("model_delete needs id, or an ids list", ErrorCategory.USER, [
        'Single: {id: "api.operation.create-order"}',
        'Batch: {ids: ["api.operation.create-order", ...]}',
      ]);
    }

    const model = await loadModel(args.rootPath);
    const outcome = await deleteElement(model, args.id, args, dependencyTracker(model));
    if (outcome.status === "dry-run") {
      return jsonResult({ status: "dry-run", id: outcome.id, layer: outcome.layer, elementsToRemove: outcome.elementsToRemove });
    }
    // The cached model's merged relationships still hold the rows the delete just staged for
    // removal; reload so later reads (model_validate, model_export) see the plan.
    const active = outcome.status === "staged" ? await new StagingAreaManager(model.rootPath, model).getActive() : null;
    if (outcome.status === "staged") await reloadModel(args.rootPath);

    return jsonResult({
      status: outcome.status,
      changeset: active?.name,
      id: outcome.id,
      layer: outcome.layer,
      cascadedDeletes: outcome.cascadedDeletes ?? 0,
      ...(outcome.skippedDependents ? { skippedDependents: outcome.skippedDependents } : {}),
    });
  }));
}

/** One item of model_delete's list. */
interface DeleteBatchResult extends BatchItemResult {
  id: string;
  /**
   * staged or deleted (no changeset active); would-delete with dryRun; unchanged: this changeset
   * already deletes it, so the list can be sent again; duplicate: an earlier id (or its cascade)
   * deleted it; invalid: not found, or it has dependents and neither cascade nor force was sent.
   */
  status: "staged" | "deleted" | "would-delete" | "unchanged" | "duplicate" | "invalid";
  elementsToRemove?: string[];
  cascadedDeletes?: number;
  skippedDependents?: string[];
}

/**
 * model_delete's list form (#1426): each id deleted in turn with the call's options. Ids the list
 * deletes never block one another as dependents. The cached model is reread once, at the end.
 */
async function deleteElementBatch(ids: string[], args: ModelDeleteArgs) {
  const model = await loadModel(args.rootPath);
  const manager = new StagingAreaManager(model.rootPath, model);
  // Before anything is deleted: refuses when the active changeset was landed (#1437).
  const active = await writeTargetChangeset(manager);
  const graph = active ? await ChangesetGraph.build(model, active) : undefined;
  const tracker = dependencyTracker(model);
  // Every id in the list counts as going, so one never blocks another as its dependent.
  const listed = new Set(ids);
  const gone = new Set<string>();
  const results: DeleteBatchResult[] = [];
  let wrote = false;

  for (const [index, id] of ids.entries()) {
    if (gone.has(id)) {
      results.push({ index, id, status: "duplicate", reason: "Deleted earlier in this batch" });
      continue;
    }
    if (graph?.getElement(id)?.status === "deleted") {
      // Sent again after this changeset deleted it: a no-op (#1296).
      results.push({ index, id, status: "unchanged", reason: "This changeset already deletes it" });
      continue;
    }
    try {
      const blockers = new Set([...listed].filter((other) => other !== id));
      const outcome = await deleteElement(model, id, args, tracker, new Set([...gone, ...blockers]));
      if (outcome.status === "dry-run") {
        results.push({ index, id, status: "would-delete", elementsToRemove: outcome.elementsToRemove });
        continue;
      }
      wrote = true;
      gone.add(id);
      for (const dep of outcome.elementsToRemove ?? []) gone.add(dep);
      results.push({
        index,
        id,
        status: outcome.status,
        ...(outcome.cascadedDeletes ? { cascadedDeletes: outcome.cascadedDeletes } : {}),
        ...(outcome.skippedDependents ? { skippedDependents: outcome.skippedDependents } : {}),
      });
    } catch (error) {
      results.push({
        index,
        id,
        status: "invalid",
        reason: getErrorMessage(error),
        ...(error instanceof CLIError && error.suggestions?.length ? { suggestions: error.suggestions } : {}),
      });
    }
  }
  if (wrote) await reloadModel(args.rootPath);

  return {
    ...(active ? { changeset: active.name } : {}),
    ...(args.dryRun ? { dryRun: true } : {}),
    ...batchReport(results, {
      verbose: args.verbose,
      limit: args.limit,
      written: ["staged", "deleted", "would-delete"],
      settled: ["unchanged"],
      byCause: true,
    }),
  };
}

export const modelDeleteTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_delete",
  description:
    "Delete an element, optionally cascading to elements that depend on it. Send one (id) or many (ids: [...], or " +
    "file for a large list), each deleted on its own with the call's cascade, force and dryRun; an element another id " +
    "in the list depends on is not blocked by it. In a list, statuses are staged (or deleted with no changeset " +
    "active), would-delete with dryRun, unchanged (this changeset already deletes it), duplicate (an earlier id or " +
    "its cascade deleted it) and invalid (not found, or it has dependents). " +
    BATCH_RESULT_DESCRIPTION,
  inputSchema,
  handler: modelDeleteHandler,
};
