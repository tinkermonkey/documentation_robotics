/**
 * When a viewer's server ends on its own (#1237): idle for the limit it was given, or its
 * project's documentation-robotics/ folder is gone. And noticing that the launcher is gone.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { watchViewerLifetime } from "../../../src/server/viewer-lifetime.js";
import { watchParent } from "../../../src/utils/parent-watch.js";
import { parseIdleExitHours } from "../../../src/commands/visualize.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";
import { startTestFarmServer } from "../../helpers/test-farm-server.js";

const HOUR = 3_600_000;

function lifetime(overrides: {
  idleExitMs?: number;
  clients?: () => number;
  lastActivityAt?: () => number;
  now?: () => number;
  exists?: () => boolean;
}) {
  const watch = watchViewerLifetime({
    projectRoot: "/projects/a",
    activity: () => ({ clients: overrides.clients?.() ?? 0, lastActivityAt: overrides.lastActivityAt?.() ?? 0 }),
    idleExitMs: overrides.idleExitMs,
    onExit: () => {},
    intervalMs: 3_600_000,
    now: overrides.now ?? (() => 0),
    exists: overrides.exists ?? (() => true),
  });
  watch.stop();
  return watch;
}

describe("watchViewerLifetime: idle exit", () => {
  it("ends after the limit with no browser tab and no request", () => {
    let now = 0;
    const watch = lifetime({ idleExitMs: 24 * HOUR, now: () => now });
    now = 23 * HOUR;
    expect(watch.check()).toBeNull();
    now = 24 * HOUR;
    expect(watch.check()).toBe("no browser tab was connected and no request came in for 24 hours");
  });

  it("never ends while a browser tab is connected, however long", () => {
    let now = 0;
    let clients = 1;
    let lastActivityAt = 0;
    const watch = lifetime({ idleExitMs: 24 * HOUR, now: () => now, clients: () => clients, lastActivityAt: () => lastActivityAt });
    now = 100 * HOUR;
    expect(watch.check()).toBeNull();
    // The tab closes: the limit runs from then, not from the last request before it.
    clients = 0;
    lastActivityAt = now;
    expect(watch.check()).toBeNull();
    now += 24 * HOUR;
    expect(watch.check()).not.toBeNull();
  });

  it("starts over at each request", () => {
    let now = 0;
    let lastActivityAt = 0;
    const watch = lifetime({ idleExitMs: 24 * HOUR, now: () => now, lastActivityAt: () => lastActivityAt });
    now = 20 * HOUR;
    lastActivityAt = now;
    now = 40 * HOUR;
    expect(watch.check()).toBeNull();
    now = 44 * HOUR;
    expect(watch.check()).not.toBeNull();
  });

  it("never ends a viewer with no limit (one run in a terminal)", () => {
    let now = 0;
    for (const idleExitMs of [undefined, 0]) {
      const watch = lifetime({ idleExitMs, now: () => now });
      now += 1000 * HOUR;
      expect(watch.check()).toBeNull();
    }
  });
});

describe("watchViewerLifetime: project folder gone", () => {
  it("ends when documentation-robotics/ is missing on two checks in a row, with or without an idle limit", () => {
    let present = true;
    const watch = lifetime({ exists: () => present });
    expect(watch.check()).toBeNull();
    present = false;
    // Once could be a branch switch.
    expect(watch.check()).toBeNull();
    expect(watch.check()).toBe("its project folder is gone (/projects/a/documentation-robotics)");
  });

  it("starts counting again when the folder comes back", () => {
    let present = false;
    const watch = lifetime({ exists: () => present });
    expect(watch.check()).toBeNull();
    present = true;
    expect(watch.check()).toBeNull();
    present = false;
    expect(watch.check()).toBeNull();
  });

  it("calls onExit once, from its timer", async () => {
    const reasons: string[] = [];
    watchViewerLifetime({
      projectRoot: "/projects/a",
      activity: () => ({ clients: 0, lastActivityAt: 0 }),
      onExit: (reason) => reasons.push(reason),
      intervalMs: 5,
      exists: () => false,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(reasons).toEqual(["its project folder is gone (/projects/a/documentation-robotics)"]);
  });
});

describe("VisualizationServer.centralActivity", () => {
  async function farmServer(prefix: string, options: Parameters<typeof startTestFarmServer>[1] = {}) {
    const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    const rootPath = await realpath(dir);
    await Model.init(rootPath, { name: "Activity Test", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
    const t = await startTestFarmServer(rootPath, options);
    return {
      t,
      done: async () => {
        await t.stop();
        await rm(rootPath, { recursive: true, force: true });
      },
    };
  }

  it("counts a request as use, and a health check not", async () => {
    // There is no server without a token any more: the request that counts carries it.
    const { t, done } = await farmServer("dr-viewer-activity");
    const server = t.server;
    try {
      const started = server.centralActivity();
      expect(started.clients).toBe(0);

      await new Promise((resolve) => setTimeout(resolve, 15));
      await t.raw("/health");
      expect(server.centralActivity().lastActivityAt).toBe(started.lastActivityAt);

      await t.request("/model");
      expect(server.centralActivity().lastActivityAt).toBeGreaterThan(started.lastActivityAt);
    } finally {
      await done();
    }
  });

  it("does not count a refused request, a page load or a health check as use; an authenticated one counts", async () => {
    const { t, done } = await farmServer("dr-viewer-activity", { token: "secret" });
    const server = t.server;
    try {
      const started = server.centralActivity().lastActivityAt;
      await new Promise((resolve) => setTimeout(resolve, 15));
      // Anything polling the port: no token, a wrong token, the page, the health check.
      expect((await t.raw(t.api("/model"), { headers: {} })).status).toBe(401);
      expect((await t.raw(t.api("/model"), { headers: { Authorization: "Bearer wrong" } })).status).toBe(403);
      await t.raw("/", { headers: {} });
      await t.raw("/health", { headers: {} });
      expect(server.centralActivity().lastActivityAt).toBe(started);

      await t.raw(t.api("/model"), { headers: { Authorization: "Bearer secret" } });
      expect(server.centralActivity().lastActivityAt).toBeGreaterThan(started);
    } finally {
      await done();
    }
  });

  it("names itself, its pids and its connected tabs on /health, only to a caller with the token", async () => {
    const { t, done } = await farmServer("dr-viewer-health", {
      token: "secret",
      server: { launcherPid: 4242 },
      central: { serverId: "server-xyz" },
    });
    const health = async (init: RequestInit) => ((await t.raw("/health", init)) as Response).json();
    const identity = ["serverId", "pid", "launcherPid", "farmRoot", "clients", "mcpSessions", "drBotTurns", "loadedCheckouts"];
    try {
      expect(await health({ headers: { Authorization: "Bearer secret" } })).toMatchObject({
        status: "ok",
        serverId: "server-xyz",
        pid: process.pid,
        launcherPid: 4242,
        farmRoot: t.farm.root,
        clients: 0,
        mcpSessions: 0,
        drBotTurns: 0,
        loadedCheckouts: expect.any(Number),
      });
      expect(await health({ headers: { Authorization: "Bearer wrong" } })).toEqual({
        status: "ok",
        version: "0.1.0",
        cliVersion: expect.any(String),
      });
      // Anyone else, a web page included: status and version only.
      const anonymous = await health({ headers: {} });
      for (const key of identity) expect(anonymous).not.toHaveProperty(key);
      expect(anonymous.cliVersion).toBeTruthy();
      // A caller without the token learns nothing more, whatever else it sends (a query that is not the token).
      const unauthenticated = await health({ headers: { Authorization: "Basic secret" } });
      for (const key of identity) expect(unauthenticated).not.toHaveProperty(key);
    } finally {
      await done();
    }
  });
});

describe("watchParent", () => {
  it("calls back once when the parent's pid is gone", async () => {
    let alive = true;
    let calls = 0;
    watchParent(() => calls++, { intervalMs: 5, parentPid: () => 4242, isAlive: () => alive });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toBe(0);
    alive = false;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls).toBe(1);
  });

  it("calls back when the process has been handed to another parent", async () => {
    let parent = 4242;
    let calls = 0;
    watchParent(() => calls++, { intervalMs: 5, parentPid: () => parent, isAlive: () => true });
    parent = 1;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls).toBe(1);
  });

  it("does nothing for a process with no parent of its own, or once stopped", async () => {
    let calls = 0;
    watchParent(() => calls++, { intervalMs: 5, parentPid: () => 1, isAlive: () => false });
    const watch = watchParent(() => calls++, { intervalMs: 5, parentPid: () => 4242, isAlive: () => false });
    watch.stop();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls).toBe(0);
  });
});

describe("parseIdleExitHours", () => {
  it("takes hours, with 0 or nothing for never", () => {
    expect(parseIdleExitHours("24")).toBe(24);
    expect(parseIdleExitHours("0.5")).toBe(0.5);
    expect(parseIdleExitHours(0)).toBe(0);
    expect(parseIdleExitHours(undefined)).toBe(0);
  });

  it("refuses anything else", () => {
    expect(() => parseIdleExitHours("soon")).toThrow(/Invalid --idle-exit value: soon/);
    expect(() => parseIdleExitHours("-1")).toThrow(/Invalid --idle-exit/);
  });
});
