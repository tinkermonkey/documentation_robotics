/**
 * ensureCbmIgnore: codebase-memory-mcp has no exclude argument, so DR keeps its own folders
 * (documentation-robotics/, .dr/) out of the index through a .cbmignore at the codebase root
 * (round 2, bug 9: an uncommitted changeset grew the index from 5,375 to 5,525 nodes). In a git
 * work tree DR's file is hidden from git through the local exclude, and a .cbmignore the developer
 * owns is never edited (#1300: a read-only run must leave a frozen review tag's tree as it was).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCbmIgnore, excludeFromGit } from "../../../src/analyzers/cbm-analyzer.js";

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `dr-cbmignore-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ensureCbmIgnore outside a git work tree", () => {
  it("creates the file with DR's folders when there is none", async () => {
    const result = await ensureCbmIgnore(root, root);
    expect(result).toEqual({ path: join(root, ".cbmignore"), added: ["/documentation-robotics/", "/.dr/"], created: true });
    const text = await readFile(join(root, ".cbmignore"), "utf-8");
    expect(text).toMatch(/^# Added by Documentation Robotics/);
    expect(text.endsWith("/documentation-robotics/\n/.dr/\n")).toBe(true);
  });

  it("changes nothing the second time", async () => {
    await ensureCbmIgnore(root, root);
    const before = await readFile(join(root, ".cbmignore"), "utf-8");
    expect(await ensureCbmIgnore(root, root)).toEqual({ path: join(root, ".cbmignore"), added: [], created: false });
    expect(await readFile(join(root, ".cbmignore"), "utf-8")).toBe(before);
  });

  it("keeps the developer's lines, and adds only the folders they don't list in any spelling", async () => {
    await writeFile(join(root, ".cbmignore"), "fixtures/\ndocumentation-robotics");
    const result = await ensureCbmIgnore(root, root);
    expect(result.added).toEqual(["/.dr/"]);
    const text = await readFile(join(root, ".cbmignore"), "utf-8");
    expect(text.startsWith("fixtures/\ndocumentation-robotics\n\n# Added by Documentation Robotics")).toBe(true);
    expect(text.endsWith("/.dr/\n")).toBe(true);
  });

  it("leaves alone a folder the developer negates (review)", async () => {
    await writeFile(join(root, ".cbmignore"), "!/documentation-robotics/\n");
    const result = await ensureCbmIgnore(root, root);
    expect(result.added).toEqual(["/.dr/"]);
    const text = await readFile(join(root, ".cbmignore"), "utf-8");
    expect(text).not.toContain("\n/documentation-robotics/");
    expect(text.startsWith("!/documentation-robotics/\n")).toBe(true);
  });

  it("names the folders relative to a codebase root above the project", async () => {
    const project = join(root, "services", "api");
    const result = await ensureCbmIgnore(root, project);
    expect(result.added).toEqual(["/services/api/documentation-robotics/", "/services/api/.dr/"]);
  });

  it("does nothing when DR's folders lie outside the codebase root", async () => {
    const code = join(root, "src");
    await mkdir(code);
    expect((await ensureCbmIgnore(code, root)).added).toEqual([]);
    expect(await Bun.file(join(code, ".cbmignore")).exists()).toBe(false);
  });
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** A repository at `root` with one committed source file; its status is clean. */
async function repo(): Promise<string> {
  root = await realpath(root);
  git(root, "init", "-q");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const app = 1;\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}

const status = (dir: string) => git(dir, "status", "--porcelain", "--untracked-files=all");

