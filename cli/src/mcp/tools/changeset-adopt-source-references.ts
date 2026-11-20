/**
 * changeset_adopt_source_references — copy the source references changeset_verify lists in
 * `sourceReferences.missing` onto the plan, staged into it in one write. A separate tool from
 * changeset_verify so that verify stays read-only (DrBot allows it in read-safe mode); this one
 * writes the plan, like the other changeset staging tools. `references` sets the references the
 * agent confirmed in the code for planned elements extraction can't see (no as-built match exists
 * to copy from).
 * See `cli/src/core/source-reference-adoption.ts` and docs/CHANGE_MODELING.md.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { adoptVerifiedSourceReferences } from "../../core/source-reference-adoption.js";
import { jsonResult, reloadModel, runTool, type McpToolDefinition } from "./shared.js";
import { runVerify, verifyComparisonInputs } from "./changeset-verify.js";
import { strictItem } from "../strict-schema.js";

const inputSchema = {
  ...verifyComparisonInputs,
  ids: z
    .array(z.string())
    .optional()
    .describe(
      "Planned element ids (as sourceReferences.missing lists them) whose probable match you confirmed in the code. " +
        "Only exact matches are copied otherwise."
    ),
  references: z
    .array(
      strictItem("A references[] item", {
        id: z.string().describe("The planned element's id."),
        sourceFile: z.string().describe("The file that holds its code, relative to the codebase root."),
        sourceSymbol: z.string().optional().describe("The symbol in that file, or the string the code registers it by."),
      })
    )
    .optional()
    .describe(
      "Source references you confirmed in the code for planned elements with no as-built match to copy from: the ones " +
        "extraction can't see (a feature, a requirement, a tool the code registers by a name string), which changeset_verify " +
        "lists under sourceReferences.unreferenced with candidate files. Each is staged onto the plan with provenance manual."
    ),
};

export type ChangesetAdoptSourceReferencesArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function changesetAdoptSourceReferencesHandler(
  args: ChangesetAdoptSourceReferencesArgs
): Promise<CallToolResult> {
  return runTool(async () => {
    const { model, manager, planned, plannedName, asBuilt, report } = await runVerify(args);
    const result = await adoptVerifiedSourceReferences(model, manager, {
      planned,
      asBuilt,
      report,
      confirmed: args.ids,
      references: args.references,
      sameChangesetHint: plannedName
        ? 'Pass the plan as "changeset" and the as-built changeset as "against.changeset"'
        : 'Pass the plan as "changeset": the active changeset is the as-built one codebase_extract left active',
    });
    if (result.adopted.length > 0 || (result.confirmed?.length ?? 0) > 0) await reloadModel(args.rootPath);
    return jsonResult(result);
  });
}

export const changesetAdoptSourceReferencesTool: McpToolDefinition<typeof inputSchema> = {
  name: "changeset_adopt_source_references",
  description:
    "Copy onto a planned changeset the source references changeset_verify lists in sourceReferences.missing: " +
    "as-built matches that name a source file and symbol the plan's element lacks. Takes the same changeset (the plan) and " +
    "against as changeset_verify, compares them again, and stages the copies into the plan in one write (an add " +
    "is rewritten in place, an update gets one more update). Do it before the plan lands, so the landed model ties " +
    "those elements to the code. Only exact matches are copied; pass a probable match's planned id in ids once " +
    "you have confirmed it in the code. Matches against elements extraction didn't stage (builtByAgent) are never " +
    "copied. skipped says why each one wasn't. For a planned element extraction can't see (it has no as-built match: a " +
    "feature, a requirement, a tool the code registers by a name string), pass the reference you confirmed in the code in " +
    "references ({id, sourceFile, sourceSymbol}); changeset_verify lists candidates under sourceReferences.unreferenced.",
  inputSchema,
  handler: changesetAdoptSourceReferencesHandler,
};
