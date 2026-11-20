import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  commitHookNotes,
  excludePattern,
  largeFileHook,
  largeFileHookNote,
  prettierHook,
  prettierHookNote,
} from "../../../src/core/commit-hooks.js";

async function withProject(test: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "dr-size-hook-"));
  try {
    await mkdir(path.join(dir, "documentation-robotics", "changesets", "changeset-1"), { recursive: true });
    await mkdir(path.join(dir, "documentation-robotics", "model", "05_application"), { recursive: true });
    await test(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const config = (hook: string) =>
  `repos:\n  - repo: https://github.com/pre-commit/pre-commit-hooks\n    rev: v4.5.0\n    hooks:\n      - id: trailing-whitespace\n${hook}`;

describe("largeFileHook", () => {
  it("is null without a pre-commit config, or without the hook", async () => {
    await withProject(async (dir) => {
      expect(await largeFileHook(dir)).toBeNull();
      expect(largeFileHookNote(null)).toBeNull();
      await writeFile(path.join(dir, ".pre-commit-config.yaml"), config(""), "utf-8");
      expect(await largeFileHook(dir)).toBeNull();
    });
  });

  it("reads the limit and warns that a changeset's changes.yaml can be refused", async () => {
    await withProject(async (dir) => {
      await writeFile(
        path.join(dir, ".pre-commit-config.yaml"),
        config("      - id: check-added-large-files\n        args: [--maxkb=1000]\n        exclude: ^docs/logo/\n"),
        "utf-8"
      );
      const hook = await largeFileHook(dir);
      expect(hook).toMatchObject({
        limitKb: 1000,
        folder: "documentation-robotics",
        excludesChangesets: false,
        excludesModel: false,
        overLimit: [],
      });
      const note = largeFileHookNote(hook)!;
      expect(note).toContain("refuses a new file over 1000 KB");
      expect(note).toContain("exclude: ^documentation-robotics/changesets/");
      expect(note).toContain("dr does not edit hook configuration");
    });
  });

  it("uses pre-commit's default limit and names a file already over it", async () => {
    await withProject(async (dir) => {
      await writeFile(path.join(dir, ".pre-commit-config.yaml"), config("      - id: check-added-large-files\n"), "utf-8");
      await writeFile(
        path.join(dir, "documentation-robotics", "changesets", "changeset-1", "changes.yaml"),
        "x".repeat(600 * 1024),
        "utf-8"
      );
      const hook = await largeFileHook(dir);
      expect(hook!.limitKb).toBe(500);
      expect(hook!.overLimit).toEqual([{ path: "documentation-robotics/changesets/changeset-1/changes.yaml", kb: 600 }]);
      expect(largeFileHookNote(hook)).toContain(
        "1 file(s) over the limit now, largest first: documentation-robotics/changesets/changeset-1/changes.yaml (600 KB)"
      );
    });
  });

  it("counts every file over the limit, names the largest few, and names them all when asked", async () => {
    await withProject(async (dir) => {
      await writeFile(path.join(dir, ".pre-commit-config.yaml"), config("      - id: check-added-large-files\n"), "utf-8");
      for (let i = 1; i <= 5; i++) {
        const folder = path.join(dir, "documentation-robotics", "changesets", `changeset-${i}`);
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, "changes.yaml"), "x".repeat((500 + i * 10) * 1024), "utf-8");
      }
      const hook = await largeFileHook(dir);
      expect(hook!.overLimit.map((file) => file.kb)).toEqual([550, 540, 530, 520, 510]);

      const note = largeFileHookNote(hook)!;
      expect(note).toContain("5 file(s) over the limit now, largest first:");
      expect(note).toContain("changeset-3/changes.yaml (530 KB), and 2 more.");
      expect(note).not.toContain("changeset-1/changes.yaml");

      const full = largeFileHookNote(hook, { full: true })!;
      expect(full).toContain("changeset-1/changes.yaml (510 KB).");
      expect(full).not.toContain("more.");
    });
  });

  it("says nothing once the changesets folder is excluded, by the hook or the whole config", async () => {
    await withProject(async (dir) => {
      await writeFile(
        path.join(dir, ".pre-commit-config.yaml"),
        config("      - id: check-added-large-files\n        exclude: ^(docs/logo/|documentation-robotics/changesets/)\n"),
        "utf-8"
      );
      await writeFile(
        path.join(dir, "documentation-robotics", "changesets", "changeset-1", "changes.yaml"),
        "x".repeat(600 * 1024),
        "utf-8"
      );
      let hook = await largeFileHook(dir);
      expect(hook).toMatchObject({ excludesChangesets: true, excludesModel: false, overLimit: [] });
      expect(largeFileHookNote(hook)).toBeNull();

      // A model file over the limit is still worth saying
      await writeFile(
        path.join(dir, "documentation-robotics", "model", "05_application", "application_function.yaml"),
        "x".repeat(700 * 1024),
        "utf-8"
      );
      hook = await largeFileHook(dir);
      expect(largeFileHookNote(hook)).toContain("application_function.yaml (700 KB)");
      expect(largeFileHookNote(hook)).toContain("exclude: ^documentation-robotics/model/");

      await writeFile(
        path.join(dir, ".pre-commit-config.yaml"),
        `exclude: |\n  (?x)^(\n    documentation-robotics/ |  # dr's files\n    vendor/\n  )\n${config("      - id: check-added-large-files\n")}`,
        "utf-8"
      );
      hook = await largeFileHook(dir);
      expect(hook).toMatchObject({ excludesChangesets: true, excludesModel: true, overLimit: [] });
      expect(largeFileHookNote(hook)).toBeNull();
    });
  });

  it("translates verbose patterns and gives up quietly on ones it can't read", () => {
    expect(excludePattern("(?x)^(\n  a/ |\n  b/  # note\n)")!.test("b/file")).toBe(true);
    expect(excludePattern("^docs/")!.test("src/docs/x")).toBe(false);
    expect(excludePattern("(?P<name>x")).toBeNull();
    expect(excludePattern(undefined)).toBeNull();
  });
});

