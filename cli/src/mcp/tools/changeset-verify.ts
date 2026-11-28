/**
 * changeset_verify — compare a planned changeset with what was built. Read-only: copying the source
 * references it lists onto the plan is changeset_adopt_source_references. Returns the compact report
 * by default (`compactVerifyReport`); `detail: "full"` returns the whole report.
 * See `cli/src/core/changeset-verify.ts` and docs/CHANGE_MODELING.md.
 */

import { z } from "zod";
import { strictItem } from "../strict-schema.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Changeset } from "../../core/changeset.js";
import {
  compactVerifyReport,
  verifyChangesetInModel,
  VERIFY_LIST_LIMIT,
  VERIFY_SECTION_PAGE_SIZE,
  VERIFY_SECTIONS,
} from "../../core/changeset-verify.js";
import type { Model } from "../../core/model.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { compactJson, jsonResult, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { CHANGESET_ALIAS_DESCRIPTION, changesetArg, milestoneArgs, milestoneField, resolveChangeset } from "./changeset-shared.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import { milestoneScope, scopeViewOfGraph } from "../../core/milestone-scope.js";

/** The size a compact or sections answer aims at without a limit (#1350): about one tool result. */
export const VERIFY_RESULT_TARGET = 40_000;

/**
 * The as-built changeset `against` names: `against.changeset`, or its older name
 * `against.changesetId` (#1158). The refusal for both with different values says it is in `against`.
 */
function againstChangeset(against: { changeset?: string; changesetId?: string }): string | undefined {
  try {
    return changesetArg(against);
  } catch (error) {
    if (!(error instanceof CLIError)) throw error;
    throw new CLIError(`In "against": ${error.message}`, ErrorCategory.USER, [
      'Pass only "against.changeset"; "against.changesetId" is its older name',
    ]);
  }
}

/** The plan and what it was built as: the inputs changeset_verify and changeset_adopt_source_references share. */
export const verifyComparisonInputs = {
  changeset: z
    .string()
    .optional()
    .describe("The planned changeset, by ID or name. Defaults to the active changeset."),
  planned: z.string().optional().describe(CHANGESET_ALIAS_DESCRIPTION),
  against: strictItem("against", {
    changeset: z
      .string()
      .optional()
      .describe(
        "The as-built changeset (by ID or name). It should come from codebase_extract with since, not be written " +
          "by the agent: a copy of the plan matches by definition."
      ),
    changesetId: z.string().optional().describe(CHANGESET_ALIAS_DESCRIPTION),
    base: z
      .boolean()
      .optional()
      .describe("Compare with the base model, e.g. after the as-built changeset was committed on the branch."),
    extracted: z
      .boolean()
      .optional()
      .describe(
        "With base: the base holds a landed extraction of the build, so what extraction can't see is " +
          "unverifiable rather than missing, as against an extracted as-built changeset."
      ),
  }).describe('What was built: {"changeset": "..."} or {"base": true} (with "extracted": true after an extraction landed).'),
  matchBySource: z
    .boolean()
    .optional()
    .describe("Also match elements of the same layer and type that share a source file (default true)."),
  rootPath: rootPathSchema,
};

export type VerifyComparisonArgs = z.infer<z.ZodObject<typeof verifyComparisonInputs>>;

const inputSchema = {
  ...verifyComparisonInputs,
  detail: z
    .enum(["compact", "full"])
    .optional()
    .describe(
      "compact (default): the verdict and counts; missing, divergent and probable matches one line each; source " +
        "references; the warning; unverifiable items one line per reason; unplanned changes counted per type. full: " +
        "the whole report (every match with its notes and unverifiable fields, every unplanned item)."
    ),
  sections: z
    .array(z.enum(VERIFY_SECTIONS))
    .optional()
    .describe(
      "Return only these sections, each in full (elements and relationships), under the verdict and counts. " +
        '["unplanned"] lists the unplanned items the compact report counts; ["matched"] every match with its notes; ' +
        '["probable"] the probable matches with their reasons; ["sourceReferences"] each gap with the reference to adopt.'
    ),
  layers: z
    .array(z.string())
    .optional()
    .describe(
      "Only the items touching elements in these layers (canonical layer names): a match by its " +
        "planned or built element, a relationship by either end. Combines with ids (either keeps an item). The verdict and " +
        "counts are computed over those items, with the whole plan's in wholePlan (subset says what the numbers cover)."
    ),
  ids: z
    .array(z.string())
    .optional()
    .describe(
      "Only the items touching these element ids. The verdict and counts are computed over them (a slice of a big plan reads as " +
        "complete when its own elements are), with the whole plan's in wholePlan."
    ),
  milestone: milestoneField,
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `The most entries to return from each list: lines of the compact report (default ${VERIFY_LIST_LIMIT}) or items of a section ` +
        `(default ${VERIFY_SECTION_PAGE_SIZE}), fewer when the default would make the answer larger than about ${VERIFY_RESULT_TARGET / 1000} KB (page.limit says what was used); ` +
        "any size is accepted and taken as given. A page size, not a cut-off: the verdict and summary counts are " +
        "over everything, and page.totals gives every list's true length."
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Skip this many entries of each list: repeat the call with the same arguments and the result's page.nextOffset for the next page."),
};

