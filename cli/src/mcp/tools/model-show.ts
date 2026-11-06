/**
 * model_show — show a single element with its relationships. Mirrors `dr show`.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { activeStagedChangeset } from "./changeset-shared.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  id: z.string().describe("Element ID or path (e.g. 'api.operation.create-order')."),
  rootPath: rootPathSchema,
};

export type ModelShowArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function modelShowHandler(args: ModelShowArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);

    const layerName = await findElementLayer(model, args.id);
    if (!layerName) {
      throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, [
        'Use "model_search" to find similar elements',
        'Use "model_list" to list all elements in a layer',
      ]);
    }

    const layer = await model.getLayer(layerName);
    const element = layer?.getElement(args.id);
    if (!layer || !element) {
      throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, [
        'Use "model_search" to find similar elements',
        'Use "model_list" to list all elements in a layer',
      ]);
    }

    const elementId = element.path || element.id;

    // Inside an active changeset, show the element's relationships as the changeset leaves them:
    // staged additions included, staged removals marked, each with its change status.
    const active = await activeStagedChangeset(new StagingAreaManager(model.rootPath, model));
    if (active) {
      const graph = await ChangesetGraph.build(model, active);
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
      return jsonResult({
        layer: layerName,
        element: element.toJSON(),
        changeset: { id: active.id, name: active.name, elementStatus: graphElement?.status ?? "unchanged" },
        relationships: {
          outgoing: neighbors.filter((n) => n.direction === "out").map(row),
          incoming: neighbors.filter((n) => n.direction === "in").map(row),
        },
      });
    }

    const { outgoing, incoming } = model.relationships.getForElement(elementId);

    return jsonResult({
      layer: layerName,
      element: element.toJSON(),
      relationships: { outgoing, incoming },
    });
  });
}

export const modelShowTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_show",
  description:
    "Show a single element's full details, attributes, and relationships. Inside an active changeset the " +
    "relationships include staged ones, each with a status (added, deleted, unchanged).",
  inputSchema,
  handler: modelShowHandler,
};
