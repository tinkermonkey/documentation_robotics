/**
 * A viewer that ends on its own (#1237): after its idle limit, and when its project's
 * documentation-robotics/ folder is gone. The launcher exits with it, and its record goes.
 *
 * Runs real `dr visualize` processes on ports from the allocator, with the check interval
 * shortened (DR_VIEWER_LIFETIME_CHECK_MS) so "24 hours" takes a second.
 *
 * REQUIRES SERIAL EXECUTION: starts real server subprocesses on live ports.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portAllocator, stopServerProcess } from "../helpers.ts";
import { viewerRecordPath } from "../../src/server/viewer-registry.js";

const CLI_PATH = join(import.meta.dir, "../../dist/cli.js");
const ready = existsSync(CLI_PATH) && existsSync(join(import.meta.dir, "../../dist/viewer/index.html"));

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe.skipIf(!ready).serial("a viewer that ends on its own", () => {
  let scratch: string;
  let projectDir: string;
  let stateDir: string;
  let port: number;
  let proc: ChildProcess | null = null;
  let output = "";

  /** Starts `dr visualize` in the project and waits until it has recorded itself. */
  async function start(args: string[]): Promise<ChildProcess> {
    output = "";
    const child = spawn(
      "node",
      [CLI_PATH, "visualize", "--no-browser", "--no-auth", "--exit-with-parent", "--port", String(port), ...args],
      {
        cwd: projectDir,
        env: { ...process.env, DR_STATE_DIR: stateDir, DR_VIEWER_LIFETIME_CHECK_MS: "200" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    proc = child;
    child.stdout?.on("data", (chunk) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk) => (output += chunk.toString()));
    const recordPath = viewerRecordPath(projectDir, child.pid!, { DR_STATE_DIR: stateDir });
    if (!(await waitFor(() => existsSync(recordPath) || child.exitCode !== null, 30000)) || child.exitCode !== null) {
      throw new Error(`dr visualize did not start:\n${output}`);
    }
    return child;
  }

  const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;
  const records = async () => (await readdir(join(stateDir, "viewers"))).filter((name) => name.endsWith(".json"));

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "dr-viewer-lifetime-"));
    projectDir = join(scratch, "project");
    stateDir = join(scratch, "state");
    await mkdir(projectDir, { recursive: true });
    const init = spawnSync(process.execPath, [CLI_PATH, "init", "--name", "Viewer Lifetime"], { cwd: projectDir });
    if (init.status !== 0) throw new Error(`dr init failed: ${init.stderr?.toString()}`);
    port = await portAllocator.allocatePort();
  });

  afterEach(async () => {
    // Stopped and waited for before its project folder is deleted
    await stopServerProcess(proc);
    proc = null;
    portAllocator.releasePort(port);
    await rm(scratch, { recursive: true, force: true });
  });

  it("exits after its idle limit with no tab and no request, and removes its record", async () => {
    // 0.0005 hours is 1.8 seconds.
    const child = await start(["--idle-exit", "0.0005"]);
    expect(await records()).toHaveLength(1);

    expect(await waitFor(() => exited(child), 20000)).toBe(true);
    expect(child.exitCode).toBe(0);
    expect(output).toContain("Stopping: no browser tab was connected and no request came in for 1.8 seconds");
    expect(await records()).toEqual([]);
    // The server went with it: nothing answers on the port.
    await expect(fetch(`http://localhost:${port}/health`)).rejects.toThrow();
  }, 60000);

  it("stays up while it is used, and health checks do not count as use", async () => {
    const child = await start(["--idle-exit", "0.0005"]);
    // Requests keep it alive well past the limit.
    for (let elapsed = 0; elapsed < 4000; elapsed += 300) {
      expect((await fetch(`http://localhost:${port}/api/model`)).status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(exited(child)).toBe(false);
    // Health checks alone (review_open, project_status, --list) do not.
    expect(
      await waitFor(async () => {
        await fetch(`http://localhost:${port}/health`).catch(() => {});
        return exited(child);
      }, 20000)
    ).toBe(true);
    expect(child.exitCode).toBe(0);
  }, 60000);

  it("stays up past its limit while a browser tab's WebSocket is open, and exits once it closes", async () => {
    const child = await start(["--idle-exit", "0.0005"]);
    const socket = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("the WebSocket did not open")), { once: true });
    });
    try {
      // Twice the 1.8 s limit, with nothing but the open tab.
      await new Promise((resolve) => setTimeout(resolve, 4000));
      expect(exited(child)).toBe(false);
    } finally {
      socket.close();
    }
    expect(await waitFor(() => exited(child), 20000)).toBe(true);
    expect(output).toContain("Stopping: no browser tab was connected");
  }, 60000);

  it("never exits for idleness without a limit (a viewer run in a terminal)", async () => {
    const child = await start([]);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(exited(child)).toBe(false);
    expect((await fetch(`http://localhost:${port}/health`)).status).toBe(200);
  }, 60000);

  it("exits when its project's documentation-robotics/ folder is gone", async () => {
    const child = await start([]);
    await rm(join(projectDir, "documentation-robotics"), { recursive: true, force: true });

    expect(await waitFor(() => exited(child), 20000)).toBe(true);
    expect(child.exitCode).toBe(0);
    expect(output).toContain("Stopping: its project folder is gone");
    expect(await records()).toEqual([]);
  }, 60000);
});
