/**
 * The central server (#1279, slice 2A): one server for every project and checkout of a farm.
 * Two projects of real git repositories, one with a linked worktree, each a copy of the golden
 * model. Covers the scoped routes across them, the 404s, the token, `/health`, the per-checkout
 * websocket feed and its isolation, `checkout.removed`, and the activity counts.
 * (`testing.testcoveragetarget.scoped-routes`, `testing.testcasesketch.scoped-routes-sketch`)
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FarmManifest } from "../../src/core/farm-manifest.js";
import { ProjectRegistry, type FarmLocation } from "../../src/core/project-registry.js";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { startCentralServerWith } from "../../src/server/central-server.js";
import type { CentralServer } from "../../src/server/central-server-contract.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";

const TOKEN = "dr-central-test-token";
const ELEMENT = "motivation.goal.manage-tasks";
const AUTH = { Authorization: `Bearer ${TOKEN}` };

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: GIT_ENV,
    stdio: "pipe",
    encoding: "utf-8",
  });
}

/** A golden-model copy at `dir`, committed as a git repository on main. */
async function modelRepo(dir: string): Promise<string> {
  const workdir = await createTestWorkdir();
  execFileSync("cp", ["-R", workdir.path, dir]);
  await workdir.cleanup();
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "model");
  return realpath(dir);
}

