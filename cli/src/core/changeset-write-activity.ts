/**
 * Evidence that something may still be writing into a changeset, for the person about to land it
 * (#1437): the landing summary in changeset_commit_preview and changeset_commit's result, the
 * `dr changeset commit` prompt, and the viewer's changeset read (shown before Apply).
 *
 * Two kinds of evidence, never a guess from how recently the changeset changed (every preview just
 * after the agent's own staging would warn):
 *
 * - a write holds the changeset's file lock right now (a landing's own hold is not a write);
 * - another writer staged into it within {@link RECENT_OTHER_WRITE_MS}: each staging write records
 *   who wrote in `.dr/changeset-writes/<id>.json` (per-checkout state git ignores): an MCP session
 *   (each has its own identity, though the central process serves them all and the viewer too),
 *   the viewer, or a process (a `dr` command). A write by the caller itself is not evidence: the
 *   agent's own staging before its preview, the viewer's own before Apply. An agent's MCP writes
 *   are evidence when the person presses Apply, and one session's when another previews.
 *
 * A landing that races a write loses nothing either way (the landing holds the lock), but a write
 * that arrives during or after it is refused and has to be sent again: the warning says so.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { FileLock } from "../utils/file-lock.js";
import { LANDING_LOCK_PURPOSE } from "./changeset-write-refusal.js";

/** How recent another process's write must be to count as evidence of a writer still at work. */
export const RECENT_OTHER_WRITE_MS = 30_000;

/** The last staging write into a changeset: who wrote (see {@link currentWriter}), and when. */
export interface ChangesetWrite {
  writer: string;
  pid: number;
  at: string;
}

const writerScope = new AsyncLocalStorage<string>();

/**
 * Runs `fn` as `writer`: the MCP tool dispatch runs each call as its session (`mcp:<id>`), and the
 * server runs each viewer request as `viewer`.
 */
export function runAsWriter<T>(writer: string, fn: () => T): T {
  return writerScope.run(writer, fn);
}

/** Who is writing (or asking) now: the scope {@link runAsWriter} set, else this process. */
export function currentWriter(): string {
  return writerScope.getStore() ?? `process:${process.pid}`;
}

/** A writer as a person reads it. */
function writerLabel(writer: string): string {
  if (writer === "viewer") return "The viewer";
  if (writer.startsWith("mcp:")) return `An agent's MCP session (${writer.slice(4)})`;
  return `Another process (${writer.replace(/^process:/, "")})`;
}

function writesFile(projectRoot: string, changesetId: string): string {
  return path.join(projectRoot, ".dr", "changeset-writes", `${changesetId}.json`);
}

/** Records that this process staged into the changeset now. Best effort: a failure is ignored. */
export async function recordChangesetWrite(projectRoot: string, changesetId: string): Promise<void> {
  try {
    const file = writesFile(projectRoot, changesetId);
    await mkdir(path.dirname(file), { recursive: true });
    const write: ChangesetWrite = { writer: currentWriter(), pid: process.pid, at: new Date().toISOString() };
    await writeFile(file, JSON.stringify(write), "utf-8");
  } catch {
    // Evidence for a warning, never needed for the write itself.
  }
}

/** The last staging write into the changeset, or null when none is recorded. */
export async function lastChangesetWrite(projectRoot: string, changesetId: string): Promise<ChangesetWrite | null> {
  try {
    const parsed = JSON.parse(await readFile(writesFile(projectRoot, changesetId), "utf-8")) as Partial<ChangesetWrite>;
    if (typeof parsed.pid !== "number" || typeof parsed.at !== "string") return null;
    return { writer: typeof parsed.writer === "string" ? parsed.writer : `process:${parsed.pid}`, pid: parsed.pid, at: parsed.at };
  } catch {
    return null;
  }
}

/** Forgets the changeset's last write: it landed or was discarded, so nothing writes into it now. */
export async function clearChangesetWrites(projectRoot: string, changesetId: string): Promise<void> {
  await rm(writesFile(projectRoot, changesetId), { force: true }).catch(() => undefined);
}

/**
 * A warning when there is evidence something is still writing into the changeset, else undefined.
 * `changesetPath` is the changeset's folder (its lock sits beside it). `writer` is who asks
 * (default {@link currentWriter}): its own writes are not evidence.
 */
export async function writeActivityWarning(
  projectRoot: string,
  changesetPath: string,
  changeset: { id?: string; name: string },
  options: { now?: number; writer?: string } = {}
): Promise<string | undefined> {
  const now = options.now ?? Date.now();
  const writer = options.writer ?? currentWriter();
  let evidence: string | undefined;
  // A lock left by a crashed process is stale, not a write in progress.
  if (FileLock.exists(changesetPath) && !(await FileLock.isLockStale(changesetPath))) {
    const holder = await FileLock.readOwner(changesetPath);
    if (holder?.purpose !== LANDING_LOCK_PURPOSE) evidence = `Something is writing into '${changeset.name}' now`;
  }
  if (!evidence && changeset.id) {
    const last = await lastChangesetWrite(projectRoot, changeset.id);
    const ago = last ? now - Date.parse(last.at) : Infinity;
    if (last && last.writer !== writer && ago >= 0 && ago <= RECENT_OTHER_WRITE_MS) {
      evidence = `${writerLabel(last.writer)} staged into '${changeset.name}' ${Math.round(ago / 1000)} s ago`;
    }
  }
  return evidence
    ? `${evidence}. If it is still staging into it, let it finish before landing: a write that arrives while it ` +
        "lands, or after, is refused (never lost) and has to be sent again into another changeset."
    : undefined;
}
