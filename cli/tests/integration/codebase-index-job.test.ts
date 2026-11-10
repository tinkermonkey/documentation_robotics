/**
 * The background index run end to end, without codebase-memory-mcp: codebase_index's
 * startIndexJob runs the built `dr analyzer index` detached, and the child records how it ended.
 * An analyzer name that isn't registered makes the child fail at once, which exercises the
 * error-exit path for real.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createTempWorkdir, runDr } from "../helpers/cli-runner.js";
import { readIndexJob, startIndexJob, type IndexJob } from "../../src/analyzers/index-job.js";

const CLI_PATH = path.join(process.cwd(), "dist", "cli.js");

let project: { path: string; cleanup: () => Promise<void> };

beforeEach(async () => {
  project = await createTempWorkdir();
  await runDr(["init", "--name", "Index Job Test"], { cwd: project.path });
});

afterEach(async () => {
  await project.cleanup();
});

async function waitForEnd(projectRoot: string, timeoutMs = 20000): Promise<IndexJob | null> {
  const deadline = Date.now() + timeoutMs;
  let job = await readIndexJob(projectRoot);
  while (job?.state === "running" && Date.now() < deadline) {
    await Bun.sleep(100);
    job = await readIndexJob(projectRoot);
  }
  return job;
}

describe("background `dr analyzer index`", () => {
  it("records a failed run with the child's error", async () => {
    const { started, job } = await startIndexJob({
      projectRoot: project.path,
      analyzer: "no-such-analyzer",
      drCommand: { command: "node", args: [CLI_PATH] },
    });
    expect(started).toBe(true);
    expect(job.state).toBe("running");

    const ended = await waitForEnd(project.path);
    expect(ended?.jobId).toBe(job.jobId);
    expect(ended?.state).toBe("failed");
    // Written by the child itself, not inferred from a dead pid.
    expect(ended?.error).toContain("Analyzer not found: no-such-analyzer");
    expect(ended?.finishedAt).not.toBeNull();
    expect(await readFile(job.logPath, "utf-8")).toContain("no-such-analyzer");
  }, 30000);

  it("keeps --job out of the command's help", async () => {
    const help = await runDr(["analyzer", "index", "--help"], { cwd: project.path });
    expect(help.stdout).toContain("--force");
    expect(help.stdout).not.toContain("--job");
  });
});
