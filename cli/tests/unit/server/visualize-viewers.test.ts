/**
 * `dr visualize --list` and `--stop` (#1237; issue 1279 slice 4A): the central process and the
 * legacy per-project viewers that are listed, and what a stop stops.
 *
 * The process table and the kill are injected: nothing here reads or signals real viewers.
 * tests/unit/server runs with --concurrent, so each test makes its own scratch dir and captures
 * its own output (withFixture) instead of sharing module-level state.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatCentralProcess,
  formatViewerTable,
  legacyViewerReason,
  listViewersCommand,
  selectViewersToStop,
  stopCommand,
  stopViewersCommand,
  viewerNotes,
  type CentralProcessState,
} from "../../../src/commands/visualize-viewers.js";
import type { RunningViewer } from "../../../src/server/viewer-control.js";
import { DR_STATE_DIR_ENV, viewerRecordDir, viewerRecordPath } from "../../../src/server/viewer-registry.js";
import type { ProcessInfo } from "../../../src/server/viewer-processes.js";

function viewer(overrides: Partial<RunningViewer> = {}): RunningViewer {
  return {
    projectRoot: "/projects/a",
    port: 8080,
    pid: 100,
    serverPid: 101,
    cliVersion: "0.7.0",
    outdated: false,
    startedAt: "2026-11-20T09:16:00.000Z",
    startedBy: "review_open",
    withChangesets: true,
    idleExitHours: 24,
    inRegistry: true,
    answering: true,
    confirmed: { launcher: 100, server: 101, by: "process" },
    token: "secret-token",
    ...overrides,
  };
}

interface Fixture {
  scratch: string;
  projectA: string;
  projectB: string;
  /** Lines the command printed. */
  output: string[];
  log: (line: string) => void;
}

