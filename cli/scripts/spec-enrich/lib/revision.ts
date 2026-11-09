/**
 * The revision of DR's spec, as Context Studio records it on a proposal and its landing
 * ({repo, commit, spec_version}, context-studio#1463), and the git plumbing that reads it.
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export interface SpecRevision {
  repo: string | null;
  commit: string | null;
  spec_version: string | null;
}

/** Run git in `repo`; trimmed output and whether it succeeded. */
export function git(repo: string, ...args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

/** spec/VERSION in the working tree, or at `commit`; null when there is none. */
export function specVersion(repo: string, commit?: string): string | null {
  if (commit) {
    const shown = git(repo, "show", `${commit}:spec/VERSION`);
    return shown.ok ? shown.out : null;
  }
  const file = path.join(repo, "spec", "VERSION");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

/** The origin remote's URL as git reports it (the form Context Studio's importer records), or null. */
export function originUrl(repo: string): string | null {
  const remote = git(repo, "remote", "get-url", "origin");
  return remote.ok && remote.out ? remote.out : null;
}

/**
 * The spec as it is in `repo` now: HEAD, spec/VERSION and the origin remote. `dirty` lists spec
 * source files with uncommitted changes, which HEAD doesn't describe.
 */
export function currentSpecRevision(repo: string): SpecRevision & { dirty: string[] } {
  const head = git(repo, "rev-parse", "HEAD");
  const status = spawnSync("git", ["status", "--porcelain", "--", "spec/schemas", "spec/layers"], { cwd: repo, encoding: "utf8" });
  return {
    repo: originUrl(repo),
    commit: head.ok ? head.out : null,
    spec_version: specVersion(repo),
    dirty: status.status === 0 ? status.stdout.split("\n").filter(Boolean).map((l) => l.slice(3)) : [],
  };
}
