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
import { nextPageCall } from "../../core/paging.js";
import { compactJson, jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { elementCard, graphConnections } from "./element-card.js";
import { changesetArg, changesetArgFields, loadChangesetGraph } from "./changeset-shared.js";

const changesetFields = changesetArgFields("Changeset ID or name. Defaults to the active changeset.");

// ---------------------------------------------------------------------------
// changeset_impact
// ---------------------------------------------------------------------------

/** Reached elements listed per page by default: ids alone (compact), or each with how it was reached (full). */
export const IMPACT_LIMITS = { compact: 200, full: 50 } as const;

const impactInputSchema = {
  ...changesetFields,
  depth: z.number().int().min(1).max(6).optional().describe("Hops to walk out from the changed elements (default 2)."),
  detail: z
    .enum(["compact", "full"])
    .optional()
    .describe(
      `"compact" (default): byLayer lists the reached elements' ids, nearest first, ${IMPACT_LIMITS.compact} a page ` +
        `(an id the changeset itself changes is marked). "full": each with its name, type, hop, the relationship ` +
        `that reached it and its source files, ${IMPACT_LIMITS.full} a page.`
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `How many reached elements to list, nearest first (default ${IMPACT_LIMITS.compact} compact, ${IMPACT_LIMITS.full} full). ` +
        "A page size: reached, reachedByLayer, perHop and hubs always count everything the walk reaches, and page has " +
        "total, returned, offset and, when more are left, nextOffset. maxElements is the older name."
    ),
  maxElements: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Older name for limit; limit wins when both are given."),
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
    const detail = args.detail ?? "compact";
    const report = computeImpact(graph, {
      depth: args.depth,
      maxElements: args.limit ?? args.maxElements ?? IMPACT_LIMITS[detail],
      offset: args.offset,
      from: args.from,
      hubThreshold: args.hubThreshold,
      expandHubs: args.expandHubs,
    });
    // When the page is not the whole list, say so and name the call that continues it.
    const { page } = report;
    const notes: string[] = [];
    if (page.nextOffset !== undefined) {
      notes.push(
        `byLayer lists ${page.returned} of the ${page.total} elements reached` +
          `${page.offset ? ` (from ${page.offset})` : ""}; reached, reachedByLayer, perHop and hubs count them all. ` +
          `Next page: ${nextPageCall("changeset_impact", { ...args }, page.nextOffset)}.`
      );
    }
    const head = { changeset: { id: changeset.id, name: changeset.name } };
    if (detail === "full") {
      return jsonResult({ ...head, ...report, ...(notes.length > 0 ? { more: notes.join(" ") } : {}) });
    }
    // Compact: the ids alone, an element the changeset itself changes marked (only a walk from chosen elements reaches one).
    const byLayer = Object.fromEntries(
      Object.entries(report.byLayer).map(([layer, list]) => [layer, list.map((e) => (e.status ? `${e.id} (${e.status})` : e.id))])
    );
    notes.push(
      'byLayer lists ids, nearest first; detail: "full" gives each with its name, the relationship that reached it ' +
        "and its source files. from: [...] walks from chosen elements only."
    );
    return jsonResult({ ...head, detail, ...report, byLayer, more: notes.join(" ") }, { compact: true });
  });
}

