/**
 * `dr visualize` end to end on the central process (issue 1279, slice 4A;
 * `testing.testcoveragetarget.central-process-lifecycle`): one process for two projects and a
 * worktree, a project registered on first use, `--list` with the process and a legacy
 * per-project viewer, and `--stop` / `--stop --all`.
 *
 * Runs on a scratch farm, state and config directory with the process scan off
 * (tests/helpers/visualize-farm.ts), and stops every process it starts.
 *
 * REQUIRES SERIAL EXECUTION: starts a real process on a live port.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { portAllocator } from "../helpers.ts";
import { CLI_PATH, makeVisualizeFarm, type VisualizeFarm, type VisualizeResult } from "../helpers/visualize-farm.ts";
import { serverRecordPath } from "../../src/server/server-record.js";
import { viewerRecordDir, viewerRecordPath } from "../../src/server/viewer-registry.js";
import { isProcessAlive } from "../../src/utils/process-liveness.js";

describe.skipIf(!existsSync(CLI_PATH)).serial("dr visualize: one central process for the farm", () => {
  let farm: VisualizeFarm;
  let port: number;
  let worktree: string;
  let first: VisualizeResult;
  let legacy: ChildProcess | null = null;

  beforeAll(async () => {
    farm = await makeVisualizeFarm(["alpha", "beta"]);
    port = await portAllocator.allocatePort();
    worktree = join(farm.scratch, "alpha-feature");
    const add = spawnSync("git", ["worktree", "add", "-q", worktree, "-b", "feature"], { cwd: farm.projects.alpha, encoding: "utf8" });
    if (add.status !== 0) throw new Error(`git worktree add failed: ${add.stderr}`);
  });

  afterAll(async () => {
    if (legacy?.pid && isProcessAlive(legacy.pid)) legacy.kill("SIGKILL");
    await farm?.cleanup();
    portAllocator.releasePort(port);
  });

  it("starts the process once and links each project and worktree to its own checkout", async () => {
    first = farm.visualize(farm.projects.alpha, ["--port", String(port)]);
    expect(first).toMatchObject({ started: true, port, project: "alpha", checkout: "main" });

    const beta = farm.visualize(farm.projects.beta);
    expect(beta).toMatchObject({ started: false, pid: first.pid, project: "beta", checkout: "main" });
    expect(beta.url).toStartWith(`http://127.0.0.1:${port}/#/p/beta/c/main/?token=`);

    const feature = farm.visualize(worktree);
    expect(feature).toMatchObject({ started: false, pid: first.pid, project: "alpha", checkout: "alpha-feature" });

    // Both projects were registered on first use, as dr farm add would.
    const farmFile = await readFile(join(farm.farmRoot, "farm.yaml"), "utf8");
    expect(farmFile).toContain("alpha:");
    expect(farmFile).toContain("beta:");

    // Each link's checkout answers on its scoped route with the token.
    const token = farm.tokenOf(first);
    for (const [project, checkout] of [["alpha", "main"], ["beta", "main"], ["alpha", "alpha-feature"]]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/projects/${project}/checkouts/${checkout}/model`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    }
  });

  it("writes no per-project viewer record", () => {
    expect(existsSync(viewerRecordDir(farm.env))).toBe(false);
    expect(existsSync(serverRecordPath(farm.farmRoot, farm.env))).toBe(true);
  });

  it("--list shows the process and a legacy viewer with why the sweep keeps it", async () => {
    // A per-project viewer a CLI 0.7.x left: its launcher is alive, its port answers nothing.
    legacy = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    await mkdir(viewerRecordDir(farm.env), { recursive: true, mode: 0o700 });
    await writeFile(
      viewerRecordPath(farm.projects.beta, legacy.pid!, farm.env),
      JSON.stringify({
        pid: legacy.pid,
        port: 1,
        token: null,
        projectRoot: farm.projects.beta,
        startedAt: new Date().toISOString(),
        withChangesets: true,
        startedBy: "cli",
      }),
      { mode: 0o600 }
    );

    const list = farm.dr(["visualize", "--list", "--json"], farm.projects.alpha);
    expect(list.status).toBe(0);
    const parsed = JSON.parse(list.stdout);
    expect(parsed.central).toMatchObject({ running: true, answering: true, record: { pid: first.pid, port } });
    expect(parsed.central.health).toMatchObject({ clients: 0, mcpSessions: 0, drBotTurns: 0 });
    expect(parsed.legacyViewers).toHaveLength(1);
    expect(parsed.legacyViewers[0]).toMatchObject({ pid: legacy.pid, keptReason: "not-started-by-review-open" });

    const text = farm.dr(["visualize", "--list"], farm.projects.alpha);
    expect(text.stdout).toContain(`pid ${first.pid}, port ${port}`);
    expect(text.stdout).toContain("0 browser tabs, 0 MCP sessions, 0 DrBot turns");
    expect(text.stdout).toContain("kept: started from a terminal");
  });

  it("--stop --all stops the process, and leaves a legacy viewer whose pids are not confirmed", () => {
    const stop = farm.dr(["visualize", "--stop", "--all"], farm.projects.beta);
    expect(stop.stdout).toContain(`Stopped the DR process (pid ${first.pid})`);
    expect(stop.status).toBe(1);
    expect(stop.stderr + stop.stdout).toContain("still running");
    expect(isProcessAlive(first.pid)).toBe(false);
    expect(existsSync(serverRecordPath(farm.farmRoot, farm.env))).toBe(false);
    expect(isProcessAlive(legacy!.pid!)).toBe(true);
  });

  it("--stop says so when no process runs, and --stop takes no path", () => {
    const stop = farm.dr(["visualize", "--stop"], farm.projects.alpha);
    expect(stop.status).toBe(0);
    expect(stop.stdout).toContain("No DR process is running for this farm.");
    const named = farm.dr(["visualize", "--stop", farm.projects.alpha], farm.projects.alpha);
    expect(named.status).toBe(1);
    expect(named.stderr + named.stdout).toContain("--stop takes no path");
  });
});
