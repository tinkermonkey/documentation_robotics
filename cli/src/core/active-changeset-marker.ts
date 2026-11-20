/**
 * The active-changeset marker: the one file that says which changeset this checkout is working in.
 *
 * It is local state, so it lives in `.dr/` with the rest of a checkout's per-checkout state
 * (`.dr/active-changeset`), which `dr init` and `dr upgrade` keep out of git (dot-dr-ignore.ts).
 * It holds the changeset's id and a newline.
 *
 * Until #1218 the marker was `documentation-robotics/changesets/.active`, beside the changesets,
 * which are committed. A marker committed with them outlived its changeset in every clone. That
 * place is still read when `.dr/` has no marker, so a checkout that was mid-change keeps its
 * active changeset across the upgrade (and a dr older than the move, such as an installed plugin,
 * is still heard). Every write goes to `.dr/` and removes the old file.
 *
 * Whether the changeset a marker names is still the active one is not decided here: a marker
 * counts only while it names a staged changeset (StagingAreaManager.getActive, Model.load).
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** The marker, relative to the project root. */
export const ACTIVE_MARKER_RELATIVE = path.join(".dr", "active-changeset");

/** Where the marker was before it moved to `.dr/`, relative to the project root. */
export const LEGACY_ACTIVE_MARKER_RELATIVE = path.join("documentation-robotics", "changesets", ".active");

export function activeMarkerPath(projectRoot: string): string {
  return path.join(projectRoot, ACTIVE_MARKER_RELATIVE);
}

export function legacyActiveMarkerPath(projectRoot: string): string {
  return path.join(projectRoot, LEGACY_ACTIVE_MARKER_RELATIVE);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** A marker file's id; null when the file is missing or empty. Other read errors are thrown. */
async function idIn(file: string): Promise<string | null> {
  try {
    return (await readFile(file, "utf-8")).trim() || null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * The id the marker holds, or null when there is none: `.dr/active-changeset` when that file
 * exists (an empty one means none), otherwise the pre-#1218 file.
 */
export async function readActiveMarker(projectRoot: string): Promise<string | null> {
  const current = activeMarkerPath(projectRoot);
  if (existsSync(current)) {
    return idIn(current);
  }
  return idIn(legacyActiveMarkerPath(projectRoot));
}

/** {@link readActiveMarker}, for code that cannot wait (the MCP server's model cache stamp). */
export function readActiveMarkerSync(projectRoot: string): string | null {
  for (const file of [activeMarkerPath(projectRoot), legacyActiveMarkerPath(projectRoot)]) {
    try {
      return readFileSync(file, "utf-8").trim() || null;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return null;
}

/** Name `changesetId` as the active changeset, in `.dr/`, and remove a marker left in the old place. */
export async function writeActiveMarker(projectRoot: string, changesetId: string): Promise<void> {
  const file = activeMarkerPath(projectRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${changesetId}\n`, "utf-8");
  await rm(legacyActiveMarkerPath(projectRoot), { force: true });
}

/** Remove the marker, from `.dr/` and from the old place. No active changeset afterwards. */
export async function clearActiveMarker(projectRoot: string): Promise<void> {
  await rm(activeMarkerPath(projectRoot), { force: true });
  await rm(legacyActiveMarkerPath(projectRoot), { force: true });
}
