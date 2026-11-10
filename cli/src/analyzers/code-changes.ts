/**
 * The files a git range changed, for `codebase_extract` with `since`: what the branch (or the
 * commits since a ref) added, modified, renamed and deleted, plus uncommitted and untracked files,
 * relative to the codebase root, with the lines each changed file changed. DR's own folders
 * (`documentation-robotics/`, `.dr/`) are never part of it. Read-only git, no shell.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { CLIError, ErrorCategory } from "../utils/errors.js";
import { SOURCE_EXTENSIONS } from "./cards/build.js";
import type { CodeChanges, LineRanges } from "./extraction-plan.js";

export interface CodeChangesResult extends CodeChanges {
  /** The commit the range starts from: the merge base of `since` and HEAD. */
  base: string;
}

export type { LineRanges };

/** Folders, relative to the codebase root, that hold DR's own files: never changed code. */
export const DR_OWN_DIRS: readonly string[] = Object.freeze(["documentation-robotics", ".dr"]);

/** Whether a codebase-relative path is inside one of these folders. */
export function inDirs(file: string, dirs: readonly string[]): boolean {
  return dirs.some((d) => !!d && (file === d || file.startsWith(d.replace(/\/+$/, "") + "/")));
}

/** Output git may return: a whole range's diff, a large file at the base. */
const MAX_BUFFER = 64 * 1024 * 1024;

function git(args: string[], cwd: string): { ok: true; out: string } | { ok: false; error: string } {
  const r = spawnSync("git", ["-c", "core.quotepath=false", ...args], { cwd, encoding: "utf-8", stdio: "pipe", timeout: 30_000, maxBuffer: MAX_BUFFER });
  if (r.error) return { ok: false, error: r.error.message };
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.stdout || `git exited ${r.status}`).trim() };
  return { ok: true, out: r.stdout };
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Parse `git diff --name-status -z` output into changed and deleted files (repo-relative). */
export function parseNameStatus(out: string, into: { changed: Set<string>; deleted: Map<string, string | null> }): void {
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    if (!status) continue;
    const code = status[0];
    if (code === "R" || code === "C") {
      const from = parts[i++];
      const to = parts[i++];
      if (code === "R" && from) {
        into.deleted.set(from, to ?? null);
        into.changed.delete(from);
      }
      if (to) {
        into.changed.add(to);
        into.deleted.delete(to);
      }
    } else {
      const file = parts[i++];
      if (!file) continue;
      if (code === "D") {
        into.deleted.set(file, null);
        into.changed.delete(file);
      } else {
        into.changed.add(file);
        into.deleted.delete(file);
      }
    }
  }
}

/**
 * Parse `git diff -U0` output into the new-side line ranges of each file (repo-relative). A file
 * the diff creates (`--- /dev/null`) is "all".
 */
export function parseHunks(out: string): Map<string, LineRanges> {
  const hunks = new Map<string, LineRanges>();
  let file: string | null = null;
  let created = false;
  for (const line of out.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = null;
      created = false;
    } else if (line.startsWith("--- ")) {
      created = line === "--- /dev/null";
    } else if (line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? null : line.slice(4).replace(/\t$/, "").replace(/^b\//, "");
      if (file && created) hunks.set(file, "all");
    } else if (file && line.startsWith("@@")) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      const ranges = hunks.get(file) ?? [];
      if (!m || ranges === "all") continue;
      const start = Math.max(Number(m[1]), 1);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      // A pure deletion (count 0) changes the code around the line it follows.
      ranges.push(count === 0 ? [start, start] : [start, start + count - 1]);
      hunks.set(file, ranges);
    }
  }
  return hunks;
}

/** Whether a symbol's lines touch a file's changed lines (a symbol with no lines counts only in a new file). */
export function changedInRange(ranges: LineRanges | undefined, start: number | null, end: number | null): boolean {
  if (!ranges) return false;
  if (ranges === "all") return true;
  if (start === null) return false;
  const last = end ?? start;
  return ranges.some(([a, b]) => a <= last && b >= start);
}

/**
 * Files changed between the merge base of `since` and HEAD, and in the working tree, relative to
 * `codebaseRoot`. Files outside the codebase root, and DR's own folders ({@link DR_OWN_DIRS}),
 * are left out.
 *
 * @throws CLIError when the codebase is not in git or `since` is not a commit
 */
