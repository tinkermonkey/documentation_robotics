/**
 * changeset_verify — compare a planned changeset with what was built. Read-only: copying the source
 * references it lists onto the plan is changeset_adopt_source_references.
 * See `cli/src/core/changeset-verify.ts` and docs/CHANGE_MODELING.md.
 */

import { z } from "zod";
import { strictItem } from "../strict-schema.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Changeset } from "../../core/changeset.js";
import { verifyChangesetInModel } from "../../core/changeset-verify.js";
import type { Model } from "../../core/model.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { resolveChangeset } from "./changeset-shared.js";

/** The plan and what it was built as: the inputs changeset_verify and changeset_adopt_source_references share. */
export const verifyComparisonInputs = {
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
  rootPath: rootPathSchema,
};

const inputSchema = verifyComparisonInputs;

export type ChangesetVerifyArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/**
 * Compares the plan with what was built, reading the model fresh from disk. Shared by
 * changeset_verify and changeset_adopt_source_references, so both see the same matches.
 */
export async function runVerify(args: ChangesetVerifyArgs): Promise<{
  model: Model;
  manager: StagingAreaManager;
  planned: Changeset;
  /** The as-built changeset compared against, when `against.changesetId` named one. */
  asBuilt?: Changeset;
  report: Awaited<ReturnType<typeof verifyChangesetInModel>>;
}> {
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
  // started. Verify is infrequent, so the reload is cheap insurance.
  const model = await reloadModel(args.rootPath);
  const manager = new StagingAreaManager(model.rootPath, model);
  const planned = await resolveChangeset(manager, args.planned, "planned");
  const asBuilt = args.against?.changesetId ? await resolveChangeset(manager, args.against.changesetId) : undefined;
  const report = await verifyChangesetInModel(model, {
    planned,
    against: asBuilt ? { changeset: asBuilt } : { base: true, extracted: args.against.extracted === true },
    matchBySource: args.matchBySource,
  });
  return { model, manager, planned, ...(asBuilt ? { asBuilt } : {}), report };
}

export async function changesetVerifyHandler(args: ChangesetVerifyArgs): Promise<CallToolResult> {
  return runTool(async () => jsonResult((await runVerify(args)).report));
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
    "the plan lacks; changeset_adopt_source_references copies them onto the plan before it lands. Reads the model " +
    "fresh from disk, so a commit made outside MCP is seen. Read-only.",
  inputSchema,
  handler: changesetVerifyHandler,
};