export type ChangesetVerifyArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/**
 * Compares the plan with what was built, reading the model fresh from disk. Shared by
 * changeset_verify and changeset_adopt_source_references, so both see the same matches.
 */
export async function runVerify(args: VerifyComparisonArgs): Promise<{
  model: Model;
  manager: StagingAreaManager;
  planned: Changeset;
  /** The plan as the call named it (`changeset`, or its older name `planned`); undefined for the active one. */
  plannedName?: string;
  /** The as-built changeset compared against, when `against.changeset` named one. */
  asBuilt?: Changeset;
  report: Awaited<ReturnType<typeof verifyChangesetInModel>>;
}> {
  const plannedName = changesetArg(args, { alias: "planned" });
  const asBuiltName = args.against ? againstChangeset(args.against) : undefined;
  if (asBuiltName && args.against.base) {
    throw new CLIError('Pass either "against.changeset" or "against.base", not both', ErrorCategory.USER);
  }
  if (args.against?.extracted && !args.against.base) {
    throw new CLIError('"against.extracted" goes with "against.base"', ErrorCategory.USER, [
      "An as-built changeset from codebase_extract is recognised on its own",
    ]);
  }
  if (!asBuiltName && !args.against?.base) {
    throw new CLIError("Nothing to verify against", ErrorCategory.USER, [
      'Pass "against": {"changeset": "<as-built changeset>"} to compare with another changeset',
      'Pass "against": {"base": true} to compare with the base model',
    ]);
  }
  // Always read the model fresh: the build is often committed outside MCP (`dr changeset commit` is
  // not exposed here), and a cached model would compare against the base as it was when the server
  // started. Verify is infrequent, so the reload is cheap insurance.
  const model = await reloadModel(args.rootPath);
  const manager = new StagingAreaManager(model.rootPath, model);
  const planned = await resolveChangeset(manager, plannedName, "changeset");
  const asBuilt = asBuiltName ? await resolveChangeset(manager, asBuiltName) : undefined;
  const report = await verifyChangesetInModel(model, {
    planned,
    against: asBuilt ? { changeset: asBuilt } : { base: true, extracted: args.against.extracted === true },
    matchBySource: args.matchBySource,
  });
  return { model, manager, planned, ...(plannedName ? { plannedName } : {}), ...(asBuilt ? { asBuilt } : {}), report };
}

/**
 * changeset_verify's answer: the compact report or the sections asked for, each list a page. Without
 * a limit the page holds the default number of entries per list, or fewer when that would make the
 * answer larger than {@link VERIFY_RESULT_TARGET} bytes: the most that fit (at least one), with
 * `sized` saying so. page.nextOffset follows the size used, so the pages stay contiguous whatever
 * size each call picks. An explicit limit, and detail: "full", are taken as given.
 */
export function fitVerifyReport(
  report: Parameters<typeof compactVerifyReport>[0],
  options: Parameters<typeof compactVerifyReport>[1] & {}
): ReturnType<typeof compactVerifyReport> | (ReturnType<typeof compactVerifyReport> & { sized: string }) {
  const at = (limit?: number) => compactVerifyReport(report, { ...options, ...(limit !== undefined ? { limit } : {}) });
  const first = at(options.limit);
  if (options.detail === "full" || options.limit !== undefined) return first;
  const size = (r: unknown) => Buffer.byteLength(compactJson(r), "utf-8");
  if (size(first) <= VERIFY_RESULT_TARGET) return first;
  const defaultLimit = options.sections?.length ? VERIFY_SECTION_PAGE_SIZE : VERIFY_LIST_LIMIT;
  let low = 1;
  let high = defaultLimit - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (size(at(mid)) <= VERIFY_RESULT_TARGET) low = mid;
    else high = mid - 1;
  }
  const result = at(low);
  const over = size(result) > VERIFY_RESULT_TARGET;
  return {
    ...result,
    sized:
      `Lists are pages of ${low} entries here, not the default ${defaultLimit}, to keep this answer near ${VERIFY_RESULT_TARGET / 1000} KB` +
      (over ? " (even so it is larger: its fixed parts alone are)" : "") +
      ". The verdict and counts are over everything; page.totals gives each list's length and more names the call for the next page. limit takes any size.",
  };
}

