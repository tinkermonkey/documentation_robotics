/**
 * What the central process's idle exit reads (`centralActivity`: tabs, requests, /health), and
 * noticing that a launcher is gone (`watchParent`). The idle exit itself is tested in
 * central-lifetime's tests.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { watchParent } from "../../../src/utils/parent-watch.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";
import { startTestFarmServer } from "../../helpers/test-farm-server.js";

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
