/**
 * changeset_commit — land a staged changeset in the base model, once a person confirms it.
 *
 * Landing is the human's step (motivation.requirement.landing-a-change-needs-a-humans-confirmation),
 * so the tool is gated twice:
 * - It is listed with `_meta["anthropic/requiresUserInteraction"]`. Claude Code then shows a
 *   permission prompt on every call, whatever the permission mode.
 * - It always asks the client for confirmation (`elicitation/create`), showing the changeset's
 *   name, intent, counts by operation, the layers it touches and any drift. It commits only on
 *   `accept` with `confirm: true`. A decline, a cancel, a client without form elicitation, or a
 *   changeset-only session (DrBot, where no person can answer) is refused, and nothing is written.
 *
 * The commit itself is `StagingAreaManager.commit`, the code `dr changeset commit` and the viewer's
 * Apply (`POST /api/changesets/:id/commit`) run. Like the viewer, it works on a freshly loaded model
 * and may commit any staged changeset, active or not. Like the CLI, it validates (errors the
 * changeset introduces block; the base model's own are counted) and refuses a drifted changeset
 * unless `force` is passed. Landing an as-built changeset from codebase_extract while a plan is
 * staged is allowed, but the dialog warns that the plan should land instead. Both are checked with a dry run before the person is asked, so they are
 * never asked to confirm a commit that would fail. After they accept, the changeset and the base are
 * read again and compared with what the dialog showed; any change refuses the commit.
 *
 * Only an as-built landing (a changeset codebase_extract staged) reconciles the model with the
 * code: StagingAreaManager.commit stamps the manifest's `reconciled` block for it, and the result
 * carries the stamp. A plan's landing doesn't (see core/reconciliation.ts).
 */

import { z } from "zod";
import type { CallToolResult, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { Model } from "../../core/model.js";
import type { Changeset, StagedChange } from "../../core/changeset.js";
import { BaseSnapshotManager } from "../../core/base-snapshot-manager.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import { describeDrift, type ChangesetDrift } from "../../core/changeset-base-index.js";
import { StagingAreaManager, type DriftReport } from "../../core/staging-area.js";
import { isChangesetOnly, CHANGESET_ONLY_ENV } from "../../core/changeset-only-guard.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import {
  jsonResult,
  loadModel,
  reloadModel,
  rootPathSchema,
  runTool,
  type McpToolContext,
  type McpToolDefinition,
} from "./shared.js";
import { resolveChangeset } from "./changeset-shared.js";
import { isExtractionChangeset } from "./codebase-extract.js";

/** How long the person has to answer the confirmation dialog before the commit is refused. */
export const CONFIRMATION_TIMEOUT_MS = 10 * 60_000;

/**
 * How the user can land the changeset without this tool: the viewer, or an interactive session.
 * Never the CLI: the developer types no dr command (round 3 found agents passing it on).
 */
export function otherWaysToLand(): string[] {
  return [
    "Ask the user to commit it in the viewer: call review_open, give them its url, and they press Apply on the changeset",
    "Or ask them to run changeset_commit again from an interactive Claude Code session, where the confirmation dialog can be shown",
  ];
}

const inputSchema = {
  changeset: z
    .string()
    .min(1)
    .describe("Changeset ID or name to commit. Required: it need not be the active changeset."),
  force: z
    .boolean()
    .optional()
    .describe(
      "Commit even though the base model changed since the changeset was created (drift). The confirmation " +
        "dialog shows the drift. Validation still blocks."
    ),
  rootPath: rootPathSchema,
};

export type ChangesetCommitArgs = z.infer<z.ZodObject<typeof inputSchema>>;

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

function driftLines(drift: ChangesetDrift | undefined, hash: DriftReport, forced: boolean): string[] {
  const overlapping = drift ? drift.overlapping.elements.length + drift.overlapping.relationships.length : 0;
  if (!hash.isDrifted && !drift?.isDrifted) return ["Drift: none. The base model has not changed under this changeset."];
  const lines = ["Drift: the base model changed since this changeset was created."];
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
  if (drift && overlapping > 0) {
    const listed = [
      ...drift.overlapping.elements.map((e) => `${e.id} (${e.reason})`),
      ...drift.overlapping.relationships.map((r) => `${r.source} --${r.predicate}--> ${r.target} (${r.reason})`),
    ];
    lines.push(
      `  ${overlapping} staged change(s) overlap the base: ${listed.slice(0, 5).join(", ")}${overlapping > 5 ? ", ..." : ""}.`
    );
  }
  if (!hash.isDrifted) lines.push("  The drift check still passes, so this does not block the commit.");
  else if (forced) lines.push("  Committing anyway: force was passed.");
  return lines;
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
 * record); landing the as-built first drifts the plan's base, so the plan then needs force, and
 * its descriptions don't apply to the elements the as-built side already added.
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
    `first changes the plan's base: the plan then needs force, and its descriptions won't apply to the elements ` +
    `this one adds.`
  );
}

