/**
 * changeset_impact, changeset_brief — pressure-test a planned change against the model.
 * See `cli/src/core/changeset-analysis.ts` and docs/CHANGE_MODELING.md.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AnnotationStore } from "../../core/annotation-store.js";
import { buildBrief, computeImpact } from "../../core/changeset-analysis.js";
import { getErrorMessage } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { loadChangesetGraph } from "./changeset-shared.js";

const changesetIdSchema = z.string().optional().describe("Changeset ID or name. Defaults to the active changeset.");

// ---------------------------------------------------------------------------
// changeset_impact
// ---------------------------------------------------------------------------

const impactInputSchema = {
  changesetId: changesetIdSchema,
  depth: z.number().int().min(1).max(6).optional().describe("Hops to walk out from the changed elements (default 2)."),
  maxElements: z.number().int().positive().optional().describe("Stop after this many reached elements (default 200)."),
  rootPath: rootPathSchema,
};

export type ChangesetImpactArgs = z.infer<z.ZodObject<typeof impactInputSchema>>;

export async function changesetImpactHandler(args: ChangesetImpactArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const { changeset, graph } = await loadChangesetGraph(model, args.changesetId);
    const report = computeImpact(graph, { depth: args.depth, maxElements: args.maxElements });
    return jsonResult({ changeset: { id: changeset.id, name: changeset.name }, ...report });
  });
}

export const changesetImpactTool: McpToolDefinition<typeof impactInputSchema> = {
  name: "changeset_impact",
  description:
    "Walk the model outward from everything a changeset adds, changes or removes (relationships included) and list " +
    "the existing elements it reaches, by layer, with how each was reached and its source files. These are what " +
    "the change can break or must update.",
  inputSchema: impactInputSchema,
  handler: changesetImpactHandler,
};

// ---------------------------------------------------------------------------
// changeset_brief
// ---------------------------------------------------------------------------

const briefInputSchema = {
  changesetId: changesetIdSchema,
  rootPath: rootPathSchema,
};

export type ChangesetBriefArgs = z.infer<z.ZodObject<typeof briefInputSchema>>;

export async function changesetBriefHandler(args: ChangesetBriefArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const { manager, changeset, graph } = await loadChangesetGraph(model, args.changesetId);

    const annotations = await new AnnotationStore(model.rootPath).list();

    let drift: { isDrifted: boolean; warnings: string[] } | undefined;
    if (changeset.status === "staged") {
      try {
        const report = await manager.detectDrift(changeset.id);
        drift = { isDrifted: report.isDrifted, warnings: report.warnings };
      } catch (error) {
        drift = { isDrifted: false, warnings: [`Drift check failed: ${getErrorMessage(error)}`] };
      }
    }

    return jsonResult(buildBrief({ graph, annotations, drift }));
  });
}

export const changesetBriefTool: McpToolDefinition<typeof briefInputSchema> = {
  name: "changeset_brief",
  description:
    "Render a changeset as the spec for its change: every added, updated and deleted element by layer with its " +
    "connections; which layers the change reaches and which it does not; gaps (unconnected additions, missing " +
    "required relationships, connections the spec expects and the element lacks, connections its peers have); changes that trace to no goal, requirement or feature; the source files touched; " +
    "open review annotations; and whether the model drifted since the changeset was created. Use it to " +
    "pressure-test a plan and as the input to building it.",
  inputSchema: briefInputSchema,
  handler: changesetBriefHandler,
};
