/**
 * changeset_commit — land staged changesets in the base model when the user asks.
 *
 * An ordinary write tool (#1419, the maintainer's decision of 2026-11-26, reversing the 2026-11-09
 * "always elicit" ruling): no confirmation dialog, no token, no permission-prompt flag. The user
 * asks in the conversation; git and the pull request are the gate: the result names the files to
 * commit, and a person approves the landed model in the PR (motivation.requirement.landing-a-change-
 * needs-a-humans-confirmation). What still refuses a landing:
 * - changeset-only mode (DrBot), where no person is in the conversation: the viewer's Apply is the
 *   route there;
 * - a verification record or an upgrade record, which is never landed (core/changeset-purpose.ts);
 * - a validation error the changeset introduces (the base model's own are counted).
 *
 * `changesets: [...]` lands several in order and stops at the first refusal (#1256): the ones
 * before it stay landed, and the result says so. Each is prepared against the base as the one
 * before it left it, so its drift and overlaps include what the earlier ones landed.
 *
 * The commit itself is `StagingAreaManager.commit`, the code `dr changeset commit` and the viewer's
 * Apply (`POST /api/changesets/:id/commit`) run. Like the viewer, it works on a freshly loaded model
 * and may commit any staged changeset, active or not. Drift does not refuse it (#1200): the result
 * lists each staged change the base overlapped and what landing did about it. `force` is accepted
 * and ignored. Landing an as-built changeset from codebase_extract while a plan is staged is
 * allowed, with a warning that the plan should land instead.
 *
 * Only a bootstrap or reconcile landing (a changeset codebase_extract staged from the whole code,
 * or from a branch's changes with no plan active) reconciles the model with the code:
 * StagingAreaManager.commit stamps the manifest's `reconciled` block for it, and the result carries
 * the stamp. A plan's landing doesn't (see core/reconciliation.ts).
 *
 * The result names the paths to commit (#1367): the model files the landing wrote, the manifest, and
 * each changeset's own folder, which the landing leaves untracked in git.
 * changeset_commit_preview is the read-only dry run: the same checks and summary, nothing written.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Model } from "../../core/model.js";
import type { Changeset } from "../../core/changeset.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import {
  describeDrift,
  describedAsDrifted,
  overlapKinds,
  type ChangesetDrift,
  type OverlapKind,
} from "../../core/changeset-base-index.js";
import { purposeOf, RECONCILING_PURPOSES } from "../../core/changeset-purpose.js";
import { StagingAreaManager, type DriftReport } from "../../core/staging-area.js";
import { checkUncommitted, emptyLandingHold, extractionOrigin, landsEmpty, reconciliationStamp } from "../../core/reconciliation.js";
import { createCommitProgressReporter } from "../../core/commit-progress.js";
import { isChangesetOnly, CHANGESET_ONLY_ENV } from "../../core/changeset-only-guard.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import { assertRunningCodeInstalled, withRunningCodeChecked } from "../../utils/running-code.js";
import { getCliVersion } from "../../utils/spec-version.js";
import { changesetLinkIfRunning, landsOnSentence } from "./central-viewer.js";
import {
  jsonResult,
  loadModel,
  reloadModel,
  rootPathSchema,
  runTool,
  withProjectWriteLock,
  type McpToolContext,
  type McpToolDefinition,
} from "./shared.js";
import { resolveChangeset } from "./changeset-shared.js";
import { alreadyLandedResult, filesToCommit } from "./changeset-landed.js";
import { isExtractionChangeset } from "./codebase-extract.js";
import { landingRelayoutNote } from "../../core/model-relayout.js";

/**
 * How many overlaps of one kind the landing summary names by default. A display default, not a
 * cut-off on what is known: the summary always gives the true count of every kind and what landing
 * does about it, says how many it did not name, and names the call that lists them all. The
 * commit's result names every overlap.
 */
export const OVERLAPS_NAMED_PER_KIND = 10;

/**
 * How a session that can't land (changeset-only mode) gets a changeset landed: the viewer's Apply.
 * Never the CLI: the developer types no dr command (round 3 found agents passing it on).
 */
export function otherWaysToLand(viewerUrl?: string): string[] {
  return [
    viewerUrl
      ? `Ask the user to commit it in the viewer: give them ${viewerUrl} (it opens the changeset), and they press Apply ` +
        "on it (Apply lands a drifted changeset too)"
      : "Ask the user to commit it in the viewer: call review_open, give them its url, and they press Apply on the " +
        "changeset (Apply lands a drifted changeset too)",
  ];
}

