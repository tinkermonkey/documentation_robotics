/**
 * model_trace — dependency trace for an element. The MCP form of `dr trace`, with the changeset
 * projection added.
 *
 * Changeset-aware: when a changeset is active (or one is named with `changeset`), the trace runs
 * over that changeset's projected graph (`ChangesetGraph`): relationships it stages are followed,
 * relationships it deletes are not, and the result lists the added and deleted edges the trace
 * walked. Pass `base: true` to trace the committed model only.
 *
 * Which end of a relationship depends on the other comes from its predicate, not from its layers:
 * core/dependency-direction.ts holds the rule, and `dr trace` reads the same one.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import type { Changeset } from "../../core/changeset.js";
import { dependencyEnds } from "../../core/dependency-direction.js";
import type { Layer } from "../../core/layer.js";
import type { Model } from "../../core/model.js";
import { ReferenceRegistry } from "../../core/reference-registry.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { activeStagedChangeset, changesetArg, changesetArgFields, resolveChangeset } from "./changeset-shared.js";
import { countByLayerAndType } from "./model-view.js";
import { listsPager, pagingFields } from "../../core/paging.js";

/**
 * The default page of each list of a trace: 200 ids is about 10 KB, so a trace in both directions
 * stays near 40 KB. A longer list is paged; `page.totals` always has every list's true length.
 */
export const TRACE_LIST_LIMIT = 200;

const inputSchema = {
  id: z.string().describe("Element ID or path to trace."),
  direction: z
    .enum(["up", "down", "both"])
    .optional()
    .describe(
      "'up' = what depends on this element (dependents), 'down' = what this element depends on (dependencies), " +
        "'both' (default). A relationship's predicate says which end depends on the other: an element depends on " +
        "what it uses, depends-on, accesses or composes, on what serves it, and on what realizes, satisfies, " +
        "delivers or supports it. So down from a component reaches the technology that serves it and the artifacts that realize " +
        "it, down from a requirement reaches what satisfies it, and up from a function reaches the service, feature, " +
        "requirement and goal it stands under."
    ),
  depth: z.number().int().positive().optional().describe("Maximum trace depth. Omit for unlimited."),
  ...pagingFields(
    "ids of each list of the trace (direct and transitive dependents and dependencies, changedElements, changedEdges)",
    `${TRACE_LIST_LIMIT} of each`
  ),
  ...changesetArgFields(
    "Trace through this changeset's projected graph (ID or name). Defaults to the active changeset, if any."
  ),
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
    const named = changesetArg(args);
    if (args.base && named !== undefined) {
      throw new CLIError('Pass either "base" or "changeset", not both', ErrorCategory.USER);
    }

    const manager = new StagingAreaManager(model.rootPath, model);
    const changeset = args.base
      ? null
      : named
        ? await resolveChangeset(manager, named)
        : await activeStagedChangeset(manager);

    const trace = changeset ? await traceChangeset(model, changeset, args) : await traceBase(model, args);
    return jsonResult(pagedTrace(trace, args));
  });
}

/**
 * The trace with each of its lists cut to the page asked for. The walk is always whole: `page.totals`
 * gives every list's true length, and when a list is longer than the page, `summary` counts the
 * whole of each side by layer and type and `more` names the call for the next page. The same
 * offset applies to every list, so the pages together are the whole trace.
 */