export const changesetImpactTool: McpToolDefinition<typeof impactInputSchema> = {
  name: "changeset_impact",
  description:
    "Walk the model outward from everything a changeset adds, changes or removes (relationships included), or " +
    "from the elements named in `from`, and list the existing elements it reaches, by layer, plus how many each " +
    "hop reached (perHop). These are what the change can break " +
    "or must update. Compact by default: byLayer lists the reached elements' ids, nearest first; detail: \"full\" " +
    "lists each with how it was reached and its source files. The walk is never cut short: reached, reachedByLayer " +
    "(per layer and type), perHop and hubs count everything, byLayer lists a page (limit: default " +
    `${IMPACT_LIMITS.compact} ids, ${IMPACT_LIMITS.full} in full), page says where that list sits (total, returned, offset, nextOffset when ` +
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
      "Unwired connections (catalog connections an added or updated element has no relationship for). Only the links an " +
        "element of that type is expected to have count (required, high-strength, or carried by existing elements of the type); other catalog triples " +
        "are an `optional` count, listed only with full, and an updated element whose type and relationships the " +
        "change leaves alone is counted apart as `preexisting`. The compact " +
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
        "true the traced, each with what it traces to. [\"gaps\"]: one line per gap. [\"summary\"] or [\"byLayer\"]: " +
        "the counts alone. [\"drift\"]: the drift, its base-change lists paged with the answer's other lists (named " +
        "once: the changeset section then leaves it out). " +
        "[\"layers\"]: each changed element with the connections the change adds or deletes as lines " +
        "(maxConnections per predicate and layer) and the rest counted. [\"unwired\"]: per element. " +
        "[\"codeTouched\"]: files with their changed ids. Others: reach, changesByType, neighborFiles, alreadyInBase, " +
        "acceptedGaps, relationshipChanges, feedback, changeset. With since, the delta comes too, its lists paged with the others " +
        "when delta is named. detail: \"full\" returns the named sections as the full brief has them, all at once, " +
        "whatever their size."
    ),
  layers: z
    .array(z.string())
    .optional()
    .describe(
      "With sections: only the elements in these layers (canonical layer names), in changes, layers, gaps, " +
        "acceptedGaps, unwired, intent, codeTouched, feedback, byLayer and changesByType. With types, both apply; " +
        "ids keep an element by themselves."
    ),
  types: z
    .array(z.string())
    .optional()
    .describe(
      'With sections: only the elements of these types, as "applicationservice" or "application.applicationservice", ' +
        "in the same sections as layers. With layers, both apply (one layer's services); ids keep an element by themselves."
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
        "codeTouched and feedback, each with its incoming staged relationships too. Ids the changeset does not " +
        "change come back in unchanged, a card each (name, description, connections as the plan leaves them)."
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
      "With sections: the most items of each list in one answer (default: as many as keep the answer near " +
        "targetBytes); the page holds fewer when that many would take the answer past targetBytes, and says so. " +
        `Without sections: the entries each id list of the compact brief holds (default ${LIST_LIMIT}: ` +
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
      `With sections: the size the answer aims for, limit or not (default ${SECTIONS_TARGET_BYTES}, about ${SECTIONS_TARGET_BYTES / 1024} KB, which fits one tool ` +
        "result). A target, not a cut-off: a page always holds at least one item. Pass a larger one for larger pages."
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

    // The base's annotations, and the ones staged in this changeset (they land with it).
    const stagedAnnotations = await AnnotationStore.forChangeset(manager.changesetPath(changeset.id!))
      .list()
      .catch((error) => {
        process.stderr.write(`Warning: the changeset's staged annotations could not be read: ${getErrorMessage(error)}\n`);
        return [];
      });
    const annotations = [
      ...(await new AnnotationStore(model.rootPath).list()),
      ...stagedAnnotations.map((a) => ({ ...a, staged: true })),
    ];
    // The reviewer's verdicts from the viewer (keep / drop / ask, with notes), when there are any.
    const review = reviewForAgent(changeset, changeset.review);
    const withReview = <T extends object>(result: T): T => (review ? { ...result, review } : result);

    const sections = args.sections ?? [];
    // With the drift section in the compact form, its base-change lists come whole and page with the
    // answer's other lists, unless the caller pages them apart with driftLimit or driftOffset (#1373).
    const driftWhole =
      sections.includes("drift") && args.detail !== "full" && args.driftLimit === undefined && args.driftOffset === undefined;
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
          ...(driftWhole ? { limit: Number.MAX_SAFE_INTEGER } : {}),
        };
        drift = await describeDrift(model, graph, hash, driftPage);
      } catch (error) {
        drift = {
          isDrifted: hash.isDrifted,
          warnings: [...hash.warnings, `Could not name what drifted: ${getErrorMessage(error)}`],
        };
      }
    }

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
        filter: { layers: args.layers, types: args.types, ids: args.ids, otherLayers: args.otherLayers },
        full: args.detail === "full",
        offset: args.offset,
        limit: args.limit,
        // The reviewer's verdicts ride along: they come out of the same target.
        targetBytes: (args.targetBytes ?? SECTIONS_TARGET_BYTES) - (review ? measure({ review }) : 0),
        maxConnections: args.maxConnections,
        traced: args.traced,
        driftWhole,
        measure,
        callArgs,
        cardsFor: (ids) => {
          const cards: unknown[] = [];
          const missing: string[] = [];
          for (const id of ids) {
            const element = graph.getElement(id);
            if (!element) {
              missing.push(id);
              continue;
            }
            cards.push(elementCard(element, graphConnections(graph, element.id), { status: element.status }));
          }
          return { cards, missing };
        },
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
    const narrows = args.layers?.length || args.types?.length || args.ids?.length;
    if (narrows || sectionOnly.some((value) => value !== undefined && value !== 0 && value !== false)) {
      compact.note =
        "layers, types, ids, otherLayers, offset, targetBytes, maxConnections and traced shape sections output only, so the whole compact brief is returned. Pass sections too, " +
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
    "required relationships, connections its peers have except for external elements and ones the type's own accepted gaps cover, " +
    "and accepted gaps the plan contradicts, each with its gap_reopen call); accepted gaps (connections an element decided against with " +
    "gap_accept, with the reason: not open, and contradicted when the plan wires one anyway); intent, which covers the " +
    "added and updated elements outside motivation, business and product (those layers are what the others trace to, " +
    "so a plan made only of them has nothing to trace and says so): counts of traced, untraced and unanchored (changes " +
    "that reach no goal, requirement or feature, or only an added one that itself traces to nothing; an added " +
    "requirement, feature or capability that realizes, satisfies or supports a goal or outcome, added or not, is " +
    "anchored there) with the " +
    "untraced ids, where a part traces through the whole that composes it, an element through what it realizes (hubs " +
    "included), and an element whose type the catalog gives " +
    "no relationship to those layers is counted apart (noCatalogRoute), not as untraced. The trace walks maxHops " +
    `hops (default ${INTENT_TRACE_DEPTH}) and not through an element with more than hubThreshold relationships (default ${DEFAULT_HUB_THRESHOLD}): ` +
    "intent.walk names both and counts the elements that rule leaves untraced; drift since " +
    "the changeset was created; unwired connections (catalog connections an added or updated element has no " +
    "relationship for) counted per layer, only the links an element of its type is expected to have (required, high-strength, or carried by existing elements of the type), with the optional catalog triples and the pre-existing ones of updated elements counted apart; the files of the changed elements; open review annotations; and each " +
    "changed element with its type, operation and connections as `predicate → id` lines (for a plan of more " +
    "than 60 elements, counts per type with the first ids of each, and long id lists counted per type). " +
    "sections: [...] returns only the sections named, with a small header, in compact forms. Long lists come a " +
    "page at a time, sized to fit one tool result: page gives each list's true total and how many items the " +
    "answer holds, with nextOffset while any has more, and more names the exact next call (offset, limit), so no " +
    "answer reads as complete when it is not. Narrow with layers, types or ids (ids the plan does not change " +
    'come back in unchanged, a card each). detail: "full" returns the whole brief (attributes, connection names, ' +
    "the unwired listing, code per " +
    "element), or with sections those sections in full. It returns a revision and a revisionToken: pass the token back as since on the " +
    "next pass to get what changed. Use it to pressure-test a plan and, at the start of a build, as its spec. When the " +
    "reviewer has given verdicts in the viewer, review lists them (keep / drop / ask per change sequence, with notes).",
  inputSchema: briefInputSchema,
  handler: changesetBriefHandler,
};
