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
 * relationship_add also takes a list (`relationships`): every item is checked against the catalog
 * and the projection, the valid ones are staged in one write, and the result reports each item.
 */

import { z } from "zod";
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
  countByStatus,
  liveRelationshipsBetween,
  planRelationshipBatch,
  stageRelationshipDeletes,
  type RelationshipBatchItem,
  type RelationshipBatchPlan,
} from "../../core/relationship-staging.js";
import { addRelationship, deleteRelationshipHandler } from "../../commands/relationship.js";
import { ModelReportOrchestrator } from "../../reports/model-report-orchestrator.js";
import { emitLog, SeverityNumber } from "../../telemetry/index.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { activeStagedChangeset } from "./changeset-shared.js";

// ---------------------------------------------------------------------------
// relationship_add
// ---------------------------------------------------------------------------

export const relationshipItemSchema = strictItem("A relationships[] item", {
  source: z.string().describe("Source element ID (layer.type.name)."),
  predicate: z.string().describe("Relationship predicate."),
  target: z.string().describe("Target element ID (layer.type.name)."),
  properties: z.record(z.string(), z.unknown()).optional().describe("Optional relationship properties."),
});

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
  relationships: z
    .array(relationshipItemSchema)
    .optional()
    .describe(
      "Batch form, instead of source/predicate/target: a list of {source, predicate, target, properties?}, staged in " +
        "one write. Each item is checked on its own; an invalid one is skipped and reported, the rest are staged."
    ),
  rootPath: rootPathSchema,
};

export type RelationshipAddArgs = z.infer<z.ZodObject<typeof addInputSchema>>;

export async function relationshipAddHandler(args: RelationshipAddArgs): Promise<CallToolResult> {
  return runTool(async () => {
    if (args.relationships !== undefined) {
      const singleFields = [args.source, args.predicate, args.target, args.properties];
      if (singleFields.some((field) => field !== undefined)) {
        throw new CLIError("Send either source/predicate/target or relationships, not both", ErrorCategory.USER, [
          "Put the single relationship in the relationships list too",
        ]);
      }
      return jsonResult(await addRelationshipBatch(args.relationships, args.rootPath));
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
  });
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

  if (!active) {
    const outcome = await addRelationship(model, sourceId, targetId, predicate, properties);
    return jsonResult({ status: outcome, source: sourceId, predicate, target: targetId });
  }

  // Resolve the ends in the projection first, for a clear error when the changeset deletes one.
  const graph = await ChangesetGraph.build(model, active);
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
  return jsonResult({ status: outcome, changeset: active.name, ...triple });
}

/** What a batch did, for the tool result. */
export interface RelationshipBatchSummary {
  changeset?: string;
  counts: Record<string, number>;
  results: RelationshipBatchPlan["results"];
}

/** relationship_add's batch form: check every item, then stage the valid ones in one write. */
export async function addRelationshipBatch(
  items: RelationshipBatchItem[],
  rootPath?: string
): Promise<RelationshipBatchSummary> {
  const model = await loadModel(rootPath);
  const manager = new StagingAreaManager(model.rootPath, model);
  const active = await activeStagedChangeset(manager);
  const changeset = active ?? previewChangeset();
  const graph = await ChangesetGraph.build(model, changeset);
  const plan = await planRelationshipBatch(graph, changeset, items, { addStatus: active ? "staged" : "added" });
  await applyRelationshipPlan(model, manager, active, plan, []);
  if (plan.changes.length > 0 || plan.unstageKeys.length > 0) {
    await reloadModel(rootPath);
  }
  return { ...(active ? { changeset: active.name } : {}), counts: countByStatus(plan.results), results: plan.results };
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
    "one write, so use it when wiring several. Single status: 'staged' or 'added'; 'duplicate' when the model or " +
    "the changeset already has it (nothing staged); 'restored' when the changeset had staged its deletion (that " +
    "deletion is unstaged). A list returns counts and a result per item: staged (added, with no changeset " +
    "active), restored, duplicate, or invalid with the reason and suggestions. Invalid items are skipped; the rest " +
    "are still staged.",
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
  return runTool(async () => {
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
  });
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
