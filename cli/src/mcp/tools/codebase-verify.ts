/**
 * codebase_verify — compare the routes the code analyzer found in the code with the model's API
 * operations, as structured data. The same report as `dr analyzer verify --json`, from the same
 * engine (analyzers/verify-engine.ts through the analyzer's verify()). Read-only.
 *
 * It needs a fresh index: when there is none, a run is in flight, or the code has moved on since
 * the last one, it says so and points at codebase_index.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { splitVerifyLayers, VERIFIABLE_LAYERS } from "../../analyzers/active-analyzer.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
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

export function createCodebaseVerifyHandler(deps: CodebaseToolDeps = defaultCodebaseToolDeps) {
  return async function codebaseVerifyHandler(args: CodebaseVerifyArgs): Promise<CallToolResult> {
    return runTool(async () => {
      const model = await loadModel(args.rootPath);
      // The same spelling codebase_index's run indexed under (see canonicalRoots).
      const { projectRoot, codebaseRoot } = await canonicalRoots(model);

      const { verifiable, unsupported } = splitVerifyLayers(args.layers);
      const notVerified = unsupported.map((layer) => ({ layer, reason: "No verification available for this layer" }));
      if (verifiable.length === 0) {
        return jsonResult({ layers_verified: [], layers_not_verified: notVerified });
      }

      const { analyzer } = await requireFreshIndex(projectRoot, codebaseRoot, deps, "codebase_verify");

      const backend = await deps.getAnalyzer(analyzer);
      if (!backend) throw analyzerNotFoundError(analyzer);

      const report = await backend.verify(projectRoot, {
        layers: verifiable,
        changesetAware: true,
        codebaseRoot,
      });
      return jsonResult(notVerified.length > 0 ? { ...report, layers_not_verified: notVerified } : report);
    });
  };
}

export const codebaseVerifyHandler = createCodebaseVerifyHandler();

export const codebaseVerifyTool: McpToolDefinition<typeof inputSchema> = {
  name: "codebase_verify",
  description:
    "Compare the routes the code analyzer found in the indexed code with the model's API operations (the active " +
    "changeset's view when one is active). Returns buckets: matched, in_graph_only (in the code, not the model), " +
    "in_model_only (in the model, not found in the code) and ignored, with a summary and hints. Needs a fresh " +
    "index: if there is none, a run is in flight, or the code changed since, it says so; run codebase_index " +
    "first. Read-only.",
  inputSchema,
  handler: codebaseVerifyHandler,
};
