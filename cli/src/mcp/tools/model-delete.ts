/**
 * model_delete — delete an element (optionally cascading to dependents).
 * Mirrors `dr delete --force`, since an MCP session has no interactive
 * confirmation channel; operates through the shared MutationHandler.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DependencyTracker, TraceDirection } from "../../core/dependency-tracker.js";
import { MutationHandler } from "../../core/mutation-handler.js";
import { ReferenceRegistry } from "../../core/reference-registry.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

export interface ModelDeleteArgs {
  id: string;
  cascade?: boolean;
  force?: boolean;
  dryRun?: boolean;
  rootPath?: string;
}

const inputSchema = {
  id: z.string().describe("Element ID or path to delete."),
  cascade: z.boolean().optional().describe("Also delete elements that depend on this one."),
  force: z.boolean().optional().describe("Skip the dependency check and delete only this element, even if others depend on it."),
  dryRun: z.boolean().optional().describe("Preview what would be deleted without making changes."),
  rootPath: rootPathSchema,
};

export async function modelDeleteHandler(args: ModelDeleteArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);

    const layerName = await findElementLayer(model, args.id);
    if (!layerName) {
      throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, [
        'Use "model_search" to find similar elements',
      ]);
    }

    const layer = (await model.getLayer(layerName))!;
    const element = layer.getElement(args.id);
    if (!element) {
      throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, [
        'Use "model_search" to find similar elements',
      ]);
    }

    // Cascade is scoped to cross-layer references only, matching `dr delete`. This is
    // narrower than "model_trace", which also follows intra-layer relationships.yaml
    // edges — a dependent found by model_trace may not be included in a cascade delete.
    const registry = new ReferenceRegistry();
    for (const l of model.layers.values()) {
      for (const el of l.listElements()) {
        registry.registerElement(el);
      }
    }
    const tracker = new DependencyTracker(registry, model);
    const dependents = tracker.traceDependencies(args.id, TraceDirection.DOWN, null);

    if (dependents.length > 0 && !args.cascade && !args.force) {
      throw new CLIError("Element has dependencies", ErrorCategory.USER, [
        "Use cascade=true to remove all dependent elements",
        "Use dryRun=true with cascade=true to preview what would be deleted",
        "Or use force=true to remove only this element (dependencies will reference a non-existent element)",
      ]);
    }

    const elementsToRemove = args.cascade ? [args.id, ...dependents] : [args.id];

    if (args.dryRun) {
      return jsonResult({
        status: "dry-run",
        id: args.id,
        layer: layerName,
        elementsToRemove,
      });
    }

    let deletedCount = 0;
    const skippedDependents: string[] = [];
    if (args.cascade && dependents.length > 0) {
      for (const depId of [...dependents].reverse()) {
        const depLayerName = await findElementLayer(model, depId);
        if (!depLayerName) {
          console.error(`[mcp] model_delete: cascade dependent "${depId}" not found, skipping`);
          skippedDependents.push(depId);
          continue;
        }

        const depLayer = (await model.getLayer(depLayerName))!;
        const depElement = depLayer.getElement(depId);
        if (!depElement) {
          console.error(`[mcp] model_delete: cascade dependent "${depId}" not found, skipping`);
          skippedDependents.push(depId);
          continue;
        }

        const depHandler = new MutationHandler(model, depId, depLayerName);
        await depHandler.executeDelete(depElement);
        deletedCount++;
      }
    }

    const mutationHandler = new MutationHandler(model, args.id, layerName);
    await mutationHandler.executeDelete(element);

    const stagingManager = mutationHandler.getStagingManager();
    const activeChangeset = await stagingManager.getActive();
    const staged = !!(activeChangeset && activeChangeset.status === "staged");

    return jsonResult({
      status: staged ? "staged" : "deleted",
      changeset: staged ? activeChangeset!.name : undefined,
      id: args.id,
      layer: layerName,
      cascadedDeletes: deletedCount,
      ...(skippedDependents.length > 0 ? { skippedDependents } : {}),
    });
  });
}

export const modelDeleteTool: McpToolDefinition<ModelDeleteArgs> = {
  name: "model_delete",
  description: "Delete an element, optionally cascading to elements that depend on it.",
  inputSchema,
  handler: modelDeleteHandler,
};
