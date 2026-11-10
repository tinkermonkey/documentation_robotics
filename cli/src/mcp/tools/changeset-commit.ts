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
 * unless `force` is passed. Both are checked with a dry run before the person is asked, so they are
 * never asked to confirm a commit that would fail.
 */

import { z } from "zod";
import type { CallToolResult, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { Model } from "../../core/model.js";
import type { Changeset } from "../../core/changeset.js";
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

/** How long the person has to answer the confirmation dialog before the commit is refused. */
export const CONFIRMATION_TIMEOUT_MS = 10 * 60_000;

const OTHER_WAYS_TO_LAND = [
  "Ask the user to commit it in the viewer (`dr visualize`, Apply on the changeset)",
  "Or ask them to run `dr changeset activate <name>` then `dr changeset commit` in a terminal",
];

const inputSchema = {
  changeset: z
    .string()
    .min(1)
    .describe("Changeset ID or name to commit. Required: it need not be the active changeset."),
  force: z
    .boolean()
    .optional()
    .describe(
      "Commit even though the base model changed since the changeset was created (drift), like " +
        "`dr changeset commit --force`. The confirmation dialog shows the drift. Validation still blocks."
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

/** The text of the confirmation dialog. */
export function confirmationMessage(
  changeset: Changeset,
  drift: ChangesetDrift | undefined,
  hash: DriftReport,
  preExistingErrors: number,
  forced: boolean
): string {
  const { byOperation, layers } = summarizeChangeset(changeset);
  const counts = Object.entries(byOperation)
    .map(([type, n]) => `${n} ${OPERATION_LABELS[type] ?? type}`)
    .join(", ");
  return [
    `Commit changeset "${changeset.name}" to the base model?`,
    "",
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

function refusal(message: string, suggestions: string[] = OTHER_WAYS_TO_LAND): CLIError {
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
        ["Tell the user the changeset is ready to land", ...OTHER_WAYS_TO_LAND]
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
          "can't show a confirmation dialog (it does not support MCP elicitation)."
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

    let answer: ElicitResult;
    try {
      answer = await askForConfirmation(context!, confirmationMessage(changeset, drift, hash, preExistingErrors, args.force === true));
    } catch (error) {
      throw refusal(`Changeset '${changeset.name}' was not committed: the confirmation could not be shown (${getErrorMessage(error)}).`);
    }
    if (answer.action !== "accept" || answer.content?.confirm !== true) {
      const how = answer.action === "accept" ? "did not confirm it" : answer.action === "decline" ? "declined" : "cancelled";
      throw refusal(`Changeset '${changeset.name}' was not committed: the user ${how}. Nothing was written.`, [
        "Ask the user what should change before landing it, or leave it staged",
      ]);
    }

    // The person may have taken a while: commit on a fresh read, which checks drift and validation again.
    model = await Model.load(rootPath, { lazyLoad: false });
    manager = new StagingAreaManager(model.rootPath, model);
    const wasActive = (await manager.getActiveId()) === changeset.id;
    let result;
    try {
      result = await manager.commit(model, changeset.id, { validate: true, force: args.force === true });
    } catch (error) {
      throw commitError(error, changeset.name);
    }
    if (wasActive) await manager.clearActive();
    await reloadModel(args.rootPath);

    return jsonResult({
      id: changeset.id,
      name: changeset.name,
      status: "committed",
      committed: result.committed,
      skipped: result.skipped ?? 0,
      ...(result.skippedDetails?.length ? { skippedDetails: result.skippedDetails.slice(0, 10) } : {}),
      failed: result.failed,
      preExistingErrors: result.validation.preExistingErrors ?? 0,
      deactivated: wasActive,
      // StagingAreaManager.commit reports driftWarning only on a dry run, so use the check made above.
      ...(result.driftWarning || hash.isDrifted ? { driftOverridden: true } : {}),
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
