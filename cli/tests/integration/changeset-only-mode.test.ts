/**
 * Changeset-only write mode (`dr visualize --with-changesets`).
 *
 * The chat agent runs with DR_CHANGESET_ONLY=true. Its `dr add` / `dr update` /
 * `dr relationship add` must land in an active changeset and never in the base model,
 * and committing or applying must fail, even if a permission rule let the command run.
 * These run the real CLI against a copy of the golden model.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";
import { CHANGESET_ONLY_ENV } from "../../src/core/changeset-only-guard.js";

const CHANGESET_ONLY = { [CHANGESET_ONLY_ENV]: "true" };

// A valid add (api operations need these attributes), so only the guard can fail it.
const ADD = [
  "add",
  "api",
  "operation",
  "Guard Test Operation",
  "--attributes",
  '{"operationId":"guardTestOperation","summary":"Guard test","tags":"guard"}',
];

/** Every file under documentation-robotics/model, path -> contents. */
async function snapshotModel(root: string): Promise<Map<string, string>> {
  const modelDir = join(root, "documentation-robotics", "model");
  const files = new Map<string, string>();
  const entries = await readdir(modelDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(path, await readFile(path, "utf-8"));
  }
  return files;
}

describe("changeset-only mode (DR_CHANGESET_ONLY=true)", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    dir = workdir.path;
    cleanup = workdir.cleanup;
  });

  afterEach(async () => {
    await cleanup().catch(() => {});
  });

  it("refuses dr add when no changeset is active and leaves the model untouched", async () => {
    const before = await snapshotModel(dir);

    const result = await runDr(ADD, {
      cwd: dir,
      env: CHANGESET_ONLY,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("only change the model through a changeset");
    expect(await snapshotModel(dir)).toEqual(before);
  });

  it("stages dr add in the active changeset without touching the model", async () => {
    const before = await snapshotModel(dir);

    const create = await runDr(["changeset", "create", "guard-test"], { cwd: dir, env: CHANGESET_ONLY });
    expect(create.exitCode).toBe(0);

    const add = await runDr(ADD, {
      cwd: dir,
      env: CHANGESET_ONLY,
    });
    expect(add.exitCode).toBe(0);
    expect(add.stdout).toContain("Staged");

    const staged = await runDr(["changeset", "staged"], { cwd: dir, env: CHANGESET_ONLY });
    expect(staged.stdout).toContain("guard-test-operation");

    expect(await snapshotModel(dir)).toEqual(before);
  });

  it("refuses to commit the changeset to the model", async () => {
    await runDr(["changeset", "create", "guard-test"], { cwd: dir, env: CHANGESET_ONLY });
    await runDr(ADD, { cwd: dir, env: CHANGESET_ONLY });
    const before = await snapshotModel(dir);

    const commit = await runDr(["changeset", "commit"], { cwd: dir, env: CHANGESET_ONLY });

    expect(commit.exitCode).not.toBe(0);
    expect(await snapshotModel(dir)).toEqual(before);
  });

  it("still writes to the model without the variable (normal CLI use is unaffected)", async () => {
    const before = await snapshotModel(dir);

    const add = await runDr(ADD, { cwd: dir });

    expect(add.exitCode).toBe(0);
    expect(await snapshotModel(dir)).not.toEqual(before);
  });
});
