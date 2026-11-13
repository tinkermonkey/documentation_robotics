/**
 * changeset_adopt_source_references — copy the source references changeset_verify lists in
 * `sourceReferences.missing` onto the plan, staged into it in one write. A separate tool from
 * changeset_verify so that verify stays read-only (DrBot allows it in read-safe mode); this one
 * writes the plan, like the other changeset staging tools.
 * See `cli/src/core/source-reference-adoption.ts` and docs/CHANGE_MODELING.md.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { adoptVerifiedSourceReferences } from "../../core/source-reference-adoption.js";
import { jsonResult, reloadModel, runTool, type McpToolDefinition } from "./shared.js";
import { runVerify, verifyComparisonInputs } from "./changeset-verify.js";

const inputSchema = {
  ...verifyComparisonInputs,
  ids: z
    .array(z.string())
    .optional()
    .describe(
      "Planned element ids (as sourceReferences.missing lists them) whose probable match you confirmed in the code. " +
        "Only exact matches are copied otherwise."
    ),
};

export type ChangesetAdoptSourceReferencesArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function changesetAdoptSourceReferencesHandler(
  args: ChangesetAdoptSourceReferencesArgs
): Promise<CallToolResult> {
  return runTool(async () => {
    const { model, manager, planned, asBuilt, report } = await runVerify(args);
    const result = await adoptVerifiedSourceReferences(model, manager, {
      planned,
      asBuilt,
      report,
      confirmed: args.ids,
      sameChangesetHint: args.planned
        ? 'Pass the plan as "planned" and the as-built changeset as "against.changesetId"'
        : 'Pass "planned": the active changeset is the as-built one codebase_extract left active',
    });
    if (result.adopted.length > 0) await reloadModel(args.rootPath);
    return jsonResult(result);
  });
}

export const changesetAdoptSourceReferencesTool: McpToolDefinition<typeof inputSchema> = {
  name: "changeset_adopt_source_references",
  description:
    "Copy onto a planned changeset the source references changeset_verify lists in sourceReferences.missing: " +
    "as-built matches that name a source file and symbol the plan's element lacks. Takes the same planned and " +
    "against as changeset_verify, compares them again, and stages the copies into the plan in one write (an add " +
    "is rewritten in place, an update gets one more update). Do it before the plan lands, so the landed model ties " +
    "those elements to the code. Only exact matches are copied; pass a probable match's planned id in ids once " +
    "you have confirmed it in the code. Matches against elements extraction didn't stage (builtByAgent) are never " +
    "copied. skipped says why each one wasn't.",
  inputSchema,
  handler: changesetAdoptSourceReferencesHandler,
};
