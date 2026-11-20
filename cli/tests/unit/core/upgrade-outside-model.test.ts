import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  outsideModelLines,
  scanOutsideModel,
  touchesOutsideModel,
  type IntegrationPlan,
  type OutsideModel,
} from "../../../src/core/upgrade-outside-model.js";
import type { UpgradeScan } from "../../../src/core/upgrade-plan.js";

const scan = (overrides: Partial<UpgradeScan> = {}): UpgradeScan => ({
  projectRoot: "/project",
  bundledSpecVersion: "0.14.0",
  installedSpecVersion: null,
  model: { state: "found", specVersion: "0.13.0", targetSpecVersion: "0.14.0" },
  actions: [],
  steps: [],
  ...overrides,
});

const copilot = (overrides: Partial<IntegrationPlan> = {}): IntegrationPlan => ({
  name: "copilot",
  label: "GitHub Copilot",
  folder: ".github",
  fromVersion: "0.5.0",
  toVersion: "0.6.0",
  upgrade: true,
  files: [
    { path: ".github/agents/dr-advisor.md", action: "update" },
    { path: ".github/agents/dr-architect.md", action: "overwrite" },
    { path: ".github/skills/dr_change_planning/SKILL.md", action: "add" },
    { path: ".github/skills/dr_03_security_layer/SKILL.md", action: "remove" },
  ],
  kept: [],
  versionFile: ".github/.dr-copilot-version",
  stale: [".github/skills/dr_layer_02_business/"],
  changed: [],
  ...overrides,
});

