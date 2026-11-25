/**
 * relationship_add, relationship_delete — stage (or write) relationships. Mirror
 * `dr relationship add|delete`, validated against the relationship catalog.
 *
 * Inside an active changeset both tools read the changeset's projected graph, so they work between
 * elements that exist only in the changeset, report a repeated add as a duplicate rather than
 * staging it twice, and undo instead of stacking: deleting a relationship this changeset added
 * unstages the add, and re-adding one it deleted unstages the delete. The projected-graph logic is
 * shared with the CLI (`cli/src/core/relationship-staging.ts`).
 *
 * relationship_add also takes a list (`relationships`, inline or in a JSON `file`): every item is
 * checked against the catalog and the projection, and the valid ones are staged in one write. The
 * result is the counts and the items that need attention (batch-result.ts); `verbose` returns
 * every item.
 */

import { z } from "zod";
import { BATCH_FILE_DESCRIPTION, readBatchFile } from "../batch-file.js";
import { strictItem } from "../strict-schema.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Changeset, type StagedChange } from "../../core/changeset.js";
import { ChangesetGraph, type GraphElement } from "../../core/changeset-graph.js";
import { Element } from "../../core/element.js";
import { isValidLayerName } from "../../core/layers.js";
import type { Model } from "../../core/model.js";
import type { Relationship } from "../../core/relationships.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import {
  liveRelationshipsBetween,
  relationshipDeleteChange,
  resolveLooseReference,
  planRelationshipBatch,
  stagedRelationshipKeys,
  stageRelationshipDeletes,
  unstagedRelationshipAdd,
  type RelationshipBatchItem,
  type RelationshipBatchPlan,
} from "../../core/relationship-staging.js";
import { addRelationship, deleteRelationshipHandler, findRelationshipsByEndpoints } from "../../commands/relationship.js";
import { ModelReportOrchestrator } from "../../reports/model-report-orchestrator.js";
import { emitLog, SeverityNumber } from "../../telemetry/index.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, withProjectWriteLock, type McpToolDefinition } from "./shared.js";
import {
  BATCH_RESULT_DESCRIPTION,
  BATCH_RESULT_LINE_WIDTH,
  batchReport,
  limitSchema,
  verboseSchema,
  type BatchItemResult,
  type BatchReport,
} from "./batch-result.js";

// ---------------------------------------------------------------------------
// relationship_add
// ---------------------------------------------------------------------------

export const relationshipItemSchema = strictItem("A relationships[] item", {
  source: z.string().describe("Source element ID (layer.type.name)."),
  predicate: z.string().describe("Relationship predicate."),
  target: z.string().describe("Target element ID (layer.type.name)."),
  properties: z.record(z.string(), z.unknown()).optional().describe("Optional relationship properties."),
});

const relationshipsSchema = z.array(relationshipItemSchema);

const addInputSchema = {
  source: z.string().optional().describe("Source element ID (layer.type.name). Single form."),
  predicate: z
    .string()
    .optional()
    .describe(
      "Relationship predicate, e.g. 'realizes', 'serves', 'accesses'. Use spec_type to see what the catalog allows. Single form."
    ),
  target: z.string().optional().describe("Target element ID (layer.type.name). Single form."),
  properties: z.record(z.string(), z.unknown()).optional().describe("Optional relationship properties. Single form."),
  relationships: relationshipsSchema
    .optional()
    .describe(
      "Batch form, instead of source/predicate/target: a list of {source, predicate, target, properties?}, staged in " +
        "one write. Each item is checked on its own; an invalid one is skipped and reported, the rest are staged."
    ),
  file: z.string().optional().describe(`${BATCH_FILE_DESCRIPTION} The file is one JSON object: {"relationships": [...]}.`),
  verbose: verboseSchema,
  limit: limitSchema,
  rootPath: rootPathSchema,
};

export type RelationshipAddArgs = z.infer<z.ZodObject<typeof addInputSchema>>;

