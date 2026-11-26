/**
 * What a changeset is for: its purpose, and the moves that purpose allows.
 *
 * `origin.kind` (changeset-review.ts) says who or what made a changeset. Its purpose says what it
 * is for, and so what may happen to it:
 *
 * | Purpose        | Made by                                             | Fate                                     |
 * | -------------- | --------------------------------------------------- | ---------------------------------------- |
 * | `plan`         | changeset_create, `dr changeset create`             | Lands with the code                      |
 * | `chat`         | DrBot (changeset_create or `dr` under `dr visualize`) | Lands after review                     |
 * | `bootstrap`    | codebase_extract without `since`                    | Lands; reconciles code drift             |
 * | `reconcile`    | codebase_extract with `since` equal to the manifest's reconciled commit, no plan active | Lands; reconciles code drift |
 * | `verification` | codebase_extract with `since` while a plan is active, or any `since` other than the reconciled commit (decideExtractionPurpose) | Never lands: compared with the plan, then kept as a record (staged until the plan lands, then `recorded`; committed to git with the plan) or discarded |
 * | `upgrade-record` | `dr upgrade`, project_upgrade (upgrade-drop-record.ts) | Never lands: lists the relationships a spec migration dropped, to review and restore from by hand, then discarded |
 *
 * The purpose is declared when the changeset is made, in its `metadata.yaml` (committed with the
 * changeset, unlike the extraction record in the gitignored `.dr/`). A verification record also
 * carries the plan it verifies (`verifies`, the plan's changeset id) and its scope (`since` and the
 * code commit extraction read). A changeset made before purposes were declared has its purpose
 * inferred from what was recorded then: the extraction record or the description codebase_extract
 * writes (extractionOrigin), and `origin.kind`. `purposeOf` is the one place that answers.
 *
 * A verification record's lifecycle: staged while its plan is, then `recorded` (a status, not a
 * purpose) when the plan lands (StagingAreaManager.recordVerificationsOf). A recorded record is
 * kept, committed to git with the plan, and no longer counts as staged work; discarding it stays
 * an explicit move. An older record whose plan landed before `recorded` existed stays staged.
 *
 * The extraction record is read here too (extractionOrigin), so StagingAreaManager.commit, which
 * the CLI, the MCP tool and the viewer's Apply share, can tell without importing the MCP layer.
 */

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChangesetOrigin } from "./changeset-review.js";
import { CLIError, ErrorCategory } from "../utils/errors.js";

export const CHANGESET_PURPOSES = ["plan", "bootstrap", "reconcile", "verification", "chat", "upgrade-record"] as const;
export type ChangesetPurpose = (typeof CHANGESET_PURPOSES)[number];

/**
 * The purposes that are records: a verification record (what was built, compared with a plan) and
 * an upgrade record (what a spec migration dropped). A record never lands, with force or without.
 */
export const RECORD_PURPOSES: readonly ChangesetPurpose[] = ["verification", "upgrade-record"];

/** Whether a changeset of this purpose is a record, which never lands. */
export function isRecordPurpose(purpose: ChangesetPurpose): boolean {
  return RECORD_PURPOSES.includes(purpose);
}

/** The purposes whose landing reconciles the model with the code (stamps `reconciled`). */
export const RECONCILING_PURPOSES: readonly ChangesetPurpose[] = ["bootstrap", "reconcile"];

/** What a verification record's extraction read: the files changed since `since`, at `codeCommit`. */
export interface VerificationScope {
  since: string;
  codeCommit?: string;
}

/** A purpose as declared in metadata.yaml. */
export interface PurposeDeclaration {
  purpose: ChangesetPurpose;
  /** For a verification record: the id of the plan changeset it verifies. */
  verifies?: string;
  /** For a verification record: what its extraction read. */
  scope?: VerificationScope;
}

/** A changeset's purpose: declared in its metadata, or inferred for one made before that. */
export interface ChangesetPurposeInfo extends PurposeDeclaration {
  declared: boolean;
}

/** A move from a changeset's current state, as the viewer and the tools offer it. */
export type ChangesetAction = "commit" | "discard";

/** The fields of a changeset purposeOf reads. */
export interface PurposeSubject {
  id?: string;
  name: string;
  description?: string;
  origin?: ChangesetOrigin;
  purpose?: ChangesetPurpose;
  verifies?: string;
  scope?: VerificationScope;
}

