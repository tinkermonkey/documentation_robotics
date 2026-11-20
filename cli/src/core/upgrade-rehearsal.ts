/**
 * Upgrade rehearsal - what a model upgrade would write, found by running it on a copy.
 *
 * `dr upgrade --dry-run` and the `project_upgrade` preview say what the upgrade will change before
 * anything is written: which model files, which changesets, what the upgraded model would fail
 * validation on, and which required attributes it could derive values for. Predicting that from the
 * migration table is guesswork, so the rehearsal copies `documentation-robotics/` to a temporary
 * folder, runs the real upgrade there (upgradeModel), compares the files before and after, and
 * deletes the copy. The project itself is only read.
 */

import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { upgradeModel, type ModelUpgradeOptions, type ModelUpgradeResult } from "./model-upgrade.js";

const PROJECT_FOLDER = "documentation-robotics";

/** The files written, added and removed between two {@link hashFiles} snapshots */
export interface FilesChanged {
  modified: string[];
  added: string[];
  removed: string[];
}

/** Every file under `dir` with a hash of its content, by path relative to `root`. */
export async function hashFiles(root: string, dir: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  let entries;
  try {
    entries = await readdir(join(root, dir), { recursive: true, withFileTypes: true });
  } catch {
    return hashes;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    try {
      hashes.set(relative(root, file).split(sep).join("/"), createHash("sha1").update(await readFile(file)).digest("hex"));
    } catch {
      // gone since the listing
    }
  }
  return hashes;
}

/** The files that differ between two snapshots, each list sorted. */
export function diffFiles(before: Map<string, string>, after: Map<string, string>): FilesChanged {
  const modified: string[] = [];
  const added: string[] = [];
  for (const [file, hash] of after) {
    const old = before.get(file);
    if (old === undefined) added.push(file);
    else if (old !== hash) modified.push(file);
  }
  const removed = [...before.keys()].filter((file) => !after.has(file));
  return { modified: modified.sort(), added: added.sort(), removed: removed.sort() };
}

/** How many files a change set names */
export function countFiles(files: FilesChanged): number {
  return files.modified.length + files.added.length + files.removed.length;
}

/** The files of a change set under a folder (a path prefix ending in a slash) */
export function filesUnder(files: FilesChanged, prefix: string): FilesChanged {
  const under = (list: string[]) => list.filter((file) => file.startsWith(prefix));
  return { modified: under(files.modified), added: under(files.added), removed: under(files.removed) };
}

/** The files of a change set outside a folder */
export function filesOutside(files: FilesChanged, prefix: string): FilesChanged {
  const outside = (list: string[]) => list.filter((file) => !file.startsWith(prefix));
  return { modified: outside(files.modified), added: outside(files.added), removed: outside(files.removed) };
}

export interface UpgradeRehearsal {
  /** What the upgrade returned on the copy: the migration, the changesets, the validation, the fills */
  result: ModelUpgradeResult;
  /** The files it wrote under `documentation-robotics/model/`, relative to the project root */
  modelFiles: FilesChanged;
  /**
   * The files it wrote under `documentation-robotics/` outside the model (changesets), likewise.
   * A changeset the upgrade creates gets its id when it is created, so the copy's id is not the
   * one the real run will use: those paths carry the changeset's name in its place, as
   * `documentation-robotics/changesets/<new: upgrade-fills-0.14.0>/changes.yaml`.
   */
  otherFiles: FilesChanged;
}

/** Replace the ids of the changesets the rehearsal created with their names: the ids won't recur */
function nameNewChangesets(files: FilesChanged, result: ModelUpgradeResult): FilesChanged {
  const created = [result.fills, result.dropRecord].filter(
    (changeset): changeset is NonNullable<typeof changeset> & { id: string } => typeof changeset?.id === "string"
  );
  const named = (file: string) =>
    created.reduce(
      (path, changeset) => path.replace(`/changesets/${changeset.id}/`, `/changesets/<new: ${changeset.name}>/`),
      file
    );
  return { modified: files.modified.map(named), added: files.added.map(named).sort(), removed: files.removed.map(named) };
}

/**
 * Run the model upgrade on a temporary copy of the project's `documentation-robotics/` folder and
 * report what it did there. The project is not written.
 */
export async function rehearseModelUpgrade(
  projectRoot: string,
  options: ModelUpgradeOptions
): Promise<UpgradeRehearsal> {
  const copy = await mkdtemp(join(tmpdir(), "dr-upgrade-rehearsal-"));
  try {
    await cp(join(projectRoot, PROJECT_FOLDER), join(copy, PROJECT_FOLDER), { recursive: true });
    const before = await hashFiles(copy, PROJECT_FOLDER);
    const result = await upgradeModel(copy, options);
    const changed = diffFiles(before, await hashFiles(copy, PROJECT_FOLDER));
    const modelPrefix = `${PROJECT_FOLDER}/model/`;
    return {
      result,
      modelFiles: filesUnder(changed, modelPrefix),
      otherFiles: nameNewChangesets(filesOutside(changed, modelPrefix), result),
    };
  } finally {
    await rm(copy, { recursive: true, force: true });
  }
}