export async function relationshipAddHandler(args: RelationshipAddArgs): Promise<CallToolResult> {
  return runTool(() => withProjectWriteLock(args.rootPath, async () => {
    if (args.relationships !== undefined || args.file !== undefined) {
      const list = args.relationships !== undefined ? "relationships" : "file";
      const singleFields = [args.source, args.predicate, args.target, args.properties];
      if (singleFields.some((field) => field !== undefined)) {
        throw new CLIError(`Send either source/predicate/target or ${list}, not both`, ErrorCategory.USER, [
          "Put the single relationship in the relationships list too",
        ]);
      }
      if (args.relationships !== undefined && args.file !== undefined) {
        throw new CLIError("Send either file or relationships, not both", ErrorCategory.USER, [
          "Put every relationship in the file, or send them all inline",
        ]);
      }
      let items = args.relationships;
      if (items === undefined) {
        const model = await loadModel(args.rootPath);
        const batch = await readBatchFile("relationship_add", args.file!, model.rootPath, { relationships: relationshipsSchema });
        items = batch.relationships ?? [];
      }
      return jsonResult(await addRelationshipBatch(items, args.rootPath, args), { compact: true, lineWidth: BATCH_RESULT_LINE_WIDTH });
    }
    if (!args.source || !args.predicate || !args.target) {
      throw new CLIError(
        "relationship_add needs source, predicate and target, or a relationships list",
        ErrorCategory.USER,
        [
          'Single: {source: "api.operation.x", predicate: "realizes", target: "application.applicationfunction.y"}',
          "Batch: {relationships: [{source, predicate, target}, ...]}",
        ]
      );
    }
    return addSingleRelationship(args.source, args.predicate, args.target, args.properties, args.rootPath);
  }));
}

async function addSingleRelationship(
  sourceId: string,
  predicate: string,
  targetId: string,
  properties: Record<string, unknown> | undefined,
  rootPath: string | undefined
): Promise<CallToolResult> {
  const model = await loadModel(rootPath);
  const manager = new StagingAreaManager(model.rootPath, model);
  const active = await manager.getWriteTarget();
  const graph = await ChangesetGraph.build(model, active ?? previewChangeset());

  // An end that is not an exact id is read as the one element it names by name or by id without
  // hyphens, as in a list; more than one is refused with the candidates.
  const notes: string[] = [];
  const exact = (ref: string, role: "Source" | "Target"): string => {
    if (graph.getElement(ref)) return ref;
    const loose = resolveLooseReference(graph, ref);
    if (!loose) return ref;
    if ("candidates" in loose) {
      throw new CLIError(
        `${role} ${ref} is not an exact id and matches more than one element: ${loose.candidates.join(", ")}`,
        ErrorCategory.USER,
        ["Name the element by its exact id"]
      );
    }
    notes.push(`${role} ${ref} read as ${loose.id}`);
    return loose.id;
  };
  sourceId = exact(sourceId, "Source");
  targetId = exact(targetId, "Target");
  const read = notes.length > 0 ? { notes } : {};

  const warnings: string[] = [];
  const warned = () => (warnings.length > 0 ? { warnings } : {});
  if (!active) {
    const outcome = await addRelationship(model, sourceId, targetId, predicate, properties, undefined, warnings);
    return jsonResult({ status: outcome, source: sourceId, predicate, target: targetId, ...read, ...warned() });
  }

  // Resolve the ends in the projection first, for a clear error when the changeset deletes one.
  const sourceElement = liveElement(graph, sourceId, "Source");
  const targetElement = liveElement(graph, targetId, "Target");
  const source = sourceElement.id;
  const target = targetElement.id;
  const triple = { source, predicate, target };

  // Hand addRelationship the projection's resolution: its own lookup reads the cached model's
  // layers, which need not know a layer only this changeset adds elements to.
  const outcome = await addRelationship(
    model,
    source,
    target,
    predicate,
    properties,
    { source: preResolved(sourceElement), target: preResolved(targetElement) },
    warnings
  );
  // Model.load merges the active changeset's relationships into model.relationships, and other tools
  // (model_validate, model_export, model_delete's cascade) read that merged view: reload after any staging.
  if (outcome !== "duplicate") {
    await reloadModel(rootPath);
  }
  return jsonResult({ status: outcome, changeset: active.name, ...triple, ...read, ...warned() });
}

/** What a batch did, for the tool result: counts, and the items that need attention (or all, with verbose). */
export interface RelationshipBatchSummary extends RelationshipBatchReport {
  changeset?: string;
}

export interface RelationshipBatchReport extends BatchReport<RelationshipBatchPlan["results"][number]> {
  /**
   * Every end of a written relationship that was given by name or by an id without hyphens, and
   * the id it was read as. One entry per distinct reference: a batch that names its elements
   * this way gets this map, not an attention item per relationship.
   */
  readByName?: Record<string, string>;
}