/** Reads a declaration from metadata.yaml's fields, or undefined when absent or malformed. */
export function readPurpose(metadata: unknown): PurposeDeclaration | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const { purpose, verifies, scope } = metadata as { purpose?: unknown; verifies?: unknown; scope?: unknown };
  if (typeof purpose !== "string" || !(CHANGESET_PURPOSES as readonly string[]).includes(purpose)) return undefined;
  const s = scope && typeof scope === "object" ? (scope as { since?: unknown; codeCommit?: unknown }) : undefined;
  return {
    purpose: purpose as ChangesetPurpose,
    ...(typeof verifies === "string" && verifies ? { verifies } : {}),
    ...(s && typeof s.since === "string" && s.since
      ? { scope: { since: s.since, ...(typeof s.codeCommit === "string" && s.codeCommit ? { codeCommit: s.codeCommit } : {}) } }
      : {}),
  };
}

/** The declaration's fields as metadata.yaml stores them (spread into the metadata object). */
export function purposeFields(declaration: PurposeDeclaration | undefined): Partial<PurposeDeclaration> {
  if (!declaration) return {};
  return {
    purpose: declaration.purpose,
    ...(declaration.verifies ? { verifies: declaration.verifies } : {}),
    ...(declaration.scope ? { scope: declaration.scope } : {}),
  };
}

/** The moves allowed from a changeset's state: a record (verification or upgrade) is never committed. */
export function allowedActions(purpose: ChangesetPurpose, status: string): ChangesetAction[] {
  if (status === "recorded") return ["discard"];
  if (status !== "staged") return [];
  return isRecordPurpose(purpose) ? ["discard"] : ["commit", "discard"];
}

// ---------------------------------------------------------------------------------------------
// The extraction record (.dr/analyzers/extract/<id>.json), which the inference reads.

/** The description codebase_extract gives the changesets it creates. */
export const EXTRACTION_MARKER = /Staged by codebase_extract/;

interface ExtractionRecordFile {
  changesetId?: unknown;
  changesetName?: unknown;
  gitHead?: unknown;
  pending?: unknown;
  since?: unknown;
  previousActive?: unknown;
  /** The purpose the run declared (decideExtractionPurpose), kept so the changeset made for it later declares the same. */
  purpose?: unknown;
  verifies?: unknown;
  uncommitted?: unknown;
}

/** What extractionOrigin reads about the changeset's extraction from its record. */
export interface ExtractionOrigin {
  asBuilt: boolean;
  /** The commit extraction read the code at. */
  gitHead?: string;
  /** The ref the extraction was scoped to (`since`), when it was. */
  since?: string;
  /** The changeset that was active when extraction started this one (a plan, for a verify). */
  previousActive?: { id: string; name: string };
  /** The purpose the run declared, when it recorded one (a run before #1370 did not). */
  declared?: PurposeDeclaration;
  /** Source files with uncommitted changes when the run read the code, with their content hashes: the model may describe code no commit holds (#1330). */
  uncommitted?: Record<string, string | null>;
}

/** The record's fields, read leniently. */
function originOf(record: ExtractionRecordFile): Omit<ExtractionOrigin, "asBuilt"> {
  const previous = record.previousActive as { id?: unknown; name?: unknown } | null | undefined;
  const declared = readPurpose({
    purpose: record.purpose,
    verifies: record.verifies,
    ...(typeof record.since === "string" && record.since
      ? { scope: { since: record.since, ...(typeof record.gitHead === "string" ? { codeCommit: record.gitHead } : {}) } }
      : {}),
  });
  return {
    ...(declared && EXTRACTION_PURPOSES.includes(declared.purpose) ? { declared } : {}),
    ...(record.uncommitted && typeof record.uncommitted === "object" && !Array.isArray(record.uncommitted) && Object.keys(record.uncommitted).length > 0
      ? { uncommitted: record.uncommitted as Record<string, string | null> }
      : {}),
    ...(typeof record.gitHead === "string" && record.gitHead ? { gitHead: record.gitHead } : {}),
    ...(typeof record.since === "string" && record.since ? { since: record.since } : {}),
    ...(previous && typeof previous === "object" && typeof previous.id === "string" && previous.id
      ? { previousActive: { id: previous.id, name: typeof previous.name === "string" ? previous.name : previous.id } }
      : {}),
  };
}

