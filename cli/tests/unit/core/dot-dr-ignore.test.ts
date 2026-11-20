import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DOT_DR_IGNORE_LINE,
  dotDrDecisionLines,
  dotDrIgnoreNotes,
  dotDrIgnoreWarnings,
  ensureDotDrIgnored,
} from "../../../src/core/dot-dr-ignore.js";

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, stdio: "pipe", encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function gitInit(cwd: string) {
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  // A global excludes file on the machine running the tests must not decide the outcome.
  git(cwd, "config", "core.excludesFile", path.join(cwd, ".no-global-excludes"));
}

describe("ensureDotDrIgnored", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "dr-dot-dr-ignore-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.serial("creates .gitignore with /.dr/ in a git repository that has none", async () => {
    gitInit(dir);
    const result = await ensureDotDrIgnored(dir);
    expect(result).toMatchObject({ added: true, ignored: true, negated: false, trackedFiles: 0, gitChecked: true });
    expect(await readFile(path.join(dir, ".gitignore"), "utf-8")).toContain(`${DOT_DR_IGNORE_LINE}\n`);
    expect(git(dir, "check-ignore", ".dr/").trim()).toBe(".dr/");
    expect(dotDrIgnoreWarnings(result)).toEqual([]);
  });

  it.serial("appends to an existing .gitignore, keeping the developer's lines", async () => {
    gitInit(dir);
    await writeFile(path.join(dir, ".gitignore"), "node_modules/\ndist", "utf-8");
    const result = await ensureDotDrIgnored(dir);
    expect(result.added).toBe(true);
    const text = await readFile(path.join(dir, ".gitignore"), "utf-8");
    expect(text.startsWith("node_modules/\ndist\n\n# Documentation Robotics")).toBe(true);
    expect(text.endsWith(`${DOT_DR_IGNORE_LINE}\n`)).toBe(true);
  });

  it.serial("changes nothing when .dr/ is already ignored, in any spelling", async () => {
    gitInit(dir);
    await writeFile(path.join(dir, ".gitignore"), ".dr\n", "utf-8");
    const result = await ensureDotDrIgnored(dir);
    expect(result).toMatchObject({ added: false, ignored: true });
    expect(await readFile(path.join(dir, ".gitignore"), "utf-8")).toBe(".dr\n");
  });

  it.serial("sees an ignore rule in a parent folder's .gitignore", async () => {
    gitInit(dir);
    await writeFile(path.join(dir, ".gitignore"), ".dr/\n", "utf-8");
    const project = path.join(dir, "services", "orders");
    await mkdir(project, { recursive: true });
    const result = await ensureDotDrIgnored(project);
    expect(result).toMatchObject({ added: false, ignored: true, gitChecked: true });
    await expect(readFile(path.join(project, ".gitignore"), "utf-8")).rejects.toThrow();
  });

  it.serial("leaves a negation alone and warns", async () => {
    gitInit(dir);
    await writeFile(path.join(dir, ".gitignore"), "*\n!/.dr/\n", "utf-8");
    const result = await ensureDotDrIgnored(dir);
    expect(result).toMatchObject({ added: false, negated: true });
    expect(await readFile(path.join(dir, ".gitignore"), "utf-8")).toBe("*\n!/.dr/\n");
    expect(dotDrIgnoreWarnings(result).join(" ")).toContain("un-ignores .dr/");
  });

  it.serial("replaces a .dr rule or comment already in the file instead of adding a second one (#1185)", async () => {
    gitInit(dir);
    await writeFile(
      path.join(dir, ".gitignore"),
      "node_modules/\n# the spec pin (.dr/spec, .dr/manifest.json) stays tracked\n.dr/analyzers/\n.dr-version\ndist/\n",
      "utf-8"
    );
    const result = await ensureDotDrIgnored(dir);
    expect(result).toMatchObject({ added: true, ignored: true });
    expect(result.replaced).toEqual(["# the spec pin (.dr/spec, .dr/manifest.json) stays tracked", ".dr/analyzers/"]);
    const text = await readFile(path.join(dir, ".gitignore"), "utf-8");
    // DR's block sits where the old lines were; lines about other things (.dr-version) are untouched
    expect(text).toBe(
      `node_modules/\n# Documentation Robotics: per-checkout spec reference and analyzer state (recreated by the CLI)\n${DOT_DR_IGNORE_LINE}\n.dr-version\ndist/\n`
    );
    expect(dotDrIgnoreNotes(result).join(" ")).toContain("Replaced 2 .dr line(s)");
  });

  describe("when git tracks files under .dr/ (#1185)", () => {
    async function trackDotDr() {
      gitInit(dir);
      await mkdir(path.join(dir, ".dr", "spec"), { recursive: true });
      await writeFile(path.join(dir, ".dr", "manifest.json"), "{}", "utf-8");
      await writeFile(path.join(dir, ".dr", "spec", "api.json"), "{}", "utf-8");
      await writeFile(path.join(dir, ".dr", "spec", "base.json"), "{}", "utf-8");
      git(dir, "add", ".dr");
      git(dir, "commit", "-q", "-m", "track .dr");
    }

    it.serial("changes nothing without a choice and returns the decision", async () => {
      await trackDotDr();
      const result = await ensureDotDrIgnored(dir);
      expect(result).toMatchObject({ added: false, ignored: false, trackedFiles: 3 });
      expect(result.decision).toMatchObject({
        wouldIgnoreTracked: 3,
        files: [".dr/manifest.json", ".dr/spec/api.json", ".dr/spec/base.json"],
        alreadyIgnored: false,
      });
      expect(result.decision!.options.map((option) => option.choice)).toEqual(["untrack", "keep-tracked", "skip"]);
      await expect(readFile(path.join(dir, ".gitignore"), "utf-8")).rejects.toThrow();
      expect(git(dir, "ls-files", "--", ".dr").trim().split("\n")).toHaveLength(3);
      expect(dotDrDecisionLines(result.decision!)[0]).toContain("git tracks 3 file(s) under .dr/");
      // A pending decision is the caller's to present, not a warning
      expect(dotDrIgnoreWarnings(result)).toEqual([]);
    });

    it.serial("untrack: ignores .dr/ and stages the removals, leaving the files on disk", async () => {
      await trackDotDr();
      const result = await ensureDotDrIgnored(dir, { tracked: "untrack" });
      expect(result).toMatchObject({ added: true, ignored: true, applied: "untrack", untracked: 3, trackedFiles: 0 });
      expect(git(dir, "ls-files", "--", ".dr").trim()).toBe("");
      expect(git(dir, "status", "--short", "--", ".dr").trim().split("\n")).toEqual([
        "D  .dr/manifest.json",
        "D  .dr/spec/api.json",
        "D  .dr/spec/base.json",
      ]);
      expect(await readFile(path.join(dir, ".dr", "manifest.json"), "utf-8")).toBe("{}");
      // The next git add of the upgrade just works
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "upgrade");
      expect(git(dir, "status", "--short").trim()).toBe("");
      expect(dotDrIgnoreNotes(result).join(" ")).toContain("Removed 3 file(s) under .dr/ from git's index");
    });

    it.serial("keep-tracked: ignores the rest of .dr/ and re-includes the tracked paths", async () => {
      await trackDotDr();
      const result = await ensureDotDrIgnored(dir, { tracked: "keep-tracked" });
      expect(result).toMatchObject({ added: true, applied: "keep-tracked", trackedFiles: 3 });
      expect(result.keptTracked).toEqual(["!/.dr/manifest.json", "!/.dr/spec/"]);
      const text = await readFile(path.join(dir, ".gitignore"), "utf-8");
      expect(text).toContain("/.dr/*\n!/.dr/manifest.json\n!/.dr/spec/\n");

      // An upgrade rewrites the tracked files and dr writes per-checkout state beside them
      await writeFile(path.join(dir, ".dr", "manifest.json"), '{"specVersion":"9"}', "utf-8");
      await writeFile(path.join(dir, ".dr", "spec", "ux.json"), "{}", "utf-8");
      await mkdir(path.join(dir, ".dr", "analyzers"), { recursive: true });
      await writeFile(path.join(dir, ".dr", "analyzers", "index.json"), "{}", "utf-8");
      await writeFile(path.join(dir, ".dr", "active-changeset"), "x", "utf-8");
      git(dir, "add", ".dr", ".gitignore");
      expect(git(dir, "status", "--short").trim().split("\n")).toEqual([
        "M  .dr/manifest.json",
        "A  .dr/spec/ux.json",
        "A  .gitignore",
      ]);

      // Decided: a later call asks nothing and changes nothing
      const again = await ensureDotDrIgnored(dir);
      expect(again.decision).toBeUndefined();
      expect(again.added).toBe(false);
      expect(await readFile(path.join(dir, ".gitignore"), "utf-8")).toBe(text);
    });

    it.serial("skip: leaves .gitignore and the index as they are", async () => {
      await trackDotDr();
      const result = await ensureDotDrIgnored(dir, { tracked: "skip" });
      expect(result).toMatchObject({ added: false, applied: "skip", trackedFiles: 3 });
      await expect(readFile(path.join(dir, ".gitignore"), "utf-8")).rejects.toThrow();
      expect(dotDrIgnoreNotes(result).join(" ")).toContain("as they are");
    });

    it.serial("asks again when an earlier run added the rule and left the files tracked", async () => {
      await trackDotDr();
      await writeFile(path.join(dir, ".gitignore"), `${DOT_DR_IGNORE_LINE}\n`, "utf-8");
      const result = await ensureDotDrIgnored(dir);
      expect(result.decision).toMatchObject({ wouldIgnoreTracked: 3, alreadyIgnored: true });
      expect(dotDrDecisionLines(result.decision!)[0]).toContain("git add .dr refuses them");

      const untracked = await ensureDotDrIgnored(dir, { tracked: "untrack" });
      expect(untracked).toMatchObject({ added: false, applied: "untrack", untracked: 3, trackedFiles: 0 });
      expect(await readFile(path.join(dir, ".gitignore"), "utf-8")).toBe(`${DOT_DR_IGNORE_LINE}\n`);
    });

    it.serial("the decision holds every tracked file; its lines name the first ten and say how to list the rest", async () => {
      gitInit(dir);
      await mkdir(path.join(dir, ".dr", "spec"), { recursive: true });
      const names = Array.from({ length: 14 }, (_, i) => `layer-${String(i + 1).padStart(2, "0")}.json`);
      for (const name of names) await writeFile(path.join(dir, ".dr", "spec", name), "{}", "utf-8");
      git(dir, "add", ".dr");
      git(dir, "commit", "-q", "-m", "track .dr");

      const { decision } = await ensureDotDrIgnored(dir);
      expect(decision!.wouldIgnoreTracked).toBe(14);
      expect(decision!.files).toEqual(names.map((name) => `.dr/spec/${name}`));

      const lines = dotDrDecisionLines(decision!);
      expect(lines[0]).toContain("git tracks 14 file(s) under .dr/");
      expect(lines[1]).toContain(".dr/spec/layer-10.json, and 4 more of 14 (git ls-files .dr lists them all)");
      expect(lines[1]).not.toContain("layer-11.json");
      const full = dotDrDecisionLines(decision!, { full: true });
      expect(full[1]).toContain("layer-14.json");
      expect(full[1]).not.toContain("more of");
    });

    it.serial("a dry run reports the choice and writes nothing", async () => {
      await trackDotDr();
      const result = await ensureDotDrIgnored(dir, { tracked: "untrack", dryRun: true });
      expect(result).toMatchObject({ added: false, wouldAdd: true, applied: "untrack", trackedFiles: 3 });
      await expect(readFile(path.join(dir, ".gitignore"), "utf-8")).rejects.toThrow();
      expect(git(dir, "ls-files", "--", ".dr").trim().split("\n")).toHaveLength(3);
    });
  });

  it.serial("a dry run says the rule would be added and writes nothing", async () => {
    gitInit(dir);
    const result = await ensureDotDrIgnored(dir, { dryRun: true });
    expect(result).toMatchObject({ added: false, wouldAdd: true, ignored: false });
    await expect(readFile(path.join(dir, ".gitignore"), "utf-8")).rejects.toThrow();
  });

  it.serial("works outside git from the project's own .gitignore", async () => {
    const first = await ensureDotDrIgnored(dir);
    expect(first).toMatchObject({ added: true, ignored: true, gitChecked: false, trackedFiles: 0 });
    const second = await ensureDotDrIgnored(dir);
    expect(second).toMatchObject({ added: false, ignored: true });
    const text = await readFile(path.join(dir, ".gitignore"), "utf-8");
    expect(text.split(DOT_DR_IGNORE_LINE).length).toBe(2);
  });
});
