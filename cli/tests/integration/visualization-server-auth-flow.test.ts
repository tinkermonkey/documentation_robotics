/**
 * Integration tests: the token on the central process `dr visualize` starts (issue 1279, slice 4A).
 *
 * `dr visualize` starts the farm's central DR process and prints a link with its token in the
 * fragment. Every route except `/` (the viewer's page) and `/health` requires that token, over
 * HTTP and on the websocket. Only the scoped routes are used.
 *
 * REQUIRES SERIAL EXECUTION: starts a real process on a live port.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { portAllocator } from "../helpers.ts";
import { CLI_PATH, makeVisualizeFarm, type VisualizeFarm, type VisualizeResult } from "../helpers/visualize-farm.ts";

const WRONG_TOKEN = "definitely-wrong-token-value";

describe.skipIf(!existsSync(CLI_PATH)).serial("dr visualize — the central process's token", () => {
  let farm: VisualizeFarm;
  let port: number;
  let started: VisualizeResult;
  let token: string;
  let base: string;
  let scoped: string;

  beforeAll(async () => {
    farm = await makeVisualizeFarm(["alpha"]);
    port = await portAllocator.allocatePort();
    started = farm.visualize(farm.projects.alpha, ["--port", String(port)]);
    token = farm.tokenOf(started);
    base = `http://127.0.0.1:${started.port}`;
    scoped = `${base}/api/projects/${started.project}/checkouts/${started.checkout}`;
  });

  afterAll(async () => {
    await farm?.cleanup();
    portAllocator.releasePort(port);
  });

  it("starts the process and links to the checkout, with the token in the fragment", () => {
    expect(started.started).toBe(true);
    expect(started.port).toBe(port);
    expect(started.url).toBe(`${base}/#/p/alpha/c/main/?token=${token}`);
    expect(token.length).toBeGreaterThan(20);
  });

  it("serves / and /health without a token", async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<!DOCTYPE html>");
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(((await health.json()) as { status: string }).status).toBe("ok");
  });

  it("accepts the scoped routes with the token in the Authorization header or ?token=", async () => {
    const model = await fetch(`${scoped}/model`, { headers: { Authorization: `Bearer ${token}` } });
    expect(model.status).toBe(200);
    expect(await model.json()).toBeDefined();
    expect((await fetch(`${scoped}/model?token=${token}`)).status).toBe(200);
    expect((await fetch(`${scoped}/annotations`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await fetch(`${base}/api/projects`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
  });

  it("rejects the scoped routes with no token (401) or a wrong one (403)", async () => {
    const none = await fetch(`${scoped}/model`);
    expect(none.status).toBe(401);
    expect(((await none.json()) as { error: string }).error).toContain("Authentication required");
    const wrong = await fetch(`${scoped}/model`, { headers: { Authorization: `Bearer ${WRONG_TOKEN}` } });
    expect(wrong.status).toBe(403);
    expect(((await wrong.json()) as { error: string }).error).toBe("Invalid authentication token");
    expect((await fetch(`${scoped}/model?token=${WRONG_TOKEN}`)).status).toBe(403);
    expect((await fetch(`${scoped}/annotations`)).status).toBe(401);
  });

  it("accepts a websocket with the token, which subscribes to the checkout", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${started.port}/ws?token=${encodeURIComponent(token)}`);
    const message = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for the subscription")), 10_000);
      ws.addEventListener("open", () => ws.send(JSON.stringify({ action: "subscribe", project: "alpha", checkout: "main" })));
      ws.addEventListener("message", (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.type === "subscribed") {
          clearTimeout(timeout);
          ws.close();
          resolve(msg);
        }
      });
      ws.addEventListener("close", (event) => {
        if (event.code !== 1000 && event.code !== 1005) {
          clearTimeout(timeout);
          reject(new Error(`WebSocket closed unexpectedly: code=${event.code}`));
        }
      });
    });
    expect(message).toMatchObject({ type: "subscribed", project: "alpha", checkout: "main" });
  });

  it("closes a websocket with a wrong token or none", async () => {
    for (const url of [`ws://127.0.0.1:${started.port}/ws?token=${WRONG_TOKEN}`, `ws://127.0.0.1:${started.port}/ws`]) {
      const ws = new WebSocket(url);
      const closed = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 5000);
        ws.addEventListener("close", () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });
      expect(closed).toBe(true);
    }
  });

  it("refuses --no-auth and --token, and starts nothing else", () => {
    const run = farm.dr(["visualize", "--no-browser", "--no-auth", "--token", "x"], farm.projects.alpha);
    expect(run.status).toBe(1);
    expect(run.stderr + run.stdout).toContain("--no-auth: the DR process serves every project, and every route requires its token.");
    expect(run.stderr + run.stdout).toContain("--token: the DR process makes its own token");
  });
});
