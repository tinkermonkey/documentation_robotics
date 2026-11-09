/**
 * cs-landed.ts reports a landed proposal to Context Studio (context-studio#1463): the commit that
 * holds its change record, the spec version there, and the repository.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { landingFor } from "../../../scripts/spec-enrich/cs-landed.js";

describe("cs-landed.ts", () => {
  let repo: string;
  const record = "cli/scripts/spec-enrich/data/cs-decisions/applied-cs-p-1.json";
  const git = (...args: string[]) => {
    const r = Bun.spawnSync(["git", "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: repo });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    return r.stdout.toString().trim();
  };
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join("/tmp", "test-cs-landed-"));
    git("init", "-q");
    git("remote", "add", "origin", "git@github.com:tinkermonkey/documentation_robotics.git");
    write("spec/VERSION", "0.11.0\n");
    git("add", ".");
    git("commit", "-qm", "base");
  });

  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("reports the commit that holds the change record and the spec version there", () => {
    write(record, "{}\n");
    write("spec/VERSION", "0.12.0\n");
    git("add", ".");
    git("commit", "-qm", "land p-1");
    const landing = git("rev-parse", "HEAD");
    write("README.md", "later\n");
    git("add", ".");
    git("commit", "-qm", "later");

    expect(landingFor(repo, record)).toEqual({ repo: "git@github.com:tinkermonkey/documentation_robotics.git", commit: landing, spec_version: "0.12.0" });
  });

  it("refuses an uncommitted landing, or a commit without the record", () => {
    expect(() => landingFor(repo, record)).toThrow(/is not committed/);
    write(record, "{}\n");
    expect(() => landingFor(repo, record)).toThrow(/uncommitted changes/);
    git("add", ".");
    git("commit", "-qm", "land");
    expect(() => landingFor(repo, record, { commit: "HEAD~1" })).toThrow(/doesn't hold this landing/);
    expect(landingFor(repo, record, { commit: "HEAD", repo: "other/repo" }).repo).toBe("other/repo");
  });
});
