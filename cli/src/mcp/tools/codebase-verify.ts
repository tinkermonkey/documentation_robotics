/**
 * codebase_verify — compare what the code analyzer found in the code with the model, layer by
 * layer, as structured data: HTTP routes against API operations (analyzers/verify-engine.ts), and
 * SQL tables, infrastructure and test cases against the data-store, technology and testing layers
 * (analyzers/layer-verify.ts). A model element sourced to a file the analyzer didn't index is
 * reported as not indexed, not as drift. `status` leads the result: each layer is in step,
 * drifted or not checked (analyzers/verify-status.ts), and a layer that compared nothing is
 * never reported as in step. The same report as `dr analyzer verify --json`, through
 * the analyzer's verify(), except for the default layers: this tool checks every layer with a
 * check, while `dr analyzer verify` without --layer checks only the API layer. Read-only.
 *
 * It needs a usable index (codebase-shared.ts judgeIndex): when there is none, a run is in
 * flight, or source files changed in commits since the last one, it says so and points at
 * codebase_index. Uncommitted edits newer than the index give a warning, not a refusal.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { splitVerifyLayers, VERIFIABLE_LAYERS } from "../../analyzers/active-analyzer.js";
import { apiLayerReport } from "../../analyzers/verify-engine.js";
import type { LayerVerifyReport } from "../../analyzers/types.js";
import { PagedLists, type ListPage, type PageArgs } from "../../core/list-page.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import type { Model } from "../../core/model.js";
import {
  routeHandlerContradictions,
  type ContradictedByHandler,
  type LocatedElement,
} from "../../core/accepted-gaps-verify.js";
import {
  analyzerNotFoundError,
  canonicalRoots,
  defaultCodebaseToolDeps,
  requireFreshIndex,
  type CodebaseToolDeps,
} from "./codebase-shared.js";

/**
 * Entries returned per list by default. A page size and a size target (four layers of findings in
 * about 40 KB), never a cut-off: every list gives its true total and the offset of its next page.
 */
export const VERIFY_PAGE_SIZE = 50;
/**
 * The size the default page aims at, in bytes of listed entries. When the lists together pass it
 * and the caller gave no limit, the page is halved (never below VERIFY_MIN_PAGE_SIZE): fewer
 * entries per call, all of them still reachable. An explicit limit is taken as given.
 */
export const VERIFY_SIZE_TARGET = 40_000;
export const VERIFY_MIN_PAGE_SIZE = 10;

const inputSchema = {
  layers: z
    .array(z.string())
    .optional()
    .describe(`Layers to verify (default: all of ${VERIFIABLE_LAYERS.join(", ")}, the layers with a check); others are listed as not verified.`),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `The most entries to return from each list (default ${VERIFY_PAGE_SIZE}, lowered when the lists together would pass about ` +
        `${Math.round(VERIFY_SIZE_TARGET / 1000)} KB; paging.limit says what was used; any size is accepted). A page size, not a cut-off: ` +
        "statuses, coverage and summary counts are over everything, and each list that is not whole gives its total and nextOffset."
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Skip this many entries of each list: repeat the call with the same arguments and the result's paging.nextOffset for the next page."),
  rootPath: rootPathSchema,
};

export type CodebaseVerifyArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/** What every report says about its reach, so its findings aren't read as more than they are. */
export const VERIFY_SCOPE =
  `codebase_verify checks the ${VERIFIABLE_LAYERS.join(", ")} layers against the code: HTTP routes against API operations (and the ` +
  "routes an OpenAPI file declares against the operations sourced to that file), SQL tables against data-store collections, " +
  "compose services, Kubernetes objects, images and launched programs against technology elements (a Kubernetes Secret as a " +
  "configuration artifact; system software sourced to a dependency manifest against what the manifest lists), and test cases " +
  "and their tests relationships against the testing layer. status gives each layer's result first: in_step (compared, nothing " +
  "differs), drifted (the buckets say what) or not_checked (nothing could be compared; not_checked under the layer says why and " +
  "what would make it checkable). A layer that was not checked is not in step. not_indexed is a parse gap, not drift. It says " +
  "nothing about the other layers, or about elements of other types in these.";