const OPERATION_LABELS: Record<string, string> = {
  add: "adds",
  update: "updates",
  delete: "deletes",
  "relationship-add": "relationship adds",
  "relationship-delete": "relationship deletes",
};

/** Counts by operation and the layers touched, in a stable order. */
export function summarizeChangeset(changeset: Changeset): { byOperation: Record<string, number>; layers: string[] } {
  const byOperation: Record<string, number> = {};
  const layers = new Set<string>();
  for (const change of changeset.changes) {
    byOperation[change.type] = (byOperation[change.type] ?? 0) + 1;
    if (change.layerName) layers.add(change.layerName);
  }
  return { byOperation, layers: [...layers].sort() };
}

/** How the landing summary shows the overlaps: every kind, and how many of the overlaps it names. */
function overlapSummary(
  drift: ChangesetDrift | undefined,
  namedPerKind: number
): { total: number; named: number; kinds: OverlapKind[] } {
  const kinds = drift ? overlapKinds(drift) : [];
  return {
    total: kinds.reduce((n, kind) => n + kind.items.length, 0),
    named: kinds.reduce((n, kind) => n + Math.min(kind.items.length, namedPerKind), 0),
    kinds,
  };
}

/** The call that lists every overlap of a staged changeset, for when the summary names only some. */
function everyOverlapCall(changeset: string): string {
  return `changeset_brief with changeset: "${changeset}" and sections: ["drift"]`;
}

/**
 * The drift section of the landing summary: what changed in the base, and for each staged change
 * the base overlaps, what landing does about it. This is where the person decides, so it names the
 * outcomes (#1200), not only that the base changed.
 *
 * With drift no longer refusing, this text is all that stands between the person and an overwrite,
 * so it never claims more than was read: the count of overlaps is the true one, every kind is
 * shown with what landing does about it, and when a kind has more overlaps than are named here it
 * says how many and where to read them all.
 */
export function driftLines(
  drift: ChangesetDrift | undefined,
  hash: DriftReport,
  changeset = "",
  namedPerKind = OVERLAPS_NAMED_PER_KIND
): string[] {
  const rebaselined = drift?.rebaselined
    ? [
        `  Re-baselined ${drift.rebaselined.at}${drift.rebaselined.times > 1 ? ` (${drift.rebaselined.times} times)` : ""}: ` +
          "base changes before then are not listed here.",
      ]
    : [];
  if (!hash.isDrifted && !hash.contentFree && !drift?.isDrifted && !drift?.notChecked) {
    return ["Drift: none. The base model has not changed under this changeset.", ...rebaselined];
  }
  const lines = ["Drift: the base model changed under this changeset.", ...rebaselined];
  const counts = drift?.baseChanges?.counts;
  if (counts) {
    const parts = [
      [counts.elementsAdded, "elements added"],
      [counts.elementsRemoved, "elements removed"],
      [counts.elementsChanged, "elements changed"],
      [counts.relationshipsAdded, "relationships added"],
      [counts.relationshipsRemoved, "relationships removed"],
    ]
      .filter(([n]) => (n as number) > 0)
      .map(([n, label]) => `${n} ${label}`);
    if (parts.length > 0) lines.push(`  In the base: ${parts.join(", ")}.`);
  }
  const overlaps = overlapSummary(drift, namedPerKind);
  // What could not be checked is said wherever overlaps are, so a count is never read as complete.
  const notChecked = drift?.notChecked ? [`  ${drift.notChecked.sentence}`] : [];
  if (overlaps.total > 0) {
    lines.push(
      `  ${overlaps.total} staged change(s) overlap the base${notChecked.length > 0 ? " (of those that could be checked)" : ""}. ` +
        "Landing goes ahead, and does this:"
    );
    for (const kind of overlaps.kinds) {
      lines.push(`  - ${kind.reason}, ${kind.items.length} ${kind.of}(s): ${kind.consequence}`);
      for (const item of kind.items.slice(0, namedPerKind)) lines.push(`      ${item}`);
      if (kind.items.length > namedPerKind) lines.push(`      and ${kind.items.length - namedPerKind} more`);
    }
    if (overlaps.named < overlaps.total) {
      lines.push(
        `  ${overlaps.total - overlaps.named} of the ${overlaps.total} are not named here. ` +
          `${everyOverlapCall(changeset)} names every one, as does the changeset in the viewer.`
      );
    }
  } else if (!drift) {
    lines.push("  What it overlaps could not be read. Landing goes ahead all the same.");
  } else if (notChecked.length > 0) {
    lines.push("  No overlap was found in what could be checked. Landing goes ahead.");
  } else {
    lines.push("  Nothing this changeset stages overlaps it.");
  }
  return [...lines, ...notChecked];
}

