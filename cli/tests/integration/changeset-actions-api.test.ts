/**
 * POST /api/changesets/:id/commit and /discard — the viewer's review step for changes a
 * chat agent staged in changeset mode. Runs the server's Hono app in-process against a
 * copy of the golden model; changes are staged through the real CLI.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { startTestFarmServer, type TestFarmServer } from "../helpers/test-farm-server.js";
import { extractionPurpose } from "../../src/core/changeset-purpose.js";
import { createFakeWs, waitFor } from "../unit/server/helpers.js";

const ELEMENT_ID = "api.operation.guard-test-operation";
const ADD = [
  "add",
  "api",
  "operation",
  "Guard Test Operation",
  "--attributes",
  '{"operationId":"guardTestOperation","summary":"Guard test","tags":"guard"}',
];

describe("changeset commit/discard API", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let servers: TestFarmServer[] = [];

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    dir = workdir.path;
    cleanup = workdir.cleanup;
  });

  afterEach(async () => {
    await Promise.all(servers.map((s) => s.stop()));
    servers = [];
    await cleanup().catch(() => {});
  });

  /** A server over the model as it is on disk now (it loads the model itself, on first use). */
  async function serve(): Promise<TestFarmServer> {
    const server = await startTestFarmServer(dir);
    servers.push(server);
    return server;
  }

  /** Create + activate a changeset with one staged add; returns its id. */
  async function stageOneAdd(): Promise<string> {
    expect((await runDr(["changeset", "create", "review-test"], { cwd: dir })).exitCode).toBe(0);
    expect((await runDr(ADD, { cwd: dir })).exitCode).toBe(0);
    const model = await Model.load(dir, { lazyLoad: true });
    const id = await new StagingAreaManager(dir, model).getActiveId();
    expect(id).toBeTruthy();
    return id!;
  }

  it("lists a changeset created after the server loaded (no restart needed)", async () => {
    const server = await serve();
    const list = async () => (await (await server.request("/changesets")).json()).changesets;

    const before = await list();
    const id = await stageOneAdd();

    expect(before[id]).toBeUndefined();
    expect((await list())[id]).toMatchObject({ name: "review-test", status: "staged", changes_count: 1 });
    const detail = await (await server.request(`/changesets/${id}`)).json();
    expect(detail.changes).toHaveLength(1);
  });

  /** POSTs to the checkout's `rest` (`/changesets/<id>/commit`) on a fresh server. */
  async function post(rest: string): Promise<Response> {
    const server = await serve();
    return server.request(rest, { method: "POST" });
  }

  /** Whether the element's slug appears in the model files on disk (Model.load would
   *  also show the active changeset's staged changes). */
  async function inBaseModel(id: string): Promise<boolean> {
    const slug = id.split(".").pop()!;
    const modelDir = join(dir, "documentation-robotics", "model");
    const entries = await readdir(modelDir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if ((await readFile(join(entry.parentPath, entry.name), "utf-8")).includes(slug)) return true;
    }
    return false;
  }

  it("commits a staged changeset into the model and deactivates it", async () => {
    const id = await stageOneAdd();
    expect(await inBaseModel(ELEMENT_ID)).toBe(false);

    const res = await post(`/changesets/${id}/commit`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id,
      name: "review-test",
      status: "committed",
      committed: 1,
      failed: 0,
      deactivated: true,
    });
    expect(body.deactivationError).toBeUndefined();
    expect(await inBaseModel(ELEMENT_ID)).toBe(true);
    const model = await Model.load(dir, { lazyLoad: true });
    expect(await new StagingAreaManager(dir, model).getActiveId()).toBeNull();
  });

  it("reports a landed changeset it could not deactivate instead of failing", async () => {
    const id = await stageOneAdd();
    const clear = spyOn(StagingAreaManager.prototype, "clearActive").mockImplementation(async () => {
      throw new Error("EACCES: permission denied, open '.active'");
    });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    let res: Response;
    try {
      res = await post(`/changesets/${id}/commit`);
    } finally {
      clear.mockRestore();
      warn.mockRestore();
    }

    // The commit landed: the route answers 200 and says the changeset is still active.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id, status: "committed", committed: 1, deactivated: false });
    expect(body.deactivationError).toContain("EACCES");
    expect(await inBaseModel(ELEMENT_ID)).toBe(true);
  });

  it("discards a staged changeset without touching the model", async () => {
    const id = await stageOneAdd();

    const res = await post(`/changesets/${id}/discard`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: "discarded" });
    expect(await inBaseModel(ELEMENT_ID)).toBe(false);
    const model = await Model.load(dir, { lazyLoad: true });
    const manager = new StagingAreaManager(dir, model);
    expect(await manager.getActiveId()).toBeNull();
    // Discard deletes the changeset: no folder or record is left behind (#1173).
    expect(await manager.load(id)).toBeNull();
    expect(existsSync(join(dir, "documentation-robotics", "changesets", id))).toBe(false);
  });

  it("refuses to act on a changeset that is no longer staged", async () => {
    const id = await stageOneAdd();
    expect((await post(`/changesets/${id}/commit`)).status).toBe(200);

    expect((await post(`/changesets/${id}/commit`)).status).toBe(409);
    expect((await post(`/changesets/${id}/discard`)).status).toBe(409);
  });

  // #1169: landing one changeset rewrote the manifest, so every other one read as drifted.
  it("commits a changeset staged before another one landed, when the other touched other elements", async () => {
    const id = await stageOneAdd();
    expect((await runDr(["changeset", "deactivate"], { cwd: dir })).exitCode).toBe(0);
    expect((await runDr(["changeset", "create", "other-plan"], { cwd: dir })).exitCode).toBe(0);
    const other = [...ADD.slice(0, 3), "Other Operation", "--attributes", '{"operationId":"otherOperation","summary":"Other","tags":"guard"}'];
    expect((await runDr(other, { cwd: dir })).exitCode).toBe(0);
    const model = await Model.load(dir, { lazyLoad: true });
    const otherId = (await new StagingAreaManager(dir, model).getActiveId())!;
    expect((await post(`/changesets/${otherId}/commit`)).status).toBe(200);

    const res = await post(`/changesets/${id}/commit`);
    expect(res.status).toBe(200);
    expect(await inBaseModel(ELEMENT_ID)).toBe(true);
  });

  // #1200, #1239: drift warns and never refuses, so Apply is a way to land a drifted changeset.
  it("lands a changeset whose base overlaps it, and says what it landed over (no 409 for drift)", async () => {
    const id = await stageOneAdd();
    expect((await runDr(["changeset", "deactivate"], { cwd: dir })).exitCode).toBe(0);
    // The element the changeset adds lands in the base first.
    expect((await runDr(ADD, { cwd: dir })).exitCode).toBe(0);

    const reads = await serve();
    const before = (await (await reads.request(`/changesets/${id}`)).json()).drift;
    expect(before).toMatchObject({ state: "drifted", blocksCommit: false });
    expect(before.overlapping.elements).toMatchObject([{ id: ELEMENT_ID, reason: "already-in-base" }]);

    const res = await post(`/changesets/${id}/commit`);
    expect(res.status).toBe(200);
    const result = await res.json();
    // The add is skipped, as its consequence said: the base's element stands.
    expect(result).toMatchObject({ status: "committed", committed: 0, skipped: 1, failed: 0 });
    expect(result.drift.message).toContain("overlapped 1 staged change(s)");
    expect(result.drift.overlapping.elements).toMatchObject([{ id: ELEMENT_ID, reason: "already-in-base" }]);
    expect(result.drift.overlapping.elements[0].consequence).toContain("the staged add is skipped");
    expect(JSON.stringify(result)).not.toMatch(/--force|force: true/);
    expect(await inBaseModel(ELEMENT_ID)).toBe(true);
  });

  it("refuses a plan's verification record (409), with or without review drops, and reports its purpose and actions (#1171, #1172)", async () => {
    const planId = await stageOneAdd();
    expect((await runDr(["changeset", "deactivate"], { cwd: dir })).exitCode).toBe(0);
    const model = await Model.load(dir, { lazyLoad: false });
    const manager = new StagingAreaManager(dir, model);
    const record = await manager.create(
      "review-test-as-built",
      "As-built extraction of the code at abc1234, files changed since main. Staged by codebase_extract.",
      { kind: "extract" },
      extractionPurpose({ since: "main", gitHead: "abc1234", previousActive: { id: planId } })
    );
    await manager.stage(record.id!, {
      type: "add",
      elementId: "api.operation.record-only-operation",
      layerName: "api",
      timestamp: new Date().toISOString(),
      after: {
        type: "operation",
        name: "Record Only Operation",
        attributes: { operationId: "recordOnlyOperation", summary: "Record only", tags: "guard" },
      },
    });

    for (const init of [{ method: "POST" }, { method: "POST", body: JSON.stringify({ drop: [0] }), headers: { "Content-Type": "application/json" } }]) {
      const server = await serve();
      const res = await server.request(`/changesets/${record.id}/commit`, init);
      expect(res.status).toBe(409);
      const { error } = await res.json();
      expect(error).toContain("'review-test-as-built' is a verification record");
      expect(error).toContain("compared with plan 'review-test'");
      expect(error).toContain("Land the plan 'review-test' instead");
      expect(error).not.toMatch(/\bdr (changeset|visualize)\b|--force/);
    }
    expect(await inBaseModel("api.operation.record-only-operation")).toBe(false);
    const after = await new StagingAreaManager(dir, await Model.load(dir, { lazyLoad: true })).load(record.id!);
    expect(after!.status).toBe("staged");
    expect(after!.changes).toHaveLength(1);

    const server = await serve();
    const list = (await (await server.request("/changesets")).json()).changesets;
    expect(list[record.id!]).toMatchObject({ purpose: "verification", verifies: planId, actions: ["discard"] });
    expect(list[planId]).toMatchObject({ purpose: "plan", actions: ["commit", "discard"] });
    const detail = await (await server.request(`/changesets/${record.id}`)).json();
    expect(detail).toMatchObject({
      purpose: "verification",
      verifies: planId,
      scope: { since: "main", codeCommit: "abc1234" },
      actions: ["discard"],
    });

    // It can still be discarded; the plan still lands.
    expect((await post(`/changesets/${record.id}/discard`)).status).toBe(200);
    expect((await post(`/changesets/${planId}/commit`)).status).toBe(200);
    const landed = (await (await server.request("/changesets")).json()).changesets;
    expect(landed[planId]).toMatchObject({ status: "committed", actions: [] });
  });

  it("returns 404 for an unknown changeset", async () => {
    expect((await post(`/changesets/changeset-missing/commit`)).status).toBe(404);
    expect((await post(`/changesets/changeset-missing/discard`)).status).toBe(404);
  });

  it("returns 422 and applies nothing when the changeset fails validation", async () => {
    const model = await Model.load(dir, { lazyLoad: false });
    const manager = new StagingAreaManager(dir, model);
    const changeset = await manager.create("invalid-test", "Stages an element missing required attributes");
    await manager.stage(changeset.id!, {
      type: "add",
      elementId: "api.operation.invalid-operation",
      layerName: "api",
      timestamp: new Date().toISOString(),
      after: { type: "operation", name: "Invalid Operation", attributes: {} },
    });

    const res = await post(`/changesets/${changeset.id}/commit`);

    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Validation failed");
    expect(await inBaseModel("api.operation.invalid-operation")).toBe(false);
  });
});