/** A relationship batch's report: {@link batchReport}, with the by-name readings of written items as one map. */
export function relationshipBatchReport(
  results: RelationshipBatchPlan["results"],
  options: { verbose?: boolean; limit?: number }
): RelationshipBatchReport {
  const written = ["staged", "added"];
  const report = batchReport(results, {
    ...options,
    written,
    settled: ["unchanged"],
    byCause: true,
    // A written relationship's notes say how an end was read: that is in readByName. A warning
    // (a type the version assumed for the model lacks) needs attention.
    writtenNeedsAttention: (result) => (result.warnings?.length ?? 0) > 0,
  });
  const readByName: Record<string, string> = {};
  for (const result of results) {
    if (written.includes(result.status) && result.readAs) Object.assign(readByName, result.readAs);
  }
  return { ...report, ...(Object.keys(readByName).length > 0 ? { readByName } : {}) };
}

/** relationship_add's batch form: check every item, then stage the valid ones in one write. */
export async function addRelationshipBatch(
  items: RelationshipBatchItem[],
  rootPath?: string,
  report: { verbose?: boolean; limit?: number } = {}
): Promise<RelationshipBatchSummary> {
  const model = await loadModel(rootPath);
  const manager = new StagingAreaManager(model.rootPath, model);
  const active = await manager.getWriteTarget();
  const changeset = active ?? previewChangeset();
  const graph = await ChangesetGraph.build(model, changeset);
  const plan = await planRelationshipBatch(graph, changeset, items, {
    addStatus: active ? "staged" : "added",
    specVersion: model.manifest,
  });
  await applyRelationshipPlan(model, manager, active, plan, []);
  if (plan.changes.length > 0 || plan.unstageKeys.length > 0) {
    await reloadModel(rootPath);
  }
  return { ...(active ? { changeset: active.name } : {}), ...relationshipBatchReport(plan.results, report) };
}

/**
 * Stages `elementChanges` and the plan's relationship adds in one write, then unstages the
 * deletions the plan restores. With no active changeset, writes the relationships to the model in
 * one save (the caller has already written any elements).
 */
export async function applyRelationshipPlan(
  model: Model,
  manager: StagingAreaManager,
  active: Changeset | null,
  plan: RelationshipBatchPlan,
  elementChanges: Array<Omit<StagedChange, "sequenceNumber">>
): Promise<void> {
  if (active) {
    await manager.stageMany(active.id!, [...elementChanges, ...plan.changes]);
    for (const key of plan.unstageKeys) {
      await manager.unstage(active.id!, key);
    }
    return;
  }
  if (plan.changes.length === 0) return;
  const layers = new Set<string>();
  for (const change of plan.changes) {
    const relationship = change.after as unknown as Relationship;
    model.relationships.add(relationship);
    layers.add(relationship.layer);
    if (relationship.targetLayer) layers.add(relationship.targetLayer);
  }
  await model.saveRelationships();
  await model.saveManifest();
  try {
    const orchestrator = new ModelReportOrchestrator(model, model.rootPath);
    const affected = new Set<string>();
    for (const layer of layers) {
      if (!isValidLayerName(layer)) continue;
      for (const each of orchestrator.computeAffectedLayers(layer)) affected.add(each);
    }
    await orchestrator.regenerate(affected);
  } catch (error) {
    emitLog(SeverityNumber.WARN, "Failed to regenerate layer reports after a relationship batch", {
      "error.message": getErrorMessage(error),
    });
  }
}

/** Stands in for a changeset when none is active, so a batch is checked against the base model alone. */
export function previewChangeset(): Changeset {
  const now = new Date().toISOString();
  return new Changeset({
    id: "batch-preview",
    name: "batch",
    created: now,
    modified: now,
    status: "staged",
    baseSnapshot: "",
    changes: [],
  });
}

