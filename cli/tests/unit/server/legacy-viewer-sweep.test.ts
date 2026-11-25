/**
 * The central process's start-up sweep of per-project viewers (#1279, design section 7): it stops
 * only an unused viewer review_open started, and reports every other one with the reason.
 *
 * Every test injects the survey, the health check and the stop: nothing here reads or signals the
 * real viewers on the machine running the tests.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sweepDecision,
  sweepPerProjectViewers,
} from "../../../src/server/legacy-viewer-sweep.js";
import type { RunningViewer, StopOutcome, ViewerSurvey } from "../../../src/server/viewer-control.js";
import { surveyViewers } from "../../../src/server/viewer-control.js";
import {
  DR_STATE_DIR_ENV,
  emptySweep,
  viewerRecordDir,
  viewerRecordPath,
  type ViewerHealth,
  type ViewerRecord,
} from "../../../src/server/viewer-registry.js";

function viewer(overrides: Partial<RunningViewer> = {}): RunningViewer {
  return {
    projectRoot: "/projects/a",
    port: 8080,
    pid: 100,
    serverPid: 101,
    cliVersion: "0.7.1",
    outdated: false,
    startedAt: "2026-11-18T09:00:05.000Z",
    startedBy: "review_open",
    withChangesets: true,
    idleExitHours: 24,
    inRegistry: true,
    answering: true,
    clients: 0,
    confirmed: { launcher: 100, server: 101, by: "health" },
    token: "secret",
    ...overrides,
  };
}

function survey(viewers: RunningViewer[], overrides: Partial<ViewerSurvey> = {}): ViewerSurvey {
  return {
    viewers,
    processScan: true,
    candidates: [],
    otherUsers: 0,
    swept: emptySweep(),
    ...overrides,
  };
}

describe("sweepDecision within a farm (#1369)", () => {
  it("stops only a viewer whose project is in one of the farm's folders", () => {
    const farmRoots = ["/projects/a", "/worktrees/a-feature"];
    expect(sweepDecision(viewer({ projectRoot: "/projects/a" }), new Set(), farmRoots)).toBe("stop");
    expect(sweepDecision(viewer({ projectRoot: "/projects/a/sub" }), new Set(), farmRoots)).toBe("stop");
    expect(sweepDecision(viewer({ projectRoot: "/worktrees/a-feature" }), new Set(), farmRoots)).toBe("stop");
    expect(sweepDecision(viewer({ projectRoot: "/projects/ab" }), new Set(), farmRoots)).toBe("outside-farm");
    expect(sweepDecision(viewer({ projectRoot: null }), new Set(), farmRoots)).toBe("outside-farm");
    // An empty farm sweeps nothing; no farm given keeps the old rule.
    expect(sweepDecision(viewer(), new Set(), [])).toBe("outside-farm");
    expect(sweepDecision(viewer(), new Set())).toBe("stop");
  });

  it("keeps another farm's viewers and reports why", async () => {
    const stopped: RunningViewer[] = [];
    const ours = viewer({ projectRoot: "/projects/a" });
    const theirs = viewer({ projectRoot: "/elsewhere/b", pid: 200, serverPid: 201 });
    const result = await sweepPerProjectViewers({
      farmRoots: ["/projects/a"],
      surveyViewers: async () => survey([ours, theirs]),
      stopViewer: async (v) => {
        stopped.push(v);
        return "stopped";
      },
    });
    expect(stopped).toEqual([ours]);
    expect(result.kept).toEqual([{ viewer: theirs, reason: "outside-farm" }]);
  });
});

describe("sweepDecision", () => {
  it("stops an answering review_open viewer with no tab open and confirmed pids", () => {
    expect(sweepDecision(viewer())).toBe("stop");
  });

  it("keeps a viewer someone started from a terminal, or that an older CLI didn't say who started", () => {
    expect(sweepDecision(viewer({ startedBy: "cli" }))).toBe("not-started-by-review-open");
    expect(sweepDecision(viewer({ startedBy: null }))).toBe("not-started-by-review-open");
  });

  it("keeps a viewer with a tab open", () => {
    expect(sweepDecision(viewer({ clients: 2 }))).toBe("tabs-connected");
  });

  it("keeps a viewer that doesn't answer or doesn't report its tabs: it can't be shown to be unused", () => {
    expect(sweepDecision(viewer({ answering: false }))).toBe("unknown-tabs");
    const { clients: _clients, ...noClients } = viewer();
    expect(sweepDecision(noClients as RunningViewer)).toBe("unknown-tabs");
  });

  it("keeps a viewer whose pids aren't confirmed", () => {
    expect(sweepDecision(viewer({ confirmed: null, unconfirmed: "no process table" }))).toBe("unconfirmed");
  });

  it("leaves out the central process itself", () => {
    expect(sweepDecision(viewer({ startedBy: "cli" }), new Set([101]))).toBe("excluded");
  });
});

describe("sweepPerProjectViewers", () => {
  it("stops the unused review_open viewers, keeps the rest with their reasons, and omits excluded pids", async () => {
    const unused = viewer({ pid: 100, serverPid: 101 });
    const gone = viewer({ pid: 110, serverPid: 111, projectRoot: "/projects/b" });
    const terminal = viewer({ pid: 200, serverPid: 201, startedBy: "cli" });
    const watched = viewer({ pid: 300, serverPid: 301, clients: 1 });
    const stubborn = viewer({ pid: 400, serverPid: 401 });
    const central = viewer({ pid: 500, serverPid: 501, startedBy: null });
    const outcomes: Record<number, StopOutcome> = { 100: "stopped", 110: "not-running", 400: "timed-out" };
    const signalled: number[] = [];

    const result = await sweepPerProjectViewers({
      excludePids: [501],
      surveyViewers: async () => survey([unused, gone, terminal, watched, stubborn, central]),
      stopViewer: async (target) => {
        signalled.push(target.pid!);
        return outcomes[target.pid!];
      },
    });

    expect(signalled).toEqual([100, 110, 400]);
    expect(result.stopped.map((entry) => [entry.viewer.pid, entry.outcome])).toEqual([
      [100, "stopped"],
      [110, "not-running"],
    ]);
    expect(result.kept.map((entry) => [entry.viewer.pid, entry.reason, entry.outcome ?? null])).toEqual([
      [200, "not-started-by-review-open", null],
      [300, "tabs-connected", null],
      [400, "stop-failed", "timed-out"],
    ]);
    expect(result.caveats).toEqual([]);
  });

  it("passes on what the survey couldn't see", async () => {
    const result = await sweepPerProjectViewers({
      surveyViewers: async () => survey([], { processScan: false, processScanOff: "unavailable" }),
      stopViewer: async () => "stopped",
    });
    expect(result.stopped).toEqual([]);
    expect(result.caveats.length).toBeGreaterThan(0);
  });
});

describe("surveyViewers reports each viewer's open tabs", () => {
  it("carries the tab count a viewer's own /health reports, and none for one that doesn't name itself", async () => {
    const scratch = await realpath(tmpdir()).then((dir) =>
      join(dir, `dr-legacy-sweep-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    );
    const projectRoot = join(scratch, "project");
    await mkdir(join(projectRoot, "documentation-robotics"), { recursive: true });
    const env = { [DR_STATE_DIR_ENV]: join(scratch, "state") };
    try {
      await mkdir(viewerRecordDir(env), { recursive: true });
      const put = async (record: Partial<ViewerRecord> & { pid: number; port: number }) => {
        const full: ViewerRecord = {
          token: "secret",
          projectRoot,
          startedAt: "2026-11-18T09:00:05.000Z",
          withChangesets: true,
          startedBy: "review_open",
          ...record,
        };
        await writeFile(viewerRecordPath(full.projectRoot, full.pid, env), JSON.stringify(full));
      };
      await put({ pid: 600, port: 8080, viewerId: "v-600" });
      await put({ pid: 602, port: 8082, viewerId: "v-602" });
      const answers: Record<number, ViewerHealth> = {
        8080: { status: "ok", cliVersion: "0.7.1", viewerId: "v-600", pid: 610, launcherPid: 600, clients: 0 },
        // Another viewer holds 8082 now: its tabs aren't this record's.
        8082: { status: "ok", cliVersion: "0.7.1", viewerId: "someone-else", pid: 999, launcherPid: 998, clients: 3 },
      };
      const result = await surveyViewers({
        env,
        isAlive: () => true,
        processes: () => null,
        health: async (port) => answers[port] ?? null,
      });
      expect(result.viewers.map((entry) => [entry.pid, entry.clients ?? null])).toEqual([
        [600, 0],
        [602, null],
      ]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
