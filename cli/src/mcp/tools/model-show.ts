/**
 * model_show — show an element with its relationships. Mirrors `dr show`.
 *
 * `id` reads one element whole. `ids` reads several in one call (#1395): a compact card each
 * (`elementCard`: name, the first sentence of its description, its change status and its
 * connections as lines), or with `detail: "full"` each as `id` returns it, a page at a time with the
 * true count. Ids not in the model are listed apart, never dropped.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { acceptedGapsWithEvidence } from "../../core/accepted-gaps.js";
import type { Changeset } from "../../core/changeset.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import type { Model } from "../../core/model.js";
import { nextPageHint, pageOf } from "../../core/paging.js";
import { normalizeNodeType } from "../../generated/node-types.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { activeStagedChangeset } from "./changeset-shared.js";
import { elementCard, graphConnections, CARD_CONNECTIONS, type CardConnection } from "./element-card.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

/** Elements per page of an ids read by default: compact cards, or whole elements with their relationships. */
export const SHOW_IDS_LIMITS = { compact: 25, full: 5 } as const;

const inputSchema = {
  id: z.string().optional().describe("Element ID or path (e.g. 'api.operation.create-order'). Use id or ids."),
  ids: z
    .array(z.string())
    .min(1)
    .optional()
    .describe(
      "Several element ids or paths, read in one call: a compact card each (name, first sentence of the " +
        "description, change status, connections as `predicate → id` lines, a few per predicate and the rest " +
        'counted), or with detail: "full" each as id returns it. Ids not in the model are listed in notFound.'
    ),
  detail: z
    .enum(["compact", "full"])
    .optional()
    .describe(`With ids: "compact" (default, ${SHOW_IDS_LIMITS.compact} a page) or "full" (${SHOW_IDS_LIMITS.full} a page).`),
  maxConnections: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(`With ids, compact: connections listed per predicate and direction on a card (default ${CARD_CONNECTIONS}).`),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `With ids: the most elements in one call (default ${SHOW_IDS_LIMITS.compact} compact, ${SHOW_IDS_LIMITS.full} full). ` +
        "A page size, not a cut-off: page.total is the true count and page.nextOffset the next page."
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("With ids: skip this many: repeat the call with the previous result's page.nextOffset."),
  rootPath: rootPathSchema,
};

export type ModelShowArgs = z.infer<z.ZodObject<typeof inputSchema>>;

const NOT_FOUND_HINTS = ['Use "model_search" to find similar elements', 'Use "model_list" to list all elements in a layer'];

/** The model as model_show reads it: the active changeset's projection when one is active. */
interface ShowView {
  model: Model;
  active: Changeset | null;
  graph?: ChangesetGraph;
}

async function showView(model: Model): Promise<ShowView> {
  const active = await activeStagedChangeset(new StagingAreaManager(model.rootPath, model));
  return { model, active, ...(active ? { graph: await ChangesetGraph.build(model, active) } : {}) };
}

/** The element at `id` in the view, or undefined when the model has none. */
async function findElement(view: ShowView, id: string) {
  const layerName = await findElementLayer(view.model, id);
  if (!layerName) return undefined;
  const layer = await view.model.getLayer(layerName);
  const element = layer?.getElement(id);
  return layer && element ? { layerName, element } : undefined;
}

/** One element whole, as `id` returns it. */
async function showOne(view: ShowView, id: string): Promise<Record<string, unknown> | undefined> {
  const found = await findElement(view, id);
  if (!found) return undefined;
  const { layerName, element } = found;
  const elementId = element.path || element.id;

  // Inside an active changeset, show the element's relationships as the changeset leaves them:
  // staged additions included, staged removals marked, each with its change status.
  if (view.active && view.graph) {
    const graph = view.graph;
    const graphElement = graph.getElement(elementId);
    const neighbors = graph.neighbors(elementId, { includeDeleted: true });
    const row = (n: (typeof neighbors)[number]) => {
      const rel = n.relationship;
      return {
        source: rel.source,
        predicate: rel.predicate,
        target: rel.target,
        layer: rel.layer,
        ...(rel.targetLayer ? { targetLayer: rel.targetLayer } : {}),
        ...(rel.properties ? { properties: rel.properties } : {}),
        status: rel.status,
      };
    };
    const acceptedGaps = acceptedGapsWithEvidence(
      element.acceptedGaps(),
      neighbors
        .filter((n) => n.relationship.status !== "deleted")
        .flatMap((n) => {
          const other = graph.getElement(n.other);
          if (!other || other.status === "deleted") return [];
          return [{ ...n.relationship, direction: n.direction, otherType: `${other.layer}.${normalizeNodeType(other.layer, other.type)}` }];
        })
    );
    return {
      layer: layerName,
      element: element.toJSON(),
      changeset: { id: view.active.id, name: view.active.name, elementStatus: graphElement?.status ?? "unchanged" },
      relationships: {
        outgoing: neighbors.filter((n) => n.direction === "out").map(row),
        incoming: neighbors.filter((n) => n.direction === "in").map(row),
      },
      ...(acceptedGaps.length > 0 ? { acceptedGaps } : {}),
    };
  }

  const { outgoing, incoming } = view.model.relationships.getForElement(elementId);
  const typeOf = (other: string) => {
    const [layer, type] = other.split(".");
    return type ? `${layer}.${normalizeNodeType(layer, type)}` : other;
  };
  const acceptedGaps = acceptedGapsWithEvidence(element.acceptedGaps(), [
    ...outgoing.map((r) => ({ ...r, direction: "out" as const, otherType: typeOf(r.target) })),
    ...incoming.map((r) => ({ ...r, direction: "in" as const, otherType: typeOf(r.source) })),
  ]);

  return {
    layer: layerName,
    element: element.toJSON(),
    relationships: { outgoing, incoming },
    // Connections decided against, next to the ones it has; contradictedBy marks one it has anyway.
    ...(acceptedGaps.length > 0 ? { acceptedGaps } : {}),
  };
}