function pagedTrace(trace: TraceResult, args: ModelTraceArgs): Record<string, unknown> {
  const pager = listsPager({ limit: args.limit, offset: args.offset }, TRACE_LIST_LIMIT);
  const side = (name: "dependents" | "dependencies") =>
    trace[name]
      ? {
          [name]: {
            direct: pager.cut(`${name}.direct`, trace[name]!.direct),
            transitive: pager.cut(`${name}.transitive`, trace[name]!.transitive),
          },
        }
      : {};
  const { dependents: _dependents, dependencies: _dependencies, changedElements, changedEdges, warnings, ...head } = trace;
  const paged = {
    ...head,
    ...side("dependents"),
    ...side("dependencies"),
    ...(changedElements
      ? { changedElements: Object.fromEntries(pager.cut("changedElements", Object.entries(changedElements))) }
      : {}),
    ...(changedEdges ? { changedEdges: pager.cut("changedEdges", changedEdges) } : {}),
  };
  const page = pager.page();
  // A trace that is paged at all (a list longer than one page) keeps its summary of each side on
  // every page, the last included, so whichever page a caller reads, the counts are of the whole.
  const limit = args.limit ?? TRACE_LIST_LIMIT;
  const isPaged = Object.values(page.totals).some((total) => total > limit);
  if (!isPaged) {
    return { ...paged, page, ...(warnings ? { warnings } : {}) };
  }
  const whole = (name: "dependents" | "dependencies") =>
    trace[name] ? { [name]: countByLayerAndType([...trace[name]!.direct, ...trace[name]!.transitive]) } : {};
  const more =
    page.nextOffset !== undefined
      ? `A list of this trace is longer than one page (${limit} ids): page.totals has each list's true length and ` +
        `summary counts each side by layer and type. Call model_trace again with the same arguments and offset: ` +
        `${page.nextOffset} for the next page of every list; depth: 1 gives only the direct ones.`
      : `This is the last page of a trace longer than one page (${limit} ids): page.totals has each list's true ` +
        "length and summary counts each side by layer and type.";
  return {
    ...paged,
    page,
    summary: { ...whole("dependents"), ...whole("dependencies") },
    more,
    ...(warnings ? { warnings } : {}),
  };
}

/** The committed model: cross-layer references plus relationships.yaml. */
async function traceBase(model: Model, args: ModelTraceArgs): Promise<TraceResult> {
  const layerName = await findElementLayer(model, args.id);
  if (!layerName) {
    throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, [
      'Use "model_search" to find similar elements',
    ]);
  }

  // Cross-layer references the elements carry, then the relationships of relationships.yaml.
  const graph = new DependencyGraph();
  graph.addReferences(model.layers.values());
  for (const rel of model.getBaseRelationships()) graph.add(rel);

  const { trace } = runTrace(graph, args.id, args);
  return { id: args.id, layer: layerName, ...trace };
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

  const graph = new DependencyGraph();
  graph.addReferences(await projectedLayers(model, changeset, warnings));
  for (const rel of projected.relationships()) {
    // A removed relationship is not followed. It stays in the graph so the trace can say which
    // ones it would have walked. Only the root's own come back when the root itself is deleted.
    const follow = rel.status !== "deleted" || (followDeleted && (rel.source === root.id || rel.target === root.id));
    graph.add(rel, { status: rel.status, follow });
  }

  const { trace, reached, edges } = runTrace(graph, root.id, args);

  const changedElements: Record<string, string> = {};
  for (const id of reached) {
    const status = projected.getElement(id)?.status;
    if (status && status !== "unchanged") changedElements[id] = status;
  }
  // Only what the trace walked (#1203): the added edges it followed and the removed ones it met
  // on the way, not every staged edge that touches an element it reached.
  const changedEdges = edges
    .filter((edge) => edge.status === "added" || edge.status === "deleted")
    .map((edge) => ({ source: edge.source, predicate: edge.predicate, target: edge.target, status: edge.status! }));

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

/** A relationship or cross-layer reference, as modelled, with its standing in the changeset. */
export interface TraceEdge {
  source: string;
  predicate: string;
  target: string;
  status?: string;
  /** False for an edge the changeset removes: reported where the trace meets it, never walked. */
  follow: boolean;
}

/**
 * The model's relationships as dependencies: each edge filed under the element that depends and
 * under the element depended on, by its predicate.
 */
export class DependencyGraph {
  /** Edges by the element that depends, and by the element depended on. */
  readonly dependencies = new Map<string, TraceEdge[]>();
  readonly dependents = new Map<string, TraceEdge[]>();
  private readonly byKey = new Map<string, TraceEdge>();

  /**
   * Adds an edge once. The same source, predicate and target given again with a standing (a
   * relationship that repeats a cross-layer reference an element carries) keeps the one edge and
   * takes that standing, so a staged or removed relationship is not hidden by the reference.
   */
  add(
    rel: { source: string; predicate: string; target: string },
    standing: { status?: string; follow?: boolean } = {}
  ): void {
    const key = `${rel.source}\0${rel.predicate}\0${rel.target}`;
    const existing = this.byKey.get(key);
    if (existing) {
      if (standing.status) existing.status = standing.status;
      if (standing.follow !== undefined) existing.follow = standing.follow;
      return;
    }
    const edge: TraceEdge = {
      source: rel.source,
      predicate: rel.predicate,
      target: rel.target,
      ...(standing.status ? { status: standing.status } : {}),
      follow: standing.follow ?? true,
    };
    this.byKey.set(key, edge);
    const { dependent, dependency } = dependencyEnds(edge);
    push(this.dependencies, dependent, edge);
    push(this.dependents, dependency, edge);
  }

