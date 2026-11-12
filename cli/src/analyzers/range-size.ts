/**
 * How far a `since` range reaches back, and shorter ranges inside it, so codebase_extract can say
 * how many commits a run covers and offer a narrower `since` before the agent works through its
 * cards (issue #1097: a drift that reached back 127 commits produced 1,148 cards).
 */

import { spawnSync } from "node:child_process";

/** A shorter range: `since: ref` covers the last `commitsBack` first-parent commits. */
export interface RangeStep {
  /** The commit to pass as `since`. */
  ref: string;
  /** First-parent commits from it to HEAD. */
  commitsBack: number;
  /** Files (relative to the codebase root) that range changes, uncommitted ones included. */
  files: Set<string>;
}

export interface RangeSize {
  /** Commits in base..HEAD, merged branches' included. */
  commits: number;
  /** Shorter ranges, nearest first. */
  steps: RangeStep[];
}

/** The first-parent distances offered as narrower ranges. */
export const RANGE_STEPS: readonly number[] = Object.freeze([10, 25, 50, 100]);

function git(args: string[], cwd: string): string | null {
  const r = spawnSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return r.error || r.status !== 0 ? null : r.stdout;
}

function names(out: string | null): string[] {
  return out ? out.split("\0").filter(Boolean) : [];
}

/**
 * The size of base..HEAD and the shorter ranges inside it ({@link RANGE_STEPS} first-parent commits
 * back), each with the files it changes relative to the codebase root. Null when git can't say
 * (not a repository, an unknown base): the caller then reports what it has without them.
 */
export function rangeSize(codebaseRoot: string, base: string): RangeSize | null {
  if (!base || base.startsWith("-")) return null;
  const count = git(["rev-list", "--count", `${base}..HEAD`], codebaseRoot);
  if (count === null) return null;
  const commits = Number.parseInt(count.trim(), 10);
  if (!Number.isFinite(commits)) return null;
  const firstParent = (git(["rev-list", "--first-parent", `${base}..HEAD`], codebaseRoot) ?? "").split("\n").filter(Boolean);
  // Uncommitted edits are in every range.
  const worktree = [
    ...names(git(["diff", "--name-only", "-z", "--relative", "HEAD"], codebaseRoot)),
    ...names(git(["ls-files", "--others", "--exclude-standard", "-z"], codebaseRoot)),
  ];
  const steps: RangeStep[] = [];
  for (const n of RANGE_STEPS) {
    if (n >= firstParent.length) break;
    const ref = firstParent[n];
    const files = new Set([...names(git(["diff", "--name-only", "-z", "--relative", "-M", ref, "HEAD"], codebaseRoot)), ...worktree]);
    steps.push({ ref, commitsBack: n, files });
  }
  return { commits, steps };
}