/** Said when the code serves no routes the analyzer can read: a library's operations are not drift. */
export const NO_ROUTES_NOTE =
  "The analyzer found no HTTP routes served in the code (a library, a CLI, a frontend, or routes it can't read). An API " +
  "operation sourced to code is then listed under the api layer's not_checked, not as drift, unless its source file is gone " +
  "or no longer names it; don't change the model because of it.";

/** Said when routes are in the code only: which tools close the gap. */
export const IN_CODE_ONLY_HINT =
  "Routes in the code that the model has no operation for: codebase_extract stages an operation for each, with its source " +
  "reference (an operation added with model_add is matched only when it has sourceFile and sourceSymbol, or http_method and " +
  "http_path). For a route that is not product code (a test fixture, an example), codebase_extract with reject records it, and " +
  "this check then leaves it out.";

/** The lists of one layer's report, each a page; `lists` names the ones that are not whole. */
type PagedLayer = LayerVerifyReport & { lists?: Record<string, ListPage> };

/**
 * A layer's report with every list a page of it: its buckets, the ids of its not-checked groups
 * and its relationships. The status, coverage, summary and each group's count are untouched: they
 * are over the whole layer. One window applies to every list, so one call returns the next page of
 * each.
 */
export function pageLayerReport(layer: LayerVerifyReport, args: PageArgs): { layer: PagedLayer; pager: PagedLists } {
  const pager = new PagedLists(args, VERIFY_PAGE_SIZE);
  const buckets = {
    matched: pager.list("matched", layer.buckets.matched),
    in_graph_only: pager.list("in_graph_only", layer.buckets.in_graph_only),
    in_model_only: pager.list("in_model_only", layer.buckets.in_model_only),
    not_indexed: pager.list("not_indexed", layer.buckets.not_indexed),
    ...(layer.buckets.ignored ? { ignored: pager.list("ignored", layer.buckets.ignored) } : {}),
  };
  const notChecked = layer.not_checked?.map((group, i) => ({ ...group, ids: pager.list(`not_checked[${i}].ids`, group.ids) }));
  const relationships = layer.relationships
    ? {
        matched: pager.list("relationships.matched", layer.relationships.matched),
        in_graph_only: pager.list("relationships.in_graph_only", layer.relationships.in_graph_only),
        in_model_only: pager.list("relationships.in_model_only", layer.relationships.in_model_only),
      }
    : undefined;
  return {
    pager,
    layer: {
      ...layer,
      ...(notChecked ? { not_checked: notChecked } : {}),
      buckets,
      ...(relationships ? { relationships } : {}),
      ...(Object.keys(pager.pages).length > 0 ? { lists: pager.pages } : {}),
    },
  };
}

