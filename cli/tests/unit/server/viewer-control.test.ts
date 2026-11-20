/**
 * Listing and stopping running viewers (#1237): the registry's records joined with the process
 * scan, and a stop that signals a pid only when it is confirmed to be the viewer's: by the viewer
 * itself (its /health names the record's id and its pids) or by the process table (start time,
 * a `visualize` argument and a dr server under it).
 *
 * Every test injects the process table, the health check and the kill: nothing here reads or
 * signals the real viewers on the machine running the tests.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareCliVersions,
  confirmRecordedViewer,
  isOlderViewer,
  listRunningViewers,
  stopRecordedViewer,
  stopViewer,
  surveyCaveats,
  surveyViewers,
  type RunningViewer,
} from "../../../src/server/viewer-control.js";
import {
  DR_STATE_DIR_ENV,
  readViewerRecords,
  viewerRecordDir,
  viewerRecordPath,
  type ViewerHealth,
  type ViewerRecord,
} from "../../../src/server/viewer-registry.js";
import { scanViewerProcesses, type ProcessInfo } from "../../../src/server/viewer-processes.js";

const CLI = "/usr/local/lib/node_modules/@documentation-robotics/cli/dist";
/** When the fixture's records say their viewers started. */
const RECORDED = "2026-11-18T09:00:05.000Z";
const launcher = (pid: number, ppid: number, args = "--with-changesets --no-browser", startedAt = "2026-11-18T09:00:00.000Z"): ProcessInfo => ({
  pid,
  ppid,
  uid: 501,
  startedAt,
  command: `node ${CLI}/cli.js visualize ${args}`,
});
const server = (pid: number, ppid: number): ProcessInfo => ({
  pid,
  ppid,
  uid: 501,
  startedAt: "2026-11-18T09:00:01.000Z",
  command: `node ${CLI}/server-entry.js`,
});
/** The fixture's `dist/server-entry.js` is the dr CLI's; any other path is someone else's. */
const isDrServer = (command: string) => command.includes(CLI);
const scanDeps = { uid: 501, isDrServer };

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
      startedAt: RECORDED,
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

