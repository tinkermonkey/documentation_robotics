/**
 * codebase_verify — compare what the code analyzer found in the code with the model, layer by
 * layer, as structured data: HTTP routes against API operations (analyzers/verify-engine.ts), and
 * SQL tables, infrastructure and test cases against the data-store, technology and testing layers
 * (analyzers/layer-verify.ts). A model element sourced to a file the analyzer didn't index is
 * reported as not indexed, not as drift. The same report as `dr analyzer verify --json`, through
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
  `codebase_verify checks the ${VERIFIABLE_LAYERS.join(", ")} layers against the code: HTTP routes against API operations, ` +
  "SQL tables against data-store collections, compose services, Kubernetes objects, images and launched programs against " +
  "technology elements (a Kubernetes Secret as a configuration artifact), and test cases and their tests relationships " +
  "against the testing layer. Each layer is reported under layers in the same buckets, plus not_indexed: an element sourced " +
  "to a file the analyzer didn't index or parsed only in part, which is a parse gap, not drift. It says nothing about the " +
  "other layers, or about elements of other types in these.";

/** Said when the code has no routes: a library's operations are not drift. */
export const NO_ROUTES_NOTE =
  "The analyzer found no HTTP routes in the code (a library, a CLI, or routes it can't read), so every API operation " +
  "in the model lands in in_model_only. That is expected here and is not drift; don't change the model because of it.";

export function createCodebaseVerifyHandler(deps: CodebaseToolDeps = defaultCodebaseToolDeps) {
  return async function codebaseVerifyHandler(args: CodebaseVerifyArgs): Promise<CallToolResult> {
    return runTool(async () => {
      const model = await loadModel(args.rootPath);
      // The same spelling codebase_index's run indexed under (see canonicalRoots).
      const { projectRoot, codebaseRoot } = await canonicalRoots(model);

      const { verifiable, unsupported } = splitVerifyLayers(args.layers && args.layers.length > 0 ? args.layers : VERIFIABLE_LAYERS);
      const notVerified = unsupported.map((layer) => ({ layer, reason: "No verification available for this layer" }));
      if (verifiable.length === 0) {
        return jsonResult({ layers_verified: [], layers_not_verified: notVerified, scope: VERIFY_SCOPE });
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
      const routesInCode = report.buckets.matched.length + report.buckets.in_graph_only.length;
      const acceptedGaps = await acceptedGapsInRoutes(model, report.buckets.matched);
      const apiVerified = verifiable.includes("api");
      return jsonResult({
        ...report,
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
    "against API operations; SQL tables against data-store collections; compose services, Kubernetes objects, images and " +
    "launched programs against technology elements (a Kubernetes Secret as a configuration artifact); test cases and " +
    "their tests relationships against the testing layer. layers (default all of api, data-store, technology, testing) " +
    "picks which. Each layer under layers has buckets: matched, in_graph_only (in the code, not the model), " +
    "in_model_only (in the model, not found in the code: drift) and not_indexed (sourced to a file the analyzer didn't " +
    "index or parsed only in part: a parse gap, not drift), with a summary; the top-level buckets are the API layer's. " +
    "On a library or a project with no HTTP routes, every operation lands in in_model_only: that is expected, not drift. " +
    "It doesn't check other layers. Needs a fresh index: if there is none, a run is in flight, or source files changed " +
    "since, it says so; run codebase_index first. Read-only.",
  inputSchema,
  handler: codebaseVerifyHandler,
};