export function createCodebaseVerifyHandler(deps: CodebaseToolDeps = defaultCodebaseToolDeps) {
  return async function codebaseVerifyHandler(args: CodebaseVerifyArgs): Promise<CallToolResult> {
    return runTool(async () => {
      const model = await loadModel(args.rootPath);
      // The same spelling codebase_index's run indexed under (see canonicalRoots).
      const { projectRoot, codebaseRoot } = await canonicalRoots(model);

      const { verifiable, unsupported } = splitVerifyLayers(args.layers && args.layers.length > 0 ? args.layers : VERIFIABLE_LAYERS);
      const notVerified = unsupported.map((layer) => ({ layer, reason: "No verification available for this layer" }));
      if (verifiable.length === 0) {
        return jsonResult({
          status: notVerified.map((n) => ({ layer: n.layer, status: "not_checked" as const, text: `Not checked: ${n.reason}.` })),
          layers_verified: [],
          layers_not_verified: notVerified,
          scope: VERIFY_SCOPE,
        });
      }

      const { analyzer, index } = await requireFreshIndex(projectRoot, codebaseRoot, deps, "codebase_verify", {
        uncommittedEdits: true,
      });

      const backend = await deps.getAnalyzer(analyzer);
      if (!backend) throw analyzerNotFoundError(analyzer);

      const report = await backend.verify(projectRoot, {
        layers: verifiable,
        changesetAware: true,
        codebaseRoot,
      });
      // The layers the analyzer couldn't check (its check failed) and the ones no check exists for.
      const notVerifiedAll = [...(report.layers_not_verified ?? []), ...notVerified];
      const failed = new Set(notVerifiedAll.map((n) => n.layer));
      // Routes the code serves, as the analyzer reads them: matched, in the code only, or left out
      // by a rule or a recorded rejection. Routes an API description declares are not served ones.
      const routesInCode = report.summary.total_graph_entries - report.buckets.matched.filter((m) => m.declared_in).length - report.buckets.in_graph_only.filter((g) => g.declared_in).length;
      const acceptedGaps = await acceptedGapsInRoutes(model, report.buckets.matched);
      const apiVerified = verifiable.includes("api") && !failed.has("api");
      // Each layer's result first: in step, drifted, or not checked. A layer whose check failed,
      // or that has no check, was not checked.
      // A backend that returns only the API buckets still gets the API layer's status.
      const layers = report.layers ?? (apiVerified ? [apiLayerReport(report)] : []);
      // Every list is a page (limit, offset); what is not whole is named, with the call for the rest.
      // Without a limit the page is VERIFY_PAGE_SIZE entries per list, halved while the lists
      // together pass the size target: the target shapes the default, and nothing is dropped.
      const pageAt = (pageArgs: PageArgs) => {
        const paged = layers.map((l) => pageLayerReport(l, pageArgs));
        const top = new PagedLists(pageArgs, VERIFY_PAGE_SIZE);
        // The top-level buckets are the API layer's lists, on the same page.
        const buckets = {
          ...report.buckets,
          matched: top.list("matched", report.buckets.matched),
          in_graph_only: top.list("in_graph_only", report.buckets.in_graph_only),
          in_model_only: top.list("in_model_only", report.buckets.in_model_only),
          ignored: top.list("ignored", report.buckets.ignored),
          ...(report.buckets.not_indexed ? { not_indexed: top.list("not_indexed", report.buckets.not_indexed) } : {}),
          ...(report.buckets.not_checked
            ? { not_checked: report.buckets.not_checked.map((group, i) => ({ ...group, ids: top.list(`not_checked[${i}].ids`, group.ids) })) }
            : {}),
        };
        return { paged, top, buckets };
      };
      let limit = args.limit ?? VERIFY_PAGE_SIZE;
      let page = pageAt({ limit, offset: args.offset });
      // Measured as the result is printed (indented), since that is what the caller receives.
      const sizeOf = (p: typeof page) => JSON.stringify([p.paged.map((x) => x.layer), p.buckets], null, 2).length;
      while (args.limit === undefined && limit > VERIFY_MIN_PAGE_SIZE && sizeOf(page) > VERIFY_SIZE_TARGET) {
        limit = Math.max(Math.ceil(limit / 2), VERIFY_MIN_PAGE_SIZE);
        page = pageAt({ limit, offset: args.offset });
      }
      const { paged, top, buckets } = page;
      const shortened = paged.filter((p) => Object.keys(p.pager.pages).length > 0);
      const nextOffset = shortened.some((p) => p.pager.nextOffset !== undefined) ? top.offset + top.limit : undefined;
      const paging = {
        limit: top.limit,
        offset: top.offset,
        ...(nextOffset !== undefined ? { nextOffset } : {}),
        ...(shortened.length > 0
          ? {
              more:
                `Lists are pages of ${top.limit} entries from ${top.offset}` +
                (args.limit === undefined && top.limit < VERIFY_PAGE_SIZE
                  ? ` (the default of ${VERIFY_PAGE_SIZE}, lowered to keep this result near ${Math.round(VERIFY_SIZE_TARGET / 1000)} KB)`
                  : "") +
                "; statuses, coverage and summary counts are over everything. " +
                `Not whole here: ${shortened.map((p) => `${p.layer.layer} (${p.pager.describe()})`).join("; ")}. ` +
                (nextOffset !== undefined
                  ? `For the next page call codebase_verify again with the same arguments and offset: ${nextOffset}` +
                    (shortened.length < paged.length
                      ? ` (layers: ${JSON.stringify(shortened.filter((p) => p.pager.nextOffset !== undefined).map((p) => p.layer.layer))} is enough)`
                      : "") +
                    "; limit takes any size, for more at once."
                  : "This is the last page: call again with offset: 0 for the start."),
            }
          : {}),
      };
      const status = [
        ...layers.map((l) => ({ layer: l.layer, status: l.status, text: l.status_text, coverage: l.coverage })),
        ...notVerifiedAll.map((n) => ({ layer: n.layer, status: "not_checked" as const, text: `Not checked: ${n.reason}.` })),
      ];
      // The engine's hints name no tool (the CLI prints them too): say which tools apply here.
      const { hints: _engineHints, ...rest } = report;
      const hints = report.buckets.in_graph_only.length > 0 ? [IN_CODE_ONLY_HINT] : [];
      return jsonResult({
        status,
        paging,
        ...rest,
        buckets,
        ...(report.layers ? { layers: paged.map((p) => p.layer) } : {}),
        ...(hints.length > 0 ? { hints } : {}),
        ...(report.layers_verified ? { layers_verified: report.layers_verified.filter((l) => !failed.has(l)) } : {}),
        ...(acceptedGaps ? { acceptedGaps } : {}),
        ...(notVerifiedAll.length > 0 ? { layers_not_verified: notVerifiedAll } : {}),
        scope: VERIFY_SCOPE,
        ...(apiVerified && routesInCode === 0 ? { note: NO_ROUTES_NOTE } : {}),
        ...(index.state === "fresh-with-uncommitted-edits"
          ? { warning: `This report may miss uncommitted edits: ${index.reason}. Call codebase_index with wait: 30 to re-index them.` }
          : {}),
      });
    });
  };
}

