/**
 * changeset_commit — land a staged changeset in the base model, once a person confirms it.
 *
 * Landing is the human's step (motivation.requirement.landing-a-change-needs-a-humans-confirmation),
 * so the tool is gated twice:
 * - It is listed with `_meta["anthropic/requiresUserInteraction"]`. Claude Code then shows a
 *   permission prompt on every call, whatever the permission mode.
 * Then one of these confirms it:
 * - It asks the client for confirmation (`elicitation/create`), showing the changeset's name,
 *   intent, counts by operation, the layers it touches and any drift. It commits only on `accept`
 *   with `confirm: true`. A decline, a cancel, a client without form elicitation, or a
 *   changeset-only session (DrBot, where no person can answer) is refused, and nothing is written.
 *   A dialog can come back unanswered by any person: a client that can't show it declines or
 *   cancels for them (at once in print mode; later when the person follows over Remote Control,
 *   #1207). So no refusal claims more than the tool knows: a cancel reads "no confirmation came
 *   back", a decline says it may have been the client's, and both name the routes below.
 * - Or, from a client that forces the permission prompt (Claude Code), it takes a confirmToken
 *   from changeset_commit_preview instead of the dialog. The preview returns the same summary and
 *   a token bound to the changeset and the base as previewed; the agent shows the person the
 *   summary and they approve the commit call in the prompt. This lands from the Claude desktop
 *   app and over Remote Control, where the dialog does not reach the person. Any change since the
 *   preview, an expired or reused token, or a token from another client is refused.
 * Whatever the route, the last step is one only the person takes: the dialog, the permission
 * prompt, or Apply in the viewer. Nothing here lets the agent approve its own landing.
 *
 * The commit itself is `StagingAreaManager.commit`, the code `dr changeset commit` and the viewer's
 * Apply (`POST /api/changesets/:id/commit`) run. Like the viewer, it works on a freshly loaded model
 * and may commit any staged changeset, active or not. It validates (errors the changeset introduces
 * block; the base model's own are counted). Drift does not refuse it (#1200): the summary the
 * person confirms lists each staged change the base overlaps with what landing does about it, and
 * the result repeats it. `force` is accepted and ignored. Landing an as-built changeset from
 * codebase_extract while a plan is staged is allowed, but the dialog warns that the plan should
 * land instead. Validation is checked with a dry run before the person is asked, so they are never
 * asked to confirm a commit that would fail. After they accept, the changeset and the base are
 * read again and compared with what the dialog showed; any change refuses the commit.
 *
 * Only a bootstrap or reconcile landing (a changeset codebase_extract staged from the whole code,
 * or from a branch's changes with no plan active) reconciles the model with the code:
 * StagingAreaManager.commit stamps the manifest's `reconciled` block for it, and the result carries
 * the stamp. A plan's landing doesn't (see core/reconciliation.ts). A plan's verification record is
 * refused here and in the preview: it is never landed (core/changeset-purpose.ts).
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { CallToolResult, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { Model } from "../../core/model.js";
import type { Changeset, StagedChange } from "../../core/changeset.js";
import { BaseSnapshotManager } from "../../core/base-snapshot-manager.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import {
  describeDrift,
  describedAsDrifted,
  overlapKinds,
  type ChangesetDrift,
  type OverlapKind,
} from "../../core/changeset-base-index.js";
import { StagingAreaManager, type DriftReport } from "../../core/staging-area.js";
import { isChangesetOnly, CHANGESET_ONLY_ENV } from "../../core/changeset-only-guard.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
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
import { isExtractionChangeset } from "./codebase-extract.js";

/** How long the person has to answer the confirmation dialog before the commit is refused. */
export const CONFIRMATION_TIMEOUT_MS = 10 * 60_000;

/**
 * How long a confirmation token from changeset_commit_preview is good for by default: an hour.
 * Long enough for the person's answer to come back through another session, which ten minutes was
 * not (the agent had to preview again before each landing); short enough that a summary read
 * yesterday can't land today. It is one setting (`confirmationTiming.tokenTtlMs`), and the tool
 * descriptions state it. Whatever its length, the token is bound to the changeset and the base as
 * previewed, so anything that changes meanwhile refuses it, and the person still approves the
 * commit call itself in the permission prompt.
 */
