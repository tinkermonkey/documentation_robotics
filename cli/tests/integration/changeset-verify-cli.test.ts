/**
 * `dr changeset verify` argument checks for the extraction rule (--extracted goes with --base).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";

describe("dr changeset verify --extracted", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    await workdir.cleanup();
  });

  it("refuses --extracted without --base", async () => {
    const result = await runDr(["changeset", "verify", "some-plan", "--against", "as-built", "--extracted"], {
      cwd: workdir.path,
    });
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("--extracted goes with --base");
  });

  it("lists --extracted in the help", async () => {
    const result = await runDr(["changeset", "verify", "--help"], { cwd: workdir.path });
    expect(result.stdout).toContain("--extracted");
  });
});
