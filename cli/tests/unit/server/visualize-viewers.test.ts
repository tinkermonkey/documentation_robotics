/**
 * `dr visualize --list` and `--stop` (#1237): what is listed, and which viewers a stop names.
 *
 * The process table and the kill are injected: nothing here reads or signals real viewers.
 * tests/unit/server runs with --concurrent, so each test makes its own scratch dir and captures
 * its own output (withFixture) instead of sharing module-level state.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatViewerTable,
  listViewersCommand,
  selectViewersToStop,
  stopViewersCommand,
  viewerNotes,
} from "../../../src/commands/visualize-viewers.js";
import type { RunningViewer } from "../../../src/server/viewer-control.js";
import { DR_STATE_DIR_ENV } from "../../../src/server/viewer-registry.js";
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
    verified: true,
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
    expect(table.split("\n")[1]).toMatch(/^\(unknown project\)\s+\?\s+301\s+<0\.6\.0\s+\?\s+not in the registry; launcher gone, server pid 301$/);
  });
});

describe("viewerNotes", () => {
  it("marks a viewer that does not answer, rather than calling it old", () => {
    expect(viewerNotes(viewer({ answering: false, cliVersion: null, startedBy: "cli", idleExitHours: null }))).toEqual(["does not answer"]);
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
    log,
    json,
  });

  it("--list prints the viewers the registry lost, and how to stop them", () =>
    withFixture(async (fx) => {
      await listViewersCommand(deps(fx));
      const text = fx.output.join("\n");
      expect(text).toContain("8082");
      expect(text).toContain("8083");
      expect(text).toContain("not in the registry; older than this CLI (0.7.0)");
      expect(text).toContain("dr visualize --stop");
    }));

  it("--list --json gives the same list without tokens", () =>
    withFixture(async (fx) => {
      await listViewersCommand(deps(fx, true));
      const parsed = JSON.parse(fx.output.join("\n"));
      expect(parsed.cliVersion).toBe("0.7.0");
      expect(parsed.viewers.map((v: { port: number }) => v.port)).toEqual([8082, 8083]);
      expect(parsed.viewers[0]).toMatchObject({
        projectRoot: fx.projectA,
        pid: 100,
        serverPid: 101,
        cliVersion: "0.5.0",
        outdated: true,
        inRegistry: false,
      });
      expect(parsed.viewers[0]).not.toHaveProperty("token");
    }));

  it("--list says so when nothing runs", () =>
    withFixture(async (fx) => {
      await listViewersCommand({ ...deps(fx), processes: () => [] });
      expect(fx.output).toEqual(["No viewers are running."]);
    }));

  it("--stop stops only the named project's viewer", () =>
    withFixture(async (fx) => {
      const live = new Set([100, 101, 300, 301]);
      const signalled: number[] = [];
      const results = await stopViewersCommand(
        { project: fx.projectA },
        {
          ...deps(fx),
          stop: {
            isAlive: (pid) => live.has(pid),
            kill: (pid) => {
              signalled.push(pid);
              live.delete(pid);
              if (pid === 100) live.delete(101);
            },
            pollMs: 5,
          },
        }
      );
      expect(results.map((r) => [r.viewer.pid, r.outcome])).toEqual([[100, "stopped"]]);
      expect(signalled).toEqual([100]);
      expect(live.has(300)).toBe(true);
      expect(fx.output.join("\n")).toContain("Stopped the viewer for");
      expect(fx.output.join("\n")).toContain("port 8082, pid 100");
    }));

  it("--stop says when nothing matches", () =>
    withFixture(async (fx) => {
      const results = await stopViewersCommand({ project: join(fx.scratch, "plain") }, deps(fx));
      expect(results).toEqual([]);
      expect(fx.output.join("\n")).toContain("No running viewer matches");
    }));
});
