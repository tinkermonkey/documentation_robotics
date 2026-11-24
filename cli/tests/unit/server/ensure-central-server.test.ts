/**
 * ensureCentralServer (#1279, slice 3A): finds the farm's running process from its record, starts
 * one under the starting marker when there is none (concurrent callers start it once), and
 * replaces a process older than this CLI only when nothing uses it.
 * (`application.applicationfunction.ensure-central-server`)
 */

import { afterAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FarmLocation } from "../../../src/core/project-registry.js";
import type { CentralHealth } from "../../../src/server/central-server-contract.js";
import {
  centralProcessEnv,
  compareCliVersions,
  createEnsureCentralServer,
  serverStartingPath,
  type EnsureCentralServerDeps,
} from "../../../src/server/ensure-central-server.js";
import { findRunningServer, removeServerRecord, writeServerRecord } from "../../../src/server/server-record.js";
import type { SpawnEntryOptions } from "../../../src/commands/serve.js";

/** One test's scratch farm and fake process table: tests run concurrently, so nothing is shared. */
interface Fixture {
  scratch: string;
  farm: FarmLocation;
  env: NodeJS.ProcessEnv;
  alive: Set<number>;
  pids: { next: number };
  running(cliVersion: string, pid?: number): Promise<number>;
  deps(overrides?: Partial<EnsureCentralServerDeps>): {
    ensure: ReturnType<typeof createEnsureCentralServer>;
    spawned: SpawnEntryOptions[];
    killed: Array<[number, string]>;
  };
}

const fixtures: Fixture[] = [];

// After all of them: tests run concurrently, so an afterEach would remove another test's farm mid-run.
afterAll(async () => {
  for (const f of fixtures.splice(0)) await rm(f.scratch, { recursive: true, force: true });
});

