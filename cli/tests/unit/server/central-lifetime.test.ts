/**
 * The central DR process's lifetime (issue 1279, slice 2B): port choice, the record and token it
 * writes and removes, refusing a second process for a farm, the start-up sweep of per-project
 * viewers with its own pids excluded, and the idle rule. Runs against a fake server.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FarmLocation, ProjectRegistry } from "../../../src/core/project-registry.js";
import {
  CentralProcessRunningError,
  centralIdleMs,
  centralIdleReason,
  centralStaleReason,
  chooseServePort,
  staleKeptNotice,
  exactServePort,
  runCentralProcess,
  watchCentralIdle,
  type RunCentralProcessOptions,
} from "../../../src/server/central-lifetime.js";
import type { RunningCodeDrift } from "../../../src/utils/running-code.js";
import type { CentralActivity, CentralServerOptions } from "../../../src/server/central-server-contract.js";
import type { PerProjectViewerSweep, SweepPerProjectViewersOptions } from "../../../src/server/legacy-viewer-sweep.js";
import { readServerRecord, serverRecordPath, serverTokenPath, writeServerRecord } from "../../../src/server/server-record.js";

const HOUR = 3_600_000;

function activity(overrides: Partial<CentralActivity> = {}): CentralActivity {
  return { clients: 0, mcpSessions: 0, drBotTurns: 0, lastActivityAt: 0, ...overrides };
}

describe("the idle rule", () => {
  it("is idle after the limit with nothing connected and no request", () => {
    expect(centralIdleReason(activity(), 24 * HOUR, 23 * HOUR)).toBeNull();
    expect(centralIdleReason(activity(), 24 * HOUR, 24 * HOUR)).toBe(
      "no browser tab, MCP session or DrBot turn was connected and no request came in for 24 hours"
    );
  });

  it("is never idle while a tab, an MCP session or a DrBot turn is connected", () => {
    for (const busy of [{ clients: 1 }, { mcpSessions: 1 }, { drBotTurns: 1 }]) {
      expect(centralIdleReason(activity(busy), 24 * HOUR, 1000 * HOUR)).toBeNull();
    }
  });

  it("runs the limit from the last activity", () => {
    expect(centralIdleReason(activity({ lastActivityAt: 10 * HOUR }), 24 * HOUR, 33 * HOUR)).toBeNull();
    expect(centralIdleReason(activity({ lastActivityAt: 10 * HOUR }), 24 * HOUR, 34 * HOUR)).not.toBeNull();
  });

  it("never exits with a limit of 0", () => {
    expect(centralIdleReason(activity(), 0, 1e12)).toBeNull();
  });

  it("reads the limit from DR_VIEWER_IDLE_HOURS, 24 by default", () => {
    expect(centralIdleMs({})).toBe(24 * HOUR);
    expect(centralIdleMs({ DR_VIEWER_IDLE_HOURS: "2" })).toBe(2 * HOUR);
    expect(centralIdleMs({ DR_VIEWER_IDLE_HOURS: "0" })).toBe(0);
  });

  it("calls onExit once when the watch finds it idle, with injected time and activity", async () => {
    let now = 0;
    let current = activity({ clients: 1 });
    const reasons: string[] = [];
    const watch = watchCentralIdle({
      activity: () => current,
      idleMs: 1000,
      intervalMs: 5,
      now: () => now,
      onExit: (reason) => reasons.push(reason),
    });
    try {
      now = 5000;
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(reasons).toEqual([]);
      current = activity({ lastActivityAt: 5000 });
      now = 5999;
      expect(watch.check()).toBeNull();
      now = 6000;
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(reasons.length).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(reasons.length).toBe(1);
    } finally {
      watch.stop();
    }
  });
});

describe("restarting on the installed CLI (#1427)", () => {
  const drift: RunningCodeDrift = { reason: "version", running: "0.8.0", installed: { version: "0.9.0", spec: null } };

  it("restarts only when the CLI changed and nothing a restart would cut is using it", () => {
    expect(centralStaleReason(activity(), null)).toBeNull();
    // MCP sessions don't hold it: the bridge reconnects them.
    const reason = centralStaleReason(activity({ mcpSessions: 3 }), drift);
    expect(reason).toContain("runs CLI 0.8.0, and CLI 0.9.0 is installed now");
    expect(reason).toContain("the dr MCP server reconnects its sessions");
    // A client connected straight to /mcp (dr mcp --http) would lose its session: it holds the process.
    for (const busy of [{ clients: 1 }, { drBotTurns: 1 }, { requestsInFlight: 1 }, { directMcpSessions: 1 }]) {
      expect(centralStaleReason(activity(busy), drift)).toBeNull();
    }
  });

  it("keeps a process that may not restart itself running, and says so once (#1427 review)", async () => {
    const kept: RunningCodeDrift[] = [];
    const exits: string[] = [];
    let checks = 0;
    const watch = watchCentralIdle({
      activity: () => activity(),
      idleMs: 0,
      intervalMs: 5,
      staleCheck: async () => {
        checks++;
        return drift;
      },
      restartWhenStale: false,
      onStaleKept: (d) => kept.push(d),
      onExit: (reason) => exits.push(reason),
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(exits).toEqual([]);
      expect(kept).toEqual([drift]);
      expect(checks).toBe(1);
    } finally {
      watch.stop();
    }
    expect(staleKeptNotice(drift)).toContain("does not restart itself");
    expect(staleKeptNotice(drift)).toContain("start it again with the same options");
  });

  it("reads what is connected right before exiting: a request that came in meanwhile holds it", async () => {
    let current = activity();
    let release!: () => void;
    const exits: string[] = [];
    const watch = watchCentralIdle({
      activity: () => current,
      idleMs: 0,
      intervalMs: 5,
      staleCheck: () =>
        new Promise((resolve) => {
          release = () => resolve(drift);
        }),
      onExit: (reason) => exits.push(reason),
    });
    try {
      while (!release) await new Promise((resolve) => setTimeout(resolve, 2));
      current = activity({ requestsInFlight: 1 });
      release();
      await new Promise((resolve) => setTimeout(resolve, 3));
      expect(exits).toEqual([]);
    } finally {
      watch.stop();
    }
  });

  it("ends through onExit when the stale check finds drift, even with no idle limit", async () => {
    let current = activity({ clients: 1 });
    const reasons: string[] = [];
    const watch = watchCentralIdle({
      activity: () => current,
      idleMs: 0,
      intervalMs: 5,
      staleCheck: async () => drift,
      onExit: (reason) => reasons.push(reason),
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(reasons).toEqual([]);
      expect(await watch.checkStale()).toBeNull();
      current = activity({ mcpSessions: 1 });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain("stops for a restart");
    } finally {
      watch.stop();
    }
  });
});

describe("port choice", () => {
  it("takes 8080 when it is free", async () => {
    expect(await chooseServePort(undefined, async () => true)).toBe(8080);
  });

  it("takes the next free port when 8080 is taken", async () => {
    const taken = new Set([8080, 8081]);
    expect(await chooseServePort(undefined, async (port) => !taken.has(port))).toBe(8082);
  });

  it("starts the search at --port", async () => {
    expect(await chooseServePort(9000, async () => true)).toBe(9000);
  });

  it("takes an exact port or fails, never searching (an isolated process, #1376)", async () => {
    expect(await exactServePort(9100, async () => true)).toBe(9100);
    await expect(exactServePort(9100, async () => false)).rejects.toThrow("Port 9100 is in use");
    await expect(exactServePort(0, async () => true)).rejects.toThrow("Invalid port number");
  });

  it("rejects a port out of range", async () => {
    await expect(chooseServePort(0, async () => true)).rejects.toThrow("Invalid port number");
  });
});

describe("runCentralProcess", () => {
  // Each test has its own state directory and farm: the unit suite runs tests concurrently.
  const scratches: string[] = [];

  async function setup() {
    const scratch = await mkdtemp(join(tmpdir(), "dr-central-lifetime-"));
    scratches.push(scratch);
    const root = join(scratch, "farm");
    await mkdir(root, { recursive: true });
    return {
      env: { DR_STATE_DIR: join(scratch, "state") } as NodeJS.ProcessEnv,
      farm: { root, file: join(root, "farm.yaml"), source: "folder" } as FarmLocation,
    };
  }

  afterAll(async () => {
    await Promise.all(scratches.map((scratch) => rm(scratch, { recursive: true, force: true })));
  });

  function fakeStarter() {
    const calls: CentralServerOptions[] = [];
    let stopped = 0;
    const stopOptions: Array<{ processExiting?: boolean } | undefined> = [];
    const current = activity();
    const startServer = async (options: CentralServerOptions) => {
      calls.push(options);
      return {
        port: options.port,
        activity: () => current,
        stop: async (o?: { processExiting?: boolean }) => {
          stopped++;
          stopOptions.push(o);
        },
      };
    };
    return { calls, startServer, stopped: () => stopped, stopOptions, current };
  }

  function emptySweep(record: SweepPerProjectViewersOptions[] = []) {
    return async (options: SweepPerProjectViewersOptions): Promise<PerProjectViewerSweep> => {
      record.push(options);
      return { stopped: [], kept: [], caveats: [] };
    };
  }

  type Ctx = { env: NodeJS.ProcessEnv; farm: FarmLocation };
  function options(ctx: Ctx, overrides: Partial<RunCentralProcessOptions> = {}): RunCentralProcessOptions {
    return {
      farm: ctx.farm,
      startServer: fakeStarter().startServer,
      cliVersion: "9.9.9",
      env: ctx.env,
      pid: 4242,
      launcherPid: 4241,
      isAlive: (pid) => pid === 4242 || pid === 4241,
      isPortFree: async () => true,
      openRegistry: async () => ({}) as ProjectRegistry,
      sweepViewers: emptySweep(),
      idleMs: 0,
      log: () => {},
      ...overrides,
    };
  }

  it("starts the server with the port, token and server id, and writes the record and a 0600 token", async () => {
    const ctx = await setup();
    const { env, farm } = ctx;
    const starter = fakeStarter();
    const taken = new Set([8080]);
    const proc = await runCentralProcess(
      options(ctx, { startServer: starter.startServer, isPortFree: async (port) => !taken.has(port) })
    );
    try {
      expect(starter.calls.length).toBe(1);
      const call = starter.calls[0];
      expect(call.port).toBe(8081);
      expect(call.token.length).toBeGreaterThan(20);
      expect(call.serverId).toBe(proc.serverId);
      expect(call.launcherPid).toBe(4241);
      expect(call.farm).toBe(farm);

      const record = await readServerRecord(farm.root, env);
      expect(record).toMatchObject({ pid: 4242, port: 8081, cliVersion: "9.9.9", launcherPid: 4241 });
      const tokenPath = serverTokenPath(farm.root, env);
      expect((await readFile(tokenPath, "utf8")).trim()).toBe(call.token);
      expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
    } finally {
      await proc.stop();
    }
  });

  it("stops the server and removes its record and token on stop, once", async () => {
    const ctx = await setup();
    const { env, farm } = ctx;
    const starter = fakeStarter();
    const proc = await runCentralProcess(options(ctx, { startServer: starter.startServer }));
    await proc.stop();
    await proc.stop();
    expect(starter.stopped()).toBe(1);
    expect(existsSync(serverRecordPath(farm.root, env))).toBe(false);
    expect(existsSync(serverTokenPath(farm.root, env))).toBe(false);
  });

  it("passes processExiting to the server, also from a stop that comes while another is under way (#1235)", async () => {
    const ctx = await setup();
    const starter = fakeStarter();
    const proc = await runCentralProcess(options(ctx, { startServer: starter.startServer }));
    const first = proc.stop();
    await proc.stop({ processExiting: true });
    await first;
    expect(starter.stopOptions.some((o) => o?.processExiting === true)).toBe(true);
  });

  it("refuses to start while another live process serves the farm, and starts no server", async () => {
    const ctx = await setup();
    const { env, farm } = ctx;
    await writeServerRecord(
      { farmRoot: farm.root, pid: 777, port: 8080, cliVersion: "9.9.9", startedAt: new Date().toISOString() },
      "other-token",
      env
    );
    const starter = fakeStarter();
    const attempt = runCentralProcess(
      options(ctx, { startServer: starter.startServer, isAlive: (pid) => pid === 777 || pid === 4242 })
    );
    await expect(attempt).rejects.toBeInstanceOf(CentralProcessRunningError);
    await expect(attempt).rejects.toThrow("pid 777");
    expect(starter.calls.length).toBe(0);
    expect((await readServerRecord(farm.root, env))?.pid).toBe(777);
  });

  it("replaces a record whose process is gone", async () => {
    const ctx = await setup();
    const { env, farm } = ctx;
    await writeServerRecord(
      { farmRoot: farm.root, pid: 777, port: 8080, cliVersion: "0.1.0", startedAt: new Date().toISOString() },
      "old-token",
      env
    );
    const proc = await runCentralProcess(options(ctx));
    try {
      expect((await readServerRecord(farm.root, env))?.pid).toBe(4242);
    } finally {
      await proc.stop();
    }
  });

  it("stops its server when another process recorded itself while it was starting", async () => {
    const ctx = await setup();
    const { env, farm } = ctx;
    const starter = fakeStarter();
    const startServer = async (o: CentralServerOptions) => {
      const server = await starter.startServer(o);
      await writeServerRecord(
        { farmRoot: farm.root, pid: 777, port: 9999, cliVersion: "9.9.9", startedAt: new Date().toISOString() },
        "winner",
        env
      );
      return server;
    };
    await expect(
      runCentralProcess(options(ctx, { startServer, isAlive: (pid) => pid === 777 || pid === 4242 }))
    ).rejects.toBeInstanceOf(CentralProcessRunningError);
    expect(starter.stopped()).toBe(1);
    expect((await readServerRecord(farm.root, env))?.pid).toBe(777);
  });

  it("sweeps per-project viewers with its own pid and its launcher's excluded, and logs the result", async () => {
    const ctx = await setup();
    const { env, farm } = ctx;
    const sweeps: SweepPerProjectViewersOptions[] = [];
    const lines: string[] = [];
    const proc = await runCentralProcess(options(ctx, { sweepViewers: emptySweep(sweeps), log: (line) => lines.push(line) }));
    try {
      expect(sweeps.length).toBe(1);
      expect(sweeps[0].excludePids).toEqual([4242, 4241]);
      expect(lines.some((line) => line.includes("Per-project viewers: stopped 0, kept 0."))).toBe(true);
    } finally {
      await proc.stop();
    }
  });

  it("sweeps only the farm's own folders, and not at all with sweep: false (#1369)", async () => {
    const ctx = await setup();
    const sweeps: SweepPerProjectViewersOptions[] = [];
    const registry = {
      farmManifest: { getAllProjects: () => [{ name: "a", repository: "/projects/a", model: "/projects/a/m" }] },
      repositoryPath: (project: { repository: string }) => project.repository,
      checkouts: async () => [{ path: "/worktrees/a-feature" }],
    } as unknown as ProjectRegistry;
    const proc = await runCentralProcess(
      options(ctx, { sweepViewers: emptySweep(sweeps), openRegistry: async () => registry })
    );
    await proc.stop();
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0].farmRoots).toEqual(["/projects/a", "/worktrees/a-feature"]);

    const lines: string[] = [];
    const skipped: SweepPerProjectViewersOptions[] = [];
    const quiet = await runCentralProcess(
      options(await setup(), { sweep: false, sweepViewers: emptySweep(skipped), log: (line) => lines.push(line) })
    );
    try {
      expect(skipped).toHaveLength(0);
      expect(quiet.sweep).toBeNull();
      expect(lines.some((line) => line.includes("not swept"))).toBe(true);
    } finally {
      await quiet.stop();
    }
  });

  it("logs, and never exits, when it may not restart itself", async () => {
    const lines: string[] = [];
    const exits: string[] = [];
    const drift: RunningCodeDrift = { reason: "version", running: "0.8.0", installed: { version: "0.9.0", spec: null } };
    const proc = await runCentralProcess(
      options(await setup(), {
        idleCheckMs: 5,
        staleCheck: async () => drift,
        restartWhenStale: false,
        onIdleExit: (reason) => exits.push(reason),
        log: (line) => lines.push(line),
      })
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(exits).toEqual([]);
      expect(lines.filter((line) => line.includes("does not restart itself"))).toHaveLength(1);
    } finally {
      await proc.stop();
    }
  });

  it("listens on the exact port it is given, or refuses to start", async () => {
    const ctx = await setup();
    await expect(
      runCentralProcess(options(ctx, { port: 9123, exactPort: true, isPortFree: async (p) => p !== 9123 }))
    ).rejects.toThrow("Port 9123 is in use");
    const proc = await runCentralProcess(options(ctx, { port: 9124, exactPort: true }));
    try {
      expect(proc.record.port).toBe(9124);
    } finally {
      await proc.stop();
    }
  });

  it("keeps running when the sweep fails, and says so", async () => {
    const ctx = await setup();
    const { env, farm } = ctx;
    const lines: string[] = [];
    const proc = await runCentralProcess(
      options(ctx, {
        sweepViewers: async () => {
          throw new Error("no ps");
        },
        log: (line) => lines.push(line),
      })
    );
    try {
      expect(proc.sweep).toBeNull();
      expect(lines.some((line) => line.includes("sweep of per-project viewers failed: no ps"))).toBe(true);
      expect(await readServerRecord(farm.root, env)).not.toBeNull();
    } finally {
      await proc.stop();
    }
  });

  it("ends through onIdleExit when idle for its limit", async () => {
    const ctx = await setup();
    const { env, farm } = ctx;
    let now = 0;
    const reasons: string[] = [];
    const proc = await runCentralProcess(
      options(ctx, { idleMs: 1000, idleCheckMs: 5, now: () => now, onIdleExit: (reason) => reasons.push(reason) })
    );
    try {
      now = 999;
      expect(proc.idle.check()).toBeNull();
      now = 1000;
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(reasons.length).toBe(1);
    } finally {
      await proc.stop();
    }
  });
});
