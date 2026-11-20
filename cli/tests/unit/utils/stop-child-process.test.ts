/**
 * stopChildProcess: signal a child, wait, and force-kill it if it is still running (#1235).
 *
 * `dr visualize` forwarded a signal to its server and guarded the SIGKILL fallback with
 * `!serverProcess.killed`. `killed` is true once a signal was sent, so the fallback never ran and
 * a server that hung in its own shutdown outlived the launcher.
 */
import { describe, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { hasExited, stopChildProcess } from "../../../src/utils/stop-child-process.js";

/** Start a child that prints "ready" once its handlers are installed, and wait for that. */
async function startChild(script: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on("data", (data) => String(data).includes("ready") && resolve());
    child.once("error", reject);
    child.once("exit", () => reject(new Error("the child exited before it was ready")));
  });
  return child;
}

const EXITS_ON_SIGTERM = `process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000); console.log("ready");`;
const IGNORES_SIGTERM = `process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); console.log("ready");`;

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("stopChildProcess", () => {
  it("returns once a child that handles the signal has exited", async () => {
    const child = await startChild(EXITS_ON_SIGTERM);
    expect(await stopChildProcess(child, "SIGTERM", 5000)).toBe("exited");
    expect(hasExited(child)).toBe(true);
    expect(isRunning(child.pid!)).toBe(false);
  });

  it("force-kills a child that ignores the signal", async () => {
    const child = await startChild(IGNORES_SIGTERM);
    const started = Date.now();
    expect(await stopChildProcess(child, "SIGTERM", 300)).toBe("force-killed");
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(hasExited(child)).toBe(true);
    expect(child.signalCode).toBe("SIGKILL");
    expect(isRunning(child.pid!)).toBe(false);
  });

  it("does nothing to a child that has already exited", async () => {
    const child = await startChild(EXITS_ON_SIGTERM);
    await stopChildProcess(child, "SIGTERM", 5000);
    expect(await stopChildProcess(child, "SIGTERM", 5000)).toBe("already-exited");
  });
});

describe("hasExited", () => {
  it("is false for a signalled child that is still running, where `killed` is already true", async () => {
    const child = await startChild(IGNORES_SIGTERM);
    try {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 200));
      // The flag the old fallback read: set by the signal, not by the exit
      expect(child.killed).toBe(true);
      expect(hasExited(child)).toBe(false);
      expect(isRunning(child.pid!)).toBe(true);
    } finally {
      await stopChildProcess(child, "SIGKILL", 2000);
    }
  });
});