/** The text of the confirmation dialog. */
export function confirmationMessage(
  changeset: Changeset,
  drift: ChangesetDrift | undefined,
  hash: DriftReport,
  preExistingErrors: number,
  forced: boolean,
  warnings: string[] = []
): string {
  const { byOperation, layers } = summarizeChangeset(changeset);
  const counts = Object.entries(byOperation)
    .map(([type, n]) => `${n} ${OPERATION_LABELS[type] ?? type}`)
    .join(", ");
  return [
    `Commit changeset "${changeset.name}" to the base model?`,
    "",
    ...warnings.flatMap((warning) => [warning, ""]),
    `Intent: ${changeset.description?.trim() || "(no description)"}`,
    `Changes: ${changeset.changes.length} (${counts})`,
    `Layers: ${layers.join(", ") || "none"}`,
    ...driftLines(drift, hash, forced),
    preExistingErrors > 0
      ? `Validation: passed. ${preExistingErrors} error(s) already in the base model are not counted.`
      : "Validation: passed.",
    "",
    "Committing writes these changes to the base model and marks the changeset committed.",
  ].join("\n");
}

/**
 * A fingerprint of what the person confirms: the changeset's staged changes, its modified time and
 * status, and the base model's elements (the drift snapshot) and committed relationships.
 */
async function confirmedState(model: Model, changeset: Changeset): Promise<string> {
  return JSON.stringify({
    changes: (changeset.changes as StagedChange[]).map((c) => [c.sequenceNumber ?? null, c.type, c.elementId]),
    lastSequence: changeset.lastSequence ?? null,
    modified: changeset.modified,
    status: changeset.status,
    baseElements: await new BaseSnapshotManager().captureSnapshot(model),
    baseRelationships: model
      .getBaseRelationships()
      .map((r) => `${r.source}::${r.predicate}::${r.target}`)
      .sort(),
  });
}

function refusal(message: string, suggestions: string[]): CLIError {
  return new CLIError(message, ErrorCategory.USER, suggestions, { operation: "changeset_commit" });
}

/** Wraps a StagingAreaManager error (plain Error) so the agent sees what blocked the commit. */
function commitError(error: unknown, name: string): CLIError {
  if (error instanceof CLIError) return error;
  const message = getErrorMessage(error);
  if (message.includes("drifted")) {
    return new CLIError(`Changeset '${name}' was not committed: ${message.replace(/Use --force/, "Pass force: true")}`, ErrorCategory.USER, [
      'Read the drift with "changeset_brief" and tell the user what changed in the base',
      "If they still want it landed, call changeset_commit again with force: true",
    ]);
  }
  if (message.startsWith("Validation failed")) {
    return new CLIError(
      `Changeset '${name}' was not committed. ${message.replace(/, or skip validation with --no-validate\./, ".")}`,
      ErrorCategory.VALIDATION,
      ['Fix the plan (model_update, changeset_unstage, ...) and check it with "model_validate"']
    );
  }
  return new CLIError(`Changeset '${name}' was not committed: ${message}`, ErrorCategory.SYSTEM);
}

async function askForConfirmation(context: McpToolContext, message: string): Promise<ElicitResult> {
  return context.server!.elicitInput(
    {
      mode: "form",
      message,
      requestedSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            title: "Commit this changeset",
            description: "Write the staged changes to the base model.",
            default: false,
          },
        },
        required: ["confirm"],
      },
    },
    { relatedRequestId: context.requestId, signal: context.signal, timeout: CONFIRMATION_TIMEOUT_MS }
  );
}

