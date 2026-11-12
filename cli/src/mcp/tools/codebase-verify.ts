/**
 * codebase_verify — compare the HTTP routes the code analyzer found in the code with the model's
 * API operations, as structured data. It checks the API layer only. The same report as
 * `dr analyzer verify --json`, from the same engine (analyzers/verify-engine.ts through the
 * analyzer's verify()). Read-only.
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
    .describe(`Layers to verify (default ["api"]). Only ${VERIFIABLE_LAYERS.join(", ")} has a check; others are listed as not verified.`),
  rootPath: rootPathSchema,
};

export type CodebaseVerifyArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/** What every report says about its reach, so its findings aren't read as more than they are. */
export const VERIFY_SCOPE =
  "codebase_verify checks only the API layer: the HTTP routes found in the code against the model's API operations. " +
  "It says nothing about the other layers.";

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

      const { verifiable, unsupported } = splitVerifyLayers(args.layers);
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
      const routesInCode = report.buckets.matched.length + report.buckets.in_graph_only.length;
      const acceptedGaps = await acceptedGapsInRoutes(model, report.buckets.matched);
      return jsonResult({
        ...report,
        ...(acceptedGaps ? { acceptedGaps } : {}),
        ...(notVerified.length > 0 ? { layers_not_verified: notVerified } : {}),
        scope: VERIFY_SCOPE,
        ...(routesInCode === 0 ? { note: NO_ROUTES_NOTE } : {}),
        ...(index.state === "fresh-with-uncommitted-edits"
          ? { warning: `This report may miss uncommitted edits: ${index.reason}. Call codebase_index with wait: 30 to re-index them.` }
          : {}),
      });
    });
  };
}

/**
 * Accepted gaps (#1026) the code contradicts: a matched operation whose route handler the model
 * holds as an element of a type the operation accepted a gap toward. Undefined when none is.
 */
async function acceptedGapsInRoutes(
  model: Model,
  matched: Array<{ id: string; source_file: string; source_symbol: string }>
): Promise<{ contradicted: ContradictedByHandler[]; note: string } | undefined> {
  if (matched.length === 0) return undefined;
  const elements: LocatedElement[] = [];
  for (const layerName of model.getLayerNames()) {
    const layer = await model.getLayer(layerName);
    for (const e of layer?.listElements() ?? []) {
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
  const contradicted = routeHandlerContradictions(matched, elements);
  if (contradicted.length === 0) return undefined;
  return {
    contradicted,
    note:
      "The code routes these operations to a handler the model holds as an element of a type the operation accepted a " +
      "gap toward: the decision is stale (gap_reopen in a changeset) or the code drifted. Ask the user which.",
  };
}

export const codebaseVerifyHandler = createCodebaseVerifyHandler();

export const codebaseVerifyTool: McpToolDefinition<typeof inputSchema> = {
  name: "codebase_verify",
  description:
    "Checks the API layer only: compares the HTTP routes the code analyzer found in the indexed code with the " +
    "model's API operations (the active changeset's view when one is active). Returns buckets: matched, " +
    "in_graph_only (in the code, not the model), in_model_only (in the model, not found in the code) and ignored, " +
    "with a summary and hints. On a library or a project with no HTTP routes, every operation lands in " +
    "in_model_only: that is expected, not drift. It doesn't check other layers. Needs a fresh index: if there is " +
    "none, a run is in flight, or source files changed since, it says so; run codebase_index first. Read-only.",
  inputSchema,
  handler: codebaseVerifyHandler,
};
