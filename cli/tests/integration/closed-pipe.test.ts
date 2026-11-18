/**
 * Output piped into a reader that stops early (`dr upgrade --dry-run | head`) closes the pipe
 * under dr: it exits quietly, as other CLIs do, rather than crash with an EPIPE trace (#1167).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawn } from "node:child_process";
import { createTempWorkdir, runDr } from "../helpers/cli-runner.js";

let tempDir: { path: string; cleanup: () => Promise<void> };

beforeEach(async () => {
  tempDir = await createTempWorkdir();
});

afterEach(async () => {
  await tempDir.cleanup();
});

describe("Writing to a closed pipe (#1167)", () => {
  it("exits 0 without a stack trace when the reader closes stdout early", async () => {
    await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

    const cliPath = new URL("../../dist/cli.js", import.meta.url).pathname;
    const { code, stderr } = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = spawn("node", [cliPath, "upgrade", "--dry-run"], {
        cwd: tempDir.path,
        stdio: ["ignore", "pipe", "pipe"],
      });
      // As `| head` does once it has what it wants: every write after this hits a closed pipe
      child.stdout.destroy();
      let err = "";
      child.stderr.on("data", (chunk) => (err += chunk));
      child.on("close", (exitCode) => resolve({ code: exitCode, stderr: err }));
    });

    expect(stderr).not.toContain("EPIPE");
    expect(code).toBe(0);
  });
});