describe("prettierHook", () => {
  const prettier = (extra: string = "") =>
    `repos:\n  - repo: https://github.com/pre-commit/mirrors-prettier\n    rev: v4.0.0-alpha.8\n    hooks:\n      - id: prettier\n        types_or: [markdown, yaml, json]\n${extra}`;

  it("is null without a prettier hook", async () => {
    await withProject(async (dir) => {
      expect(await prettierHook(dir)).toBeNull();
      await writeFile(path.join(dir, ".pre-commit-config.yaml"), config("      - id: check-added-large-files\n"), "utf-8");
      expect(await prettierHook(dir)).toBeNull();
      expect(prettierHookNote(null)).toBeNull();
    });
  });

  it("says when the hook is still passed the files dr writes, with the exclude to add", async () => {
    await withProject(async (dir) => {
      // An exclude for other things doesn't cover the DR folder
      const text = prettier("        exclude: ^(CHANGELOG\\.md|vendor/)\n");
      await writeFile(path.join(dir, ".pre-commit-config.yaml"), text, "utf-8");
      const hook = await prettierHook(dir);
      expect(hook).toMatchObject({ folder: "documentation-robotics", skipsDrFiles: false });
      const note = prettierHookNote(hook)!;
      expect(note).toContain("prettier pre-commit hook is passed the files dr writes under documentation-robotics/");
      expect(note).toContain("a commit that holds only those files can then fail the hook");
      expect(note).toContain("exclude: ^documentation-robotics/");
      expect(note).toContain("dr does not edit hook configuration");
      expect(await commitHookNotes(dir)).toEqual([note]);
      // Nothing was edited
      expect(await readFile(path.join(dir, ".pre-commit-config.yaml"), "utf-8")).toBe(text);
    });
  });

  it("has nothing to say once the hook, or the whole config, excludes the folder", async () => {
    await withProject(async (dir) => {
      for (const text of [
        prettier("        exclude: ^(CHANGELOG\\.md|documentation-robotics/)\n"),
        `exclude: ^documentation-robotics/\n${prettier()}`,
        // Only code is passed to it
        prettier("        files: ^src/\n"),
      ]) {
        await writeFile(path.join(dir, ".pre-commit-config.yaml"), text, "utf-8");
        expect(await prettierHook(dir)).toMatchObject({ skipsDrFiles: true });
        expect(await commitHookNotes(dir)).toEqual([]);
      }
      // Excluding the changesets alone still hands it the model
      await writeFile(
        path.join(dir, ".pre-commit-config.yaml"),
        prettier("        exclude: ^documentation-robotics/changesets/\n"),
        "utf-8"
      );
      expect(await prettierHook(dir)).toMatchObject({ skipsDrFiles: false });
    });
  });

  it("finds a locally defined prettier hook by its entry, and gives both notes when both hooks apply", async () => {
    await withProject(async (dir) => {
      await writeFile(
        path.join(dir, ".pre-commit-config.yaml"),
        "repos:\n  - repo: local\n    hooks:\n      - id: format\n        entry: npx prettier --write\n        language: system\n" +
          "  - repo: https://github.com/pre-commit/pre-commit-hooks\n    hooks:\n      - id: check-added-large-files\n",
        "utf-8"
      );
      const notes = await commitHookNotes(dir);
      expect(notes).toHaveLength(2);
      expect(notes[0]).toContain("prettier pre-commit hook");
      expect(notes[1]).toContain("check-added-large-files pre-commit hook refuses a new file over 500 KB");
    });
  });
});
