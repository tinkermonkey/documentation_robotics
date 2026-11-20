import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { excludePattern, largeFileHook, largeFileHookNote } from "../../../src/core/commit-size-hook.js";

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
        "Over the limit now: documentation-robotics/changesets/changeset-1/changes.yaml (600 KB)"
      );
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
