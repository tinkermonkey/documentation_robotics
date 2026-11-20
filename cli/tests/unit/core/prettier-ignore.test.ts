import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ensurePrettierIgnoresDrFiles,
  prettierIgnoreNote,
  prettierSignals,
} from "../../../src/core/prettier-ignore.js";

function gitInit(cwd: string) {
  const result = spawnSync("git", ["init", "-q"], { cwd, stdio: "pipe", encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`git init failed: ${result.stderr}`);
}

// Each test gets its own temp folder: the unit run is --concurrent, so a folder shared through
// beforeEach would be swapped under a test still running.
const folders: string[] = [];
async function freshDir(): Promise<string> {
  // realpath: macOS tmpdir is a symlink, and git reports the resolved path.
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), "dr-prettier-ignore-")));
  folders.push(folder);
  return folder;
}

afterAll(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

describe("ensurePrettierIgnoresDrFiles", () => {

  describe("detection", () => {
    it("finds a .prettierrc file in any of its spellings, and prettier.config.*", async () => {
      const dir = await freshDir();
      const ignoreFile = (root = dir) => path.join(root, ".prettierignore");
      for (const name of [".prettierrc", ".prettierrc.json", ".prettierrc.yaml", ".prettierrc.mjs", "prettier.config.cjs"]) {
        const folder = path.join(dir, name.replace(/^\./, "dot-"));
        await mkdir(folder);
        await writeFile(path.join(folder, name), "{}", "utf-8");
        expect(await prettierSignals(folder)).toEqual([name]);
      }
    });

    it("finds a prettier key, dependency or devDependency in package.json", async () => {

      const dir = await freshDir();

      const ignoreFile = (root = dir) => path.join(root, ".prettierignore");
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ prettier: "@company/prettier-config" }, "package.json prettier"],
        [{ dependencies: { prettier: "^3.0.0" } }, "package.json dependencies"],
        [{ devDependencies: { prettier: "^3.0.0" } }, "package.json devDependencies"],
      ];
      for (const [pkg, signal] of cases) {
        await writeFile(path.join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
        expect(await prettierSignals(dir)).toEqual([signal]);
      }
    });

    it("finds a prettier pre-commit hook by repo or hook id, not a comment", async () => {

      const dir = await freshDir();

      const ignoreFile = (root = dir) => path.join(root, ".prettierignore");
      const mirror = "repos:\n  - repo: https://github.com/pre-commit/mirrors-prettier\n    rev: v3.1.0\n    hooks:\n      - id: prettier\n";
      await writeFile(path.join(dir, ".pre-commit-config.yaml"), mirror, "utf-8");
      expect(await prettierSignals(dir)).toEqual([".pre-commit-config.yaml"]);

      const local = "repos:\n  - repo: local\n    hooks:\n      - id: format\n        entry: npx prettier --write\n        language: system\n";
      await writeFile(path.join(dir, ".pre-commit-config.yaml"), local, "utf-8");
      expect(await prettierSignals(dir)).toEqual([".pre-commit-config.yaml"]);

      const other = "# prettier is run by CI\nrepos:\n  - repo: https://github.com/pre-commit/pre-commit-hooks\n    hooks:\n      - id: end-of-file-fixer\n";
      await writeFile(path.join(dir, ".pre-commit-config.yaml"), other, "utf-8");
      expect(await prettierSignals(dir)).toEqual([]);
    });

    it("writes nothing when the project doesn't use prettier", async () => {

      const dir = await freshDir();

      const ignoreFile = (root = dir) => path.join(root, ".prettierignore");
      await writeFile(path.join(dir, "package.json"), JSON.stringify({ devDependencies: { eslint: "^9" } }), "utf-8");
      const result = await ensurePrettierIgnoresDrFiles(dir);
      expect(result).toEqual({ status: "not-using-prettier", signals: [] });
      expect(await Bun.file(ignoreFile()).exists()).toBe(false);
      expect(prettierIgnoreNote(result)).toBeNull();
    });
  });

  it("creates .prettierignore with the changesets and model folders (#1155, #1246)", async () => {

    const dir = await freshDir();

    const ignoreFile = (root = dir) => path.join(root, ".prettierignore");
    await writeFile(path.join(dir, ".prettierrc"), "{}", "utf-8");
    const result = await ensurePrettierIgnoresDrFiles(dir);
    expect(result).toEqual({
      status: "added",
      path: ignoreFile(),
      entries: ["documentation-robotics/changesets/", "documentation-robotics/model/"],
      signals: [".prettierrc"],
    });
    const text = await readFile(ignoreFile(), "utf-8");
    expect(text.startsWith("# Documentation Robotics")).toBe(true);
    expect(text.endsWith("\ndocumentation-robotics/changesets/\ndocumentation-robotics/model/\n")).toBe(true);
    expect(prettierIgnoreNote(result)).toContain(
      `Added documentation-robotics/changesets/ and documentation-robotics/model/ to ${ignoreFile()}`
    );
    // Named relative to the project when the caller gives its root
    expect(prettierIgnoreNote(result, dir)).toContain("documentation-robotics/model/ to .prettierignore so");
  });

  it("appends to an existing file, keeping its lines, and doesn't add the entry twice", async () => {

    const dir = await freshDir();

    const ignoreFile = (root = dir) => path.join(root, ".prettierignore");
    await writeFile(path.join(dir, ".prettierrc"), "{}", "utf-8");
    await writeFile(ignoreFile(), "dist\n# generated\ncoverage", "utf-8");

    expect((await ensurePrettierIgnoresDrFiles(dir)).status).toBe("added");
    const text = await readFile(ignoreFile(), "utf-8");
    expect(text.startsWith("dist\n# generated\ncoverage\n\n# Documentation Robotics")).toBe(true);
    expect(text.endsWith("documentation-robotics/changesets/\ndocumentation-robotics/model/\n")).toBe(true);

    const again = await ensurePrettierIgnoresDrFiles(dir);
    expect(again.status).toBe("present");
    expect(again.entries).toEqual(["documentation-robotics/changesets/", "documentation-robotics/model/"]);
    expect(await readFile(ignoreFile(), "utf-8")).toBe(text);
  });

  it("adds the model folder inside the block an earlier dr wrote for the changesets (#1246)", async () => {
    const dir = await freshDir();
    const ignoreFile = path.join(dir, ".prettierignore");
    await writeFile(path.join(dir, ".prettierrc"), "{}", "utf-8");
    // What dr 0.6.0 wrote (#1155), with the developer's own lines around it
    await writeFile(
      ignoreFile,
      "dist\n\n# Documentation Robotics: dr writes its changeset files in its own layout\ndocumentation-robotics/changesets/\n\n# mine\ncoverage\n",
      "utf-8"
    );

    const dry = await ensurePrettierIgnoresDrFiles(dir, { dryRun: true });
    expect(dry).toMatchObject({ status: "missing", entries: ["documentation-robotics/model/"] });

    const result = await ensurePrettierIgnoresDrFiles(dir);
    expect(result).toMatchObject({ status: "added", entries: ["documentation-robotics/model/"] });
    expect(await readFile(ignoreFile, "utf-8")).toBe(
      "dist\n\n# Documentation Robotics: dr writes its model and changeset files in its own layout\ndocumentation-robotics/changesets/\ndocumentation-robotics/model/\n\n# mine\ncoverage\n"
    );
    expect((await ensurePrettierIgnoresDrFiles(dir)).status).toBe("present");
  });

  it("keeps a CRLF file's line endings", async () => {

    const dir = await freshDir();

    const ignoreFile = (root = dir) => path.join(root, ".prettierignore");
    await writeFile(path.join(dir, ".prettierrc"), "{}", "utf-8");
    await writeFile(ignoreFile(), "dist\r\n", "utf-8");
    await ensurePrettierIgnoresDrFiles(dir);
    expect(await readFile(ignoreFile(), "utf-8")).toMatch(/^dist\r\n\r\n# Documentation Robotics[^\n]*\r\ndocumentation-robotics\/changesets\/\r\ndocumentation-robotics\/model\/\r\n$/);
  });

  it("treats an equivalent spelling, or a folder above, as already present", async () => {

    const dir = await freshDir();

    const ignoreFile = (root = dir) => path.join(root, ".prettierignore");
    await writeFile(path.join(dir, ".prettierrc"), "{}", "utf-8");
    for (const lines of [
      "/documentation-robotics/changesets\n/documentation-robotics/model",
      "documentation-robotics/changesets/**\ndocumentation-robotics/model/**",
      "documentation-robotics/",
    ]) {
      await writeFile(ignoreFile(), `dist\n${lines}\n`, "utf-8");
      expect((await ensurePrettierIgnoresDrFiles(dir)).status).toBe("present");
      expect(await readFile(ignoreFile(), "utf-8")).toBe(`dist\n${lines}\n`);
    }
    // A comment doesn't count, and each folder is checked on its own: only the missing one is added.
    await writeFile(ignoreFile(), "# documentation-robotics/changesets/\ndocumentation-robotics/model/\n", "utf-8");
    const result = await ensurePrettierIgnoresDrFiles(dir);
    expect(result).toMatchObject({ status: "added", entries: ["documentation-robotics/changesets/"] });
  });

  it.serial("writes at the repository root, with the path from there, when prettier is configured there", async () => {

    const dir = await freshDir();

    const ignoreFile = (root = dir) => path.join(root, ".prettierignore");
    gitInit(dir);
    await writeFile(path.join(dir, ".pre-commit-config.yaml"), "repos:\n  - repo: https://github.com/pre-commit/mirrors-prettier\n    hooks:\n      - id: prettier\n", "utf-8");
    const project = path.join(dir, "services", "api");
    await mkdir(project, { recursive: true });

    const result = await ensurePrettierIgnoresDrFiles(project);
    expect(result).toMatchObject({
      status: "added",
      path: ignoreFile(dir),
      entries: ["services/api/documentation-robotics/changesets/", "services/api/documentation-robotics/model/"],
    });
    expect(await Bun.file(ignoreFile(project)).exists()).toBe(false);
  });

  it.serial("writes at the project root when only the project configures prettier", async () => {

    const dir = await freshDir();

    const ignoreFile = (root = dir) => path.join(root, ".prettierignore");
    gitInit(dir);
    const project = path.join(dir, "web");
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, "package.json"), JSON.stringify({ devDependencies: { prettier: "^3" } }), "utf-8");

    const result = await ensurePrettierIgnoresDrFiles(project);
    expect(result).toMatchObject({
      status: "added",
      path: ignoreFile(project),
      entries: ["documentation-robotics/changesets/", "documentation-robotics/model/"],
    });
    expect(await Bun.file(ignoreFile(dir)).exists()).toBe(false);
  });
});
