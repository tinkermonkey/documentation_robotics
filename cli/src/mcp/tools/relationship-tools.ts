/**
 * relationship_add, relationship_delete — stage (or write) relationships. Mirror
 * `dr relationship add|delete`, validated against the relationship catalog.
 *
 * Inside an active changeset both tools read the changeset's projected graph, so they work between
 * elements that exist only in the changeset, report a repeated add as a duplicate rather than
 * staging it twice, and undo instead of stacking: deleting a relationship this changeset added
 * unstages the add, and re-adding one it deleted unstages the delete. The projected-graph logic is
 * shared with the CLI (`cli/src/core/relationship-staging.ts`).
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { liveRelationshipsBetween, stageRelationshipDeletes } from "../../core/relationship-staging.js";
import { addRelationship, deleteRelationshipHandler } from "../../commands/relationship.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { activeStagedChangeset } from "./changeset-shared.js";

// ---------------------------------------------------------------------------
// relationship_add
// ---------------------------------------------------------------------------

const addInputSchema = {
  source: z.string().describe("Source element ID (layer.type.name)."),
  predicate: z
    .string()
    .describe("Relationship predicate, e.g. 'realizes', 'serves', 'accesses'. Use spec_type to see what the catalog allows."),
  target: z.string().describe("Target element ID (layer.type.name)."),
  properties: z.record(z.string(), z.unknown()).optional().describe("Optional relationship properties."),
  rootPath: rootPathSchema,
};

export type RelationshipAddArgs = z.infer<z.ZodObject<typeof addInputSchema>>;

export async function relationshipAddHandler(args: RelationshipAddArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const active = await activeStagedChangeset(manager);

    if (!active) {
      const outcome = await addRelationship(model, args.source, args.target, args.predicate, args.properties);
      return jsonResult({
        status: outcome,
        source: args.source,
        predicate: args.predicate,
        target: args.target,
      });
    }

    // Resolve the ends in the projection first, for a clear error when the changeset deletes one.
    const graph = await ChangesetGraph.build(model, active);
    const source = liveElementId(graph, args.source, "Source");
    const target = liveElementId(graph, args.target, "Target");
    const triple = { source, predicate: args.predicate, target };

    const outcome = await addRelationship(model, source, target, args.predicate, args.properties);
    // Model.load merges the active changeset's relationships into model.relationships, and other tools
    // (model_validate, model_export, model_delete's cascade) read that merged view: reload after any staging.
    if (outcome !== "duplicate") {
      await reloadModel(args.rootPath);
    }
    return jsonResult({ status: outcome, changeset: active.name, ...triple });
  });
}

export const relationshipAddTool: McpToolDefinition<typeof addInputSchema> = {
  name: "relationship_add",
  description:
    "Add a relationship between two elements, validated against the relationship catalog. Stages it in the " +
    "active changeset when there is one (including between elements the changeset itself adds), else writes the model. " +
    "Status: 'staged' or 'added'; 'duplicate' when the model or the changeset already has it (nothing staged); " +
    "'restored' when the changeset had staged its deletion (that deletion is unstaged).",
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
      const { deletedCount } = await deleteRelationshipHandler(model, args.source, args.target, args.predicate);
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

function liveElementId(graph: ChangesetGraph, id: string, role: "Source" | "Target"): string {
  const element = graph.getElement(id);
  if (!element || element.status === "deleted") {
    throw new CLIError(
      `${role} element ${id} not found${element ? " (this changeset deletes it)" : ""}`,
      ErrorCategory.USER,
      ['Use "model_search" to find elements, or "changeset_brief" to see what this changeset adds']
    );
  }
  return element.id;
}
