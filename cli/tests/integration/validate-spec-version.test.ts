/**
 * `dr validate` says in one line when the model's spec version isn't the one this dr validates
 * against, so errors from the version gap don't read as model errors (#1168).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFile, writeFile } from "fs/promises";
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
