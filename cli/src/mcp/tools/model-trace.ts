/**
 * model_trace — dependency trace for an element. Mirrors `dr trace`.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DependencyTracker, TraceDirection } from "../../core/dependency-tracker.js";
import { ReferenceRegistry } from "../../core/reference-registry.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  id: z.string().describe("Element ID or path to trace."),
  direction: z
    .enum(["up", "down", "both"])
    .optional()
    .describe("'up' = what depends on this element (dependents), 'down' = what this element depends on (dependencies), 'both' (default)."),
  depth: z.number().int().positive().optional().describe("Maximum trace depth. Omit for unlimited."),
  rootPath: rootPathSchema,
};

export type ModelTraceArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function modelTraceHandler(args: ModelTraceArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);

    const layerName = await findElementLayer(model, args.id);
    if (!layerName) {
      throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, [
        'Use "model_search" to find similar elements',
      ]);
    }

    // Build a reference registry from cross-layer references, then extend the
    // dependency graph with intra-layer relationships from relationships.yaml.
    const registry = new ReferenceRegistry();
    for (const layer of model.layers.values()) {
      for (const element of layer.listElements()) {
        registry.registerElement(element);
      }
    }

    const graph = registry.getDependencyGraph();
    for (const rel of model.relationships.getAll()) {
      if (!graph.hasNode(rel.source)) graph.addNode(rel.source);
      if (!graph.hasNode(rel.target)) graph.addNode(rel.target);
      if (!graph.hasEdge(rel.source, rel.target)) {
        graph.addEdge(rel.source, rel.target, { type: rel.predicate });
      }
    }

    const tracker = new DependencyTracker(graph, model);
    const direction = args.direction ?? "both";
    const maxDepth = args.depth ?? null;

    const result: {
      id: string;
      layer: string;
      direction: string;
      dependents?: { direct: string[]; transitive: string[] };
      dependencies?: { direct: string[]; transitive: string[] };
    } = { id: args.id, layer: layerName, direction };

    if (direction === "up" || direction === "both") {
      const direct = tracker.traceDependencies(args.id, TraceDirection.DOWN, 1);
      const transitiveAll = tracker.traceDependencies(args.id, TraceDirection.DOWN, maxDepth);
      result.dependents = {
        direct,
        transitive: transitiveAll.filter((d) => !direct.includes(d)),
      };
    }

    if (direction === "down" || direction === "both") {
      const direct = tracker.traceDependencies(args.id, TraceDirection.UP, 1);
      const transitiveAll = tracker.traceDependencies(args.id, TraceDirection.UP, maxDepth);
      result.dependencies = {
        direct,
        transitive: transitiveAll.filter((d) => !direct.includes(d)),
      };
    }

    return jsonResult(result);
  });
}

export const modelTraceTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_trace",
  description: "Trace dependents and/or dependencies of an element across cross-layer references and relationships.",
  inputSchema,
  handler: modelTraceHandler,
};
