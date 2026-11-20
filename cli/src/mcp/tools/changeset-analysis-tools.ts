/**
 * changeset_impact, changeset_brief — pressure-test a planned change against the model.
 * See `cli/src/core/changeset-analysis.ts` and docs/CHANGE_MODELING.md.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AnnotationStore } from "../../core/annotation-store.js";
import {
  buildBrief,
  computeImpact,
  computeUnwired,
  DEFAULT_HUB_THRESHOLD,
  INTENT_TRACE_DEPTH,
  type BriefDrift,
} from "../../core/changeset-analysis.js";
import { briefDelta } from "../../core/changeset-brief-delta.js";
import {
  BRIEF_SECTIONS,
  briefSections,
  compactBrief,
  CONNECTIONS_PER_GROUP,
  LIST_LIMIT,
  SECTIONS_TARGET_BYTES,
} from "../../core/changeset-brief-compact.js";
import { describeDrift } from "../../core/changeset-base-index.js";
import { getErrorMessage } from "../../utils/errors.js";
import { reviewForAgent } from "../../core/changeset-review.js";
import { compactJson, jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { changesetArg, changesetArgFields, loadChangesetGraph } from "./changeset-shared.js";

const changesetFields = changesetArgFields("Changeset ID or name. Defaults to the active changeset.");

// ---------------------------------------------------------------------------
// changeset_impact
// ---------------------------------------------------------------------------

const impactInputSchema = {
  ...changesetFields,
  depth: z.number().int().min(1).max(6).optional().describe("Hops to walk out from the changed elements (default 2)."),
  maxElements: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "How many reached elements to list, nearest first (default 200). A page size: reached, perHop and hubs always " +
        "count everything the walk reaches, and page has total, returned, offset and, when more are left, nextOffset."
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Skip this many reached elements: pass a result's page.nextOffset to read the next page."),
  from: z
    .array(z.string())
    .optional()
    .describe(
      "Element ids or paths to walk from instead of every changed element. Ids the projected model does not have " +
        "are listed in unknownFrom."
    ),
  hubThreshold: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      `An element with more relationships than this is a hub: listed in hubs with its degree and not walked ` +
        `through (default ${DEFAULT_HUB_THRESHOLD}).`
    ),
  expandHubs: z.boolean().optional().describe("Walk through hubs too (default false)."),
  rootPath: rootPathSchema,
};

export type ChangesetImpactArgs = z.infer<z.ZodObject<typeof impactInputSchema>>;

export async function changesetImpactHandler(args: ChangesetImpactArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const { changeset, graph } = await loadChangesetGraph(model, changesetArg(args));
    const report = computeImpact(graph, {
      depth: args.depth,
      maxElements: args.maxElements,
      offset: args.offset,
      from: args.from,
      hubThreshold: args.hubThreshold,
      expandHubs: args.expandHubs,
    });
    // When the page is not the whole list, say so and name the call that continues it.
    const { page } = report;
    const more =
      page.nextOffset !== undefined
        ? {
            more:
              `byLayer lists ${page.returned} of the ${page.total} elements reached` +
              `${page.offset ? ` (from ${page.offset})` : ""}; reached, perHop and hubs count them all. Next page: ` +
              `changeset_impact ${JSON.stringify({ ...impactCallArgs(args), offset: page.nextOffset })}.`,
          }
        : {};
    return jsonResult({ changeset: { id: changeset.id, name: changeset.name }, ...report, ...more });
  });
}

/** The caller's own arguments, for the call that returns the next page (rootPath left to the client's default when unset). */
function impactCallArgs(args: ChangesetImpactArgs): Record<string, unknown> {
  const { offset: _offset, ...rest } = args;
  return Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
}

export const changesetImpactTool: McpToolDefinition<typeof impactInputSchema> = {
  name: "changeset_impact",
  description:
    "Walk the model outward from everything a changeset adds, changes or removes (relationships included), or " +
    "from the elements named in `from`, and list the existing elements it reaches, by layer, with how each was " +
    "reached and its source files, plus how many each hop reached (perHop). These are what the change can break " +
    "or must update. The walk is never cut short: reached, perHop and hubs count everything, byLayer lists the " +
    "nearest maxElements (default 200), page says where that list sits (total, returned, offset, nextOffset when " +
    "more are left), and more names the call for the next page. Hubs (elements with more than hubThreshold relationships) are listed with their degree and " +
    "not walked through unless expandHubs is set.",
  inputSchema: impactInputSchema,
  handler: changesetImpactHandler,
};

// ---------------------------------------------------------------------------
// changeset_brief
// ---------------------------------------------------------------------------

