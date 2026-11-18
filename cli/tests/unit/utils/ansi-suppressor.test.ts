/**
 * Regression tests for stdout EPIPE handling in the ANSI suppressor.
 *
 * When the CLI output is piped into a reader that exits early (`dr ... | head`),
 * writing to stdout raises an EPIPE 'error' event. Without a listener this is an
 * unhandled error and crashes with a stack trace; a CLI must exit quietly.
 */

import { describe, it, expect } from "bun:test";
import { spawn } from "bun";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(
  new URL("../../fixtures/epipe-stdout-child.ts", import.meta.url)
);

describe("installAnsiSuppressor - stdout EPIPE", () => {
  it("exits quietly (code 0, no stack trace) when stdout raises EPIPE", async () => {
    const child = spawn({
      cmd: [process.execPath, fixturePath],
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(child.stderr).text();
    const exitCode = await child.exited;

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("EPIPE");
    expect(stderr).not.toContain("at ");
  });
});