/**
 * `changesets.updated` broadcasts: from the file watcher when the CLI writes under
 * documentation-robotics/changesets/ (including the .active marker), and from the
 * commit and discard routes.
 */
describe("changesets.updated broadcast", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let server: TestFarmServer | undefined;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    dir = workdir.path;
    cleanup = workdir.cleanup;
  });

  afterEach(async () => {
    await server?.stop();
    server = undefined;
    await cleanup().catch(() => {});
  });

  /** A server with one recording client subscribed to its checkout (no HTTP listener). */
  async function serverWithClient() {
    server = await startTestFarmServer(dir);
    const ws = createFakeWs();
    (await server.context()).subscribers.add(ws as any);
    return { server, ws };
  }

  /** The checkout's file watcher, started when the server loaded the checkout, once it is ready. */
  async function watch(server: TestFarmServer): Promise<void> {
    const watcher = (await server.context()).watcher as any;
    if (!watcher._readyEmitted) await new Promise((resolve) => watcher.once("ready", resolve));
  }

  const updates = (ws: ReturnType<typeof createFakeWs>) =>
    ws.sent.filter((m) => m.type === "changesets.updated");

  /** Create + activate a changeset with one staged add through the CLI; returns its id. */
  async function stageOneAdd(): Promise<string> {
    expect((await runDr(["changeset", "create", "broadcast-test"], { cwd: dir })).exitCode).toBe(0);
    expect((await runDr(ADD, { cwd: dir })).exitCode).toBe(0);
    const model = await Model.load(dir, { lazyLoad: true });
    const id = await new StagingAreaManager(dir, model).getActiveId();
    expect(id).toBeTruthy();
    return id!;
  }

  it("broadcasts when the CLI creates and activates a changeset", async () => {
    const { server, ws } = await serverWithClient();
    await watch(server);

    expect((await runDr(["changeset", "create", "watched"], { cwd: dir })).exitCode).toBe(0);
    const model = await Model.load(dir, { lazyLoad: true });
    const id = await new StagingAreaManager(dir, model).getActiveId();
    expect(id).toBeTruthy();

    const update = await waitFor(
      () => updates(ws).find((m) => m.ids.includes(id) && m.active === id),
      10000
    );
    expect(typeof update.timestamp).toBe("string");
    // No model file changed, so no model reload
    expect(ws.sent.some((m) => m.type === "model.updated")).toBe(false);
  });

  it("broadcasts when the CLI stages into the active changeset", async () => {
    expect((await runDr(["changeset", "create", "staging"], { cwd: dir })).exitCode).toBe(0);
    const { server, ws } = await serverWithClient();
    await watch(server);

    expect((await runDr(ADD, { cwd: dir })).exitCode).toBe(0);

    await waitFor(() => updates(ws).length > 0, 10000);
  });

  // A base change moves every staged changeset's drift (GET /api/changesets' `drift`), so clients
  // are told to read the changesets again, not only the model.
  it("broadcasts when the base model changes under a staged changeset, whose drift then reads drifted", async () => {
    // Staged in-process and never activated, so the one CLI run below writes the base.
    const manager = new StagingAreaManager(dir, await Model.load(dir, { lazyLoad: false }));
    const id = (await manager.create("broadcast-test")).id!;
    await manager.stage(id, {
      type: "add",
      elementId: ELEMENT_ID,
      layerName: "api",
      timestamp: new Date().toISOString(),
      after: {
        type: "operation",
        name: "Guard Test Operation",
        attributes: { operationId: "guardTestOperation", summary: "Guard test", tags: "guard" },
      },
    });
    const { server, ws } = await serverWithClient();
    const drift = async () =>
      (await (await server.request("/changesets")).json()).changesets[id].drift;
    expect(await drift()).toMatchObject({ state: "none", blocksCommit: false });
    await watch(server);

    // The element the changeset adds lands in the base first: only model files change.
    expect((await runDr(ADD, { cwd: dir })).exitCode).toBe(0);

    await waitFor(() => ws.sent.some((m) => m.type === "model.updated"), 10000);
    const update = await waitFor(() => updates(ws).at(-1), 10000);
    expect(update.ids).toContain(id);
    // The base write touched no changeset file, so the broadcast is the reload's: none came before
    // the first model.updated.
    const types = ws.sent.map((m) => m.type);
    expect(types.indexOf("changesets.updated")).toBeGreaterThan(types.indexOf("model.updated"));
    // Drifted is a warning to show before Apply, not a block (#1200).
    expect(await drift()).toMatchObject({ state: "drifted", blocksCommit: false });
  });

  it("the commit route broadcasts it, with the changeset no longer active", async () => {
    const id = await stageOneAdd();
    const { server, ws } = await serverWithClient();

    const res = await server.request(`/changesets/${id}/commit`, { method: "POST" });

    expect(res.status).toBe(200);
    const [update] = updates(ws);
    expect(update).toMatchObject({ type: "changesets.updated", active: null });
    expect(update.ids).toContain(id);
    expect(ws.sent.some((m) => m.type === "model.updated")).toBe(true);
  });

  it("the discard route broadcasts it", async () => {
    const id = await stageOneAdd();
    const { server, ws } = await serverWithClient();

    const res = await server.request(`/changesets/${id}/discard`, { method: "POST" });

    expect(res.status).toBe(200);
    const [update] = updates(ws);
    expect(update).toMatchObject({ type: "changesets.updated", active: null });
    // The discarded changeset is gone, so it is no longer among the ids.
    expect(update.ids).not.toContain(id);
  });
});
