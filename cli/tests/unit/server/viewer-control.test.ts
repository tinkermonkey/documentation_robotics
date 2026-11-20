/**
 * Listing and stopping running viewers (#1237): the registry's records joined with the process
 * scan, and a stop that only ever signals a pid known to be a viewer's.
 *
 * Every test injects the process table and the kill: nothing here reads or signals the real
 * viewers on the machine running the tests.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareCliVersions,
  isOlderViewer,
  listRunningViewers,
  stopRecordedViewer,
  stopViewer,
  type RunningViewer,
} from "../../../src/server/viewer-control.js";
import {
  DR_STATE_DIR_ENV,
  readViewerRecords,
  viewerRecordDir,
  viewerRecordPath,
  type ViewerRecord,
} from "../../../src/server/viewer-registry.js";
import type { ProcessInfo } from "../../../src/server/viewer-processes.js";

const CLI = "/usr/local/lib/node_modules/@documentation-robotics/cli/dist";
const launcher = (pid: number, ppid: number, args = "--with-changesets --no-browser"): ProcessInfo => ({
  pid,
  ppid,
  startedAt: "2026-11-18T09:00:00.000Z",
  command: `node ${CLI}/cli.js visualize ${args}`,
});
const server = (pid: number, ppid: number): ProcessInfo => ({
  pid,
  ppid,
  startedAt: "2026-11-18T09:00:01.000Z",
  command: `node ${CLI}/server-entry.js`,
});

interface Fixture {
  scratch: string;
  projectRoot: string;
  env: NodeJS.ProcessEnv;
  put: (record: Partial<ViewerRecord> & { pid: number; port: number }) => Promise<void>;
}

async function withFixture(body: (fx: Fixture) => Promise<void>): Promise<void> {
  const scratch = await realpath(tmpdir()).then((dir) =>
    join(dir, `dr-viewer-control-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  );
  const projectRoot = join(scratch, "project");
  await mkdir(join(projectRoot, "documentation-robotics"), { recursive: true });
  const env = { [DR_STATE_DIR_ENV]: join(scratch, "state") };
  const put: Fixture["put"] = async (record) => {
    await mkdir(viewerRecordDir(env), { recursive: true });
    const full: ViewerRecord = {
      token: "secret",
      projectRoot,
      startedAt: "2026-11-17T09:00:00.000Z",
      withChangesets: true,
      ...record,
    };
    await writeFile(viewerRecordPath(full.projectRoot, full.pid, env), JSON.stringify(full));
  };
  try {
    await body({ scratch, projectRoot, env, put });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

describe("compareCliVersions / isOlderViewer", () => {
  it("compares versions by number, not as text", () => {
    expect(compareCliVersions("0.6.0", "0.7.0")).toBe(-1);
    expect(compareCliVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareCliVersions("0.7.0", "0.7.0")).toBe(0);
    expect(compareCliVersions("0.7.0-beta.1", "0.7.0")).toBe(-1);
    expect(compareCliVersions("1.0", "1.0.0")).toBe(0);
  });

  it("counts a viewer with no version as older (before 0.6.0 it reported none)", () => {
    expect(isOlderViewer("0.6.0", "0.7.0")).toBe(true);
    expect(isOlderViewer(undefined, "0.7.0")).toBe(true);
    expect(isOlderViewer("0.7.0", "0.7.0")).toBe(false);
    // A viewer newer than the CLI asking is not replaced by it.
    expect(isOlderViewer("0.8.0", "0.7.0")).toBe(false);
  });
});

describe("listRunningViewers", () => {
  it("lists recorded viewers and ones the registry lost, with each one's version", () =>
    withFixture(async ({ env, scratch, projectRoot, put }) => {
      // The issue's case: a review_open viewer whose record a later `dr visualize` replaced.
      await put({ pid: 200, port: 8099, token: null, withChangesets: false, startedBy: "cli" });
      const other = join(scratch, "other");
      const versions: Record<number, string | undefined> = { 8085: "0.5.0", 8099: "0.7.0", 8090: undefined };
      const viewers = await listRunningViewers({
        env,
        cliVersion: "0.7.0",
        isAlive: () => true,
        processes: () => [
          launcher(100, 1),
          server(101, 100),
          launcher(200, 50, "--no-auth --port 8099"),
          server(201, 200),
          launcher(300, 1),
          server(301, 300),
        ],
        cwdOf: (pid) => (pid === 300 ? other : join(projectRoot, "documentation-robotics")),
        portOf: (pid) => ({ 101: 8085, 301: 8090 })[pid] ?? null,
        health: async (port) => ({ status: "ok", ...(versions[port] ? { cliVersion: versions[port] } : {}) }),
      });

      expect(viewers.map((viewer) => [viewer.projectRoot, viewer.port, viewer.pid, viewer.cliVersion, viewer.inRegistry])).toEqual([
        [other, 8090, 300, null, false],
        // Sorted by project, then by start time: the recorded one started first.
        [projectRoot, 8099, 200, "0.7.0", true],
        [projectRoot, 8085, 100, "0.5.0", false],
      ]);
      const lost = viewers.find((viewer) => viewer.pid === 100)!;
      expect(lost).toMatchObject({ serverPid: 101, outdated: true, answering: true, verified: true, withChangesets: true, token: null });
      expect(viewers.find((viewer) => viewer.pid === 200)).toMatchObject({ serverPid: 201, outdated: false, startedBy: "cli" });
      // Answers with no cliVersion: older than 0.6.0.
      expect(viewers.find((viewer) => viewer.pid === 300)).toMatchObject({ outdated: true });
    }));

  it("drops the record of a pid another program now holds, and does not list it", () =>
    withFixture(async ({ env, projectRoot, put }) => {
      await put({ pid: 400, port: 8080 });
      const viewers = await listRunningViewers({
        env,
        isAlive: () => true,
        processes: () => [{ pid: 400, ppid: 1, startedAt: "", command: "/usr/bin/some-daemon --serve" }],
        health: async () => ({ status: "ok", cliVersion: "0.7.0" }),
      });
      expect(viewers).toEqual([]);
      expect(await readViewerRecords(projectRoot, env)).toEqual([]);
    }));

  it("lists a server whose launcher is gone only when it answers as a viewer", () =>
    withFixture(async ({ env, projectRoot }) => {
      const deps = {
        env,
        isAlive: () => true,
        processes: () => [server(501, 1)],
        cwdOf: () => projectRoot,
        portOf: () => 8091,
      };
      expect(await listRunningViewers({ ...deps, health: async () => null })).toEqual([]);
      const viewers = await listRunningViewers({ ...deps, health: async () => ({ status: "ok", cliVersion: "0.6.0" }) });
      expect(viewers).toMatchObject([{ pid: null, serverPid: 501, port: 8091, projectRoot, inRegistry: false }]);
    }));

  it("falls back to the registry where the process table cannot be read", () =>
    withFixture(async ({ env, put }) => {
      await put({ pid: 600, port: 8080, cliVersion: "0.7.0" });
      await put({ pid: 601, port: 8081 });
      const viewers = await listRunningViewers({
        env,
        isAlive: () => true,
        processes: () => null,
        health: async (port) => (port === 8080 ? { status: "ok", cliVersion: "0.7.0" } : null),
      });
      // Without a scan, only a viewer whose port answers is known to be one.
      expect(viewers.map((viewer) => [viewer.pid, viewer.answering, viewer.verified])).toEqual([
        [600, true, true],
        [601, false, false],
      ]);
    }));

  it("is empty when nothing runs", () =>
    withFixture(async ({ env }) => {
      expect(await listRunningViewers({ env, processes: () => [] })).toEqual([]);
    }));
});

function viewer(overrides: Partial<RunningViewer> = {}): RunningViewer {
  return {
    projectRoot: "/projects/a",
    port: 8080,
    pid: 100,
    serverPid: 101,
    cliVersion: "0.7.0",
    outdated: false,
    startedAt: "",
    startedBy: null,
    withChangesets: true,
    idleExitHours: null,
    inRegistry: false,
    answering: true,
    verified: true,
    token: null,
    ...overrides,
  };
}

/** A fake process table: which pids are alive, and what each does when signalled. */
function processes(alive: number[], onSignal: (pid: number, signal: string, die: (pid: number) => void) => void) {
  const live = new Set(alive);
  const sent: Array<[number, string]> = [];
  return {
    sent,
    live,
    options: {
      isAlive: (pid: number) => live.has(pid),
      kill: (pid: number, signal: NodeJS.Signals) => {
        sent.push([pid, signal]);
        onSignal(pid, signal, (gone) => live.delete(gone));
      },
      pollMs: 5,
      timeoutMs: 60,
    },
  };
}

