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
        "count everything the walk reaches, and nextOffset is set when more are left."
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Skip this many reached elements: pass a result's nextOffset to read the next page."),
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
    const more =
      report.nextOffset !== undefined
        ? {
            more:
              `byLayer lists ${report.returned} of the ${report.reached} elements reached` +
              `${report.offset ? ` (from ${report.offset})` : ""}; reached, perHop and hubs count them all. Next page: ` +
              `changeset_impact ${JSON.stringify({ ...impactCallArgs(args), offset: report.nextOffset })}.`,
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
    "nearest maxElements (default 200), and when more are left the result has nextOffset and the call for the " +
    "next page. Hubs (elements with more than hubThreshold relationships) are listed with their degree and " +
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
        "counts), each in a compact form. Every list section reports in pages its true total, how many items this " +
        "answer holds and, when more are left, nextOffset and the exact call for the next page: nothing is dropped, " +
        `and counts and summaries are over the whole list. Without limit, pages are sized so the answer weighs about ${SECTIONS_TARGET_BYTES / 1024} KB ` +
        "(targetBytes changes that); a list not returned whole also gets a summary of all of it. " +
        "[\"changes\"] is the build view: each changed element with its name, description, attributes, changed fields " +
        "(before and after), files and connections as `predicate → id` lines. [\"intent\"]: counts, the untraced ids " +
        "(the list that pages, with every untraced element counted per type beside a page), the unanchored, and the " +
        "traced with what each traces to when there are at most limit of them. [\"gaps\"]: one line per gap. " +
        "[\"layers\"]: each changed element with the connections the change adds or deletes as lines " +
        "(maxConnections per predicate and layer) and the rest counted. [\"unwired\"]: per element. " +
        "[\"codeTouched\"]: files with their changed ids. Others: drift, alreadyInBase, acceptedGaps, " +
        "relationshipChanges, feedback, changeset. With since, the delta comes too, its lists paged the same way " +
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
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "With sections: skip this many items of each list section named (elements, gaps, untraced ids, files). " +
        "pages gives each section's nextOffset; page one section at a time."
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "With sections: items per list section, whatever their size. Default: as many as keep the answer near " +
        `targetBytes. Also the most traced, unanchored and noCatalogRoute elements the intent section lists by id (default ${LIST_LIMIT}), ` +
        `and the entries per delta list (default ${LIST_LIMIT}).`
    ),
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
        drift = await describeDrift(model, graph, hash);
      } catch (error) {
        drift = {
          isDrifted: hash.isDrifted,
          warnings: [...hash.warnings, `Could not name what drifted: ${getErrorMessage(error)}`],
        };
      }
    }

    const sections = args.sections ?? [];
    if (args.detail === "full" && sections.length === 0) {
      const brief = buildBrief({ graph, annotations, drift, unwired: args.unwired, unwiredLayers: args.unwiredLayers });
      // The full brief is the largest result: same JSON, short objects kept on one line.
      if (args.since === undefined) return jsonResult(withReview(brief), { compact: true });
      return jsonResult(withReview({ ...brief, delta: await briefDelta(model, { graph, brief }, args.since) }), { compact: true });
    }

    // The unwired listing only when asked for; otherwise (compact) counted per layer.
    const listUnwired = args.unwired !== undefined || args.unwiredLayers !== undefined || sections.includes("unwired");
    const brief = buildBrief({
      graph,
      annotations,
      drift,
      unwired: listUnwired ? (args.unwired ?? "summary") : "none",
      unwiredLayers: args.unwiredLayers,
    });
    const delta = args.since === undefined ? undefined : await briefDelta(model, { graph, brief }, args.since);
    if (sections.length > 0) {
      // Only what was asked for; an unwired listing asked for by its own arguments counts as asked.
      const named = listUnwired && !sections.includes("unwired") && args.unwired !== "none" ? [...sections, "unwired" as const] : sections;
      const measure = (value: unknown) => Buffer.byteLength(compactJson(value), "utf-8");
      // The caller's own arguments, repeated in each page's next call (sections and offset are set per page).
      const { sections: _sections, offset: _offset, since: _since, ...own } = args;
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
        measure,
        callArgs: { ...callArgs, ...(args.since !== undefined && named.includes("delta") ? { since: args.since } : {}) },
      });
      return jsonResult(withReview(result), { compact: true });
    }
    const compact = compactBrief(brief, { unwired: listUnwired ? undefined : computeUnwired(graph), delta });
    const sectionOnly = [args.otherLayers?.length, args.offset, args.limit, args.targetBytes, args.maxConnections];
    if (args.layers?.length || args.ids?.length || sectionOnly.some((value) => value !== undefined && value !== 0)) {
      compact.note =
        "layers, ids, otherLayers, offset, limit, targetBytes and maxConnections shape sections output only, so the whole compact brief is returned. Pass sections too, " +
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
    "untraced ids, where a part traces through the whole that composes it and an element whose type the catalog gives " +
    "no relationship to those layers is counted apart (noCatalogRoute), not as untraced; drift since " +
    "the changeset was created; unwired connections (catalog connections an added or updated element has no " +
    "relationship for) counted per layer; the files of the changed elements; open review annotations; and each " +
    "changed element with its type, operation and connections as `predicate → id` lines (for a plan of more " +
    "than 60 elements, counts per type with the first ids of each, and long id lists counted per type). " +
    "sections: [...] returns only the sections named, with a small header, in compact forms. A long list comes a " +
    "page at a time, sized to fit one tool result: pages gives each list's true total, how many items the answer " +
    "holds and the exact call for the next page (offset, limit), so no answer reads as complete when it is not. " +
    "Narrow with layers or ids. detail: \"full\" returns the whole brief (attributes, connection names, the unwired listing, code per " +
    "element), or with sections those sections in full. It returns a revision and a revisionToken: pass the token back as since on the " +
    "next pass to get what changed. Use it to pressure-test a plan and, at the start of a build, as its spec. When the " +
    "reviewer has given verdicts in the viewer, review lists them (keep / drop / ask per change sequence, with notes).",
  inputSchema: briefInputSchema,
  handler: changesetBriefHandler,
};
