/**
 * Per-checkout state never leaks (#1279, slice 1B): two checkouts of one project and a second
 * project, each a copy of the golden model on disk. An annotation, a staged changeset, the active
 * changeset and a websocket event written for one are absent from the other two, through the
 * checkout context pool and through the server's routes and feed.
 * (`testing.testcoveragetarget.per-checkout-isolation`, `testing.testcasesketch.per-checkout-isolation-sketch`)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { realpath } from "node:fs/promises";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import type { CheckoutRef, CheckoutResolver } from "../../src/core/checkout-types.js";
import { Model } from "../../src/core/model.js";
import { CheckoutContextPool } from "../../src/server/checkout-context-pool.js";
import type { CheckoutContext } from "../../src/server/checkout-context.js";
import { createFakeWs } from "../unit/server/helpers.js";
import { startTestFarmServer, type TestFarmServer } from "../helpers/test-farm-server.js";

const ELEMENT = "motivation.goal.manage-tasks";

const ALPHA_MAIN: CheckoutRef = { project: "alpha", checkout: "main" };
const ALPHA_FEATURE: CheckoutRef = { project: "alpha", checkout: "feature" };
const BETA_MAIN: CheckoutRef = { project: "beta", checkout: "main" };
const REFS = [ALPHA_MAIN, ALPHA_FEATURE, BETA_MAIN];

describe("per-checkout isolation", () => {
  const dirs = new Map<string, string>();
  const cleanups: Array<() => Promise<void>> = [];
  const label = (r: CheckoutRef) => `${r.project}/${r.checkout}`;

  beforeEach(async () => {
    for (const r of REFS) {
      const workdir = await createTestWorkdir();
      dirs.set(label(r), workdir.path);
      cleanups.push(workdir.cleanup);
    }
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup().catch(() => {});
    dirs.clear();
  });

  const resolver: CheckoutResolver = async (r) => {
    const path = dirs.get(label(r));
    if (!path) return null;
    return {
      ref: r,
      modelPath: path,
      checkout: { key: r.checkout, path, branch: r.checkout, head: "abc", isMain: r.checkout === "main", state: "present", locked: false },
    };
  };

  it("contexts from the pool share no annotations, changesets, active changeset or subscribers", async () => {
    const pool = new CheckoutContextPool({ resolver, settings: { maxLoaded: 4, idleMinutes: 30 } });
    try {
      const contexts = new Map<string, CheckoutContext>();
      for (const r of REFS) contexts.set(label(r), (await pool.acquire(r))!);
      const [alphaMain, alphaFeature, betaMain] = REFS.map((r) => contexts.get(label(r))!);
      const others = [alphaFeature, betaMain];

      expect(new Set([alphaMain.rootPath, alphaFeature.rootPath, betaMain.rootPath]).size).toBe(3);
      expect(alphaMain.model).not.toBe(alphaFeature.model);

      // An annotation written for alpha/main.
      await alphaMain.annotationStore.create({ elementId: ELEMENT, author: "reviewer", content: "only here" });
      expect(await alphaMain.annotationStore.list(ELEMENT)).toHaveLength(1);
      for (const ctx of others) expect(await ctx.annotationStore.list(ELEMENT)).toHaveLength(0);

      // A changeset staged and made active in alpha/main.
      const manager = alphaMain.stagingArea();
      const changeset = await manager.create("isolation-plan", "staged in alpha/main only");
      await manager.setActive(changeset.id);
      for (const ctx of [alphaMain, ...others]) await ctx.loadChangesets();
      expect([...alphaMain.changesets.keys()]).toContain(changeset.id);
      expect(await alphaMain.stagingArea().getActiveId()).toBe(changeset.id);
      for (const ctx of others) {
        expect([...ctx.changesets.keys()]).not.toContain(changeset.id);
        expect(await ctx.stagingArea().getActiveId()).toBeNull();
      }

      // A subscriber of alpha/main is no one else's.
      alphaMain.subscribers.add(createFakeWs());
      for (const ctx of others) expect(ctx.subscribers.size).toBe(0);

      // Removing alpha/feature leaves the other two loaded and untouched.
      pool.close(ALPHA_FEATURE);
      expect(pool.loaded().map(label).sort()).toEqual(["alpha/main", "beta/main"]);
      expect(alphaMain.closed || betaMain.closed).toBe(false);
    } finally {
      pool.stop();
    }
  });

  it("servers over two checkouts never serve or broadcast each other's state", async () => {
    // One central server per checkout copy: each serves its copy as the main checkout of a
    // one-project scratch farm, with a fake viewer socket subscribed to it.
    const servers: TestFarmServer[] = [];
    const start = async (r: CheckoutRef) => {
      const server = await startTestFarmServer(dirs.get(label(r))!);
      servers.push(server);
      const ws = createFakeWs();
      (await server.context()).subscribers.add(ws);
      return { server, ws };
    };
    /** An in-process request to the server's scoped checkout path for `path`, with the token. */
    const request = (server: TestFarmServer, path: string, init?: RequestInit): Promise<Response> =>
      server.request(path, init);

    try {
      const alpha = await start(ALPHA_MAIN);
      const feature = await start(ALPHA_FEATURE);
      const beta = await start(BETA_MAIN);

      const created = await request(alpha.server, "/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elementId: ELEMENT, author: "reviewer", content: "only in alpha/main" }),
      });
      expect(created.status).toBe(201);
      expect(alpha.ws.sent.map((m: any) => m.type)).toContain("annotation.added");

      for (const other of [feature, beta]) {
        const listed = await (await request(other.server, "/annotations")).json();
        expect(listed.annotations).toEqual([]);
        expect(other.ws.sent).toEqual([]);
      }
      const own = await (await request(alpha.server, "/annotations")).json();
      expect(own.annotations).toHaveLength(1);

      // A changeset staged in alpha/feature is listed by its server only.
      const featureContext = await feature.server.context();
      const featureModel = featureContext.model as Model;
      const staged = await featureContext.stagingArea().create("feature-plan");
      // The farm registers a project by its real path (macOS: /var is /private/var).
      expect(featureModel.rootPath).toBe(await realpath(dirs.get("alpha/feature")!));
      const featureList = (await (await request(feature.server, "/changesets")).json()).changesets;
      expect(Object.keys(featureList)).toContain(staged.id);
      for (const other of [alpha, beta]) {
        const list = (await (await request(other.server, "/changesets")).json()).changesets;
        expect(Object.keys(list)).not.toContain(staged.id);
      }
    } finally {
      for (const server of servers) await server.stop();
    }
  });
});
