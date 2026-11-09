/**
 * The revision of DR's spec, as Context Studio records it on a proposal and its landing
 * ({repo, commit, spec_version}, context-studio#1463).
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export interface SpecRevision {
  repo: string | null;
  commit: string | null;
  spec_version: string | null;
}

/**
 * The spec as it is in `repo` now: HEAD, spec/VERSION and the origin remote's URL as git reports
 * it (the form Context Studio's importer records). `dirty` lists spec
 * source files with uncommitted changes, which HEAD doesn't describe.
 */
export function currentSpecRevision(repo: string): SpecRevision & { dirty: string[] } {
  const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  const head = git("rev-parse", "HEAD");
  const remote = git("remote", "get-url", "origin");
  const status = git("status", "--porcelain", "--", "spec/schemas", "spec/layers");
  const versionFile = path.join(repo, "spec", "VERSION");
  return {
    repo: remote.status === 0 && remote.stdout.trim() ? remote.stdout.trim() : null,
    commit: head.status === 0 ? head.stdout.trim() : null,
    spec_version: existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null,
    dirty: status.status === 0 ? status.stdout.split("\n").filter(Boolean).map((l) => l.slice(3)) : [],
  };
}