/** The description codebase_extract gives the changesets it creates. */
const EXTRACTION_MARKER = /Staged by codebase_extract/;

/**
 * Whether codebase_extract made this changeset: its description says so, or extraction keeps a
 * record for it (its cards file, or waiting cards adopted under this name).
 */
async function madeByExtraction(rootPath: string, changeset: Changeset): Promise<boolean> {
  if (EXTRACTION_MARKER.test(changeset.description ?? "")) return true;
  return !!changeset.id && (await isExtractionChangeset(rootPath, changeset.id, changeset.name));
}

/**
 * The warning shown when an extraction (as-built) changeset is about to land while a plan is
 * staged. The verify workflow lands the plan and discards the as-built changeset (or keeps it as a
 * record); landing the as-built first drifts the plan's base: the plan's adds of the same elements
 * are then skipped, so its descriptions don't apply to the elements the as-built side added.
 */
export async function asBuiltFirstWarning(
  manager: StagingAreaManager,
  rootPath: string,
  changeset: Changeset
): Promise<string | undefined> {
  if (!(await madeByExtraction(rootPath, changeset))) return undefined;
  const plans: Changeset[] = [];
  for (const other of await manager.list()) {
    if (other.id === changeset.id || other.status !== "staged" || other.changes.length === 0) continue;
    if (!(await madeByExtraction(rootPath, other))) plans.push(other);
  }
  if (plans.length === 0) return undefined;
  const names = plans.map((plan) => `"${plan.name}"`).join(", ");
  return (
    `Warning: "${changeset.name}" is an as-built changeset from codebase_extract, and the plan ${names} is still ` +
    `staged. After verify, land the plan instead, and discard this one or keep it as a record. Landing this one ` +
    `first changes the plan's base: the plan's adds of the same elements are then skipped, so its descriptions ` +
    `won't apply to the elements this one adds.`
  );
}

/** The landing summary: what the preview shows, and what a landing does. */
export function landingSummaryText(
  changeset: Changeset,
  drift: ChangesetDrift | undefined,
  hash: DriftReport,
  preExistingErrors: number,
  warnings: string[] = [],
  emptyLine?: string
): string {
  const { byOperation, layers } = summarizeChangeset(changeset);
  const counts = Object.entries(byOperation)
    .map(([type, n]) => `${n} ${OPERATION_LABELS[type] ?? type}`)
    .join(", ");
  return [
    `Land changeset "${changeset.name}" in the base model.`,
    "",
    ...warnings.flatMap((warning) => [warning, ""]),
    `Intent: ${changeset.description?.trim() || "(no description)"}`,
    emptyLine ? `Changes: ${emptyLine}` : `Changes: ${changeset.changes.length} (${counts})`,
    `Layers: ${layers.join(", ") || "none"}`,
    ...driftLines(drift, hash, changeset.name),
    preExistingErrors > 0
      ? `Validation: passed. ${preExistingErrors} error(s) already in the base model are not counted.`
      : "Validation: passed.",
    "",
    "Landing writes these changes to the base model and marks the changeset committed.",
  ].join("\n");
}

function refusal(message: string, suggestions: string[]): CLIError {
  return new CLIError(message, ErrorCategory.USER, suggestions, { operation: "changeset_commit" });
}

/** Wraps a StagingAreaManager error (plain Error) so the agent sees what blocked the commit. */
function commitError(error: unknown, name: string): CLIError {
  if (error instanceof CLIError) return error;
  const message = getErrorMessage(error);
  if (message.startsWith("Validation failed")) {
    return new CLIError(
      `Changeset '${name}' was not committed. ${message.replace(/, or skip validation with --no-validate\./, ".")}`,
      ErrorCategory.VALIDATION,
      ['Fix the plan (model_update, changeset_unstage, ...) and check it with "model_validate"']
    );
  }
  return new CLIError(`Changeset '${name}' was not committed: ${message}`, ErrorCategory.SYSTEM);
}