async function readRecord(file: string): Promise<ExtractionRecordFile | null> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as ExtractionRecordFile) : null;
  } catch {
    return null;
  }
}

/**
 * Whether codebase_extract staged this changeset, and what its record says about the run: the
 * commit it read the code at, the `since` ref it was scoped to and the changeset active before it.
 *
 * The same rule as `isExtractionChangeset` (cli/src/mcp/tools/codebase-extract.ts) plus the
 * description marker: its record (`.dr/analyzers/extract/<id>.json`), or the cards of a run that
 * staged nothing and are waiting for a changeset of this name (`pending.json`), or the description
 * codebase_extract writes.
 */
export async function extractionOrigin(
  projectRoot: string,
  changeset: { id?: string; name: string; description?: string }
): Promise<ExtractionOrigin> {
  const dir = path.join(projectRoot, ".dr", "analyzers", "extract");
  if (changeset.id) {
    const record = await readRecord(path.join(dir, `${changeset.id.replace(/[^\w.-]/g, "_")}.json`));
    if (record && !record.pending && record.changesetId === changeset.id) {
      return { asBuilt: true, ...originOf(record) };
    }
  }
  const pending = await readRecord(path.join(dir, "pending.json"));
  if (pending?.pending && pending.changesetName === changeset.name) {
    return { asBuilt: true, ...originOf(pending) };
  }
  return { asBuilt: EXTRACTION_MARKER.test(changeset.description ?? "") };
}

/**
 * Whether the extraction was a plan's verification: scoped with `since` while a plan was active
 * (`previousActive`). The same test as codebase_extract's verify mode. Such a record read only the
 * files changed since the base branch, to compare with the plan, so it doesn't reconcile the model
 * with the code. A `since` run with no plan active (project_status's drift catch-up) does.
 */
export function isVerificationRecord(origin: ExtractionOrigin): boolean {
  return !!origin.since && !!origin.previousActive;
}

/**
 * The purpose of an extraction run: `verification` when it was scoped with `since` while a plan
 * was active (it names the plan and its scope), `reconcile` when scoped with `since` alone, else
 * `bootstrap`.
 */
export function extractionPurpose(run: {
  since?: string | null;
  gitHead?: string | null;
  previousActive?: { id: string } | null;
  /** The purpose the run declared (decideExtractionPurpose): used as it is. */
  declared?: PurposeDeclaration;
}): PurposeDeclaration {
  if (run.declared) return run.declared;
  if (run.since && run.previousActive) {
    return {
      purpose: "verification",
      verifies: run.previousActive.id,
      scope: { since: run.since, ...(run.gitHead ? { codeCommit: run.gitHead } : {}) },
    };
  }
  return { purpose: run.since ? "reconcile" : "bootstrap" };
}

/** The purposes codebase_extract declares for the changesets it stages. */
const EXTRACTION_PURPOSES: readonly ChangesetPurpose[] = ["bootstrap", "reconcile", "verification"];

/** What an explicit `purpose` argument of codebase_extract may ask for (with `since`). */
export const EXTRACTION_PURPOSE_ARGS = ["reconcile", "verification"] as const;
export type ExtractionPurposeArg = (typeof EXTRACTION_PURPOSE_ARGS)[number];

/** The purpose codebase_extract declared for a run, and how it got there. */
export interface ExtractionPurposeDecision {
  declaration: PurposeDeclaration;
  /** One sentence for the result: the purpose, why, and for a verification record which plan it verifies or that it found none. */
  note: string;
}

