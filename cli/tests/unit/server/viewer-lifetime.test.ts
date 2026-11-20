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
import { createServerWithoutChatDetection } from "./helpers.js";

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

describe("VisualizationServer.getActivity", () => {
  it("counts a request as use, and a health check not", async () => {
    const dir = join(tmpdir(), `dr-viewer-activity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    const rootPath = await realpath(dir);
    await Model.init(rootPath, { name: "Activity Test", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
    const server = createServerWithoutChatDetection(await Model.load(rootPath, { lazyLoad: false }), { authEnabled: false });
    try {
      const app = (server as any).app;
      const started = server.getActivity();
      expect(started.clients).toBe(0);

      await new Promise((resolve) => setTimeout(resolve, 15));
      await app.request("/health");
      expect(server.getActivity().lastActivityAt).toBe(started.lastActivityAt);

      await app.request("/api/model");
      expect(server.getActivity().lastActivityAt).toBeGreaterThan(started.lastActivityAt);
    } finally {
      server.stop();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("does not count a refused request, a page load or a health check as use; an authenticated one counts", async () => {
    const dir = join(tmpdir(), `dr-viewer-activity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    const rootPath = await realpath(dir);
    await Model.init(rootPath, { name: "Activity Test", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
    const server = createServerWithoutChatDetection(await Model.load(rootPath, { lazyLoad: false }), {
      authEnabled: true,
      authToken: "secret",
    });
    try {
      const app = (server as any).app;
      const started = server.getActivity().lastActivityAt;
      await new Promise((resolve) => setTimeout(resolve, 15));
      // Anything polling the port: no token, a wrong token, the page, the health check.
      expect((await app.request("/api/model")).status).toBe(401);
      expect((await app.request("/api/model", { headers: { Authorization: "Bearer wrong" } })).status).toBe(403);
      await app.request("/");
      await app.request("/health");
      expect(server.getActivity().lastActivityAt).toBe(started);

      await app.request("/api/model", { headers: { Authorization: "Bearer secret" } });
      expect(server.getActivity().lastActivityAt).toBeGreaterThan(started);
    } finally {
      server.stop();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("names itself, its pids and its connected tabs on /health, only to a caller with the token", async () => {
    const dir = join(tmpdir(), `dr-viewer-health-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    const rootPath = await realpath(dir);
    await Model.init(rootPath, { name: "Health Test", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
    const server = createServerWithoutChatDetection(await Model.load(rootPath, { lazyLoad: false }), {
      authEnabled: true,
      authToken: "secret",
      viewerId: "viewer-xyz",
      launcherPid: 4242,
    });
    const open = createServerWithoutChatDetection(await Model.load(rootPath, { lazyLoad: false }), {
      authEnabled: false,
      viewerId: "viewer-open",
      launcherPid: 4242,
    });
    const health = async (target: typeof server, init?: RequestInit) =>
      ((await (target as any).app.request("/health", init)) as Response).json();
    const identity = ["pid", "launcherPid", "viewerId", "clients"];
    try {
      expect(await health(server, { headers: { Authorization: "Bearer secret" } })).toMatchObject({
        status: "ok",
        viewerId: "viewer-xyz",
        pid: process.pid,
        launcherPid: 4242,
        clients: 0,
      });
      expect(await health(server, { headers: { Authorization: "Bearer wrong" } })).toEqual({
        status: "ok",
        version: "0.1.0",
        cliVersion: expect.any(String),
      });
      // Anyone else, a web page included: status and version only.
      const anonymous = await health(server);
      for (const key of identity) expect(anonymous).not.toHaveProperty(key);
      expect(anonymous.cliVersion).toBeTruthy();
      // A viewer without auth has no token, so it tells nobody.
      const unauthenticated = await health(open);
      for (const key of identity) expect(unauthenticated).not.toHaveProperty(key);
    } finally {
      open.stop();
      server.stop();
      await rm(rootPath, { recursive: true, force: true });
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