/**
 * The milestone filter a call gives, read from the plan as it leaves the model (the elements
 * scheduled for the milestone and what in the plan reaches them), or undefined without one.
 */
export async function milestoneFilter(
  model: Model,
  planned: Changeset,
  milestone: string | string[] | undefined
): Promise<{ milestones: string[]; elements: string[] } | undefined> {
  const names = milestoneArgs(milestone);
  if (names.length === 0) return undefined;
  const scope = milestoneScope(scopeViewOfGraph(await ChangesetGraph.build(model, planned)), names);
  return { milestones: scope.milestones.map((m) => m.id), elements: scope.elements };
}

export async function changesetVerifyHandler(args: ChangesetVerifyArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const { report, model, planned } = await runVerify(args);
    const milestone = await milestoneFilter(model, planned, args.milestone);
    const result = fitVerifyReport(report, {
      detail: args.detail,
      sections: args.sections,
      layers: args.layers,
      ids: args.ids,
      milestone,
      limit: args.limit,
      offset: args.offset,
    });
    // The same JSON, short objects kept on one line: the full report is the largest result.
    return jsonResult(result, { compact: true });
  });
}

export const changesetVerifyTool: McpToolDefinition<typeof inputSchema> = {
  name: "changeset_verify",
  description:
    "Compare a planned changeset (changeset) with what was built (against): the as-built changeset codebase_extract " +
    "wrote (with since, the branch's base), or the base model. Elements match by id, then by layer + type + name " +
    "ignoring case and separators, then by source file; relationships match through those element matches. The " +
    "verdict counts matched, missing (planned, not built), unverifiable (planned, but extraction can't see it: intent, " +
    "re-exports, planned JavaScript and TypeScript test cases, a service or operation the code may register by a name " +
    "string such as an MCP tool (text evidence: the verdict names it and is at best probable-match until you confirm " +
    "it), relationships no code edge maps to; not part of the verdict; each with its reason), unplanned (built, not planned), divergent (matched but type, name or attributes differ, with both " +
    "values), and planned deletions that still exist. Description differences are notes on a match, not divergence: " +
    "don't edit the plan to match extracted text. By default the result is compact: the verdict and counts; missing, " +
    "divergent and probable matches one line each (confirm probable ones in the code); unverifiable items one line " +
    "per reason; unplanned changes counted per type; the warning (set when most of the as-built side was not staged " +
    "by extraction, from its own record); extraction's as-built share in counts; and sourceReferences. " +
    "sourceReferences.missing lists matched plan elements whose as-built match has a source file and symbol the plan " +
    "lacks: changeset_adopt_source_references copies them onto the plan before it lands. sourceReferences.unreferenced " +
    "lists planned adds with no source reference and no as-built match, with the build's files that may hold their code " +
    "as candidates: confirm those the build has code for and pass them to changeset_adopt_source_references in " +
    "references. For more, pass sections: [...] for only some sections in full (unplanned " +
    "lists the unplanned items; matched every match with its notes), narrowed with layers or ids; or detail: \"full\" " +
    "for the whole report (large for a big build). Every list is a page (limit, offset): page.totals gives every list's " +
    `true length, page.nextOffset the next offset (absent on the last page), and more the call for it; without limit a page is smaller than the default when that keeps the answer near ${VERIFY_RESULT_TARGET / 1000} KB (sized says so). ` +
    "A plan applied before its build (committed, or its adds already in the base unchanged) is said first in verdictText: those " +
    "elements are not matched with themselves (alreadyInBase) but looked for among the as-built changeset's new elements and source " +
    "references, and are unverifiable when none names them. A plan that changes only descriptions is never a match: the verdict " +
    "says \"Not checked\" and descriptionOnly lists what could be checked (source files changed in the range, symbols still in their files). " +
    "With ids, layers or milestone (the elements scheduled for it and what the plan has that realizes, serves or composes them), the verdict and counts cover that subset, labelled, and wholePlan holds the whole plan's. " +
    "Reads the model fresh from disk, so a commit made outside MCP is seen. Read-only.",
  inputSchema,
  handler: changesetVerifyHandler,
};