/**
 * The viewer link to the changeset a refusal is about, when the central DR process runs: the
 * refusal hands it to the user. Never starts the process, and never fails a refusal (undefined).
 */
async function landingLink(args: { changeset: string; rootPath?: string }): Promise<string | undefined> {
  try {
    const model = await loadModel(args.rootPath);
    let id: string | undefined;
    try {
      id = (await resolveChangeset(new StagingAreaManager(model.rootPath, model), args.changeset, "changeset")).id;
    } catch {
      id = undefined;
    }
    return (await changesetLinkIfRunning(model.rootPath, id))?.url;
  } catch {
    return undefined;
  }
}

/** A staged changeset with something to land, and whether its base drifted. */
interface LandingTarget {
  rootPath: string;
  model: Model;
  manager: StagingAreaManager;
  changeset: Changeset;
  hash: DriftReport;
}

async function describeDriftSafely(target: LandingTarget, toolName: string): Promise<ChangesetDrift | undefined> {
  try {
    // The drift check described it to decide; describe it here only when it could not.
    if (target.hash.described) return target.hash.isDrifted ? describedAsDrifted(target.hash.described) : target.hash.described;
    return await describeDrift(target.model, await ChangesetGraph.build(target.model, target.changeset), target.hash);
  } catch (error) {
    console.error(`[mcp] ${toolName} could not describe drift: ${getErrorMessage(error)}`);
    return undefined;
  }
}

/**
 * When the extraction this changeset holds read source files with uncommitted changes (#1330): the
 * landing would be recorded against a HEAD that lacks that code, so committing the code afterwards
 * would show drift that isn't there. Nothing once those files are committed as they were read.
 */
async function uncommittedCodeWarning(target: LandingTarget): Promise<string | undefined> {
  const origin = await extractionOrigin(target.rootPath, target.changeset);
  if (!origin.uncommitted || Object.keys(origin.uncommitted).length === 0) return undefined;
  const check = await checkUncommitted(target.model.codebaseRoot ?? target.rootPath, origin.uncommitted, origin.gitHead);
  if (check.settled) return undefined;
  const files = [...check.pending, ...check.changed, ...check.others];
  const listed = files.length > 5 ? `${files.slice(0, 5).join(", ")} and ${files.length - 5} more` : files.join(", ");
  const read = origin.gitHead ? ` at ${origin.gitHead.slice(0, 7)}` : "";
  return (
    `Commit the code first, then land. The extraction read ${Object.keys(origin.uncommitted).length} source file(s) with uncommitted changes` +
    `${read}; ${check.pending.length ? `${check.pending.length} still uncommitted` : ""}` +
    `${check.pending.length && check.changed.length ? ", " : ""}${check.changed.length ? `${check.changed.length} committed with other content than it read or edited after the index` : ""}` +
    `${check.others.length ? `; ${check.others.length} other source file(s) changed since, which it did not read` : ""}` +
    `${check.orphaned ? "; the commit it read is no longer on this branch" : ""} ` +
    `(${listed}). Landing now is recorded against a HEAD that lacks that code, and once the code is committed project_status shows drift that isn't real. ` +
    "Landing after the code is committed as it was read records the commit that holds it."
  );
}

/** The line of the landing summary for a landing that stages nothing, and where it moves the drift baseline. */
async function emptyReconcileLine(target: LandingTarget): Promise<string | undefined> {
  if (target.changeset.changes.length > 0) return undefined;
  const stamp = await reconciliationStamp(target.rootPath, target.changeset, target.model.codebaseRoot ?? target.rootPath);
  const from = target.model.manifest.reconciled?.code_commit;
  const to = stamp?.code_commit;
  return (
    `0 changes: records that the model matches the code it read, and moves the drift baseline ` +
    `${from ? `from ${from.slice(0, 7)} ` : ""}${to ? `to ${to.slice(0, 7)}` : "to the code's HEAD at landing"}.`
  );
}

/**
 * What the person should know before landing: an as-built changeset landing while the plan is
 * staged (the plan should land instead), the files the landing would re-lay out, and evidence that
 * something is still writing into it.
 */
