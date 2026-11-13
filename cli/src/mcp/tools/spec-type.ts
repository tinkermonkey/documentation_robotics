/**
 * spec_type — what the spec says about one node type: its definition, its attributes (required,
 * enums), and every relationship the catalog allows from it and to it.
 *
 * This is the lookup a planner needs before staging an element: model_add fails on a missing
 * required attribute, and relationship_add fails on a triple the catalog does not list.
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
import { RELATIONSHIPS_BY_DESTINATION, RELATIONSHIPS_BY_SOURCE, type RelationshipSpec } from "../../generated/relationship-index.js";
import { CLIError, ErrorCategory, findSimilar, formatValidOptions } from "../../utils/errors.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { acceptedGapView, findAcceptedGap, type AcceptedGap } from "../../core/accepted-gaps.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  layer: z.string().describe("Canonical layer name, e.g. 'api', 'data-model'."),
  type: z
    .string()
    .optional()
    .describe("Node type within the layer, e.g. 'operation'. Omit to list the layer's types."),
  predicate: z.string().optional().describe("Only list relationships with this predicate."),
  otherLayer: z.string().optional().describe("Only list relationships whose other end is in this layer."),
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

export async function specTypeHandler(args: SpecTypeArgs): Promise<CallToolResult> {
  return runTool(async () => {
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

    if (!args.type) {
      const layer = loader.getLayer(args.layer);
      return jsonResult({
        layer: args.layer,
        description: layer?.description,
        types: getNodeTypesForLayer(args.layer).map((t) => ({
          type: t.type,
          title: t.title,
          definition: firstSentence(loader.getNodeType(t.specNodeId)?.description),
          requiredAttributes: t.requiredAttributes,
        })),
      });
    }

    if (!isValidNodeType(args.layer, args.type)) {
      const names = getNodeTypesForLayer(args.layer).map((t) => t.type);
      const similar = findSimilar(args.type, names, 3);
      throw new CLIError(`Invalid type "${args.type}" for layer "${args.layer}"`, ErrorCategory.USER, [
        ...(similar.length > 0 ? [`Did you mean: ${similar.join(" or ")}?`] : []),
        `Valid types for ${args.layer}: ${formatValidOptions(names)}`,
      ]);
    }

    const specNodeId = `${args.layer}.${normalizeNodeType(args.layer, args.type)}` as SpecNodeId;
    const info = getNodeType(specNodeId)!;
    const spec = loader.getNodeType(specNodeId);

    const keep = (rel: RelationshipSpec, otherEnd: string) =>
      (!args.predicate || rel.predicate === args.predicate) &&
      (!args.otherLayer || otherEnd.startsWith(`${args.otherLayer}.`));

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
        ...(c.description ? { description: c.description } : {}),
      };
    });

    return jsonResult({
      specNodeId,
      title: info.title,
      definition: spec?.description,
      attributes,
      outgoing,
      incoming,
      ...(element ? { element: { id: element.id, acceptedGaps: element.gaps.map(acceptedGapView) } } : {}),
    });
  });
}

export const specTypeTool: McpToolDefinition<typeof inputSchema> = {
  name: "spec_type",
  description:
    "Look up a node type in the spec: its definition, attributes (required ones, enum values) and the relationships " +
    "the catalog allows from and to it. Omit 'type' to list a layer's types. Use before model_add and relationship_add. " +
    "With element, the relationships that element accepted as gaps are marked accepted, with the reason.",
  inputSchema,
  handler: specTypeHandler,
};

function firstSentence(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}
