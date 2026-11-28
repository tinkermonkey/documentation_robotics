/**
 * Which landings reconcile the model with the code.
 *
 * Code drift (project_status `codeDrift`) is reconciled only by the landing of a changeset whose
 * purpose (changeset-purpose.ts) is `bootstrap` or `reconcile`: one `codebase_extract` staged from
 * the whole code, or from a branch's changes with no plan active. Landing a plan, or any other commit
 * that touches `documentation-robotics/`, doesn't reconcile it: a plan describes what was meant to be
 * built, and it was drawn before the code existed. A plan's verification record is never landed.
 *
 * When an as-built changeset lands, the commit stamps the model's manifest
 * (`documentation-robotics/model/manifest.yaml`, a CLI-owned file, not spec-governed) with a
 * `reconciled` block: the changeset's name and id, when it landed, and the code commit the
 * extraction read. Each as-built landing replaces it, and every other manifest save keeps it. The
 * stamp is committed with the model, so it survives a clone, a rebase or a squash merge; the drift
 * collector finds the git commit that brought in the current stamp by its changeset id
 * (`git log -S`), and counts drift from there.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReconciledStamp } from "../types/index.js";
import { extractionOrigin, purposeOf, RECONCILING_PURPOSES, type PurposeSubject } from "./changeset-purpose.js";

// The extraction record is read in changeset-purpose.ts, which decides a changeset's purpose from
// it; re-exported here for the callers that read it to tell an as-built changeset.
export { EXTRACTION_MARKER, extractionOrigin, isVerificationRecord, type ExtractionOrigin } from "./changeset-purpose.js";

/** HEAD of the git repository at `dir`, or null outside git. */
function gitHead(dir: string): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, stdio: "pipe", encoding: "utf-8", timeout: 10_000 });
    return result.status === 0 ? result.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

/** A hash of each file's content under `codeRoot`; null for one that is gone. */
export async function hashFiles(codeRoot: string, files: readonly string[]): Promise<Record<string, string | null>> {
  const hashes: Record<string, string | null> = {};
  for (const file of files) {
    try {
      hashes[file] = createHash("sha1").update(await readFile(path.join(codeRoot, file))).digest("hex");
    } catch {
      hashes[file] = null;
    }
  }
  return hashes;
}

/** Whether git reports no uncommitted change to `file` (null when git can't say). */
function isCommitted(codeRoot: string, file: string): boolean | null {
  try {
    const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=all", "--", file], { cwd: codeRoot, stdio: "pipe", encoding: "utf-8", timeout: 10_000 });
    return r.status === 0 ? r.stdout.trim() === "" : null;
  } catch {
    return null;
  }
}

/** Whether `ancestor` is an ancestor of (or is) `descendant` in the repository at `codeRoot`. */
function isAncestor(codeRoot: string, ancestor: string, descendant: string): boolean {
  try {
    return spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: codeRoot, stdio: "pipe", timeout: 10_000 }).status === 0;
  } catch {
    return false;
  }
}

/** Where the uncommitted files an extraction read stand now (#1330). */
export interface UncommittedCheck {
  /** Files still uncommitted, or that git could not check. */
  pending: string[];
  /** Files committed with other content than the extraction read (edited again, or reverted). */
  changed: string[];
  /** Source changed between the extraction's commit and HEAD that the extraction did not read. */
  others: string[];
  /** The commit the extraction read is no longer an ancestor of HEAD (amended, rebased away). */
  orphaned: boolean;
  /** Every file was committed as the extraction read it, and nothing else moved: HEAD holds that code. */
  settled: boolean;
  /** HEAD, when settled. */
  head?: string;
}

/** The files `git diff` lists between two commits, relative to `codeRoot`; null when git can't say. */
function changedBetween(codeRoot: string, from: string, to: string): string[] | null {
  try {
    const r = spawnSync("git", ["diff", "--name-only", "--no-renames", "-z", "--relative", from, to, "--"], { cwd: codeRoot, stdio: "pipe", encoding: "utf-8", timeout: 10_000 });
    return r.status === 0 ? r.stdout.split("\0").filter((f) => f.length > 0) : null;
  } catch {
    return null;
  }
}

/** The recorded value for a file the extraction could not have read (edited after the index): it never settles. */
export const UNREAD_EDIT = "unread-edit";

/**
 * Where the files an extraction read with uncommitted changes (`recorded`, with their content
 * hashes) stand now, and whether HEAD holds that code. It does only when each file is committed
 * with the content the extraction read, the extraction's commit is an ancestor of HEAD, and no
 * other file changed between them (a pull or a merge brings code the extraction did not read).
 * Changes under DR's own folders don't count.
 */