describe("scanOutsideModel (#1165)", () => {
  it("finds what an upgrade would touch outside the model, and writes none of it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dr-outside-model-"));
    try {
      await mkdir(path.join(dir, "documentation-robotics", "model"), { recursive: true });
      await writeFile(path.join(dir, ".prettierrc"), "{}", "utf-8");
      const hook =
        "repos:\n  - repo: https://github.com/pre-commit/pre-commit-hooks\n    hooks:\n      - id: check-added-large-files\n";
      await writeFile(path.join(dir, ".pre-commit-config.yaml"), hook, "utf-8");

      const outside = await scanOutsideModel(
        dir,
        scan({ projectRoot: dir, actions: [{ type: "spec", description: "Install spec reference", toVersion: "0.14.0" }] })
      );
      expect(outside.errors).toEqual([]);
      expect(outside.specReference!.description).toContain("Install spec reference (v0.14.0): .dr/spec/");
      expect(outside.reports!.files).toEqual([
        "documentation-robotics/reports/ (13 layer reports)",
        "documentation-robotics/README.md",
      ]);
      expect(outside.gitignore).toEqual({ path: ".gitignore", add: ["/.dr/"] });
      expect(outside.prettierignore).toEqual({
        path: ".prettierignore",
        add: ["documentation-robotics/"],
      });
      expect(outside.commitHooks).toHaveLength(1);
      expect(outside.commitHooks![0]).toContain("refuses a new file over 500 KB");
      expect(touchesOutsideModel(outside)).toBe(true);

      await expect(readFile(path.join(dir, ".gitignore"), "utf-8")).rejects.toThrow();
      await expect(readFile(path.join(dir, ".prettierignore"), "utf-8")).rejects.toThrow();
      expect(await readFile(path.join(dir, ".pre-commit-config.yaml"), "utf-8")).toBe(hook);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("has nothing to list for a project where it is all in place", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dr-outside-model-"));
    try {
      await mkdir(path.join(dir, "documentation-robotics", "reports"), { recursive: true });
      await writeFile(path.join(dir, "documentation-robotics", "reports", "01-motivation-layer-report.md"), "#", "utf-8");
      await writeFile(path.join(dir, ".gitignore"), "/.dr/\n", "utf-8");
      const outside = await scanOutsideModel(dir, scan({ projectRoot: dir }));
      expect(outside).toEqual({ errors: [] });
      expect(touchesOutsideModel(outside)).toBe(false);
      expect(outsideModelLines(outside, [])).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("outsideModelLines (#1165)", () => {
  const outside: OutsideModel = {
    specReference: { folder: ".dr/", description: "Install spec reference (v0.14.0): .dr/spec/ (15 files)" },
    reports: { files: ["documentation-robotics/reports/ (13 layer reports)", "documentation-robotics/README.md"] },
    gitignore: { path: ".gitignore", add: ["/.dr/"] },
    prettierignore: { path: ".prettierignore", add: ["documentation-robotics/"] },
    errors: [],
  };

  it("groups every file with what happens to it", () => {
    const text = outsideModelLines(outside, [copilot()]).join("\n");
    expect(text).toContain("  Spec reference\n    Install spec reference (v0.14.0)");
    expect(text).toContain("  GitHub Copilot integration (.github/): 0.5.0 → 0.6.0, 5 file(s)");
    expect(text).toContain("    update    .github/agents/dr-advisor.md");
    expect(text).toContain("    overwrite .github/agents/dr-architect.md  (edited in this project; the edit is replaced)");
    expect(text).toContain("    add       .github/skills/dr_change_planning/SKILL.md");
    expect(text).toContain("    remove    .github/skills/dr_03_security_layer/SKILL.md");
    expect(text).toContain("    update    .github/.dr-copilot-version");
    expect(text).toContain("    stale     .github/skills/dr_layer_02_business/");
    expect(text).toContain("--remove-stale");
    expect(text).toContain("  Reports (none yet)\n    generate  documentation-robotics/reports/ (13 layer reports)");
    expect(text).toContain("    add       /.dr/ to .gitignore");
    expect(text).toContain("    add       documentation-robotics/ to .prettierignore");
  });

  it("shortens a long integration list by default, with the true count and the way to see it all", () => {
    const files = Array.from({ length: 110 }, (_, i) => ({
      path: `.github/skills/dr_skill_${String(i + 1).padStart(3, "0")}/SKILL.md`,
      action: "update" as const,
    }));
    const lines = outsideModelLines({ errors: [] }, [copilot({ files, stale: [] })]);
    // The heading counts every file (and the version file), whatever is listed under it
    expect(lines[0]).toBe("  GitHub Copilot integration (.github/): 0.5.0 → 0.6.0, 111 file(s)");
    expect(lines.filter((line) => line.includes("dr_skill_"))).toHaveLength(40);
    expect(lines.join("\n")).toContain("...and 70 more of 110 file(s); dr upgrade --dry-run --full lists them all");
    expect(lines.join("\n")).toContain("update    .github/.dr-copilot-version");

    const full = outsideModelLines({ errors: [] }, [copilot({ files, stale: [] })], { full: true });
    expect(full[0]).toBe(lines[0]);
    expect(full.filter((line) => line.includes("dr_skill_"))).toHaveLength(110);
    expect(full.join("\n")).toContain("dr_skill_110/SKILL.md");
    expect(full.join("\n")).not.toContain("more of");
  });

  it("lists only the stale entries of an integration that needs no upgrade", () => {
    const lines = outsideModelLines({ errors: [] }, [copilot({ upgrade: false, files: [] })]);
    expect(lines[0]).toBe("  GitHub Copilot integration (.github/): up to date (v0.6.0)");
    expect(lines.join("\n")).not.toContain(".dr-copilot-version");
    expect(lines.join("\n")).toContain("stale     .github/skills/dr_layer_02_business/");
    expect(touchesOutsideModel({ errors: [] }, [copilot({ upgrade: false, files: [], stale: [] })])).toBe(false);
    const changed = outsideModelLines({ errors: [] }, [copilot({ upgrade: false, files: [], stale: [], changed: [".github/agents/dr-helper.md"] })]).join("\n");
    expect(changed).toContain("changed   .github/agents/dr-helper.md");
    expect(changed).toContain("removed only by naming it");
  });

  it("names a pending decision about files git tracks under .dr/ instead of a line to add", () => {
    const lines = outsideModelLines(
      {
        errors: [],
        gitignore: {
          path: ".gitignore",
          decision: { wouldIgnoreTracked: 22, files: [".dr/manifest.json"], alreadyIgnored: false, options: [] },
        },
      },
      []
    );
    expect(lines.join("\n")).toContain("decide    .gitignore: git tracks 22 file(s) under .dr/ (--dot-dr untrack, keep-tracked or skip)");
  });

  it("names every line a .dr choice writes and replaces, and the files it takes out of git's index", () => {
    const text = outsideModelLines(
      {
        errors: [],
        gitignore: {
          path: ".gitignore",
          add: ["/.dr/"],
          replace: ["# The spec pin (.dr/spec, .dr/manifest.json) stays tracked"],
          untrack: 14,
        },
      },
      []
    ).join("\n");
    expect(text).toContain("  Ignore files and git's index");
    expect(text).toContain("    add       /.dr/ to .gitignore");
    expect(text).toContain(
      "    remove    1 line(s) about .dr that .gitignore already has: # The spec pin (.dr/spec, .dr/manifest.json) stays tracked"
    );
    expect(text).toContain("    untrack   14 file(s) under .dr/ from git's index (git rm -r --cached .dr");

    const keep = outsideModelLines(
      { errors: [], gitignore: { path: ".gitignore", add: ["/.dr/*", "!/.dr/manifest.json", "!/.dr/spec/"] } },
      []
    ).join("\n");
    expect(keep).toContain("    add       /.dr/*, !/.dr/manifest.json, !/.dr/spec/ to .gitignore");
    expect(keep).not.toContain("untrack");
  });

  it("names the lines an earlier dr wrote to .prettierignore that the entry replaces", () => {
    const text = outsideModelLines(
      {
        errors: [],
        prettierignore: {
          path: ".prettierignore",
          add: ["documentation-robotics/"],
          replace: ["# Documentation Robotics: dr writes its changeset files in its own layout", "documentation-robotics/changesets/"],
        },
      },
      []
    ).join("\n");
    expect(text).toContain("    add       documentation-robotics/ to .prettierignore");
    expect(text).toContain("    remove    2 line(s) an earlier dr wrote to .prettierignore:");
  });

  it("leaves the spec reference out of what --model-only skips", () => {
    const text = outsideModelLines(outside, [copilot()], { skipped: true }).join("\n");
    expect(text).not.toContain("Spec reference");
    expect(text).toContain("GitHub Copilot integration");
  });
});
