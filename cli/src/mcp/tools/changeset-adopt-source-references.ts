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
import { adoptVerifiedSourceReferences, type VerifiedAdoptionReport } from "../../core/source-reference-adoption.js";
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
        "lists under sourceReferences.unreferenced with candidate files. Each is staged onto the plan as a file path relative to " +
        "the codebase root, with provenance manual; a folder or a path outside the root is skipped with the reason."
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "How many adopted, confirmed and skipped items come back in full (default 50; any size is accepted). counts is always " +
        "over all of them; past the limit each copied reference is still named by its element id and each skipped one is " +
        "listed under its reason."
    ),
  verbose: z.boolean().optional().describe("Return every item in full, with the references still missing (large for a big plan)."),
};

/**
 * Items returned in full per list by default. The call writes, so there is no offset: it can't be
 * paged by calling it again. Past the limit every item is still accounted for: a copied reference
 * by its element id, a skipped one under its reason.
 */
export const ADOPT_LIST_LIMIT = 50;

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
    return jsonResult(adoptionResult(result, { limit: args.limit, verbose: args.verbose, references: args.references?.length ?? 0 }));
  });
}

/** A skipped item's reason with what is particular to it (ids, files, quoted text) taken out, so items with one cause share a group. */
function reasonPattern(reason: string): string {
  return reason
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\([^)]*\)/g, "(…)")
    .replace(/\b[a-z][a-z-]*\.[a-z]+\.[\w.-]*[\w]/g, "<element>")
    .replace(/[\w.@-]+(?:\/[\w.@-]+)+/g, "<file>");
}

/**
 * The tool's result, as the batch writes shape theirs: `total` and `counts` over everything; each
 * list in full up to `limit`; past it, a copied or confirmed reference is still named by its
 * element id, and every skipped one is listed under its reason. No item is dropped, and no count
 * is taken over the part returned. `verbose` returns the adoption report unshortened.
 */
export function adoptionResult(
  report: VerifiedAdoptionReport,
  options: { limit?: number; verbose?: boolean; references?: number } = {}
): Record<string, unknown> {
  const skipped = report.skipped ?? [];
  const confirmed = report.confirmed ?? [];
  const unknownIds = report.unknownIds ?? [];
  const totals = {
    // What verify listed to copy, and the references the caller sent.
    total: report.adopted.length + (report.missing?.length ?? 0) + (options.references ?? 0),
    counts: { adopted: report.adopted.length, confirmed: confirmed.length, skipped: skipped.length, unknownIds: unknownIds.length },
  };
  if (options.verbose) {
    const { plannedChangeset, ...rest } = report;
    return { plannedChangeset, ...totals, ...rest };
  }

  const limit = Math.max(options.limit ?? ADOPT_LIST_LIMIT, 1);
  const where = (locations: Array<{ file: string; symbol?: string }>) => locations.map((l) => (l.symbol ? `${l.file}#${l.symbol}` : l.file));
  const more = (what: string) => `${what}: pass limit: <count> for them in full, or verbose: true for everything.`;
  const adopted = report.adopted.slice(0, limit).map((g) => ({
    planned: g.planned,
    ...(g.built !== g.planned ? { built: g.built } : {}),
    op: g.op,
    match: g.match,
    locations: where(g.missing),
  }));
  const groups = new Map<string, { reason: string; count: number; ids: string[] }>();
  for (const item of skipped.slice(limit)) {
    const reason = reasonPattern(item.reason);
    const group = groups.get(reason) ?? { reason, count: 0, ids: [] };
    group.count++;
    group.ids.push(item.planned);
    groups.set(reason, group);
  }
  return {
    plannedChangeset: report.plannedChangeset,
    ...totals,
    adopted,
    ...(report.adopted.length > limit
      ? {
          adoptedNotListed: {
            count: report.adopted.length - limit,
            ids: report.adopted.slice(limit).map((g) => g.planned),
            more: more("Copied too, named by element id"),
          },
        }
      : {}),
    ...(confirmed.length > 0 ? { confirmed: confirmed.slice(0, limit) } : {}),
    ...(confirmed.length > limit
      ? { confirmedNotListed: { count: confirmed.length - limit, ids: confirmed.slice(limit).map((c) => c.planned), more: more("Set too, named by element id") } }
      : {}),
    ...(skipped.length > 0 ? { skipped: skipped.slice(0, limit) } : {}),
    ...(skipped.length > limit
      ? {
          skippedNotListed: {
            count: skipped.length - limit,
            groups: [...groups.values()].sort((a, b) => b.count - a.count),
            more: more("Skipped too, each under its reason"),
          },
        }
      : {}),
    ...(unknownIds.length > 0 ? { unknownIds, ...(report.unknownIdReasons ? { unknownIdReasons: report.unknownIdReasons } : {}) } : {}),
    next: report.next,
  };
}

export const changesetAdoptSourceReferencesTool: McpToolDefinition<typeof inputSchema> = {
  name: "changeset_adopt_source_references",
  description:
    "Copy onto a planned changeset the source references changeset_verify lists in sourceReferences.missing: " +
    "as-built matches that name a source file and symbol the plan's element lacks. Takes the same changeset (the plan) and " +
    "against as changeset_verify, compares them again, and stages the copies into the plan in one write (an add " +
    "is rewritten in place, an update gets one more update). Do it before the plan lands, so the landed model ties " +
    "those elements to the code. It takes the matches changeset_verify lists in sourceReferences.missing: every exact one, and a probable one only when its planned id is in ids (once you have confirmed it in the code); an id that names none of them comes back in unknownIds with unknownIdReasons saying why. " +
    "Matches against elements extraction didn't stage (builtByAgent) are never " +
    "copied. skipped says why each one wasn't. For a planned element extraction can't see (it has no as-built match: a " +
    "feature, a requirement, a tool the code registers by a name string), pass the reference you confirmed in the code in " +
    "references ({id, sourceFile, sourceSymbol}); changeset_verify lists candidates under sourceReferences.unreferenced. " +
    "The result gives total and counts over everything, then each list in full up to limit (default 50): past it a copied " +
    "reference is still named by its element id and every skipped one is listed under its reason; verbose: true returns " +
    "every item in full.",
  inputSchema,
  handler: changesetAdoptSourceReferencesHandler,
};