async function fixture(): Promise<Fixture> {
  const scratch = await mkdtemp(join(tmpdir(), "dr-ensure-"));
  const farm: FarmLocation = { root: join(scratch, "farm"), file: join(scratch, "farm", "farm.yaml"), source: "env" };
  const env: NodeJS.ProcessEnv = { DR_STATE_DIR: join(scratch, "state") };
  const alive = new Set<number>();
  const pids = { next: 900_000 };

  /** Records a live process for the farm at `cliVersion`. */
  const running = async (cliVersion: string, pid = pids.next++): Promise<number> => {
    alive.add(pid);
    await writeServerRecord(
      { farmRoot: farm.root, pid, port: 40_000 + (pid % 1000), cliVersion, startedAt: new Date().toISOString() },
      `token-${pid}`,
      env
    );
    return pid;
  };

  const deps = (overrides: Partial<EnsureCentralServerDeps> = {}) => {
    const spawned: SpawnEntryOptions[] = [];
    const killed: Array<[number, string]> = [];
    const base: Partial<EnsureCentralServerDeps> = {
      resolveFarm: async () => farm,
      findRunningServer: (root, options) => findRunningServer(root, { ...options, isAlive: (pid) => alive.has(pid) }),
      removeServerRecord: (root, options) => removeServerRecord(root, options),
      fetchHealth: async () => ({ status: "ok", cliVersion: "0.0.0", clients: 0, mcpSessions: 0, drBotTurns: 0 }),
      logPath: async () => join(scratch, "serve.log"),
      // This process holds the starting marker while it starts one.
      isAlive: (pid) => alive.has(pid) || pid === process.pid,
      kill: (pid, signal) => {
        killed.push([pid, signal]);
        alive.delete(pid);
      },
      // A started process records itself a little later, as serve-entry does.
      spawnEntry: (options) => {
        spawned.push(options);
        const pid = pids.next++;
        setTimeout(() => void running("1.0.0", pid), 30);
        return { pid, exited: new Promise(() => {}) };
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      cliVersion: "1.0.0",
      pollMs: 5,
      startTimeoutMs: 5000,
      stopTimeoutMs: 200,
    };
    return { ensure: createEnsureCentralServer({ ...base, ...overrides }), spawned, killed };
  };

  const f: Fixture = { scratch, farm, env, alive, pids, running, deps };
  fixtures.push(f);
  return f;
}

describe("compareCliVersions", () => {
  it("orders dotted versions, a pre-release before its release, and never guesses", () => {
    expect(compareCliVersions("0.7.1", "0.8.0")).toBe(-1);
    expect(compareCliVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareCliVersions("0.8.0-rc.1", "0.8.0")).toBe(-1);
    expect(compareCliVersions("0.8.0", "0.8.0")).toBe(0);
    expect(compareCliVersions("dev", "0.8.0")).toBe(0);
  });
});

describe("ensureCentralServer", () => {
  it("finds the farm's running process from its record and starts nothing", async () => {
    const { farm, env, running, deps, pids, scratch } = await fixture();
    const pid = await running("1.0.0");
    const { ensure, spawned } = deps();
    const found = await ensure({ env });
    expect(found.record.pid).toBe(pid);
    expect(found.token).toBe(`token-${pid}`);
    expect(found.started).toBe(false);
    expect(spawned).toHaveLength(0);
  });

  it("starts one detached when none runs, without the session's own variables", async () => {
    const { farm, env, running, deps, pids, scratch } = await fixture();
    const { ensure, spawned } = deps();
    const started = await ensure({
      env: { ...env, DR_MCP_ROOT_PATH: "/x", DR_CHAT_MODE: "read-safe", DR_CHANGESET_ONLY: "true" },
      cwd: scratch,
    });
    expect(started.started).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].foreground).toBe(false);
    expect(spawned[0].env.DR_MCP_ROOT_PATH).toBeUndefined();
    expect(spawned[0].env.DR_CHAT_MODE).toBeUndefined();
    expect(spawned[0].env.DR_CHANGESET_ONLY).toBeUndefined();
    expect(started.record.pid).toBe(900_000);
    // The starting marker is gone once it is up.
    expect(existsSync(serverStartingPath(farm.root, env))).toBe(false);
  });

  it("starts once for concurrent callers: the others wait on the starting marker", async () => {
    const { farm, env, running, deps, pids, scratch } = await fixture();
    const { ensure, spawned } = deps();
    const results = await Promise.all([ensure({ env }), ensure({ env }), ensure({ env }), ensure({ env })]);
    expect(spawned).toHaveLength(1);
    expect(new Set(results.map((r) => r.record.pid)).size).toBe(1);
    expect(results.filter((r) => r.started)).toHaveLength(1);
  });

  it("takes over a starting marker whose holder died", async () => {
    const { farm, env, running, deps, pids, scratch } = await fixture();
    const { ensure, spawned } = deps();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(scratch, "state", "servers"), { recursive: true });
    await writeFile(serverStartingPath(farm.root, env), JSON.stringify({ pid: 4_000_000, startedAt: Date.now() }));
    const started = await ensure({ env });
    expect(started.started).toBe(true);
    expect(spawned).toHaveLength(1);
  });

  it("keeps an older process that is in use, and says so", async () => {
    const { farm, env, running, deps, pids, scratch } = await fixture();
    const pid = await running("0.9.0");
    const busy: CentralHealth = { status: "ok", cliVersion: "0.9.0", clients: 1, mcpSessions: 2, drBotTurns: 0 };
    const { ensure, spawned, killed } = deps({ fetchHealth: async () => busy });
    const kept = await ensure({ env });
    expect(kept.record.pid).toBe(pid);
    expect(kept.started).toBe(false);
    expect(kept.notice).toContain("older than this CLI (1.0.0)");
    expect(kept.notice).toContain("1 browser tab, 2 MCP sessions");
    expect(spawned).toHaveLength(0);
    expect(killed).toHaveLength(0);
  });

  it("replaces an older process nothing uses", async () => {
    const { farm, env, running, deps, pids, scratch } = await fixture();
    const old = await running("0.9.0");
    const { ensure, spawned, killed } = deps();
    const replaced = await ensure({ env });
    expect(killed).toEqual([[old, "SIGTERM"]]);
    expect(spawned).toHaveLength(1);
    expect(replaced.started).toBe(true);
    expect(replaced.record.pid).not.toBe(old);
    expect(replaced.notice).toBeUndefined();
  });

  it("returns a newer process as it is", async () => {
    const { farm, env, running, deps, pids, scratch } = await fixture();
    const pid = await running("2.0.0");
    const { ensure, spawned } = deps();
    expect((await ensure({ env })).record.pid).toBe(pid);
    expect(spawned).toHaveLength(0);
  });

  it("says why when the started process exits instead of recording itself", async () => {
    const { farm, env, running, deps, pids, scratch } = await fixture();
    const { ensure } = deps({
      spawnEntry: () => ({ pid: pids.next++, exited: Promise.resolve(1) }),
    });
    await expect(ensure({ env })).rejects.toThrow(/exited with code 1/);
    expect(existsSync(serverStartingPath(farm.root, env))).toBe(false);
  });
});

describe("centralProcessEnv", () => {
  it("drops what describes one session and keeps the rest", () => {
    const clean = centralProcessEnv({ PATH: "/bin", DR_MCP_ROOT_PATH: "/a", DR_CHANGESET_ORIGIN: "chat", DR_STATE_DIR: "/s" });
    expect(clean).toEqual({ PATH: "/bin", DR_STATE_DIR: "/s" });
  });
});