export const CONFIRM_TOKEN_TTL_MS = 60 * 60_000;

/**
 * How many overlaps of one kind the landing summary names by default. A display default, not a
 * cut-off on what is known: the summary always gives the true count of every kind and what landing
 * does about it, says how many it did not name, and names the call that lists them all. The
 * commit's result names every overlap.
 */
export const OVERLAPS_NAMED_PER_KIND = 10;

/**
 * How the user can land the changeset without this tool: the viewer, or an interactive session.
 * Never the CLI: the developer types no dr command (round 3 found agents passing it on).
 */
export function otherWaysToLand(): string[] {
  return [
    "Ask the user to commit it in the viewer: call review_open, give them its url, and they press Apply on the " +
      "changeset (Apply lands a drifted changeset too)",
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
      "Deprecated and ignored: drift no longer refuses a commit, so there is nothing to force. The confirmation " +
        "shows what the base overlaps and what landing does about it."
    ),
  confirmToken: z
    .string()
    .min(1)
    .optional()
    .describe(
      "From Claude Code only: the confirmToken changeset_commit_preview returned, after the user read its summary. " +
        "It replaces the confirmation dialog; the user approves this call in the permission prompt instead. Good for " +
        "an hour, and only for the changeset and base as previewed."
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

/** The text of the confirmation dialog. */
export function confirmationMessage(
  changeset: Changeset,
  drift: ChangesetDrift | undefined,
  hash: DriftReport,
  preExistingErrors: number,
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
    ...driftLines(drift, hash, changeset.name),
    preExistingErrors > 0
      ? `Validation: passed. ${preExistingErrors} error(s) already in the base model are not counted.`
      : "Validation: passed.",
    "",
    "Committing writes these changes to the base model and marks the changeset committed.",
  ].join("\n");
}

/**
 * A fingerprint of what the person confirms: the changeset's staged changes, its modified time and
 * status, and the base model's manifest, elements as stored (the full snapshot: any change to the
 * model files counts here, not only content) and committed relationships.
 */
async function confirmedState(model: Model, changeset: Changeset): Promise<string> {
  return JSON.stringify({
    changes: (changeset.changes as StagedChange[]).map((c) => [c.sequenceNumber ?? null, c.type, c.elementId]),
    lastSequence: changeset.lastSequence ?? null,
    modified: changeset.modified,
    status: changeset.status,
    baseElements: await new BaseSnapshotManager().captureFullSnapshot(model),
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
 * MCP clients that ask the person before every changeset_commit call, because the tool is listed
 * with `_meta["anthropic/requiresUserInteraction"]`: the name they send in `initialize`, and the
 * first version that honours the flag. From these, a confirmation token from
 * changeset_commit_preview stands in for the dialog: the person reads the preview's summary in the
 * conversation and approves the commit call in the permission prompt. Claude Code (v2.1.199 and
 * later) forces that prompt in every permission mode, bypassPermissions included, and denies the
 * call where no prompt can be shown (dontAsk, a non-interactive run without a prompt callback). An
 * Agent SDK host such as the Claude desktop app gets the prompt through its canUseTool callback.
 */
export const CLIENTS_THAT_ASK_BEFORE_EACH_CALL: ReadonlyMap<string, readonly number[]> = new Map([
  ["claude-code", [2, 1, 199]],
]);

/** Whether the connected client asks the person before each changeset_commit call. */
export function asksBeforeEachCall(server: McpToolContext["server"]): boolean {
  const info = server?.getClientVersion();
  const minimum = info?.name ? CLIENTS_THAT_ASK_BEFORE_EACH_CALL.get(info.name.toLowerCase()) : undefined;
  if (!minimum) return false;
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(info?.version ?? "");
  if (!version) return false;
  const parts = version.slice(1).map(Number);
  for (let i = 0; i < minimum.length; i++) {
    if (parts[i] !== minimum[i]) return parts[i] > minimum[i];
  }
  return true;
}

/**
 * Timings, as an object so tests can change them.
 * - instantDeclineMs: a decline or cancel this soon after the dialog was sent came from the client,
 *   not a person (Claude Code in print mode, as in the Claude desktop app, declines every dialog at
 *   once while still advertising it can show one).
 * - tokenTtlMs: how long a confirmation token from changeset_commit_preview is good for.
 */
export const confirmationTiming = { instantDeclineMs: 1_000, tokenTtlMs: CONFIRM_TOKEN_TTL_MS };

/** Keys the confirmation tokens: one per server process, so a token only works where it was issued. */
const TOKEN_KEY = randomBytes(32);
/**
 * Digests of tokens already used to land a changeset, each lands at most once, with their expiry.
 * Keyed by digest, which the HMAC makes unique to its changeset, expiry and state. An entry
 * is dropped once its token has expired, since an expired token is refused anyway.
 */
const usedTokens = new Map<string, number>();

function tokenDigest(changesetId: string, expires: number, state: string): string {
  const stateHash = createHash("sha256").update(state).digest("hex");
  return createHmac("sha256", TOKEN_KEY)
    .update(JSON.stringify([changesetId, expires, stateHash]))
    .digest("base64url");
}

/**
 * A confirmation token for landing this changeset as it is now: bound to its id and the confirmed
 * state (the changeset's staged changes and the base model), and good until it expires. Not a
 * secret from the person: it proves only that a preview of this exact state was made in this
 * server process. It binds no force flag: drift does not refuse a landing, and the summary the
 * person read lists what the base overlaps.
 */
export function issueConfirmToken(
  changesetId: string,
  state: string,
  now = Date.now()
): { token: string; expiresAt: string } {
  const expires = now + confirmationTiming.tokenTtlMs;
  return {
    token: `${expires.toString(36)}.${tokenDigest(changesetId, expires, state)}`,
    expiresAt: new Date(expires).toISOString(),
  };
}

export type TokenCheck = "ok" | "malformed" | "expired" | "used" | "mismatch";

/** Checks a token against the changeset as it is now; "ok" marks it used. */
export function checkConfirmToken(
  token: string,
  changesetId: string,
  state: string,
  now = Date.now()
): TokenCheck {
  const [expiresPart, digest, ...rest] = token.split(".");
  const expires = /^[0-9a-z]+$/.test(expiresPart ?? "") ? parseInt(expiresPart, 36) : NaN;
  // Only the encoding issueConfirmToken writes: another spelling of the same expiry is not a new token.
  if (!digest || rest.length > 0 || !Number.isSafeInteger(expires) || expires.toString(36) !== expiresPart) {
    return "malformed";
  }
  for (const [used, until] of usedTokens) if (now > until) usedTokens.delete(used);
  if (usedTokens.has(digest)) return "used";
  if (now > expires) return "expired";
  const expected = Buffer.from(tokenDigest(changesetId, expires, state));
  const given = Buffer.from(digest);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "mismatch";
  usedTokens.set(digest, expires);
  return "ok";
}

/** The token's lifetime in words, from the setting, for the texts that state it. */
function tokenLifetime(): string {
  const minutes = Math.round(confirmationTiming.tokenTtlMs / 60_000);
  if (minutes % 60 === 0) return minutes === 60 ? "an hour" : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** Why a token was refused, for the agent to pass on. */
function tokenRefusal(name: string, check: Exclude<TokenCheck, "ok">): CLIError {
  const why: Record<Exclude<TokenCheck, "ok">, string> = {
    malformed: "the confirmToken is not one changeset_commit_preview issued",
    expired:
      `the confirmToken expired (a token is good for ${tokenLifetime()}); the user did not decline, the preview they ` +
      "read is too old to land on",
    used: "the confirmToken was already used",
    mismatch:
      "the changeset or the base model changed since the preview the user approved (or the token is from another " +
      "changeset or another server process, such as one restarted since)",
  };
  return refusal(`Changeset '${name}' was not committed: ${why[check]}. Nothing was written.`, [
    "Call changeset_commit_preview again, show the user its summary, and ask whether to land the changeset as it is now",
  ]);
}

/** The ways to land when the dialog can't be used: the preview and token first, from Claude Code. */
function landingRoutes(server: McpToolContext["server"]): string[] {
  return [
    ...(asksBeforeEachCall(server)
      ? [
          "Call changeset_commit_preview, show the user its summary, then call changeset_commit with its confirmToken; " +
            "the user approves that call in Claude Code's permission prompt",
        ]
      : []),
    ...otherWaysToLand(),
  ];
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

/** A staged changeset with something to land, and whether its base drifted. */
interface LandingTarget {
  rootPath: string;
  model: Model;
  manager: StagingAreaManager;
  changeset: Changeset;
  hash: DriftReport;
}

/** What the person confirms: the landing checked by a dry run, and its summary. */
interface LandingSummary {
  warnings: string[];
  /** What the person confirms (confirmedState), checked again when it lands. */
  state: string;
  /** The landing summary: the dialog's text and the preview's summary. */
  message: string;
  /** The overlaps the summary reports: how many there are, and how many of them it names. */
  overlaps: { total: number; named: number };
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

/** An as-built changeset landing while the plan is staged: the plan should land instead. */
async function landingWarnings(target: LandingTarget): Promise<string[]> {
  const asBuiltFirst = await asBuiltFirstWarning(target.manager, target.rootPath, target.changeset);
  return asBuiltFirst ? [asBuiltFirst] : [];
}

/**
 * Finds the staged changeset to land and reads its drift, which never refuses the landing. Returns
 * a result instead when there is nothing to commit. Writes nothing.
 */
async function prepareLanding(
  args: { changeset: string; rootPath?: string }
): Promise<{ landing: LandingTarget } | { result: CallToolResult }> {
  // The cached model names the project; the commit runs on a fresh read, like the viewer's.
  const rootPath = (await loadModel(args.rootPath)).rootPath;
  const model = await Model.load(rootPath, { lazyLoad: false });
  const manager = new StagingAreaManager(model.rootPath, model);
  const changeset = await resolveChangeset(manager, args.changeset, "changeset");
  if (changeset.status !== "staged") {
    throw new CLIError(`Changeset '${changeset.name}' is ${changeset.status}; only a staged changeset can be committed`, ErrorCategory.USER, [
      'Use "changeset_list" to find a staged changeset',
    ]);
  }
  // A record (verification or upgrade) never lands (StagingAreaManager.commit refuses it too).
  const purposeRefusal = await manager.landingRefusal(changeset);
  if (purposeRefusal) throw purposeRefusal;
  if (changeset.changes.length === 0) {
    return { result: jsonResult({ id: changeset.id, name: changeset.name, status: "nothing-to-commit", stagedChanges: 0 }) };
  }

  const hash = await manager.detectDrift(changeset.id);
  return { landing: { rootPath, model, manager, changeset, hash } };
}

/**
 * Checks the landing with a dry run, so the person is never asked to confirm a commit that would
 * fail, and builds the summary they confirm. Writes nothing.
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
  return {
    warnings,
    // The whole changeset and the whole base, whatever part of the overlaps the summary names.
    state: await confirmedState(model, changeset),
    message: confirmationMessage(changeset, drift, hash, preExistingErrors, warnings),
    overlaps: { total, named },
  };
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

    const server = context?.server;
    const token = args.confirmToken;
    if (token !== undefined && !asksBeforeEachCall(server)) {
      // Only a client that asks the person before this call makes the token a person's confirmation.
      throw refusal(
        "A confirmToken stands in for the confirmation dialog only from a client that asks the person before " +
          "every changeset_commit call (Claude Code). This client confirms in the dialog. Nothing was written.",
        ["Call changeset_commit again without confirmToken; the user confirms in the dialog", ...otherWaysToLand()]
      );
    }

    if (token === undefined && !server?.getClientCapabilities()?.elicitation?.form) {
      // Before any landing checks: without the dialog or a token, no one can confirm it here.
      throw refusal(
        `Changeset '${args.changeset}' was not committed: committing needs a person to confirm it, and this client ` +
          "can't show a confirmation dialog (it does not support MCP elicitation).",
        landingRoutes(server)
      );
    }

    const prepared = await prepareLanding(args);
    if ("result" in prepared) return prepared.result;
    const target = prepared.landing;
    const { rootPath, changeset } = target;

    // How the landing state is checked under the write lock: against the token, or against what
    // the dialog showed.
    let confirmed: (state: string) => TokenCheck;
    let warnings: string[];
    if (token !== undefined) {
      // The preview already ran the dry run and showed the summary, and the token binds the state it
      // checked; the commit below validates again.
      warnings = await landingWarnings(target);
      confirmed = (state) => checkConfirmToken(token, changeset.id, state);
    } else {
      const summary = await summarizeLanding(target, "changeset_commit");
      warnings = summary.warnings;
      const askedAt = Date.now();
      let answer: ElicitResult;
      try {
        answer = await askForConfirmation(context!, summary.message);
      } catch (error) {
        throw refusal(
          `Changeset '${changeset.name}' was not committed: the confirmation could not be shown (${getErrorMessage(error)}).`,
          landingRoutes(server)
        );
      }
      if (answer.action !== "accept" && Date.now() - askedAt < confirmationTiming.instantDeclineMs) {
        // Too soon for a person to have read it: the client answered for them.
        throw refusal(
          `Changeset '${changeset.name}' was not committed: the confirmation dialog could not be shown. The client ` +
            `answered "${answer.action}" at once, before anyone could read it (Claude Code does this in print mode, ` +
            "as in the Claude desktop app). Nothing was written.",
          landingRoutes(server)
        );
      }
      if (answer.action === "cancel") {
        // No answer either way: the person closed it, or the client did without showing it (#1207).
        throw refusal(
          `Changeset '${changeset.name}' was not committed: no confirmation came back. The dialog was cancelled or ` +
            "closed without an answer, and may not have been shown to the user (it does not reach a person following " +
            "the session over Remote Control or in the Claude desktop app). Nothing was written.",
          ["Ask the user whether they saw a confirmation dialog. If they did not, use a route that needs none:", ...landingRoutes(server)]
        );
      }
      if (answer.action === "decline") {
        // A decline is the person's, or a client's that could not show the dialog: it looks the same
        // from here, so say both and name the routes that need no dialog (#1207, #1239).
        throw refusal(
          `Changeset '${changeset.name}' was not committed: the confirmation dialog came back declined. If the user ` +
            "did not decline it themselves, the client could not show it to them and answered for them. Nothing was written.",
          [
            "If the user declined, ask what should change before landing it, or leave it staged",
            "If they saw no dialog, use a route that needs none:",
            ...landingRoutes(server),
          ]
        );
      }
      if (answer.content?.confirm !== true) {
        throw refusal(
          `Changeset '${changeset.name}' was not committed: the user answered the dialog without confirming it. Nothing was written.`,
          ["Ask the user what should change before landing it, or leave it staged"]
        );
      }
      const shown = summary.state;
      confirmed = (state) => (state === shown ? "ok" : "mismatch");
    }

    // The person may have taken a while. Commit only what they saw: re-read the changeset and the
    // base, and refuse if either changed. The commit itself checks drift and validation again.
    // From that re-read through the landing, hold the project's write lock (not while the dialog is
    // open): no other tool's write lands between the check and the commit, and none saves a model
    // it read before the landing over it.
    const { result, model } = await withProjectWriteLock(rootPath, async () => {
      const model = await Model.load(rootPath, { lazyLoad: false });
      const manager = new StagingAreaManager(model.rootPath, model);
      const current = await manager.load(changeset.id);
      const check = current ? confirmed(await confirmedState(model, current)) : "mismatch";
      if (check !== "ok") {
        if (token !== undefined) throw tokenRefusal(changeset.name, check);
        throw refusal(
          `Changeset '${changeset.name}' was not committed: the changeset or the base model changed while the user ` +
            "was confirming. Nothing was written.",
          ['Show the user the changeset as it is now ("changeset_brief"), then ask again with changeset_commit']
        );
      }
      let landed;
      try {
        landed = await manager.commit(model, changeset.id, { validate: true });
      } catch (error) {
        throw commitError(error, changeset.name);
      }
      await reloadModel(args.rootPath);
      return { result: landed, model };
    });
    if (result.deactivationError) {
      warnings.push(
        `The changeset was committed, but its active-changeset marker could not be cleared (${result.deactivationError}). ` +
          "The marker is ignored, since a committed changeset is never the active one: reads show the base model and " +
          "writes go to it. Remove the marker with changeset_deactivate once the cause is fixed."
      );
    }

    if (args.force !== undefined) {
      warnings.push("force is deprecated and was ignored: drift does not refuse a landing, so there is nothing to force.");
    }
    // What the base overlapped when this landed, read by the commit before it applied the changes.
    // Every overlap is named: once it has landed, no other call can list them.
    const landedOver = result.driftDetail ? overlapKinds(result.driftDetail) : [];
    const overlapTotal = landedOver.reduce((n, kind) => n + kind.items.length, 0);

    return jsonResult({
      id: changeset.id,
      name: changeset.name,
      status: "committed",
      confirmedBy: token !== undefined ? "permission-prompt" : "dialog",
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
    });
  });
}

export const changesetCommitTool: McpToolDefinition<typeof inputSchema> = {
  name: "changeset_commit",
  description:
    "Land a staged changeset: write its changes to the base model and mark it committed. Only after a person " +
    "confirms it. By default the server asks the user in a confirmation dialog (MCP elicitation) showing the " +
    "changeset's intent, counts, layers and drift, and commits only if they confirm. From Claude Code, pass instead " +
    "the confirmToken from changeset_commit_preview, after showing the user its summary: they approve this call in " +
    "the permission prompt, which works where the dialog can't be shown (print mode, the Claude desktop app, a " +
    "session followed over Remote Control). Refused when no person can confirm, when the user declines or no " +
    "confirmation comes back, in changeset-only sessions, and when the changeset or base changed since the preview. " +
    "Validation errors the changeset introduces block it. Drift does not: a drifted changeset lands, and the " +
    "confirmation and the result say what the base overlapped and what landing did about it (force is ignored). " +
    "Call it only when the user asks to land the change.",
  inputSchema,
  _meta: { "anthropic/requiresUserInteraction": true },
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
  context?: McpToolContext
): Promise<CallToolResult> {
  return runTool(async () => {
    const prepared = await prepareLanding(args);
    if ("result" in prepared) return prepared.result;
    const { changeset, hash } = prepared.landing;
    const { state, message, overlaps } = await summarizeLanding(prepared.landing, "changeset_commit_preview");
    const base = {
      id: changeset.id,
      name: changeset.name,
      status: "ready-to-commit",
      // Drift is in the summary; it does not stop the landing.
      drifted: hash.isDrifted,
      summary: message,
      // The true count, and how many of them the summary names (every kind is in it either way).
      overlaps,
      ...(overlaps.named < overlaps.total
        ? {
            more:
              `The summary names ${overlaps.named} of the ${overlaps.total} overlaps. ${everyOverlapCall(changeset.name)} ` +
              "names every one: read them, and tell the user what the rest are, before they decide.",
          }
        : {}),
    };
    if (isChangesetOnly()) {
      return jsonResult({
        ...base,
        next: "This session can't commit (changeset-only mode). Tell the user it is ready; they land it in the viewer with Apply.",
      });
    }
    if (!asksBeforeEachCall(context?.server)) {
      return jsonResult({
        ...base,
        next:
          "When the user asks to land it, call changeset_commit without a token: they confirm it in the dialog. " +
          "A confirmToken is accepted only from Claude Code, which asks the person before each changeset_commit call.",
      });
    }
    const { token, expiresAt } = issueConfirmToken(changeset.id, state);
    return jsonResult({
      ...base,
      confirmToken: token,
      expiresAt,
      next:
        "Show the user the summary above, in full, its drift lines included. If they want it landed, call " +
        "changeset_commit with this changeset and this confirmToken; they approve that call in the permission prompt. " +
        "The token lands this changeset only as previewed: any change to it or to the base refuses it, and then you " +
        `preview again. Until then it is good for ${tokenLifetime()} (expiresAt); after that, preview again.`,
    });
  });
}

export const changesetCommitPreviewTool: McpToolDefinition<typeof previewInputSchema> = {
  name: "changeset_commit_preview",
  description:
    "Check a staged changeset for landing without writing anything: validation and the summary the person confirms " +
    "(intent, counts, layers, and drift: the true count of staged changes the base overlaps, and for every kind " +
    "of overlap what landing does about it; when a kind has many it names the first and says where the rest are). " +
    "Drift does not stop a landing. From Claude Code it also returns a confirmToken bound to the changeset and base " +
    "as they are now, good for an hour: show the user the summary, and if they want it landed, call changeset_commit " +
    "with the token, which they approve in the permission prompt. Use it to land from a client that can't show the " +
    "confirmation dialog (print mode, the Claude desktop app, a session followed over Remote Control).",
  inputSchema: previewInputSchema,
  handler: changesetCommitPreviewHandler,
};