async function landingWarnings(target: LandingTarget): Promise<string[]> {
  const uncommitted = await uncommittedCodeWarning(target);
  const asBuiltFirst = await asBuiltFirstWarning(target.manager, target.rootPath, target.changeset);
  // Files an earlier dr laid out, which the landing lays out anew (#1439): never refuses it
  const relayout = await landingRelayoutNote(target.rootPath, target.changeset.changes).catch((error) => {
    console.error(`[mcp] could not check the layout of the files the landing writes: ${getErrorMessage(error)}`);
    return null;
  });
  const stillWriting = await target.manager.writeActivityWarning(target.changeset);
  return [
    ...(uncommitted ? [uncommitted] : []),
    ...(asBuiltFirst ? [asBuiltFirst] : []),
    ...(relayout ? [relayout] : []),
    ...(stillWriting ? [stillWriting] : []),
  ];
}

/**
 * Finds the staged changeset to land and reads its drift, which never refuses the landing. Returns
 * a result instead when there is nothing to commit. Writes nothing.
 */
async function prepareLanding(
  args: { changeset: string; rootPath?: string }
): Promise<{ landing: LandingTarget } | { answer: Record<string, unknown> }> {
  // A process whose installed CLI changed under it would land with the old code: refuse before the
  // person is asked anything (#1427). Only the central process has the guard on.
  await assertRunningCodeInstalled();
  // The cached model names the project; the commit runs on a fresh read, like the viewer's.
  const rootPath = (await loadModel(args.rootPath)).rootPath;
  const model = await Model.load(rootPath, { lazyLoad: false });
  const manager = new StagingAreaManager(model.rootPath, model);
  const changeset = await resolveChangeset(manager, args.changeset, "changeset");
  // Already landed is an answer, not a wrong name (#1441).
  if (changeset.status === "committed") {
    return { answer: { ...(await alreadyLandedResult(model, changeset)) } };
  }
  if (changeset.status !== "staged") {
    throw new CLIError(`Changeset '${changeset.name}' is ${changeset.status}; only a staged changeset can be committed`, ErrorCategory.USER, [
      'Use "changeset_list" to find a staged changeset',
    ]);
  }
  // A record (verification or upgrade) never lands (StagingAreaManager.commit refuses it too).
  const purposeRefusal = await manager.landingRefusal(changeset);
  if (purposeRefusal) throw purposeRefusal;
  // A reconcile or bootstrap with nothing staged still lands: it records that the model matches the
  // code it read, and moves the drift baseline there (#1331). Any other purpose has nothing to land.
  if (changeset.changes.length === 0 && !(await landsEmpty(rootPath, changeset))) {
    const hold = RECONCILING_PURPOSES.includes((await purposeOf(rootPath, changeset)).purpose) ? await emptyLandingHold(rootPath, changeset) : undefined;
    return {
      answer: {
        id: changeset.id,
        name: changeset.name,
        status: "nothing-to-commit",
        stagedChanges: 0,
        ...(hold ? { note: `It stages nothing, and it can't land as the record that the model matches the code: ${hold}.` } : {}),
      },
    };
  }

  const hash = await manager.detectDrift(changeset.id);
  return { landing: { rootPath, model, manager, changeset, hash } };
}

/** What a landing summary reports before the changeset lands. */
interface LandingSummary {
  warnings: string[];
  /** The landing summary: the preview's summary. */
  message: string;
  /** The overlaps the summary reports: how many there are, and how many of them it names. */
  overlaps: { total: number; named: number };
}

/**
 * Checks the landing with a dry run, so the preview never promises a commit that would fail, and
 * builds the summary. Writes nothing.
 */
async function summarizeLanding(target: LandingTarget, toolName: string): Promise<LandingSummary> {
  const { model, manager, changeset, hash } = target;
  let preExistingErrors = 0;
  try {
    const dryRun = await manager.commit(model, changeset.id, { dryRun: true, validate: true });
    preExistingErrors = dryRun.validation.preExistingErrors ?? 0;
  } catch (error) {
    throw commitError(error, changeset.name);
  }
  const drift = await describeDriftSafely(target, toolName);
  const warnings = await landingWarnings(target);
  const { total, named } = overlapSummary(drift, OVERLAPS_NAMED_PER_KIND);
  const landsOn = await landsOnSentence(target.rootPath);
  const emptyLine = await emptyReconcileLine(target);
  const message = landingSummaryText(changeset, drift, hash, preExistingErrors, warnings, emptyLine);
  return {
    warnings,
    // The branch is named in the summary (#1422).
    message: landsOn ? message.replace("\n\n", () => `\n${landsOn}\n\n`) : message,
    overlaps: { total, named },
  };
}