const briefInputSchema = {
  ...changesetFields,
  unwired: z
    .enum(["summary", "full", "none"])
    .optional()
    .describe(
      "Unwired connections (catalog connections an added or updated element has no relationship for). The compact " +
        "brief counts them per layer unless this is set. summary (the full brief's default) counts them per element " +
        "and layer and lists the ones in layers the change already reaches whose other type the model has (existing " +
        "or added), counting the rest as typesNotInModel; full lists them all; none omits them."
    ),
  unwiredLayers: z
    .array(z.string())
    .optional()
    .describe("Only show unwired connections whose other end is in these layers (and list them)."),
  detail: z
    .enum(["compact", "full"])
    .optional()
    .describe(
      "compact (default): counts by layer, reach, gaps one line each, intent as counts and the untraced ids, drift, " +
        "unwired counts per layer, and each changed element with its connections as `predicate → id` lines. full: " +
        "the whole brief (attributes, connection names and layers, unwired listing, code per element), far past one " +
        "tool result on a large plan; with sections, only those sections, in full."
    ),
  sections: z
    .array(z.enum(BRIEF_SECTIONS))
    .optional()
    .describe(
      "Return only these sections, with a small header (revision, the changeset's id, name and status, summary " +
        "counts), each in a compact form. Every list in the answer is the same page (limit items from offset): page " +
        "has each list's true total (totals) and how many items the answer holds (returned), and nextOffset while " +
        "any list has more, so the same call with that offset continues them all. Nothing is dropped, and counts " +
        `and summaries are over the whole lists. Without limit, the page is as long as keeps the answer near ${SECTIONS_TARGET_BYTES / 1024} KB ` +
        "(targetBytes changes that); a section returned in part also gets a summary of all of it. " +
        "[\"changes\"] is the build view: each changed element with its name, description, attributes, changed fields " +
        "(before and after), files and connections as `predicate → id` lines. [\"intent\"]: counts, the untraced ids " +
        "(every untraced element counted per type beside a page of them), the unanchored, the noCatalogRoute ids, " +
        "the walk's maxHops and hubThreshold with how many elements the hub rule leaves untraced, and with traced: " +
        "true the traced, each with what it traces to. [\"gaps\"]: one line per gap. " +
        "[\"layers\"]: each changed element with the connections the change adds or deletes as lines " +
        "(maxConnections per predicate and layer) and the rest counted. [\"unwired\"]: per element. " +
        "[\"codeTouched\"]: files with their changed ids. Others: drift, alreadyInBase, acceptedGaps, " +
        "relationshipChanges, feedback, changeset. With since, the delta comes too, its lists paged with the others " +
        "when delta is named. detail: \"full\" returns the named sections as the full brief has them, all at once, " +
        "whatever their size."
    ),
  layers: z
    .array(z.string())
    .optional()
    .describe(
      "With sections: only the elements in these layers (canonical layer names), in changes, layers, gaps, " +
        "acceptedGaps, unwired, intent, codeTouched and feedback. Combines with ids (either keeps an element)."
    ),
  otherLayers: z
    .array(z.string())
    .optional()
    .describe(
      "With sections layers: list only the connections whose other end is in these layers and count the rest (e.g. " +
        "leave out testing, so 40 test cases on a service are one count)."
    ),
  ids: z
    .array(z.string())
    .optional()
    .describe(
      "With sections: only these changed elements (ids), in changes, layers, gaps, acceptedGaps, unwired, intent, " +
        "codeTouched and feedback."
    ),
  driftLimit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "The most entries of each of the drift's base-change lists (elements added, removed and changed, " +
        "relationships added and removed) in one answer (default 50). baseChanges.counts always has the true totals."
    ),
  driftOffset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Skip this many entries of each drift base-change list: pass the previous answer's " +
        "drift.baseChanges.page.nextOffset. The overlapping list is always whole."
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "With sections: skip this many items of every list in the answer (elements, gaps, untraced ids, files). " +
        "Repeat the call with the same arguments and the previous answer's page.nextOffset for the next page."
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "With sections: the most items of each list in one answer, whatever their size (default: as many as keep " +
        `the answer near targetBytes). Without sections: the entries each id list of the compact brief holds (default ${LIST_LIMIT}: ` +
        "intent, the delta, gaps before they are grouped). A page size, not a cut-off: totals are always given."
    ),
  idsPerType: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Without sections: ids shown per type in the compact brief's summaries (changesByType and grouped gaps; " +
        "default 5). The counts beside them are of every element."
    ),
  traced: z
    .boolean()
    .optional()
    .describe(
      "With sections intent: also list the traced elements, each with the intent element it traces to, paged like " +
        "the other lists. Default: the traced are counted, not listed."
    ),
  hubThreshold: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      `The intent trace does not walk through an element with more relationships than this (default ${DEFAULT_HUB_THRESHOLD}). ` +
        "intent.walk names the value used and how many elements it leaves untraced that a larger one would trace."
    ),
  maxHops: z
    .number()
    .int()
    .min(1)
    .max(8)
    .optional()
    .describe(`How many hops the intent trace walks from a changed element (default ${INTENT_TRACE_DEPTH}).`),
  targetBytes: z
    .number()
    .int()
    .min(2000)
    .optional()
    .describe(
      `With sections and no limit: the size the answer aims for (default ${SECTIONS_TARGET_BYTES}, about ${SECTIONS_TARGET_BYTES / 1024} KB, which fits one tool ` +
        "result). A target, not a cut-off: a page always holds at least one item."
    ),
  maxConnections: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      `With sections layers: connections listed per element for one direction, predicate and other layer (default ${CONNECTIONS_PER_GROUP}); ` +
        "the rest are counted in connectionCounts."
    ),
  since: z
    .union([z.number().int().min(-1), z.string().regex(/^(-1|\d+):[0-9a-f]+$/, "a revisionToken from a brief")])
    .optional()
    .describe(
      "A revision (or, better, the revisionToken) an earlier brief returned. Adds a delta: elements added, removed " +
        "or updated (with the fields), relationships added or removed, changes unstaged, gaps opened and closed, " +
        "unwired connections wired, layers newly reached or no longer reached, intent newly traced since then. " +
        "Unstaging does not invalidate it. With the token, the delta warns when a change up to that revision was " +
        "rewritten in place since."
    ),
  rootPath: rootPathSchema,
};

