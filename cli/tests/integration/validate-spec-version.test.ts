/**
 * `dr validate` says in one line when the model's spec version isn't the one this dr validates
 * against, so errors from the version gap don't read as model errors (#1168).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import yaml from "yaml";
import { createTempWorkdir, runDr, assertOutputContains } from "../helpers/cli-runner.js";

let tempDir: { path: string; cleanup: () => Promise<void> };

async function setModelSpecVersion(workdir: string, version: string): Promise<void> {
  const manifestPath = join(workdir, "documentation-robotics/model/manifest.yaml");
  const manifest = yaml.parse(await readFile(manifestPath, "utf-8"));
  manifest.spec_version = version;
  await writeFile(manifestPath, yaml.stringify(manifest));
}

beforeEach(async () => {
  tempDir = await createTempWorkdir();
});

afterEach(async () => {
  await tempDir.cleanup();
});

describe("dr validate and the model's spec version (#1168)", () => {
  it("says nothing when the model is at this dr's spec version", async () => {
    await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
    const result = await runDr(["validate"], { cwd: tempDir.path });
    expect(result.stdout).not.toContain("this dr validates against");
  });

  it("says in one line when the model is behind, and how to migrate it", async () => {
    await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
    await setModelSpecVersion(tempDir.path, "0.12.0");
    const result = await runDr(["validate"], { cwd: tempDir.path });
    assertOutputContains(result, "The model is at spec v0.12.0; this dr validates against");
    assertOutputContains(result, 'Run "dr upgrade" to migrate it');
  });

  it("says when the model is ahead of this dr", async () => {
    await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
    await setModelSpecVersion(tempDir.path, "99.0.0");
    const result = await runDr(["validate"], { cwd: tempDir.path });
    assertOutputContains(result, "newer than the");
  });
});

describe("dr validate in a checkout without the spec reference (#1168)", () => {
  it("says so in one line and validates as usual, as in a fresh worktree where .dr/ is gitignored", async () => {
    await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
    const added = await runDr(["add", "business", "businessservice", "payments", "--name", "Payments"], {
      cwd: tempDir.path,
    });
    expect(added.exitCode).toBe(0);
    const withReference = await runDr(["validate"], { cwd: tempDir.path });
    expect(withReference.exitCode).toBe(0);
    expect(withReference.stdout).not.toContain("Spec reference not installed");

    await rm(join(tempDir.path, ".dr"), { recursive: true, force: true });
    const result = await runDr(["validate"], { cwd: tempDir.path });
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split("\n").filter((line) => line.includes("Spec reference not installed"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("validation is unaffected");
    expect(lines[0]).toContain('run "dr upgrade"');
    // The same report as with the reference, apart from that line: no schema errors from its absence
    expect(result.stdout).toContain("1 total elements validated");
    expect(result.stdout.replace(lines[0] + "\n", "")).toBe(withReference.stdout);
  });

  it("says nothing with --quiet", async () => {
    await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
    await rm(join(tempDir.path, ".dr"), { recursive: true, force: true });
    const result = await runDr(["validate", "--quiet"], { cwd: tempDir.path });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("Spec reference not installed");
  });
});
