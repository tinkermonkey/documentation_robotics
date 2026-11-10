/**
 * The files a git range changed, for `codebase_extract` with `since`: what the branch (or the
 * commits since a ref) added, modified, renamed and deleted, plus uncommitted and untracked files,
 * relative to the codebase root. Read-only git, no shell.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { CLIError, ErrorCategory } from "../utils/errors.js";
import type { CodeChanges } from "./extraction-plan.js";

export interface CodeChangesResult extends CodeChanges {
  /** The commit the range starts from: the merge base of `since` and HEAD. */
  base: string;
}

function git(args: string[], cwd: string): { ok: true; out: string } | { ok: false; error: string } {
  const r = spawnSync("git", ["-c", "core.quotepath=false", ...args], { cwd, encoding: "utf-8", stdio: "pipe", timeout: 30_000 });
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
 * Files changed between the merge base of `since` and HEAD, and in the working tree, relative to
 * `codebaseRoot`. Files outside the codebase root are left out.
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
  if (untracked.ok) for (const f of untracked.out.split("\0").filter(Boolean)) repo.changed.add(f);

  // git names files from the top of the work tree; source references from the codebase root.
  const prefix = toPosix(path.relative(top.out.trim(), codebaseRoot));
  const local = (f: string): string | null => {
    if (!prefix) return f;
    return f.startsWith(prefix + "/") ? f.slice(prefix.length + 1) : null;
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
  return { base, changed, deleted };
}