export const relationshipAddTool: McpToolDefinition<typeof addInputSchema> = {
  name: "relationship_add",
  description:
    "Add relationships, validated against the relationship catalog. Stages them in the active changeset when there " +
    "is one (including between elements the changeset itself adds), else writes the model. Send one " +
    "(source/predicate/target) or many (relationships: [{source, predicate, target}, ...]); a list is staged in " +
    "one write, so use it when wiring several, and put a large one in a JSON file (file) instead of the call. " +
    "Name elements by their id, layer.type.kebab-name, where the name is split at camelCase ('GraphLayoutSnapshot' " +
    "→ graph-layout-snapshot); model_add reports an id when the name does not make it obvious, and every id " +
    "with verbose: true. An end may also be an element's name or its id without hyphens, when exactly one " +
    "element in the model or the active changeset matches (more than one is refused, naming them); a list's " +
    "readByName says how each such reference was read. Single " +
    "status: 'staged' or 'added'; 'duplicate' when the model or " +
    "the changeset already has it (nothing staged); 'restored' when the changeset had staged its deletion (that " +
    "deletion is unstaged). In a list the same is 'unchanged', 'duplicate' is a relationship repeated in the list, " +
    "and invalid items carry the reason and suggestions (a catalog refusal names the predicates allowed between the " +
    "two types). " +
    BATCH_RESULT_DESCRIPTION +
    " Invalid items are skipped; the rest are still staged.",
  inputSchema: addInputSchema,
  handler: relationshipAddHandler,
};

// ---------------------------------------------------------------------------
// relationship_delete
// ---------------------------------------------------------------------------

const deleteItemSchema = strictItem("A relationships[] item", {
  source: z.string().describe("Source element ID."),
  target: z.string().describe("Target element ID."),
  predicate: z.string().optional().describe("Only this predicate. Omit to remove every relationship from source to target."),
});

const deleteItemsSchema = z.array(deleteItemSchema);

const deleteInputSchema = {
  source: z.string().optional().describe("Source element ID. Single form."),
  target: z.string().optional().describe("Target element ID. Single form."),
  predicate: z.string().optional().describe("Only this predicate. Omit to remove every relationship from source to target. Single form."),
  relationships: deleteItemsSchema
    .optional()
    .describe(
      "Batch form, instead of source/target: a list of {source, target, predicate?}, removed in one write. Each " +
        "item is matched on its own; one that matches nothing is skipped and reported, the rest are still removed."
    ),
  file: z.string().optional().describe(`${BATCH_FILE_DESCRIPTION} The file is one JSON object: {"relationships": [...]}.`),
  verbose: verboseSchema,
  limit: limitSchema,
  rootPath: rootPathSchema,
};

export type RelationshipDeleteArgs = z.infer<z.ZodObject<typeof deleteInputSchema>>;
type DeleteItem = z.infer<typeof deleteItemSchema>;

export async function relationshipDeleteHandler(args: RelationshipDeleteArgs): Promise<CallToolResult> {
  return runTool(() => withProjectWriteLock(args.rootPath, async () => {
    if (args.relationships !== undefined || args.file !== undefined) {
      const list = args.relationships !== undefined ? "relationships" : "file";
      const singleFields = (["source", "target", "predicate"] as const).filter((field) => args[field] !== undefined);
      if (singleFields.length > 0) {
        throw new CLIError(
          `Send either source/target or ${list}, not both (got ${singleFields.join(", ")} beside ${list})`,
          ErrorCategory.USER,
          ["Put the single relationship in the relationships list too"]
        );
      }
      if (args.relationships !== undefined && args.file !== undefined) {
        throw new CLIError("Send either file or relationships, not both", ErrorCategory.USER, [
          "Put every relationship in the file, or send them all inline",
        ]);
      }
      let items = args.relationships;
      if (items === undefined) {
        const model = await loadModel(args.rootPath);
        const batch = await readBatchFile("relationship_delete", args.file!, model.rootPath, { relationships: deleteItemsSchema });
        items = batch.relationships ?? [];
      }
      return jsonResult(await deleteRelationshipBatch(items, args.rootPath, args), { compact: true, lineWidth: BATCH_RESULT_LINE_WIDTH });
    }
    if (!args.source || !args.target) {
      throw new CLIError("relationship_delete needs source and target, or a relationships list", ErrorCategory.USER, [
        'Single: {source: "api.operation.x", target: "application.applicationfunction.y", predicate?: "realizes"}',
        "Batch: {relationships: [{source, target, predicate?}, ...]}",
      ]);
    }
    const source = args.source;
    const target = args.target;
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const active = await manager.getWriteTarget();

    if (!active) {
      const { deletedCount } = await deleteRelationshipHandler(model, source, target, args.predicate, undefined, "mcp");
      return jsonResult({ status: "deleted", deletedCount, source, target });
    }

    const graph = await ChangesetGraph.build(model, active);
    const from = graph.resolve(source);
    const to = graph.resolve(target);
    const matches = liveRelationshipsBetween(graph, from, to, args.predicate);

    if (matches.length === 0) {
      throw new CLIError("No matching relationships found", ErrorCategory.USER, [
        `Use "model_show" on ${source} to see its relationships`,
        'Use "changeset_brief" to see what this changeset already stages',
      ]);
    }

    const results = await stageRelationshipDeletes(manager, graph, active, matches);
    // Staged or unstaged, the cached model's merged relationships are now stale.
    await reloadModel(args.rootPath);
    return jsonResult({ changeset: active.name, source: from, target: to, relationships: results });
  }));
}

