/**
 * What changeset_commit and changeset_commit_preview say about a changeset's landing beyond the
 * landing summary:
 *
 * - A changeset that is already landed is a result, not an error (#1441): when it landed, the
 *   model files it wrote and whether they are committed to git. "Only a staged changeset can be
 *   committed" read as if the wrong changeset was named, and sent the agent looking for another.
 * Evidence that something is still writing into a staged changeset is core/changeset-write-activity.ts.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Changeset } from "../../core/changeset.js";
import { typeToSnakeStem, type Model } from "../../core/model.js";
import { runGit, type GitRunner } from "./codebase-shared.js";

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
    // Named as Model.saveLayer names a type's file: application_function.yaml for applicationfunction.
    const type = change.elementId.split(".")[1];
    const layerDir = layerDirs.find((dir) => dir.replace(/^\d+_/, "") === change.layerName);
    if (layerDir && type) {
      files.add(path.join(modelDir, layerDir, `${typeToSnakeStem(`${change.layerName}.${type}`, type)}.yaml`));
    }
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
  // Every untracked file by name, not its folder, so each file the landing wrote can be checked.
  const status = await git(["status", "--porcelain", "--untracked-files=all", "--", ...files], model.rootPath);
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
