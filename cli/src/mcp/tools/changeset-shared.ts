/**
 * Helpers shared by the changeset-planning MCP tools.
 */

import { z } from "zod";
import type { Changeset } from "../../core/changeset.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import type { Model } from "../../core/model.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { DESCRIPTION_IS_MARKDOWN } from "../../core/changeset-description.js";

/** What a tool's older name for its changeset argument says about itself. */
export const CHANGESET_ALIAS_DESCRIPTION = "Older name for 'changeset'; accepted until the next release.";

/**
 * The schema fields for "the changeset this call acts on": `changeset`, the documented name, and
 * `changesetId`, its older name, accepted until the next release. Both are optional in the
 * schema; a tool that needs one enforces it in its handler with `changesetArg(args, { required })`.
 * (A `z.preprocess` rename would hide the alias from the schema the SDK sends to clients.)
 */
export function changesetArgFields(description: string) {
  return {
    changeset: z.string().optional().describe(description),
    changesetId: z.string().optional().describe(CHANGESET_ALIAS_DESCRIPTION),
  };
}

/** What a changeset's description is, said once for every tool that writes it (#1210, #1433). */
export const INTENT_IS_MARKDOWN =
  `Write it as ${DESCRIPTION_IS_MARKDOWN}. A short shape: one or two sentences of intent; ` +
  "**In scope:** a list naming the elements or areas, ids in code spans; **Done when:** what has to be true.";

/**
 * The schema fields for a changeset's intent: `intent`, the name the server instructions and the
 * skills use, and `description`, the name the changeset stores it under and older calls send
 * (#1433). Both stay; a call gives one, and `intentArg` reads it.
 */
export function intentFields(intentDescription: string) {
  return {
    intent: z.string().optional().describe(`${intentDescription} ${INTENT_IS_MARKDOWN}`),
    description: z
      .string()
      .optional()
      .describe("The same as intent, under the name the changeset stores it by. Give one of them."),
  };
}

/** The intent a call gives under either name. Both, with different values, is refused. */
export function intentArg(args: { intent?: string; description?: string }): string | undefined {
  if (args.intent !== undefined && args.description !== undefined && args.intent !== args.description) {
    throw new CLIError(
      "intent and description name the same thing, and this call gives two different ones",
      ErrorCategory.USER,
      ["Pass intent alone"]
    );
  }
  return args.intent ?? args.description;
}

export interface ChangesetArgOptions {
  /** Refuse the call when neither name is given. */
  required?: boolean;
  /** The older name accepted alongside `changeset` (default `changesetId`). */
  alias?: string;
  /** Why the argument is required, added to the refusal (e.g. "discard is never implied"). */
  why?: string;
}

/**
 * The changeset a call names: `changeset`, or its older name (`changesetId` unless `alias` says
 * otherwise). A call that gives both with different values is refused, naming both values; one
 * that gives neither is refused when `required`, naming `changeset`. Otherwise undefined, which
 * the tools read as the active changeset.
 */
export function changesetArg(args: object, options: ChangesetArgOptions & { required: true }): string;
export function changesetArg(args: object, options?: ChangesetArgOptions): string | undefined;
export function changesetArg(args: object, options: ChangesetArgOptions = {}): string | undefined {
  const alias = options.alias ?? "changesetId";
  const values = args as Record<string, unknown>;
  const canonical = typeof values.changeset === "string" ? values.changeset : undefined;
  const older = typeof values[alias] === "string" ? (values[alias] as string) : undefined;
  if (canonical !== undefined && older !== undefined && canonical !== older) {
    throw new CLIError(
      `"changeset" ('${canonical}') and "${alias}" ('${older}') name different changesets`,
      ErrorCategory.USER,
      [`Pass only "changeset"; "${alias}" is its older name`]
    );
  }
  const value = canonical ?? older;
  if (value === undefined && options.required) {
    throw new CLIError(`"changeset" is required${options.why ? `: ${options.why}` : ""}`, ErrorCategory.USER, [
      'Pass "changeset": the changeset\'s ID or name',
      'Use "changeset_list" to see existing changesets',
    ]);
  }
  return value;
}

/** Loads a changeset by id or name, or the active one when none is named. */
export async function resolveChangeset(
  manager: StagingAreaManager,
  changesetId?: string,
  /** The tool parameter that names the changeset, for the hint when none is named or active. */
  parameter = "changeset"
): Promise<Changeset> {
  const id = changesetId ?? (await manager.getActiveId());
  if (!id) {
    throw new CLIError("No changeset named and none is active", ErrorCategory.USER, [
      `Pass "${parameter}", or use "changeset_create" / "changeset_activate" first`,
      'Use "changeset_list" to see existing changesets',
    ]);
  }
  const changeset = await manager.load(id);
  if (!changeset) {
    throw new CLIError(`Changeset ${id} not found`, ErrorCategory.NOT_FOUND, [
      'Use "changeset_list" to see the staged changesets (status: "all" lists every one)',
    ]);
  }
  return changeset;
}

/** The active changeset when it can still accept changes, else null. */
export async function activeStagedChangeset(manager: StagingAreaManager): Promise<Changeset | null> {
  const active = await manager.getActive();
  return active && active.status === "staged" ? active : null;
}

/** Builds the projected graph for a changeset (by id/name, or the active one). */
export async function loadChangesetGraph(
  model: Model,
  changesetId?: string
): Promise<{ manager: StagingAreaManager; changeset: Changeset; graph: ChangesetGraph }> {
  const manager = new StagingAreaManager(model.rootPath, model);
  const changeset = await resolveChangeset(manager, changesetId);
  const graph = await ChangesetGraph.build(model, changeset);
  return { manager, changeset, graph };
}

/** The `milestone` argument of the tools that scope a call to a milestone (#1389). */
export const milestoneField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .describe(
    "Only what belongs to this milestone (an id such as product.milestone.<name>, or its name), or to any of several: " +
      "the elements scheduled for it (scheduled-for) and everything in the plan that realizes, serves or composes them, " +
      "followed transitively. Read from the plan's own links: what no link ties to the milestone is not in it " +
      "(model_search with milestone lists the set; check it against the code before relying on it)."
  );

/** The milestone names a call gives, as a list. */
export function milestoneArgs(milestone: string | string[] | undefined): string[] {
  if (milestone === undefined) return [];
  return (Array.isArray(milestone) ? milestone : [milestone]).filter((m) => m.trim().length > 0);
}
