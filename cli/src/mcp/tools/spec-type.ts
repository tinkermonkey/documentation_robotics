/**
 * spec_type — what the spec says about one node type: its definition, its attributes (required,
 * enums), and every relationship the catalog allows from it and to it.
 *
 * This is the lookup a planner needs before staging an element: model_add fails on a missing
 * required attribute, and relationship_add fails on a triple the catalog does not list.
 *
 * Two forms answer for many types in one call (#1216): the layer listing (no `type`) gives each
 * type's required attributes with their enum values, and the catalog query (no `type`, with any
 * relationship filter) gives the relationships the catalog allows between the layer's types and
 * the other layers named, grouped by source and predicate.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SpecDataLoader } from "../../core/spec-loader.js";
import { getAllLayerIds, isValidLayer } from "../../generated/layer-registry.js";
import {
  getNodeType,
  getNodeTypesForLayer,
  isValidNodeType,
  normalizeNodeType,
  type SpecNodeId,
} from "../../generated/node-types.js";
import {
  RELATIONSHIPS,
  RELATIONSHIPS_BY_DESTINATION,
  RELATIONSHIPS_BY_SOURCE,
  type RelationshipSpec,
} from "../../generated/relationship-index.js";
import { CLIError, ErrorCategory, findSimilar, formatValidOptions } from "../../utils/errors.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { acceptedGapView, findAcceptedGap, type AcceptedGap } from "../../core/accepted-gaps.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  layer: z
    .string()
    .optional()
    .describe(
      "Canonical layer name, e.g. 'api', 'data-model'. Omit it when type is a dotted id ('product.feature') or " +
        "element names an element by its id."
    ),
  type: z
    .string()
    .optional()
    .describe(
      "Node type within the layer, e.g. 'operation', or its dotted id with the layer, e.g. 'product.feature', as the " +
        "other tools name a type. Omit to list the layer's types (with required attributes and their enum values), " +
        "or, with any relationship filter, to query the catalog across the layer's types."
    ),
  types: z
    .array(z.string())
    .optional()
    .describe("Catalog query: only these types of the layer, e.g. ['applicationservice', 'applicationcomponent']."),
  predicate: z.string().optional().describe("Only list relationships with this predicate."),
  otherLayer: z.string().optional().describe("Only list relationships whose other end is in this layer."),
  otherLayers: z
    .array(z.string())
    .optional()
    .describe("As otherLayer, for several layers at once, e.g. ['product', 'motivation']."),
  otherType: z
    .string()
    .optional()
    .describe("Only list relationships whose other end is this type: 'feature', or 'product.feature' to name its layer."),
  direction: z
    .enum(["out", "in", "both"])
    .optional()
    .describe(
      "'out' = only relationships from the type (or, in a catalog query, from the layer's types), 'in' = only " +
        "relationships to them, 'both' (default)."
    ),
  relationships: z
    .boolean()
    .optional()
    .describe("Catalog query with no other filter: every relationship the catalog allows from and to the layer's types."),
  element: z
    .string()
    .optional()
    .describe(
      "An element of this layer (id or path): its type is looked up when type is omitted, and each relationship it " +
        "accepted as a gap (gap_accept) is marked accepted, with the reason. Read as the active changeset leaves it."
    ),
  rootPath: rootPathSchema,
};

export type SpecTypeArgs = z.infer<z.ZodObject<typeof inputSchema>>;

let loaderPromise: Promise<SpecDataLoader> | null = null;
function specLoader(): Promise<SpecDataLoader> {
  if (!loaderPromise) {
    const loader = new SpecDataLoader();
    loaderPromise = loader.load().then(() => loader);
    loaderPromise.catch(() => {
      loaderPromise = null;
    });
  }
  return loaderPromise;
}

export async function specTypeHandler(inputArgs: SpecTypeArgs): Promise<CallToolResult> {
  return runTool(async () => {
    // A type named by its dotted id, as model_add, model_search and the brief name it (#1280)
    let layerName = inputArgs.layer;
    let typeName = inputArgs.type;
    if (typeName?.includes(".")) {
      const [qualifiedLayer, qualifiedType, ...extra] = typeName.split(".");
      if (!qualifiedLayer || !qualifiedType || extra.length > 0) {
        throw new CLIError(`Invalid qualified type "${typeName}"`, ErrorCategory.USER, [
          'Use "layer.type", e.g. "product.feature"',
        ]);
      }
      if (layerName && layerName !== qualifiedLayer) {
        throw new CLIError(
          `Type "${typeName}" is in the ${qualifiedLayer} layer, not ${layerName}`,
          ErrorCategory.USER,
          [`Pass layer "${qualifiedLayer}" or omit layer when using a qualified type`]
        );
      }
      layerName = qualifiedLayer;
      typeName = qualifiedType;
    }
    // An element named by its id says its layer too
    if (!layerName && inputArgs.element?.includes(".")) layerName = inputArgs.element.split(".")[0];

    if (!layerName) {
      throw new CLIError(
        'Missing "layer": pass layer and type separately (layer: "product", type: "feature"), or the dotted type ' +
          'alone (type: "product.feature")',
        ErrorCategory.USER
      );
    }
    let args: SpecTypeArgs & { layer: string } = { ...inputArgs, layer: layerName, type: typeName };

    if (!isValidLayer(args.layer)) {
      const layers = getAllLayerIds();
      const similar = findSimilar(args.layer, layers, 3);
      throw new CLIError(`Unknown layer "${args.layer}"`, ErrorCategory.USER, [
        ...(similar.length > 0 ? [`Did you mean: ${similar.join(" or ")}?`] : []),
        `Valid layers: ${formatValidOptions(layers)}`,
      ]);
    }

    const loader = await specLoader();

    // An element: its type stands in for a missing one, and its accepted gaps mark the relationships.
    let element: { id: string; gaps: AcceptedGap[] } | undefined;
    if (args.element) {
      const model = await loadModel(args.rootPath);
      const layerName = await findElementLayer(model, args.element);
      const found = layerName ? (await model.getLayer(layerName))?.getElement(args.element) : undefined;
      if (!layerName || !found) {
        throw new CLIError(`Element ${args.element} not found`, ErrorCategory.NOT_FOUND, ['Use "model_search" to find it']);
      }
      if (layerName !== args.layer) {
        throw new CLIError(`Element ${args.element} is in the ${layerName} layer, not ${args.layer}`, ErrorCategory.USER, [
          `Pass layer "${layerName}"`,
        ]);
      }
      if (args.type && normalizeNodeType(layerName, args.type) !== normalizeNodeType(layerName, found.type)) {
        throw new CLIError(`Element ${args.element} is a ${found.type}, not a ${args.type}`, ErrorCategory.USER, [
          "Leave type out to use the element's",
        ]);
      }
      args = { ...args, type: args.type ?? found.type };
      element = { id: found.path || found.id, gaps: found.acceptedGaps() };
    }

    const otherLayers = [...(args.otherLayer ? [args.otherLayer] : []), ...(args.otherLayers ?? [])];
    for (const name of otherLayers) requireLayer(name, "otherLayer");

    if (!args.type) {
      const isQuery =
        args.relationships === true ||
        args.predicate !== undefined ||
        args.otherType !== undefined ||
        args.direction !== undefined ||
        otherLayers.length > 0 ||
        (args.types?.length ?? 0) > 0;
      if (isQuery) return jsonResult(catalogQuery(args, otherLayers), { compact: true, lineWidth: QUERY_LINE_WIDTH });

      const layer = loader.getLayer(args.layer);
      return jsonResult(
        {
          layer: args.layer,
          description: layer?.description,
          types: getNodeTypesForLayer(args.layer).map((t) => {
            const enums = requiredEnums(t);
            return {
              type: t.type,
              title: t.title,
              definition: firstSentence(loader.getNodeType(t.specNodeId)?.description),
              requiredAttributes: t.requiredAttributes,
              ...(Object.keys(enums).length > 0 ? { requiredEnums: enums } : {}),
            };
          }),
          more:
            "requiredEnums gives the allowed values of the required attributes that have them (name[] for an array " +
            "whose items are each one of the values). Pass type for one " +
            "type's attributes and relationships, or otherLayers, predicate or relationships: true for the " +
            "relationships the catalog allows across this layer's types.",
        },
        { compact: true, lineWidth: QUERY_LINE_WIDTH }
      );
    }
    if (args.types && args.types.length > 0) {
      throw new CLIError('Pass either "type" (one type, in detail) or "types" (a catalog query), not both', ErrorCategory.USER);
    }

    requireType(args.layer, args.type);

    const specNodeId = `${args.layer}.${normalizeNodeType(args.layer, args.type)}` as SpecNodeId;
    const info = getNodeType(specNodeId)!;
    const spec = loader.getNodeType(specNodeId);

    const other = otherEndFilter(otherLayers, args.otherType);
    const keep = (rel: RelationshipSpec, otherEnd: string) =>
      (!args.predicate || rel.predicate === args.predicate) && other(otherEnd);

    const accepted = (direction: "out" | "in", predicate: string, otherType: string) => {
      const gap = findAcceptedGap(element?.gaps, direction, predicate, otherType);
      return gap ? { accepted: { reason: gap.reason, decidedBy: gap.decided_by, decidedAt: gap.decided_at } } : {};
    };
    const outgoing = (RELATIONSHIPS_BY_SOURCE.get(specNodeId) ?? [])
      .filter((r) => keep(r, r.destinationSpecNodeId))
      .map((r) => ({
        predicate: r.predicate,
        target: r.destinationSpecNodeId,
        ...(r.required ? { required: true } : {}),
        ...accepted("out", r.predicate, r.destinationSpecNodeId),
      }));
    const incoming = (RELATIONSHIPS_BY_DESTINATION.get(specNodeId) ?? [])
      .filter((r) => keep(r, r.sourceSpecNodeId))
      .map((r) => ({
        source: r.sourceSpecNodeId,
        predicate: r.predicate,
        ...(r.required ? { required: true } : {}),
        ...accepted("in", r.predicate, r.sourceSpecNodeId),
      }));

    const attributes = Object.entries(info.attributeConstraints).map(([name, constraint]) => {
      const c = constraint as Record<string, unknown>;
      return {
        name,
        required: info.requiredAttributes.includes(name),
        ...(c.type ? { type: c.type } : {}),
        ...(c.enum ? { enum: c.enum } : {}),
        ...(!c.enum && enumOf(c)?.ofItems ? { itemsEnum: enumOf(c)!.values } : {}),
        ...(c.description ? { description: c.description } : {}),
      };
    });

    // direction keeps one side: "out" the relationships from this type, "in" the ones to it.
    return jsonResult({
      specNodeId,
      title: info.title,
      definition: spec?.description,
      attributes,
      ...(args.direction === "in" ? {} : { outgoing }),
      ...(args.direction === "out" ? {} : { incoming }),
      ...(element ? { element: { id: element.id, acceptedGaps: element.gaps.map(acceptedGapView) } } : {}),
    });
  });
}

export const specTypeTool: McpToolDefinition<typeof inputSchema> = {
  name: "spec_type",
  description:
    "Look up a node type in the spec: its definition, attributes (required ones, enum values) and the relationships " +
    "the catalog allows from and to it. Omit 'type' to list a layer's types, each with its required attributes and " +
    "their enum values. Omit 'type' and pass otherLayers, otherType, predicate, types, direction or relationships: " +
    "true to query the catalog across the layer's types in one call, e.g. layer 'application', otherLayers " +
    "['product', 'motivation'], direction 'out' for every link from application to those layers. Use before " +
    "model_add and relationship_add. type also takes a type's dotted id ('product.feature') without layer. With " +
    "element, the relationships that element accepted as gaps are marked accepted, with the reason.",
  inputSchema,
  handler: specTypeHandler,
};

/** A catalog query's groups each fit on a line of this width. */
const QUERY_LINE_WIDTH = 240;