describe("confirmRecordedViewer: when a recorded pid may be signalled", () => {
  const record: ViewerRecord = {
    pid: 100,
    port: 8080,
    token: null,
    projectRoot: "/projects/a",
    startedAt: RECORDED,
    withChangesets: true,
    viewerId: "viewer-a",
    serverPid: 4243,
  };
  const table = [launcher(100, 1), server(101, 100)];
  const scanOf = (processes: ProcessInfo[]) => scanViewerProcesses(processes, { ...scanDeps, knownLaunchers: new Set([100]) });
  const own: ViewerHealth = { status: "ok", cliVersion: "0.7.0", viewerId: "viewer-a", pid: 101, launcherPid: 100 };

  it("is confirmed by the viewer itself: its /health names the record's id and its pids", () => {
    // No process table at all (no ps, Windows).
    expect(confirmRecordedViewer(record, own, null, null)).toEqual({
      kind: "confirmed",
      pids: { launcher: 100, server: 101, by: "health" },
    });
  });

  it("is not confirmed by some viewer answering on the recorded port", () => {
    for (const answer of [
      { status: "ok", cliVersion: "0.7.0" } as ViewerHealth, // says nothing about who it is
      { ...own, viewerId: "viewer-b" }, // another viewer took the port
      { ...own, launcherPid: 555 }, // names another launcher
      { status: "ok", viewerId: "viewer-a" } as ViewerHealth, // names no pids
    ]) {
      expect(confirmRecordedViewer(record, answer, null, null).kind).toBe("unconfirmed");
    }
    expect(confirmRecordedViewer(record, null, null, null)).toMatchObject({
      kind: "unconfirmed",
      reason: "it does not answer, and there is no process table to check its pid against",
    });
  });

  it("is confirmed by the process table: started before the record, a visualize argument, a dr server under it", () => {
    // The server pid comes from the table, never from the record (which says 4243).
    expect(confirmRecordedViewer(record, null, table, scanOf(table))).toEqual({
      kind: "confirmed",
      pids: { launcher: 100, server: 101, by: "process" },
    });
  });

  it("is stale when the pid started after the record was written (reused by another viewer's launcher)", () => {
    const reused = [launcher(100, 1, "--no-browser", "2026-11-20T08:00:00.000Z"), server(101, 100)];
    expect(confirmRecordedViewer(record, null, reused, scanOf(reused))).toMatchObject({
      kind: "stale",
      reason: "its pid now runs a process that started after the record was written",
    });
  });

  it("is stale when the pid runs another program or is gone", () => {
    const other = [{ pid: 100, ppid: 1, uid: 501, startedAt: "2026-11-01T00:00:00.000Z", command: "/usr/bin/postgres -D /var/db" }];
    expect(confirmRecordedViewer(record, null, other, scanOf(other)).kind).toBe("stale");
    expect(confirmRecordedViewer(record, null, [], scanOf([])).kind).toBe("stale");
  });

  it("is not confirmed by a `visualize` argument alone", () => {
    // Started before the record, so not provably reused, but nothing says it is a dr viewer.
    const lookalike = [{ pid: 100, ppid: 1, uid: 501, startedAt: "2026-11-01T00:00:00.000Z", command: "python manage.py visualize --all" }];
    expect(confirmRecordedViewer(record, null, lookalike, scanOf(lookalike))).toMatchObject({
      kind: "unconfirmed",
      reason: "its pid has no dr viewer server under it",
    });
    // A start time that cannot be compared proves nothing either way.
    const undated = [launcher(100, 1, "--no-browser", ""), server(101, 100)];
    expect(confirmRecordedViewer(record, null, undated, scanOf(undated)).kind).toBe("unconfirmed");
  });
});

