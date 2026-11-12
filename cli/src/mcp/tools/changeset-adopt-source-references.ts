/**
 * changeset_adopt_source_references — copy the source references changeset_verify lists in
 * `sourceReferences.missing` onto the plan, staged into it in one write. A separate tool from
 * changeset_verify so that verify stays read-only (DrBot allows it in read-safe mode); this one
 * writes the plan, like the other changeset staging tools.
 * See `cli/src/core/source-reference-adoption.ts` and docs/CHANGE_MODELING.md.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { adoptSourceReferences } from "../../core/source-reference-adoption.js";
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
    const { model, manager, planned, report } = await runVerify(args);
    const gaps = report.sourceReferences?.missing ?? [];
    const { adopted, skipped, unknownIds } = await adoptSourceReferences(model, manager, planned, gaps, {
      confirmed: args.ids,
    });
    if (adopted.length > 0) await reloadModel(args.rootPath);
    const adoptedIds = new Set(adopted.map((g) => g.planned));
    const left = gaps.filter((g) => !adoptedIds.has(g.planned));
    return jsonResult({
      plannedChangeset: { id: planned.id, name: planned.name },
      adopted,
      ...(skipped.length > 0 ? { skipped } : {}),
      ...(left.length > 0 ? { missing: left } : {}),
      // ids that name no element sourceReferences.missing lists: nothing to confirm for them.
      ...(unknownIds && unknownIds.length > 0 ? { unknownIds } : {}),
      next:
        adopted.length > 0
          ? `Copied the source references of ${adopted.length} element(s) onto the plan "${planned.name}"` +
            (left.length > 0 ? `; ${left.length} were not copied (skipped says why)` : "") +
            ". The plan lands with them."
          : gaps.length === 0
            ? "No matched plan element lacks its as-built match's source reference: nothing to copy."
            : "Nothing was copied (skipped says why).",
    });
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
