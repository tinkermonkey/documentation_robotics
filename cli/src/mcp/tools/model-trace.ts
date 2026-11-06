/**
 * model_trace — dependency trace for an element. Mirrors `dr trace`.
 *
 * Changeset-aware: when a changeset is active (or one is named with `changesetId`), the trace runs
 * over that changeset's projected graph (`ChangesetGraph`): relationships it stages are followed,
 * relationships it deletes are not, and the result lists the added and deleted edges that touch
 * the traced elements. Pass `base: true` to trace the committed model only.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type Graph from "graphology";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import type { Changeset } from "../../core/changeset.js";
import { DependencyTracker, TraceDirection } from "../../core/dependency-tracker.js";
import type { Layer } from "../../core/layer.js";
import type { Model } from "../../core/model.js";
import { ReferenceRegistry } from "../../core/reference-registry.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { activeStagedChangeset, resolveChangeset } from "./changeset-shared.js";

const inputSchema = {
  id: z.string().describe("Element ID or path to trace."),
  direction: z
    .enum(["up", "down", "both"])
    .optional()
    .describe("'up' = what depends on this element (dependents), 'down' = what this element depends on (dependencies), 'both' (default)."),
  depth: z.number().int().positive().optional().describe("Maximum trace depth. Omit for unlimited."),
  changesetId: z
    .string()
    .optional()
    .describe("Trace through this changeset's projected graph (ID or name). Defaults to the active changeset, if any."),
  base: z.boolean().optional().describe("Trace the committed base model only, ignoring any active changeset."),
  rootPath: rootPathSchema,
};

export type ModelTraceArgs = z.infer<z.ZodObject<typeof inputSchema>>;

interface TraceResult {
  id: string;
  layer: string;
  direction: string;
  dependents?: { direct: string[]; transitive: string[] };
  dependencies?: { direct: string[]; transitive: string[] };
  changeset?: { id: string; name: string; elementStatus: string };
  changedElements?: Record<string, string>;
  changedEdges?: Array<{ source: string; predicate: string; target: string; status: string }>;
  warnings?: string[];
}

export async function modelTraceHandler(args: ModelTraceArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    if (args.base && args.changesetId) {
      throw new CLIError('Pass either "base" or "changesetId", not both', ErrorCategory.USER);
    }

    const manager = new StagingAreaManager(model.rootPath, model);
    const changeset = args.base
      ? null
      : args.changesetId
        ? await resolveChangeset(manager, args.changesetId)
        : await activeStagedChangeset(manager);

    return jsonResult(changeset ? await traceChangeset(model, changeset, args) : await traceBase(model, args));
  });
}

/** The committed model: cross-layer references plus relationships.yaml. */
async function traceBase(model: Model, args: ModelTraceArgs): Promise<TraceResult> {
  const layerName = await findElementLayer(model, args.id);
  if (!layerName) {
    throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, [
      'Use "model_search" to find similar elements',
    ]);
  }

  // Build a reference registry from cross-layer references, then extend the
  // dependency graph with intra-layer relationships from relationships.yaml.
  const graph = referenceGraph(model.layers.values());
  for (const rel of model.getBaseRelationships()) {
    addEdge(graph, rel.source, rel.target, rel.predicate);
  }

  return { id: args.id, layer: layerName, ...runTrace(graph, model, args.id, args) };
}

