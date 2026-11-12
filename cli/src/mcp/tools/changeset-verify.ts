/**
 * changeset_verify — compare a planned changeset with what was built.
 * See `cli/src/core/changeset-verify.ts` and docs/CHANGE_MODELING.md.
 */

import { z } from "zod";
import { strictItem } from "../strict-schema.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { verifyChangesetInModel } from "../../core/changeset-verify.js";
import { adoptSourceReferences } from "../../core/source-reference-adoption.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { resolveChangeset } from "./changeset-shared.js";

const inputSchema = {
  planned: z
    .string()
    .optional()
    .describe("The planned changeset, by ID or name. Defaults to the active changeset."),
  against: strictItem("against", {
    changesetId: z
      .string()
      .optional()
      .describe(
        "The as-built changeset (by ID or name). It should come from codebase_extract with since, not be written " +
          "by the agent: a copy of the plan matches by definition."
      ),
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
  }).describe('What was built: {"changesetId": "..."} or {"base": true} (with "extracted": true after an extraction landed).'),
  matchBySource: z
    .boolean()
    .optional()
    .describe("Also match elements of the same layer and type that share a source file (default true)."),
  adoptSourceReferences: z
    .boolean()
    .optional()
    .describe(
      "Copy the source references the report lists in sourceReferences.missing (as-built matches that name a " +
        "source file and symbol the plan's element lacks) onto the plan, staged into it in one write. Do it before " +
        "the plan lands, so the landed model ties those elements to the code. Matches against elements extraction " +
        "didn't stage (builtByAgent) are not copied. Default false: the report only lists them."
    ),
  rootPath: rootPathSchema,
};

export type ChangesetVerifyArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function changesetVerifyHandler(args: ChangesetVerifyArgs): Promise<CallToolResult> {
  return runTool(async () => {
    if (args.against?.changesetId && args.against.base) {
      throw new CLIError('Pass either "against.changesetId" or "against.base", not both', ErrorCategory.USER);
    }
    if (args.against?.extracted && !args.against.base) {
      throw new CLIError('"against.extracted" goes with "against.base"', ErrorCategory.USER, [
        "An as-built changeset from codebase_extract is recognised on its own",
      ]);
    }
    if (!args.against?.changesetId && !args.against?.base) {
      throw new CLIError("Nothing to verify against", ErrorCategory.USER, [
        'Pass "against": {"changesetId": "<as-built changeset>"} to compare with another changeset',
        'Pass "against": {"base": true} to compare with the base model',
      ]);
    }
    // Always read the model fresh: the build is often committed outside MCP (`dr changeset commit` is
    // not exposed here), and a cached model would compare against the base as it was when the server
    // started. Verify is read-only and infrequent, so the reload is cheap insurance.
    const model = await reloadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const planned = await resolveChangeset(manager, args.planned, "planned");
    const asBuilt = args.against?.changesetId ? await resolveChangeset(manager, args.against.changesetId) : undefined;
    const report = await verifyChangesetInModel(model, {
      planned,
      against: asBuilt ? { changeset: asBuilt } : { base: true, extracted: args.against.extracted === true },
      matchBySource: args.matchBySource,
    });
    if (args.adoptSourceReferences === true) {
      const gaps = report.sourceReferences?.missing ?? [];
      const { adopted, skipped } = await adoptSourceReferences(model, manager, planned, gaps);
      if (adopted.length > 0) await reloadModel(args.rootPath);
      const adoptedIds = new Set(adopted.map((g) => g.planned));
      const left = gaps.filter((g) => !adoptedIds.has(g.planned));
      report.sourceReferences = {
        missing: left,
        ...(adopted.length > 0 ? { adopted } : {}),
        ...(skipped.length > 0 ? { skipped } : {}),
        next:
          adopted.length > 0
            ? `Copied the source references of ${adopted.length} element(s) onto the plan "${planned.name}"` +
              (left.length > 0 ? `; ${left.length} were not copied (skipped says why)` : "") +
              ". The report above is from before the copy; the plan lands with them."
            : gaps.length === 0
              ? "No matched plan element lacks its as-built match's source reference: nothing to copy."
              : "Nothing was copied (skipped says why).",
      };
    }
    return jsonResult(report);
  });
}

export const changesetVerifyTool: McpToolDefinition<typeof inputSchema> = {
  name: "changeset_verify",
  description:
    "Compare a planned changeset with what was built: the as-built changeset codebase_extract wrote (with since, " +
    "the branch's base), or the base model. Elements match by id, then by layer + type + name ignoring case and " +
    "separators, then by source file; relationships match through those element matches. Reports matched, " +
    "missing (planned, not built), unverifiable (planned, but extraction can't see it: intent, re-exports, tests " +
    "in languages without test cards, relationships no code edge maps to; not part of the verdict), unplanned " +
    "(built, not planned), divergent (matched but type, name or attributes differ, with both values), and planned " +
    "deletions that still exist, with a verdict. Description differences are notes on a match, not divergence: " +
    "don't edit the plan to match extracted text. extraction.asBuilt counts the as-built elements extraction " +
    "really staged, from its own record (not the sourceProvenance they declare); the rest are agentAdded, with " +
    "why, and a warning says when they are more than half. Fuzzy matches are marked probable with their reason; " +
    "confirm them. sourceReferences lists matched plan elements whose as-built match has a source file and symbol " +
    "the plan lacks; pass adoptSourceReferences: true to copy them onto the plan before it lands. Reads the model " +
    "fresh from disk, so a commit made outside MCP is seen. Read-only unless adoptSourceReferences is true.",
  inputSchema,
  handler: changesetVerifyHandler,
};
