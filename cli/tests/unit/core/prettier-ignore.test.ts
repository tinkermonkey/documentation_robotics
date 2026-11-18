import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ensurePrettierIgnoresChangesets,
  prettierIgnoreNote,
  prettierSignals,
} from "../../../src/core/prettier-ignore.js";

function gitInit(cwd: string) {
  const result = spawnSync("git", ["init", "-q"], { cwd, stdio: "pipe", encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`git init failed: ${result.stderr}`);
}

describe("ensurePrettierIgnoresChangesets", () => {
  let dir: string;

  beforeEach(async () => {
    // realpath: macOS tmpdir is a symlink, and git reports the resolved path.
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "dr-prettier-ignore-")));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const ignoreFile = (root = dir) => path.join(root, ".prettierignore");

  describe("detection", () => {
    it("finds a .prettierrc file in any of its spellings, and prettier.config.*", async () => {
      for (const name of [".prettierrc", ".prettierrc.json", ".prettierrc.yaml", ".prettierrc.mjs", "prettier.config.cjs"]) {
        const folder = path.join(dir, name.replace(/^\./, "dot-"));
        await mkdir(folder);
        await writeFile(path.join(folder, name), "{}", "utf-8");
        expect(await prettierSignals(folder)).toEqual([name]);
      }
    });

    it("finds a prettier key, dependency or devDependency in package.json", async () => {
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
      await writeFile(path.join(dir, "package.json"), JSON.stringify({ devDependencies: { eslint: "^9" } }), "utf-8");
      const result = await ensurePrettierIgnoresChangesets(dir);
      expect(result).toEqual({ status: "not-using-prettier", signals: [] });
      expect(await Bun.file(ignoreFile()).exists()).toBe(false);
      expect(prettierIgnoreNote(result)).toBeNull();
    });
  });

  it("creates .prettierignore with the changesets folder", async () => {
    await writeFile(path.join(dir, ".prettierrc"), "{}", "utf-8");
    const result = await ensurePrettierIgnoresChangesets(dir);
    expect(result).toEqual({
      status: "added",
      path: ignoreFile(),
      entry: "documentation-robotics/changesets/",
      signals: [".prettierrc"],
    });
    const text = await readFile(ignoreFile(), "utf-8");
    expect(text.startsWith("# Documentation Robotics")).toBe(true);
    expect(text.endsWith("\ndocumentation-robotics/changesets/\n")).toBe(true);
    expect(prettierIgnoreNote(result)).toContain(`Added documentation-robotics/changesets/ to ${ignoreFile()}`);
  });

  it("appends to an existing file, keeping its lines, and doesn't add the entry twice", async () => {
    await writeFile(path.join(dir, ".prettierrc"), "{}", "utf-8");
    await writeFile(ignoreFile(), "dist\n# generated\ncoverage", "utf-8");

    expect((await ensurePrettierIgnoresChangesets(dir)).status).toBe("added");
    const text = await readFile(ignoreFile(), "utf-8");
    expect(text.startsWith("dist\n# generated\ncoverage\n\n# Documentation Robotics")).toBe(true);
    expect(text.endsWith("documentation-robotics/changesets/\n")).toBe(true);

    expect((await ensurePrettierIgnoresChangesets(dir)).status).toBe("present");
    expect(await readFile(ignoreFile(), "utf-8")).toBe(text);
  });

  it("keeps a CRLF file's line endings", async () => {
    await writeFile(path.join(dir, ".prettierrc"), "{}", "utf-8");
    await writeFile(ignoreFile(), "dist\r\n", "utf-8");
    await ensurePrettierIgnoresChangesets(dir);
    expect(await readFile(ignoreFile(), "utf-8")).toMatch(/^dist\r\n\r\n# Documentation Robotics[^\n]*\r\ndocumentation-robotics\/changesets\/\r\n$/);
  });

  it("treats an equivalent spelling, or a folder above, as already present", async () => {
    await writeFile(path.join(dir, ".prettierrc"), "{}", "utf-8");
    for (const line of [
      "/documentation-robotics/changesets",
      "documentation-robotics/changesets/**",
      "documentation-robotics/",
    ]) {
      await writeFile(ignoreFile(), `dist\n${line}\n`, "utf-8");
      expect((await ensurePrettierIgnoresChangesets(dir)).status).toBe("present");
      expect(await readFile(ignoreFile(), "utf-8")).toBe(`dist\n${line}\n`);
    }
    // A comment or a sibling folder doesn't count.
    await writeFile(ignoreFile(), "# documentation-robotics/changesets/\ndocumentation-robotics/model/\n", "utf-8");
    expect((await ensurePrettierIgnoresChangesets(dir)).status).toBe("added");
  });

  it.serial("writes at the repository root, with the path from there, when prettier is configured there", async () => {
    gitInit(dir);
    await writeFile(path.join(dir, ".pre-commit-config.yaml"), "repos:\n  - repo: https://github.com/pre-commit/mirrors-prettier\n    hooks:\n      - id: prettier\n", "utf-8");
    const project = path.join(dir, "services", "api");
    await mkdir(project, { recursive: true });

    const result = await ensurePrettierIgnoresChangesets(project);
    expect(result).toMatchObject({
      status: "added",
      path: ignoreFile(dir),
      entry: "services/api/documentation-robotics/changesets/",
    });
    expect(await Bun.file(ignoreFile(project)).exists()).toBe(false);
  });

  it.serial("writes at the project root when only the project configures prettier", async () => {
    gitInit(dir);
    const project = path.join(dir, "web");
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, "package.json"), JSON.stringify({ devDependencies: { prettier: "^3" } }), "utf-8");

    const result = await ensurePrettierIgnoresChangesets(project);
    expect(result).toMatchObject({
      status: "added",
      path: ignoreFile(project),
      entry: "documentation-robotics/changesets/",
    });
    expect(await Bun.file(ignoreFile(dir)).exists()).toBe(false);
  });
});