async function withFixture(body: (fx: Fixture) => Promise<void>): Promise<void> {
  const scratch = join(await realpath(tmpdir()), `dr-visualize-viewers-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const projectA = join(scratch, "a");
  const projectB = join(scratch, "b");
  await mkdir(join(projectA, "documentation-robotics", "model"), { recursive: true });
  await mkdir(join(projectB, "documentation-robotics", "model"), { recursive: true });
  await mkdir(join(scratch, "plain"), { recursive: true });
  const output: string[] = [];
  try {
    await body({ scratch, projectA, projectB, output, log: (line) => void output.push(line) });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

describe("formatViewerTable", () => {
  it("shows project, port, pid, CLI version and start time, one viewer a line", () => {
    const table = formatViewerTable(
      [
        viewer({ projectRoot: join(homedir(), "workspace", "shop") }),
        viewer({ projectRoot: "/projects/b", port: 8084, pid: 200, cliVersion: "0.5.0", outdated: true, startedBy: null, inRegistry: false, idleExitHours: null }),
      ],
      "0.7.0"
    );
    const lines = table.split("\n");
    expect(lines[0]).toMatch(/^PROJECT\s+PORT\s+PID\s+CLI\s+STARTED\s+NOTES$/);
    expect(lines[1]).toMatch(/^~\/workspace\/shop\s+8080\s+100\s+0\.7\.0\s+\d{4}-\d\d-\d\d \d\d:\d\d\s+started by review_open; exits after 24h idle$/);
    expect(lines[2]).toMatch(/^\/projects\/b\s+8084\s+200\s+0\.5\.0\s+\S+ \S+\s+not in the registry; older than this CLI \(0\.7\.0\)$/);
    expect(table).not.toContain("secret-token");
  });

  it("says what it could not find out", () => {
    const table = formatViewerTable([
      viewer({ projectRoot: null, port: null, pid: null, serverPid: 301, cliVersion: null, startedAt: "", inRegistry: false, startedBy: null, idleExitHours: null }),
    ]);
    expect(table.split("\n")[1]).toMatch(
      /^\(unknown project\)\s+\?\s+301\s+<0\.6\.0\s+\?\s+not in the registry; launcher gone, server pid 301; port not found$/
    );
  });
});

describe("viewerNotes", () => {
  it("marks a viewer that does not answer, rather than calling it old", () => {
    expect(viewerNotes(viewer({ answering: false, cliVersion: null, startedBy: "cli", idleExitHours: null }))).toEqual(["does not answer"]);
  });

  it("says when a viewer's port could not be found, rather than that it does not answer", () => {
    expect(viewerNotes(viewer({ port: null, answering: false, cliVersion: null, startedBy: null, idleExitHours: null, inRegistry: false }))).toEqual([
      "not in the registry",
      "port not found",
    ]);
  });
});

describe("selectViewersToStop", () => {
  const all = ({ projectA, projectB }: Fixture) => [
    viewer({ projectRoot: projectA, port: 8080, pid: 100 }),
    viewer({ projectRoot: projectA, port: 8084, pid: 200 }),
    viewer({ projectRoot: projectB, port: 8081, pid: 300 }),
  ];

  it("takes the current project's viewers by default, from anywhere inside it", () =>
    withFixture(async (fx) => {
      const selected = await selectViewersToStop(all(fx), { cwd: join(fx.projectA, "documentation-robotics", "model") });
      expect(selected.map((v) => v.pid)).toEqual([100, 200]);
    }));

  it("takes a named project's viewers", () =>
    withFixture(async (fx) => {
      expect((await selectViewersToStop(all(fx), { project: fx.projectB, cwd: fx.projectA })).map((v) => v.pid)).toEqual([300]);
      expect((await selectViewersToStop(all(fx), { project: "../b", cwd: fx.projectA })).map((v) => v.pid)).toEqual([300]);
    }));

  it("takes one viewer by port, in the current project or anywhere", () =>
    withFixture(async (fx) => {
      const plain = join(fx.scratch, "plain");
      expect((await selectViewersToStop(all(fx), { port: "8084", cwd: plain })).map((v) => v.pid)).toEqual([200]);
      expect((await selectViewersToStop(all(fx), { port: 8081, project: fx.projectA })).map((v) => v.pid)).toEqual([]);
    }));

  it("takes everything only with --all", () =>
    withFixture(async (fx) => {
      expect((await selectViewersToStop(all(fx), { all: true, cwd: fx.projectA })).map((v) => v.pid)).toEqual([100, 200, 300]);
    }));

  it("refuses to guess outside a project", () =>
    withFixture(async (fx) => {
      await expect(selectViewersToStop(all(fx), { cwd: join(fx.scratch, "plain") })).rejects.toThrow(/No project here/);
      await expect(selectViewersToStop(all(fx), { port: "http", cwd: fx.projectA })).rejects.toThrow(/Invalid port number/);
    }));
});

describe("the commands", () => {
  const CLI = "/usr/local/lib/node_modules/@documentation-robotics/cli/dist";
  const table = (): ProcessInfo[] => [
    { pid: 100, ppid: 1, startedAt: "2026-11-17T09:00:00.000Z", command: `node ${CLI}/cli.js visualize --with-changesets --no-browser` },
    { pid: 101, ppid: 100, startedAt: "2026-11-17T09:00:01.000Z", command: `node ${CLI}/server-entry.js` },
    { pid: 300, ppid: 1, startedAt: "2026-11-18T09:00:00.000Z", command: `node ${CLI}/cli.js visualize --with-changesets --no-browser` },
    { pid: 301, ppid: 300, startedAt: "2026-11-18T09:00:01.000Z", command: `node ${CLI}/server-entry.js` },
  ];
  const deps = ({ scratch, projectA, projectB, log }: Fixture, json = false) => ({
    env: { [DR_STATE_DIR_ENV]: join(scratch, "state") },
    cliVersion: "0.7.0",
    isAlive: () => true,
    processes: table,
    cwdOf: (pid: number) => (pid === 100 ? projectA : projectB),
    portOf: (pid: number) => (pid === 101 ? 8082 : 8083),
    health: async () => ({ status: "ok" as const, cliVersion: "0.5.0" }),
    // The fixture's dist/server-entry.js is the dr CLI's (the real check reads its package.json).
    isDrServer: (command: string) => command.includes(CLI),
    readCentral: async (): Promise<CentralProcessState> => ({ farmRoot: join(scratch, "farm"), record: null, health: null }),
    log,
    json,
  });
  /** A fake kill: the launcher takes its server with it; `refuse` pids belong to someone else. */
  const fakeStop = (live: Set<number>, signalled: number[] = [], refuse: number[] = []) => ({
    isAlive: (pid: number) => live.has(pid),
    kill: (pid: number) => {
      signalled.push(pid);
      if (refuse.includes(pid)) throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
      live.delete(pid);
      live.delete(pid + 1);
    },
    pollMs: 5,
  });

  it("--list prints the viewers the registry lost, and how to stop them", () =>
    withFixture(async (fx) => {
      await listViewersCommand(deps(fx));
      const text = fx.output.join("\n");
      expect(text).toContain("8082");
      expect(text).toContain("8083");
      expect(text).toContain("not in the registry; older than this CLI (0.7.0)");
      expect(text).toContain("dr visualize --stop");
      // How many, and where they were found: over all of them, not a page of them.
      expect(text).toContain("2 per-project viewers running: 0 in the registry, 2 found only in the process table.");
      // Each with the reason the central process's start-up sweep keeps it.
      expect(text).toContain("kept: started from a terminal");
      expect(text).toContain("No DR process is running for");
      expect(text).not.toContain("process scan was not possible");
    }));

  it("--list says the list may be incomplete when the process table cannot be read", () =>
    withFixture(async (fx) => {
      // One recorded viewer; a second, unrecorded one cannot be seen without ps.
      const env = deps(fx).env;
      await mkdir(viewerRecordDir(env), { recursive: true });
      await writeFile(
        viewerRecordPath(fx.projectA, 100, env),
        JSON.stringify({ pid: 100, port: 8082, token: null, projectRoot: fx.projectA, startedAt: "", withChangesets: true })
      );
      const { survey } = await listViewersCommand({ ...deps(fx), processes: () => null });
      expect(survey.processScan).toBe(false);
      const text = fx.output.join("\n");
      expect(text).toContain("8082");
      expect(text).toContain(
        "The registry lists 1 viewer. A process scan was not possible (ps is unavailable here or failed), so viewers the registry has lost are not shown."
      );
      expect(text).not.toContain("found only in the process table");

      // The same in JSON, and with nothing recorded: never a bare "none".
      fx.output.length = 0;
      await listViewersCommand({ ...deps(fx, true), processes: () => null });
      const parsed = JSON.parse(fx.output.join("\n"));
      expect(parsed).not.toHaveProperty("complete");
      expect(parsed.processScan).toEqual({ available: false, why: "unavailable" });
      expect(parsed.caveats).toHaveLength(1);
      expect(parsed.caveats[0]).toContain("viewers the registry has lost are not shown");
      // Without ps, a viewer that does not name itself on /health has no pids to signal.
      expect(parsed.legacyViewers[0]).toMatchObject({ pid: 100, confirmed: null, keptReason: "not-started-by-review-open" });
      expect(parsed.legacyViewers[0].unconfirmed).toContain("no process table");
      fx.output.length = 0;
      await listViewersCommand({ ...deps(fx), env: { [DR_STATE_DIR_ENV]: join(fx.scratch, "empty") }, processes: () => null });
      expect(fx.output.join("\n")).toContain("The registry lists no viewers. A process scan was not possible");
      expect(fx.output.join("\n")).not.toContain("No per-project viewers are running.");
    }));

  it("--list says what reading the registry removed, with counts", () =>
    withFixture(async (fx) => {
      const env = deps(fx).env;
      await mkdir(viewerRecordDir(env), { recursive: true });
      // Two records of viewers that are gone.
      for (const pid of [901, 902]) {
        await writeFile(
          viewerRecordPath(fx.projectA, pid, env),
          JSON.stringify({ pid, port: 8099, token: null, projectRoot: fx.projectA, startedAt: "", withChangesets: false })
        );
      }
      const { survey } = await listViewersCommand({ ...deps(fx), isAlive: (pid) => pid !== 901 && pid !== 902 });
      expect(survey.swept.records).toBe(2);
      expect(fx.output.join("\n")).toContain("Removed 2 stale records from the registry.");

      fx.output.length = 0;
      await listViewersCommand(deps(fx));
      expect(fx.output.join("\n")).not.toContain("Removed");
    }));

  it("--list warns about a time-limit setting it could not use, and --json shows the values in effect", () =>
    withFixture(async (fx) => {
      const env = { ...deps(fx).env, DR_VIEWER_STOP_TIMEOUT_MS: "soon", DR_VIEWER_IDLE_HOURS: "72" };
      await listViewersCommand({ ...deps(fx), env });
      expect(fx.output.join("\n")).toContain("DR_VIEWER_STOP_TIMEOUT_MS=soon is not a usable value; using the default, 8000 ms.");

      fx.output.length = 0;
      await listViewersCommand({ ...deps(fx, true), env });
      const { settings } = JSON.parse(fx.output.join("\n"));
      expect(settings.idleHours).toEqual({ env: "DR_VIEWER_IDLE_HOURS", value: 72, unit: "hours", default: 24 });
      expect(settings.stopTimeoutMs).toMatchObject({ value: 8000, ignored: "soon" });
      expect(Object.keys(settings).sort()).toEqual(
        ["healthRetryTimeoutMs", "healthTimeoutMs", "idleHours", "lifetimeCheckMs", "logKeepDays", "statusHealthTimeoutMs", "stopTimeoutMs"]
      );
    }));

  it("--list --json gives the same list without tokens", () =>
    withFixture(async (fx) => {
      await listViewersCommand(deps(fx, true));
      const parsed = JSON.parse(fx.output.join("\n"));
      expect(parsed.cliVersion).toBe("0.7.0");
      // It never claims to be complete; it lists what it knows to be missing, here nothing.
      expect(parsed).not.toHaveProperty("complete");
      expect(parsed.caveats).toEqual([]);
      expect(parsed.processScan).toEqual({ available: true });
      expect(parsed.counts).toEqual({ total: 2, inRegistry: 0, processOnly: 2, unconfirmedCandidates: 0, otherUsers: 0 });
      expect(parsed.swept).toEqual({ records: 0, startingMarkers: 0, logs: 0, tempFiles: 0, removed: [], unreadable: [] });
      expect(parsed.central).toMatchObject({ running: false, answering: false, record: null });
      expect(parsed.legacyViewers.map((v: { port: number }) => v.port)).toEqual([8082, 8083]);
      expect(parsed.legacyViewers[0]).toMatchObject({
        projectRoot: fx.projectA,
        pid: 100,
        serverPid: 101,
        cliVersion: "0.5.0",
        outdated: true,
        inRegistry: false,
      });
      expect(parsed.legacyViewers[0]).not.toHaveProperty("token");
    }));

  it("--list says so when nothing runs", () =>
    withFixture(async (fx) => {
      await listViewersCommand({ ...deps(fx), processes: () => [] });
      expect(fx.output[0]).toStartWith("No DR process is running for");
      expect(fx.output).toContain("No per-project viewers are running.");
    }));

  it("--list shows the central process with its tabs, MCP sessions and DrBot turns, and leaves it out of the legacy list", () =>
    withFixture(async (fx) => {
      const central: CentralProcessState = {
        farmRoot: join(fx.scratch, "farm"),
        record: {
          farmRoot: join(fx.scratch, "farm"),
          pid: 4242,
          port: 8090,
          cliVersion: "0.7.1",
          startedAt: "2026-11-24T09:00:00.000Z",
          tokenPath: join(fx.scratch, "state", "servers", "x.token"),
        },
        health: { status: "ok", cliVersion: "0.7.1", pid: 4242, clients: 2, mcpSessions: 1, drBotTurns: 0, loadedCheckouts: 3 },
      };
      await listViewersCommand({ ...deps(fx), processes: () => [], readCentral: async () => central });
      const text = fx.output.join("\n");
      expect(text).toContain("pid 4242, port 8090, CLI 0.7.1");
      expect(text).toContain("2 browser tabs, 1 MCP session, 0 DrBot turns, 3 checkouts loaded");

      fx.output.length = 0;
      await listViewersCommand({ ...deps(fx, true), processes: () => [], readCentral: async () => central });
      const parsed = JSON.parse(fx.output.join("\n"));
      expect(parsed.central).toMatchObject({ running: true, answering: true, record: { pid: 4242, port: 8090 } });
      expect(parsed.central.record).not.toHaveProperty("tokenPath");
      expect(parsed.central.health).toMatchObject({ clients: 2, mcpSessions: 1, drBotTurns: 0 });
    }));

  it("--stop stops the central process with dr serve's confirmed stop, and leaves legacy viewers alone", () =>
    withFixture(async (fx) => {
      const live = new Set([100, 101, 300, 301]);
      const signalled: number[] = [];
      const calls: unknown[] = [];
      const result = await stopCommand(
        { cwd: fx.projectA },
        {
          ...deps(fx),
          stop: fakeStop(live, signalled),
          serve: async (options, overrides) => {
            calls.push({ options, cwd: overrides.cwd });
            overrides.out(JSON.stringify({ stopped: true, pid: 4242, forced: false }));
          },
        }
      );
      expect(calls).toEqual([{ options: { stop: true, json: true }, cwd: fx.projectA }]);
      expect(result).toEqual({ central: { stopped: true, pid: 4242, forced: false }, legacy: null });
      expect(signalled).toEqual([]);
      expect(fx.output.join("\n")).toContain("Stopped the DR process (pid 4242)");
    }));

  it("--stop --all also stops every legacy viewer whose pids are confirmed, even when no DR process runs", () =>
    withFixture(async (fx) => {
      const live = new Set([100, 101, 300, 301]);
      const signalled: number[] = [];
      const result = await stopCommand(
        { all: true, includeUnrecorded: true, cwd: fx.projectA },
        {
          ...deps(fx),
          stop: fakeStop(live, signalled),
          serve: async (_options, overrides) => overrides.out(JSON.stringify({ stopped: false, running: false })),
        }
      );
      expect(result.central).toEqual({ stopped: false, running: false });
      expect(result.legacy).toMatchObject({ found: 2, matched: 2, stopped: 2, notStopped: [] });
      expect(signalled.sort()).toEqual([100, 300]);
      expect(fx.output.join("\n")).toContain("No DR process is running for this farm.");
    }));

  it("--stop --all still stops legacy viewers when the central stop fails, then fails", () =>
    withFixture(async (fx) => {
      const live = new Set([100, 101, 300, 301]);
      const signalled: number[] = [];
      await expect(
        stopCommand(
          { all: true, includeUnrecorded: true, cwd: fx.projectA },
          {
            ...deps(fx),
            stop: fakeStop(live, signalled),
            serve: async () => {
              throw new Error("pid 4242 in the server record could not be confirmed");
            },
          }
        )
      ).rejects.toThrow("could not be confirmed");
      expect(signalled.sort()).toEqual([100, 300]);
    }));

  it("--stop stops only the named project's viewer", () =>
    withFixture(async (fx) => {
      const live = new Set([100, 101, 300, 301]);
      const signalled: number[] = [];
      const summary = await stopViewersCommand(
        { project: fx.projectA, includeUnrecorded: true },
        { ...deps(fx), stop: fakeStop(live, signalled) }
      );
      expect(summary.results.map((r) => [r.viewer.pid, r.outcome])).toEqual([[100, "stopped"]]);
      expect(summary).toMatchObject({ found: 2, matched: 1, stopped: 1, notStopped: [], processScan: true });
      expect(signalled).toEqual([100]);
      expect(live.has(300)).toBe(true);
      expect(fx.output.join("\n")).toContain("Stopped the viewer for");
      expect(fx.output.join("\n")).toContain("port 8082, pid 100");
      expect(fx.output.join("\n")).toContain("2 viewers were running; 1 matched; 1 stopped.");
    }));

  it("--stop --all says how many it found and stopped, names the ones it could not stop, and fails", () =>
    withFixture(async (fx) => {
      const live = new Set([100, 101, 300, 301]);
      // The second viewer belongs to someone else (the process table said it was ours, the kill says not).
      const stop = fakeStop(live, [], [300]);
      await expect(stopViewersCommand({ all: true, includeUnrecorded: true }, { ...deps(fx), stop })).rejects.toThrow(
        /1 matching viewer is still running: .*port 8083, pid 300\): belongs to another user/
      );
      const text = fx.output.join("\n");
      expect(text).toContain("2 viewers were running; 2 matched; 1 stopped; 1 not stopped.");
      expect(text).toContain("Could not stop (it belongs to another user):");
      expect(text).toContain("port 8083, pid 300");

      // The same as JSON: counts over the whole set, and each one not stopped with its pid.
      fx.output.length = 0;
      live.add(100).add(101);
      await expect(stopViewersCommand({ all: true, includeUnrecorded: true }, { ...deps(fx, true), stop })).rejects.toThrow(/still running/);
      const parsed = JSON.parse(fx.output.join("\n"));
      expect(parsed).toMatchObject({ found: 2, matched: 2, stopped: 1, caveats: [], unrecordedLeft: [] });
      expect(parsed.notStopped).toMatchObject([{ viewer: { pid: 300, port: 8083 }, outcome: "not-permitted" }]);
    }));

  it("--stop says when the process table could not be read, and when a viewer's project is unknown", () =>
    withFixture(async (fx) => {
      const noScan = await stopViewersCommand({ all: true }, { ...deps(fx), processes: () => null });
      expect(noScan).toMatchObject({ found: 0, matched: 0, stopped: 0, processScan: false });
      expect(fx.output.join("\n")).toContain("0 viewers were running; 0 matched; 0 stopped.");
      expect(fx.output.join("\n")).toContain("viewers the registry has lost are not shown");

      // A viewer whose folder could not be read cannot be matched by project: not skipped unseen.
      fx.output.length = 0;
      const summary = await stopViewersCommand(
        { project: fx.projectA, includeUnrecorded: true },
        { ...deps(fx), cwdOf: (pid: number) => (pid === 100 ? fx.projectA : null), stop: { isAlive: () => false } }
      );
      expect(summary.unknownProject.map((viewer) => viewer.pid)).toEqual([300]);
      expect(fx.output.join("\n")).toContain("1 running viewer has a project that could not be worked out (pid 300, port 8083)");
    }));

  it("--stop leaves viewers that are not in this registry unless --include-unrecorded is given (#1271 review 7)", () =>
    withFixture(async (fx) => {
      // Both running viewers were found only in the process table: another state directory's, or lost records.
      const live = new Set([100, 101, 300, 301]);
      const signalled: number[] = [];
      await expect(stopViewersCommand({ all: true }, { ...deps(fx), stop: fakeStop(live, signalled) })).rejects.toThrow(
        /2 matching viewers are still running: .*not in this registry \(add --include-unrecorded\)/
      );
      expect(signalled).toEqual([]);
      expect(live.size).toBe(4);
      const text = fx.output.join("\n");
      expect(text).toContain("2 viewers were running; 2 matched; 0 stopped; 2 not stopped.");
      expect(text).toContain("2 matching viewers are not in this registry (pid 100, port 8082; pid 300, port 8083) and were left running");

      // --stop --port is the same.
      fx.output.length = 0;
      await expect(stopViewersCommand({ port: 8082 }, { ...deps(fx), stop: fakeStop(live, signalled) })).rejects.toThrow(/not in this registry/);
      expect(signalled).toEqual([]);
    }));

  it("--stop stops a recorded viewer that names itself on /health, without a process table", () =>
    withFixture(async (fx) => {
      const env = deps(fx).env;
      await mkdir(viewerRecordDir(env), { recursive: true });
      await writeFile(
        viewerRecordPath(fx.projectA, 100, env),
        JSON.stringify({ pid: 100, port: 8082, token: null, projectRoot: fx.projectA, startedAt: "2026-11-17T09:00:05.000Z", withChangesets: true, viewerId: "v-a", serverPid: 4243 })
      );
      const live = new Set([100, 101, 4243]);
      const signalled: number[] = [];
      const summary = await stopViewersCommand(
        { project: fx.projectA },
        {
          ...deps(fx),
          processes: () => null,
          health: async () => ({ status: "ok" as const, cliVersion: "0.7.0", viewerId: "v-a", pid: 101, launcherPid: 100 }),
          stop: fakeStop(live, signalled),
        }
      );
      expect(summary).toMatchObject({ matched: 1, stopped: 1 });
      // The server pid came from the viewer (101), never from the record (4243).
      expect(signalled).toEqual([100]);
      expect(live.has(4243)).toBe(true);
    }));

  it("--stop says when nothing matches", () =>
    withFixture(async (fx) => {
      const summary = await stopViewersCommand({ project: join(fx.scratch, "plain") }, deps(fx));
      expect(summary.results).toEqual([]);
      expect(fx.output.join("\n")).toContain("2 viewers were running; 0 matched; 0 stopped.");
    }));
});

describe("legacyViewerReason", () => {
  it("gives the start-up sweep's reason for keeping a viewer, or unused when the next sweep stops it", () => {
    expect(legacyViewerReason(viewer({ startedBy: "cli" }))).toBe("not-started-by-review-open");
    expect(legacyViewerReason(viewer({ clients: 1 }))).toBe("tabs-connected");
    expect(legacyViewerReason(viewer({ clients: undefined }))).toBe("unknown-tabs");
    expect(legacyViewerReason(viewer({ clients: 0, confirmed: null }))).toBe("unconfirmed");
    expect(legacyViewerReason(viewer({ clients: 0 }))).toBe("unused");
    // The central process itself is never listed as a legacy viewer.
    expect(legacyViewerReason(viewer({ clients: 0 }), [100])).toBeNull();
  });

  it("keeps another farm's viewer, as the farm's own process would (#1369)", () => {
    expect(legacyViewerReason(viewer({ clients: 0 }), [], ["/projects/a"])).toBe("unused");
    expect(legacyViewerReason(viewer({ clients: 0, projectRoot: "/elsewhere" }), [], ["/projects/a"])).toBe("outside-farm");
  });
});

describe("formatCentralProcess", () => {
  it("says when no process runs, and when one does not answer", () => {
    expect(formatCentralProcess({ farmRoot: "/farm", record: null, health: null })).toEqual([
      "No DR process is running for /farm.",
    ]);
    const lines = formatCentralProcess({
      farmRoot: "/farm",
      record: { farmRoot: "/farm", pid: 7, port: 8080, cliVersion: "0.7.1", startedAt: "", tokenPath: "/x.token" },
      health: null,
    });
    expect(lines[2]).toBe("  not answering on http://127.0.0.1:8080/health");
  });
});
