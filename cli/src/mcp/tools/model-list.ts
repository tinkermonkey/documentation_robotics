/**
 * model_list — list elements in the architecture model, optionally scoped to
 * a single layer and/or element type. Mirrors `dr list`.
 *
 * Sized to fit one tool result by default (#1187): a compact entry per element (its id, name and
 * the start of its description) when the listing has `LIST_COMPACT_LIMIT` elements or fewer, and
 * counts by layer and type when it has more, so the default never grows with the model.
 * `detail: "full"` returns every element whole, as `Element.toJSON()` writes it.
 *
 * `orphans: true` keeps only the elements with no relationship and no cross-layer reference, in
 * the same forms, so the orphans of a layer or type can be read without the rest.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Element } from "../../core/element.js";
import { CANONICAL_LAYER_NAMES } from "../../core/layers.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { modelView, orphanIds } from "./model-view.js";
import { nextPageHint, pageOf, pagingFields } from "./paging.js";

const inputSchema = {
  layer: z
    .string()
    .optional()
    .describe("Canonical layer name to list (e.g. 'api', 'data-model'). Omit to list across all layers."),
  type: z.string().optional().describe("Restrict results to a single element type."),
  orphans: z
    .boolean()
    .optional()
    .describe(
      "List only orphaned elements: those with no relationship and no cross-layer reference, in either direction. " +
        "Combines with layer, type and detail."
    ),
  detail: z
    .enum(["summary", "compact", "full"])
    .optional()
    .describe(
      "Omit for the default: compact when 150 elements or fewer match, summary when more do. " +
        "summary: element counts by layer and type, no elements. compact: one entry per element with its id " +
        "(layer.type.name), name and the first sentence of its description (160 characters at most), 150 a page. " +
        "full: every element whole (description, attributes, source reference, metadata), about 1 KB each, 30 a " +
        "page. A listing longer than a page says so and gives nextOffset."
    ),
  ...pagingFields("elements of a compact or full listing", "150 compact, 30 full"),
  rootPath: rootPathSchema,
};

export type ModelListArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/**
 * The most elements the default lists one by one (about 30 KB of compact entries). A listing of
 * more is summarized as counts unless the caller asks for `compact` or `full`.
 */
export const LIST_COMPACT_LIMIT = 150;

/** The default page of a full listing: about 35 KB of whole elements. */
export const LIST_FULL_LIMIT = 30;

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

/**
 * An element in the compact listing. Its layer and type are the id's first two segments
 * (`layer.type.name`), so neither is repeated.
 */
export interface CompactElement {
  id: string;
  name: string;
  description?: string;
}

function compactElement(element: Element): CompactElement {
  const description = shortDescription(element.description);
  return {
    id: element.path || element.id,
    name: element.name,
    ...(description ? { description } : {}),
  };
}

/** Says what the compact listing holds and how to get more. */
const COMPACT_MORE =
  "Compact listing: each element's id (layer.type.name), name and the first sentence of its description. Pass " +
  'detail: "full" for attributes, source references and metadata (about 1 KB an element; layer and type ' +
  "narrow either form), or model_show for one element.";

/** Says what the summary holds, why it was given when the caller did not ask for it, and how to list elements. */
function summaryMore(total: number, byDefault: boolean, orphans: boolean): string {
  const noun = orphans ? "orphaned elements" : "elements";
  const why = byDefault
    ? `${total} ${noun} match, more than the ${LIST_COMPACT_LIMIT} the default lists one by one, so these are counts by layer and type. `
    : `Summary: ${orphans ? "orphaned element" : "element"} counts by layer and type. `;
  return (
    `${why}Pass layer or type to list fewer elements, or detail: "compact" to list them ${LIST_COMPACT_LIMIT} a page ` +
    "(about 200 characters an element; limit and offset page through them all)."
  );
}