/** A changeset's projection: its elements' references plus base and staged relationships, minus staged removals. */
async function traceChangeset(model: Model, changeset: Changeset, args: ModelTraceArgs): Promise<TraceResult> {
  const projected = await ChangesetGraph.build(model, changeset);
  const root = projected.getElement(args.id);
  if (!root) {
    throw new CLIError(`Element ${args.id} not found in changeset '${changeset.name}' or the base model`, ErrorCategory.NOT_FOUND, [
      'Use "model_search" to find similar elements',
      'Pass "base": true to trace the committed model only',
    ]);
  }

  const warnings: string[] = [];
  // Tracing an element the changeset deletes follows the edges it had: that is what the delete breaks.
  const followDeleted = root.status === "deleted";
  if (followDeleted) {
    warnings.push(`${root.id} is deleted by this changeset; the trace follows the relationships it has today`);
  }

  const layers = await projectedLayers(model, changeset, warnings);
  const graph = referenceGraph(layers);
  for (const rel of projected.relationships()) {
    if (rel.status === "deleted" && !followDeleted) continue;
    addEdge(graph, rel.source, rel.target, rel.predicate);
  }

  const trace = runTrace(graph, model, root.id, args);
  const reached = new Set<string>([root.id]);
  for (const side of [trace.dependents, trace.dependencies]) {
    for (const id of [...(side?.direct ?? []), ...(side?.transitive ?? [])]) reached.add(id);
  }

  const changedElements: Record<string, string> = {};
  for (const id of reached) {
    const status = projected.getElement(id)?.status;
    if (status && status !== "unchanged") changedElements[id] = status;
  }
  const changedEdges = projected
    .changedRelationships()
    .filter((rel) => reached.has(rel.source) || reached.has(rel.target))
    .map((rel) => ({ source: rel.source, predicate: rel.predicate, target: rel.target, status: rel.status }));

  return {
    id: root.id,
    layer: root.layer,
    ...trace,
    changeset: { id: changeset.id!, name: changeset.name, elementStatus: root.status },
    changedElements,
    changedEdges,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * The changeset's projected layers, for the cross-layer references its elements carry. A layer
 * that fails to project falls back to its base version, with a warning.
 */
async function projectedLayers(model: Model, changeset: Changeset, warnings: string[]): Promise<Layer[]> {
  const names = new Set<string>(model.getLayerNames());
  for (const change of changeset.changes) {
    if (!change.type.startsWith("relationship-")) names.add(change.layerName);
  }
  const isActive = model.getActiveChangesetId() === changeset.id;
  const layers: Layer[] = [];
  for (const name of names) {
    try {
      const layer = isActive
        ? await model.getLayer(name)
        : await model.getVirtualProjectionEngine().projectLayer(model, changeset.id!, name);
      if (layer) layers.push(layer);
    } catch (error) {
      warnings.push(`Layer ${name} could not be projected (${getErrorMessage(error)}); its base references were used`);
      const base = await model.getBaseLayer(name);
      if (base) layers.push(base);
    }
  }
  return layers;
}

function referenceGraph(layers: Iterable<Layer>): Graph {
  const registry = new ReferenceRegistry();
  for (const layer of layers) {
    for (const element of layer.listElements()) {
      registry.registerElement(element);
    }
  }
  return registry.getDependencyGraph();
}

function addEdge(graph: Graph, source: string, target: string, predicate: string): void {
  if (!graph.hasNode(source)) graph.addNode(source);
  if (!graph.hasNode(target)) graph.addNode(target);
  if (!graph.hasEdge(source, target)) {
    graph.addEdge(source, target, { type: predicate });
  }
}

function runTrace(
  graph: Graph,
  model: Model,
  id: string,
  args: ModelTraceArgs
): Pick<TraceResult, "direction" | "dependents" | "dependencies"> {
  const tracker = new DependencyTracker(graph, model);
  const direction = args.direction ?? "both";
  const maxDepth = args.depth ?? null;
  const result: Pick<TraceResult, "direction" | "dependents" | "dependencies"> = { direction };

  if (direction === "up" || direction === "both") {
    const direct = tracker.traceDependencies(id, TraceDirection.DOWN, 1);
    const transitiveAll = tracker.traceDependencies(id, TraceDirection.DOWN, maxDepth);
    result.dependents = { direct, transitive: transitiveAll.filter((d) => !direct.includes(d)) };
  }

  if (direction === "down" || direction === "both") {
    const direct = tracker.traceDependencies(id, TraceDirection.UP, 1);
    const transitiveAll = tracker.traceDependencies(id, TraceDirection.UP, maxDepth);
    result.dependencies = { direct, transitive: transitiveAll.filter((d) => !direct.includes(d)) };
  }

  return result;
}

export const modelTraceTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_trace",
  description:
    "Trace dependents and/or dependencies of an element across cross-layer references and relationships. " +
    "With an active changeset (or changesetId) it traces the changeset's projected graph: staged relationships are " +
    "followed, staged removals are not, and changedEdges / changedElements mark what the changeset adds or deletes.",
  inputSchema,
  handler: modelTraceHandler,
};