/** A catalog query with more relationships than this says how to narrow it. */
const QUERY_NARROW_HINT = 150;

function requireLayer(name: string, parameter: string): void {
  if (isValidLayer(name)) return;
  const layers = getAllLayerIds();
  const similar = findSimilar(name, layers, 3);
  throw new CLIError(`Unknown ${parameter} "${name}"`, ErrorCategory.USER, [
    ...(similar.length > 0 ? [`Did you mean: ${similar.join(" or ")}?`] : []),
    `Valid layers: ${formatValidOptions(layers)}`,
  ]);
}

function requireType(layer: string, type: string): void {
  if (isValidNodeType(layer, type)) return;
  const names = getNodeTypesForLayer(layer).map((t) => t.type);
  const similar = findSimilar(type, names, 3);
  throw new CLIError(`Invalid type "${type}" for layer "${layer}"`, ErrorCategory.USER, [
    ...(similar.length > 0 ? [`Did you mean: ${similar.join(" or ")}?`] : []),
    `Valid types for ${layer}: ${formatValidOptions(names)}`,
  ]);
}

/** The values an attribute may take: its own enum, or for an array the enum of its items. */
function enumOf(constraint: unknown): { values: unknown[]; ofItems: boolean } | undefined {
  const c = constraint as { enum?: unknown; items?: { enum?: unknown } } | undefined;
  if (Array.isArray(c?.enum)) return { values: c.enum, ofItems: false };
  if (Array.isArray(c?.items?.enum)) return { values: c.items.enum, ofItems: true };
  return undefined;
}