describe("surveyViewers", () => {
  it("lists recorded viewers and ones the registry lost, with each one's version", () =>
    withFixture(async ({ env, scratch, projectRoot, put }) => {
      // The issue's case: a review_open viewer whose record a later `dr visualize` replaced.
      await put({ pid: 200, port: 8099, token: null, withChangesets: false, startedBy: "cli", startedAt: "2026-11-17T09:00:05.000Z" });
      const other = join(scratch, "other");
      const versions: Record<number, string | undefined> = { 8085: "0.5.0", 8099: "0.7.0", 8090: undefined };
      const survey = await surveyViewers({
        env,
        ...scanDeps,
        cliVersion: "0.7.0",
        isAlive: () => true,
        processes: () => [
          launcher(100, 1),
          server(101, 100),
          launcher(200, 50, "--no-auth --port 8099", "2026-11-17T09:00:00.000Z"),
          server(201, 200),
          launcher(300, 1),
          server(301, 300),
        ],
        cwdOf: (pid) => (pid === 300 ? other : join(projectRoot, "documentation-robotics")),
        portOf: (pid) => ({ 101: 8085, 301: 8090 })[pid] ?? null,
        health: async (port) => ({ status: "ok", ...(versions[port] ? { cliVersion: versions[port] } : {}) }),
      });
      const { viewers } = survey;

      expect(viewers.map((viewer) => [viewer.projectRoot, viewer.port, viewer.pid, viewer.cliVersion, viewer.inRegistry])).toEqual([
        [other, 8090, 300, null, false],
        // Sorted by project, then by start time: the recorded one started first.
        [projectRoot, 8099, 200, "0.7.0", true],
        [projectRoot, 8085, 100, "0.5.0", false],
      ]);
      const lost = viewers.find((viewer) => viewer.pid === 100)!;
      expect(lost).toMatchObject({ serverPid: 101, outdated: true, answering: true, withChangesets: true, token: null });
      expect(lost.confirmed).toEqual({ launcher: 100, server: 101, by: "process" });
      expect(viewers.find((viewer) => viewer.pid === 200)).toMatchObject({
        serverPid: 201,
        outdated: false,
        startedBy: "cli",
        confirmed: { launcher: 200, server: 201, by: "process" },
      });
      // Answers with no cliVersion: older than 0.6.0.
      expect(viewers.find((viewer) => viewer.pid === 300)).toMatchObject({ outdated: true });
      expect(survey).toMatchObject({ processScan: true, candidates: [], otherUsers: 0 });
      expect(surveyCaveats(survey)).toEqual([]);
    }));

  it("does not guess a lost viewer's chat mode when its command line does not say", () =>
    withFixture(async ({ env, projectRoot }) => {
      const viewers = await listRunningViewers({
        env,
        ...scanDeps,
        isAlive: () => true,
        processes: () => [
          launcher(100, 1, "--no-browser"),
          server(101, 100),
          launcher(200, 1, "--read-only --no-browser"),
          server(201, 200),
          launcher(300, 1, "--with-changesets --no-browser"),
          server(301, 300),
        ],
        cwdOf: () => projectRoot,
        portOf: (pid) => 8000 + pid,
        health: async () => ({ status: "ok", cliVersion: "0.7.0" }),
      });
      // The default mode depends on the CLI running it (it changed in 0.7.0).
      expect(viewers.map((viewer) => [viewer.pid, viewer.withChangesets]).sort()).toEqual([
        [100, null],
        [200, false],
        [300, true],
      ]);
    }));

  it("drops the record of a pid another program now holds, says so, and does not list it", () =>
    withFixture(async ({ env, projectRoot, put }) => {
      await put({ pid: 400, port: 8080 });
      const survey = await surveyViewers({
        env,
        ...scanDeps,
        isAlive: () => true,
        processes: () => [{ pid: 400, ppid: 1, uid: 501, startedAt: "", command: "/usr/bin/some-daemon --serve" }],
        health: async () => ({ status: "ok", cliVersion: "0.7.0" }),
      });
      expect(survey.viewers).toEqual([]);
      expect(await readViewerRecords(projectRoot, env)).toEqual([]);
      expect(survey.swept.records).toBe(1);
      expect(survey.swept.removed).toEqual([viewerRecordPath(projectRoot, 400, env)]);
    }));

  it("a record whose pid now runs another project's viewer is dropped; that viewer is listed as its own", () =>
    withFixture(async ({ env, scratch, projectRoot, put }) => {
      // The reviewer's case: record A (port 8080, server 4243) names pid 4242, which is now
      // project B's launcher, started days after record A was written.
      const projectB = join(scratch, "project-b");
      await put({ pid: 4242, port: 8080, serverPid: 4243 });
      const survey = await surveyViewers({
        env,
        ...scanDeps,
        isAlive: () => true,
        processes: () => [
          launcher(4242, 1, "--with-changesets --no-browser", "2026-11-20T08:00:00.000Z"),
          server(4300, 4242),
          { pid: 4243, ppid: 1, uid: 501, startedAt: "2026-11-19T08:00:00.000Z", command: "/usr/bin/postgres -D /var/db" },
        ],
        cwdOf: () => projectB,
        portOf: () => 8081,
        health: async () => null,
      });
      expect(survey.viewers.map((viewer) => [viewer.projectRoot, viewer.pid, viewer.port, viewer.inRegistry])).toEqual([
        [projectB, 4242, 8081, false],
      ]);
      expect(await readViewerRecords(projectRoot, env)).toEqual([]);
    }));

  it("lists a recorded viewer it cannot confirm, with why, and gives it no pids to signal", () =>
    withFixture(async ({ env, put }) => {
      await put({ pid: 4242, port: 8080, serverPid: 4243 });
      const survey = await surveyViewers({
        env,
        ...scanDeps,
        isAlive: () => true,
        processes: () => [
          { pid: 4242, ppid: 900, uid: 501, startedAt: "2026-11-01T08:00:00.000Z", command: "python manage.py visualize --all" },
          { pid: 4243, ppid: 1, uid: 501, startedAt: "2026-11-19T08:00:00.000Z", command: "/usr/bin/postgres -D /var/db" },
        ],
        health: async () => null,
      });
      expect(survey.viewers).toMatchObject([
        { pid: 4242, serverPid: null, confirmed: null, unconfirmed: "its pid has no dr viewer server under it", answering: false },
      ]);
    }));

  it("lists a dr server whose launcher is gone whether or not it answers, and never another program's", () =>
    withFixture(async ({ env, projectRoot }) => {
      const deps = {
        env,
        ...scanDeps,
        isAlive: () => true,
        processes: () => [
          server(501, 1),
          // A project's own server under init, with a /health of its own.
          { pid: 5151, ppid: 1, uid: 501, startedAt: "2026-11-10T08:00:00.000Z", command: "node /srv/shop/dist/server-entry.js" },
        ],
        cwdOf: () => projectRoot,
        portOf: () => 8091,
      };
      for (const answer of [null, { status: "ok" as const, cliVersion: "0.6.0" }]) {
        const viewers = await listRunningViewers({ ...deps, health: async () => answer });
        expect(viewers).toMatchObject([{ pid: null, serverPid: 501, port: 8091, projectRoot, inRegistry: false, answering: answer !== null }]);
      }
    }));

  it("says what it could not confirm and whose viewers it left out", () =>
    withFixture(async ({ env }) => {
      const survey = await surveyViewers({
        env,
        uid: 501,
        isDrServer: (command) => (command.includes(CLI) ? true : null),
        isAlive: () => true,
        processes: () => [
          { pid: 700, ppid: 1, uid: 501, startedAt: "", command: "node /srv/unknown/dist/server-entry.js" },
          { ...launcher(800, 1), uid: 777 },
          { ...server(801, 800), uid: 777 },
        ],
        health: async () => null,
      });
      expect(survey.viewers).toEqual([]);
      expect(survey).toMatchObject({ candidates: [700], otherUsers: 1 });
      expect(surveyCaveats(survey)).toEqual([
        "1 process runs a dist/server-entry.js that could not be confirmed to be the dr CLI's (pid 700): not listed, and never stopped from here.",
        "1 viewer of another user is running: not listed, and never stopped from here.",
      ]);
    }));

  it("without a process table, lists the registry, says so, and confirms only a viewer that names itself", () =>
    withFixture(async ({ env, put }) => {
      await put({ pid: 600, port: 8080, cliVersion: "0.7.0", viewerId: "v-600" });
      await put({ pid: 601, port: 8081 });
      await put({ pid: 602, port: 8082, viewerId: "v-602" });
      const answers: Record<number, ViewerHealth> = {
        8080: { status: "ok", cliVersion: "0.7.0", viewerId: "v-600", pid: 610, launcherPid: 600 },
        // Something answers on a stale record's port, saying nothing about who it is.
        8081: { status: "ok", cliVersion: "0.7.0" },
        // Another viewer holds 8082 now.
        8082: { status: "ok", cliVersion: "0.7.0", viewerId: "someone-else", pid: 999, launcherPid: 998 },
      };
      const survey = await surveyViewers({ env, isAlive: () => true, processes: () => null, health: async (port) => answers[port] ?? null });
      expect(survey.viewers.map((viewer) => [viewer.pid, viewer.answering, viewer.confirmed?.by ?? null, viewer.serverPid])).toEqual([
        [600, true, "health", 610],
        [601, true, null, null],
        [602, false, null, null],
      ]);
      expect(survey.processScan).toBe(false);
      expect(surveyCaveats(survey)).toEqual([
        "The registry lists 3 viewers. A process scan was not possible (ps is unavailable here or failed), so viewers the registry has lost are not shown.",
      ]);
    }));

  it("says when the process scan is turned off by its setting", () =>
    withFixture(async ({ env }) => {
      const off = { ...env, DR_VIEWER_PROCESS_SCAN: "off" };
      const survey = await surveyViewers({ env: off, isAlive: () => true, health: async () => null });
      expect(survey).toMatchObject({ processScan: false, processScanOff: "disabled" });
      expect(surveyCaveats(survey)[0]).toBe(
        "The registry lists no viewers. The process scan is turned off (DR_VIEWER_PROCESS_SCAN), so viewers the registry has lost are not shown."
      );
    }));

  it("gives each viewer the health timeout that DR_VIEWER_HEALTH_TIMEOUT_MS sets", () =>
    withFixture(async ({ env, put }) => {
      await put({ pid: 600, port: 8080 });
      const timeouts: number[] = [];
      const deps = {
        isAlive: () => true,
        processes: () => null,
        health: async (_port: number, timeoutMs: number) => {
          timeouts.push(timeoutMs);
          return null;
        },
      };
      await surveyViewers({ ...deps, env });
      await surveyViewers({ ...deps, env: { ...env, DR_VIEWER_HEALTH_TIMEOUT_MS: "250" } });
      expect(timeouts).toEqual([1500, 250]);
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
    confirmed: { launcher: 100, server: 101, by: "process" },
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
    expect(await stopViewer(viewer({ pid: null, confirmed: { launcher: null, server: 101, by: "process" } }), table.options)).toBe("stopped");
    expect(table.sent).toEqual([[101, "SIGTERM"]]);
  });

  it("signals nothing when the viewer's pids were not confirmed, whatever pids it lists", async () => {
    const table = processes([100, 101], () => {});
    expect(await stopViewer(viewer({ confirmed: null, unconfirmed: "it does not answer" }), table.options)).toBe("unverified");
    expect(table.sent).toEqual([]);
  });

  it("signals the confirmed pids, not the ones on display", async () => {
    const table = processes([100, 101, 4243], (pid, _signal, die) => die(pid));
    await stopViewer(viewer({ serverPid: 4243, confirmed: { launcher: 100, server: 101, by: "health" } }), table.options);
    expect(table.sent.map(([pid]) => pid)).not.toContain(4243);
  });

  it("waits as long as DR_VIEWER_STOP_TIMEOUT_MS says before it kills", async () => {
    const table = processes([100], (pid, signal, die) => {
      if (signal === "SIGKILL") die(pid);
    });
    const started = Date.now();
    const outcome = await stopViewer(viewer({ confirmed: { launcher: 100, server: null, by: "process" } }), {
      isAlive: table.options.isAlive,
      kill: table.options.kill,
      pollMs: 5,
      env: { DR_VIEWER_STOP_TIMEOUT_MS: "120" },
    });
    expect(outcome).toBe("force-killed");
    expect(Date.now() - started).toBeGreaterThanOrEqual(110);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("never signals pid 1 or itself, and says when the viewer is already gone", async () => {
    const table = processes([1, process.pid], () => {});
    expect(await stopViewer(viewer({ confirmed: { launcher: 1, server: process.pid, by: "process" } }), table.options)).toBe("not-running");
    expect(await stopViewer(viewer({ confirmed: { launcher: 777, server: 778, by: "process" } }), table.options)).toBe("not-running");
    expect(table.sent).toEqual([]);
  });

  it("reports a viewer that belongs to another user", async () => {
    const table = processes([100], () => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    });
    expect(await stopViewer(viewer({ confirmed: { launcher: 100, server: null, by: "process" } }), table.options)).toBe("not-permitted");
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

describe("stopRecordedViewer (review_open replacing a viewer)", () => {
  const own = (overrides: Partial<ViewerHealth> = {}): ViewerHealth => ({
    status: "ok",
    cliVersion: "0.7.0",
    viewerId: "v-100",
    pid: 101,
    launcherPid: 100,
    ...overrides,
  });

  it("stops a viewer that names itself, using the pids it gave", () =>
    withFixture(async ({ env, projectRoot, put }) => {
      // The record's serverPid is out of date; the viewer says 101.
      await put({ pid: 100, port: 8080, serverPid: 4243, viewerId: "v-100" });
      const [record] = await readViewerRecords(projectRoot, env);
      const table = processes([100, 101, 4243], (_pid, _signal, die) => {
        die(100);
        die(101);
      });
      const result = await stopRecordedViewer(record, { ...table.options, env, processes: () => null, health: async () => own() });
      expect(result).toEqual({ outcome: "stopped" });
      expect(table.sent).toEqual([[100, "SIGTERM"]]);
      expect(await readViewerRecords(projectRoot, env)).toEqual([]);
    }));

  it("signals nothing when there is no process table and the viewer does not name itself", () =>
    withFixture(async ({ env, projectRoot, put }) => {
      // The reviewer's case: a container without ps restarts with its state directory kept; pid
      // 23 is another program now, and something answers on the recorded port.
      await put({ pid: 23, port: 8080, serverPid: 24 });
      const [record] = await readViewerRecords(projectRoot, env);
      const table = processes([23, 24], () => {});
      for (const answer of [null, { status: "ok" as const, cliVersion: "0.7.0" }, own({ viewerId: "someone-else" })]) {
        const result = await stopRecordedViewer(record, { ...table.options, env, processes: () => null, health: async () => answer });
        expect(result.outcome).toBe("unverified");
        expect(result.reason).toContain("no process table to check its pid against");
      }
      expect(table.sent).toEqual([]);
      // Not confirmed, not stale: the record is left exactly as it was.
      expect(await readViewerRecords(projectRoot, env)).toHaveLength(1);
    }));

  it("signals nothing, and drops the record, when the pid is another program's", () =>
    withFixture(async ({ env, projectRoot, put }) => {
      await put({ pid: 100, port: 8080, serverPid: 4243 });
      const [record] = await readViewerRecords(projectRoot, env);
      const table = processes([100, 4243], () => {});
      const result = await stopRecordedViewer(record, {
        ...table.options,
        env,
        ...scanDeps,
        health: async () => null,
        processes: () => [{ pid: 100, ppid: 1, uid: 501, startedAt: "2026-11-01T00:00:00.000Z", command: "/usr/bin/postgres -D /var/db" }],
      });
      expect(result).toEqual({ outcome: "not-running", reason: "its pid now runs another program" });
      expect(table.sent).toEqual([]);
      expect(await readViewerRecords(projectRoot, env)).toEqual([]);
    }));

  it("signals nothing when the pid looks like a viewer but is a later process (a reused pid)", () =>
    withFixture(async ({ env, projectRoot, put }) => {
      await put({ pid: 100, port: 8080, serverPid: 4243 });
      const [record] = await readViewerRecords(projectRoot, env);
      const table = processes([100, 101, 4243], () => {});
      const result = await stopRecordedViewer(record, {
        ...table.options,
        env,
        ...scanDeps,
        health: async () => null,
        processes: () => [launcher(100, 1, "--no-browser", "2026-11-20T08:00:00.000Z"), server(101, 100)],
      });
      expect(result.outcome).toBe("not-running");
      expect(table.sent).toEqual([]);
    }));

  it("stops a viewer that does not answer when the process table confirms it", () =>
    withFixture(async ({ env, projectRoot, put }) => {
      await put({ pid: 100, port: 8080, serverPid: 4243 });
      const [record] = await readViewerRecords(projectRoot, env);
      const table = processes([100, 101, 4243], (_pid, _signal, die) => {
        die(100);
        die(101);
      });
      const result = await stopRecordedViewer(record, {
        ...table.options,
        env,
        ...scanDeps,
        health: async () => null,
        processes: () => [launcher(100, 1), server(101, 100)],
      });
      expect(result).toEqual({ outcome: "stopped" });
      expect(table.sent).toEqual([[100, "SIGTERM"]]);
      expect(table.live.has(4243)).toBe(true);
    }));
});