/** The git commit `ref` names in `dir`, or undefined when it names none (or git is missing). */
export function resolveCommit(dir: string, ref: string): string | undefined {
  try {
    const r = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: dir, stdio: "pipe", encoding: "utf-8", timeout: 10_000 });
    return r.status === 0 ? r.stdout.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The purpose of a `since` run (#1370). An explicit `purpose` overrides the rule. Otherwise: with a
 * plan active the run is its verification record; with no plan active, a `since` that is the
 * manifest's reconciled code commit is a reconcile (the catch-up project_status asks for), and any
 * other `since` is a verification record (a branch's build, compared with its plan), naming the one
 * staged plan it verifies, or none when there is no plan or several (the note says so). A run with
 * no `since` is a bootstrap.
 *
 * `sinceCommit` is what `since` resolves to; `reconciledCommit` the manifest's `reconciled.code_commit`.
 * Either unknown means `since` is not known to be the reconciled commit, so the run is a verification record.
 */
export function decideExtractionPurpose(run: {
  since?: string | null;
  gitHead?: string | null;
  explicit?: ExtractionPurposeArg;
  previousActive?: { id: string; name: string } | null;
  sinceCommit?: string;
  reconciledCommit?: string;
  stagedPlans: Array<{ id: string; name: string }>;
}): ExtractionPurposeDecision {
  if (!run.since) return { declaration: { purpose: "bootstrap" }, note: "A bootstrap: it reads the whole code and reconciles the model with it when landed." };
  const scope = { since: run.since, ...(run.gitHead ? { codeCommit: run.gitHead } : {}) };
  const verification = (why: string): ExtractionPurposeDecision => {
    const plan = run.previousActive ?? (run.stagedPlans.length === 1 ? run.stagedPlans[0] : undefined);
    const planNote = plan
      ? `It verifies the plan '${plan.name}'${run.previousActive ? "" : " (the one plan staged; if this build is for another, call again with that plan active)"}.`
      : run.stagedPlans.length > 1
        ? `It found no one plan to verify (${run.stagedPlans.length} are staged: ${run.stagedPlans.map((p) => `'${p.name}'`).join(", ")}); it records what was built and verifies none.`
        : "It found no staged plan to verify; it records what was built and verifies none.";
    return {
      declaration: { purpose: "verification", ...(plan ? { verifies: plan.id } : {}), scope },
      note: `A verification record (${why}), never landed. ${planNote}`,
    };
  };
  if (run.explicit === "verification") return verification("purpose: verification was asked for");
  if (run.explicit === "reconcile") return { declaration: { purpose: "reconcile" }, note: "A reconcile (purpose: reconcile was asked for): landing it reconciles the model with the code it read." };
  if (run.previousActive) return verification(`a plan is active and since: ${run.since} scopes the run`);
  const reconciled =
    !!run.sinceCommit &&
    !!run.reconciledCommit &&
    (run.sinceCommit === run.reconciledCommit ||
      (run.reconciledCommit.length >= 7 && run.sinceCommit.startsWith(run.reconciledCommit)) ||
      (run.sinceCommit.length >= 7 && run.reconciledCommit.startsWith(run.sinceCommit)));
  if (reconciled) {
    return { declaration: { purpose: "reconcile" }, note: `A reconcile: since is the code commit the model was last reconciled with (${run.reconciledCommit!.slice(0, 7)}); landing it reconciles the model with the code.` };
  }
  return verification(
    run.reconciledCommit
      ? run.sinceCommit
        ? `since: ${run.since} is not the commit the model was last reconciled with, ${run.reconciledCommit.slice(0, 7)}`
        : `since: ${run.since} could not be resolved to a commit, so it is not known to be the one the model was last reconciled with, ${run.reconciledCommit.slice(0, 7)}`
      : `since: ${run.since} and the model has never been reconciled with the code`
  );
}

/**
 * A changeset's purpose: the one declared in its metadata, else inferred for a changeset made
 * before purposes were declared. Extraction's (its record, waiting cards under its name, or the
 * description codebase_extract writes) is a verification record, a reconcile or a bootstrap by the
 * run's `since` and the plan active then (isVerificationRecord); one DrBot made is `chat`; any
 * other is a `plan`.
 */
export async function purposeOf(projectRoot: string, changeset: PurposeSubject): Promise<ChangesetPurposeInfo> {
  if (changeset.purpose && (CHANGESET_PURPOSES as readonly string[]).includes(changeset.purpose)) {
    return {
      purpose: changeset.purpose,
      ...(changeset.verifies ? { verifies: changeset.verifies } : {}),
      ...(changeset.scope ? { scope: changeset.scope } : {}),
      declared: true,
    };
  }
  const origin = await extractionOrigin(projectRoot, changeset);
  if (origin.asBuilt || changeset.origin?.kind === "extract") {
    // Without a record, the description still says whether the run was scoped with since.
    const since = origin.since ?? /files changed since (.+)\. Staged by codebase_extract/.exec(changeset.description ?? "")?.[1];
    return { ...extractionPurpose({ since, gitHead: origin.gitHead, previousActive: origin.previousActive, declared: origin.declared }), declared: false };
  }
  return { purpose: changeset.origin?.kind === "chat" ? "chat" : "plan", declared: false };
}

/**
 * The purpose to declare for a changeset made now by `origin`'s kind of caller, unless the caller
 * declares one: the extraction's when waiting cards (pending.json) name it (codebase_extract staged
 * nothing and told the agent to create it), `chat` for DrBot, else `plan`.
 */
export async function creationPurpose(
  projectRoot: string,
  name: string,
  origin: ChangesetOrigin | undefined
): Promise<PurposeDeclaration> {
  const waiting = await extractionOrigin(projectRoot, { name });
  if (waiting.asBuilt) return extractionPurpose(waiting);
  if (origin?.kind === "extract") return { purpose: "bootstrap" };
  return { purpose: origin?.kind === "chat" ? "chat" : "plan" };
}

/**
 * The refusal to land a record (StagingAreaManager.commit, changeset_commit and its preview, the
 * viewer's Apply). Its message and suggestions name no CLI command or flag: the MCP tools and the
 * viewer show them as they are. The CLI adds its own suggestions.
 */
export class RecordLandingError extends CLIError {
  constructor(
    public readonly changesetName: string,
    message: string,
    suggestions: string[]
  ) {
    super(message, ErrorCategory.USER, suggestions, { operation: "commit" });
    this.name = "RecordLandingError";
  }

  /** The message with its suggestions, for surfaces that show one string (the viewer). */
  get fullText(): string {
    return [this.message, ...(this.suggestions ?? []).map((s) => `${s}.`)].join(" ");
  }
}

/** The refusal to land a verification record. */
export class VerificationRecordLandingError extends RecordLandingError {
  constructor(
    changesetName: string,
    public readonly plan: { id: string; name: string } | undefined
  ) {
    const planText = plan ? `plan '${plan.name}'` : "its plan";
    super(
      changesetName,
      `Changeset '${changesetName}' is a verification record: the record of what was built, compared with ` +
        `${planText}. A verification record is never landed.`,
      [
        plan ? `Land the plan '${plan.name}' instead` : "Land the plan it verifies instead",
        "Keep this record (landing the plan marks it recorded, and it is committed to git with the plan) or discard it",
        "To reconcile the model with code drift, extract without a plan active and land that changeset",
      ]
    );
    this.name = "VerificationRecordLandingError";
  }
}

/**
 * The refusal to land an upgrade record. Its staged deletes name relationships the migration
 * already removed, so landing it would change nothing, or would remove a relationship the user
 * has since added back.
 */
export class UpgradeRecordLandingError extends RecordLandingError {
  constructor(changesetName: string) {
    super(
      changesetName,
      `Changeset '${changesetName}' is an upgrade record: the list of relationships a spec migration dropped ` +
        "because the catalog has no replacement for their types. An upgrade record is never landed.",
      [
        "To restore a dropped relationship, add one of a type the catalog has now, in a changeset of your own; the record's description lists those types",
        "Keep this record while you still need it, then discard it",
      ]
    );
    this.name = "UpgradeRecordLandingError";
  }
}

/**
 * The refusal to make an upgrade record the active changeset (StagingAreaManager.setActive, so
 * `dr changeset activate`, changeset_activate and the viewer alike). Writes stage into the active
 * changeset, and a record never lands: whatever was staged into it would be stuck there.
 */
export class UpgradeRecordActivationError extends CLIError {
  constructor(public readonly changesetName: string) {
    super(
      `Changeset '${changesetName}' is an upgrade record: the list of relationships a spec migration dropped. ` +
        "It cannot be made active, because changes staged into it could never land.",
      ErrorCategory.USER,
      [
        "Read it without activating it; its description lists the relationship types the catalog still has",
        "Stage what you restore in a changeset of your own",
      ],
      { operation: "activate" }
    );
    this.name = "UpgradeRecordActivationError";
  }
}