export async function codeChangesSince(codebaseRoot: string, since: string): Promise<CodeChangesResult> {
  const top = git(["rev-parse", "--show-toplevel"], codebaseRoot);
  if (!top.ok) throw new CLIError(`The code is not in a git repository: ${codebaseRoot}`, ErrorCategory.USER, ["Call codebase_extract without since"]);
  if (since.startsWith("-")) throw new CLIError(`since is not a git ref: ${since}`, ErrorCategory.USER);
  const commit = git(["rev-parse", "--verify", "--quiet", `${since}^{commit}`], codebaseRoot);
  if (!commit.ok || !commit.out.trim()) {
    throw new CLIError(`since is not a commit in this repository: ${since}`, ErrorCategory.USER, [
      "Pass a branch, tag or commit, e.g. the branch the work started from (main)",
    ]);
  }
  const mergeBase = git(["merge-base", commit.out.trim(), "HEAD"], codebaseRoot);
  const base = mergeBase.ok && mergeBase.out.trim() ? mergeBase.out.trim() : commit.out.trim();

  const repo = { changed: new Set<string>(), deleted: new Map<string, string | null>() };
  for (const args of [
    ["diff", "--name-status", "-z", "-M", base, "HEAD"],
    ["diff", "--name-status", "-z", "-M", "HEAD"],
  ]) {
    const r = git(args, codebaseRoot);
    if (!r.ok) throw new CLIError(`git ${args.join(" ")} failed: ${r.error}`, ErrorCategory.SYSTEM);
    parseNameStatus(r.out, repo);
  }
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z", "--full-name"], top.out.trim());
  const untrackedFiles = untracked.ok ? untracked.out.split("\0").filter(Boolean) : [];
  for (const f of untrackedFiles) {
    // A file deleted or renamed away in the range and then recreated is there again.
    repo.changed.add(f);
    repo.deleted.delete(f);
  }
  // The changed lines, from the base to the working tree; an untracked file is all new.
  // Only source files count, and never DR's own folders.
  const pathspecs = [
    ...SOURCE_EXTENSIONS.map((ext) => `:(glob,icase)**/*.${ext}`),
    ...DR_OWN_DIRS.map((d) => `:(exclude)${d}`),
  ];
  const diff = git(["diff", "-U0", "-M", "--no-color", "--no-ext-diff", base, "--", ...pathspecs], codebaseRoot);
  const repoHunks = diff.ok ? parseHunks(diff.out) : new Map<string, LineRanges>();
  const hunksError = diff.ok ? undefined : diff.error.split("\n")[0];
  for (const f of untrackedFiles) repoHunks.set(f, "all");

  // git names files from the top of the work tree; source references from the codebase root.
  const prefix = toPosix(path.relative(top.out.trim(), codebaseRoot));
  const local = (f: string): string | null => {
    const l = !prefix ? f : f.startsWith(prefix + "/") ? f.slice(prefix.length + 1) : null;
    return l && !inDirs(l, DR_OWN_DIRS) ? l : null;
  };
  const changed = new Set<string>();
  for (const f of repo.changed) {
    const l = local(f);
    if (l) changed.add(l);
  }
  const deleted = new Map<string, string | null>();
  for (const [from, to] of repo.deleted) {
    const l = local(from);
    if (l) deleted.set(l, to ? local(to) : null);
  }
  const hunks = new Map<string, LineRanges>();
  for (const [f, ranges] of repoHunks) {
    const l = local(f);
    if (l && changed.has(l)) hunks.set(l, ranges);
  }
  const topDir = top.out.trim();
  const fileAtBase = (file: string): string | null | undefined => {
    const r = git(["show", `${base}:${prefix ? `${prefix}/${file}` : file}`], topDir);
    if (r.ok) return r.out;
    // Absent at the base, or a failure git can't explain (too big, git broken): can't tell.
    return /does not exist in|exists on disk, but not in/.test(r.error) ? null : undefined;
  };
  return { base, changed, deleted, hunks, ...(hunksError ? { hunksError } : {}), fileAtBase };
}

/**
 * The part of a range that is code: changed and deleted files that `keep` accepts (a rename when
 * either path is kept). DR's own folders are left out already.
 */
export function scopeChanges(changes: CodeChangesResult, keep: (file: string) => boolean): CodeChangesResult {
  const changed = new Set([...changes.changed].filter(keep));
  const deleted = new Map([...changes.deleted].filter(([from, to]) => keep(from) || (to !== null && keep(to))));
  const hunks = changes.hunks ? new Map([...changes.hunks].filter(([f]) => changed.has(f))) : undefined;
  return { ...changes, changed, deleted, ...(hunks ? { hunks } : {}) };
}

/**
 * Source files with uncommitted changes (modified, added or untracked) written after `sinceMs`,
 * relative to the codebase root. An index counts as fresh while HEAD hasn't moved, so these are
 * edits the index may not have seen. Empty when git can't say.
 */
export async function sourceEditsSince(codebaseRoot: string, sinceMs: number, isSource: (file: string) => boolean): Promise<string[]> {
  const top = git(["rev-parse", "--show-toplevel"], codebaseRoot);
  if (!top.ok) return [];
  const status = git(["status", "--porcelain", "-z", "--untracked-files=all", "--", "."], codebaseRoot);
  if (!status.ok) return [];
  const prefix = toPosix(path.relative(top.out.trim(), codebaseRoot));
  const out: string[] = [];
  const parts = status.out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (code[0] === "R" || code[0] === "C") i++; // the next field is the old path
    if (code.includes("D")) continue;
    const local = prefix ? (file.startsWith(prefix + "/") ? file.slice(prefix.length + 1) : null) : file;
    if (!local || !isSource(local)) continue;
    try {
      if (statSync(path.join(codebaseRoot, local)).mtimeMs > sinceMs) out.push(local);
    } catch {
      // gone since git listed it
    }
  }
  return out.sort();
}