const inputSchema = {
  changeset: z
    .string()
    .min(1)
    .optional()
    .describe("Changeset ID or name to land. It need not be the active changeset. Give this or changesets."),
  changesets: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe(
      "Several changesets to land in this order (IDs or names), stopping at the first one refused: the ones before it " +
        "stay landed. Each is checked against the base as the ones before it left it."
    ),
  force: z
    .boolean()
    .optional()
    .describe("Deprecated and ignored: drift does not refuse a commit, so there is nothing to force."),
  rootPath: rootPathSchema,
};

export type ChangesetCommitArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/** The changeset names a call asks to land, in order, each once. */
function requestedNames(args: { changeset?: string; changesets?: string[] }): string[] {
  const names = [...(args.changeset ? [args.changeset] : []), ...(args.changesets ?? [])];
  return [...new Set(names)];
}

/** What landing one changeset gives, in the shape changeset_commit returns for a single changeset. */
type LandedChangeset = Record<string, unknown> & { status: string; name: string; filesToCommit?: string[]; warnings?: string[] };

/** Lands one changeset: its answer when there is nothing to land, else the landing's result. Throws a refusal. */
async function landOne(name: string, rootArg: string | undefined, forceIgnored: boolean): Promise<LandedChangeset> {
  const prepared = await prepareLanding({ changeset: name, rootPath: rootArg });
  if ("answer" in prepared) return prepared.answer as LandedChangeset;
  const target = prepared.landing;
  const { rootPath, changeset } = target;
  const warnings = await landingWarnings(target);
  const { byOperation, layers } = summarizeChangeset(changeset);

  // Hold the project's write lock from the fresh read through the landing: no other tool's write
  // lands between them, and none saves a model it read before the landing over it.
  const { result, model } = await withProjectWriteLock(rootPath, async () => {
    const model = await Model.load(rootPath, { lazyLoad: false });
    const manager = new StagingAreaManager(model.rootPath, model);
    // In the central process, the checkout's open viewers see the commit's progress (issue 1361).
    const progress = createCommitProgressReporter(model.rootPath, changeset.id);
    let landed;
    try {
      // Checked once for the whole commit: a CLI change partway through never half-lands it (#1427).
      landed = await withRunningCodeChecked(() =>
        manager.commit(model, changeset.id, { validate: true, onProgress: progress.onProgress })
      );
    } catch (error) {
      progress.fail();
      throw commitError(error, changeset.name);
    }
    progress.phase("reloading");
    try {
      await reloadModel(rootArg);
    } finally {
      progress.finish();
    }
    return { result: landed, model };
  });
  if (result.deactivationError) {
    warnings.push(
      `The changeset was committed, but its active-changeset marker could not be cleared (${result.deactivationError}). ` +
        "The marker is ignored, since a committed changeset is never the active one: reads show the base model, and " +
        "writes aimed at the changeset are refused. changeset_deactivate removes the marker once the cause is fixed."
    );
  }
  if (forceIgnored) {
    warnings.push("force is deprecated and was ignored: drift does not refuse a landing, so there is nothing to force.");
  }
  // What the base overlapped when this landed, read by the commit before it applied the changes.
  // Every overlap is named: once it has landed, no other call can list them.
  const landedOver = result.driftDetail ? overlapKinds(result.driftDetail) : [];
  const overlapTotal = landedOver.reduce((n, kind) => n + kind.items.length, 0);

  return {
    id: changeset.id,
    name: changeset.name,
    status: "committed",
    intent: changeset.description?.trim() || undefined,
    changes: changeset.changes.length,
    byOperation,
    layers,
    committed: result.committed,
    skipped: result.skipped ?? 0,
    // Every one: a landed changeset's skips can't be read again anywhere else.
    ...(result.skippedDetails?.length ? { skippedDetails: result.skippedDetails } : {}),
    failed: result.failed,
    preExistingErrors: result.validation.preExistingErrors ?? 0,
    deactivated: result.deactivated,
    ...(result.driftWarning
      ? {
          drift: {
            landedOver:
              overlapTotal > 0
                ? `The base overlapped ${overlapTotal} staged change(s); the changeset landed, and did this about each kind.`
                : "The base had changed under this changeset and what it overlapped could not be listed; the changeset landed all the same.",
            total: overlapTotal,
            ...(result.driftDetail?.notChecked ? { notChecked: result.driftDetail.notChecked.sentence } : {}),
            ...(overlapTotal > 0
              ? { kinds: landedOver.map((kind) => ({ reason: kind.reason, of: kind.of, count: kind.items.length, consequence: kind.consequence, items: kind.items })) }
              : {}),
          },
        }
      : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    filesToCommit: await filesToCommit(rootPath, changeset),
    // Only an as-built landing reconciles the model with the code (code drift in project_status).
    ...(result.reconciled
      ? {
          reconciled: result.reconciled,
          codeDrift:
            "This as-built landing reconciles the model with the code: once documentation-robotics/ is committed, " +
            "project_status counts code drift from that commit.",
        }
      : model.manifest.reconciled
        ? {
            codeDrift:
              "Landing a plan doesn't reconcile the model with the code: project_status still counts code drift from " +
              `the last as-built landing, "${model.manifest.reconciled.changeset}".`,
          }
        : {
            // No as-built landing recorded: project_status falls back to the last model commit that
            // isn't a spec migration, so committing this landing does reset drift.
            codeDrift:
              "This model has no as-built landing recorded, so project_status counts code drift from the last model " +
              "commit: once documentation-robotics/ is committed, drift is counted from there, though a plan isn't " +
              "checked against the code. Landing a bootstrap or a kept as-built changeset from codebase_extract " +
              "records a reconciliation; after that, landing a plan no longer resets drift.",
          }),
  };
}

/** One line of the summary of a call that landed several changesets. */
function landedLine(landed: LandedChangeset): string {
  if (landed.status === "committed") {
    const counts = Object.entries((landed.byOperation as Record<string, number>) ?? {})
      .map(([type, n]) => `${n} ${OPERATION_LABELS[type] ?? type}`)
      .join(", ");
    const drift = landed.drift as { total?: number } | undefined;
    const overlaps = drift?.total ? `; the base overlapped ${drift.total} staged change(s)` : "";
    return `${landed.name}: landed, ${landed.changes} change(s)${counts ? ` (${counts})` : ""}${overlaps}.`;
  }
  return `${landed.name}: ${landed.status}.`;
}

export async function changesetCommitHandler(
  args: ChangesetCommitArgs,
  _context?: McpToolContext
): Promise<CallToolResult> {
  return runTool(async () => {
    if (isChangesetOnly()) {
      throw refusal(
        `This session can't commit a changeset: it is in changeset-only mode (${CHANGESET_ONLY_ENV}), ` +
          "where no person is in the conversation to ask for it.",
        ["Tell the user the changeset is ready to land", ...otherWaysToLand(await landingLink({ changeset: requestedNames(args)[0] ?? "", rootPath: args.rootPath }))]
      );
    }
    const names = requestedNames(args);
    if (names.length === 0) {
      throw refusal("Name the changeset to land: changeset, or changesets for several.", ['Use "changeset_list" to find a staged changeset']);
    }
    const forceIgnored = args.force !== undefined;

    const landed: LandedChangeset[] = [];
    let stopped: { changeset: string; error: string; suggestions: string[] } | undefined;
    for (const name of names) {
      try {
        landed.push(await landOne(name, args.rootPath, forceIgnored && landed.length === 0));
      } catch (error) {
        // The first refusal is the call's error; a later one leaves the earlier landings reported.
        if (landed.length === 0) throw error;
        const cli = error instanceof CLIError ? error : undefined;
        stopped = { changeset: name, error: getErrorMessage(error), suggestions: cli?.suggestions ?? [] };
        break;
      }
    }

    const landedOn = await landsOnSentence((await loadModel(args.rootPath)).rootPath);
    const files = [...new Set(landed.flatMap((one) => one.filesToCommit ?? []))].sort();
    const next =
      files.length > 0
        ? `Commit these with the code, so the pull request shows what landed (the changeset folder is among them): ${files.join(", ")}.`
        : undefined;
    const base = landedOn ? { landedOn: landedOn.replace("Lands on", "Landed on") } : {};

    // One changeset asked for: its result, flat.
    if (names.length === 1) {
      const [only] = landed;
      return jsonResult({ ...only, ...base, ...(next && only.status === "committed" ? { next } : {}) });
    }
    const notAttempted = names.slice(landed.length + (stopped ? 1 : 0));
    return jsonResult({
      status: stopped ? "stopped" : "committed",
      ...base,
      summary: [
        ...landed.map(landedLine),
        ...(stopped ? [`${stopped.changeset}: not landed. ${stopped.error}`] : []),
        ...(notAttempted.length > 0 ? [`Not attempted: ${notAttempted.join(", ")}.`] : []),
      ],
      landed,
      ...(stopped ? { stoppedAt: stopped } : {}),
      ...(notAttempted.length > 0 ? { notAttempted } : {}),
      filesToCommit: files,
      ...(next ? { next } : {}),
    });
  });
}

export const changesetCommitTool: McpToolDefinition<typeof inputSchema> = {
  name: "changeset_commit",
  description:
    "Land one or several staged changesets: write their changes to the base model and mark them committed. Call it " +
    "when the user asks to land the change; git and the pull request are the gate, not a dialog or a token. Give " +
    "changeset, or changesets to land several in order (stopping at the first refusal; the ones before it stay " +
    "landed). Validation errors the changeset introduces refuse it, as do changeset-only sessions (DrBot) and " +
    "verification and upgrade records. Drift does not: a drifted changeset lands, and the result says what the base " +
    "overlapped and what landing did about it (force is ignored). The result gives each changeset's counts and " +
    "layers, the branch it landed on, and filesToCommit: the model files and the changeset folders to commit with " +
    "the code. changeset_commit_preview is the read-only dry run.",
  inputSchema,
  handler: changesetCommitHandler,
};

const previewInputSchema = {
  changeset: z.string().min(1).describe("Changeset ID or name to land."),
  force: z.boolean().optional().describe("Deprecated and ignored: drift no longer refuses a commit."),
  rootPath: rootPathSchema,
};

export type ChangesetCommitPreviewArgs = z.infer<z.ZodObject<typeof previewInputSchema>>;

export async function changesetCommitPreviewHandler(
  args: ChangesetCommitPreviewArgs,
  _context?: McpToolContext
): Promise<CallToolResult> {
  return runTool(async () => {
    const prepared = await prepareLanding(args);
    if ("answer" in prepared) return jsonResult(prepared.answer);
    const { changeset, hash } = prepared.landing;
    const { message, overlaps } = await summarizeLanding(prepared.landing, "changeset_commit_preview");
    const landsOn = await landsOnSentence(prepared.landing.rootPath);
    const stillWriting = await prepared.landing.manager.writeActivityWarning(changeset);
    return jsonResult({
      id: changeset.id,
      name: changeset.name,
      status: "ready-to-commit",
      ...(landsOn ? { landsOn } : {}),
      ...(stillWriting ? { stillWriting } : {}),
      // The CLI that lands it, stamped as the manifest's cli_version (#1427).
      cliVersion: getCliVersion(),
      // Drift is in the summary; it does not stop the landing.
      drifted: hash.isDrifted,
      summary: message,
      // The true count, and how many of them the summary names (every kind is in it either way).
      overlaps,
      // What landing would put in the commit: the model files and the changeset's folder.
      filesToCommit: await filesToCommit(prepared.landing.rootPath, changeset),
      ...(overlaps.named < overlaps.total
        ? {
            more:
              `The summary names ${overlaps.named} of the ${overlaps.total} overlaps. ${everyOverlapCall(changeset.name)} ` +
              "names every one: read them, and tell the user what the rest are.",
          }
        : {}),
      next: isChangesetOnly()
        ? "This session can't commit (changeset-only mode). Tell the user it is ready; they land it in the viewer with Apply."
        : "When the user asks to land it, call changeset_commit.",
    });
  });
}

export const changesetCommitPreviewTool: McpToolDefinition<typeof previewInputSchema> = {
  name: "changeset_commit_preview",
  description:
    "Check a staged changeset for landing without writing anything: validation and the landing summary (intent, " +
    "counts, layers, and drift: the true count of staged changes the base overlaps, and for every kind of overlap " +
    "what landing does about it; when a kind has many it names the first and says where the rest are), and the " +
    "files the landing would put in the commit. Drift does not stop a landing. A read-only dry run: it returns no " +
    "token and changeset_commit needs none. A changeset already landed is answered with status 'already-landed' " +
    "(when, its files, whether git has them): nothing to do. stillWriting says when something writes into it now, " +
    "or another process staged into it moments ago.",
  inputSchema: previewInputSchema,
  handler: changesetCommitPreviewHandler,
};