/**
 * The enum values of a type's required attributes, for the ones that have an enum. An array whose
 * items have an enum is keyed `name[]`: each item is one of the values.
 */
function requiredEnums(info: { requiredAttributes: string[]; attributeConstraints: Record<string, unknown> }): Record<string, unknown[]> {
  const enums: Record<string, unknown[]> = {};
  for (const name of info.requiredAttributes) {
    const found = enumOf(info.attributeConstraints[name]);
    if (found) enums[found.ofItems ? `${name}[]` : name] = found.values;
  }
  return enums;
}

/**
 * Whether a relationship's other end (a spec node id, `layer.type`) passes the otherLayer(s) and
 * otherType filters. `otherType` is a bare type name, matched in any layer left by the layer
 * filter, or `layer.type`.
 */
function otherEndFilter(otherLayers: string[], otherType: string | undefined): (specNodeId: string) => boolean {
  const layers = new Set(otherLayers);
  let typeLayer: string | undefined;
  let typeName = otherType;
  if (otherType?.includes(".")) {
    // The layer is the longest one the id starts with: "data-model.objectschema".
    typeLayer = [...getAllLayerIds()].sort((a, b) => b.length - a.length).find((l) => otherType.startsWith(`${l}.`));
    if (!typeLayer) {
      requireLayer(otherType.split(".")[0], "otherType layer");
      return () => false;
    }
    typeName = otherType.slice(typeLayer.length + 1);
    requireType(typeLayer, typeName);
  } else if (otherType !== undefined) {
    const candidates = otherLayers.length > 0 ? otherLayers : getAllLayerIds();
    if (!candidates.some((layer) => isValidNodeType(layer, otherType))) {
      throw new CLIError(
        `No ${otherLayers.length > 0 ? otherLayers.join(" or ") : "layer"} type is named "${otherType}"`,
        ErrorCategory.USER,
        ['Pass otherType as "layer.type", or call spec_type with only that layer to list its types']
      );
    }
  }
  return (specNodeId) => {
    const layer = layerOf(specNodeId);
    if (layers.size > 0 && !layers.has(layer)) return false;
    if (typeLayer && layer !== typeLayer) return false;
    return typeName === undefined || specNodeId === `${layer}.${normalizeNodeType(layer, typeName)}`;
  };
}