export type ChangesetBriefArgs = z.infer<z.ZodObject<typeof briefInputSchema>>;

export async function changesetBriefHandler(args: ChangesetBriefArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const { manager, changeset, graph } = await loadChangesetGraph(model, changesetArg(args));

    const annotations = await new AnnotationStore(model.rootPath).list();
    // The reviewer's verdicts from the viewer (keep / drop / ask, with notes), when there are any.
    const review = reviewForAgent(changeset, changeset.review);
    const withReview = <T extends object>(result: T): T => (review ? { ...result, review } : result);

    let drift: BriefDrift | undefined;
    if (changeset.status === "staged") {
      // Each part is reported on failure and the brief goes on: the hash check, then the structured view.
      let hash: { isDrifted: boolean; warnings: string[]; baseSnapshotId?: string; currentSnapshotId?: string };
      try {
        hash = await manager.detectDrift(changeset.id);
      } catch (error) {
        hash = { isDrifted: false, warnings: [`Drift check failed: ${getErrorMessage(error)}`] };
      }
      try {
        // The drift's base-change lists page with driftLimit and driftOffset, which describeDrift takes
        // as limit and offset.
        const driftPage: Parameters<typeof describeDrift>[3] & { limit?: number; offset?: number } = {
          ...(args.driftLimit !== undefined ? { limit: args.driftLimit } : {}),
          ...(args.driftOffset !== undefined ? { offset: args.driftOffset } : {}),
        };
        drift = await describeDrift(model, graph, hash, driftPage);
      } catch (error) {
        drift = {
          isDrifted: hash.isDrifted,
          warnings: [...hash.warnings, `Could not name what drifted: ${getErrorMessage(error)}`],
        };
      }
    }

    const sections = args.sections ?? [];
    // The two numbers that bound the intent trace: the caller's, or the defaults.
    const walk = {
      ...(args.hubThreshold !== undefined ? { hubThreshold: args.hubThreshold } : {}),
      ...(args.maxHops !== undefined ? { maxHops: args.maxHops } : {}),
    };
    if (args.detail === "full" && sections.length === 0) {
      const brief = buildBrief({ graph, annotations, drift, unwired: args.unwired, unwiredLayers: args.unwiredLayers, ...walk });
      // The full brief is the largest result: same JSON, short objects kept on one line.
      if (args.since === undefined) return jsonResult(withReview(brief), { compact: true });
      return jsonResult(withReview({ ...brief, delta: await briefDelta(model, { graph, brief }, args.since, walk) }), { compact: true });
    }

    // The unwired listing only when asked for; otherwise (compact) counted per layer.
    const listUnwired = args.unwired !== undefined || args.unwiredLayers !== undefined || sections.includes("unwired");
    const brief = buildBrief({
      graph,
      annotations,
      drift,
      unwired: listUnwired ? (args.unwired ?? "summary") : "none",
      unwiredLayers: args.unwiredLayers,
      ...walk,
    });
    const delta = args.since === undefined ? undefined : await briefDelta(model, { graph, brief }, args.since, walk);
    if (sections.length > 0) {
      // Only what was asked for; an unwired listing asked for by its own arguments counts as asked.
      const named = listUnwired && !sections.includes("unwired") && args.unwired !== "none" ? [...sections, "unwired" as const] : sections;
      const measure = (value: unknown) => Buffer.byteLength(compactJson(value), "utf-8");
      // The caller's own arguments, repeated in the next call the answer names (with the next offset).
      const { sections: _sections, offset: _offset, ...own } = args;
      const callArgs = Object.fromEntries(Object.entries(own).filter(([, value]) => value !== undefined));
      const result = briefSections(brief, named, {
        delta,
        filter: { layers: args.layers, ids: args.ids, otherLayers: args.otherLayers },
        full: args.detail === "full",
        offset: args.offset,
        limit: args.limit,
        // The reviewer's verdicts ride along: they come out of the same target.
        targetBytes: (args.targetBytes ?? SECTIONS_TARGET_BYTES) - (review ? measure({ review }) : 0),
        maxConnections: args.maxConnections,
        traced: args.traced,
        measure,
        callArgs,
      });
      return jsonResult(withReview(result), { compact: true });
    }
    const compact = compactBrief(brief, {
      unwired: listUnwired ? undefined : computeUnwired(graph),
      delta,
      limit: args.limit,
      idsPerType: args.idsPerType,
    });
    const sectionOnly = [args.otherLayers?.length, args.offset, args.targetBytes, args.maxConnections, args.traced];
    if (args.layers?.length || args.ids?.length || sectionOnly.some((value) => value !== undefined && value !== 0 && value !== false)) {
      compact.note =
        "layers, ids, otherLayers, offset, targetBytes, maxConnections and traced shape sections output only, so the whole compact brief is returned. Pass sections too, " +
        'e.g. sections: ["changes"] with them for those elements\' build view.';
    }
    return jsonResult(withReview(compact), { compact: true });
  });
}