/** Collects what a websocket receives. */
class Socket {
  readonly received: any[] = [];
  private readonly ws: WebSocket;
  readonly opened: Promise<void>;

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`);
    this.ws.onmessage = (event) => this.received.push(JSON.parse(String(event.data)));
    this.opened = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (error) => reject(error);
    });
  }

  send(frame: unknown): void {
    this.ws.send(JSON.stringify(frame));
  }

  /** The first message matching, waiting for it. */
  async next(match: (message: any) => boolean, timeoutMs = 5000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = this.received.find(match);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`No matching message; received ${JSON.stringify(this.received.map((m) => m.type))}`);
  }

  async subscribe(project: string, checkout: string): Promise<void> {
    this.send({ action: "subscribe", project, checkout });
    await this.next((m) => m.type === "subscribed" && m.project === project && m.checkout === checkout);
  }

  close(): void {
    this.ws.close();
  }
}

describe("central server", () => {
  let tmp: string;
  let farm: FarmLocation;
  let registry: ProjectRegistry;
  let alpha: string;
  let feature: string;
  let beta: string;
  let server: CentralServer;
  const sockets: Socket[] = [];

  const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;
  const get = (p: string, headers: Record<string, string> = AUTH) => fetch(url(p), { headers });
  const scoped = (project: string, checkout: string, rest: string) =>
    `/api/projects/${project}/checkouts/${checkout}${rest}`;
  const socket = async () => {
    const s = new Socket(server.port);
    sockets.push(s);
    await s.opened;
    await s.next((m) => m.type === "connected");
    return s;
  };

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), "dr-central-")));
    alpha = await modelRepo(path.join(tmp, "alpha"));
    beta = await modelRepo(path.join(tmp, "beta"));
    git(alpha, "worktree", "add", "-q", path.join(tmp, "feature"), "-b", "feature");
    feature = await realpath(path.join(tmp, "feature"));

    const root = path.join(tmp, "farm");
    await mkdir(root);
    const file = path.join(root, "farm.yaml");
    await FarmManifest.create("central-test").save(file);
    farm = { root, file, source: "folder" };
    registry = ProjectRegistry.fromManifest(farm, await FarmManifest.load(file));
    await registry.registerProject(alpha, { name: "alpha" });
    await registry.registerProject(beta, { name: "beta" });

    server = await startCentralServerWith(
      { farm, registry, port: 0, token: TOKEN, serverId: "central-test", pool: { maxLoaded: 4, idleMinutes: 30 } },
      { defaultCheckout: { project: "alpha", checkout: "main" }, removalCheckMs: 0 }
    );
  }, 60_000);

  afterEach(() => {
    for (const s of sockets.splice(0)) s.close();
  });

  afterAll(async () => {
    await server?.stop();
    await rm(tmp, { recursive: true, force: true });
  });

  it("lists the farm's projects and their checkouts", async () => {
    const res = await get("/api/projects");
    expect(res.status).toBe(200);
    const { projects } = await res.json();
    expect(projects.map((p: any) => p.name)).toEqual(["alpha", "beta"]);
    const alphaEntry = projects.find((p: any) => p.name === "alpha");
    expect(alphaEntry.checkouts.map((c: any) => c.key).sort()).toEqual(["feature", "main"]);
    expect(alphaEntry.checkouts.find((c: any) => c.key === "feature").path).toBe(feature);

    const one = await (await get("/api/projects/beta")).json();
    expect(one.name).toBe("beta");
    expect(one.repository).toBe(beta);

    const checkouts = await (await get("/api/projects/alpha/checkouts")).json();
    expect(checkouts.project).toBe("alpha");
    expect(checkouts.checkouts).toHaveLength(2);
  });

  it("serves each checkout's own data under its scoped routes", async () => {
    // An annotation made in alpha/feature only.
    const created = await fetch(url(scoped("alpha", "feature", "/annotations")), {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ elementId: ELEMENT, author: "reviewer", content: "only in alpha/feature" }),
    });
    expect(created.status).toBe(201);
    const annotation = await created.json();

    const count = async (project: string, checkout: string) =>
      (await (await get(scoped(project, checkout, "/annotations"))).json()).annotations.length;
    expect(await count("alpha", "feature")).toBe(1);
    expect(await count("alpha", "main")).toBe(0);
    expect(await count("beta", "main")).toBe(0);

    const one = await get(scoped("alpha", "feature", `/annotations/${annotation.id}`));
    expect(one.status).toBe(200);
    expect((await get(scoped("alpha", "main", `/annotations/${annotation.id}`))).status).toBe(404);

    // A changeset staged in beta/main only.
    const staged = await new StagingAreaManager(beta, await Model.load(beta)).create("beta-plan", "staged in beta only");
    const ids = async (project: string, checkout: string) =>
      Object.keys((await (await get(scoped(project, checkout, "/changesets"))).json()).changesets);
    expect(await ids("beta", "main")).toContain(staged.id);
    expect(await ids("alpha", "main")).not.toContain(staged.id);
    expect(await ids("alpha", "feature")).not.toContain(staged.id);
    expect((await get(scoped("beta", "main", `/changesets/${staged.id}`))).status).toBe(200);
    expect((await get(scoped("alpha", "main", `/changesets/${staged.id}`))).status).toBe(404);

    // Writes act on the named checkout only: a review there, then a discard.
    const review = await fetch(url(scoped("beta", "main", `/changesets/${staged.id}/review`)), {
      method: "PUT",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ decisions: [] }),
    });
    expect(review.status).toBe(200);
    const post = (project: string, checkout: string, rest: string) =>
      fetch(url(scoped(project, checkout, rest)), { method: "POST", headers: AUTH });
    expect((await post("alpha", "main", `/changesets/${staged.id}/discard`)).status).toBe(404);
    expect((await post("beta", "main", `/changesets/${staged.id}/discard`)).status).toBe(200);
    expect(await ids("beta", "main")).not.toContain(staged.id);

    // Model, layer and tier1 bodies are today's.
    for (const [project, checkout] of [["alpha", "main"], ["alpha", "feature"], ["beta", "main"]]) {
      expect((await get(scoped(project, checkout, "/model"))).status).toBe(200);
      const layer = await get(scoped(project, checkout, "/layers/motivation"));
      expect(layer.status).toBe(200);
      expect((await layer.json()).name).toBe("motivation");
      expect((await get(scoped(project, checkout, "/tier1"))).status).toBe(200);
    }
  });

  it("serves the unscoped routes for the checkout it was started in", async () => {
    const unscoped = await (await get("/api/model")).json();
    const alphaMain = await (await get(scoped("alpha", "main", "/model"))).json();
    expect(unscoped).toEqual(alphaMain);
    expect((await (await get("/api/annotations")).json()).annotations).toEqual(
      (await (await get(scoped("alpha", "main", "/annotations"))).json()).annotations
    );
    expect((await get("/api/spec")).status).toBe(200);
  });

  it("answers 404 for an unknown project, an unknown checkout and a missing checkout", async () => {
    const unknownProject = await get(scoped("nope", "main", "/model"));
    expect(unknownProject.status).toBe(404);
    expect((await unknownProject.json()).error).toContain("Unknown project");
    expect((await get("/api/projects/nope")).status).toBe(404);
    expect((await get("/api/projects/nope/checkouts")).status).toBe(404);

    const unknownCheckout = await get(scoped("alpha", "nope", "/model"));
    expect(unknownCheckout.status).toBe(404);
    expect((await unknownCheckout.json()).error).toContain("Unknown checkout");

    // A worktree git still lists whose folder is gone.
    const gonePath = path.join(tmp, "gone");
    git(alpha, "worktree", "add", "-q", gonePath, "-b", "gone");
    expect((await get(scoped("alpha", "gone", "/model"))).status).toBe(200);
    await rm(gonePath, { recursive: true, force: true });
    const missing = await get(scoped("alpha", "gone", "/model"));
    expect(missing.status).toBe(404);
    // git calls a worktree whose folder is gone prunable (or missing, when it is locked).
    expect((await missing.json()).error).toMatch(/is (missing|prunable): its folder is not on disk/);
    git(alpha, "worktree", "prune");
  });

  it("requires the token on every route except /health", async () => {
    for (const p of [
      "/api/projects",
      "/api/projects/alpha",
      "/api/projects/alpha/checkouts",
      scoped("alpha", "main", "/model"),
      scoped("alpha", "main", "/annotations"),
      scoped("beta", "main", "/changesets"),
      "/api/model",
    ]) {
      expect((await get(p, {})).status).toBe(401);
      expect((await get(p, { Authorization: "Bearer wrong" })).status).toBe(403);
    }
    const health = await (await get("/health", {})).json();
    expect(health.status).toBe("ok");
    expect(health.pid).toBeUndefined();
    expect(health.farmRoot).toBeUndefined();
  });

  it("reports CentralHealth with the token", async () => {
    await get(scoped("beta", "main", "/model"));
    const health = await (await get("/health")).json();
    expect(health.status).toBe("ok");
    expect(typeof health.cliVersion).toBe("string");
    expect(health.serverId).toBe("central-test");
    expect(health.pid).toBe(process.pid);
    expect(health.farmRoot).toBe(await realpath(farm.root));
    expect(health.loadedCheckouts).toBeGreaterThanOrEqual(1);
    expect(typeof health.clients).toBe("number");
  });

  it("sends each checkout's events only to its subscribers, stamped with the checkout", async () => {
    const alphaTab = await socket();
    const betaTab = await socket();
    const both = await socket();
    await alphaTab.subscribe("alpha", "main");
    await betaTab.subscribe("beta", "main");
    await both.subscribe("alpha", "main");
    await both.subscribe("beta", "main");

    const res = await fetch(url(scoped("beta", "main", "/annotations")), {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ elementId: ELEMENT, author: "reviewer", content: "for beta's subscribers" }),
    });
    expect(res.status).toBe(201);

    const added = await betaTab.next((m) => m.type === "annotation.added");
    expect(added).toMatchObject({ project: "beta", checkout: "main", elementId: ELEMENT });
    expect(await both.next((m) => m.type === "annotation.added")).toMatchObject({ project: "beta", checkout: "main" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(alphaTab.received.filter((m) => m.type === "annotation.added")).toEqual([]);

    // Unsubscribed, a tab hears nothing more of that checkout.
    betaTab.send({ action: "unsubscribe", project: "beta", checkout: "main" });
    await betaTab.next((m) => m.type === "unsubscribed");
    await fetch(url(scoped("beta", "main", "/annotations")), {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ elementId: ELEMENT, author: "reviewer", content: "second" }),
    });
    await both.next((m) => m.type === "annotation.added" && m !== added && both.received.filter((x) => x.type === "annotation.added").length === 2);
    expect(betaTab.received.filter((m) => m.type === "annotation.added")).toHaveLength(1);
  });

  it("refuses a subscription to an unknown checkout", async () => {
    const tab = await socket();
    tab.send({ action: "subscribe", project: "alpha", checkout: "nope" });
    const error = await tab.next((m) => m.type === "error");
    expect(error).toMatchObject({ project: "alpha", checkout: "nope" });
    expect(error.message).toContain("Unknown checkout");
  });

  it("tells a removed checkout's subscribers, and keeps their socket open", async () => {
    const doomed = path.join(tmp, "doomed");
    git(alpha, "worktree", "add", "-q", doomed, "-b", "doomed");
    const tab = await socket();
    await tab.subscribe("alpha", "doomed");
    await tab.subscribe("beta", "main");

    git(alpha, "worktree", "remove", "--force", doomed);
    // The registry notices on its next look at alpha's worktrees.
    expect((await get(scoped("alpha", "doomed", "/model"))).status).toBe(404);
    expect(await tab.next((m) => m.type === "checkout.removed")).toMatchObject({ project: "alpha", checkout: "doomed" });

    tab.send({ type: "ping" });
    await tab.next((m) => m.type === "pong");
  });

  /** Waits until the server counts this many open sockets (a closed one goes asynchronously). */
  const settle = async (clients: number) => {
    const start = Date.now();
    while (server.activity().clients !== clients && Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(server.activity().clients).toBe(clients);
  };

  it("reports activity across every checkout", async () => {
    await settle(0);
    const before = server.activity();
    const a = await socket();
    const b = await socket();
    await a.subscribe("alpha", "feature");
    await b.subscribe("beta", "main");
    const during = server.activity();
    expect(during.clients).toBe(before.clients + 2);
    expect(during.mcpSessions).toBe(0);
    expect(during.drBotTurns).toBe(0);
    expect(during.lastActivityAt).toBeGreaterThanOrEqual(before.lastActivityAt);

    a.close();
    b.close();
    sockets.splice(0);
    await settle(before.clients);

    // A health check is not use; an API request is.
    const idle = server.activity().lastActivityAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await get("/health");
    expect(server.activity().lastActivityAt).toBe(idle);
    await get("/api/projects");
    expect(server.activity().lastActivityAt).toBeGreaterThan(idle);
  });

  it("never evicts a subscribed checkout", async () => {
    const small = await startCentralServerWith(
      { farm, registry, port: 0, token: TOKEN, serverId: "small", pool: { maxLoaded: 1, idleMinutes: 30 } },
      { defaultCheckout: null, removalCheckMs: 0 }
    );
    const tab = new Socket(small.port);
    sockets.push(tab);
    try {
      await tab.opened;
      await tab.subscribe("alpha", "main");
      const req = (p: string) => fetch(`http://127.0.0.1:${small.port}${p}`, { headers: AUTH });
      expect((await req(scoped("beta", "main", "/model"))).status).toBe(200);
      expect((await req(scoped("alpha", "feature", "/model"))).status).toBe(200);
      const health = await (await req("/health")).json();
      // alpha/main (subscribed) and the one most recently used; beta/main was evicted.
      expect(health.loadedCheckouts).toBe(2);

      // The subscribed checkout still sends its events.
      await fetch(`http://127.0.0.1:${small.port}${scoped("alpha", "main", "/annotations")}`, {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ elementId: ELEMENT, author: "reviewer", content: "still subscribed" }),
      });
      expect(await tab.next((m) => m.type === "annotation.added")).toMatchObject({ project: "alpha", checkout: "main" });

      // With no checkout for the unscoped routes, they answer 404.
      expect((await req("/api/model")).status).toBe(404);
    } finally {
      await small.stop();
    }
    // Stopped, it accepts no more connections.
    await expect(fetch(`http://127.0.0.1:${small.port}/health`)).rejects.toThrow();
  });
});