/** One item of relationship_delete's list: what it removed, or why it removed nothing. */
interface RelationshipDeleteBatchResult extends BatchItemResult {
  source: string;
  target: string;
  predicate?: string;
  /**
   * staged: a removal staged (or, for a relationship this changeset added, the add unstaged:
   * unstaged when that is all it did). deleted: removed from the model (no changeset active).
   * unchanged: already removed (this changeset deletes it). duplicate: an earlier item removed it.
   */
  status: "staged" | "unstaged" | "deleted" | "unchanged" | "duplicate" | "invalid";
  /** How many relationships the item removed (several when it names no predicate). */
  removed?: number;
}

/**
 * relationship_delete's list form (#1372): match every item, then stage the removals and unstage
 * the adds of relationships this changeset added, in one write. With no changeset active, remove
 * them from the model in one save. Failures are grouped by cause (batch-result.ts).
 */
export async function deleteRelationshipBatch(
  items: DeleteItem[],
  rootPath?: string,
  report: { verbose?: boolean; limit?: number } = {}
) {
  const model = await loadModel(rootPath);
  const manager = new StagingAreaManager(model.rootPath, model);
  const active = await manager.getWriteTarget();
  const results: RelationshipDeleteBatchResult[] = [];
  const handled = new Set<string>();
  const keyOf = (rel: { source: string; predicate: string; target: string }) => `${rel.source}::${rel.predicate}::${rel.target}`;
  const notFound = (item: DeleteItem, inChangeset: boolean) => ({
    status: "invalid" as const,
    reason: `No relationship from ${item.source} to ${item.target}${item.predicate ? ` with the predicate ${item.predicate}` : ""}`,
    suggestions: [
      `Use "model_show" on ${item.source} to see its relationships`,
      ...(inChangeset ? ['Use "changeset_brief" to see what this changeset already stages'] : []),
    ],
  });

  if (active) {
    const graph = await ChangesetGraph.build(model, active);
    const toStage: Array<Omit<StagedChange, "sequenceNumber">> = [];
    const toUnstage: string[] = [];
    for (const [index, item] of items.entries()) {
      const asSent = { index, source: item.source, target: item.target, ...(item.predicate ? { predicate: item.predicate } : {}) };
      const from = graph.resolve(item.source);
      const to = graph.resolve(item.target);
      const matches = liveRelationshipsBetween(graph, from, to, item.predicate);
      const fresh = matches.filter((rel) => !handled.has(keyOf(rel)));
      if (matches.length > 0 && fresh.length === 0) {
        results.push({ ...asSent, status: "duplicate", reason: "Removed by an earlier item of this batch" });
        continue;
      }
      if (fresh.length === 0) {
        // Sent again after this changeset already removed it: a no-op (#1296).
        const removed = graph
          .relationships()
          .some(
            (rel) =>
              rel.status === "deleted" &&
              rel.source === from &&
              rel.target === to &&
              (!item.predicate || rel.predicate === item.predicate)
          );
        // Sent again after this changeset removed it, or unstaged its own add of it: a no-op (#1296).
        const done = removed || unstagedRelationshipAdd(graph, active, { source: from, target: to, predicate: item.predicate });
        results.push(
          done
            ? { ...asSent, status: "unchanged", reason: "This changeset already removes it" }
            : { ...asSent, ...notFound(item, true) }
        );
        continue;
      }
      let staged = 0;
      for (const rel of fresh) {
        handled.add(keyOf(rel));
        if (rel.status === "added") {
          toUnstage.push(...stagedRelationshipKeys(graph, active, "relationship-add", rel));
        } else {
          toStage.push(relationshipDeleteChange(rel));
          staged++;
        }
      }
      results.push({ ...asSent, status: staged > 0 ? "staged" : "unstaged", removed: fresh.length });
    }
    // One write: the removals staged and this changeset's own adds unstaged together.
    if (toStage.length > 0 || toUnstage.length > 0) {
      await manager.stageMany(active.id!, toStage, [], [...new Set(toUnstage)]);
      await reloadModel(rootPath);
    }
  } else {
    const removedRows: Relationship[] = [];
    for (const [index, item] of items.entries()) {
      const asSent = { index, source: item.source, target: item.target, ...(item.predicate ? { predicate: item.predicate } : {}) };
      const matches = await findRelationshipsByEndpoints(model, item.source, item.target, item.predicate);
      const fresh = matches.filter((rel) => !handled.has(keyOf(rel)));
      if (matches.length > 0 && fresh.length === 0) {
        results.push({ ...asSent, status: "duplicate", reason: "Removed by an earlier item of this batch" });
        continue;
      }
      if (fresh.length === 0) {
        results.push({ ...asSent, ...notFound(item, false) });
        continue;
      }
      for (const rel of fresh) {
        handled.add(keyOf(rel));
        removedRows.push(rel);
      }
      results.push({ ...asSent, status: "deleted", removed: fresh.length });
    }
    if (removedRows.length > 0) {
      for (const rel of removedRows) model.relationships.delete(rel.source, rel.target, rel.predicate);
      await model.saveRelationships();
      await model.saveManifest();
      await regenerateReportsFor(model, removedRows);
      await reloadModel(rootPath);
    }
  }

  return {
    ...(active ? { changeset: active.name } : {}),
    ...batchReport(results, { ...report, written: ["staged", "unstaged", "deleted"], settled: ["unchanged"], byCause: true }),
  };
}