export const changesetBriefTool: McpToolDefinition<typeof briefInputSchema> = {
  name: "changeset_brief",
  description:
    "Render a changeset as the spec for its change. By default a compact summary: counts by layer and operation; " +
    "which layers the change reaches and which it does not; gaps, one line each (unconnected additions, missing " +
    "required relationships, connections its peers have); accepted gaps (connections an element decided against with " +
    "gap_accept, with the reason: not open, and contradicted when the plan wires one anyway); intent, which covers the " +
    "added and updated elements outside motivation, business and product (those layers are what the others trace to, " +
    "so a plan made only of them has nothing to trace and says so): counts of traced, untraced and unanchored (changes " +
    "that reach no goal, requirement or feature, or only an added one that itself traces to nothing) with the " +
    "untraced ids, where a part traces through the whole that composes it, an element through what it realizes (hubs " +
    "included), and an element whose type the catalog gives " +
    "no relationship to those layers is counted apart (noCatalogRoute), not as untraced. The trace walks maxHops " +
    `hops (default ${INTENT_TRACE_DEPTH}) and not through an element with more than hubThreshold relationships (default ${DEFAULT_HUB_THRESHOLD}): ` +
    "intent.walk names both and counts the elements that rule leaves untraced; drift since " +
    "the changeset was created; unwired connections (catalog connections an added or updated element has no " +
    "relationship for) counted per layer; the files of the changed elements; open review annotations; and each " +
    "changed element with its type, operation and connections as `predicate → id` lines (for a plan of more " +
    "than 60 elements, counts per type with the first ids of each, and long id lists counted per type). " +
    "sections: [...] returns only the sections named, with a small header, in compact forms. Long lists come a " +
    "page at a time, sized to fit one tool result: page gives each list's true total and how many items the " +
    "answer holds, with nextOffset while any has more, and more names the exact next call (offset, limit), so no " +
    "answer reads as complete when it is not. Narrow with layers or ids. detail: \"full\" returns the whole brief (attributes, connection names, the unwired listing, code per " +
    "element), or with sections those sections in full. It returns a revision and a revisionToken: pass the token back as since on the " +
    "next pass to get what changed. Use it to pressure-test a plan and, at the start of a build, as its spec. When the " +
    "reviewer has given verdicts in the viewer, review lists them (keep / drop / ask per change sequence, with notes).",
  inputSchema: briefInputSchema,
  handler: changesetBriefHandler,
};
