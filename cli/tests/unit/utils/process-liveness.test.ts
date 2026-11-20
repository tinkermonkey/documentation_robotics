/**
 * isProcessRunning, the test helper that viewer-lifecycle tests wait on: an exited process counts
 * as gone even while it is a zombie its parent has not reaped, which a signal-0 check alone does
 * not see. That is how the release gate's container, where PID 1 never reaps, kept orphaned viewer
 * processes "alive" for the whole run.
 */
import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { isProcessRunning } from "../../helpers/process-liveness.ts";

describe("isProcessRunning", () => {
  it("is true for a running process and false for one that exited and was reaped", async () => {
    const child = spawn("sleep", ["5"], { stdio: "ignore" });
    try {
      expect(isProcessRunning(child.pid!)).toBe(true);
    } finally {
      child.kill("SIGKILL");
    }
    await new Promise((resolve) => child.once("exit", resolve));
    expect(isProcessRunning(child.pid!)).toBe(false);
    expect(isProcessRunning(0)).toBe(false);
    expect(isProcessRunning(-1)).toBe(false);
  });

  it.skipIf(process.platform !== "linux")("is false for a zombie, which still answers signal 0", async () => {
    // `sleep 0` exits at once; its parent then execs `sleep 5`, which never reaps it.
    const parent = spawn("sh", ["-c", "sleep 0 & echo $!; exec sleep 5"], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      const zombie = await new Promise<number>((resolve) => parent.stdout!.once("data", (data) => resolve(Number(String(data).trim()))));
      const deadline = Date.now() + 5000;
      while (isProcessRunning(zombie) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(isProcessRunning(zombie)).toBe(false);
      // The pid is still there: a signal-0 check alone would call it running.
      expect(() => process.kill(zombie, 0)).not.toThrow();
    } finally {
      parent.kill("SIGKILL");
    }
  });
});
