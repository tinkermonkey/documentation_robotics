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
 * | `reconcile`    | codebase_extract with `since` and no plan active    | Lands; reconciles code drift             |
 * | `verification` | codebase_extract with `since` while a plan is active | Never lands: compared with the plan, then kept as a record (it stays staged and is committed to git with the plan) or discarded |
 * | `upgrade-record` | `dr upgrade`, project_upgrade (upgrade-drop-record.ts) | Never lands: lists the relationships a spec migration dropped, to review and restore from by hand, then discarded |
 *
 * The purpose is declared when the changeset is made, in its `metadata.yaml` (committed with the
 * changeset, unlike the extraction record in the gitignored `.dr/`). A verification record also
 * carries the plan it verifies (`verifies`, the plan's changeset id) and its scope (`since` and the
 * code commit extraction read). A changeset made before purposes were declared has its purpose
 * inferred from what was recorded then: the extraction record or the description codebase_extract
 * writes (extractionOrigin), and `origin.kind`. `purposeOf` is the one place that answers.
 *
 * The extraction record is read here too (extractionOrigin), so StagingAreaManager.commit, which
 * the CLI, the MCP tool and the viewer's Apply share, can tell without importing the MCP layer.
 */

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
}

/** The record's fields, read leniently. */
function originOf(record: ExtractionRecordFile): Omit<ExtractionOrigin, "asBuilt"> {
  const previous = record.previousActive as { id?: unknown; name?: unknown } | null | undefined;
  return {
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
export function extractionPurpose(run: { since?: string | null; gitHead?: string | null; previousActive?: { id: string } | null }): PurposeDeclaration {
  if (run.since && run.previousActive) {
    return {
      purpose: "verification",
      verifies: run.previousActive.id,
      scope: { since: run.since, ...(run.gitHead ? { codeCommit: run.gitHead } : {}) },
    };
  }
  return { purpose: run.since ? "reconcile" : "bootstrap" };
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
    return { ...extractionPurpose({ since, gitHead: origin.gitHead, previousActive: origin.previousActive }), declared: false };
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
        "Keep this record (it stays staged and is committed to git with the plan) or discard it",
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