/**
 * Accepted gaps (#1026) the code contradicts: a matched operation whose route handler the model
 * holds as an application function, where the operation or the handler accepted a gap toward the
 * other. Undefined when none is.
 */
async function acceptedGapsInRoutes(
  model: Model,
  matched: Array<{ id: string; source_file: string; source_symbol: string }>
): Promise<{ contradicted: ContradictedByHandler[]; note: string } | undefined> {
  if (matched.length === 0) return undefined;
  const elements: LocatedElement[] = [];
  let anyGaps = false;
  for (const layerName of model.getLayerNames()) {
    const layer = await model.getLayer(layerName);
    for (const e of layer?.listElements() ?? []) {
      anyGaps ||= e.acceptedGaps().length > 0;
      elements.push({
        id: e.id,
        path: e.path || undefined,
        layer: layerName,
        type: e.type,
        locations: e.source_reference?.locations ?? [],
        acceptedGaps: e.acceptedGaps(),
      });
    }
  }
  if (!anyGaps) return undefined;
  const contradicted = routeHandlerContradictions(matched, elements);
  if (contradicted.length === 0) return undefined;
  return {
    contradicted,
    note:
      "The code routes these operations to a handler the model holds as an application function, and the operation (or " +
      "the handler) accepted a gap toward the other: the decision is stale (gap_reopen in a changeset) or the code " +
      "drifted. Ask the user which.",
  };
}

export const codebaseVerifyHandler = createCodebaseVerifyHandler();

export const codebaseVerifyTool: McpToolDefinition<typeof inputSchema> = {
  name: "codebase_verify",
  description:
    "Compares the indexed code with the model (the active changeset's view when one is active), per layer: HTTP routes " +
    "against API operations, and the routes an OpenAPI file declares against the operations sourced to it; SQL tables " +
    "against data-store collections; compose services, Kubernetes objects, images and launched programs against technology " +
    "elements (system software sourced to a dependency manifest against what it lists); test cases and their tests " +
    "relationships against the testing layer. layers (default all of api, data-store, technology, testing) picks which. " +
    "Read status first: each layer is in_step (compared, nothing differs), drifted, or not_checked (nothing could be " +
    "compared: never read that as in step), with its coverage (model elements, how many were checked). Each layer under " +
    "layers has buckets: matched, in_graph_only (in the code, not the model), in_model_only (in the model, not found in the " +
    "code: drift, each with its reason) and not_indexed (a parse gap, not drift), a not_checked list by reason with what " +
    "would make each group checkable, and a summary; the top-level buckets are the API layer's. Every list is a page: " +
    `limit entries (default ${VERIFY_PAGE_SIZE}) from offset. Statuses, coverage and counts are always over everything; a layer's ` +
    "lists names each list that is not whole with its total, and paging.more gives the call for the next page. Symbols " +
    "codebase_extract recorded as not elements (reject) are left out. It doesn't check other layers. Needs a fresh index: if there is none, " +
    "a run is in flight, or source files changed since, it says so; run codebase_index first. Read-only.",
  inputSchema,
  handler: codebaseVerifyHandler,
};