describe("ensureCbmIgnore in a git work tree (#1300)", () => {
  it("writes DR's .cbmignore and hides it from git through the local exclude: the tree is unchanged", async () => {
    await repo();
    const result = await ensureCbmIgnore(root, root);
    const exclude = join(root, ".git", "info", "exclude");
    expect(result).toEqual({
      path: join(root, ".cbmignore"),
      added: ["/documentation-robotics/", "/.dr/"],
      created: true,
      excludedBy: exclude,
    });
    expect(status(root)).toBe("");
    const excluded = await readFile(exclude, "utf-8");
    expect(excluded).toContain("# Added by Documentation Robotics: its .cbmignore is local analyzer configuration, not code.\n/.cbmignore\n");
    // The analyzer still reads it.
    expect(await readFile(join(root, ".cbmignore"), "utf-8")).toContain("/documentation-robotics/\n/.dr/\n");

    // Once is enough: nothing to report, and the exclude file isn't written twice.
    expect(await ensureCbmIgnore(root, root)).toEqual({ path: join(root, ".cbmignore"), added: [], created: false });
    expect(await readFile(exclude, "utf-8")).toBe(excluded);
  });

  it("never edits a .cbmignore the developer tracks: it reports the lines it lacks", async () => {
    await repo();
    await writeFile(join(root, ".cbmignore"), "fixtures/\n");
    git(root, "add", ".cbmignore");
    git(root, "commit", "-qm", "ignore fixtures");
    const result = await ensureCbmIgnore(root, root);
    expect(result).toEqual({ path: join(root, ".cbmignore"), added: [], created: false, missing: ["/documentation-robotics/", "/.dr/"] });
    expect(await readFile(join(root, ".cbmignore"), "utf-8")).toBe("fixtures/\n");
    expect(status(root)).toBe("");
  });

  it("leaves alone a tracked .cbmignore that already lists DR's folders (this repository's own)", async () => {
    await repo();
    await writeFile(join(root, ".cbmignore"), "# Added by Documentation Robotics: its model, changesets and analyzer state are not code.\n/documentation-robotics/\n/.dr/\n");
    git(root, "add", ".cbmignore");
    git(root, "commit", "-qm", "ignore");
    expect(await ensureCbmIgnore(root, root)).toEqual({ path: join(root, ".cbmignore"), added: [], created: false });
    expect(status(root)).toBe("");
    expect(await Bun.file(join(root, ".git", "info", "exclude")).text()).not.toContain("/.cbmignore");
  });

  it("never edits the developer's untracked .cbmignore either", async () => {
    await repo();
    await writeFile(join(root, ".cbmignore"), "build/\n");
    const result = await ensureCbmIgnore(root, root);
    expect(result.missing).toEqual(["/documentation-robotics/", "/.dr/"]);
    expect(result.added).toEqual([]);
    expect(await readFile(join(root, ".cbmignore"), "utf-8")).toBe("build/\n");
    // Still the developer's to commit: not hidden.
    expect(status(root)).toBe("?? .cbmignore");
  });

  it("hides a .cbmignore an older DR wrote and nobody committed", async () => {
    await repo();
    await writeFile(join(root, ".cbmignore"), "# Added by Documentation Robotics: its model, changesets and analyzer state are not code.\n/documentation-robotics/\n/.dr/\n");
    expect(status(root)).toBe("?? .cbmignore");
    const result = await ensureCbmIgnore(root, root);
    expect(result.added).toEqual([]);
    expect(result.excludedBy).toBe(join(root, ".git", "info", "exclude"));
    expect(status(root)).toBe("");
  });

  it("adds to DR's own file once git ignores it, without touching the exclude file again", async () => {
    await repo();
    await ensureCbmIgnore(join(root, "src"), root); // nothing inside src: no file
    expect(await Bun.file(join(root, "src", ".cbmignore")).exists()).toBe(false);
    await writeFile(join(root, ".gitignore"), ".cbmignore\n");
    git(root, "add", ".gitignore");
    git(root, "commit", "-qm", "ignore it");
    await writeFile(join(root, ".cbmignore"), "/documentation-robotics/\n");
    const result = await ensureCbmIgnore(root, root);
    expect(result.added).toEqual(["/.dr/"]);
    expect(result.excludedBy).toBeUndefined();
    expect(status(root)).toBe("");
  });

  it("names the exclude entry from the repository's top for a codebase root below it, and in a worktree", async () => {
    await repo();
    const code = join(root, "services", "api");
    await mkdir(code, { recursive: true });
    const result = await ensureCbmIgnore(code, code);
    expect(result.excludedBy).toBe(join(root, ".git", "info", "exclude"));
    expect(await readFile(join(root, ".git", "info", "exclude"), "utf-8")).toContain("\n/services/api/.cbmignore\n");
    expect(status(root)).toBe("");

    // A worktree shares the repository's exclude file, and its own tree stays clean too.
    const tree = join(root, "..", `${root.split("/").pop()}-wt`);
    git(root, "worktree", "add", "-q", tree, "-b", "wt");
    try {
      const inTree = await ensureCbmIgnore(tree, tree);
      expect(inTree.excludedBy).toBe(join(root, ".git", "info", "exclude"));
      expect(status(tree)).toBe("");
    } finally {
      await rm(tree, { recursive: true, force: true });
    }
  });

  it("excludeFromGit returns null outside a git work tree", async () => {
    expect(await excludeFromGit(root, ".cbmignore")).toBeNull();
  });
});