/** Element counts by type, most common first. */
function countByType(elements: Element[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const e of elements) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

export async function modelListHandler(args: ModelListArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    // Orphans are read from the same view as the listing: the model as the active changeset leaves it.
    const orphaned = args.orphans ? new Set(orphanIds((await modelView(model)).model)) : null;
    const matching = (elements: Element[]): Element[] =>
      elements.filter((e) => (!args.type || e.type === args.type) && (!orphaned || orphaned.has(e.path || e.id)));

    const groups: Array<{ layer: string; elements: Element[] }> = [];
    if (args.layer) {
      const layer = await model.getLayer(args.layer);
      if (!layer) {
        throw new CLIError(`Layer ${args.layer} not found`, ErrorCategory.NOT_FOUND, [
          'Use "model_info" to see all available layers',
        ]);
      }
      groups.push({ layer: args.layer, elements: matching(layer.listElements()) });
    } else {
      for (const layerName of CANONICAL_LAYER_NAMES) {
        const layer = await model.getLayer(layerName);
        if (!layer) continue;
        const elements = matching(layer.listElements());
        if (elements.length > 0) groups.push({ layer: layerName, elements });
      }
    }
    const total = groups.reduce((sum, g) => sum + g.elements.length, 0);
    const detail = args.detail ?? (total > LIST_COMPACT_LIMIT ? "summary" : "compact");

    const only = orphaned ? { orphans: true } : {};
    if (detail === "summary") {
      const layers = groups.map((g) => ({ layer: g.layer, count: g.elements.length, types: countByType(g.elements) }));
      const more = summaryMore(total, args.detail === undefined, orphaned !== null);
      return jsonResult(args.layer ? { detail, ...only, ...layers[0], more } : { detail, ...only, totalElements: total, layers, more }, {
        compact: true,
        lineWidth: LISTING_LINE_WIDTH,
      });
    }

    // A listing is one list across the layers, paged in layer order. Each layer's count is its
    // total, whatever part of it is on this page; a layer with nothing on the page is left out.
    const all = groups.flatMap((g) => g.elements.map((element) => ({ layer: g.layer, element })));
    const { items, page } = pageOf(all, { limit: args.limit, offset: args.offset }, detail === "full" ? LIST_FULL_LIMIT : LIST_COMPACT_LIMIT);
    const next = nextPageHint("model_list", orphaned ? "orphaned elements" : "elements", page);
    const onPage = (layer: string): Element[] => items.filter((item) => item.layer === layer).map((item) => item.element);
    const listed = groups
      .map((g) => ({ layer: g.layer, count: g.elements.length, elements: onPage(g.layer) }))
      .filter((g) => args.layer !== undefined || g.elements.length > 0);

    // The full form is the tool's shape from before the compact default (no detail field), plus the page.
    if (detail === "full") {
      const layers = listed.map((g) => ({ ...g, elements: g.elements.map((e) => e.toJSON()) }));
      const more = next ? { more: `${next} Each layer's count is its total.` } : {};
      return jsonResult(args.layer ? { ...layers[0], page, ...more } : { layers, totalElements: total, page, ...more });
    }

    const layers = listed.map((g) => ({ ...g, elements: g.elements.map(compactElement) }));
    const more = next ? `${next} Each layer's count is its total. ${COMPACT_MORE}` : COMPACT_MORE;
    return jsonResult(
      args.layer ? { detail, ...only, ...layers[0], page, more } : { detail, ...only, totalElements: total, layers, page, more },
      { compact: true, lineWidth: LISTING_LINE_WIDTH }
    );
  });
}

export const modelListTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_list",
  description:
    "List the elements in the architecture model, grouped by layer, optionally scoped to a layer and/or element " +
    "type. The default fits one result: a compact listing (one line per element with its id, name and the first " +
    "sentence of its description) when 150 elements or fewer match, and counts by layer and type when more do; " +
    'narrow with layer or type, or pass detail: "compact" to list them 150 a page. orphans: true lists only the ' +
    'elements with no relationship at all, in the same forms. detail: "full" returns elements whole (description, ' +
    "attributes, source reference, metadata; about 1 KB each), 30 a page. A listing is paged, never cut off: " +
    "limit and offset, with page.total the true count and page.nextOffset the next page; counts are always of " +
    "everything that matches. model_show reads one element with its relationships; model_search finds " +
    "elements by name, id or source file.",
  inputSchema,
  handler: modelListHandler,
};
