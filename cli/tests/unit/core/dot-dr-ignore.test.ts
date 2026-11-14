import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DOT_DR_IGNORE_LINE, dotDrIgnoreWarnings, ensureDotDrIgnored } from "../../../src/core/dot-dr-ignore.js";

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

  it("creates .gitignore with /.dr/ in a git repository that has none", async () => {
    gitInit(dir);
    const result = await ensureDotDrIgnored(dir);
    expect(result).toMatchObject({ added: true, ignored: true, negated: false, trackedFiles: 0, gitChecked: true });
    expect(await readFile(path.join(dir, ".gitignore"), "utf-8")).toContain(`${DOT_DR_IGNORE_LINE}\n`);
    expect(git(dir, "check-ignore", ".dr/").trim()).toBe(".dr/");
    expect(dotDrIgnoreWarnings(result)).toEqual([]);
  });

  it("appends to an existing .gitignore, keeping the developer's lines", async () => {
    gitInit(dir);
    await writeFile(path.join(dir, ".gitignore"), "node_modules/\ndist", "utf-8");
    const result = await ensureDotDrIgnored(dir);
    expect(result.added).toBe(true);
    const text = await readFile(path.join(dir, ".gitignore"), "utf-8");
    expect(text.startsWith("node_modules/\ndist\n\n# Documentation Robotics")).toBe(true);
    expect(text.endsWith(`${DOT_DR_IGNORE_LINE}\n`)).toBe(true);
  });

  it("changes nothing when .dr/ is already ignored, in any spelling", async () => {
    gitInit(dir);
    await writeFile(path.join(dir, ".gitignore"), ".dr\n", "utf-8");
    const result = await ensureDotDrIgnored(dir);
    expect(result).toMatchObject({ added: false, ignored: true });
    expect(await readFile(path.join(dir, ".gitignore"), "utf-8")).toBe(".dr\n");
  });

  it("sees an ignore rule in a parent folder's .gitignore", async () => {
    gitInit(dir);
    await writeFile(path.join(dir, ".gitignore"), ".dr/\n", "utf-8");
    const project = path.join(dir, "services", "orders");
    await mkdir(project, { recursive: true });
    const result = await ensureDotDrIgnored(project);
    expect(result).toMatchObject({ added: false, ignored: true, gitChecked: true });
    await expect(readFile(path.join(project, ".gitignore"), "utf-8")).rejects.toThrow();
  });

  it("leaves a negation alone and warns", async () => {
    gitInit(dir);
    await writeFile(path.join(dir, ".gitignore"), "*\n!/.dr/\n", "utf-8");
    const result = await ensureDotDrIgnored(dir);
    expect(result).toMatchObject({ added: false, negated: true });
    expect(await readFile(path.join(dir, ".gitignore"), "utf-8")).toBe("*\n!/.dr/\n");
    expect(dotDrIgnoreWarnings(result).join(" ")).toContain("un-ignores .dr/");
  });

  it("reports files git already tracks under .dr/", async () => {
    gitInit(dir);
    await mkdir(path.join(dir, ".dr"), { recursive: true });
    await writeFile(path.join(dir, ".dr", "state.json"), "{}", "utf-8");
    git(dir, "add", ".dr/state.json");
    git(dir, "commit", "-q", "-m", "track .dr");
    const result = await ensureDotDrIgnored(dir);
    expect(result).toMatchObject({ added: true, ignored: true, trackedFiles: 1 });
    expect(dotDrIgnoreWarnings(result).join(" ")).toContain("git rm -r --cached .dr");
  });

  it("works outside git from the project's own .gitignore", async () => {
    const first = await ensureDotDrIgnored(dir);
    expect(first).toMatchObject({ added: true, ignored: true, gitChecked: false, trackedFiles: 0 });
    const second = await ensureDotDrIgnored(dir);
    expect(second).toMatchObject({ added: false, ignored: true });
    const text = await readFile(path.join(dir, ".gitignore"), "utf-8");
    expect(text.split(DOT_DR_IGNORE_LINE).length).toBe(2);
  });
});
