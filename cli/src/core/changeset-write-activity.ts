/**
 * Evidence that something may still be writing into a changeset, for the person about to land it
 * (#1437): the landing summary in changeset_commit_preview and changeset_commit's dialog, the
 * `dr changeset commit` prompt, and the viewer's changeset read (shown before Apply).
 *
 * Two kinds of evidence, never a guess from how recently the changeset changed (every preview just
 * after the agent's own staging would warn):
 *
 * - a write holds the changeset's file lock right now (a landing's own hold is not a write);
 * - another process staged into it within {@link RECENT_OTHER_WRITE_MS}: each staging write records
 *   its process in `.dr/changeset-writes/<id>.json` (per-checkout state git ignores). A write from
 *   the process that is about to land (the agent's own MCP server, the viewer's central process)
 *   is the caller's own, and is not evidence.
 *
 * A landing that races a write loses nothing either way (the landing holds the lock), but a write
 * that arrives during or after it is refused and has to be sent again: the warning says so.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FileLock } from "../utils/file-lock.js";
import { LANDING_LOCK_PURPOSE } from "./changeset-write-refusal.js";

/** How recent another process's write must be to count as evidence of a writer still at work. */
export const RECENT_OTHER_WRITE_MS = 30_000;

/** The last staging write into a changeset: which process, and when. */
export interface ChangesetWrite {
  pid: number;
  at: string;
}

function writesFile(projectRoot: string, changesetId: string): string {
  return path.join(projectRoot, ".dr", "changeset-writes", `${changesetId}.json`);
}

/** Records that this process staged into the changeset now. Best effort: a failure is ignored. */
export async function recordChangesetWrite(projectRoot: string, changesetId: string): Promise<void> {
  try {
    const file = writesFile(projectRoot, changesetId);
    await mkdir(path.dirname(file), { recursive: true });
    const write: ChangesetWrite = { pid: process.pid, at: new Date().toISOString() };
    await writeFile(file, JSON.stringify(write), "utf-8");
  } catch {
    // Evidence for a warning, never needed for the write itself.
  }
}

/** The last staging write into the changeset, or null when none is recorded. */
export async function lastChangesetWrite(projectRoot: string, changesetId: string): Promise<ChangesetWrite | null> {
  try {
    const parsed = JSON.parse(await readFile(writesFile(projectRoot, changesetId), "utf-8")) as Partial<ChangesetWrite>;
    return typeof parsed.pid === "number" && typeof parsed.at === "string" ? { pid: parsed.pid, at: parsed.at } : null;
  } catch {
    return null;
  }
}

/**
 * A warning when there is evidence something is still writing into the changeset, else undefined.
 * `changesetPath` is the changeset's folder (its lock sits beside it).
 */
export async function writeActivityWarning(
  projectRoot: string,
  changesetPath: string,
  changeset: { id?: string; name: string },
  options: { now?: number; pid?: number } = {}
): Promise<string | undefined> {
  const now = options.now ?? Date.now();
  const pid = options.pid ?? process.pid;
  let evidence: string | undefined;
  if (FileLock.exists(changesetPath)) {
    const holder = await FileLock.readOwner(changesetPath);
    if (holder?.purpose !== LANDING_LOCK_PURPOSE) evidence = `Something is writing into '${changeset.name}' now`;
  }
  if (!evidence && changeset.id) {
    const last = await lastChangesetWrite(projectRoot, changeset.id);
    const ago = last ? now - Date.parse(last.at) : Infinity;
    if (last && last.pid !== pid && ago >= 0 && ago <= RECENT_OTHER_WRITE_MS) {
      evidence = `Another process (${last.pid}) staged into '${changeset.name}' ${Math.round(ago / 1000)} s ago`;
    }
  }
  return evidence
    ? `${evidence}. If it is still staging into it, let it finish before landing: a write that arrives while it ` +
        "lands, or after, is refused (never lost) and has to be sent again into another changeset."
    : undefined;
}
