/**
 * End-to-end regression test for #800: `dr visualize` must work on a machine with
 * only Node.js installed, no Bun.
 *
 * PR #803 removed every Bun-specific runtime API (Bun.serve, hono/bun, Bun.spawn/
 * Bun.spawnSync, Bun.watch) from the visualization server, and changed the CLI to
 * spawn the server subprocess via `process.execPath` (whichever runtime is already
 * running the CLI) instead of a literal "bun" binary. Every other visualization-server
 * integration test in this repo spawns `dr visualize` via `bun ...` (see
 * visualization-server-api.test.ts, visualization-server-auth-flow.test.ts), so none
 * of them actually exercise the Node-only code path this fix exists for - the outer
 * CLI process is always Bun, and so is `process.execPath` inside it.
 *
 * This test spawns the CLI via a literal `node` binary AND strips any directory
 * containing a `bun` executable from the child's PATH, so there is no way for `bun`
 * to be reached anywhere in the process tree (CLI -> server subprocess -> ...).
 *
 * REQUIRES SERIAL EXECUTION: starts a real server subprocess on a live port.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawn, spawnSync } from "child_process";
import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { delimiter, join } from "path";
import { portAllocator } from "../helpers.ts";

const CLI_ROOT = join(import.meta.dir, "../..");
const CLI_PATH = join(CLI_ROOT, "dist/cli.js");
const STARTUP_TIMEOUT = 20000; // ms – generous for CI

/**
 * Build a PATH string with every directory that contains a `bun` executable removed,
 * so a child process spawned with this PATH cannot resolve `bun` no matter where it's
 * installed (asdf/nvm-style user installs, Homebrew, a global CI package, etc.).
 */
function pathWithoutBun(): string {
  const bunExecutableName = process.platform === "win32" ? "bun.exe" : "bun";
  const dirs = (process.env.PATH || "").split(delimiter);
  return dirs.filter((dir) => !dir || !existsSync(join(dir, bunExecutableName))).join(delimiter);
}

function initializeTestModel(dir: string): void {
  const result = spawnSync("node", [CLI_PATH, "init", "--name", "Node Runtime Test", "--description", "Pure-Node dr visualize e2e test"], {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Failed to init test model: ${result.stderr?.toString()}`);
  }
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Server at port ${port} did not become healthy within ${timeoutMs}ms`);
}

describe.serial("dr visualize under a literal pure-Node runtime with Bun entirely unreachable", () => {
  let testDir: string;
  let port: number;
  let serverProc: ReturnType<typeof spawn> | null = null;
  let serverOutput = "";

  beforeAll(async () => {
    testDir = join("/tmp", `dr-node-runtime-e2e-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    initializeTestModel(testDir);

    port = await portAllocator.allocatePort();

    const noBunPath = pathWithoutBun();
    // Sanity-check the filter actually removed something in dev environments where
    // bun is normally present, so this test can't silently pass by accident on a
    // machine where `bun` was never on PATH to begin with. On a genuinely bun-less
    // CI runner this is a no-op, which is fine - the test's real assertion is that
    // the server works at all, regardless of whether bun was ever present.
    if (process.env.PATH?.split(delimiter).some((d) => existsSync(join(d, "bun")))) {
      expect(noBunPath).not.toBe(process.env.PATH);
    }

    // Spawn the CLI itself via a literal "node" binary (not Bun.spawn/"bun", unlike
    // every other visualization-server integration test) with Bun stripped from PATH,
    // so process.execPath inside visualize.ts - and therefore the server subprocess
    // it spawns - can only ever resolve to node.
    serverProc = spawn(
      "node",
      [CLI_PATH, "visualize", "--port", String(port), "--no-browser", "--no-auth"],
      {
        cwd: testDir,
        env: { ...process.env, PATH: noBunPath },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    serverProc.stdout?.on("data", (d) => (serverOutput += d.toString()));
    serverProc.stderr?.on("data", (d) => (serverOutput += d.toString()));

    try {
      await waitForHealth(port, STARTUP_TIMEOUT);
    } catch (err) {
      throw new Error(`${(err as Error).message}\nServer output:\n${serverOutput}`);
    }
  }, STARTUP_TIMEOUT + 5000);

  afterAll(async () => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill();
    }
    portAllocator.releasePort(port);
    await rm(testDir, { recursive: true, force: true });
  });

  it("serves /health over HTTP with Bun completely unreachable", async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
  });

  it("serves the viewer at / with Bun completely unreachable", async () => {
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
  });

  it("supports a WebSocket round-trip (ping/pong) with Bun completely unreachable", async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket ping/pong round-trip timed out"));
      }, 10000);

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data as string);
        if (message.type === "connected") {
          ws.send(JSON.stringify({ type: "ping" }));
        } else if (message.type === "pong") {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      };
      ws.onerror = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
  }, 15000);
});
