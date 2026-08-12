/**
 * Regression tests for chat subprocess spawn/kill lifecycle handling in VisualizationServer.
 *
 * Covers three bugs fixed during review of PR #803 (Bun -> Node runtime API migration):
 *
 * 1. launchClaudeCodeChat/launchCopilotChat previously had no `proc.on("error", ...)`
 *    listener on the spawned child_process. Node reports spawn failures (ENOENT, EACCES,
 *    a missing cwd, etc.) asynchronously via an 'error' event rather than a synchronous
 *    throw - an unhandled 'error' event on an EventEmitter throws, which (via
 *    server-entry.ts's uncaughtException handler) used to crash the *entire* visualization
 *    server instead of just failing the one chat request.
 * 2. killProcessWithRetry used to check `proc.killed` to decide whether a process had
 *    actually terminated after SIGTERM. Under Node, `.killed` means "kill() was called
 *    successfully" - NOT "the process has exited" (this differs from Bun's
 *    Subprocess.killed, which this code was originally written against) - so the SIGKILL
 *    escalation path silently never ran.
 *
 * These tests reach the relevant private methods directly via bracket-notation property
 * access (`server["methodName"]`), matching the existing convention in
 * visualization-server.test.ts (see `server["model"]`, `server["clients"]`, etc.).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { Model } from "../../../src/core/model.js";
import { VisualizationServer } from "../../../src/server/server.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { randomUUID } from "crypto";

/** Minimal stand-in for HonoWSContext that just records what would've been sent. */
function createFakeWs() {
  const sent: any[] = [];
  return {
    sent,
    send: (data: string) => {
      sent.push(JSON.parse(data));
    },
    close: () => {},
  };
}

