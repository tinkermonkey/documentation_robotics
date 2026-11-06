/**
 * relationship_add, relationship_delete — stage (or write) relationships. Mirror
 * `dr relationship add|delete`, validated against the relationship catalog.
 *
 * Inside an active changeset both tools read the changeset's projected graph, so they work between
 * elements that exist only in the changeset, report a repeated add as a duplicate rather than
 * staging it twice, and undo instead of stacking: deleting a relationship this changeset added
 * unstages the add, and re-adding one it deleted unstages the delete.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ChangesetGraph, type GraphRelationship } from "../../core/changeset-graph.js";
import type { Changeset } from "../../core/changeset.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { addRelationshipHandler, deleteRelationshipHandler } from "../../commands/relationship.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
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
      const added = await addRelationshipHandler(model, args.source, args.target, args.predicate, args.properties);
      return jsonResult({
        status: added ? "added" : "duplicate",
        source: args.source,
        predicate: args.predicate,
        target: args.target,
      });
    }

    const graph = await ChangesetGraph.build(model, active);
    const source = liveElementId(graph, args.source, "Source");
    const target = liveElementId(graph, args.target, "Target");
    const triple = { source, predicate: args.predicate, target };
    const existing = graph.getRelationship(source, args.predicate, target);

    if (existing && existing.status !== "deleted") {
      return jsonResult({ status: "duplicate", changeset: active.name, ...triple });
    }

    if (existing?.status === "deleted") {
      // This changeset deleted it; take the deletion back out instead of staging an add on top.
      for (const key of stagedKeys(graph, active, "relationship-delete", triple)) {
        await manager.unstage(active.id, key);
      }
      return jsonResult({ status: "restored", changeset: active.name, ...triple });
    }

    await addRelationshipHandler(model, source, target, args.predicate, args.properties);
    return jsonResult({ status: "staged", changeset: active.name, ...triple });
  });
}

export const relationshipAddTool: McpToolDefinition<typeof addInputSchema> = {
  name: "relationship_add",
  description:
    "Add a relationship between two elements, validated against the relationship catalog. Stages it in the " +
    "active changeset when there is one (including between elements the changeset itself adds), else writes the model.",
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
    const matches = graph
      .relationships()
      .filter(
        (rel) =>
          rel.status !== "deleted" &&
          rel.source === source &&
          rel.target === target &&
          (!args.predicate || rel.predicate === args.predicate)
      );

    if (matches.length === 0) {
      throw new CLIError("No matching relationships found", ErrorCategory.USER, [
        `Use "model_show" on ${args.source} to see its relationships`,
        'Use "changeset_brief" to see what this changeset already stages',
      ]);
    }

    const results: Array<{ status: "staged" | "unstaged"; predicate: string }> = [];
    for (const rel of matches) {
      if (rel.status === "added") {
        for (const key of stagedKeys(graph, active, "relationship-add", rel)) {
          await manager.unstage(active.id, key);
        }
        results.push({ status: "unstaged", predicate: rel.predicate });
      } else {
        await stageDelete(manager, active, rel);
        results.push({ status: "staged", predicate: rel.predicate });
      }
    }

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

/** Keys of the staged relationship changes of `type` that name `rel`, however their ends are spelled. */
function stagedKeys(
  graph: ChangesetGraph,
  changeset: Changeset,
  type: "relationship-add" | "relationship-delete",
  rel: { source: string; predicate: string; target: string }
): string[] {
  const keys = new Set<string>();
  for (const change of changeset.changes) {
    if (change.type !== type) continue;
    const data = (change.after ?? change.before) as Partial<GraphRelationship> | undefined;
    const [source, predicate, target] = data?.source
      ? [data.source, data.predicate, data.target]
      : change.elementId.split("::");
    if (
      source &&
      target &&
      predicate === rel.predicate &&
      graph.resolve(source) === rel.source &&
      graph.resolve(target) === rel.target
    ) {
      keys.add(change.elementId);
    }
  }
  return [...keys];
}

async function stageDelete(manager: StagingAreaManager, changeset: Changeset, rel: GraphRelationship): Promise<void> {
  // Name the row the way relationships.yaml does, so the commit finds it.
  const source = rel.raw?.source ?? rel.source;
  const target = rel.raw?.target ?? rel.target;
  await manager.stage(changeset.id, {
    type: "relationship-delete",
    elementId: `${source}::${rel.predicate}::${target}`,
    layerName: rel.layer,
    before: {
      source,
      target,
      predicate: rel.predicate,
      layer: rel.layer,
      ...(rel.targetLayer ? { targetLayer: rel.targetLayer } : {}),
      ...(rel.properties ? { properties: rel.properties } : {}),
    },
  });
}
