/**
 * changeset_verify — compare a planned changeset with what was built.
 * See `cli/src/core/changeset-verify.ts` and docs/CHANGE_MODELING.md.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { verifyChangesetInModel } from "../../core/changeset-verify.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { resolveChangeset } from "./changeset-shared.js";

const inputSchema = {
  planned: z
    .string()
    .optional()
    .describe("The planned changeset, by ID or name. Defaults to the active changeset."),
  against: z
    .object({
      changesetId: z
        .string()
        .optional()
        .describe("An as-built changeset (by ID or name), e.g. one written by extraction or by hand."),
      base: z
        .boolean()
        .optional()
        .describe("Compare with the base model, e.g. after the as-built changeset was committed on the branch."),
    })
    .describe('What was built: {"changesetId": "..."} or {"base": true}.'),
  matchBySource: z
    .boolean()
    .optional()
    .describe("Also match elements of the same layer and type that share a source file (default true)."),
  rootPath: rootPathSchema,
};

export type ChangesetVerifyArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function changesetVerifyHandler(args: ChangesetVerifyArgs): Promise<CallToolResult> {
  return runTool(async () => {
    if (args.against?.changesetId && args.against.base) {
      throw new CLIError('Pass either "against.changesetId" or "against.base", not both', ErrorCategory.USER);
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
    const planned = await resolveChangeset(manager, args.planned);
    const asBuilt = args.against?.changesetId ? await resolveChangeset(manager, args.against.changesetId) : undefined;
    return jsonResult(
      await verifyChangesetInModel(model, {
        planned,
        against: asBuilt ? { changeset: asBuilt } : { base: true },
        matchBySource: args.matchBySource,
      })
    );
  });
}

export const changesetVerifyTool: McpToolDefinition<typeof inputSchema> = {
  name: "changeset_verify",
  description:
    "Compare a planned changeset with what was built: another (as-built) changeset, or the base model. Elements " +
    "match by id, then by layer + type + name ignoring case and separators, then by source file; relationships " +
    "match through those element matches. Reports matched, missing (planned, not built), unplanned (built, not " +
    "planned), divergent (matched but type, description or attributes differ, with the fields), and planned " +
    "deletions that still exist, with a verdict. Fuzzy matches are marked probable with their reason; confirm " +
    "them. Reads the model fresh from disk, so a commit made outside MCP is seen. Read-only.",
  inputSchema,
  handler: changesetVerifyHandler,
};
