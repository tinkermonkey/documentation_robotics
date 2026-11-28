/**
 * model_search — search for elements across the model by name/ID substring, by words in their
 * descriptions and attributes, or by source file reference. Mirrors `dr search`, with the reads'
 * compact default and paging.
 *
 * Changeset-aware: inside an active changeset the layers searched are the projected ones, so a
 * staged element is found by its id, name, description or attributes like any other (#1390), and
 * each result says how the changeset leaves it.
 *
 * What it matches: `fields` (id and name by default; description and attributes on request), and
 * `match`: the query as one phrase (default), every word of it, or any word. Results rank the
 * closest first: an exact id or name, then more words matched, then a name or id hit before one in
 * the description, then one in the attributes; ties keep layer order. `excludeLayers` and
 * `excludeTypes` leave layers and types out (#1283). Results are compact entries a page at a time
 * (`limit`, `offset`), with the true count and counts by layer and type of everything matched.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Element } from "../../core/element.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import { elementFilter } from "../../core/element-filter.js";
import { nextPageHint, pageOf, pagingFields } from "../../core/paging.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { activeStagedChangeset, milestoneArgs, milestoneField } from "./changeset-shared.js";
import { milestoneScope, scopeViewOfGraph, scopeViewOfModel } from "../../core/milestone-scope.js";
import { getAllLayerIds, isValidLayer } from "../../generated/layer-registry.js";
import { NODE_TYPES } from "../../generated/node-types.js";
import { CLIError, ErrorCategory, findSimilar, formatValidOptions } from "../../utils/errors.js";
import { countByLayerAndType } from "./model-view.js";
import { shortDescription } from "./model-list.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

/** Results per page by default: compact entries are about 250 bytes, full ones carry the whole description. */
export const SEARCH_LIMITS = { compact: 50, full: 20 } as const;

const FIELDS = ["id", "name", "description", "attributes"] as const;
type SearchField = (typeof FIELDS)[number];
/** The order a hit's field ranks in: a name or id hit before a description, a description before an attribute. */
const FIELD_RANK: Record<SearchField, number> = { name: 0, id: 1, description: 2, attributes: 3 };

const inputSchema = {
  query: z
    .string()
    .optional()
    .describe(
      "Text to find (case-insensitive), in the fields named by fields (id and name by default). Ignored when " +
        "sourceFile is set."
    ),
  fields: z
    .array(z.enum(FIELDS))
    .optional()
    .describe(
      'Where to look for the query: any of "id", "name", "description", "attributes" (attribute values). Default ' +
        '["id", "name"]. Name and id hits rank before description hits, and those before attribute hits.'
    ),
  match: z
    .enum(["phrase", "all", "any"])
    .optional()
    .describe(
      '"phrase" (default): the whole query as one substring. "all": every word of the query, each in any field ' +
        'searched. "any": at least one word; results with more of the words come first.'
    ),
  layer: z.string().optional().describe("Restrict search to a single layer."),
  type: z.string().optional().describe("Restrict search to a single element type."),
  excludeLayers: z
    .array(z.string())
    .optional()
    .describe('Leave out elements in these layers (e.g. ["testing"] for no test sketches).'),
  excludeTypes: z
    .array(z.string())
    .optional()
    .describe('Leave out elements of these types, as "testcasesketch" or "testing.testcasesketch".'),
  milestone: milestoneField,
  sourceFile: z.string().optional().describe("Find elements whose source_reference points at this file path."),
  detail: z
    .enum(["compact", "full"])
    .optional()
    .describe(
      `"compact" (default): each result's id, name, layer, type, the first sentence of its description and its ` +
        `source file, ${SEARCH_LIMITS.compact} a page. "full": the whole description, ${SEARCH_LIMITS.full} a page.`
    ),
  ...pagingFields("results", `${SEARCH_LIMITS.compact} compact, ${SEARCH_LIMITS.full} full`),
  rootPath: rootPathSchema,
};

