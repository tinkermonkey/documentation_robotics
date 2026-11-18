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
  const codeCommit = origin.gitHead ?? gitHead(codeRoot) ?? undefined;
  return {
    changeset: changeset.name,
    changeset_id: changeset.id,
    landed_at: landedAt,
    ...(codeCommit ? { code_commit: codeCommit } : {}),
  };
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