/** The layer of a spec node id: everything before its last segment (`data-model.objectschema`). */
function layerOf(specNodeId: string): string {
  return specNodeId.slice(0, specNodeId.lastIndexOf("."));
}

/**
 * The relationships the catalog allows between the layer's types (all, or `types`) and the other
 * ends the filters leave, grouped by source type and predicate. One call replaces a spec_type call
 * per type when wiring across layers.
 */
function catalogQuery(args: SpecTypeArgs & { layer: string }, otherLayers: string[]): Record<string, unknown> {
  if (args.element) {
    throw new CLIError('"element" reads one type: pass it without types, otherLayers or the other query filters, or drop it', ErrorCategory.USER);
  }
  const types = new Set(
    (args.types ?? []).map((type) => {
      requireType(args.layer, type);
      return `${args.layer}.${normalizeNodeType(args.layer, type)}`;
    })
  );
  const onThisSide = (specNodeId: string) =>
    types.size > 0 ? types.has(specNodeId) : layerOf(specNodeId) === args.layer;
  const other = otherEndFilter(otherLayers, args.otherType);
  const direction = args.direction ?? "both";

  const groups = new Map<string, { source: string; predicate: string; targets: string[]; required: string[] }>();
  let count = 0;
  for (const rel of RELATIONSHIPS) {
    if (args.predicate && rel.predicate !== args.predicate) continue;
    const out = direction !== "in" && onThisSide(rel.sourceSpecNodeId) && other(rel.destinationSpecNodeId);
    const into = direction !== "out" && onThisSide(rel.destinationSpecNodeId) && other(rel.sourceSpecNodeId);
    if (!out && !into) continue;
    count++;
    const key = `${rel.sourceSpecNodeId}\0${rel.predicate}`;
    const group = groups.get(key) ?? { source: rel.sourceSpecNodeId, predicate: rel.predicate, targets: [], required: [] };
    group.targets.push(rel.destinationSpecNodeId);
    if (rel.required) group.required.push(rel.destinationSpecNodeId);
    groups.set(key, group);
  }

  const relationships = [...groups.values()]
    .sort((a, b) => a.source.localeCompare(b.source) || a.predicate.localeCompare(b.predicate))
    .map((g) => ({
      source: g.source,
      predicate: g.predicate,
      targets: g.targets.sort(),
      ...(g.required.length > 0 ? { required: g.required.sort() } : {}),
    }));
  return {
    layer: args.layer,
    query: {
      ...(types.size > 0 ? { types: [...types] } : {}),
      ...(args.predicate ? { predicate: args.predicate } : {}),
      ...(otherLayers.length > 0 ? { otherLayers } : {}),
      ...(args.otherType ? { otherType: args.otherType } : {}),
      direction,
    },
    count,
    relationships,
    more:
      "Each entry is the relationships the catalog allows from source with predicate to each of targets (required " +
      "lists the targets the catalog marks required). " +
      (count > QUERY_NARROW_HINT
        ? "Narrow it with types, otherLayers, otherType, predicate or direction. "
        : count === 0
          ? "Nothing in the catalog matches: relationship_add would refuse these. Widen the filters to see what is allowed. "
          : "") +
      "Pass type for one type's attributes.",
  };
}

function firstSentence(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}
