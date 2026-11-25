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
  resolveLooseReference,
  planRelationshipBatch,
  stageRelationshipDeletes,
  type RelationshipBatchItem,
  type RelationshipBatchPlan,
} from "../../core/relationship-staging.js";
import { addRelationship, deleteRelationshipHandler } from "../../commands/relationship.js";
import { ModelReportOrchestrator } from "../../reports/model-report-orchestrator.js";
import { emitLog, SeverityNumber } from "../../telemetry/index.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, withProjectWriteLock, type McpToolDefinition } from "./shared.js";
import { activeStagedChangeset } from "./changeset-shared.js";
import { BATCH_RESULT_LINE_WIDTH, batchReport, limitSchema, verboseSchema, type BatchReport } from "./batch-result.js";

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
  const active = await activeStagedChangeset(manager);
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

  if (!active) {
    const outcome = await addRelationship(model, sourceId, targetId, predicate, properties);
    return jsonResult({ status: outcome, source: sourceId, predicate, target: targetId, ...read });
  }

  // Resolve the ends in the projection first, for a clear error when the changeset deletes one.
  const sourceElement = liveElement(graph, sourceId, "Source");
  const targetElement = liveElement(graph, targetId, "Target");
  const source = sourceElement.id;
  const target = targetElement.id;
  const triple = { source, predicate, target };

  // Hand addRelationship the projection's resolution: its own lookup reads the cached model's
  // layers, which need not know a layer only this changeset adds elements to.
  const outcome = await addRelationship(model, source, target, predicate, properties, {
    source: preResolved(sourceElement),
    target: preResolved(targetElement),
  });
  // Model.load merges the active changeset's relationships into model.relationships, and other tools
  // (model_validate, model_export, model_delete's cascade) read that merged view: reload after any staging.
  if (outcome !== "duplicate") {
    await reloadModel(rootPath);
  }
  return jsonResult({ status: outcome, changeset: active.name, ...triple, ...read });
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
    // A written relationship's only notes say how an end was read: that is in readByName.
    writtenNeedsAttention: () => false,
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
  const active = await activeStagedChangeset(manager);
  const changeset = active ?? previewChangeset();
  const graph = await ChangesetGraph.build(model, changeset);
  const plan = await planRelationshipBatch(graph, changeset, items, {
    addStatus: active ? "staged" : "added",
    specVersion: model.manifest?.specVersion,
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
    "deletion is unstaged). A list returns counts by status and attention: only the items that are invalid (with " +
    "the reason and suggestions), duplicate or restored. " +
    "attention holds up to limit items in full (default 50), the ones not written first; past that every remaining item is still listed by position under its reason (attentionNotListed), so nothing is left out. " +
    "verbose: true returns every item as results. Invalid items are skipped; the rest are still staged.",
  inputSchema: addInputSchema,
  handler: relationshipAddHandler,
};

// ---------------------------------------------------------------------------
// relationship_delete
// ---------------------------------------------------------------------------

const deleteInputSchema = {
  source: z.string().describe("Source element ID."),
  target: z.string().describe("Target element ID."),
  predicate: z.string().optional().describe("Only this predicate. Omit to remove every relationship from source to target."),
  rootPath: rootPathSchema,
};

export type RelationshipDeleteArgs = z.infer<z.ZodObject<typeof deleteInputSchema>>;

export async function relationshipDeleteHandler(args: RelationshipDeleteArgs): Promise<CallToolResult> {
  return runTool(() => withProjectWriteLock(args.rootPath, async () => {
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const active = await activeStagedChangeset(manager);

    if (!active) {
      const { deletedCount } = await deleteRelationshipHandler(
        model,
        args.source,
        args.target,
        args.predicate,
        undefined,
        "mcp"
      );
      return jsonResult({ status: "deleted", deletedCount, source: args.source, target: args.target });
    }

    const graph = await ChangesetGraph.build(model, active);
    const source = graph.resolve(args.source);
    const target = graph.resolve(args.target);
    const matches = liveRelationshipsBetween(graph, source, target, args.predicate);

    if (matches.length === 0) {
      throw new CLIError("No matching relationships found", ErrorCategory.USER, [
        `Use "model_show" on ${args.source} to see its relationships`,
        'Use "changeset_brief" to see what this changeset already stages',
      ]);
    }

    const results = await stageRelationshipDeletes(manager, graph, active, matches);
    // Staged or unstaged, the cached model's merged relationships are now stale.
    await reloadModel(args.rootPath);
    return jsonResult({ changeset: active.name, source, target, relationships: results });
  }));
}

export const relationshipDeleteTool: McpToolDefinition<typeof deleteInputSchema> = {
  name: "relationship_delete",
  description:
    "Remove relationships from source to target. In an active changeset, stages the removal, or unstages the " +
    "relationship if this changeset added it; else writes the model.",
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
