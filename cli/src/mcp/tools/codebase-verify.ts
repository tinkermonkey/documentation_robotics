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

const inputSchema = {
  layers: z
    .array(z.string())
    .optional()
    .describe(`Layers to verify (default: all of ${VERIFIABLE_LAYERS.join(", ")}, the layers with a check); others are listed as not verified.`),
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
      const status = [
        ...layers.map((l) => ({ layer: l.layer, status: l.status, text: l.status_text, coverage: l.coverage })),
        ...notVerifiedAll.map((n) => ({ layer: n.layer, status: "not_checked" as const, text: `Not checked: ${n.reason}.` })),
      ];
      // The engine's hints name no tool (the CLI prints them too): say which tools apply here.
      const { hints: _engineHints, ...rest } = report;
      const hints = report.buckets.in_graph_only.length > 0 ? [IN_CODE_ONLY_HINT] : [];
      return jsonResult({
        status,
        ...rest,
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
    "would make each group checkable, and a summary; the top-level buckets are the API layer's. Symbols codebase_extract " +
    "recorded as not elements (reject) are left out. It doesn't check other layers. Needs a fresh index: if there is none, " +
    "a run is in flight, or source files changed since, it says so; run codebase_index first. Read-only.",
  inputSchema,
  handler: codebaseVerifyHandler,
};