export type ModelSearchArgs = z.infer<z.ZodObject<typeof inputSchema>>;

function normalizePath(filePath: string): string {
  return filePath.replace(/^\.\//, "").replace(/\\/g, "/");
}

function matchesSourceFile(element: Element, sourceFilePath: string): boolean {
  const sourceRef = element.getSourceReference();
  if (!sourceRef) return false;

  const normalizedQuery = normalizePath(sourceFilePath);
  return (sourceRef.locations ?? []).some((loc) => normalizePath(loc.file) === normalizedQuery);
}

/** Refuses a layer name that is not one, with the names that are. */
function checkLayer(layer: string): void {
  if (isValidLayer(layer)) return;
  const validLayers = getAllLayerIds();
  const similar = findSimilar(layer, validLayers, 3);
  const suggestions: string[] = [`Use a valid layer name: ${formatValidOptions(validLayers)}`];
  if (similar.length > 0) suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
  throw new CLIError(`Unknown layer "${layer}"`, ErrorCategory.USER, suggestions);
}

/** Refuses a type that no layer (or not `layer`) has; `layer.type` names its layer itself. */
function checkType(type: string, layer?: string): void {
  const [prefix, bare] = type.includes(".") ? type.split(".", 2) : [layer, type];
  const candidateTypes = prefix
    ? Array.from(NODE_TYPES.values()).filter((t) => t.layer === prefix)
    : Array.from(NODE_TYPES.values());
  if (candidateTypes.some((t) => t.type === bare)) return;
  const validTypeNames = Array.from(new Set(candidateTypes.map((t) => t.type))).sort();
  const similar = findSimilar(bare, validTypeNames, 3);
  const suggestions: string[] = [
    prefix ? `Valid types for ${prefix}: ${formatValidOptions(validTypeNames)}` : `Valid types: ${formatValidOptions(validTypeNames)}`,
  ];
  if (similar.length > 0) suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
  throw new CLIError(
    `Unknown element type "${type}"${prefix && !type.includes(".") ? ` for layer "${prefix}"` : ""}`,
    ErrorCategory.USER,
    suggestions
  );
}

/** The searchable text of each field, lower-cased. */
function fieldTexts(element: Element): Record<SearchField, string> {
  const attributes = Object.values(element.attributes ?? {})
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join(" ");
  return {
    id: (element.path || element.id).toLowerCase(),
    name: element.name.toLowerCase(),
    description: (element.description ?? "").toLowerCase(),
    attributes: attributes.toLowerCase(),
  };
}

interface Hit {
  /** Words matched (1 for a phrase). */
  words: number;
  /** The best field a hit was in (FIELD_RANK). */
  rank: number;
  /** An exact id or name match. */
  exact: boolean;
  /** The fields with a hit. */
  matchedIn: SearchField[];
}

/** How an element matches the query in these fields, or undefined when it does not. */
function hitOf(texts: Record<SearchField, string>, fields: readonly SearchField[], query: string, match: string): Hit | undefined {
  const phrase = query.toLowerCase();
  const words = match === "phrase" ? [phrase] : [...new Set(phrase.split(/\s+/).filter(Boolean))];
  if (words.length === 0) words.push("");
  const matchedIn = new Set<SearchField>();
  let matchedWords = 0;
  for (const word of words) {
    const where = fields.filter((field) => texts[field].includes(word));
    if (where.length > 0) matchedWords += 1;
    for (const field of where) matchedIn.add(field);
  }
  const enough = match === "any" ? matchedWords > 0 : matchedWords === words.length;
  if (!enough) return undefined;
  const found = [...matchedIn].sort((a, b) => FIELD_RANK[a] - FIELD_RANK[b]);
  return {
    words: matchedWords,
    rank: found.length > 0 ? FIELD_RANK[found[0]] : 0,
    exact: phrase.length > 0 && (texts.id === phrase || texts.name === phrase),
    matchedIn: found,
  };
}

interface SearchResult {
  layer: string;
  id: string;
  type: string;
  name: string;
  description?: string;
  sourceFile?: string;
  sourceSymbol?: string;
  /** The fields the query was found in, when not the id or name. */
  matchedIn?: SearchField[];
  changeStatus?: string;
  /** With milestone: why the element is in its scope (`scheduled-for <milestone>`, or `<predicate> <element it reaches>`). */
  scopeVia?: string;
}

export async function modelSearchHandler(args: ModelSearchArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const milestones = milestoneArgs(args.milestone);
    if (!args.query && !args.sourceFile && !args.layer && !args.type && milestones.length === 0) {
      throw new CLIError(
        "At least one of query, sourceFile, layer, type or milestone must be provided",
        ErrorCategory.USER,
        ['Use "model_list" to list all elements without filtering']
      );
    }

    if (args.layer) checkLayer(args.layer);
    for (const layer of args.excludeLayers ?? []) checkLayer(layer);
    if (args.type) checkType(args.type, args.layer);
    for (const type of args.excludeTypes ?? []) checkType(type);

    const model = await loadModel(args.rootPath);
    const isSourceFileSearch = !!args.sourceFile;
    const fields: SearchField[] = args.fields?.length ? [...new Set(args.fields)] : ["id", "name"];
    const match = args.match ?? "phrase";
    const detail = args.detail ?? "compact";
    const filter = elementFilter({
      ...(args.layer ? { layers: [args.layer] } : {}),
      ...(args.type ? { types: [args.type] } : {}),
      excludeLayers: args.excludeLayers,
      excludeTypes: args.excludeTypes,
    });
    // Elements the query matches only with fields not searched, counted per such field, so an empty or
    // short answer says where else they are.
    const otherFields = FIELDS.filter((f) => !fields.includes(f));
    const elsewhere: Record<string, number> = {};

    // A milestone keeps the elements in its scope (read from the plan as it leaves the model, or the base).
    const earlyActive = milestones.length > 0 ? await activeStagedChangeset(new StagingAreaManager(model.rootPath, model)) : undefined;
    const scope =
      milestones.length > 0
        ? milestoneScope(earlyActive ? scopeViewOfGraph(await ChangesetGraph.build(model, earlyActive)) : await scopeViewOfModel(model), milestones)
        : undefined;
    const inScope = scope ? new Set(scope.elements) : undefined;

    const found: Array<{ result: SearchResult; hit?: Hit; order: number }> = [];
    for (const layerName of model.getLayerNames()) {
      if (args.layer && layerName !== args.layer) continue;
      const layerObj = await model.getLayer(layerName);
      if (!layerObj) continue;

      for (const element of layerObj.listElements()) {
        if (!filter.keepsLayerType(layerName, element.type)) continue;
        if (inScope && !inScope.has(element.path || element.id)) continue;

        let hit: Hit | undefined;
        if (isSourceFileSearch) {
          if (!matchesSourceFile(element, args.sourceFile!)) continue;
        } else if (args.query) {
          const texts = fieldTexts(element);
          hit = hitOf(texts, fields, args.query, match);
          if (!hit) {
            // Would it match with every field searched? Then name the fields not searched that it needs:
            // with match "all" the words may be split between a searched field and one that is not.
            const wide = otherFields.length > 0 ? hitOf(texts, FIELDS, args.query, match) : undefined;
            for (const field of wide?.matchedIn ?? []) {
              if (!fields.includes(field)) elsewhere[field] = (elsewhere[field] ?? 0) + 1;
            }
            continue;
          }
        }

        const sourceRef = element.getSourceReference();
        const location = sourceRef?.locations?.[0];
        const description = detail === "full" ? element.description : shortDescription(element.description);
        found.push({
          order: found.length,
          hit,
          result: {
            layer: layerName,
            id: element.path || element.id,
            type: element.type,
            name: element.name,
            ...(description ? { description } : {}),
            ...(location?.file ? { sourceFile: location.file } : {}),
            ...(location?.symbol ? { sourceSymbol: location.symbol } : {}),
            ...(hit && hit.rank > FIELD_RANK.id ? { matchedIn: hit.matchedIn } : {}),
            ...(scope ? { scopeVia: scope.via[element.path || element.id] } : {}),
          },
        });
      }
    }

    // The closest first: an exact id or name, more words, the better field; then layer order.
    found.sort((a, b) => {
      if (!a.hit || !b.hit) return a.order - b.order;
      return (
        Number(b.hit.exact) - Number(a.hit.exact) || b.hit.words - a.hit.words || a.hit.rank - b.hit.rank || a.order - b.order
      );
    });
    const all = found.map((f) => f.result);
    const { items, page } = pageOf(all, { limit: args.limit, offset: args.offset }, SEARCH_LIMITS[detail]);

    // Inside an active changeset, say which results the changeset adds or updates.
    const active = await activeStagedChangeset(new StagingAreaManager(model.rootPath, model));
    let results = items;
    if (active) {
      const graph = await ChangesetGraph.build(model, active);
      results = items.map((r) => ({ ...r, changeStatus: graph.getElement(r.id)?.status ?? "unchanged" }));
    }

    const notes: string[] = [];
    const next = nextPageHint("model_search", "results", page, { ...args });
    if (next) notes.push(next);
    if (Object.keys(elsewhere).length > 0) {
      const where = Object.entries(elsewhere).map(([field, n]) => `${n} in ${field}`);
      notes.push(
        `More elements have the query only in fields not searched (${where.join(", ")}): pass fields: ` +
          `${JSON.stringify([...fields, ...Object.keys(elsewhere)])} to include them.`
      );
    }
    if (all.length === 0 && args.query && match === "phrase" && /\s/.test(args.query.trim())) {
      notes.push('Nothing has the whole phrase: match: "all" or "any" matches its words apart.');
    }
    const byLayer = page.nextOffset !== undefined || page.offset > 0 ? countByLayerAndType(all.map((r) => r.id)) : undefined;
    if (byLayer && !args.excludeLayers?.length && byLayer.some((l) => l.layer === "testing")) {
      notes.push('excludeLayers: ["testing"] leaves the test sketches out.');
    }

    return jsonResult(
      {
        query: args.query ?? "",
        ...(args.sourceFile ? { sourceFile: args.sourceFile } : {}),
        ...(active ? { changeset: { id: active.id, name: active.name } } : {}),
        ...(isSourceFileSearch || !args.query ? {} : { fields, match }),
        ...(filter.active ? { filter: filter.applied } : {}),
        ...(scope
          ? {
              milestone: {
                milestones: scope.milestones.map((m) => m.id),
                scheduled: scope.scheduled.length,
                inScope: scope.elements.length,
                note: "The milestone's elements and what the model links to them with realizes, serves or composes; a starting set to check, not a statement of what the milestone needs.",
              },
            }
          : {}),
        count: all.length,
        ...(byLayer ? { byLayer } : {}),
        results,
        page,
        ...(notes.length > 0 ? { more: notes.join(" ") } : {}),
      },
      { compact: detail === "compact", lineWidth: 400 }
    );
  });
}

export const modelSearchTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_search",
  description:
    "Search for elements across the model (inside an active changeset, the model as it leaves it, staged elements " +
    "included) by name/ID substring, by words in descriptions and attributes (fields), or by source file reference. " +
    'match: "all" or "any" matches the query\'s words apart. The closest come first: an exact id or name, more ' +
    "words, then name and id hits before description hits. layer and type narrow; excludeLayers and excludeTypes " +
    `leave layers and types out. Compact entries, ${SEARCH_LIMITS.compact} a page (limit, offset): count is the true ` +
    "total, milestone (one or several) lists the elements scheduled for it and what realizes, serves or composes them (scopeVia says why each is in), byLayer counts every match by layer and type when there is more than one page, and more names the next call.",
  inputSchema,
  handler: modelSearchHandler,
};
