/**
 * `dr serve` end to end (issue 1279, slice 2B): the built CLI starts `serve-entry` detached with
 * a fake server (DR_SERVE_TEST_STARTER), which records itself and answers /health; a second start
 * is refused; --status shows it; --stop ends it and its record goes. A second test lets it idle
 * out. The real server (`startCentralServer`, slice 2A) is not used here.
 *
 * REQUIRES SERIAL EXECUTION: starts real processes on live ports.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portAllocator } from "../helpers.ts";
import { readServerRecord, readServerToken, serverRecordPath } from "../../src/server/server-record.js";
import { isProcessAlive } from "../../src/utils/process-liveness.js";

const CLI_PATH = join(import.meta.dir, "../../dist/cli.js");
const FAKE_STARTER = join(import.meta.dir, "../fixtures/fake-central-server.mjs");
const ready = existsSync(CLI_PATH) && existsSync(join(import.meta.dir, "../../dist/serve-entry.js"));

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe.skipIf(!ready).serial("dr serve: the central process", () => {
  let scratch: string;
  let farmRoot: string;
  let env: NodeJS.ProcessEnv;
  let port: number;
  let startedPid: number | null = null;

  const dr = (args: string[]) =>
    spawnSync("node", [CLI_PATH, "serve", ...args], { cwd: farmRoot, env, encoding: "utf8", timeout: 60_000 });

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "dr-serve-"));
    farmRoot = join(scratch, "farm");
    await mkdir(farmRoot, { recursive: true });
    await writeFile(
      join(farmRoot, "farm.yaml"),
      `schema: dr-farm-v2\nname: serve-test\ncreated: "2026-11-23T00:00:00.000Z"\nmodified: "2026-11-23T00:00:00.000Z"\nprojects: {}\n`
    );
    port = await portAllocator.allocatePort();
    env = {
      ...process.env,
      DR_STATE_DIR: join(scratch, "state"),
      DR_FARM_PATH: farmRoot,
      DR_SERVE_TEST_STARTER: FAKE_STARTER,
      DR_VIEWER_PROCESS_SCAN: "off",
    };
    startedPid = null;
  });

  afterEach(async () => {
    if (startedPid !== null && isProcessAlive(startedPid)) {
      try {
        process.kill(startedPid, "SIGKILL");
      } catch {
        // Gone already
      }
    }
    portAllocator.releasePort(port);
    await rm(scratch, { recursive: true, force: true });
  });

  it("starts detached, records itself, answers /health, refuses a second start and stops", async () => {
    const start = dr(["--port", String(port)]);
    expect(start.status, start.stderr + start.stdout).toBe(0);
    expect(start.stdout).toContain(`http://127.0.0.1:${port}/`);

    const record = await readServerRecord(farmRoot, env);
    expect(record).not.toBeNull();
    startedPid = record!.pid;
    expect(record!.port).toBe(port);
    expect(start.stdout).toContain(`pid ${record!.pid}`);
    expect(isProcessAlive(record!.pid)).toBe(true);

    const token = await readServerToken(record!);
    const health = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${token}` } });
    expect(health.ok).toBe(true);
    expect(((await health.json()) as { pid: number }).pid).toBe(record!.pid);

    const second = dr([]);
    expect(second.status).toBe(1);
    expect(second.stderr + second.stdout).toContain(`already serves`);
    expect((await readServerRecord(farmRoot, env))?.pid).toBe(record!.pid);

    const status = dr(["--status"]);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain(`pid ${record!.pid}, port ${port}`);
    expect(status.stdout).toContain("health: status ok");

    const stop = dr(["--stop"]);
    expect(stop.status, stop.stderr + stop.stdout).toBe(0);
    expect(stop.stdout).toContain(`Stopped the DR process`);
    expect(isProcessAlive(record!.pid)).toBe(false);
    expect(existsSync(serverRecordPath(farmRoot, env))).toBe(false);

    const after = dr(["--status"]);
    expect(after.stdout).toContain("No DR process is running");
  }, 60_000);

  it("ends on its own when idle, and removes its record", async () => {
    env.DR_VIEWER_IDLE_HOURS = "0.0002"; // 0.72 seconds
    env.DR_VIEWER_LIFETIME_CHECK_MS = "100";
    const start = dr(["--port", String(port)]);
    expect(start.status, start.stderr + start.stdout).toBe(0);
    const record = await readServerRecord(farmRoot, env);
    expect(record).not.toBeNull();
    startedPid = record!.pid;

    expect(await waitFor(() => !isProcessAlive(record!.pid), 15_000)).toBe(true);
    expect(existsSync(serverRecordPath(farmRoot, env))).toBe(false);
  }, 60_000);
});