/** Poll until `check()` returns a truthy value, or fail after `timeoutMs`. */
async function waitFor<T>(check: () => T | undefined | null | false, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

describe("VisualizationServer chat subprocess spawn error handling", () => {
  let testDir: string;
  let model: Model;
  let server: VisualizationServer;

  beforeAll(async () => {
    testDir = join(tmpdir(), `dr-spawn-err-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    model = await Model.init(
      testDir,
      {
        name: "Spawn Error Test",
        version: "0.1.0",
        description: "Model for chat subprocess spawn-error regression tests",
        specVersion: "0.6.0",
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );
    server = new VisualizationServer(model, { authEnabled: false });

    // Force any child_process.spawn launched with `cwd: this.model.rootPath` (which is
    // what launchClaudeCodeChat/launchCopilotChat use) to fail deterministically with
    // ENOENT, without touching global state like process.env.PATH - which would be
    // unsafe here since tests/unit/server/ runs with --concurrent and a global PATH
    // mutation could affect other files' subprocess spawns running at the same time.
    rmSync(testDir, { recursive: true, force: true });
  });

  afterAll(() => {
    server.stop();
  });

  it("launchClaudeCodeChat: a spawn failure sends a JSON-RPC error instead of crashing the process", async () => {
    const ws = createFakeWs();

    // If the fix regresses (no proc.on("error", ...) listener), this either hangs the
    // test (unhandled 'error' events don't reject this await) or - in a real server -
    // throws an uncaught exception process-wide, which is exactly the bug being guarded
    // against. Either way, `await` on the launch call itself succeeds regardless, since
    // the spawn error surfaces asynchronously after the method returns.
    await (server as any).launchClaudeCodeChat(ws, "conv-claude-spawn-err", "hello", "req-claude-1");

    const response = await waitFor(() => ws.sent.find((m) => m.id === "req-claude-1"));
    expect(response.jsonrpc).toBe("2.0");
    expect(response.error).toBeDefined();
    expect(response.error.message).toContain("Failed to launch Claude Code");

    // Cleanup on failure must still happen
    expect((server as any).activeChatProcesses.has("conv-claude-spawn-err")).toBe(false);

    // A failed spawn also destroys proc.stdout, which the stream-reading loop observes
    // as its own error - guard against that turning into a second, duplicate JSON-RPC
    // response for the same request id.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ws.sent.filter((m) => m.id === "req-claude-1")).toHaveLength(1);
  });

  it("launchCopilotChat: a spawn failure sends a JSON-RPC error instead of crashing the process", async () => {
    const ws = createFakeWs();

    await (server as any).launchCopilotChat(ws, "conv-copilot-spawn-err", "hello", "req-copilot-1");

    const response = await waitFor(() => ws.sent.find((m) => m.id === "req-copilot-1"));
    expect(response.jsonrpc).toBe("2.0");
    expect(response.error).toBeDefined();
    expect(response.error.message).toMatch(/Failed to launch GitHub Copilot/);

    expect((server as any).activeChatProcesses.has("conv-copilot-spawn-err")).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ws.sent.filter((m) => m.id === "req-copilot-1")).toHaveLength(1);
  });
});

describe("VisualizationServer process exit/kill helpers", () => {
  let testDir: string;
  let model: Model;
  let server: VisualizationServer;

  beforeAll(async () => {
    testDir = join(tmpdir(), `dr-kill-retry-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    model = await Model.init(
      testDir,
      {
        name: "Kill Retry Test",
        version: "0.1.0",
        description: "Model for killProcessWithRetry/waitForExit regression tests",
        specVersion: "0.6.0",
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );
    server = new VisualizationServer(model, { authEnabled: false });
  });

  afterAll(() => {
    server.stop();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("waitForExit resolves with the actual exit code once the process exits", async () => {
    const proc: ChildProcess = spawn(process.execPath, ["-e", "process.exit(3)"]);
    const code = await (server as any).waitForExit(proc);
    expect(code).toBe(3);
  });

  it("waitForExit resolves immediately for a process that already exited before being awaited", async () => {
    const proc: ChildProcess = spawn(process.execPath, ["-e", "process.exit(0)"]);
    await new Promise((resolve) => proc.once("exit", resolve));
    expect(proc.exitCode).not.toBeNull();

    const code = await (server as any).waitForExit(proc);
    expect(code).toBe(0);
  });

  it(
    "killProcessWithRetry escalates to SIGKILL when SIGTERM never actually terminates the process",
    async () => {
      // A real OS-level SIGTERM-ignoring process (e.g. `sh -c "trap '' TERM; ..."`) is
      // the most realistic way to exercise this, but that trap turned out to be
      // unreliable specifically under `bun test`'s own process supervision (confirmed:
      // the identical spawn+kill sequence reliably ignores SIGTERM under plain
      // `bun -e`/`node -e`, but not under `bun test`) - a test-runner quirk unrelated to
      // the actual bug. So instead, fake a minimal ChildProcess that precisely models
      // the real contract killProcessWithRetry depends on: `.killed` becomes true as
      // soon as kill() is *called* (matching real Node semantics), but `exitCode`/
      // `signalCode` - what hasExited() actually checks - stay null until a real
      // termination signal (SIGKILL, which can't be trapped) is sent. This is exactly
      // the distinction the fix (`hasExited()` checking exitCode/signalCode instead of
      // `.killed`) exists to get right.
      const killCalls: string[] = [];
      let exitCode: number | null = null;
      let signalCode: string | null = null;
      const fakeProc = {
        get exitCode() {
          return exitCode;
        },
        get signalCode() {
          return signalCode;
        },
        get killed() {
          return killCalls.length > 0;
        },
        kill(signal: string) {
          killCalls.push(signal);
          if (signal === "SIGKILL") {
            signalCode = "SIGKILL";
          }
          // SIGTERM is deliberately not honored - simulates a process that ignores it.
          return true;
        },
      };

      await (server as any).killProcessWithRetry(fakeProc, "conv-kill-retry", "TestLabel");

      expect(killCalls).toContain("SIGTERM");
      expect(killCalls[killCalls.length - 1]).toBe("SIGKILL");
      expect(fakeProc.signalCode).toBe("SIGKILL");
    },
    10000
  );

  it("killProcessWithRetry returns immediately for an already-exited process", async () => {
    const proc: ChildProcess = spawn(process.execPath, ["-e", "process.exit(0)"]);
    await new Promise((resolve) => proc.once("exit", resolve));

    const start = Date.now();
    await (server as any).killProcessWithRetry(proc, "conv-already-exited", "TestLabel");
    // Should return near-instantly (no SIGTERM wait/backoff), not take the ~1.8s of a
    // full retry cycle.
    expect(Date.now() - start).toBeLessThan(200);
  });
});