describe("stopViewer", () => {
  it("signals the launcher, which takes its server with it", async () => {
    const table = processes([100, 101], (pid, _signal, die) => {
      if (pid === 100) {
        die(100);
        die(101);
      }
    });
    expect(await stopViewer(viewer(), table.options)).toBe("stopped");
    expect(table.sent).toEqual([[100, "SIGTERM"]]);
  });

  it("kills a launcher that ignores SIGTERM, then the server it left", async () => {
    const table = processes([100, 101], (pid, signal, die) => {
      if (signal === "SIGKILL" || pid === 101) die(pid);
    });
    expect(await stopViewer(viewer(), table.options)).toBe("force-killed");
    expect(table.sent).toEqual([
      [100, "SIGTERM"],
      [100, "SIGKILL"],
      [101, "SIGTERM"],
    ]);
    expect(table.live.size).toBe(0);
  });

  it("stops a server whose launcher is gone", async () => {
    const table = processes([101], (pid, _signal, die) => die(pid));
    expect(await stopViewer(viewer({ pid: null }), table.options)).toBe("stopped");
    expect(table.sent).toEqual([[101, "SIGTERM"]]);
  });

  it("signals nothing when the pids are not known to be a viewer's", async () => {
    const table = processes([100, 101], () => {});
    expect(await stopViewer(viewer({ verified: false }), table.options)).toBe("unverified");
    expect(table.sent).toEqual([]);
  });

  it("never signals pid 1 or itself, and says when the viewer is already gone", async () => {
    const table = processes([1, process.pid], () => {});
    expect(await stopViewer(viewer({ pid: 1, serverPid: process.pid }), table.options)).toBe("not-running");
    expect(await stopViewer(viewer({ pid: 777, serverPid: 778 }), table.options)).toBe("not-running");
    expect(table.sent).toEqual([]);
  });

  it("reports a viewer that belongs to another user", async () => {
    const table = processes([100], () => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    });
    expect(await stopViewer(viewer({ serverPid: null }), table.options)).toBe("not-permitted");
  });

  it("removes the stopped viewer's record and leaves the project's other viewer alone", () =>
    withFixture(async ({ env, projectRoot, put }) => {
      await put({ pid: 100, port: 8080 });
      await put({ pid: 200, port: 8081 });
      const table = processes([100, 101, 200], (pid, _signal, die) => die(pid));
      const outcome = await stopViewer(viewer({ projectRoot, inRegistry: true }), { ...table.options, env });
      expect(outcome).toBe("stopped");
      expect((await readViewerRecords(projectRoot, env)).map((record) => record.pid)).toEqual([200]);
      expect(table.live.has(200)).toBe(true);
    }));
});

describe("stopRecordedViewer", () => {
  it("stops the viewer a record names", () =>
    withFixture(async ({ env, projectRoot, put }) => {
      await put({ pid: 100, port: 8080, serverPid: 101 });
      const [record] = await readViewerRecords(projectRoot, env);
      const table = processes([100, 101], (pid, _signal, die) => {
        die(100);
        die(101);
        void pid;
      });
      expect(await stopRecordedViewer(record, { ...table.options, env, looksLikeViewer: () => true })).toBe("stopped");
      expect(await readViewerRecords(projectRoot, env)).toEqual([]);
    }));

  it("signals nothing when the recorded pid now runs another program", () =>
    withFixture(async ({ env, projectRoot, put }) => {
      await put({ pid: 100, port: 8080 });
      const [record] = await readViewerRecords(projectRoot, env);
      const table = processes([100], () => {});
      expect(await stopRecordedViewer(record, { ...table.options, env, looksLikeViewer: () => false })).toBe("not-running");
      expect(table.sent).toEqual([]);
      expect(await readViewerRecords(projectRoot, env)).toEqual([]);
    }));
});
