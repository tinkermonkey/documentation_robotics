/**
 * What changeset_commit and changeset_commit_preview say about a changeset's landing beyond the
 * landing summary:
 *
 * - A changeset that is already landed is a result, not an error (#1441): when it landed, the
 *   model files it wrote and whether they are committed to git. "Only a staged changeset can be
 *   committed" read as if the wrong changeset was named, and sent the agent looking for another.
 * - A changeset staged into moments ago, or being written now, may still be receiving writes
 *   (#1437). The preview says so: a write that arrives while it lands, or after, is refused rather
 *   than lost, and has to be sent again elsewhere.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Changeset } from "../../core/changeset.js";
import type { Model } from "../../core/model.js";
import { FileLock } from "../../utils/file-lock.js";
import { runGit, type GitRunner } from "./codebase-shared.js";

/** How recent a staged write must be for the preview to warn that writes may still be arriving. */
export const RECENT_WRITE_MS = 60_000;

export interface AlreadyLanded {
  id: string;
  name: string;
  status: "already-landed";
  /** When it landed: the manifest's history, else the changeset's last change. */
  landedAt?: string;
  nothingToDo: string;
  /** The model files its changes are in, and its own folder, relative to the project root. */
  files: string[];
  /** Whether those files are committed to git (#1367): the ones git shows uncommitted, or why it can't tell. */
  git: { committed: true } | { committed: false; uncommitted: string[] } | { unknown: string };
}

/** The model files a changeset's changes are written to: each layer's type file, and relationships.yaml. */
async function filesOf(rootPath: string, changeset: Changeset): Promise<string[]> {
  const modelDir = path.join("documentation-robotics", "model");
  let layerDirs: string[] = [];
  try {
    layerDirs = (await readdir(path.join(rootPath, modelDir), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // No model folder to read: the changeset's own folder is still named.
  }
  const files = new Set<string>();
  for (const change of changeset.changes) {
    if (change.type.startsWith("relationship-")) {
      files.add(path.join(modelDir, "relationships.yaml"));
      continue;
    }
    const type = change.elementId.split(".")[1];
    const layerDir = layerDirs.find((dir) => dir.replace(/^\d+_/, "") === change.layerName);
    if (layerDir && type) files.add(path.join(modelDir, layerDir, `${type}.yaml`));
  }
  if (changeset.id) files.add(path.join("documentation-robotics", "changesets", changeset.id));
  return [...files].sort();
}

/** A changeset that is already landed, as a result: nothing is left to do. */
export async function alreadyLandedResult(
  model: Model,
  changeset: Changeset,
  git: GitRunner = runGit
): Promise<AlreadyLanded> {
  const landedAt =
    [...(model.manifest.changeset_history ?? [])]
      .reverse()
      .find((entry) => entry.name === changeset.name && entry.action === "committed")?.committed_at ?? changeset.modified;
  const files = await filesOf(model.rootPath, changeset);
  const status = await git(["status", "--porcelain", "--", ...files], model.rootPath);
  const uncommitted = status.ok
    ? status.stdout
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter(Boolean)
    : [];
  return {
    id: changeset.id!,
    name: changeset.name,
    status: "already-landed",
    ...(landedAt ? { landedAt } : {}),
    nothingToDo:
      `'${changeset.name}' is already landed${landedAt ? ` (at ${landedAt})` : ""}: its changes are in the base model, so ` +
      "there is nothing to land. This is the changeset that was named, not a wrong one.",
    files,
    git: !status.ok
      ? { unknown: `git status failed: ${status.error}` }
      : uncommitted.length > 0
        ? { committed: false, uncommitted }
        : { committed: true },
  };
}

/**
 * A warning when the changeset may still be receiving writes: one holds its lock now, or a change
 * was staged into it within {@link RECENT_WRITE_MS}. Undefined otherwise.
 */
export async function recentWritesWarning(
  changesetPath: string,
  changeset: Changeset,
  now: number = Date.now()
): Promise<string | undefined> {
  const holder = FileLock.exists(changesetPath) ? await FileLock.readOwner(changesetPath) : null;
  const modified = Date.parse(changeset.modified);
  const ago = Number.isFinite(modified) ? now - modified : Infinity;
  if (!FileLock.exists(changesetPath) && ago > RECENT_WRITE_MS) return undefined;
  const what = FileLock.exists(changesetPath)
    ? `Something is writing to '${changeset.name}' now${holder?.purpose ? ` (${holder.purpose})` : ""}`
    : `A change was staged into '${changeset.name}' ${Math.max(0, Math.round(ago / 1000))} s ago`;
  return (
    `${what}. If anything is still staging into it, let it finish before landing: a write that arrives while it ` +
    "lands, or after, is refused (never lost) and has to be sent again into another changeset."
  );
}