export async function changesetCommitHandler(
  args: ChangesetCommitArgs,
  context?: McpToolContext
): Promise<CallToolResult> {
  return runTool(async () => {
    if (isChangesetOnly()) {
      throw refusal(
        `This session can't commit a changeset: it is in changeset-only mode (${CHANGESET_ONLY_ENV}), ` +
          "where no person can confirm the commit.",
        ["Tell the user the changeset is ready to land", ...otherWaysToLand()]
      );
    }

    // The cached model names the project; the commit runs on a fresh read, like the viewer's.
    const rootPath = (await loadModel(args.rootPath)).rootPath;
    let model = await Model.load(rootPath, { lazyLoad: false });
    let manager = new StagingAreaManager(model.rootPath, model);
    const changeset = await resolveChangeset(manager, args.changeset, "changeset");
    if (changeset.status !== "staged") {
      throw new CLIError(`Changeset '${changeset.name}' is ${changeset.status}; only a staged changeset can be committed`, ErrorCategory.USER, [
        'Use "changeset_list" to find a staged changeset',
      ]);
    }
    if (changeset.changes.length === 0) {
      return jsonResult({ id: changeset.id, name: changeset.name, status: "nothing-to-commit", stagedChanges: 0 });
    }

    const server = context?.server;
    if (!server?.getClientCapabilities()?.elicitation?.form) {
      throw refusal(
        `Changeset '${changeset.name}' was not committed: committing needs a person to confirm it, and this client ` +
          "can't show a confirmation dialog (it does not support MCP elicitation).",
        otherWaysToLand()
      );
    }

    // Check drift and validation before asking, so the person never confirms a commit that would fail.
    const hash = await manager.detectDrift(changeset.id);
    let drift: ChangesetDrift | undefined;
    try {
      drift = await describeDrift(model, await ChangesetGraph.build(model, changeset), hash);
    } catch (error) {
      console.error(`[mcp] changeset_commit could not describe drift: ${getErrorMessage(error)}`);
    }
    if (hash.isDrifted && args.force !== true) {
      // The CLI's rule: a drifted changeset needs --force. Say what drifted so the person can decide.
      throw new CLIError(
        `Changeset '${changeset.name}' was not committed: the base model changed since it was created.\n` +
          driftLines(drift, hash, false).slice(1).join("\n"),
        ErrorCategory.USER,
        [
          'Read the drift with "changeset_brief" and tell the user what changed in the base',
          "If they still want it landed, call changeset_commit again with force: true; the dialog will show the drift",
        ],
        { operation: "changeset_commit" }
      );
    }
    let preExistingErrors = 0;
    try {
      const dryRun = await manager.commit(model, changeset.id, { dryRun: true, validate: true, force: args.force === true });
      preExistingErrors = dryRun.validation.preExistingErrors ?? 0;
    } catch (error) {
      throw commitError(error, changeset.name);
    }

    // An as-built changeset landing while the plan is staged: the plan should land instead.
    const warnings: string[] = [];
    const asBuiltFirst = await asBuiltFirstWarning(manager, rootPath, changeset);
    if (asBuiltFirst) warnings.push(asBuiltFirst);

    // What the person is shown; checked again after they answer.
    const shown = await confirmedState(model, changeset);
    let answer: ElicitResult;
    try {
      answer = await askForConfirmation(
        context!,
        confirmationMessage(changeset, drift, hash, preExistingErrors, args.force === true, warnings)
      );
    } catch (error) {
      throw refusal(
        `Changeset '${changeset.name}' was not committed: the confirmation could not be shown (${getErrorMessage(error)}).`,
        otherWaysToLand()
      );
    }
    if (answer.action !== "accept" || answer.content?.confirm !== true) {
      const how = answer.action === "accept" ? "did not confirm it" : answer.action === "decline" ? "declined" : "cancelled";
      throw refusal(`Changeset '${changeset.name}' was not committed: the user ${how}. Nothing was written.`, [
        "Ask the user what should change before landing it, or leave it staged",
      ]);
    }

    // The person may have taken a while. Commit only what they saw: re-read the changeset and the
    // base, and refuse if either changed. The commit itself checks drift and validation again.
    model = await Model.load(rootPath, { lazyLoad: false });
    manager = new StagingAreaManager(model.rootPath, model);
    const current = await manager.load(changeset.id);
    if (!current || (await confirmedState(model, current)) !== shown) {
      throw refusal(
        `Changeset '${changeset.name}' was not committed: the changeset or the base model changed while the user ` +
          "was confirming. Nothing was written.",
        ['Show the user the changeset as it is now ("changeset_brief"), then ask again with changeset_commit']
      );
    }
    let result;
    try {
      result = await manager.commit(model, changeset.id, { validate: true, force: args.force === true });
    } catch (error) {
      throw commitError(error, changeset.name);
    }
    await reloadModel(args.rootPath);
    if (result.deactivationError) {
      warnings.push(
        `The changeset was committed but is still the active changeset (${result.deactivationError}): reads ` +
          "still project it and writes still stage into it. Deactivate it with changeset_deactivate."
      );
    }

    return jsonResult({
      id: changeset.id,
      name: changeset.name,
      status: "committed",
      committed: result.committed,
      skipped: result.skipped ?? 0,
      ...(result.skippedDetails?.length ? { skippedDetails: result.skippedDetails.slice(0, 10) } : {}),
      failed: result.failed,
      preExistingErrors: result.validation.preExistingErrors ?? 0,
      deactivated: result.deactivated,
      // StagingAreaManager.commit reports driftWarning only on a dry run, so use the check made above.
      ...(result.driftWarning || hash.isDrifted ? { driftOverridden: true } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      // Only an as-built landing reconciles the model with the code (code drift in project_status).
      ...(result.reconciled
        ? {
            reconciled: result.reconciled,
            codeDrift:
              "This as-built landing reconciles the model with the code: once documentation-robotics/ is committed, " +
              "project_status counts code drift from that commit.",
          }
        : {
            codeDrift:
              "Landing a plan doesn't reconcile the model with the code: project_status still counts code drift from " +
              "the last as-built landing (a bootstrap or a keep-as-built changeset from codebase_extract).",
          }),
    });
  });
}

export const changesetCommitTool: McpToolDefinition<typeof inputSchema> = {
  name: "changeset_commit",
  description:
    "Land a staged changeset: write its changes to the base model and mark it committed. Only after a person " +
    "confirms it: the server asks the user in a confirmation dialog (MCP elicitation) showing the changeset's " +
    "intent, counts, layers and drift, and commits only if they confirm. Refused when the client can't show the " +
    "dialog, when the user declines or cancels, and in changeset-only sessions. Validation errors the changeset " +
    "introduces block it; drift blocks it unless force is passed. Call it only when the user asks to land the change.",
  inputSchema,
  _meta: { "anthropic/requiresUserInteraction": true },
  handler: changesetCommitHandler,
};