/** One element as a card: its connections as the view has them, staged ones marked. */
async function cardOf(view: ShowView, id: string, maxConnections?: number) {
  const found = await findElement(view, id);
  if (!found) return undefined;
  const { element } = found;
  const elementId = element.path || element.id;
  let connections: CardConnection[];
  let status: string | undefined;
  if (view.graph) {
    status = view.graph.getElement(elementId)?.status ?? "unchanged";
    connections = graphConnections(view.graph, elementId);
  } else {
    const { outgoing, incoming } = view.model.relationships.getForElement(elementId);
    connections = [
      ...outgoing.map((r) => ({ direction: "out" as const, predicate: r.predicate, other: r.target })),
      ...incoming.map((r) => ({ direction: "in" as const, predicate: r.predicate, other: r.source })),
    ];
  }
  return elementCard({ id: elementId, name: element.name, description: element.description }, connections, {
    status,
    maxConnections,
  });
}

export async function modelShowHandler(args: ModelShowArgs): Promise<CallToolResult> {
  return runTool(async () => {
    if ((args.id === undefined) === (args.ids === undefined)) {
      throw new CLIError("Pass id for one element or ids for several, not both and not neither", ErrorCategory.USER, [
        'model_show with id: "<layer.type.name>" reads one element whole',
        "model_show with ids: [...] reads several, a compact card each",
      ]);
    }
    const model = await loadModel(args.rootPath);
    const view = await showView(model);

    if (args.id !== undefined) {
      const shown = await showOne(view, args.id);
      if (!shown) throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, NOT_FOUND_HINTS);
      return jsonResult(shown);
    }

    const detail = args.detail ?? "compact";
    const ids = [...new Set(args.ids)];
    const { items, page } = pageOf(ids, { limit: args.limit, offset: args.offset }, SHOW_IDS_LIMITS[detail]);
    const elements: unknown[] = [];
    const notFound: string[] = [];
    for (const id of items) {
      const shown = detail === "full" ? await showOne(view, id) : await cardOf(view, id, args.maxConnections);
      if (shown) elements.push(shown);
      else notFound.push(id);
    }

    const notes: string[] = [];
    const next = nextPageHint("model_show", "ids", page, { ...args });
    if (next) notes.push(next);
    if (notFound.length > 0) notes.push(`Not in the model: ${notFound.join(", ")} (model_search finds similar elements).`);
    if (detail === "compact") {
      notes.push(
        'A card per element: connectionCounts counts the connections not listed. detail: "full" (or id) gives the ' +
          "element whole with every relationship."
      );
    }
    return jsonResult(
      {
        detail,
        ...(view.active ? { changeset: { id: view.active.id, name: view.active.name } } : {}),
        elements,
        ...(notFound.length > 0 ? { notFound } : {}),
        page,
        more: notes.join(" "),
      },
      { compact: detail === "compact", lineWidth: 400 }
    );
  });
}

export const modelShowTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_show",
  description:
    "Show an element's full details, attributes, and relationships (id). Inside an active changeset the " +
    "relationships include staged ones, each with a status (added, deleted, unchanged). acceptedGaps lists the " +
    "connections it decided against (gap_accept), each with its reason; contradictedBy marks one it has anyway. " +
    "ids: [...] reads several elements in one call, a compact card each (name, first sentence of the description, " +
    'change status, connections as lines), or with detail: "full" each whole; paged (limit, offset) with the true ' +
    "count, and ids not in the model listed in notFound.",
  inputSchema,
  handler: modelShowHandler,
};