export async function checkUncommitted(codeRoot: string, recorded: Readonly<Record<string, string | null>>, readAt?: string): Promise<UncommittedCheck> {
  const files = Object.keys(recorded);
  const now = await hashFiles(codeRoot, files);
  const pending: string[] = [];
  const changed: string[] = [];
  for (const file of files) {
    if (isCommitted(codeRoot, file) !== true) pending.push(file);
    else if (recorded[file] === UNREAD_EDIT || now[file] !== recorded[file]) changed.push(file);
  }
  const head = gitHead(codeRoot) ?? undefined;
  let orphaned = false;
  let others: string[] = [];
  if (readAt && head && head !== readAt) {
    if (!isAncestor(codeRoot, readAt, head)) orphaned = true;
    else {
      const between = changedBetween(codeRoot, readAt, head);
      const known = new Set(files);
      others = (between ?? []).filter((f) => !known.has(f) && !f.split("/").some((seg) => seg === "documentation-robotics" || seg === ".dr"));
      if (between === null) orphaned = true;
    }
  }
  const settled = files.length > 0 && pending.length === 0 && changed.length === 0 && !orphaned && others.length === 0;
  return { pending, changed, others, orphaned, settled, ...(settled && head ? { head } : {}) };
}

/**
 * The stamp a reconciling landing writes, or null when the changeset's purpose (purposeOf) is not
 * `bootstrap` or `reconcile`: a plan, a chat changeset, or a plan's verification record. For a
 * changeset made before purposes were declared, the purpose is inferred from its extraction record
 * as before (isVerificationRecord). `code_commit` is the commit extraction read, else HEAD of the
 * code at landing time, else left out.
 */
export async function reconciliationStamp(
  projectRoot: string,
  changeset: PurposeSubject,
  codeRoot: string = projectRoot,
  landedAt: string = new Date().toISOString()
): Promise<ReconciledStamp | null> {
  if (!changeset.id) return null;
  const { purpose } = await purposeOf(projectRoot, changeset);
  if (!RECONCILING_PURPOSES.includes(purpose)) return null;
  const origin = await extractionOrigin(projectRoot, changeset);
  let codeCommit = origin.gitHead ?? gitHead(codeRoot) ?? undefined;
  // The extraction read uncommitted code (#1330). Once every such file is committed as it was read and
  // nothing else moved, HEAD holds the code the model was built from, and the stamp is that HEAD.
  if (origin.uncommitted && Object.keys(origin.uncommitted).length > 0 && codeCommit) {
    const check = await checkUncommitted(codeRoot, origin.uncommitted, codeCommit);
    if (check.settled && check.head) codeCommit = check.head;
  }
  return {
    changeset: changeset.name,
    changeset_id: changeset.id,
    landed_at: landedAt,
    ...(codeCommit ? { code_commit: codeCommit } : {}),
  };
}

/**
 * Whether the changeset may land with no staged changes: a reconcile or bootstrap, whose landing
 * is the record that the model matches the code it read (#1331). Any other purpose has nothing to land.
 */
export async function landsEmpty(projectRoot: string, changeset: PurposeSubject): Promise<boolean> {
  if (!RECONCILING_PURPOSES.includes((await purposeOf(projectRoot, changeset)).purpose)) return false;
  return (await emptyLandingHold(projectRoot, changeset)) === undefined;
}

/**
 * Why an empty reconcile or bootstrap must not land as "the model matches the code": its run was
 * limited to some layers (it says nothing about the rest), or left cards to decide or elements
 * whose code may be gone. Undefined when nothing holds it back.
 */
export async function emptyLandingHold(projectRoot: string, changeset: PurposeSubject): Promise<string | undefined> {
  const origin = await extractionOrigin(projectRoot, changeset);
  if (origin.layers) return `its extraction was limited to ${origin.layers.join(", ")}, so it says nothing about the rest of the model`;
  if (origin.open && (origin.open.cards > 0 || origin.open.candidateDeletes > 0 || origin.open.suggestedLinks > 0)) {
    const links = origin.open.suggestedLinks > 0 ? ` and ${origin.open.suggestedLinks} suggested link(s) undecided` : "";
    return (
      `its extraction left ${origin.open.cards} card(s) undecided and ${origin.open.candidateDeletes} candidate delete(s) unchecked${links}: ` +
      "decide them (model_add, reject, model_delete, acceptLinks, acceptDeletes) and run codebase_extract again"
    );
  }
  return undefined;
}

/** A manifest's `reconciled` block, read leniently: null when absent or malformed. */
export function readReconciledStamp(value: unknown): ReconciledStamp | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.changeset_id !== "string" || !v.changeset_id) return null;
  return {
    changeset: typeof v.changeset === "string" ? v.changeset : v.changeset_id,
    changeset_id: v.changeset_id,
    landed_at: typeof v.landed_at === "string" ? v.landed_at : "",
    ...(typeof v.code_commit === "string" && v.code_commit ? { code_commit: v.code_commit } : {}),
  };
}
