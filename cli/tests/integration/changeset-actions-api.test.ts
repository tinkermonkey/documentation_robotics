/**
 * POST /api/changesets/:id/commit and /discard — the viewer's review step for changes a
 * chat agent staged in changeset mode. Runs the server's Hono app in-process against a
 * copy of the golden model; changes are staged through the real CLI.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { VisualizationServer } from "../../src/server/server.js";
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

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    dir = workdir.path;
    cleanup = workdir.cleanup;
  });

  afterEach(async () => {
    await cleanup().catch(() => {});
  });

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
    const model = await Model.load(dir, { lazyLoad: false });
    const server = new VisualizationServer(model, { authEnabled: false });
    const list = async () => (await (await (server as any).app.request("/api/changesets")).json()).changesets;

    const before = await list();
    const id = await stageOneAdd();

    expect(before[id]).toBeUndefined();
    expect((await list())[id]).toMatchObject({ name: "review-test", status: "staged", changes_count: 1 });
    const detail = await (await (server as any).app.request(`/api/changesets/${id}`)).json();
    expect(detail.changes).toHaveLength(1);
  });

  async function post(path: string): Promise<Response> {
    const model = await Model.load(dir, { lazyLoad: false });
    const server = new VisualizationServer(model, { authEnabled: false });
    return (server as any).app.request(path, { method: "POST" });
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

    const res = await post(`/api/changesets/${id}/commit`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id, name: "review-test", status: "committed", committed: 1, failed: 0 });
    expect(await inBaseModel(ELEMENT_ID)).toBe(true);
    const model = await Model.load(dir, { lazyLoad: true });
    expect(await new StagingAreaManager(dir, model).getActiveId()).toBeNull();
  });

  it("discards a staged changeset without touching the model", async () => {
    const id = await stageOneAdd();

    const res = await post(`/api/changesets/${id}/discard`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: "discarded" });
    expect(await inBaseModel(ELEMENT_ID)).toBe(false);
    const model = await Model.load(dir, { lazyLoad: true });
    const manager = new StagingAreaManager(dir, model);
    expect(await manager.getActiveId()).toBeNull();
    expect((await manager.load(id))?.changes).toEqual([]);
  });

  it("refuses to act on a changeset that is no longer staged", async () => {
    const id = await stageOneAdd();
    expect((await post(`/api/changesets/${id}/commit`)).status).toBe(200);

    expect((await post(`/api/changesets/${id}/commit`)).status).toBe(409);
    expect((await post(`/api/changesets/${id}/discard`)).status).toBe(409);
  });

  it("returns 404 for an unknown changeset", async () => {
    expect((await post(`/api/changesets/changeset-missing/commit`)).status).toBe(404);
    expect((await post(`/api/changesets/changeset-missing/discard`)).status).toBe(404);
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

    const res = await post(`/api/changesets/${changeset.id}/commit`);

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
  let server: VisualizationServer | undefined;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    dir = workdir.path;
    cleanup = workdir.cleanup;
  });

  afterEach(async () => {
    server?.stop();
    server = undefined;
    await cleanup().catch(() => {});
  });

  /** A server with one recording client attached (no HTTP listener). */
  async function serverWithClient() {
    const model = await Model.load(dir, { lazyLoad: false });
    server = new VisualizationServer(model, { authEnabled: false });
    const ws = createFakeWs();
    (server as any).clients.add(ws);
    return { server, ws };
  }

  async function watch(server: VisualizationServer): Promise<void> {
    (server as any).setupFileWatcher();
    await new Promise((resolve) => (server as any).watcher.once("ready", resolve));
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

  it("the commit route broadcasts it, with the changeset no longer active", async () => {
    const id = await stageOneAdd();
    const { server, ws } = await serverWithClient();

    const res = await (server as any).app.request(`/api/changesets/${id}/commit`, { method: "POST" });

    expect(res.status).toBe(200);
    const [update] = updates(ws);
    expect(update).toMatchObject({ type: "changesets.updated", active: null });
    expect(update.ids).toContain(id);
    expect(ws.sent.some((m) => m.type === "model.updated")).toBe(true);
  });

  it("the discard route broadcasts it", async () => {
    const id = await stageOneAdd();
    const { server, ws } = await serverWithClient();

    const res = await (server as any).app.request(`/api/changesets/${id}/discard`, { method: "POST" });

    expect(res.status).toBe(200);
    const [update] = updates(ws);
    expect(update).toMatchObject({ type: "changesets.updated", active: null });
    expect(update.ids).toContain(id);
  });
});
