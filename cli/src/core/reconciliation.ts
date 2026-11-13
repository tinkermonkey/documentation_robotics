/**
 * Which landings reconcile the model with the code.
 *
 * Code drift (project_status `codeDrift`) is reconciled only by an as-built landing: a bootstrap, or
 * a keep-as-built changeset staged by `codebase_extract`. Landing a plan, or any other commit that
 * touches `documentation-robotics/`, doesn't reconcile it: a plan describes what was meant to be
 * built, and it was drawn before the code existed.
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
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReconciledStamp } from "../types/index.js";

/** The description codebase_extract gives the changesets it creates. */
export const EXTRACTION_MARKER = /Staged by codebase_extract/;

interface ExtractionRecordFile {
  changesetId?: unknown;
  changesetName?: unknown;
  gitHead?: unknown;
  pending?: unknown;
}

/** HEAD of the git repository at `dir`, or null outside git. */
function gitHead(dir: string): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, stdio: "pipe", encoding: "utf-8", timeout: 10_000 });
    return result.status === 0 ? result.stdout.trim() || null : null;
  } catch {
    return null;
  }
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
 * Whether codebase_extract staged this changeset, and the commit it read the code at.
 *
 * The same rule as `isExtractionChangeset` (cli/src/mcp/tools/codebase-extract.ts) plus the
 * description marker: its record (`.dr/analyzers/extract/<id>.json`), or the cards of a run that
 * staged nothing and are waiting for a changeset of this name (`pending.json`), or the description
 * codebase_extract writes. Kept in core so StagingAreaManager.commit, which the CLI, the MCP tool
 * and the viewer's Apply share, can tell without importing the MCP layer.
 */
export async function extractionOrigin(
  projectRoot: string,
  changeset: { id?: string; name: string; description?: string }
): Promise<{ asBuilt: boolean; gitHead?: string }> {
  const dir = path.join(projectRoot, ".dr", "analyzers", "extract");
  if (changeset.id) {
    const record = await readRecord(path.join(dir, `${changeset.id.replace(/[^\w.-]/g, "_")}.json`));
    if (record && !record.pending && record.changesetId === changeset.id) {
      return { asBuilt: true, ...(typeof record.gitHead === "string" && record.gitHead ? { gitHead: record.gitHead } : {}) };
    }
  }
  const pending = await readRecord(path.join(dir, "pending.json"));
  if (pending?.pending && pending.changesetName === changeset.name) {
    return { asBuilt: true, ...(typeof pending.gitHead === "string" && pending.gitHead ? { gitHead: pending.gitHead } : {}) };
  }
  return { asBuilt: EXTRACTION_MARKER.test(changeset.description ?? "") };
}

/**
 * The stamp an as-built landing writes, or null when the changeset is not an as-built one (a plan,
 * a hand-written changeset). `code_commit` is the commit extraction read, else HEAD of the code at
 * landing time, else left out.
 */
export async function reconciliationStamp(
  projectRoot: string,
  changeset: { id?: string; name: string; description?: string },
  codeRoot: string = projectRoot,
  landedAt: string = new Date().toISOString()
): Promise<ReconciledStamp | null> {
  if (!changeset.id) return null;
  const origin = await extractionOrigin(projectRoot, changeset);
  if (!origin.asBuilt) return null;
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