/** Regenerates the layer reports a set of relationship rows touch. A failure is logged, never fatal. */
async function regenerateReportsFor(model: Model, rows: Array<{ layer: string; targetLayer?: string }>): Promise<void> {
  try {
    const orchestrator = new ModelReportOrchestrator(model, model.rootPath);
    const affected = new Set<string>();
    for (const row of rows) {
      for (const layer of [row.layer, row.targetLayer]) {
        if (!layer || !isValidLayerName(layer)) continue;
        for (const each of orchestrator.computeAffectedLayers(layer)) affected.add(each);
      }
    }
    await orchestrator.regenerate(affected);
  } catch (error) {
    emitLog(SeverityNumber.WARN, "Failed to regenerate layer reports after a relationship batch", {
      "error.message": getErrorMessage(error),
    });
  }
}

export const relationshipDeleteTool: McpToolDefinition<typeof deleteInputSchema> = {
  name: "relationship_delete",
  description:
    "Remove relationships from source to target. In an active changeset, stages the removal, or unstages the " +
    "relationship if this changeset added it; else writes the model. Send one (source/target, predicate?) or many " +
    "(relationships: [{source, target, predicate?}, ...], or file for a large list), removed in one write: use the " +
    "list when moving an element's links. In a list, statuses are staged, unstaged (only adds this changeset made " +
    "were dropped), deleted (no changeset active), unchanged (this changeset already removes it), duplicate (an " +
    "earlier item removed it) and invalid (nothing matched); removed says how many relationships an item took. " +
    BATCH_RESULT_DESCRIPTION,
  inputSchema: deleteInputSchema,
  handler: relationshipDeleteHandler,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function liveElement(graph: ChangesetGraph, id: string, role: "Source" | "Target"): GraphElement {
  const element = graph.getElement(id);
  if (!element || element.status === "deleted") {
    throw new CLIError(
      `${role} element ${id} not found${element ? " (this changeset deletes it)" : ""}`,
      ErrorCategory.USER,
      ['Use "model_search" to find elements, or "changeset_brief" to see what this changeset adds']
    );
  }
  return element;
}

/** A projected element in the shape addRelationship's catalog check reads. */
function preResolved(element: GraphElement): { element: Element; layerName: string } {
  return {
    layerName: element.layer,
    element: new Element({
      id: element.uuid ?? element.id,
      path: element.id,
      spec_node_id: `${element.layer}.${element.type}`,
      layer_id: element.layer,
      type: element.type,
      name: element.name,
      description: element.description,
      attributes: element.attributes,
      layer: element.layer,
    }),
  };
}
