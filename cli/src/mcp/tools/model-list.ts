/**
 * model_list — list elements in the architecture model, optionally scoped to
 * a single layer and/or element type. Mirrors `dr list`.
 *
 * Compact by default (#1187): one entry per element with its id, name, type and the start of its
 * description, so the unfiltered listing of a model of a hundred elements or more fits in one tool
 * result. `detail: "full"` returns every element whole, as `Element.toJSON()` writes it.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Element } from "../../core/element.js";
import { CANONICAL_LAYER_NAMES } from "../../core/layers.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  layer: z
    .string()
    .optional()
    .describe("Canonical layer name to list (e.g. 'api', 'data-model'). Omit to list across all layers."),
  type: z.string().optional().describe("Restrict results to a single element type."),
  detail: z
    .enum(["compact", "full"])
    .optional()
    .describe(
      "compact (default): one entry per element with its id, name, type and the first sentence of its " +
        "description (160 characters at most). full: every element whole (description, attributes, source " +
        "reference, metadata), about 1 KB each, so narrow it with layer or type on a model of more than a few dozen."
    ),
  rootPath: rootPathSchema,
};

export type ModelListArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/** A compact entry's description is at most this long, the `…` that marks a cut included. */
export const LIST_DESCRIPTION_LIMIT = 160;

/**
 * How long a line of the compact listing may be: an entry with a long id and name and a
 * description at the limit fits, so each element takes one line (a layer of one or two short
 * entries fits on a line whole).
 */
const LISTING_LINE_WIDTH = 400;

/** A full stop that ends an abbreviation or a list number (`1.`), not a sentence. */
const NOT_A_SENTENCE_END = /(?:\b(?:e\.g|i\.e|vs|cf)|(?:^|\s)\d+)\.$/i;

/**
 * A description for the compact listing: its first sentence, on one line. A longer first sentence
 * is cut at a word boundary. Whatever was left out is marked with `…`, and the result is never
 * longer than `limit`.
 */
export function shortDescription(text: string | undefined, limit = LIST_DESCRIPTION_LIMIT): string | undefined {
  const whole = (text ?? "").trim().replace(/\s+/g, " ");
  if (!whole) return undefined;
  // The first paragraph, then its first sentence.
  const paragraph = (text ?? "").trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  let sentence = paragraph;
  const end = /[.!?](?=\s)/g;
  for (let match = end.exec(paragraph); match; match = end.exec(paragraph)) {
    const candidate = paragraph.slice(0, match.index + 1);
    if (NOT_A_SENTENCE_END.test(candidate)) continue;
    sentence = candidate;
    break;
  }
  const short = sentence.length < whole.length ? `${sentence} …` : sentence;
  if (short.length <= limit) return short;
  const head = sentence.slice(0, limit - 1);
  const space = head.lastIndexOf(" ");
  // A word boundary, unless the only one is so early that most of the text would go.
  return `${(space >= limit / 2 ? head.slice(0, space) : head).replace(/[\s,;:]+$/, "")}…`;
}

/** An element in the compact listing. Its layer is the id's first segment, and the group it is listed in. */
export interface CompactElement {
  id: string;
  name: string;
  type: string;
  description?: string;
}

function compactElement(element: Element): CompactElement {
  const description = shortDescription(element.description);
  return {
    id: element.path || element.id,
    name: element.name,
    type: element.type,
    ...(description ? { description } : {}),
  };
}

/** Says what the compact listing holds and how to get more. */
const COMPACT_MORE =
  "Compact listing: each element's id, name, type and the first sentence of its description. Pass " +
  'detail: "full" for attributes, source references and metadata (about 1 KB an element; layer and type ' +
  "narrow either form), or model_show for one element.";

export async function modelListHandler(args: ModelListArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const full = args.detail === "full";
    const listed = (elements: Element[]): unknown[] => {
      const kept = args.type ? elements.filter((e) => e.type === args.type) : elements;
      return full ? kept.map((e) => e.toJSON()) : kept.map(compactElement);
    };

    if (args.layer) {
      const layer = await model.getLayer(args.layer);
      if (!layer) {
        throw new CLIError(`Layer ${args.layer} not found`, ErrorCategory.NOT_FOUND, [
          'Use "model_info" to see all available layers',
        ]);
      }

      const elements = listed(layer.listElements());
      if (full) return jsonResult({ layer: args.layer, count: elements.length, elements });
      return jsonResult(
        { detail: "compact", layer: args.layer, count: elements.length, elements, more: COMPACT_MORE },
        { compact: true, lineWidth: LISTING_LINE_WIDTH }
      );
    }

    const layers: Array<{ layer: string; count: number; elements: unknown[] }> = [];
    for (const layerName of CANONICAL_LAYER_NAMES) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      const elements = listed(layer.listElements());
      if (elements.length > 0) {
        layers.push({ layer: layerName, count: elements.length, elements });
      }
    }

    const totalElements = layers.reduce((sum, l) => sum + l.count, 0);
    if (full) return jsonResult({ layers, totalElements });
    return jsonResult(
      { detail: "compact", totalElements, layers, more: COMPACT_MORE },
      { compact: true, lineWidth: LISTING_LINE_WIDTH }
    );
  });
}

export const modelListTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_list",
  description:
    "List the elements in the architecture model, grouped by layer, optionally scoped to a layer and/or element " +
    "type. By default a compact listing: one line per element with its id, name, type and the first sentence of " +
    'its description (about 25 KB per 100 elements). detail: "full" returns every element whole (description, ' +
    "attributes, source reference, metadata; about 1 KB each), so pass layer or type with it on anything but a " +
    "small model. model_show reads one element with its relationships; model_search finds elements by name, id " +
    "or source file.",
  inputSchema,
  handler: modelListHandler,
};