  /** The cross-layer references the elements of these layers carry. */
  addReferences(layers: Iterable<Layer>): void {
    const registry = new ReferenceRegistry();
    for (const layer of layers) {
      for (const element of layer.listElements()) registry.registerElement(element);
    }
    for (const ref of registry.getAllReferences()) {
      this.add({ source: ref.source, predicate: ref.type, target: ref.target });
    }
  }
}

function push(map: Map<string, TraceEdge[]>, key: string, edge: TraceEdge): void {
  const list = map.get(key);
  if (list) list.push(edge);
  else map.set(key, [edge]);
}

/**
 * Breadth-first from `start` along one side of the graph: the elements at one hop (direct), the
 * rest within `maxDepth` (transitive), and every edge met on the way, walked or removed.
 */
function walk(
  start: string,
  edgesOf: Map<string, TraceEdge[]>,
  otherEnd: (edge: TraceEdge) => string,
  maxDepth: number | null
): { direct: string[]; transitive: string[]; edges: TraceEdge[] } {
  const depthOf = new Map<string, number>([[start, 0]]);
  const edges: TraceEdge[] = [];
  let frontier = [start];
  for (let depth = 1; frontier.length > 0 && (maxDepth === null || depth <= maxDepth); depth++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const edge of edgesOf.get(node) ?? []) {
        edges.push(edge);
        if (!edge.follow) continue;
        const other = otherEnd(edge);
        if (depthOf.has(other)) continue;
        depthOf.set(other, depth);
        next.push(other);
      }
    }
    frontier = next;
  }
  const direct: string[] = [];
  const transitive: string[] = [];
  for (const [id, depth] of depthOf) {
    if (depth === 1) direct.push(id);
    else if (depth > 1) transitive.push(id);
  }
  return { direct, transitive, edges };
}

function runTrace(
  graph: DependencyGraph,
  id: string,
  args: ModelTraceArgs
): {
  trace: Pick<TraceResult, "direction" | "dependents" | "dependencies">;
  /** The traced element and everything the trace reached. */
  reached: Set<string>;
  /** Every edge the trace met, once each. */
  edges: TraceEdge[];
} {
  const direction = args.direction ?? "both";
  const maxDepth = args.depth ?? null;
  const trace: Pick<TraceResult, "direction" | "dependents" | "dependencies"> = { direction };
  const reached = new Set<string>([id]);
  const edges = new Set<TraceEdge>();
  const keep = (side: { direct: string[]; transitive: string[]; edges: TraceEdge[] }) => {
    for (const reachedId of [...side.direct, ...side.transitive]) reached.add(reachedId);
    for (const edge of side.edges) edges.add(edge);
    return { direct: side.direct, transitive: side.transitive };
  };

  if (direction === "up" || direction === "both") {
    trace.dependents = keep(walk(id, graph.dependents, (edge) => dependencyEnds(edge).dependent, maxDepth));
  }
  if (direction === "down" || direction === "both") {
    trace.dependencies = keep(walk(id, graph.dependencies, (edge) => dependencyEnds(edge).dependency, maxDepth));
  }
  return { trace, reached, edges: [...edges] };
}

export const modelTraceTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_trace",
  description:
    "Trace dependents and/or dependencies of an element across cross-layer references and relationships. Which " +
    "end depends on the other comes from the predicate: an element depends on what it uses, accesses or composes, " +
    "on what serves it, and on what realizes, satisfies, delivers or supports it. So direction down from a component reaches " +
    "the technology that serves it and whatever realizes it, down from a requirement or goal reaches what " +
    "implements it, and direction up from a function reaches the service, feature, requirement and goal it stands " +
    "under. With an active changeset (or changeset) it traces the changeset's projected graph: staged " +
    "relationships are followed, staged removals are not, and changedEdges / changedElements mark what the " +
    "changeset adds or deletes among the edges walked and the elements reached. The walk is always whole; each " +
    `list is returned ${TRACE_LIST_LIMIT} ids a page (limit, offset), with page.totals the true length of every list and ` +
    "page.nextOffset when one has more.",
  inputSchema,
  handler: modelTraceHandler,
};
